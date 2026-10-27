import logging
import os
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

_BACKEND_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _BACKEND_DIR.parent
# Support both documented package launches (from the repo root) and the common
# `cd backend && uvicorn main:app` launch. Internal modules import `backend.*`.
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

load_dotenv(_REPO_ROOT / ".env")

from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from backend import agent, cloud, firewall, gemma, pipeline, tools_sandbox  # noqa: E402
from backend.cloud import CLOUD_SYSTEM_PROMPT  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s: %(message)s", datefmt="%H:%M:%S")


class _QuietPolling(logging.Filter):
    """Hide the UI's constant polling (CORS preflights, /health, run status) from uvicorn's access log.

    Failed requests and everything else (scans, agent runs) still log."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            _client, method, path, _http, status = record.args
        except (TypeError, ValueError):
            return True
        if int(status) >= 400:
            return True
        return not (method == "OPTIONS" or path == "/health" or str(path).startswith("/agent/runs/"))


logging.getLogger("uvicorn.access").addFilter(_QuietPolling())

MAX_TEXT_CHARS = 20_000
# Cloud answers can be longer than prompts; this only bounds /rehydrate input.
MAX_REHYDRATE_CHARS = 200_000
# Content pasted into /firewall/scan (a whole web page or email).
MAX_FIREWALL_CHARS = 200_000
CONTENT_TYPES = ("html", "text", "email")

# Browser origins allowed to call the API. Default: the local web UI and any Chrome
# extension. Without this, any website open in the browser could call localhost:8000.
DEFAULT_CORS_ORIGINS = "http://localhost:3000,http://127.0.0.1:3000"
DEFAULT_CORS_ORIGIN_REGEX = r"chrome-extension://[a-p]{32}"

@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Gemma takes ~47 s to load; load it in the background so /health answers
    # immediately and /scan can return 503 until it is ready.
    if gemma.remote_url():
        # The backend is the process that owns Gemma; pointing it at another backend (or itself) would loop.
        logging.getLogger("veil.api").warning("Ignoring GEMMA_REMOTE_URL in the backend; it is meant for the MCP server.")
        os.environ.pop("GEMMA_REMOTE_URL", None)
    gemma.start_background_load()
    yield
    gemma.shutdown()


app = FastAPI(title="VEIL API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("CORS_ORIGINS", DEFAULT_CORS_ORIGINS).split(",") if o.strip()],
    allow_origin_regex=os.getenv("CORS_ORIGIN_REGEX", DEFAULT_CORS_ORIGIN_REGEX) or None,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


class ScanRequest(BaseModel):
    text: str
    # Continue an existing session (e.g. the next message in the same chat) so placeholders stay stable.
    scan_id: str | None = None


class AskRequest(BaseModel):
    scan_id: str
    question: str | None = None


class RehydrateRequest(BaseModel):
    scan_id: str
    text: str


class AgentRunRequest(BaseModel):
    task: str
    mode: str


class AgentCompareRequest(BaseModel):
    task: str


class FirewallScanRequest(BaseModel):
    content: str
    content_type: str = "text"
    tool: str = "paste"


class GemmaRunRequest(BaseModel):
    kind: str
    text: str


def _get_session(scan_id: str) -> pipeline.Session:
    session = pipeline.SESSIONS.get(scan_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Unknown scan_id.")
    return session


def _check_text(text: str) -> None:
    if not text.strip():
        raise HTTPException(status_code=400, detail="Text must not be empty.")
    if len(text) > MAX_TEXT_CHARS:
        raise HTTPException(status_code=413, detail=f"Text exceeds {MAX_TEXT_CHARS} characters.")


@app.get("/")
def read_root() -> dict[str, str]:
    return {"message": "API is running"}


@app.post("/gemma/run")
def gemma_run(body: GemmaRunRequest) -> dict:
    """Run one of VEIL's two Gemma prompts for a local VEIL MCP server, so it can share this process's model.

    Only the injection and private-data prompts can run, with their own output caps; arbitrary prompts are refused.
    Answers are cached like any other Gemma call.
    """

    prompts = {
        "injection": (gemma.INJECTION_SYSTEM_PROMPT, gemma.INJECTION_MAX_TOKENS),
        "private-data": (gemma.DETECT_SYSTEM_PROMPT, gemma.DETECT_MAX_TOKENS),
    }
    if body.kind not in prompts:
        raise HTTPException(status_code=400, detail="kind must be 'injection' or 'private-data'.")
    _check_text(body.text)
    if not gemma.is_loaded():
        raise HTTPException(status_code=503, detail="Gemma is not loaded yet.")
    system, cap = prompts[body.kind]
    return {"answer": gemma.generate(system, body.text, max_tokens=cap)}


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "gemma_loaded": gemma.is_loaded(),
        "gemma_status": gemma.status(),
        "model_alias": gemma.model_alias(),
        "cloud_configured": cloud.is_configured(),
        "firewall": {"rules": True, "gemma_injection": firewall.gemma_injection_available()},
        "agent": {"provider": cloud.agent_provider(), "model": cloud.agent_model()},
    }


@app.post("/scan")
def scan(body: ScanRequest) -> dict:
    _check_text(body.text)
    if gemma.status() == "loading":
        raise HTTPException(status_code=503, detail="Gemma is still loading (about a minute after startup). Try again shortly.")
    if body.scan_id is None:
        return pipeline.scan(body.text)
    session = _get_session(body.scan_id)
    with session.lock:
        return pipeline.scan(body.text, session)


@app.post("/rehydrate")
def rehydrate(body: RehydrateRequest) -> dict:
    """Restore placeholders in text produced elsewhere (e.g. a ChatGPT reply read by the extension)."""
    session = _get_session(body.scan_id)
    if len(body.text) > MAX_REHYDRATE_CHARS:
        raise HTTPException(status_code=413, detail=f"Text exceeds {MAX_REHYDRATE_CHARS} characters.")
    return {"scan_id": session.scan_id, "text": pipeline.rehydrate(session, body.text)}


@app.post("/ask")
def ask(body: AskRequest) -> dict:
    session = _get_session(body.scan_id)

    with session.lock:
        if body.question is not None and body.question.strip():
            _check_text(body.question)
            cloud_saw = pipeline.sanitize_with_session(session, body.question)
        else:
            cloud_saw = session.sanitized_text

        outgoing = list(session.messages)
        if not outgoing:
            outgoing.append({"role": "system", "content": CLOUD_SYSTEM_PROMPT})
        outgoing.append({"role": "user", "content": cloud_saw})

        # Last line of defence: no redacted secret may ever leave the machine.
        contents = [message["content"] for message in outgoing]
        for secret in session.redacted_values():
            if any(secret in content for content in contents):
                raise HTTPException(status_code=500, detail="Refusing to send: redacted value found in outgoing payload.")

        started = time.perf_counter()
        try:
            answer, model_name = cloud.chat(outgoing)
        except cloud.CloudError as error:
            raise HTTPException(status_code=502, detail=str(error)) from error
        cloud_ms = round((time.perf_counter() - started) * 1000)

        outgoing.append({"role": "assistant", "content": answer})
        session.messages = outgoing

        return {
            "scan_id": session.scan_id,
            "cloud_model": model_name,
            "cloud_saw": cloud_saw,
            "cloud_response_raw": answer,
            "response": pipeline.rehydrate(session, answer),
            "timings_ms": {"cloud": cloud_ms},
        }


# --------------------------------------------------------------------------- agent, firewall, sandbox


@app.post("/agent/run")
def agent_run(body: AgentRunRequest) -> dict:
    if body.mode not in agent.MODES:
        raise HTTPException(status_code=400, detail=f"mode must be one of: {', '.join(agent.MODES)}.")
    _check_text(body.task)
    return {"run_id": agent.start_run(body.task, body.mode)}


@app.post("/agent/compare")
def agent_compare(body: AgentCompareRequest) -> dict:
    """Start the same task in both modes (raw, full) at once."""
    _check_text(body.task)
    return {"run_ids": {mode: agent.start_run(body.task, mode) for mode in agent.MODES}}


@app.get("/agent/runs/{run_id}")
def agent_get_run(run_id: str) -> dict:
    run = agent.get_run(run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Unknown run_id.")
    return run


@app.post("/firewall/scan")
def firewall_scan(body: FirewallScanRequest) -> dict:
    if not body.content.strip():
        raise HTTPException(status_code=400, detail="Content must not be empty.")
    if len(body.content) > MAX_FIREWALL_CHARS:
        raise HTTPException(status_code=413, detail=f"Content exceeds {MAX_FIREWALL_CHARS} characters.")
    if body.content_type not in CONTENT_TYPES:
        raise HTTPException(status_code=400, detail=f"content_type must be one of: {', '.join(CONTENT_TYPES)}.")
    return firewall.scan_result(body.tool or "paste", body.content, body.content_type)


@app.get("/sandbox/outbox")
def sandbox_outbox() -> dict:
    return {"outbox": tools_sandbox.get_outbox()}


@app.post("/sandbox/reset")
def sandbox_reset() -> dict:
    tools_sandbox.reset()
    return {"ok": True}


@app.get("/sandbox/samples")
def sandbox_samples() -> dict:
    return tools_sandbox.samples()


@app.get("/sandbox/page")
def sandbox_page(url: str) -> dict:
    html = tools_sandbox.page_html(url)
    if html is None:
        raise HTTPException(status_code=404, detail="Unknown sandbox URL.")
    return {"url": url, "html": html}
