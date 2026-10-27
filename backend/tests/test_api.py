"""API integration tests: real FastAPI app, rules, risk and pipeline.

Only the parts that need hardware or the network are faked:
- the cloud model (cloud.chat, or httpx.post underneath it), and
- Gemma's raw text output (gemma.generate), so its parsing/validation still runs.
No Gemma model or cloud key is needed.
"""

import copy
import json
import threading
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import cloud, gemma, main, pipeline

# Fake Stripe-style key built from pieces: GitHub push protection rejects literal sk_live_ strings.
API_KEY = "sk_" + "live_" + "51HxQe9kLmN3pQrStUvWxYz"
HENDERSON = (
    "The Henderson account is about to churn. Their CFO Priya (priya.r@henderson-logistics.com, "
    "+91 98400 12345) says the 40L renewal is off unless Project Falcon ships. Staging is at "
    "http://10.20.4.15:8080 and the key is " + API_KEY + "."
)

HEALTH_KEYS = {"ok", "gemma_loaded", "gemma_status", "model_alias", "cloud_configured"}
SCAN_KEYS = {"scan_id", "risk", "entities", "sanitized_text", "gemma_used", "timings_ms"}
ENTITY_KEYS = {"type", "text", "replacement", "risk", "source", "redacted", "count"}
ASK_KEYS = {"scan_id", "cloud_model", "cloud_saw", "cloud_response_raw", "response", "timings_ms"}


# --------------------------------------------------------------------------- fixtures


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    """Rules-only, no cloud key, fresh session store for every test."""
    monkeypatch.setenv("GEMMA_ENABLED", "false")
    monkeypatch.setenv("CLOUD_API_KEY", "")
    monkeypatch.setenv("CLOUD_MODEL", "")
    monkeypatch.setattr(gemma, "_status", "disabled")
    pipeline.SESSIONS.clear()
    yield
    pipeline.SESSIONS.clear()


@pytest.fixture
def client():
    # No `with`: skips the lifespan, so no background Gemma load.
    return TestClient(main.app)


class FakeCloud:
    """Stands in for cloud.chat; records a deep copy of every payload it receives."""

    def __init__(self, reply="Noted.", delay=0.0):
        self.reply = reply
        self.delay = delay
        self.payloads: list[list[dict]] = []

    def __call__(self, messages):
        self.payloads.append(copy.deepcopy(messages))
        if self.delay:
            time.sleep(self.delay)
        reply = self.reply(messages) if callable(self.reply) else self.reply
        return reply, "fake-model"

    def all_text(self) -> str:
        return json.dumps(self.payloads, ensure_ascii=False)


@pytest.fixture
def fake_cloud(monkeypatch):
    monkeypatch.setenv("CLOUD_API_KEY", "test-key")
    monkeypatch.setenv("CLOUD_MODEL", "fake-model")
    fake = FakeCloud()
    monkeypatch.setattr(cloud, "chat", fake)
    return fake


@pytest.fixture
def fake_gemma(monkeypatch):
    """Mark Gemma loaded and script its raw output. Set .respond(chunk) -> raw string."""

    class Script:
        def __init__(self):
            self.calls: list[str] = []
            self.respond = lambda chunk: '{"entities": []}'

    script = Script()

    def generate(system, user, max_tokens=512, temperature=0.0):
        script.calls.append(user)
        return script.respond(user)

    monkeypatch.setattr(gemma, "_status", "loaded")
    monkeypatch.setattr(gemma, "_enabled", lambda: True)
    monkeypatch.setattr(gemma, "generate", generate)
    return script


def entities_json(*items):
    return json.dumps({"entities": [{"text": t, "type": ty, "reason": "test"} for t, ty in items]})


def scan(client, text):
    response = client.post("/scan", json={"text": text})
    assert response.status_code == 200, response.text
    return response.json()


def by_text(body):
    return {e["text"]: e for e in body["entities"]}


# --------------------------------------------------------------------------- /health


def test_health_rules_only_no_cloud(client):
    body = client.get("/health").json()
    assert set(body) >= HEALTH_KEYS  # v2 adds firewall + agent
    assert body["ok"] is True
    assert body["gemma_loaded"] is False
    assert body["gemma_status"] == "disabled"
    assert body["cloud_configured"] is False


def test_health_cloud_configured(client, fake_cloud):
    body = client.get("/health").json()
    assert body["cloud_configured"] is True
    assert body["gemma_loaded"] is False


def test_health_gemma_loaded(client, fake_gemma):
    body = client.get("/health").json()
    assert body["gemma_loaded"] is True
    assert body["gemma_status"] == "loaded"


def test_lifespan_with_gemma_disabled_starts_cleanly(monkeypatch):
    monkeypatch.setattr(gemma, "_status", "not_loaded")
    with TestClient(main.app) as live:
        deadline = time.time() + 5
        while gemma.status() != "disabled" and time.time() < deadline:
            time.sleep(0.01)
        assert live.get("/health").json()["gemma_status"] == "disabled"
        assert live.post("/scan", json={"text": "mail a@b.com"}).status_code == 200


def test_scan_returns_503_while_gemma_is_loading(client, monkeypatch):
    monkeypatch.setattr(gemma, "_status", "loading")
    assert client.get("/health").json()["gemma_status"] == "loading"
    response = client.post("/scan", json={"text": "mail a@b.com"})
    assert response.status_code == 503
    assert "loading" in response.json()["detail"]


# --------------------------------------------------------------------------- /scan input validation


@pytest.mark.parametrize("text", ["", "   ", "\n\t "])
def test_scan_rejects_empty_text(client, text):
    response = client.post("/scan", json={"text": text})
    assert response.status_code == 400
    assert response.json()["detail"]


def test_scan_rejects_text_over_limit(client):
    assert client.post("/scan", json={"text": "a" * 20_001}).status_code == 413
    assert client.post("/scan", json={"text": "a" * 20_000}).status_code == 200


def test_scan_rejects_missing_field(client):
    assert client.post("/scan", json={}).status_code == 422


# --------------------------------------------------------------------------- /scan behaviour


def test_scan_contract_shape(client):
    body = scan(client, HENDERSON)
    assert set(body) == SCAN_KEYS
    assert set(body["timings_ms"]) == {"rules", "gemma", "total"}
    for entity in body["entities"]:
        assert ENTITY_KEYS <= set(entity) <= ENTITY_KEYS | {"reason"}
        assert entity["source"] in {"rule", "gemma"}
        assert entity["risk"] in {"LOW", "MEDIUM", "HIGH"}
    assert body["risk"] in {"NONE", "LOW", "MEDIUM", "HIGH"}


def test_scan_without_sensitive_data(client):
    text = "Please summarise the attached meeting notes in three bullet points."
    body = scan(client, text)
    assert body["risk"] == "NONE"
    assert body["entities"] == []
    assert body["sanitized_text"] == text


def test_repeated_value_gets_one_row_and_one_placeholder(client):
    text = "Email a.b@example.com, then a.b@example.com again, and a.b@example.com once more."
    body = scan(client, text)
    assert len(body["entities"]) == 1
    entity = body["entities"][0]
    assert entity["count"] == 3
    assert body["sanitized_text"].count(entity["replacement"]) == 3
    assert "a.b@example.com" not in body["sanitized_text"]


def test_person_case_variants_share_a_placeholder(client, fake_gemma):
    fake_gemma.respond = lambda chunk: entities_json(("Priya", "PERSON"), ("priya", "PERSON"))
    body = scan(client, "Priya called. Later priya emailed again.")
    rows = by_text(body)
    assert rows["Priya"]["replacement"] == rows["priya"]["replacement"] == "[PERSON_1]"
    assert body["sanitized_text"] == "[PERSON_1] called. Later [PERSON_1] emailed again."


def test_secrets_are_redacted_and_absent(client):
    text = (
        f"key {API_KEY}, password=Maple!River!2042, card 4111 1111 1111 1111, "
        "PAN ABCDE1234F, token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJlX3Rlc3Q"
    )
    body = scan(client, text)
    rows = by_text(body)
    expected = {
        API_KEY: "API_KEY",
        "Maple!River!2042": "PASSWORD",
        "4111 1111 1111 1111": "CARD",
        "ABCDE1234F": "GOV_ID",
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJlX3Rlc3Q": "JWT",
    }
    for value, entity_type in expected.items():
        assert rows[value]["type"] == entity_type
        assert rows[value]["redacted"] is True
        assert rows[value]["risk"] == "HIGH"
        assert value not in body["sanitized_text"]
    assert body["risk"] == "HIGH"


def test_gemma_and_rules_merge(client, fake_gemma):
    fake_gemma.respond = lambda chunk: entities_json(
        ("Henderson", "ORG"),
        ("Priya", "PERSON"),
        ("Project Falcon", "PROJECT"),
        ("40L", "FINANCIAL"),
        ("priya.r@henderson-logistics.com", "EMAIL"),  # also caught by rules
        ("Rajesh", "PERSON"),  # hallucinated: not in the text
    )
    body = scan(client, HENDERSON)
    rows = by_text(body)
    assert body["gemma_used"] is True
    for value in ("Henderson", "Priya", "Project Falcon", "40L"):
        assert rows[value]["source"] == "gemma"
        assert rows[value]["reason"] == "test"
    assert rows["priya.r@henderson-logistics.com"]["source"] == "rule"
    assert "reason" not in rows["priya.r@henderson-logistics.com"]
    assert "Rajesh" not in rows
    for value in rows:
        assert value not in body["sanitized_text"]


def test_gemma_bad_json_falls_back_to_rules(client, fake_gemma):
    fake_gemma.respond = lambda chunk: "Sure! I found some names."
    body = scan(client, HENDERSON)
    assert body["gemma_used"] is False
    assert len(fake_gemma.calls) == 2  # first try + one retry
    assert {e["source"] for e in body["entities"]} == {"rule"}
    assert API_KEY in by_text(body)


def test_gemma_exception_falls_back_to_rules(client, fake_gemma):
    def boom(chunk):
        raise RuntimeError("E_OUTOFMEMORY")

    fake_gemma.respond = boom
    body = scan(client, HENDERSON)
    assert body["gemma_used"] is False
    assert API_KEY in by_text(body)


def test_gemma_partial_chunk_failure_keeps_good_chunks(client, fake_gemma):
    good_line = "Ravi owns the rollout.\n"
    bad_line = "x" * 1_400 + "\n"
    fake_gemma.respond = lambda chunk: entities_json(("Ravi", "PERSON")) if "Ravi" in chunk else "not json"
    body = scan(client, good_line + bad_line)
    assert body["gemma_used"] is True
    assert by_text(body)["Ravi"]["replacement"] == "[PERSON_1]"


def test_unicode_multiline_text_is_chunked_with_correct_offsets(client, fake_gemma):
    lines = []
    for i in range(60):
        lines.append(f"Line {i}: नमस्ते — Meena approved ₹40,000 for Kovai Traders 🚀 contact m{i}@example.com")
    text = "\n".join(lines)
    assert len(text) > 3 * gemma.MAX_CHUNK_CHARS

    def respond(chunk):
        found = [(v, t) for v, t in (("Meena", "PERSON"), ("₹40,000", "FINANCIAL"), ("Kovai Traders", "ORG")) if v in chunk]
        return entities_json(*found)

    fake_gemma.respond = respond
    body = scan(client, text)

    assert len(fake_gemma.calls) > 1  # chunked
    assert all(len(call) <= gemma.MAX_CHUNK_CHARS for call in fake_gemma.calls)
    rows = by_text(body)
    assert rows["Meena"]["count"] == 60
    assert rows["₹40,000"]["count"] == 60
    assert rows["Kovai Traders"]["count"] == 60
    assert sum(1 for e in body["entities"] if e["type"] == "EMAIL") == 60

    # Rebuild the original from the sanitized text: proves every span was cut at the right offsets.
    restored = pipeline.rehydrate(pipeline.SESSIONS[body["scan_id"]], body["sanitized_text"])
    assert restored == text
    assert "नमस्ते" in body["sanitized_text"] and "🚀" in body["sanitized_text"]


def test_session_store_is_bounded(client, monkeypatch):
    monkeypatch.setattr(pipeline, "MAX_SESSIONS", 3)
    ids = [scan(client, f"mail u{i}@example.com")["scan_id"] for i in range(5)]
    assert list(pipeline.SESSIONS) == ids[-3:]


# --------------------------------------------------------------------------- /ask


def test_ask_unknown_scan_id(client, fake_cloud):
    response = client.post("/ask", json={"scan_id": "does-not-exist"})
    assert response.status_code == 404
    assert response.json()["detail"]
    assert fake_cloud.payloads == []


def test_ask_first_turn_sends_exactly_the_sanitized_text(client, fake_cloud):
    body = scan(client, HENDERSON)
    response = client.post("/ask", json={"scan_id": body["scan_id"]})
    assert response.status_code == 200
    answer = response.json()
    assert set(answer) == ASK_KEYS
    assert set(answer["timings_ms"]) == {"cloud"}
    assert answer["cloud_saw"] == body["sanitized_text"]

    [payload] = fake_cloud.payloads
    assert [m["role"] for m in payload] == ["system", "user"]
    assert "placeholders" in payload[0]["content"]
    assert payload[1]["content"] == body["sanitized_text"]


def test_ask_rehydrates_but_never_restores_secrets(client, fake_cloud):
    fake_cloud.reply = "Email [EMAIL_1] and rotate [API_KEY_1]. Ask [PERSON_9] too."
    body = scan(client, HENDERSON)
    answer = client.post("/ask", json={"scan_id": body["scan_id"]}).json()
    assert answer["cloud_response_raw"] == fake_cloud.reply
    assert answer["response"] == "Email priya.r@henderson-logistics.com and rotate [API_KEY_1]. Ask [PERSON_9] too."
    assert API_KEY not in answer["response"]


def test_follow_up_reuses_and_adds_placeholders(client, fake_cloud):
    body = scan(client, HENDERSON)
    client.post("/ask", json={"scan_id": body["scan_id"]})
    question = f"Is it {API_KEY}? Also cc priya.r@henderson-logistics.com and ops@corp.example.com"
    answer = client.post("/ask", json={"scan_id": body["scan_id"], "question": question}).json()

    assert answer["cloud_saw"] == "Is it [API_KEY_1]? Also cc [EMAIL_1] and [EMAIL_2]"
    payload = fake_cloud.payloads[-1]
    assert [m["role"] for m in payload] == ["system", "user", "assistant", "user"]
    assert payload[-1]["content"] == answer["cloud_saw"]


def test_leak_test_question(client, fake_cloud):
    fake_cloud.reply = "I only ever saw [API_KEY_1]; I don't know the real value."
    body = scan(client, HENDERSON)
    client.post("/ask", json={"scan_id": body["scan_id"]})
    answer = client.post("/ask", json={"scan_id": body["scan_id"], "question": "What was the API key exactly?"}).json()
    assert API_KEY not in answer["response"]
    assert "[API_KEY_1]" in answer["response"]


def test_cloud_never_receives_any_detected_value(client, fake_cloud, fake_gemma):
    fake_gemma.respond = lambda chunk: entities_json(("Henderson", "ORG"), ("Priya", "PERSON"), ("Project Falcon", "PROJECT"))
    body = scan(client, HENDERSON)
    client.post("/ask", json={"scan_id": body["scan_id"]})
    client.post("/ask", json={"scan_id": body["scan_id"], "question": "Draft a reply to Priya at Henderson about Project Falcon."})
    sent = fake_cloud.all_text()
    for entity in body["entities"]:
        assert entity["text"] not in sent, entity["text"]


def test_ask_empty_question_is_treated_as_first_turn(client, fake_cloud):
    body = scan(client, "mail a@b.com")
    answer = client.post("/ask", json={"scan_id": body["scan_id"], "question": "   "}).json()
    assert answer["cloud_saw"] == body["sanitized_text"]


def test_ask_question_over_limit(client, fake_cloud):
    body = scan(client, "mail a@b.com")
    response = client.post("/ask", json={"scan_id": body["scan_id"], "question": "a" * 20_001})
    assert response.status_code == 413
    assert fake_cloud.payloads == []


def test_ask_without_cloud_config_is_502(client):
    body = scan(client, "mail a@b.com")
    response = client.post("/ask", json={"scan_id": body["scan_id"]})
    assert response.status_code == 502
    assert "not configured" in response.json()["detail"]


def test_failed_cloud_call_does_not_corrupt_history(client, monkeypatch):
    monkeypatch.setenv("CLOUD_API_KEY", "k")
    monkeypatch.setenv("CLOUD_MODEL", "m")
    body = scan(client, "mail a@b.com")

    def failing(messages):
        raise cloud.CloudError("Cloud model returned HTTP 500")

    monkeypatch.setattr(cloud, "chat", failing)
    assert client.post("/ask", json={"scan_id": body["scan_id"]}).status_code == 502
    assert pipeline.SESSIONS[body["scan_id"]].messages == []


# --------------------------------------------------------------------------- real cloud.chat over a faked transport


@pytest.fixture
def cloud_env(monkeypatch):
    monkeypatch.setenv("CLOUD_BASE_URL", "https://cloud.invalid/v1")
    monkeypatch.setenv("CLOUD_API_KEY", "test-key")
    monkeypatch.setenv("CLOUD_MODEL", "fake-model")


def _response(status, payload):
    return httpx.Response(status, json=payload, request=httpx.Request("POST", "https://cloud.invalid/v1/chat/completions"))


def test_bad_cloud_key_is_502(client, cloud_env, monkeypatch):
    monkeypatch.setattr(httpx, "post", lambda *a, **k: _response(401, {"error": {"message": "Incorrect API key"}}))
    body = scan(client, "mail a@b.com")
    response = client.post("/ask", json={"scan_id": body["scan_id"]})
    assert response.status_code == 502
    assert "401" in response.json()["detail"]


def test_cloud_timeout_is_502(client, cloud_env, monkeypatch):
    def timeout(*args, **kwargs):
        raise httpx.ReadTimeout("timed out")

    monkeypatch.setattr(httpx, "post", timeout)
    body = scan(client, "mail a@b.com")
    response = client.post("/ask", json={"scan_id": body["scan_id"]})
    assert response.status_code == 502
    assert "ReadTimeout" in response.json()["detail"]


def test_cloud_unexpected_shape_is_502(client, cloud_env, monkeypatch):
    monkeypatch.setattr(httpx, "post", lambda *a, **k: _response(200, {"unexpected": True}))
    body = scan(client, "mail a@b.com")
    assert client.post("/ask", json={"scan_id": body["scan_id"]}).status_code == 502


def test_cloud_temperature_rejection_retries_without_it(client, cloud_env, monkeypatch):
    sent = []

    def post(url, headers, json, timeout):
        sent.append(dict(json))
        assert headers["Authorization"] == "Bearer test-key"
        if "temperature" in json:
            return _response(400, {"error": {"message": "Unsupported value: 'temperature'"}})
        return _response(200, {"model": "fake-model", "choices": [{"message": {"content": "ok [EMAIL_1]"}}]})

    monkeypatch.setattr(httpx, "post", post)
    body = scan(client, "mail a@b.com")
    answer = client.post("/ask", json={"scan_id": body["scan_id"]}).json()
    assert ["temperature" in payload for payload in sent] == [True, False]
    assert answer["response"] == "ok a@b.com"


# --------------------------------------------------------------------------- concurrency and the leak guard


def test_concurrent_asks_on_one_scan_are_serialized(client, fake_cloud):
    fake_cloud.delay = 0.2
    fake_cloud.reply = lambda messages: f"answer to: {messages[-1]['content']}"
    body = scan(client, "mail a@b.com")
    scan_id = body["scan_id"]
    client.post("/ask", json={"scan_id": scan_id})

    results = []

    def ask(question):
        results.append(client.post("/ask", json={"scan_id": scan_id, "question": question}).status_code)

    threads = [threading.Thread(target=ask, args=(q,)) for q in ("first question", "second question")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert results == [200, 200]
    messages = pipeline.SESSIONS[scan_id].messages
    assert [m["role"] for m in messages] == ["system", "user", "assistant", "user", "assistant", "user", "assistant"]
    # Each assistant reply sits right after the question it answers.
    for user, assistant in zip(messages[3::2], messages[4::2]):
        assert assistant["content"] == f"answer to: {user['content']}"
    # The second request saw the first one's full turn in its history.
    assert len(fake_cloud.payloads[1]) == 4 and len(fake_cloud.payloads[2]) == 6


@pytest.mark.parametrize("secret", [API_KEY, 'pa"ss\\word=1'])
def test_leak_guard_refuses_redacted_values(client, fake_cloud, monkeypatch, secret):
    body = scan(client, "mail a@b.com")
    session = pipeline.SESSIONS[body["scan_id"]]
    session.placeholder_for("API_KEY", secret)
    # Simulate a sanitizer bug that lets the raw secret through.
    monkeypatch.setattr(pipeline, "sanitize_with_session", lambda s, question: question)

    response = client.post("/ask", json={"scan_id": body["scan_id"], "question": f"use {secret}"})
    assert response.status_code == 500
    assert "Refusing to send" in response.json()["detail"]
    assert fake_cloud.payloads == []


# --------------------------------------------------------------------------- extension support: chat continuation, /rehydrate, CORS

EXTENSION_ORIGIN = "chrome-extension://abcdefghijklmnopabcdefghijklmnop"


def test_scan_continuation_keeps_placeholders_across_messages(client, fake_gemma):
    fake_gemma.respond = lambda chunk: entities_json(("Priya", "PERSON")) if "CFO" in chunk else entities_json()
    first = scan(client, "Our CFO Priya (priya@acme.example) wants the renewal numbers.")

    # Second message in the same chat: Gemma misses Priya this time, a new email appears.
    response = client.post("/scan", json={"scan_id": first["scan_id"], "text": "Tell priya and ops@acme.example; cc priya@acme.example."})
    assert response.status_code == 200
    second = response.json()

    assert second["scan_id"] == first["scan_id"]
    assert second["sanitized_text"] == "Tell [PERSON_1] and [EMAIL_2]; cc [EMAIL_1]."
    rows = by_text(second)
    assert rows["priya"]["source"] == "gemma"  # tier that originally caught it
    assert rows["ops@acme.example"]["replacement"] == "[EMAIL_2]"
    assert len(pipeline.SESSIONS) == 1


def test_scan_continuation_unknown_scan_id(client):
    response = client.post("/scan", json={"scan_id": "does-not-exist", "text": "mail a@b.com"})
    assert response.status_code == 404


def test_scan_continuation_still_validates_text(client):
    first = scan(client, "mail a@b.com")
    assert client.post("/scan", json={"scan_id": first["scan_id"], "text": "  "}).status_code == 400


def test_rehydrate_restores_pseudonyms_only(client):
    body = scan(client, f"Email a.b@example.com, key {API_KEY}")
    reply = "Write to [EMAIL_1] and rotate [API_KEY_1]; [PERSON_9] is unknown."
    response = client.post("/rehydrate", json={"scan_id": body["scan_id"], "text": reply})
    assert response.status_code == 200
    assert response.json() == {
        "scan_id": body["scan_id"],
        "text": "Write to a.b@example.com and rotate [API_KEY_1]; [PERSON_9] is unknown.",
    }


def test_rehydrate_errors(client):
    body = scan(client, "mail a@b.com")
    assert client.post("/rehydrate", json={"scan_id": "nope", "text": "[EMAIL_1]"}).status_code == 404
    assert client.post("/rehydrate", json={"scan_id": body["scan_id"]}).status_code == 422
    too_long = "x" * (main.MAX_REHYDRATE_CHARS + 1)
    assert client.post("/rehydrate", json={"scan_id": body["scan_id"], "text": too_long}).status_code == 413
    # Long cloud answers are fine as long as they are under the rehydrate limit.
    long_ok = "[EMAIL_1] " * 5_000
    assert client.post("/rehydrate", json={"scan_id": body["scan_id"], "text": long_ok}).status_code == 200


def test_extension_flow_end_to_end(client, fake_gemma):
    """Scan -> user sends sanitized text to ChatGPT -> rehydrate reply -> next message -> rehydrate."""
    fake_gemma.respond = lambda chunk: entities_json(("Priya", "PERSON"), ("Henderson", "ORG"), ("Project Falcon", "PROJECT"))

    turn1 = scan(client, HENDERSON)
    chatgpt_reply1 = "Dear [PERSON_1], we can keep [ORG_1] if [PROJECT_1] ships. I can't see [API_KEY_1]."
    shown1 = client.post("/rehydrate", json={"scan_id": turn1["scan_id"], "text": chatgpt_reply1}).json()["text"]
    assert shown1 == "Dear Priya, we can keep Henderson if Project Falcon ships. I can't see [API_KEY_1]."

    turn2 = client.post("/scan", json={"scan_id": turn1["scan_id"], "text": "Make it warmer for Priya at Henderson."}).json()
    assert turn2["sanitized_text"] == "Make it warmer for [PERSON_1] at [ORG_1]."
    shown2 = client.post("/rehydrate", json={"scan_id": turn1["scan_id"], "text": "Hi [PERSON_1], thanks for trusting us."}).json()["text"]
    assert shown2 == "Hi Priya, thanks for trusting us."

    for sent in (turn1["sanitized_text"], turn2["sanitized_text"]):
        for value in ("Priya", "Henderson", "Project Falcon", API_KEY, "priya.r@henderson-logistics.com"):
            assert value not in sent


@pytest.mark.parametrize(
    "origin, allowed",
    [
        (EXTENSION_ORIGIN, True),
        ("http://localhost:3000", True),
        ("http://127.0.0.1:3000", True),
        ("https://evil.example", False),
        ("https://chatgpt.com", False),  # the extension must call from its background worker, not the page
    ],
)
def test_cors_allows_ui_and_extension_only(client, origin, allowed):
    preflight = client.options(
        "/scan",
        headers={"Origin": origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type"},
    )
    simple = client.post("/scan", json={"text": "mail a@b.com"}, headers={"Origin": origin})
    assert (preflight.headers.get("access-control-allow-origin") == origin) is allowed
    assert (simple.headers.get("access-control-allow-origin") == origin) is allowed
