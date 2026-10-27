import math
import re


_PRIORITY = {
    "JWT": 9,
    "API_KEY": 8,
    "PASSWORD": 7,
    "CARD": 6,
    "GOV_ID": 5,
    "EMAIL": 4,
    "INTERNAL_URL": 3,
    "IP_ADDRESS": 2,
    "PHONE": 1,
}

_OCTET = r"(?:25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)"
# A trailing "." is allowed (end of sentence); "1.2.3.4.5" is still rejected.
_IPV4_RE = re.compile(rf"(?<!\d)(?<!\d\.){_OCTET}(?:\.{_OCTET}){{3}}(?!\d|\.\d)")

_EMAIL_RE = re.compile(
    r"(?<![A-Za-z0-9.!#$%&'*+/=?^_`{|}~-])"
    r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+"
    r"@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
    r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+"
    # A trailing "." ends the sentence, not the address.
    r"(?![A-Za-z0-9!#$%&'*+/=?^_`{|}~-]|\.[A-Za-z0-9])"
)

_JWT_RE = re.compile(
    r"(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"
    r"(?![A-Za-z0-9_-])"
)

_API_PREFIX_PATTERNS = (
    re.compile(r"(?<![A-Za-z0-9_-])AKIA[A-Z0-9]{16}(?![A-Za-z0-9_-])"),
    re.compile(
        r"(?<![A-Za-z0-9_-])"
        r"(?:sk-|sk_live_|sk_test_|pk_live_|rk_live_|ghp_|gho_|github_pat_|xoxb-|xoxp-|AIza|hf_)"
        r"[A-Za-z0-9_+\-/=]{8,}"
        r"(?![A-Za-z0-9_+\-/=])"
    ),
    # Generic "<prefix>_<live|test|prod>_<token>" keys, e.g. ak_test_7QpLm2Rs9Tv4.
    re.compile(r"(?<![A-Za-z0-9_-])[A-Za-z]{2,10}_(?:live|test|prod)_[A-Za-z0-9]{8,}(?![A-Za-z0-9_-])"),
)

_PASSWORD_RE = re.compile(
    r"(?<![A-Za-z0-9])(?:password|passwd|pwd|secret|pass)\b\s*[:=]\s*"
    r"(?:\"(?P<double>[^\"]+)\"|'(?P<single>[^']+)'|(?P<bare>[^\s,;]+))",
    re.IGNORECASE,
)

# "the admin password is Quasar#8841": only values that look like a credential
# (digit or symbol, 6+ chars), so "the password is required" is not flagged.
_PASSWORD_IS_RE = re.compile(
    r"(?<![A-Za-z0-9])(?:password|passwd|passcode|pwd)\s+(?:is|was)\s+(?P<value>[^\s,;]+)",
    re.IGNORECASE,
)

_CARD_RE = re.compile(r"(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)")

_PAN_RE = re.compile(r"(?<![A-Z0-9])[A-Z]{5}\d{4}[A-Z](?![A-Z0-9])")
_AADHAAR_RE = re.compile(r"(?<!\d)[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}(?!\d)")
_SSN_RE = re.compile(r"(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])")

_URL_RE = re.compile(
    r"(?<![A-Za-z0-9])https?://"
    r"(?:[^\s/@]+@)?"
    r"(?P<host>[^\s/:?#]+)"
    r"(?::\d{1,5})?"
    r"(?:[/?#][^\s]*)?"
)

_PHONE_RE = re.compile(
    r"(?<![\d+])"
    r"(?:\+\d{1,3}[ .-]?(?:\(\d{2,4}\)|\d{2,4})[ .-]?\d{3,4}[ .-]?\d{3,5}"
    r"|\d{3,5}[ .-]\d{3,4}[ .-]\d{3,5}"
    r"|\d{10,12})"
    r"(?![\d])"
)

_GENERIC_TOKEN_RE = re.compile(
    r"(?<![A-Za-z0-9_+/=\-])[A-Za-z0-9_+/=\-]{24,}(?![A-Za-z0-9_+/=\-])"
)


def shannon_entropy(s: str) -> float:
    """Return Shannon entropy in bits per character for s."""
    if not s:
        return 0.0
    counts = {}
    for char in s:
        counts[char] = counts.get(char, 0) + 1
    length = len(s)
    return -sum((count / length) * math.log2(count / length) for count in counts.values())


def luhn_valid(digits: str) -> bool:
    """Return whether digits satisfy the Luhn checksum."""
    if not digits or not digits.isdigit():
        return False
    total = 0
    parity = len(digits) % 2
    for index, char in enumerate(digits):
        value = int(char)
        if index % 2 == parity:
            value *= 2
            if value > 9:
                value -= 9
        total += value
    return total % 10 == 0


def _candidate(kind: str, text: str, start: int, end: int) -> dict:
    return {"type": kind, "text": text, "start": start, "end": end}


def _add_regex_candidates(text: str, pattern: re.Pattern, kind: str, candidates: list[dict]) -> None:
    for match in pattern.finditer(text):
        candidates.append(_candidate(kind, match.group(0), match.start(), match.end()))


def _add_password_candidates(text: str, candidates: list[dict]) -> None:
    for match in _PASSWORD_RE.finditer(text):
        for name in ("double", "single", "bare"):
            value = match.group(name)
            if value is not None:
                start = match.start(name)
                end = match.end(name)
                candidates.append(_candidate("PASSWORD", value, start, end))
                break

    for match in _PASSWORD_IS_RE.finditer(text):
        value = match.group("value").rstrip(".,;:!?)]}'\"")
        if len(value) >= 6 and re.search(r"[\d\W_]", value):
            start = match.start("value")
            candidates.append(_candidate("PASSWORD", value, start, start + len(value)))


def _add_url_candidates(text: str, candidates: list[dict]) -> None:
    private_host_re = re.compile(
        rf"^(?:10\.(?:{_OCTET}\.){{2}}{_OCTET}|"
        rf"172\.(?:1[6-9]|2\d|3[0-1])\.(?:{_OCTET}\.){_OCTET}|"
        rf"192\.168\.(?:{_OCTET}\.){_OCTET}|127\.(?:{_OCTET}\.){_OCTET})$",
        re.IGNORECASE,
    )
    for match in _URL_RE.finditer(text):
        host = match.group("host").lower().rstrip(".")
        is_suffix = host.endswith((".internal", ".local", ".corp", ".lan", ".intranet"))
        is_suffix = is_suffix or host.split(".")[0] in {"internal", "intranet", "corp", "staging"}
        is_private_ip = bool(private_host_re.fullmatch(host)) or host == "localhost"
        if not (is_private_ip or is_suffix):
            continue
        end = match.end()
        while end > match.start() and text[end - 1] in ".,;:!?)]}" + "'":
            end -= 1
        if end > match.start():
            candidates.append(_candidate("INTERNAL_URL", text[match.start():end], match.start(), end))


def _add_api_key_candidates(text: str, candidates: list[dict]) -> None:
    url_spans = [(match.start(), match.end()) for match in _URL_RE.finditer(text)]

    for pattern in _API_PREFIX_PATTERNS:
        _add_regex_candidates(text, pattern, "API_KEY", candidates)

    for match in _GENERIC_TOKEN_RE.finditer(text):
        if any(start < match.end() and match.start() < end for start, end in url_spans):
            continue
        value = match.group(0)
        if not (re.search(r"[A-Za-z]", value) and re.search(r"\d", value)):
            continue
        if shannon_entropy(value) >= 3.5:
            candidates.append(_candidate("API_KEY", value, match.start(), match.end()))


def _add_card_candidates(text: str, candidates: list[dict]) -> None:
    for match in _CARD_RE.finditer(text):
        digits = re.sub(r"[ -]", "", match.group(0))
        if 13 <= len(digits) <= 19 and luhn_valid(digits):
            candidates.append(_candidate("CARD", match.group(0), match.start(), match.end()))


def _add_gov_id_candidates(text: str, candidates: list[dict]) -> None:
    _add_regex_candidates(text, _PAN_RE, "GOV_ID", candidates)
    for match in _AADHAAR_RE.finditer(text):
        digits = re.sub(r"[ -]", "", match.group(0))
        if len(digits) == 12:
            candidates.append(_candidate("GOV_ID", match.group(0), match.start(), match.end()))
    _add_regex_candidates(text, _SSN_RE, "GOV_ID", candidates)


def _spans_overlap(left: dict, right: dict) -> bool:
    return left["start"] < right["end"] and right["start"] < left["end"]


def detect(text: str) -> list[dict]:
    """
    Return a list of {"type": str, "text": str, "start": int, "end": int},
    sorted by start, with NO overlapping spans, where text == original[start:end].
    """
    candidates: list[dict] = []
    _add_regex_candidates(text, _EMAIL_RE, "EMAIL", candidates)
    _add_regex_candidates(text, _JWT_RE, "JWT", candidates)
    _add_api_key_candidates(text, candidates)
    _add_password_candidates(text, candidates)
    _add_card_candidates(text, candidates)
    _add_gov_id_candidates(text, candidates)
    _add_regex_candidates(text, _IPV4_RE, "IP_ADDRESS", candidates)
    _add_url_candidates(text, candidates)
    _add_regex_candidates(text, _PHONE_RE, "PHONE", candidates)

    ordered = sorted(
        candidates,
        key=lambda item: (
            -_PRIORITY[item["type"]],
            -(item["end"] - item["start"]),
            item["start"],
            item["end"],
        ),
    )
    selected: list[dict] = []
    for candidate in ordered:
        if not any(_spans_overlap(candidate, existing) for existing in selected):
            selected.append(candidate)

    return sorted(selected, key=lambda item: (item["start"], item["end"]))
