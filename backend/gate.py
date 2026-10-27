"""The gate: checks every risky tool call against where its data came from.

Placeholders are capability tokens. In full VEIL mode the agent only ever holds placeholders, so the
gate sees `[EMAIL_2]` and can look up whether that value came from the user (`origin == "user"`) or was
planted by something the agent read (`untrusted:<tool>`). Real values are rehydrated only for approved
placeholders, and secrets are never rehydrated at all.
"""

import ipaddress
import math
import re
import socket
from collections import Counter
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import yaml

from backend import rules
from backend.pipeline import PLACEHOLDER_RE, REDACTED_TYPES, USER_ORIGIN, Session, origin_of

POLICY_PATH = Path(__file__).resolve().parent / "policy.yaml"

DEFAULT_POLICY = {
    "untrusted_sources": ["fetch_page", "read_inbox", "read_email", "read_file"],
    "risky_tools": ["send_email", "run_shell"],
    "contacts": [],
    "allowed_hosts": [],
    "drop_sites": [],
    "rules": ["secrets_never_leave", "recipient_provenance", "egress", "shell_when_tainted", "exfil_urls"],
}

URL_RE = re.compile(r"https?://[^\s\"'<>)\]]+", re.IGNORECASE)

ALLOW = "allow"
BLOCK = "block"
NEEDS_APPROVAL = "needs_approval"


def load_policy(path: str | Path | None = None) -> dict:
    """Read the policy file, filling anything missing from DEFAULT_POLICY."""

    with open(path or POLICY_PATH, encoding="utf-8") as handle:
        loaded = yaml.safe_load(handle) or {}
    return {**DEFAULT_POLICY, **{key: value for key, value in loaded.items() if value is not None}}


def _contacts(policy: dict) -> set[str]:
    return {str(contact).strip().lower() for contact in policy.get("contacts", [])}


def _decision(decision: str, reason: str, rule: str | None) -> dict:
    return {"decision": decision, "reason": reason, "rule": rule}


def _strings(value: Any) -> list[str]:
    """Every string inside nested tool arguments."""

    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [text for item in value.values() for text in _strings(item)]
    if isinstance(value, (list, tuple)):
        return [text for item in value for text in _strings(item)]
    return []


def allowed_placeholders(session: Session, policy: dict | None = None) -> set[str]:
    """Placeholders whose values may be restored: the user's own, or a trusted contact. Never secrets."""

    contacts = _contacts(policy or load_policy())
    allowed = set()
    for placeholder, value in session.ph_to_value.items():
        if session.ph_type.get(placeholder) in REDACTED_TYPES:
            continue
        if origin_of(session, placeholder) == USER_ORIGIN or value.strip().lower() in contacts:
            allowed.add(placeholder)
    return allowed


def _trusted_values(session: Session, policy: dict) -> set[str]:
    """Lower-cased real values that are trusted: contacts plus everything allowed_placeholders approves."""

    values = _contacts(policy)
    for placeholder in allowed_placeholders(session, policy):
        values.add(session.ph_to_value[placeholder].strip().lower())
    return values


def _describe_origin(origin: str | None) -> str:
    if origin and origin.startswith("untrusted:"):
        return f"was planted by {origin.split(':', 1)[1]}"
    return "has an unknown origin"


# --------------------------------------------------------------------------- rules


def _secrets_never_leave(args: dict, session: Session) -> dict | None:
    for text in _strings(args):
        for match in PLACEHOLDER_RE.finditer(text):
            if session.ph_type.get(match.group(0)) in REDACTED_TYPES:
                return _decision(BLOCK, f"Secret {match.group(0)} must never leave this machine.", "secrets_never_leave")
        if any(secret in text for secret in session.redacted_values()):
            return _decision(BLOCK, "A secret value was about to leave this machine.", "secrets_never_leave")
        if any(hit["type"] in REDACTED_TYPES for hit in rules.detect(text)):
            return _decision(BLOCK, "A secret (key, password or token) was about to leave this machine.", "secrets_never_leave")
    return None


def _recipient_provenance(tool: str, args: dict, tainted: bool, session: Session, policy: dict) -> dict | None:
    if tool != "send_email":
        return None
    to = args.get("to")
    to = ", ".join(_strings(to)) if not isinstance(to, str) else to

    allowed = allowed_placeholders(session, policy)
    trusted = _trusted_values(session, policy)

    for match in PLACEHOLDER_RE.finditer(to):
        placeholder = match.group(0)
        if placeholder in allowed:
            continue
        if placeholder in session.ph_type:
            reason = f"Recipient {placeholder} {_describe_origin(origin_of(session, placeholder))} — not from you or your contacts."
        else:
            reason = f"Recipient {placeholder} is not a value VEIL knows — not from you or your contacts."
        return _decision(BLOCK, reason, "recipient_provenance")

    remainder = PLACEHOLDER_RE.sub(" ", to)
    addresses = [remainder[hit["start"]:hit["end"]] for hit in rules.detect(remainder) if hit["type"] == "EMAIL"]
    for address in addresses:
        if tainted and address.strip().lower() not in trusted:
            return _decision(
                BLOCK,
                f"Recipient {address} is not from you or your contacts, and this run has read untrusted content.",
                "recipient_provenance",
            )
    if tainted and not addresses and not PLACEHOLDER_RE.search(to):
        return _decision(BLOCK, "Could not verify the recipient of this email.", "recipient_provenance")
    return None


def _shell_when_tainted(tool: str, tainted: bool) -> dict | None:
    if tool == "run_shell" and tainted:
        return _decision(
            NEEDS_APPROVAL,
            "Shell commands after reading untrusted content need your approval — blocked.",
            "shell_when_tainted",
        )
    return None


def _exfil_urls(args: dict, tainted: bool, policy: dict) -> dict | None:
    if not tainted:
        return None
    allowed_hosts = {str(host).strip().lower() for host in policy.get("allowed_hosts", [])}
    for text in _strings(args):
        for match in URL_RE.finditer(text):
            url = match.group(0).rstrip(".,;:!?")
            parsed = urlparse(url)
            host = (parsed.hostname or "").lower()
            if parsed.query:
                return _decision(BLOCK, f"URL with a query string ({host}) could carry data out.", "exfil_urls")
            if host not in allowed_hosts:
                return _decision(BLOCK, f"URL to {host or 'an unknown host'} is not on the allowed-host list.", "exfil_urls")
    return None


# --- egress: where the data is going, whatever the run has read -------------------------------------------

_INTERNAL_NETS = [ipaddress.ip_network(n) for n in (
    "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "169.254.0.0/16", "0.0.0.0/8", "100.64.0.0/10",
    "::1/128", "::/128", "fc00::/7", "fe80::/10",
)]
_METADATA_HOSTS = {"169.254.169.254", "169.254.170.2", "metadata.google.internal", "metadata", "instance-data", "fd00:ec2::254"}
_INTERNAL_NAMES = {"localhost", "ip6-localhost", "ip6-loopback"}
_NUMERIC_HOST_RE = re.compile(r"(?:0x[0-9a-f]+|\d+)(?:\.(?:0x[0-9a-f]+|\d+)){0,3}", re.IGNORECASE)
# Bare hosts in a shell command (no http://): dotted IPs, 0x-hex IPs and host-looking words, never e-mail domains.
_BARE_HOST_RE = re.compile(r"(?<![@\w./:=-])(?:0x[0-9a-f]{6,8}|\d{1,3}(?:\.\d{1,3}){3}|[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+)(?![\w@-])", re.IGNORECASE)
_DNS_LOOKUP_RE = re.compile(r"\b(?:nslookup|dig|host|ping|resolveip)\s+(?:[-+]\S+\s+)*([^\s;|&'\"]+)", re.IGNORECASE)
_EGRESS_URL_RE = re.compile(r"https?://(?:\[[0-9a-f:.]+\]|[^\s\"'<>)\]/?#]+)[^\s\"'<>)\]]*", re.IGNORECASE)
TUNNEL_LABEL_MIN = 24
TUNNEL_ENTROPY_MIN = 3.5


def _expand_placeholders(text: str, session: Session) -> str:
    """Put real values back for non-secret placeholders, so the check sees the host the agent would reach."""

    def real(match: re.Match) -> str:
        placeholder = match.group(0)
        if session.ph_type.get(placeholder) in REDACTED_TYPES:
            return placeholder
        return session.ph_to_value.get(placeholder, placeholder)

    return PLACEHOLDER_RE.sub(real, text)


def _address(host: str):
    """The IP a host spells (dotted, decimal 2130706433, hex 0x7f000001, octal, IPv6), or None for a name."""

    host = host.strip("[]").lower()
    try:
        return ipaddress.ip_address(host)
    except ValueError:
        pass
    if _NUMERIC_HOST_RE.fullmatch(host):
        try:
            return ipaddress.ip_address(socket.inet_aton(host))
        except OSError:
            return None
    return None


def _entropy(label: str) -> float:
    return -sum(n / len(label) * math.log2(n / len(label)) for n in Counter(label).values())


def _on_list(host: str, entries: set[str]) -> str | None:
    """The entry that `host` equals or is a subdomain of."""

    return next((entry for entry in entries if host == entry or host.endswith("." + entry)), None)


def _judge_host(host: str, *, tunnel: bool, allowed: set[str], drop_sites: set[str]) -> str | None:
    host = host.lower().rstrip(".")
    if not host or _on_list(host, allowed):
        return None
    address = _address(host)
    if address is not None and getattr(address, "ipv4_mapped", None):
        address = address.ipv4_mapped
    if host in _METADATA_HOSTS or (address is not None and str(address) in _METADATA_HOSTS):
        return f"{host} is the cloud metadata service — a request there can steal this machine's credentials."
    if host in _INTERNAL_NAMES or host.endswith(".localhost") or (address and any(address in net for net in _INTERNAL_NETS)):
        return f"{host} is an internal or loopback address — a request there can reach private services (SSRF)."
    site = _on_list(host, drop_sites)
    if site:
        return f"{site} is a known anonymous drop site — data sent there is public."
    if tunnel and address is None:
        for label in host.split(".")[:-2]:
            if len(label) >= TUNNEL_LABEL_MIN and _entropy(label) >= TUNNEL_ENTROPY_MIN:
                return f"{host} looks like a DNS-tunnelling address (long random subdomain) — it can smuggle data out in the lookup."
    return None


def _egress(args: dict, session: Session, policy: dict) -> dict | None:
    """Block SSRF / metadata targets, anonymous drop sites and DNS-tunnelling hosts, tainted or not."""

    allowed = {str(h).strip().lower() for h in policy.get("allowed_hosts", [])}
    drops = {str(h).strip().lower() for h in policy.get("drop_sites", [])}
    for raw in _strings(args):
        text = _expand_placeholders(raw, session)
        candidates = [((urlparse(m.group(0).rstrip(".,;:!?")).hostname or ""), True) for m in _EGRESS_URL_RE.finditer(text)]
        candidates += [(m.group(0), False) for m in _BARE_HOST_RE.finditer(_EGRESS_URL_RE.sub(" ", text))]
        candidates += [(m.group(1), True) for m in _DNS_LOOKUP_RE.finditer(text)]
        for host, tunnel in candidates:
            reason = _judge_host(host, tunnel=tunnel, allowed=allowed, drop_sites=drops)
            if reason:
                return _decision(BLOCK, reason, "egress")
    return None


def check(tool: str, args: dict, *, tainted: bool, session: Session, policy: dict | None = None) -> dict:
    """Decide whether the agent may make this call: {"decision": allow|block|needs_approval, "reason", "rule"}."""

    policy = policy or load_policy()
    if tool not in policy.get("risky_tools", []):
        return _decision(ALLOW, "Read-only tool.", None)

    args = args if isinstance(args, dict) else {}
    enabled = set(policy.get("rules", []))
    checks = (
        ("secrets_never_leave", lambda: _secrets_never_leave(args, session)),
        ("recipient_provenance", lambda: _recipient_provenance(tool, args, tainted, session, policy)),
        ("egress", lambda: _egress(args, session, policy)),
        ("shell_when_tainted", lambda: _shell_when_tainted(tool, tainted)),
        ("exfil_urls", lambda: _exfil_urls(args, tainted, policy)),
    )
    for name, run in checks:
        if name in enabled:
            verdict = run()
            if verdict:
                return verdict
    return _decision(ALLOW, "Checked against policy: destination and data are trusted.", None)
