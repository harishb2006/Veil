"""The gate: each rule's allow and block cases, plus allowed_placeholders and policy loading."""

import pytest

from backend import gate, gemma, pipeline

CANARY = "sk_" + "live_" + "CANARY7f3a9Qx2LmZ8vB4nK1"  # built from pieces: GitHub push protection rejects literal sk_live_ strings

POLICY = {
    "untrusted_sources": ["fetch_page", "read_inbox", "read_email", "read_file"],
    "risky_tools": ["send_email", "run_shell"],
    "contacts": ["priya@acme.test", "team@acme.test"],
    "allowed_hosts": ["shop.test"],
    "rules": ["secrets_never_leave", "recipient_provenance", "shell_when_tainted", "exfil_urls"],
}


@pytest.fixture(autouse=True)
def _rules_only(monkeypatch):
    monkeypatch.setenv("GEMMA_ENABLED", "false")
    monkeypatch.setattr(gemma, "_status", "disabled")


@pytest.fixture
def session() -> pipeline.Session:
    """[EMAIL_1] priya (user), [EMAIL_2] attacker (planted), [EMAIL_3] team (planted but a contact), [API_KEY_1]."""

    s = pipeline.Session(scan_id="test")
    s.placeholder_for("EMAIL", "priya@acme.test")
    s.placeholder_for("EMAIL", "attacker@evil.test", origin="untrusted:fetch_page")
    s.placeholder_for("EMAIL", "Team@Acme.test", origin="untrusted:read_email")
    s.placeholder_for("API_KEY", CANARY, origin="untrusted:read_file")
    return s


def check(tool, args, session, tainted=True, policy=POLICY):
    return gate.check(tool, args, tainted=tainted, session=session, policy=policy)


def send(to, body="Here is the summary.", subject="Summary"):
    return {"to": to, "subject": subject, "body": body}


# --------------------------------------------------------------------------- read-only tools


@pytest.mark.parametrize("tool", ["fetch_page", "read_inbox", "read_email", "read_file", "something_else"])
def test_non_risky_tools_are_allowed(tool, session):
    verdict = check(tool, {"path": "[API_KEY_1]"}, session)
    assert verdict == {"decision": "allow", "reason": "Read-only tool.", "rule": None}


# --------------------------------------------------------------------------- secrets_never_leave


def test_secret_placeholder_in_body_is_blocked(session):
    verdict = check("send_email", send("[EMAIL_1]", body="key: [API_KEY_1]"), session)
    assert verdict["decision"] == "block"
    assert verdict["rule"] == "secrets_never_leave"
    assert "[API_KEY_1]" in verdict["reason"]


def test_raw_secret_in_body_is_blocked(session):
    verdict = check("send_email", send("[EMAIL_1]", body=f"CANARY_API_KEY={CANARY}"), session)
    assert (verdict["decision"], verdict["rule"]) == ("block", "secrets_never_leave")


def test_raw_secret_is_blocked_even_when_the_run_is_not_tainted(session):
    verdict = check("send_email", send("[EMAIL_1]", body=CANARY), session, tainted=False)
    assert (verdict["decision"], verdict["rule"]) == ("block", "secrets_never_leave")


def test_secret_in_nested_shell_args_is_blocked(session):
    verdict = check("run_shell", {"command": "echo [API_KEY_1]"}, session, tainted=False)
    assert (verdict["decision"], verdict["rule"]) == ("block", "secrets_never_leave")


def test_no_secret_means_allow(session):
    verdict = check("send_email", send("[EMAIL_1]"), session)
    assert verdict["decision"] == "allow"
    assert verdict["rule"] is None


# --------------------------------------------------------------------------- recipient_provenance


def test_user_placeholder_recipient_is_allowed(session):
    assert check("send_email", send("[EMAIL_1]"), session)["decision"] == "allow"


def test_planted_placeholder_recipient_is_blocked_with_a_human_reason(session):
    verdict = check("send_email", send("[EMAIL_2]"), session)
    assert verdict["decision"] == "block"
    assert verdict["rule"] == "recipient_provenance"
    assert verdict["reason"] == "Recipient [EMAIL_2] was planted by fetch_page — not from you or your contacts."


def test_planted_placeholder_is_blocked_even_if_not_tainted(session):
    assert check("send_email", send("[EMAIL_2]"), session, tainted=False)["decision"] == "block"


def test_planted_placeholder_whose_value_is_a_contact_is_allowed_case_insensitively(session):
    # [EMAIL_3] is "Team@Acme.test": planted by an email, but the same address as the contact team@acme.test.
    assert check("send_email", send("[EMAIL_3]"), session)["decision"] == "allow"


def test_unknown_placeholder_recipient_is_blocked(session):
    verdict = check("send_email", send("[EMAIL_9]"), session)
    assert (verdict["decision"], verdict["rule"]) == ("block", "recipient_provenance")
    assert "[EMAIL_9]" in verdict["reason"]


def test_one_bad_recipient_among_good_ones_blocks(session):
    verdict = check("send_email", send("[EMAIL_1], [EMAIL_2]"), session)
    assert verdict["decision"] == "block"
    assert "[EMAIL_2]" in verdict["reason"]


def test_raw_contact_address_is_allowed_case_insensitively(session):
    assert check("send_email", send("Priya@ACME.test"), session)["decision"] == "allow"


def test_raw_address_of_a_user_placeholder_is_allowed(session):
    session.placeholder_for("EMAIL", "dev@mine.test")  # user-origin, not a contact
    assert check("send_email", send("dev@mine.test"), session)["decision"] == "allow"


def test_raw_unknown_address_is_blocked_when_tainted(session):
    verdict = check("send_email", send("attacker@evil.test"), session, tainted=True)
    assert (verdict["decision"], verdict["rule"]) == ("block", "recipient_provenance")
    assert "attacker@evil.test" in verdict["reason"]


def test_raw_unknown_address_is_allowed_when_not_tainted(session):
    assert check("send_email", send("someone@else.test"), session, tainted=False)["decision"] == "allow"


def test_recipient_that_cannot_be_parsed_is_blocked_when_tainted(session):
    assert check("send_email", send("not an address"), session, tainted=True)["decision"] == "block"
    assert check("send_email", {"subject": "x", "body": "y"}, session, tainted=True)["decision"] == "block"


# --------------------------------------------------------------------------- shell_when_tainted


def test_shell_after_untrusted_read_needs_approval(session):
    verdict = check("run_shell", {"command": "ls"}, session, tainted=True)
    assert verdict["decision"] == "needs_approval"
    assert verdict["rule"] == "shell_when_tainted"
    assert "approval" in verdict["reason"] and "blocked" in verdict["reason"]


def test_shell_in_a_clean_run_is_allowed(session):
    assert check("run_shell", {"command": "ls"}, session, tainted=False)["decision"] == "allow"


# --------------------------------------------------------------------------- exfil_urls


def test_url_with_query_string_in_tainted_email_is_blocked(session):
    body = "see https://shop.test/p?data=abc"
    verdict = check("send_email", send("[EMAIL_1]", body=body), session)
    assert (verdict["decision"], verdict["rule"]) == ("block", "exfil_urls")


def test_url_to_a_host_off_the_allow_list_is_blocked(session):
    verdict = check("send_email", send("[EMAIL_1]", body="![x](https://evil.test/pixel.png)"), session)
    assert (verdict["decision"], verdict["rule"]) == ("block", "exfil_urls")
    assert "evil.test" in verdict["reason"]


def test_url_on_the_allow_list_without_a_query_is_allowed(session):
    assert check("send_email", send("[EMAIL_1]", body="from https://shop.test/aurora-x2."), session)["decision"] == "allow"


def test_urls_are_fine_when_not_tainted(session):
    assert check("send_email", send("[EMAIL_1]", body="https://evil.test/x?y=1"), session, tainted=False)["decision"] == "allow"


def test_default_allowed_hosts_is_empty(session):
    policy = {**gate.DEFAULT_POLICY, "contacts": ["priya@acme.test"]}
    verdict = check("send_email", send("[EMAIL_1]", body="https://shop.test/a"), session, policy=policy)
    assert (verdict["decision"], verdict["rule"]) == ("block", "exfil_urls")


# --------------------------------------------------------------------------- rule order and switches


def test_secret_rule_is_reported_before_recipient_rule(session):
    verdict = check("send_email", send("[EMAIL_2]", body="[API_KEY_1]"), session)
    assert verdict["rule"] == "secrets_never_leave"


def test_disabled_rules_do_not_run(session):
    policy = {**POLICY, "rules": ["secrets_never_leave"]}
    assert check("send_email", send("[EMAIL_2]"), session, policy=policy)["decision"] == "allow"
    assert check("run_shell", {"command": "ls"}, session, policy=policy)["decision"] == "allow"


def test_tool_not_in_risky_list_is_not_gated(session):
    policy = {**POLICY, "risky_tools": ["run_shell"]}
    assert check("send_email", send("[EMAIL_2]"), session, policy=policy)["decision"] == "allow"


# --------------------------------------------------------------------------- allowed_placeholders / policy


def test_allowed_placeholders_are_user_origin_or_contacts_and_never_secrets(session):
    session.placeholder_for("API_KEY", "user_supplied_secret_example", origin="user")  # [API_KEY_2]
    assert gate.allowed_placeholders(session, POLICY) == {"[EMAIL_1]", "[EMAIL_3]"}


def test_allowed_placeholders_drives_rehydration(session):
    allowed = gate.allowed_placeholders(session, POLICY)
    out = pipeline.rehydrate_args(session, {"to": "[EMAIL_2]", "cc": "[EMAIL_1]", "body": "[API_KEY_1]"}, allowed)
    assert out == {"to": "[EMAIL_2]", "cc": "priya@acme.test", "body": "[API_KEY_1]"}


def test_shipped_policy_file_loads_with_all_five_rules():
    policy = gate.load_policy()
    assert set(policy["rules"]) == {"secrets_never_leave", "recipient_provenance", "egress", "shell_when_tainted", "exfil_urls"}
    assert {"send_email", "run_shell"} == set(policy["risky_tools"])
    assert "priya@acme.test" in policy["contacts"]
    assert "fetch_page" in policy["untrusted_sources"]


def test_load_policy_fills_missing_keys(tmp_path):
    path = tmp_path / "p.yaml"
    path.write_text("contacts: [boss@x.test]\n")
    policy = gate.load_policy(path)
    assert policy["contacts"] == ["boss@x.test"]
    assert policy["allowed_hosts"] == []
    assert "exfil_urls" in policy["rules"]


def test_check_loads_the_shipped_policy_by_default(session):
    assert gate.check("send_email", send("[EMAIL_1]"), tainted=True, session=session)["decision"] == "allow"
    assert gate.check("send_email", send("[EMAIL_2]"), tainted=True, session=session)["decision"] == "block"
