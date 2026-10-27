"""v2 HTTP endpoints: agent runs, firewall scan, sandbox, extended /health. The fake world comes from test_agent."""

import time

import pytest
from fastapi.testclient import TestClient

from backend import agent, firewall, gemma, main, pipeline, tools_sandbox
from backend.tests.test_agent import (  # noqa: F401  (fixtures)
    CANARY,
    PAGE,
    PAGE_URL,
    TASK_PAGE,
    _rules_only_scripted,
    world,
)


@pytest.fixture(autouse=True)
def _isolate(monkeypatch):
    monkeypatch.setattr(gemma, "_status", "disabled")
    pipeline.SESSIONS.clear()
    yield
    pipeline.SESSIONS.clear()


@pytest.fixture
def client():
    return TestClient(main.app)  # no `with`: skips the lifespan, so no Gemma load


def wait_for(client, run_id, timeout=5.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        run = client.get(f"/agent/runs/{run_id}").json()
        if run["status"] != "running":
            return run
        time.sleep(0.01)
    pytest.fail("run did not finish")


# --------------------------------------------------------------------------- /health


def test_health_keeps_v1_keys_and_adds_firewall_and_agent(client, monkeypatch):
    monkeypatch.setattr(firewall, "gemma_injection_available", lambda: True)
    body = client.get("/health").json()
    assert {"ok", "gemma_loaded", "gemma_status", "model_alias", "cloud_configured"} <= set(body)
    assert body["firewall"] == {"rules": True, "gemma_injection": True}
    assert body["agent"] == {"provider": "scripted", "model": "scripted-demo-agent"}


def test_health_reports_the_cloud_agent_when_configured(client, monkeypatch):
    monkeypatch.setenv("CLOUD_API_KEY", "k")
    monkeypatch.setenv("CLOUD_MODEL", "gpt-test")
    assert client.get("/health").json()["agent"] == {"provider": "openai", "model": "gpt-test"}


# --------------------------------------------------------------------------- /agent/run


def test_agent_run_then_poll(client, world):
    response = client.post("/agent/run", json={"task": TASK_PAGE, "mode": "full"})
    assert response.status_code == 200
    run_id = response.json()["run_id"]
    assert set(response.json()) == {"run_id"}

    run = wait_for(client, run_id)
    assert run["status"] == "done" and run["mode"] == "full" and run["run_id"] == run_id
    assert run["summary"]["attacker_reached"] is False
    assert [m["to"] for m in run["outbox_delta"]] == ["priya@acme.test"]


def test_agent_run_raw_shows_the_attack(client, world):
    run = wait_for(client, client.post("/agent/run", json={"task": TASK_PAGE, "mode": "raw"}).json()["run_id"])
    assert run["summary"]["leaked_canary"] is True


@pytest.mark.parametrize("body", [{"task": "hi", "mode": "turbo"}, {"task": "hi", "mode": ""}, {"task": "  ", "mode": "raw"}, {"task": "", "mode": "full"}])
def test_agent_run_rejects_bad_input_with_400(client, world, body):
    assert client.post("/agent/run", json=body).status_code == 400


def test_agent_run_rejects_oversized_tasks_with_413(client, world):
    response = client.post("/agent/run", json={"task": "x" * (main.MAX_TEXT_CHARS + 1), "mode": "raw"})
    assert response.status_code == 413


def test_agent_run_missing_fields_is_a_422(client, world):
    assert client.post("/agent/run", json={"task": "hi"}).status_code == 422
    assert client.post("/agent/run", json={"mode": "raw"}).status_code == 422


def test_unknown_run_is_404(client):
    assert client.get("/agent/runs/doesnotexist").status_code == 404


# --------------------------------------------------------------------------- /agent/compare


def test_compare_starts_three_runs_that_tell_the_story(client, world):
    response = client.post("/agent/compare", json={"task": TASK_PAGE})
    assert response.status_code == 200
    ids = response.json()["run_ids"]
    assert set(ids) == {"raw", "v1", "full"} and len(set(ids.values())) == 3

    runs = {mode: wait_for(client, run_id) for mode, run_id in ids.items()}
    assert [r["mode"] for r in runs.values()] == ["raw", "v1", "full"]
    assert runs["raw"]["summary"]["leaked_canary"] is True
    assert runs["v1"]["summary"]["leaked_canary"] is False and runs["v1"]["summary"]["attacker_reached"] is True
    assert runs["full"]["summary"]["attacker_reached"] is False
    assert [m["to"] for m in runs["full"]["outbox_delta"]] == ["priya@acme.test"]


def test_compare_validates_the_task(client, world):
    assert client.post("/agent/compare", json={"task": " "}).status_code == 400
    assert client.post("/agent/compare", json={"task": "x" * (main.MAX_TEXT_CHARS + 1)}).status_code == 413


# --------------------------------------------------------------------------- /firewall/scan


def test_firewall_scan_passes_through_the_result(client, monkeypatch):
    calls = []

    def fake_scan(tool, content, content_type="text"):
        calls.append((tool, content, content_type))
        return {"verdict": "ALLOW", "findings": [], "content_for_model": content, "visible_text": content,
                "timings_ms": {"rules": 1, "gemma": 0}, "gemma_used": False}

    monkeypatch.setattr(firewall, "scan_result", fake_scan)
    body = client.post("/firewall/scan", json={"content": "<p>hi</p>", "content_type": "html", "tool": "fetch_page"}).json()
    assert body["verdict"] == "ALLOW"
    assert calls == [("fetch_page", "<p>hi</p>", "html")]

    client.post("/firewall/scan", json={"content": "just text"})
    assert calls[-1] == ("paste", "just text", "text")


@pytest.mark.parametrize(
    ("body", "status"),
    [
        ({"content": ""}, 400),
        ({"content": "   "}, 400),
        ({"content": "x", "content_type": "pdf"}, 400),
        ({"content": "x" * 200_001}, 413),
        ({}, 422),
    ],
)
def test_firewall_scan_validation(client, body, status):
    assert client.post("/firewall/scan", json=body).status_code == status


def test_firewall_scan_accepts_up_to_200k_characters(client, monkeypatch):
    monkeypatch.setattr(firewall, "scan_result", lambda tool, content, content_type="text": {"verdict": "ALLOW", "findings": []})
    assert client.post("/firewall/scan", json={"content": "x" * 200_000}).status_code == 200


# --------------------------------------------------------------------------- /sandbox


def test_sandbox_outbox_and_reset(client, world):
    assert client.get("/sandbox/outbox").json() == {"outbox": []}
    run = agent.run_sync(TASK_PAGE, "raw")
    outbox = client.get("/sandbox/outbox").json()["outbox"]
    assert len(outbox) == len(run["outbox_delta"]) == 2
    assert client.post("/sandbox/reset").json() == {"ok": True}
    assert client.get("/sandbox/outbox").json() == {"outbox": []}


def test_sandbox_samples_passthrough(client, monkeypatch):
    sample = {"scenarios": [{"id": "hidden-css"}], "pages": []}
    monkeypatch.setattr(tools_sandbox, "samples", lambda: sample)
    assert client.get("/sandbox/samples").json() == sample


def test_sandbox_page(client, monkeypatch):
    monkeypatch.setattr(tools_sandbox, "page_html", lambda url: PAGE if url == PAGE_URL else None)
    assert client.get("/sandbox/page", params={"url": PAGE_URL}).json() == {"url": PAGE_URL, "html": PAGE}
    assert client.get("/sandbox/page", params={"url": "https://nope.test/x"}).status_code == 404
    assert client.get("/sandbox/page").status_code == 422


# --------------------------------------------------------------------------- CORS and v1 untouched


def test_cors_allows_get_and_post_from_the_web_ui(client):
    for method in ("GET", "POST"):
        response = client.options(
            "/agent/run", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": method}
        )
        assert response.status_code == 200
        assert method in response.headers["access-control-allow-methods"]
    blocked = client.options("/agent/run", headers={"Origin": "http://evil.test", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in blocked.headers


def test_v1_prompt_is_still_exported_from_main():
    assert "placeholders" in main.CLOUD_SYSTEM_PROMPT
