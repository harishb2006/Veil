"""Outer door: scan what an agent is about to read and hand the model only a clean, datamarked copy.

Tier 1 (`inject_rules`) always runs. Tier 2 (Gemma 4, local) runs on a small budget of text the rules
flagged or could not judge. The model never sees hidden content: `content_for_model` is built from the
human-visible text, with high-severity spans cut out.
"""

from __future__ import annotations

import logging
import os
import re
import time

from backend import gemma, inject_rules

logger = logging.getLogger("veil.firewall")

QUARANTINE_RATIO = 0.5
REMOVED_HIDDEN = "[REMOVED BY VEIL: hidden instruction]"
REMOVED_VISIBLE = "[REMOVED BY VEIL: instruction aimed at AI]"

_SEVERITY_RANK = {"low": 0, "medium": 1, "high": 2}
# Hidden kinds whose text never reaches visible_text, so there is nothing to cut out of it.
_NOT_IN_VISIBLE = {"HIDDEN_CSS", "COMMENT", "ATTR", "UNICODE_TAG", "VARIATION_SELECTOR"}
_MAX_REASON_WORDS = 8


def gemma_injection_available() -> bool:
    return gemma.is_loaded()


def _env_int(name: str, default: int) -> int:
    try:
        return max(int(os.getenv(name, "")), 0)
    except ValueError:
        return default


def _norm(text: str) -> str:
    return " ".join(inject_rules.strip_invisible(text).split())


def _find_span(text: str, needle: str) -> tuple[int, int] | None:
    """Locate `needle` in `text`, ignoring differences in whitespace and invisible characters."""

    needle = inject_rules.strip_invisible(needle).strip()
    if not needle:
        return None
    idx = text.find(needle)
    if idx >= 0:
        return idx, idx + len(needle)
    m = re.search(r"\s+".join(re.escape(word) for word in needle.split()), text)
    return (m.start(), m.end()) if m else None


# --------------------------------------------------------------------------- tier 2 (Gemma)


# Words and shapes that make a sentence worth a second opinion from Gemma: it is addressed to an AI, gives an
# order about data or commands, or points at an address or URL. Every other sentence is never sent to the model.
_CUES = re.compile(
    r"(?i)(?:\b(?:ai|a\.i\.|assistant|agent|model|llm|chatgpt|claude|gemini|ignore|disregard|override|reveal|"
    r"forward|send|email|mail|upload|post|exfiltrate|execute|run|curl|wget|bash|shell|password|api[ _-]?key|"
    r"secret|token|do not (?:tell|mention|reveal)|don't (?:tell|mention|reveal)|tell no one|top priority|"
    r"above all|immediately|urgent(?:ly)?|please|wire|transfer|payment|funds|instructions?)\b|\.env\b|@|https?://)"
)
_MAX_CANDIDATE_LINES = 12

# What makes a Gemma finding worth acting on. A small model says "yes" to many ordinary sentences (a screen-reader
# alert, "Please donate.", a request between colleagues), so Gemma alone can only raise a finding to high when the
# text is addressed to an AI, tries to override instructions, hides itself from the user, or targets secrets or
# commands. Without one of these, Gemma's finding is kept as low: reported, but nothing is cut or quarantined.
# Mentioning AI is not enough (a page can be about AI); the text has to address one: "AI assistant reading this
# page:", "Dear AI,", "Note for the agent:", "you are an AI".
_AI_WORD = r"(?:ai|a\.i\.|assistant|agent|llm|chatgpt|claude|gemini|copilot|language model|model)s?"
_STRONG_CUES = re.compile(
    r"(?i)(?:\b" + _AI_WORD + r"\b\s*[:,]|"
    r"\b(?:dear|hey|hi|hello|attention|note (?:to|for))\b[^.!?\n]{0,30}\b" + _AI_WORD + r"\b|"
    r"\b" + _AI_WORD + r"\s+(?:reading|processing|handling|summari[sz]ing|browsing|parsing|reviewing)\b|"
    r"\b(?:you are|as) an? (?:ai|assistant|language model)\b|\bsystem prompt\b|"
    r"\b(?:(?:ignore|disregard|override|forget)\b.{0,40}\b(?:instruction|direction|rule|prompt)s?|"
    r"do not (?:tell|mention|reveal|inform)|don't (?:tell|mention|reveal|inform)|tell no one|without telling|"
    r"api[ _-]?keys?|passwords?|secrets?|credentials?|tokens?|private keys?|exfiltrate|curl|wget|bash|"
    r"powershell|run the command|execute)\b|\.env\b|\|\s*sh\b)"
)


def _gemma_severity(text: str, severity: str) -> str:
    if severity == "low" or _STRONG_CUES.search(text):
        return severity
    return "low"


def _suspicious_sentences(visible: str) -> list[str]:
    """The sentences of the visible text the rules find worth asking Gemma about, in order (exact substrings)."""

    sentences = gemma.numbered_lines(visible)
    return [s for s in sentences if inject_rules.phrase_score(s) > 0 or _CUES.search(s)][:_MAX_CANDIDATE_LINES]


def _gemma_units(segments: list[dict], visible: str, budget: int) -> list[tuple[str, str | None]]:
    """Texts to send to Gemma, hidden/decoded segments first. Each unit is one chunk: (text, segment kind).

    Visible text is never sent whole, only the sentences the rules flagged as suspicious. Gemma then judges a
    few lines instead of a whole page: faster, and a small model is far less likely to flag harmless text."""

    units: list[tuple[str, str | None]] = []
    for segment in segments:
        # Hidden text is everywhere on real pages (screen-reader labels, alerts, HTML comments); only hidden text
        # that the rules find suspicious is worth a model call.
        units.extend(
            (chunk, segment["kind"]) for chunk in gemma._chunk(segment["text"])
            if chunk.strip() and (inject_rules.phrase_score(chunk) > 0 or _CUES.search(chunk))
        )
    suspicious = _suspicious_sentences(visible)
    if suspicious:
        units.extend((chunk, None) for chunk in gemma._chunk("\n".join(suspicious)) if chunk.strip())
    return units[:budget]


def _gemma_findings(segments: list[dict], visible: str) -> tuple[list[dict], bool]:
    """Run Gemma over the budgeted units. Returns (findings, whether Gemma answered at least once)."""

    units = _gemma_units(
        segments, visible,
        budget=_env_int("INJECTION_MAX_CHUNKS", 3),
    )
    findings: list[dict] = []
    answered = False
    seen: set[tuple[str, bool]] = set()
    for text, segment_kind in units:
        hints = [m.text for m in inject_rules.phrase_matches(text)]
        try:
            found = gemma.detect_injection(text, hints)
        except Exception:
            logger.exception("Gemma injection scan failed; continuing with rule results only.")
            continue
        answered = True
        for item in found:
            key = (item["text"], segment_kind is not None)
            if key in seen:
                continue
            seen.add(key)
            reason = " ".join(str(item.get("reason", "")).split()[:_MAX_REASON_WORDS]) or "Gemma judged it an injection"
            findings.append({
                "tier": "gemma",
                # Text found inside a hidden segment keeps that segment's kind: hidden + imperative.
                "kind": segment_kind or item["kind"],
                "text": item["text"],
                "severity": _gemma_severity(item["text"], item["severity"]),
                "reason": reason,
                "hidden": segment_kind is not None,
            })
    return findings, answered


def _merge(rule_findings: list[dict], gemma_findings: list[dict], visible: str) -> list[dict]:
    """Rule findings win on overlapping text.

    The one exception: a low, hidden-only rule finding that Gemma rates higher is replaced by Gemma's,
    because hidden text that gives orders is high by definition.
    """

    kept = list(rule_findings)
    rule_spans = [
        (finding, _find_span(visible, finding["text"]))
        for finding in rule_findings
        if not finding["hidden"] or finding["kind"] in {"ZERO_WIDTH", "BIDI"}
    ]
    for gem in gemma_findings:
        if gem["hidden"]:
            overlapping = [
                r for r in kept
                if r["hidden"] and r["tier"] == "rule"
                and (_norm(gem["text"]) in _norm(r["text"]) or _norm(r["text"]) in _norm(gem["text"]))
            ]
        else:
            span = _find_span(visible, gem["text"])
            overlapping = [
                r for r, r_span in rule_spans
                if span and r_span and span[0] < r_span[1] and r_span[0] < span[1]
            ]
        if not overlapping:
            kept.append(gem)
        elif gem["hidden"]:
            weakest = overlapping[0]
            if weakest["severity"] == "low" and _SEVERITY_RANK[gem["severity"]] > _SEVERITY_RANK["low"]:
                kept[kept.index(weakest)] = gem
    return kept


# --------------------------------------------------------------------------- policy


def _removal_spans(visible: str, findings: list[dict]) -> list[tuple[int, int, str]]:
    """Spans of visible text to cut: every high finding that still has text in what a human sees."""

    spans: list[tuple[int, int, str]] = []
    for finding in findings:
        if finding["severity"] != "high":
            continue
        replacement = REMOVED_HIDDEN if finding["hidden"] else REMOVED_VISIBLE
        if finding["kind"] == "BASE64":
            for run in inject_rules.decoded_base64(visible):
                if _norm(run.decoded) == _norm(finding["text"]):
                    spans.append((run.start, run.end, replacement))
        elif finding["kind"] not in _NOT_IN_VISIBLE:
            span = _find_span(visible, finding["text"])
            if span:
                spans.append((*span, replacement))
            else:
                logger.warning("High finding %s not found in visible text; it cannot be cut out.", finding.get("id"))
    return spans


def _apply_removals(visible: str, spans: list[tuple[int, int, str]]) -> str:
    merged: list[list] = []
    for start, end, replacement in sorted(spans):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end, replacement])
    out = visible
    for start, end, replacement in reversed(merged):
        out = out[:start] + replacement + out[end:]
    return out


def _flagged_ratio(visible: str, findings: list[dict]) -> float:
    """Share of visible text covered by medium/high findings that sit in it."""

    if not visible:
        return 0.0
    covered: set[int] = set()
    for finding in findings:
        if finding["hidden"] or finding["severity"] == "low":
            continue
        span = _find_span(visible, finding["text"])
        if span:
            covered.update(range(*span))
    return len(covered) / len(visible)


def _should_quarantine(visible: str, findings: list[dict]) -> bool:
    has_tag = any(f["kind"] == "UNICODE_TAG" for f in findings)
    has_high_instruction = any(f["kind"] == "INSTRUCTION" and f["severity"] == "high" for f in findings)
    return (has_tag and has_high_instruction) or _flagged_ratio(visible, findings) > QUARANTINE_RATIO


_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)


def _page_title(content: str, content_type: str) -> str:
    """The page's <title> (shown in the browser tab), unless it carries an instruction itself."""

    if content_type != "html":
        return ""
    match = _TITLE_RE.search(content)
    title = " ".join(inject_rules.strip_invisible(match.group(1)).split()) if match else ""
    return title if title and not inject_rules.phrase_score(title) else ""


def _datamark(tool: str, content: str) -> str:
    safe_tool = tool.replace('"', "'")
    # The content must not be able to close the marker early.
    content = content.replace("<</UNTRUSTED>>", "<< /UNTRUSTED>>")
    return f'<<UNTRUSTED source="{safe_tool}">>\n{content}\n<</UNTRUSTED>>'


def scan_result(tool: str, content: str, content_type: str = "text") -> dict:
    """Scan one tool result. See docs/BUILD_PLAN.md section 2 for the contract."""

    started = time.perf_counter()
    scanned = inject_rules.scan(content, content_type)
    rules_ms = round((time.perf_counter() - started) * 1000)
    visible = scanned["visible_text"]
    findings = scanned["findings"]

    gemma_ms = 0
    gemma_used = False
    if gemma.is_loaded():
        started = time.perf_counter()
        try:
            gemma_found, gemma_used = _gemma_findings(scanned["hidden_segments"], visible)
            findings = _merge(findings, gemma_found, visible)
        except Exception:
            logger.exception("Gemma injection scan failed; continuing with rule results only.")
        gemma_ms = round((time.perf_counter() - started) * 1000)

    findings = [{**finding, "id": f"f{i}"} for i, finding in enumerate(findings, start=1)]

    if _should_quarantine(visible, findings):
        flagged = sum(1 for f in findings if f["severity"] != "low") or len(findings)
        model_text = f"[VEIL QUARANTINED this result from {tool}: {flagged} instructions found]"
        verdict = "QUARANTINED"
    else:
        spans = _removal_spans(visible, findings)
        model_text = _apply_removals(visible, spans)
        title = _page_title(content, content_type)
        if title:
            model_text = f"Page title: {title}\n\n{model_text}"
        hidden_dropped = any(f["hidden"] and f["kind"] in _NOT_IN_VISIBLE for f in findings)
        verdict = "SANITIZED" if spans or hidden_dropped else "ALLOW"

    logger.info(
        "[outer-door] %s: %s, %d finding(s) (%d by rules, %d by Gemma), Gemma %s, %d ms",
        tool, verdict, len(findings), sum(1 for f in findings if f["tier"] == "rule"),
        sum(1 for f in findings if f["tier"] == "gemma"), "used" if gemma_used else "not used", rules_ms + gemma_ms,
    )
    return {
        "verdict": verdict,
        "findings": findings,
        "content_for_model": _datamark(tool, model_text),
        "visible_text": visible,
        "timings_ms": {"rules": rules_ms, "gemma": gemma_ms},
        "gemma_used": gemma_used,
    }
