"""Merge rule + Gemma detections, assign placeholders, sanitize and rehydrate."""

import logging
import re
import threading
import time
import uuid
from dataclasses import dataclass, field

from backend import gemma, risk, rules

logger = logging.getLogger("veil.pipeline")

REDACTED_TYPES = {"API_KEY", "PASSWORD", "JWT", "CARD", "GOV_ID"}
WORD_BOUNDARY_TYPES = {"PERSON", "ORG", "PROJECT"}
CASE_INSENSITIVE_TYPES = {"PERSON", "ORG"}

PLACEHOLDER_RE = re.compile(r"\[([A-Z_]+)_(\d+)\]")

USER_ORIGIN = "user"


@dataclass
class Session:
    scan_id: str
    value_to_ph: dict[str, str] = field(default_factory=dict)
    ph_to_value: dict[str, str] = field(default_factory=dict)
    ph_type: dict[str, str] = field(default_factory=dict)
    counters: dict[str, int] = field(default_factory=dict)
    messages: list[dict] = field(default_factory=list)
    sanitized_text: str = ""
    # Case-folded value -> placeholder, for PERSON/ORG matching.
    folded_to_ph: dict[tuple[str, str], str] = field(default_factory=dict)
    # Placeholder -> tier that first caught it ("rule" or "gemma").
    ph_source: dict[str, str] = field(default_factory=dict)
    # Placeholder -> where its value first appeared: "user" or "untrusted:<tool>".
    ph_origin: dict[str, str] = field(default_factory=dict)
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)

    def placeholder_for(self, entity_type: str, value: str, origin: str = USER_ORIGIN) -> str:
        """Return the stable placeholder for a value, creating one if needed.

        `origin` records where the value was first seen; later sightings never change it.
        """

        if value in self.value_to_ph:
            placeholder = self.value_to_ph[value]
            self.ph_origin.setdefault(placeholder, origin)
            return placeholder

        folded_key = (entity_type, value.casefold())
        if entity_type in CASE_INSENSITIVE_TYPES and folded_key in self.folded_to_ph:
            placeholder = self.folded_to_ph[folded_key]
        else:
            self.counters[entity_type] = self.counters.get(entity_type, 0) + 1
            placeholder = f"[{entity_type}_{self.counters[entity_type]}]"
            self.ph_to_value[placeholder] = value
            self.ph_type[placeholder] = entity_type
            if entity_type in CASE_INSENSITIVE_TYPES:
                self.folded_to_ph[folded_key] = placeholder

        self.value_to_ph[value] = placeholder
        self.ph_origin.setdefault(placeholder, origin)
        return placeholder

    def redacted_values(self) -> list[str]:
        return [
            value for ph, value in self.ph_to_value.items()
            if self.ph_type.get(ph) in REDACTED_TYPES
        ]


SESSIONS: dict[str, Session] = {}
MAX_SESSIONS = 500


def _find_occurrences(text: str, value: str, entity_type: str) -> list[tuple[int, int]]:
    if entity_type in WORD_BOUNDARY_TYPES:
        left = r"\b" if value[:1].isalnum() else ""
        right = r"\b" if value[-1:].isalnum() else ""
        pattern = re.compile(left + re.escape(value) + right)
    else:
        pattern = re.compile(re.escape(value))
    return [(m.start(), m.end()) for m in pattern.finditer(text)]


def _overlaps(a: dict, b: dict) -> bool:
    return a["start"] < b["end"] and b["start"] < a["end"]


def _merge(rule_spans: list[dict], gemma_spans: list[dict], known_spans: list[dict] = ()) -> list[dict]:
    """Rule spans win; then values already known to the session; then Gemma (longer span first)."""

    kept = list(rule_spans)
    for tier in (known_spans, gemma_spans):
        for span in sorted(tier, key=lambda s: (-(s["end"] - s["start"]), s["start"])):
            if not any(_overlaps(span, k) for k in kept):
                kept.append(span)

    return sorted(kept, key=lambda s: s["start"])


def _known_spans(session: Session, text: str) -> list[dict]:
    """Spans for every value the session already has a placeholder for (earlier turns of a chat)."""

    spans = []
    for value, placeholder in session.value_to_ph.items():
        entity_type = session.ph_type[placeholder]
        if entity_type in CASE_INSENSITIVE_TYPES:
            left = r"\b" if value[:1].isalnum() else ""
            right = r"\b" if value[-1:].isalnum() else ""
            matches = re.finditer(left + re.escape(value) + right, text, flags=re.IGNORECASE)
            occurrences = [(m.start(), m.end()) for m in matches]
        else:
            occurrences = _find_occurrences(text, value, entity_type)
        source = session.ph_source.get(placeholder, "rule")
        for start, end in occurrences:
            spans.append({"type": entity_type, "text": text[start:end], "start": start, "end": end, "source": source})
    return spans


def _apply_spans(text: str, spans: list[dict]) -> str:
    out = text
    for span in sorted(spans, key=lambda s: s["start"], reverse=True):
        out = out[:span["start"]] + span["replacement"] + out[span["end"]:]
    return out


def scan(text: str, session: Session | None = None, origin: str = USER_ORIGIN) -> dict:
    """Run both tiers over `text` and return the /scan response body.

    With `session` (a follow-up message in the same chat), placeholders continue from that
    session's map, and values it already knows are masked even if neither tier flags them again.
    `origin` is recorded for every new placeholder ("user" or "untrusted:<tool>").
    """

    total_started = time.perf_counter()

    started = time.perf_counter()
    rule_hits = rules.detect(text)
    rules_ms = round((time.perf_counter() - started) * 1000)

    gemma_hits: list[dict] = []
    gemma_used = False
    gemma_ms = 0
    if gemma.is_loaded():
        started = time.perf_counter()
        try:
            gemma_hits = gemma.detect(text)
            gemma_used = True
        except Exception:
            logger.exception("Gemma detection failed; continuing with rule results only.")
            gemma_hits = []
        gemma_ms = round((time.perf_counter() - started) * 1000)

    rule_spans = [
        {"type": h["type"], "text": text[h["start"]:h["end"]], "start": h["start"], "end": h["end"], "source": "rule"}
        for h in rule_hits
    ]
    gemma_spans = [
        {"type": h["type"], "text": text[s:e], "start": s, "end": e, "source": "gemma", "reason": h.get("reason", "")}
        for h in gemma_hits
        for s, e in _find_occurrences(text, h["text"], h["type"])
    ]
    is_new_session = session is None
    if session is None:
        session = Session(scan_id=str(uuid.uuid4()))
    spans = _merge(rule_spans, gemma_spans, _known_spans(session, text))

    for span in spans:
        span["replacement"] = session.placeholder_for(span["type"], span["text"], origin)
        session.ph_source.setdefault(span["replacement"], span["source"])

    sanitized_text = _apply_spans(text, spans)
    session.sanitized_text = sanitized_text

    # One row per unique value; "rule" wins if both tiers caught it.
    rows: dict[str, dict] = {}
    for span in spans:
        row = rows.get(span["text"])
        if row is None:
            entity_type = session.ph_type[span["replacement"]]
            rows[span["text"]] = {
                "type": entity_type,
                "text": span["text"],
                "replacement": span["replacement"],
                "risk": risk.entity_risk(entity_type),
                "source": span["source"],
                "redacted": entity_type in REDACTED_TYPES,
                "count": 1,
            }
            if span.get("reason"):
                rows[span["text"]]["reason"] = span["reason"]
        else:
            row["count"] += 1
            if span["source"] == "rule":
                row["source"] = "rule"
                row.pop("reason", None)

    entities = list(rows.values())

    if is_new_session:
        SESSIONS[session.scan_id] = session
        # Bound memory on long demo runs: drop the oldest scans first.
        while len(SESSIONS) > MAX_SESSIONS:
            SESSIONS.pop(next(iter(SESSIONS)))

    logger.info(
        "[inner-door] origin=%s, %d chars: %d value(s) hidden (%d by rules, %d by Gemma), Gemma %s, %d ms",
        origin, len(text), len(entities), sum(1 for e in entities if e["source"] == "rule"),
        sum(1 for e in entities if e["source"] == "gemma"), "used" if gemma_used else "not used",
        round((time.perf_counter() - total_started) * 1000),
    )
    return {
        "scan_id": session.scan_id,
        "risk": risk.overall_risk([e["type"] for e in entities]),
        "entities": entities,
        "sanitized_text": sanitized_text,
        "gemma_used": gemma_used,
        "timings_ms": {
            "rules": rules_ms,
            "gemma": gemma_ms,
            "total": round((time.perf_counter() - total_started) * 1000),
        },
    }


def _gemma_spans(text: str) -> list[dict]:
    """Gemma PII spans in `text` (never inside an existing placeholder); [] if Gemma is unavailable."""

    if not gemma.is_loaded():
        return []
    try:
        hits = gemma.detect(text)
    except Exception:
        logger.exception("Gemma detection failed on a tool result; continuing with rule results only.")
        return []

    placeholder_spans = [{"start": m.start(), "end": m.end()} for m in PLACEHOLDER_RE.finditer(text)]
    spans = []
    for hit in hits:
        for start, end in _find_occurrences(text, hit["text"], hit["type"]):
            span = {"type": hit["type"], "start": start, "end": end}
            if not any(_overlaps(span, ph) for ph in placeholder_spans):
                spans.append({**span, "text": text[start:end], "source": "gemma"})
    return spans


def sanitize_with_session(session: Session, text: str, origin: str = USER_ORIGIN) -> str:
    """Sanitize a message with the session's existing placeholder map plus new rule hits.

    `origin` is recorded for new placeholders. Text that is not from the user (tool results) also gets
    Gemma's PII pass when Gemma is loaded, so names inside an email are pseudonymized too.
    """

    out = text
    for value in sorted(session.value_to_ph, key=len, reverse=True):
        placeholder = session.value_to_ph[value]
        entity_type = session.ph_type[placeholder]
        if entity_type in WORD_BOUNDARY_TYPES:
            left = r"\b" if value[:1].isalnum() else ""
            right = r"\b" if value[-1:].isalnum() else ""
            flags = re.IGNORECASE if entity_type in CASE_INSENSITIVE_TYPES else 0
            out = re.sub(left + re.escape(value) + right, lambda _m: placeholder, out, flags=flags)
        else:
            out = out.replace(value, placeholder)

    rule_spans = []
    for hit in rules.detect(out):
        value = out[hit["start"]:hit["end"]]
        if PLACEHOLDER_RE.fullmatch(value):
            continue
        rule_spans.append({"type": hit["type"], "text": value, "start": hit["start"], "end": hit["end"]})

    gemma_spans = _gemma_spans(out) if origin != USER_ORIGIN else []
    spans = _merge(rule_spans, gemma_spans) if gemma_spans else rule_spans
    for span in spans:
        span["replacement"] = session.placeholder_for(span["type"], span["text"], origin)
    return _apply_spans(out, spans)


def origin_of(session: Session, placeholder: str) -> str | None:
    """Where a placeholder's value first appeared ("user" / "untrusted:<tool>"), None if unknown."""

    return session.ph_origin.get(placeholder)


def rehydrate_args(session: Session, args, allowed: set[str] | None):
    """Restore placeholders inside tool arguments (deep walk over dicts, lists and strings).

    Only placeholders in `allowed` are restored (None = every non-secret placeholder). Redacted types
    (API keys, passwords, ...) and unknown placeholders are never restored. Returns a new structure.
    """

    def restore(match: re.Match) -> str:
        placeholder = match.group(0)
        entity_type = session.ph_type.get(placeholder)
        if entity_type is None or entity_type in REDACTED_TYPES:
            return placeholder
        if allowed is not None and placeholder not in allowed:
            return placeholder
        return session.ph_to_value[placeholder]

    def walk(value):
        if isinstance(value, str):
            return PLACEHOLDER_RE.sub(restore, value)
        if isinstance(value, dict):
            return {key: walk(item) for key, item in value.items()}
        if isinstance(value, (list, tuple)):
            return [walk(item) for item in value]
        return value

    return walk(args)


def rehydrate(session: Session, text: str) -> str:
    """Restore pseudonymized placeholders; redacted and unknown placeholders stay as-is."""

    def restore(match: re.Match) -> str:
        placeholder = match.group(0)
        entity_type = session.ph_type.get(placeholder)
        if entity_type is None or entity_type in REDACTED_TYPES:
            return placeholder
        return session.ph_to_value[placeholder]

    return PLACEHOLDER_RE.sub(restore, text)
