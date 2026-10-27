"""Outer door, tier 1: deterministic detection of instructions hidden in untrusted content.

`scan()` separates what a human would see from what only a model would read (CSS-hidden text,
comments, attributes, invisible Unicode, base64) and scores both for text aimed at an AI.
No model is involved; Gemma (tier 2) is layered on top by `backend/firewall.py`.
"""

from __future__ import annotations

import base64
import binascii
import re
import unicodedata
from dataclasses import dataclass
from urllib.parse import parse_qsl, urlsplit

from bs4 import BeautifulSoup
from bs4.element import Comment, Declaration, Doctype, NavigableString, ProcessingInstruction, Tag

# --------------------------------------------------------------------------- phrase scorer

# Weights: 3 = unmistakably aimed at an AI; 2 = only suspicious in context (hidden text, or
# combined with another signal in the same sentence).
STRONG = 3
SOFT = 2

_AI_NOUN = r"(?:AI|A\.I\.|LLM|artificial\s+intelligence|(?:large\s+)?language\s+model|chatbot)"
_NOUN_SUFFIX = r"(?:[\s-]+(?:assistants?|agents?|models?|systems?|bots?))?"
_READING = r"(?:reading|processing|summari[sz]ing|browsing|scanning|parsing|analy[sz]ing|installing|crawling|indexing|visiting)"
_EMAIL = r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+"
_URL = r"https?://[^\s<>\"')]+"


@dataclass(frozen=True)
class PhraseMatch:
    start: int
    end: int
    kind: str  # INSTRUCTION | ROLE_SPOOF | EXFIL_URL
    cat: str  # ai | role | exfil | soft | tool
    weight: int
    text: str
    obfuscated: bool = False  # only found after the look-alike / leetspeak folds


_I = re.IGNORECASE
_IM = re.IGNORECASE | re.MULTILINE

# (pattern, kind, category, weight)
_PHRASE_SPECS: list[tuple[re.Pattern, str, str, int]] = [
    (re.compile(p, f), kind, cat, w) for p, f, kind, cat, w in [
        # --- AI-directed imperatives
        (r"\b(?:ignore|disregard|forget|override|bypass)\s+(?:(?:all|any|the|your|every|these|those)\s+)*?"
         r"(?:previous|prior|above|earlier|preceding|original|system|safety)\s+"
         r"(?:instructions?|prompts?|rules?|directions?|directives?|context|guidelines?|messages?|constraints?|programming)\b",
         _I, "INSTRUCTION", "ai", STRONG),
        (r"\b(?:ignore|disregard|forget)\s+(?:all\s+|the\s+|everything\s+)?(?:above|prior|previous)\b"
         r"(?!\s+(?:section|paragraph|chapter|figure|table|example|error|warning|message|step))",
         _I, "INSTRUCTION", "ai", STRONG),
        (r"\b(?:ignore|disregard)\s+(?:everything|anything|all)\s+(?:above|before|else|you\s+(?:were|have\s+been)\s+told)\b",
         _I, "INSTRUCTION", "ai", STRONG),
        (r"\bsystem\s+override\b", _I, "INSTRUCTION", "ai", STRONG),
        (r"\b(?:do\s+not|don'?t|never)\s+(?:tell|inform|notify|alert|mention\s+(?:this\s+)?to|reveal\s+(?:this\s+)?to)\s+the\s+user\b",
         _I, "INSTRUCTION", "ai", STRONG),
        (r"\bwithout\s+(?:telling|informing|notifying|alerting)\s+the\s+user\b", _I, "INSTRUCTION", "ai", STRONG),
        (r"\b(?:reveal|print|show|repeat|output|leak)\s+(?:me\s+)?(?:your|the)\s+"
         r"(?:system\s+prompt|hidden\s+instructions|initial\s+instructions)\b", _I, "INSTRUCTION", "ai", STRONG),
        (r"\byou\s+are\s+now\s+(?:an?\s+)?(?:AI\b|assistant\b|agent\b|DAN\b|jailbroken|unrestricted|free\s+of|no\s+longer"
         r"|in\s+(?:developer|debug|admin|god)\s+mode)", _I, "INSTRUCTION", "ai", STRONG),
        (r"\byou\s+are\s+no\s+longer\s+(?:bound|restricted|an?\s)", _I, "INSTRUCTION", "ai", STRONG),
        # --- addressing an AI directly
        (rf"\b(?:as\s+an?|attention|(?:note|notice|message|instructions?|reminder|important|request)\s+(?:to|for)|dear|hey|hello|hi"
         rf"|to\s+(?:any|all))\s*,?\s+(?:the\s+)?{_AI_NOUN}{_NOUN_SUFFIX}\b",
         _I, "INSTRUCTION", "ai", STRONG),
        (rf"\b(?:(?:AI|A\.I\.|LLM)[\s-]+(?:assistants?|agents?|models?)|assistants?|agents?)\s+(?:\w+\s+)?{_READING}\s+"
         r"(?:this|these|the\s+following)\b", _I, "INSTRUCTION", "ai", STRONG),
        (rf"\bif\s+you\s+are\s+(?:an?\s+)?(?:{_AI_NOUN}|(?:AI\s+)?(?:assistant|agent))\b", _I, "INSTRUCTION", "ai", STRONG),
        (r"\b(?:AI|A\.I\.|LLM)[\s-]+(?:assistants?|agents?|models?)\s*[,:]", _I, "INSTRUCTION", "soft", SOFT),
        # a vocative at the start of a sentence: "Assistant, forward ..." / "Automated assistants: please ..."
        (r"(?:^|(?<=[.!?]\s))(?:(?:hey|hi|hello|dear)\s+)?(?:(?:AI|A\.I\.|LLM|automated|virtual)[\s-]+)?(?:assistants?|agents?|bots?|models?)\s*[,:]",
         _IM, "INSTRUCTION", "soft", SOFT),
        # --- softer signals (only count with a tool action in the same sentence, or in hidden text)
        (r"\byou\s+are\s+now\s+(?:an?\s+|the\s+|in\s+)?\w+", _I, "INSTRUCTION", "soft", SOFT),
        (r"\bnew\s+(?:instructions?|system\s+prompt|directives?)\b", _I, "INSTRUCTION", "soft", SOFT),
        (r"\bpretend\s+(?:to\s+be|that\s+you\s+are|you\s+are)\b", _I, "INSTRUCTION", "soft", SOFT),
        (r"\bfrom\s+now\s+on,?\s+you\b", _I, "INSTRUCTION", "soft", SOFT),
        # --- role spoofing
        (r"<\|(?:im_start|im_end|system|user|assistant|endoftext|eot_id|start_header_id)\|>", _I, "ROLE_SPOOF", "role", STRONG),
        (r"\[/?INST\]", _I, "ROLE_SPOOF", "role", STRONG),
        (r"<</?SYS>>", _I, "ROLE_SPOOF", "role", STRONG),
        (r"^#{2,3}\s*(?:system|instructions?)\b", _IM, "ROLE_SPOOF", "role", STRONG),
        (r"\bBEGIN\s+(?:SYSTEM|NEW)\s+(?:PROMPT|INSTRUCTIONS)\b", _I, "ROLE_SPOOF", "role", STRONG),
        (r"^[ \t>*-]*(?:system|assistant)\s*:\s*\S", _IM, "ROLE_SPOOF", "soft", SOFT),
        # --- tool-aimed actions
        (rf"\b(?:send|forward|email|e-?mail|mail|upload|post|transmit|exfiltrate|submit)\b(?:[^.\n]|\.(?!\s)){{0,120}}?"
         rf"\bto\s+<?(?:{_EMAIL}|{_URL})", _I, "EXFIL_URL", "tool", SOFT),
        (r"\b(?:run|execute|exec|invoke)\s+(?:the\s+|this\s+)?(?:following\s+)?(?:shell\s+)?(?:command|script|code)s?\b",
         _I, "EXFIL_URL", "tool", SOFT),
        (r"\bcurl\b[^\n|]{0,200}\|\s*(?:sudo\s+)?(?:ba|z)?sh\b|\bwget\s+\S+|\brm\s+-(?:rf|fr)\b|\b(?:ba)?sh\s+-c\b"
         r"|\bchmod\s+\+x\b|\bnc\s+-e\b|\bcurl\s+(?:-\w+\s+)*https?://\S+", _I, "EXFIL_URL", "tool", SOFT),
        (r"\b(?:read|open|cat|print|show|dump|reveal|include|attach|copy)\s+(?:out\s+)?(?:the\s+|its\s+|your\s+)?"
         r"(?:contents?\s+of\s+)?(?:the\s+)?(?:file\s+)?\S*(?:\.env\b|credentials?\b|id_rsa|\.ssh|secrets?\b|api[_\- ]?keys?\b|passwords?\b)",
         _I, "EXFIL_URL", "tool", SOFT),
        (r"\b(?:run_shell|send_email|read_file|fetch_page|read_inbox|read_email)\b", _I, "EXFIL_URL", "tool", SOFT),
        # --- markdown image that smuggles data out in its URL (checked by _suspicious_url)
        (r"!\[[^\]]*\]\(\s*https?://[^)\s]+[^)]*\)", _I, "EXFIL_URL", "exfil", STRONG),
    ]
]

_EXFIL_KEYS = {
    "d", "data", "q", "query", "secret", "key", "token", "payload", "content", "c", "msg", "message", "leak",
    "exfil", "info", "text", "history", "conversation", "chat", "summary", "email", "apikey", "api_key", "password", "pw",
}
_PLACEHOLDER_URL_RE = re.compile(r"\{|\}|\[|\]|<|>|%7b|%5b|%3c", re.IGNORECASE)


def _suspicious_url(markdown_image: str) -> bool:
    """A markdown image is an exfil channel when its query carries data or template placeholders."""

    match = re.search(r"\((?P<url>[^)]+)\)", markdown_image)
    if not match:
        return False
    url = match.group("url").strip().split()[0]
    query = urlsplit(url).query
    if not query:
        return False
    if _PLACEHOLDER_URL_RE.search(query):
        return True
    return any(
        key.lower() in _EXFIL_KEYS and not re.fullmatch(r"[\d.]*", value)
        for key, value in parse_qsl(query, keep_blank_values=True)
    )


def _raw_matches(text: str) -> dict[tuple[int, int], PhraseMatch]:
    found: dict[tuple[int, int], PhraseMatch] = {}
    for pattern, kind, cat, weight in _PHRASE_SPECS:
        for m in pattern.finditer(text):
            if cat == "exfil" and not _suspicious_url(m.group(0)):
                continue
            key = (m.start(), m.end())
            if key not in found or found[key].weight < weight:
                found[key] = PhraseMatch(m.start(), m.end(), kind, cat, weight, m.group(0))
    return found


def phrase_matches(text: str) -> list[PhraseMatch]:
    """Every AI-directed phrase in `text`, ordered by position.

    The rules also run over the folds of `text` (look-alike letters, leetspeak, hidden characters).
    A fold-only match is reported at its span in the original text and flagged `obfuscated`.
    """

    found = _raw_matches(text)
    for folded, index in _fold_maps(text):
        for (start, end), m in _raw_matches(folded).items():
            key = (index[start], index[end - 1] + 1)
            if key not in found:
                found[key] = PhraseMatch(*key, m.kind, m.cat, m.weight, text[key[0]:key[1]], True)
    return sorted(found.values(), key=lambda p: (p.start, p.end))


def phrase_score(text: str) -> int:
    """Sum of phrase weights in `text`; 0 means nothing aimed at an AI was found."""

    return sum(m.weight for m in phrase_matches(text))


# Visible text only counts when it is addressed to an AI. Quoting or discussing prompt injection
# does not: those are guarded below. Hidden text gets no such benefit of the doubt.
_QUOTE_PAIRS = [('"', '"'), ("\u201c", "\u201d"), ("\u2018", "\u2019"), ("\u00ab", "\u00bb"), ("\u201e", "\u201c"), ("`", "`")]
_DISCUSSION_RE = re.compile(
    r"\battackers?\b|\bhackers?\b|\bmalicious\b|\bfor\s+(?:example|instance)\b|\bsuch\s+as\b|\be\.g\.|\bknown\s+as\b"
    r"|\bso-called\b|\bphrases?\s+like\b|\bresearchers?\b|\bprompt[\s-]injections?\b|\binjection\s+attacks?\b|\bjailbreak"
    r"|\b(?:might|may|could|can|will|would)\s+(?:say|write|read|contain|include|hide|embed)\b|\bexamples?\s+of\b|\bOWASP\b"
    r"|\bin\s+the\s+wild\b",
    re.IGNORECASE,
)
_SENT_END = re.compile(r"[.!?](?=\s|$)|\n")


def _sentence_bounds(text: str, start: int, end: int) -> tuple[int, int]:
    left = 0
    for m in _SENT_END.finditer(text, 0, start):
        left = m.end()
    m = _SENT_END.search(text, end)
    right = len(text) if m is None else (m.end() if m.group(0) != "\n" else m.start())
    while left < right and text[left].isspace():
        left += 1
    return left, right


def _is_quoted(text: str, start: int, end: int) -> bool:
    line_start = text.rfind("\n", 0, start) + 1
    line_end = text.find("\n", end)
    before = text[line_start:start]
    after = text[end:line_end if line_end >= 0 else len(text)]
    for opener, closer in _QUOTE_PAIRS:
        if opener == closer:
            if before.count(opener) % 2 == 1 and closer in after:
                return True
        elif before.rfind(opener) > before.rfind(closer) and closer in after:
            return True
    return before.rstrip().endswith("'") and "'" in after


_ADDRESS_RE = re.compile(rf"{_EMAIL}|{_URL}")


def _is_discussion(text: str, start: int, end: int) -> bool:
    left, right = _sentence_bounds(text, start, end)
    previous_left, _ = _sentence_bounds(text, max(left - 1, 0), max(left - 1, 0))
    # "attacker@evil.test" is an address, not a discussion of attackers.
    return bool(_DISCUSSION_RE.search(_ADDRESS_RE.sub(" ", text[previous_left:right])))


def _aimed_at_ai(matches: list[PhraseMatch]) -> bool:
    cats = {m.cat for m in matches}
    return any(m.weight >= STRONG for m in matches) or ("soft" in cats and "tool" in cats)


@dataclass
class _Hit:
    start: int
    end: int
    kind: str
    exfil: bool = False  # contains a data-carrying markdown image
    obfuscated: bool = False  # it only counts as orders because of fold-only matches


def _visible_hits(text: str) -> list[_Hit]:
    """Spans of visible text that give orders to an AI (quoted or discussed examples excluded)."""

    groups: dict[tuple[int, int], list[PhraseMatch]] = {}
    for m in phrase_matches(text):
        if m.weight >= STRONG and (_is_quoted(text, m.start, m.end) or _is_discussion(text, m.start, m.end)):
            continue
        groups.setdefault(_sentence_bounds(text, m.start, m.end), []).append(m)

    hits: list[_Hit] = []
    for (_, right), matches in sorted(groups.items()):
        if not _aimed_at_ai(matches):
            continue
        start = min(m.start for m in matches)
        end = right if any(m.cat != "exfil" for m in matches) else max(m.end for m in matches)
        exfil = any(m.cat == "exfil" for m in matches)
        kinds = {m.kind for m in matches if m.cat != "tool"}
        kind = "EXFIL_URL" if exfil else "ROLE_SPOOF" if "ROLE_SPOOF" in kinds else "INSTRUCTION"
        obfuscated = not _aimed_at_ai([m for m in matches if not m.obfuscated])
        if hits and not text[hits[-1].end:start].strip() and hits[-1].kind == kind:
            hits[-1].end = max(hits[-1].end, end)
            hits[-1].exfil = hits[-1].exfil or exfil
            hits[-1].obfuscated = hits[-1].obfuscated and obfuscated
        else:
            hits.append(_Hit(start, max(end, start), kind, exfil, obfuscated))
    return hits


# --------------------------------------------------------------------------- invisible Unicode

_ZERO_WIDTH = "\u200b\u200c\u200d\u2060\ufeff"
_BIDI = "\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069"
_TAG_RANGE = "\U000e0000-\U000e007f"
_ZERO_WIDTH_RE = re.compile(f"[{_ZERO_WIDTH}]")
_BIDI_RE = re.compile(f"[{_BIDI}]")
_TAG_RUN_RE = re.compile(f"[{_TAG_RANGE}]+")
_VS_RANGE = "\ufe00-\ufe0f\U000e0100-\U000e01ef"
_VS_RUN_RE = re.compile(f"[{_VS_RANGE}]{{8,}}")
_INVISIBLE_RE = re.compile(f"[{_ZERO_WIDTH}{_BIDI}{_TAG_RANGE}]|[{_VS_RANGE}]{{8,}}")
_RTL_RE = re.compile("[\u0590-\u08ff\ufb1d-\ufdff\ufe70-\ufefe]")
CLUSTER_GAP = 40


def strip_invisible(text: str) -> str:
    """Remove zero-width, bidi-control and Unicode tag characters, and runs of 8+ variation selectors
    (one or two selectors are normal emoji styling and stay)."""

    return _INVISIBLE_RE.sub("", text)


# --------------------------------------------------------------------------- normalisation folds

# Look-alike Cyrillic/Greek letters -> the Latin letter they imitate.
_HOMOGLYPHS = str.maketrans(dict(zip(
    "\u0430\u0435\u043e\u0440\u0441\u0445\u0443\u0456\u0458\u0455\u0501\u04bb\u051b\u051d\u0410\u0412\u0415\u041a\u041c\u041d\u041e\u0420\u0421\u0422\u0425\u0423\u0406\u0408\u0405"
    "\u03bf\u03b1\u03b5\u03bd\u03b9\u03ba\u03c1\u03c4\u03c5\u03c7\u0391\u0392\u0395\u0396\u0397\u0399\u039a\u039c\u039d\u039f\u03a1\u03a4\u03a5\u03a7",
    "aeopcxyijsdhqwABEKMHOPCTXYIJS"
    "oaevikptuxABEZHIKMNOPTYX",
)))
_LEET = str.maketrans({"0": "o", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s"})
_LEET_TOKEN_RE = re.compile(r"[A-Za-z0-9@$]+")
_LEET_CHARS = frozenset("013457@$")
_FOLD_DROP_RE = re.compile(f"[{_ZERO_WIDTH}{_BIDI}{_TAG_RANGE}{_VS_RANGE}\u00ad]")


def _leet(base: str, one: str) -> str:
    """Leetspeak fold, applied only to tokens that mix letters with leet characters (so prices, versions,
    phone numbers and e-mail addresses are left alone). Always one character out per character in."""

    def token(m: re.Match) -> str:
        word = m.group(0)
        leet = sum(ch in _LEET_CHARS for ch in word)
        if not leet or not any(ch.isalpha() for ch in word) or leet * 2 > len(word):
            return word
        return word.translate(_LEET).replace("1", one)

    return _LEET_TOKEN_RE.sub(token, base)


def _fold_maps(text: str) -> list[tuple[str, list[int]]]:
    """Distinct folds of `text` that differ from it, each with a map from fold index to original index."""

    chars: list[str] = []
    index: list[int] = []
    for i, ch in enumerate(text):
        if _FOLD_DROP_RE.match(ch):
            continue
        for c in unicodedata.normalize("NFKC", ch).translate(_HOMOGLYPHS):
            chars.append(c)
            index.append(i)
    base = "".join(chars)
    out: list[tuple[str, list[int]]] = []
    seen = {text}
    for candidate in (base, _leet(base, "i"), _leet(base, "l")):
        if candidate not in seen:
            seen.add(candidate)
            out.append((candidate, index))
    return out


def folds(text: str) -> list[str]:
    """Normalised spellings of `text` that the phrase rules are also run over: invisible characters
    (zero-width, bidi, tags, variation selectors) removed, look-alike Cyrillic/Greek letters and fullwidth
    forms mapped to Latin, and leetspeak undone ("ign0re" -> "ignore")."""

    return [folded for folded, _ in _fold_maps(text)]


def _decode_variation_selectors(run: str) -> str:
    data = bytes(ord(ch) - 0xFE00 if ord(ch) <= 0xFE0F else ord(ch) - 0xE0100 + 16 for ch in run)
    return "".join(ch for ch in data.decode("utf-8", errors="ignore") if ch.isprintable() or ch in "\t\n").strip()


def _decode_tags(run: str) -> str:
    chars = []
    for ch in run:
        code = ord(ch) - 0xE0000
        if 0x20 <= code <= 0x7E:
            chars.append(chr(code))
        elif code in (0x09, 0x0A):
            chars.append(" ")
    return "".join(chars).strip()


def _legit_joiner(raw: str, i: int) -> bool:
    """ZWJ/ZWNJ between letters or emoji of non-Latin scripts (Indic, Arabic, emoji) is normal text."""

    if raw[i] not in "\u200c\u200d" or i == 0:
        return False
    following = raw[i + 1:i + 2]
    return ord(raw[i - 1]) >= 0x0600 and (not following or ord(following) >= 0x0600 or not following.isalnum())


def _within_text_node(raw: str, start: int, end: int) -> tuple[int, int]:
    """Clamp a span to the text between HTML tags so it never swallows markup."""

    while start < end and (raw[start].isspace() or raw[start] == "<"):
        if raw[start] == "<":
            close = raw.find(">", start, end)
            if close < 0:
                break
            start = close + 1
        else:
            start += 1
    tag_end = raw.rfind(">", 0, start)
    if tag_end >= 0 and raw.find("<", tag_end, start) == -1:
        start = max(start, tag_end + 1)
    next_tag = raw.find("<", start, end)
    return start, end if next_tag < 0 else next_tag


def _clusters(positions: list[int]) -> list[tuple[int, int]]:
    spans: list[list[int]] = []
    for pos in positions:
        if spans and pos - spans[-1][1] <= CLUSTER_GAP:
            spans[-1][1] = pos
        else:
            spans.append([pos, pos])
    return [(a, b + 1) for a, b in spans]


# --------------------------------------------------------------------------- base64

_BASE64_RE = re.compile(r"(?<![A-Za-z0-9+/=])[A-Za-z0-9+/]{24,}={0,2}(?![A-Za-z0-9+/])")


@dataclass(frozen=True)
class Base64Run:
    start: int
    end: int
    token: str
    decoded: str


def decoded_base64(text: str) -> list[Base64Run]:
    """Base64 runs (>= 24 chars) in `text` that decode to at least 85% printable ASCII."""

    runs = []
    for m in _BASE64_RE.finditer(text):
        token = m.group(0).rstrip("=")
        token += "=" * (-len(token) % 4)
        try:
            data = base64.b64decode(token, validate=True)
        except (binascii.Error, ValueError):
            continue
        if len(data) < 8:
            continue
        printable = sum(1 for b in data if 32 <= b <= 126 or b in (9, 10, 13))
        if printable / len(data) < 0.85:
            continue
        decoded = "".join(ch for ch in data.decode("utf-8", errors="replace") if ch.isprintable() or ch in "\t\n")
        if sum(ch.isalpha() for ch in decoded) < len(decoded) * 0.5:
            continue
        runs.append(Base64Run(m.start(), m.end(), m.group(0), decoded.strip()))
    return runs


# --------------------------------------------------------------------------- colour and CSS helpers

_NAMED_COLORS = {
    "white": (255, 255, 255), "black": (0, 0, 0), "snow": (255, 250, 250), "ivory": (255, 255, 240),
    "whitesmoke": (245, 245, 245), "ghostwhite": (248, 248, 255), "floralwhite": (255, 250, 240),
    "aliceblue": (240, 248, 255), "lightgray": (211, 211, 211), "lightgrey": (211, 211, 211),
    "silver": (192, 192, 192), "gray": (128, 128, 128), "grey": (128, 128, 128), "red": (255, 0, 0),
    "blue": (0, 0, 255), "navy": (0, 0, 128), "green": (0, 128, 0), "yellow": (255, 255, 0),
}
_COLOR_TOKEN_RE = re.compile(r"#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|[a-z]+", re.IGNORECASE)
_UNKNOWN_BG = "unknown"
_DEFAULT_BG = (255, 255, 255, 1.0)
_COLOR_NEAR = 16


def _parse_color(value: str):
    """Return (r, g, b, alpha) or None when the value is not a colour we understand."""

    value = value.strip().lower()
    if value == "transparent":
        return (0, 0, 0, 0.0)
    if value in _NAMED_COLORS:
        return (*_NAMED_COLORS[value], 1.0)
    if value.startswith("#"):
        digits = value[1:]
        if len(digits) in (3, 4):
            digits = "".join(ch * 2 for ch in digits)
        if len(digits) not in (6, 8) or not re.fullmatch(r"[0-9a-f]+", digits):
            return None
        alpha = int(digits[6:8], 16) / 255 if len(digits) == 8 else 1.0
        return (int(digits[0:2], 16), int(digits[2:4], 16), int(digits[4:6], 16), alpha)
    m = re.fullmatch(r"rgba?\(([^)]*)\)", value)
    if m:
        parts = [p for p in re.split(r"[\s,/]+", m.group(1).strip()) if p]
        if len(parts) < 3:
            return None
        try:
            channels = [round(float(p[:-1]) * 2.55) if p.endswith("%") else round(float(p)) for p in parts[:3]]
            alpha = 1.0
            if len(parts) > 3:
                alpha = float(parts[3][:-1]) / 100 if parts[3].endswith("%") else float(parts[3])
        except ValueError:
            return None
        return (*[min(max(c, 0), 255) for c in channels], alpha)
    return None


def _first_color(value: str):
    for token in _COLOR_TOKEN_RE.findall(value):
        color = _parse_color(token)
        if color is not None:
            return color
    return None


def _parse_declarations(css: str) -> dict[str, str]:
    props: dict[str, str] = {}
    for declaration in css.split(";"):
        key, sep, value = declaration.partition(":")
        if sep:
            props[key.strip().lower()] = re.sub(r"\s*!important\s*$", "", value.strip(), flags=re.IGNORECASE).lower()
    return props


_LENGTH_RE = re.compile(r"^(-?\d*\.?\d+)\s*(px|pt|em|rem|%|vw|vh)?$")
_PX_PER_UNIT = {None: 1.0, "px": 1.0, "pt": 1.333, "em": 16.0, "rem": 16.0, "%": 19.2, "vw": 19.2, "vh": 10.8}


def _to_px(value: str | None) -> float | None:
    if value is None:
        return None
    m = _LENGTH_RE.match(value.strip())
    return float(m.group(1)) * _PX_PER_UNIT[m.group(2)] if m else None


_CLEAR_CLIP_RE = re.compile(r"rect\(\s*(?:0|1px)(?:px)?[\s,]+(?:0|1px)(?:px)?[\s,]+(?:0|1px)(?:px)?[\s,]+(?:0|1px)(?:px)?\s*\)")
_CLIP_PATH_RE = re.compile(r"inset\(\s*(?:50|100)%|circle\(\s*0")
_SCALE_ZERO_RE = re.compile(r"scale\(\s*0(?:\.0+)?\s*\)")
_OFFSCREEN_PX = -500


def _concealment_reason(style: dict[str, str]) -> str | None:
    """Why inline/stylesheet properties hide an element from a human, or None."""

    if style.get("display") == "none":
        return "display:none text"
    if style.get("visibility") in {"hidden", "collapse"}:
        return "visibility:hidden text"
    opacity = style.get("opacity")
    if opacity:
        try:
            if float(opacity.rstrip("%")) / (100 if opacity.endswith("%") else 1) < 0.1:
                return "near-zero opacity text"
        except ValueError:
            pass
    size = _to_px(style.get("font-size"))
    if size is not None and size <= 2:
        return "tiny font text"
    if _SCALE_ZERO_RE.search(style.get("transform", "")):
        return "scaled-to-zero text"
    clip = style.get("clip", "")
    if _CLEAR_CLIP_RE.search(clip) or _CLIP_PATH_RE.search(style.get("clip-path", "")):
        return "clipped-away text"
    indent = _to_px(style.get("text-indent"))
    if indent is not None and indent <= _OFFSCREEN_PX:
        return "off-screen text"
    positioned = style.get("position") in {"absolute", "fixed", "relative"}
    for key in ("left", "top", "right", "bottom", "margin-left", "margin-top"):
        offset = _to_px(style.get(key))
        if offset is not None and offset <= _OFFSCREEN_PX and (positioned or key.startswith("margin")):
            return "off-screen text"
    clipped = any(style.get(k) in {"hidden", "clip"} for k in ("overflow", "overflow-x", "overflow-y"))
    if clipped:
        for key in ("height", "max-height", "width", "max-width"):
            extent = _to_px(style.get(key))
            if extent is not None and extent <= 1:
                return "zero-size clipped text"
    color = style.get("color")
    if color:
        parsed = _parse_color(color)
        if parsed and parsed[3] < 0.1:
            return "transparent text"
    return None


@dataclass
class _Rule:
    tag: str
    classes: tuple[str, ...]
    ident: str
    specificity: int
    props: dict[str, str]


_SELECTOR_RE = re.compile(r"^([a-z][a-z0-9]*)?((?:[.#][\w-]+)*)$")
_CSS_BLOCK_RE = re.compile(r"([^{}]+)\{([^{}]*)\}")
_CSS_COMMENT_RE = re.compile(r"/\*.*?\*/", re.DOTALL)


def _parse_stylesheets(soup: BeautifulSoup) -> list[_Rule]:
    """Parse simple `.class`, `#id`, `tag` and `tag.class` rules from <style> blocks."""

    rules: list[_Rule] = []
    for style in soup.find_all("style"):
        css = _CSS_COMMENT_RE.sub("", style.string or style.get_text())
        for selectors, body in _CSS_BLOCK_RE.findall(css):
            props = _parse_declarations(body)
            for selector in selectors.split(","):
                m = _SELECTOR_RE.match(selector.strip().lower())
                if not m or not selector.strip():
                    continue
                tag, rest = m.group(1) or "", m.group(2)
                classes = tuple(re.findall(r"\.([\w-]+)", rest))
                ids = re.findall(r"#([\w-]+)", rest)
                rules.append(_Rule(tag, classes, ids[0] if ids else "", 100 * len(ids) + 10 * len(classes) + (1 if tag else 0), props))
    return rules


def _rule_matches(rule: _Rule, el: Tag) -> bool:
    if rule.tag and rule.tag != el.name.lower():
        return False
    classes = {c.lower() for c in (el.get("class") or [])}
    if not set(rule.classes) <= classes:
        return False
    return not rule.ident or rule.ident == str(el.get("id", "")).lower()


def _background(style: dict[str, str], el: Tag):
    """Background colour declared on this element: (r,g,b,a), _UNKNOWN_BG, or None if not declared."""

    image = style.get("background-image", "none")
    shorthand = style.get("background", "")
    if (image and image != "none") or "url(" in shorthand or "gradient(" in shorthand:
        return _UNKNOWN_BG
    for value in (style.get("background-color"), shorthand, el.get("bgcolor")):
        if value:
            color = _first_color(str(value))
            if color and color[3] >= 0.1:
                return color
    return None


def _near(a, b) -> bool:
    return all(abs(x - y) <= _COLOR_NEAR for x, y in zip(a[:3], b[:3]))


# --------------------------------------------------------------------------- HTML extraction

_HTML_RE = re.compile(
    r"<\s*/?\s*(?:html|head|body|div|span|p|a|img|table|tr|td|th|ul|ol|li|br|hr|style|script|meta|noscript|template|"
    r"h[1-6]|font|b|i|u|em|strong|section|article|aside|footer|header|nav|main|input|button|form|svg|title|link|pre|"
    r"code|blockquote|label|center|small|sup|sub|iframe)\b[^>]*>",
    re.IGNORECASE,
)
_COMMENT_RE = re.compile(r"<!--(.*?)-->", re.DOTALL)

_LINE_BREAK = "\x01"
_PARA_BREAK = "\x02"
_PARA_TAGS = {
    "address", "article", "aside", "blockquote", "center", "details", "dl", "fieldset", "figure", "footer", "form",
    "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "main", "nav", "ol", "p", "pre", "section", "table", "ul",
}
_LINE_TAGS = {"body", "br", "dd", "div", "dt", "figcaption", "html", "li", "option", "summary", "tr"}
_NOT_RENDERED = {"script", "style", "head", "title", "meta", "link", "base"}
_STRUCTURAL_HIDDEN = {"noscript": "noscript content", "template": "template content"}
_SKIP_STRINGS = (Comment, Doctype, Declaration, ProcessingInstruction)

MIN_HIDDEN_CHARS = 12  # shorter concealed snippets ("Menu", "Close") are not worth a finding
LONG_HIDDEN_CHARS = 120  # structural hidden text (aria-hidden, noscript...) is only odd when this long
LONG_ATTR_CHARS = 120
LONG_COMMENT_CHARS = 60
LONG_COMMENT_WORDS = 8


@dataclass
class _Rec:
    kind: str
    text: str
    severity: str
    reason: str
    hidden: bool
    pos: int = -1
    segment: bool = False  # carries text a model could read that a human cannot


def _squash(text: str) -> str:
    return " ".join(strip_invisible(text).split())


OBFUSCATED_NOTE = "obfuscated (look-alike letters / leetspeak)"


def _orders_reason(text: str, reason: str) -> str | None:
    """`reason` when `text` gives AI orders (with a note when only the folds reveal it), else None."""

    matches = phrase_matches(text)
    if not matches:
        return None
    return f"{reason}; {OBFUSCATED_NOTE}" if all(m.obfuscated for m in matches) else reason


def _all_text(node: Tag) -> str:
    parts: list[str] = []

    def collect(parent: Tag) -> None:
        for child in parent.children:
            if isinstance(child, _SKIP_STRINGS):
                continue
            if isinstance(child, NavigableString):
                parts.append(str(child))
            elif isinstance(child, Tag) and child.name.lower() not in {"script", "style"}:
                collect(child)

    collect(node)
    return _squash(" ".join(parts))


@dataclass
class _State:
    color: tuple | None  # inherited text colour; None = browser default (black)
    bg: object  # inherited background: (r,g,b,a) or _UNKNOWN_BG
    pre: bool = False


class _HtmlScanner:
    def __init__(self, raw: str):
        self.raw = raw
        self.soup = BeautifulSoup(raw, "html.parser")
        self.rules = _parse_stylesheets(self.soup)
        self.parts: list[str] = []
        self.recs: list[_Rec] = []

    def run(self) -> tuple[str, list[_Rec]]:
        for meta in self.soup.find_all("meta"):
            name = str(meta.get("name") or meta.get("property") or "").lower()
            if name in {"description", "keywords", "og:description"}:
                self._add(_attribute_rec(str(meta.get("content") or ""), length_rule=False))
        # External stylesheets can set any colour, so only assume a white page when none is linked.
        external_css = any("stylesheet" in " ".join(link.get("rel") or []).lower() for link in self.soup.find_all("link"))
        self._children(self.soup, _State(None, _UNKNOWN_BG if external_css else _DEFAULT_BG))
        return _normalise_visible(self.parts), self.recs

    def _add(self, rec: _Rec | None) -> None:
        if rec:
            self.recs.append(rec)

    # -- walking

    def _children(self, parent, state: _State) -> None:
        for child in parent.children:
            if isinstance(child, Comment):
                self._add(_comment_rec(str(child)))
            elif isinstance(child, _SKIP_STRINGS):
                continue
            elif isinstance(child, NavigableString):
                self._text(str(child), state)
            elif isinstance(child, Tag):
                self._element(child, state)

    def _text(self, text: str, state: _State) -> None:
        """A text node: visible unless its inherited colour is indistinguishable from its background."""

        if text.strip() and state.bg != _UNKNOWN_BG and _near(state.color or (0, 0, 0, 1.0), state.bg):
            self._add(_hidden_rec(_squash(text), "text matches background colour", False))
            return
        self.parts.append(text if state.pre else re.sub(r"\s+", " ", text))

    def _element(self, el: Tag, state: _State) -> None:
        name = el.name.lower()
        if name in _NOT_RENDERED:
            return
        style = self._style(el)
        color = _first_color(style["color"]) if "color" in style else None
        if color is None and name == "font" and el.get("color"):
            color = _first_color(str(el.get("color")))
        bg = _background(style, el)
        eff_color = color if color is not None else state.color
        eff_bg = bg if bg is not None else state.bg

        declared = (color is not None or bg is not None) and not self._overrides_colour(el)
        reason, structural = self._hidden_reason(el, name, style, eff_color, eff_bg, declared)
        if reason:
            self._add(_hidden_rec(_all_text(el), reason, structural))
            return

        for attr in ("alt", "title", "aria-label"):
            if el.get(attr):
                self._add(_attribute_rec(str(el.get(attr)), length_rule=True))

        brk = _PARA_BREAK if name in _PARA_TAGS else _LINE_BREAK if name in _LINE_TAGS else ""
        if not brk:
            display = style.get("display", "").split(" ")[0].strip().lower()
            if display in {"block", "flex", "grid", "list-item", "table", "table-row"}:
                brk = _LINE_BREAK
            elif name in {"a", "button", "label"} or display.startswith("inline-"):
                # Links, buttons and inline blocks sit apart on screen; keep their words apart too.
                brk = " "
        self.parts.append(brk)
        if name == "q":
            self.parts.append("\u201c")
        self._children(el, _State(eff_color, eff_bg, state.pre or name == "pre"))
        if name == "q":
            self.parts.append("\u201d")
        self.parts.append(brk or (" " if name in {"td", "th"} else ""))

    def _overrides_colour(self, el: Tag) -> bool:
        """True when a descendant sets its own colours, so this element's colours say nothing about its text."""

        for child in el.find_all(True):
            style = self._style(child)
            if "color" in style or child.get("color") or child.get("bgcolor") or _background(style, child) is not None:
                return True
        return False

    def _style(self, el: Tag) -> dict[str, str]:
        merged: dict[str, str] = {}
        for rule in sorted((r for r in self.rules if _rule_matches(r, el)), key=lambda r: r.specificity):
            merged.update(rule.props)
        merged.update(_parse_declarations(str(el.get("style") or "")))
        return merged

    @staticmethod
    def _hidden_reason(el: Tag, name: str, style: dict[str, str], color, bg, declared: bool) -> tuple[str | None, bool]:
        if el.has_attr("hidden"):
            return "hidden attribute text", True
        if str(el.get("aria-hidden", "")).lower() == "true":
            return "aria-hidden text", True
        if name in _STRUCTURAL_HIDDEN:
            return _STRUCTURAL_HIDDEN[name], True
        reason = _concealment_reason(style)
        if reason:
            return reason, False
        if declared and bg != _UNKNOWN_BG and _near(color or (0, 0, 0, 1.0), bg):
            return "text matches background colour", False
        return None, False


def _hidden_rec(text: str, reason: str, structural: bool) -> _Rec | None:
    if not text:
        return None
    if reason_high := _orders_reason(text, "hidden text gives AI orders"):
        return _Rec("HIDDEN_CSS", text, "high", reason_high, True, segment=True)
    if len(text) >= (LONG_HIDDEN_CHARS if structural else MIN_HIDDEN_CHARS):
        return _Rec("HIDDEN_CSS", text, "low", reason, True, segment=True)
    return None


def _comment_rec(comment: str) -> _Rec | None:
    text = _squash(comment)
    if not text:
        return None
    if reason_high := _orders_reason(text, "comment gives AI orders"):
        return _Rec("COMMENT", text, "high", reason_high, True, segment=True)
    if len(text) >= LONG_COMMENT_CHARS and len(text.split()) >= LONG_COMMENT_WORDS:
        return _Rec("COMMENT", text, "low", "long HTML comment", True, segment=True)
    return None


def _attribute_rec(value: str, length_rule: bool) -> _Rec | None:
    text = _squash(value)
    if not text:
        return None
    if reason_high := _orders_reason(text, "attribute text gives AI orders"):
        return _Rec("ATTR", text, "high", reason_high, True, segment=True)
    if length_rule and len(text) > LONG_ATTR_CHARS:
        return _Rec("ATTR", text, "low", "unusually long attribute text", True, segment=True)
    return None


_BREAK_RUN_RE = re.compile(r"[ \t\r\f\v\x01\x02]*[\x01\x02][ \t\r\f\v\x01\x02]*")


def _normalise_visible(parts: list[str]) -> str:
    text = strip_invisible("".join(parts)).replace("\u00a0", " ")
    text = _BREAK_RUN_RE.sub(lambda m: "\n\n" if _PARA_BREAK in m.group(0) else "\n", text)
    lines = [re.sub(r"[ \t\r\f\v]+", " ", line).strip() for line in text.split("\n")]
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


# --------------------------------------------------------------------------- scan


def _locate(raw: str, text: str) -> tuple[int, str]:
    """Position of `text` in `raw`, tolerant of whitespace differences. (-1, text) if absent."""

    idx = raw.find(text)
    if idx >= 0:
        return idx, text
    words = text.split()
    if words:
        m = re.search(r"\s+".join(re.escape(w) for w in words), raw)
        if m:
            return m.start(), m.group(0)
    return -1, text


def _unicode_recs(raw: str) -> list[_Rec]:
    recs: list[_Rec] = []

    for m in _TAG_RUN_RE.finditer(raw):
        decoded = _decode_tags(m.group(0))
        if decoded:
            recs.append(_Rec("UNICODE_TAG", decoded, "high", "invisible Unicode tag characters", True, m.start(), True))

    # "Sneaky bits": a run of variation selectors carries one byte per selector.
    for m in _VS_RUN_RE.finditer(raw):
        decoded = _decode_variation_selectors(m.group(0))
        why = _orders_reason(decoded, "variation selectors hide AI orders") if decoded else None
        if why:
            recs.append(_Rec("VARIATION_SELECTOR", decoded, "high", why, True, m.start(), True))
        else:
            recs.append(_Rec("VARIATION_SELECTOR", decoded or f"[{len(m.group(0))} variation selectors]", "low",
                             "run of invisible variation selectors (possible hidden data)", True, m.start(), True))

    zero_width = [
        m.start() for m in _ZERO_WIDTH_RE.finditer(raw)
        if not (m.start() == 0 and raw[0] == "\ufeff") and not _legit_joiner(raw, m.start())
    ]
    bidi = [
        m.start() for m in _BIDI_RE.finditer(raw)
        if not _RTL_RE.search(raw[max(0, m.start() - 40):m.start() + 40])
    ]
    for kind, positions, low_reason, high_reason in (
        ("ZERO_WIDTH", zero_width, "zero-width characters in text", "zero-width characters hide AI orders"),
        ("BIDI", bidi, "bidirectional control characters", "bidi controls hide AI orders"),
    ):
        for start, end in _clusters(positions):
            window = strip_invisible(raw[max(0, start - 120):end + 120])
            aimed = bool(_visible_hits(window))
            if aimed:
                left, right = _sentence_bounds(raw, start, end)
                start, end = max(left, start - 200), min(right, end + 200)
            else:
                while start > 0 and not raw[start - 1].isspace() and end - start < 200:
                    start -= 1
                while end < len(raw) and not raw[end].isspace() and end - start < 200:
                    end += 1
            start, end = _within_text_node(raw, start, end)
            recs.append(_Rec(kind, raw[start:end], "high" if aimed else "low", high_reason if aimed else low_reason, True, start))
    return recs


def _base64_recs(raw: str) -> list[_Rec]:
    recs = []
    for run in decoded_base64(strip_invisible(raw)):
        if not run.decoded:
            continue
        why = _orders_reason(run.decoded, "base64 hides AI orders")
        severity, why = ("high", why) if why else ("low", "base64 text decodes to ASCII")
        recs.append(_Rec("BASE64", run.decoded, severity, why, True, raw.find(run.token), True))
    return recs


_DECODED_KINDS = {"UNICODE_TAG", "BASE64", "VARIATION_SELECTOR"}
_VISIBLE_REASONS = {
    "INSTRUCTION": "text addresses AI with orders",
    "ROLE_SPOOF": "fake system or role marker",
    "EXFIL_URL": "image URL can leak data",
}


def _visible_recs(visible: str) -> list[_Rec]:
    recs = []
    for hit in _visible_hits(visible):
        text = visible[hit.start:hit.end].strip()
        if text:
            # A data-carrying markdown image is an attack by construction; other plain-sight orders are
            # medium because the gate (and Gemma) make the final call.
            severity = "high" if hit.exfil else "medium"
            reason = _VISIBLE_REASONS[hit.kind] + (f"; {OBFUSCATED_NOTE}" if hit.obfuscated else "")
            recs.append(_Rec(hit.kind, text, severity, reason, False))
    return recs


def _scan_plain(raw: str) -> tuple[str, list[_Rec]]:
    recs = [rec for m in _COMMENT_RE.finditer(raw) if (rec := _comment_rec(m.group(1)))]
    return strip_invisible(_COMMENT_RE.sub("", raw)), recs


def scan(content: str, content_type: str = "text") -> dict:
    """Split `content` into what a human sees and what only a model would read.

    Returns {"visible_text": str, "hidden_segments": [{"kind", "text"}], "findings": [Finding]}.
    `content_type` is "html", "text" or "email"; anything that looks like HTML is parsed as HTML.
    """

    raw = content if isinstance(content, str) else ("" if content is None else str(content))
    if content_type == "html" or _HTML_RE.search(raw):
        try:
            visible, recs = _HtmlScanner(raw).run()
        except Exception:  # malformed markup must never take the firewall down
            visible, recs = _scan_plain(raw)
    else:
        visible, recs = _scan_plain(raw)

    recs.extend(_unicode_recs(raw))
    recs.extend(_base64_recs(raw))

    # A visible sentence already reported as hidden-character abuse is not reported twice.
    covered = [_squash(r.text) for r in recs if r.kind in {"ZERO_WIDTH", "BIDI"} and r.severity == "high"]
    for rec in _visible_recs(visible):
        if not any(_squash(rec.text) in text for text in covered):
            recs.append(rec)

    for index, rec in enumerate(recs):
        if rec.pos < 0:
            pos, located = _locate(raw, rec.text)
            if rec.kind not in _DECODED_KINDS:
                rec.text = located  # prefer the raw spelling so the UI can highlight it
            rec.pos = pos if pos >= 0 else len(raw) + index

    recs.sort(key=lambda r: r.pos)
    findings = [
        {"id": f"f{i}", "tier": "rule", "kind": r.kind, "text": r.text, "severity": r.severity,
         "reason": r.reason, "hidden": r.hidden}
        for i, r in enumerate(recs, start=1)
    ]
    segments = [{"kind": r.kind, "text": r.text} for r in recs if r.segment]
    return {"visible_text": visible, "hidden_segments": segments, "findings": findings}
