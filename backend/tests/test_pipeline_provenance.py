"""Placeholder provenance and argument rehydration in pipeline.py (the inner door for agents)."""

import pytest

from backend import gemma, pipeline

CANARY = "sk_" + "live_" + "CANARY7f3a9Qx2LmZ8vB4nK1"  # built from pieces: GitHub push protection rejects literal sk_live_ strings


@pytest.fixture(autouse=True)
def _rules_only(monkeypatch):
    monkeypatch.setenv("GEMMA_ENABLED", "false")
    monkeypatch.setattr(gemma, "_status", "disabled")


def new_session() -> pipeline.Session:
    return pipeline.Session(scan_id="test")


# --------------------------------------------------------------------------- provenance


def test_origin_defaults_to_user_and_is_recorded():
    session = new_session()
    placeholder = session.placeholder_for("EMAIL", "priya@acme.test")
    assert placeholder == "[EMAIL_1]"
    assert session.ph_origin[placeholder] == "user"
    assert pipeline.origin_of(session, placeholder) == "user"


def test_untrusted_origin_is_recorded():
    session = new_session()
    placeholder = session.placeholder_for("EMAIL", "attacker@evil.test", origin="untrusted:fetch_page")
    assert pipeline.origin_of(session, placeholder) == "untrusted:fetch_page"


def test_first_origin_wins_in_both_directions():
    session = new_session()
    user_ph = session.placeholder_for("EMAIL", "priya@acme.test")
    assert session.placeholder_for("EMAIL", "priya@acme.test", origin="untrusted:read_email") == user_ph
    assert pipeline.origin_of(session, user_ph) == "user"

    planted = session.placeholder_for("EMAIL", "evil@evil.test", origin="untrusted:read_email")
    assert session.placeholder_for("EMAIL", "evil@evil.test", origin="user") == planted
    assert pipeline.origin_of(session, planted) == "untrusted:read_email"


def test_case_insensitive_match_keeps_the_original_origin():
    session = new_session()
    first = session.placeholder_for("PERSON", "Priya Raman")
    assert session.placeholder_for("PERSON", "priya raman", origin="untrusted:read_email") == first
    assert pipeline.origin_of(session, first) == "user"


def test_origin_of_unknown_placeholder_is_none():
    assert pipeline.origin_of(new_session(), "[EMAIL_9]") is None


def test_scan_records_origin_for_new_session_and_continuation():
    first = pipeline.scan("Mail priya@acme.test please")
    session = pipeline.SESSIONS[first["scan_id"]]
    assert pipeline.origin_of(session, "[EMAIL_1]") == "user"

    pipeline.scan("Also bob@evil.test and priya@acme.test", session, origin="untrusted:fetch_page")
    assert pipeline.origin_of(session, "[EMAIL_1]") == "user"
    assert pipeline.origin_of(session, "[EMAIL_2]") == "untrusted:fetch_page"


def test_scan_signature_is_backwards_compatible():
    body = pipeline.scan("key is " + CANARY)
    assert body["sanitized_text"] == "key is [API_KEY_1]"
    assert set(body) == {"scan_id", "risk", "entities", "sanitized_text", "gemma_used", "timings_ms"}


def test_sanitize_with_session_default_origin_is_user():
    session = new_session()
    assert pipeline.sanitize_with_session(session, "mail a@b.com") == "mail [EMAIL_1]"
    assert pipeline.origin_of(session, "[EMAIL_1]") == "user"


def test_sanitize_with_session_records_tool_origin_and_reuses_known_values():
    session = new_session()
    pipeline.sanitize_with_session(session, "to priya@acme.test")
    out = pipeline.sanitize_with_session(
        session, "from attacker@evil.test cc priya@acme.test, key " + CANARY, origin="untrusted:read_file"
    )
    assert out == "from [EMAIL_2] cc [EMAIL_1], key [API_KEY_1]"
    assert pipeline.origin_of(session, "[EMAIL_1]") == "user"
    assert pipeline.origin_of(session, "[EMAIL_2]") == "untrusted:read_file"
    assert pipeline.origin_of(session, "[API_KEY_1]") == "untrusted:read_file"


def test_gemma_pii_pass_runs_on_tool_results_only(monkeypatch):
    calls: list[str] = []

    def detect(text):
        calls.append(text)
        return [{"type": "PERSON", "text": "Meera Krishnan", "reason": "name"}]

    monkeypatch.setattr(gemma, "is_loaded", lambda: True)
    monkeypatch.setattr(gemma, "detect", detect)

    session = new_session()
    assert pipeline.sanitize_with_session(session, "Hi Meera Krishnan") == "Hi Meera Krishnan"
    assert calls == []

    out = pipeline.sanitize_with_session(session, "Hi Meera Krishnan, mail a@b.com", origin="untrusted:read_email")
    assert out == "Hi [PERSON_1], mail [EMAIL_1]"
    assert pipeline.origin_of(session, "[PERSON_1]") == "untrusted:read_email"


def test_gemma_failure_on_tool_result_falls_back_to_rules(monkeypatch):
    def detect(text):
        raise RuntimeError("model crashed")

    monkeypatch.setattr(gemma, "is_loaded", lambda: True)
    monkeypatch.setattr(gemma, "detect", detect)
    out = pipeline.sanitize_with_session(new_session(), "mail a@b.com", origin="untrusted:read_email")
    assert out == "mail [EMAIL_1]"


# --------------------------------------------------------------------------- rehydrate_args


def populated() -> pipeline.Session:
    session = new_session()
    session.placeholder_for("EMAIL", "priya@acme.test")  # [EMAIL_1] user
    session.placeholder_for("EMAIL", "attacker@evil.test", origin="untrusted:fetch_page")  # [EMAIL_2]
    session.placeholder_for("API_KEY", CANARY, origin="untrusted:read_file")  # [API_KEY_1]
    return session


def test_rehydrate_args_none_restores_every_non_secret_placeholder():
    session = populated()
    args = {"to": "[EMAIL_2]", "subject": "hi [EMAIL_1]", "body": f"key [API_KEY_1] to [EMAIL_1]"}
    out = pipeline.rehydrate_args(session, args, None)
    assert out["to"] == "attacker@evil.test"
    assert out["subject"] == "hi priya@acme.test"
    assert out["body"] == "key [API_KEY_1] to priya@acme.test"


def test_secrets_are_never_restored_even_when_allowed_names_them():
    session = populated()
    out = pipeline.rehydrate_args(session, {"body": "[API_KEY_1]"}, {"[API_KEY_1]", "[EMAIL_1]"})
    assert out == {"body": "[API_KEY_1]"}
    assert CANARY not in str(out)


def test_only_allowed_placeholders_are_restored():
    session = populated()
    out = pipeline.rehydrate_args(session, {"to": "[EMAIL_2]", "cc": "[EMAIL_1]"}, {"[EMAIL_1]"})
    assert out == {"to": "[EMAIL_2]", "cc": "priya@acme.test"}


def test_empty_allowed_set_restores_nothing():
    session = populated()
    assert pipeline.rehydrate_args(session, {"to": "[EMAIL_1]"}, set()) == {"to": "[EMAIL_1]"}


def test_deep_walk_over_dicts_lists_and_non_strings():
    session = populated()
    args = {"to": ["[EMAIL_1]", {"nested": "[EMAIL_1]!"}], "count": 3, "flag": True, "none": None, "[EMAIL_1]": "key"}
    out = pipeline.rehydrate_args(session, args, None)
    assert out["to"] == ["priya@acme.test", {"nested": "priya@acme.test!"}]
    assert out["count"] == 3 and out["flag"] is True and out["none"] is None
    assert "[EMAIL_1]" in out  # keys are left alone


def test_unknown_placeholders_stay_and_input_is_not_mutated():
    session = populated()
    args = {"to": "[EMAIL_9]", "list": ["[EMAIL_1]"]}
    out = pipeline.rehydrate_args(session, args, None)
    assert out["to"] == "[EMAIL_9]"
    assert args == {"to": "[EMAIL_9]", "list": ["[EMAIL_1]"]}
    assert pipeline.rehydrate_args(session, "plain [EMAIL_1]", None) == "plain priya@acme.test"


def test_rehydrate_of_text_is_unchanged():
    session = populated()
    assert pipeline.rehydrate(session, "[EMAIL_2] and [API_KEY_1]") == "attacker@evil.test and [API_KEY_1]"
