# Airlock — Project Context

> Commit this file as `docs/AIRLOCK_CONTEXT.md`. It is the single source of truth for the team and for every AI coding agent working in this repo.
> 
> Agents: read this file, `AGENTS.md`, and your own task file before writing code. Only touch the files your task file assigns to you.

**Event:** MLH Hacktoberfest Hack Day — Coimbatore 2026 (INIT Club × iDEA Club, Amrita). Main track: Best Open-Source AI Project. Partner challenge: Best Use of Gemma 4.

**Repo:** [https://github.com/vishalm342/Supes_MLH_Hack](https://github.com/vishalm342/Supes_MLH_Hack)

**Team:** 4 people. Commit at least once per hour each (commit history is reviewed).

---

## 1. Problem

People paste private information into cloud AI every day: customer names, emails, phone numbers, API keys, passwords, internal server addresses, medical and financial details, screenshots of internal dashboards.

Organisations end up choosing between **banning AI** (lost productivity, people use it secretly anyway) or **allowing it** (sensitive data leaves with every paste).

Pattern-based filters catch `sk-...` keys and emails, but miss context:

> *"The Henderson account is about to churn — their CFO Priya says the ₹40L renewal is off unless Project Falcon ships."*

Nothing in that sentence matches a regex, yet almost all of it is sensitive. Catching it needs a model that understands context — and that model has to run **locally**, otherwise the scanner itself becomes the leak.

## 2. Solution

**Airlock is a local privacy gateway between your private data and cloud AI.**

```
PRIVATE PROMPT
     │
     ▼
 AIRLOCK (runs on our machine)
     ├─ Tier 1: deterministic rules (regex, entropy, Luhn)
     ├─ Tier 2: Gemma 4 — local, contextual detection
     ├─ merge + risk scoring
     └─ context-preserving pseudonymization  (Priya → [PERSON_1])
     │
     ▼
 SANITIZED PROMPT ──► CLOUD MODEL (powerful, but only sees placeholders)
                              │
                              ▼
 ANSWER WITH PLACEHOLDERS ──► AIRLOCK rehydrates locally ([PERSON_1] → Priya)
                              │
                              ▼
                     USER SEES REAL ANSWER
```

**Model roles — both essential:**

Model
Runs
Job

**Gemma 4 E2B IT** (open-weight, Apache 2.0)
Locally via Foundry Local SDK
Sees the raw private text and decides what is sensitive. Must never leave the machine.

**Cloud model** (via API key)
Cloud
Does the actual hard task (answer, debug, draft). Only ever receives sanitized text.

**Key properties:**

- **Context-preserving:** placeholders are typed and numbered (`[PERSON_1]`, `[EMAIL_2]`), not `[REDACTED]`, so the cloud model can still reason.
- **Stable identity:** the same value always gets the same placeholder within a session.
- **Rehydration:** the cloud's answer is restored locally — the user sees real names; the cloud never did.
- **Secrets never come back:** credentials, cards and IDs are redacted and never rehydrated.

**Pitch:** *"Use the most powerful AI without handing it your private data. Gemma decides what's private on your machine; the cloud only ever sees placeholders."*

## 3. Honest Claims Only

Say: "a local privacy-assistance layer", "reduces exposure", "detection is not perfect — rules plus a small local model".

Never say: perfect detection, zero leakage, guaranteed anonymity, production-grade, HIPAA/GDPR/DPDP compliant.

Never invent metrics. Only report numbers we actually measured.

---

## 4. Repository Layout (target)

```
.
├── README.md                # organisers' submission template, filled in
├── AGENTS.md                # organisers' agent rules (copied from template repo)
├── CLAUDE.md                # contains: @AGENTS.md
├── LICENSE                  # Apache-2.0
├── .env.example
├── .gitignore
├── docs/
│   └── AIRLOCK_CONTEXT.md   # this file
├── samples/
│   └── demo_samples.json    # fixed demo inputs
├── eval/
│   └── dataset.jsonl        # labelled prompts for the recall evaluation
├── backend/                 # FastAPI, run from repo root
│   ├── __init__.py
│   ├── main.py              # FastAPI app + endpoints          (Rahul)
│   ├── gemma.py             # local Gemma 4 load + detection   (Rahul)
│   ├── pipeline.py          # merge, placeholders, rehydration (Rahul)
│   ├── cloud.py             # cloud model client               (Rahul)
│   ├── rules.py             # Tier 1 deterministic detectors   (Teammate A)
│   ├── risk.py              # risk scoring                     (Teammate A)
│   ├── requirements.txt     #                                  (Teammate B)
│   ├── requirements-dev.txt #                                  (Teammate A)
│   └── tests/               #                                  (Teammate A)
└── frontend/                # Next.js                          (Frontend owner)
```

## 5. Ownership & Task Files

Owner
Task file
Scope

Rahul
`TASK_RAHUL_CORE.md`
Gemma, pipeline, cloud, FastAPI endpoints — the complex core

Frontend owner
`TASK_FRONTEND.md`
The single-screen Next.js app

Teammate A
`TASK_TEAMMATE_A_RULES.md`
`rules.py`, `risk.py`, tests

Teammate B
`TASK_TEAMMATE_B_SETUP.md`
Repo setup, licence, README skeleton, samples, eval dataset

Branches: `feat/core`, `feat/frontend`, `feat/rules`, `chore/repo-setup`. Small PRs into `main`. Do not edit files you don't own; if you need a change in someone else's file, tell them.

---

## 6. Shared Contracts (FROZEN — do not change without telling the whole team)

### 6.1 Entity types

```
PERSON, ORG, EMAIL, PHONE, ADDRESS, LOCATION, GOV_ID, FINANCIAL, MEDICAL, HR,
PROJECT, INTERNAL_URL, IP_ADDRESS, API_KEY, PASSWORD, JWT, CARD, OTHER
```

**Redacted types** (never rehydrated, shown to the user as the placeholder): `API_KEY, PASSWORD, JWT, CARD, GOV_ID`.

All other types are **pseudonymized** (rehydrated in the answer).

### 6.2 Placeholder format

`[TYPE_N]` — e.g. `[PERSON_1]`, `[EMAIL_2]`, `[API_KEY_1]`. Numbering is per type, starting at 1, stable per value within a scan session.

### 6.3 Python function interfaces

```
# backend/rules.py  (Teammate A)
def detect(text: str) -> list[dict]:
    """Return [{"type": str, "text": str, "start": int, "end": int}], sorted by start.
    text == original_text[start:end]. No overlapping spans."""

# backend/risk.py  (Teammate A)
def entity_risk(entity_type: str) -> str:            # "LOW" | "MEDIUM" | "HIGH"
def overall_risk(entity_types: list[str]) -> str:    # "NONE" | "LOW" | "MEDIUM" | "HIGH"

# backend/gemma.py  (Rahul)
def detect(text: str) -> list[dict]:                 # [{"type", "text", "reason"}] — text is an exact substring
```

### 6.4 HTTP API (backend base URL: `http://<host>:8000`)

**`GET /health`**

```
{ "ok": true, "gemma_loaded": true, "gemma_status": "loaded", "model_alias": "gemma-4-e2b-it", "cloud_configured": true }
```
- `gemma_status` (additive): `"disabled"` (GEMMA_ENABLED=false), `"loading"` (the first ~47 s after startup; Gemma loads in the background), `"loaded"`, or `"failed"` (rules-only).

**`POST /scan`**

Request:

```
{ "text": "My customer Priya's email is priya@example.com and the key is sk_live_abc123XYZ..." }
```

Optional `"scan_id"`: continue that session (the next message in the same chat). Placeholders keep their numbers, values already in the session are masked even if not re-detected, and the response's `scan_id` is unchanged. Unknown `scan_id` → 404.

Response:

```
{
  "scan_id": "uuid",
  "risk": "HIGH",
  "entities": [
    { "type": "PERSON",  "text": "Priya",             "replacement": "[PERSON_1]",  "risk": "MEDIUM", "source": "gemma", "redacted": false, "count": 1 },
    { "type": "EMAIL",   "text": "priya@example.com", "replacement": "[EMAIL_1]",   "risk": "HIGH",   "source": "rule",  "redacted": false, "count": 1 },
    { "type": "API_KEY", "text": "sk_live_abc123XYZ...", "replacement": "[API_KEY_1]", "risk": "HIGH", "source": "rule", "redacted": true, "count": 1 }
  ],
  "sanitized_text": "My customer [PERSON_1]'s email is [EMAIL_1] and the key is [API_KEY_1]",
  "gemma_used": true,
  "timings_ms": { "rules": 2, "gemma": 3400, "total": 3410 }
}
```

- `source`: `"rule"` or `"gemma"` — the UI shows which tier caught each item.
- `count`: occurrences replaced in the text.
- If Gemma is unavailable or fails, `gemma_used` is `false` and the scan still returns rule results.
- While Gemma is still loading (`gemma_status: "loading"`), `/scan` returns **503** instead of silently scanning rules-only.
- Entities caught by Gemma may carry an optional `reason` string.

**`POST /ask`**

Request:

```
{ "scan_id": "uuid", "question": "optional follow-up, e.g. 'What was the API key?'" }
```

- First call with no `question`: sends the scan's `sanitized_text` to the cloud model.
- Follow-up calls with `question`: the question is sanitized with the same placeholder map and the conversation continues.

Response:

```
{
  "scan_id": "uuid",
  "cloud_model": "model-name",
  "cloud_saw": "the exact sanitized user message sent to the cloud this turn",
  "cloud_response_raw": "answer containing [PERSON_1] ...",
  "response": "answer with Priya restored; [API_KEY_1] stays as is",
  "timings_ms": { "cloud": 2100 }
}
```

**`POST /rehydrate`** (for the browser extension, which reads replies from the AI site itself)

Request: `{ "scan_id": "uuid", "text": "Dear [PERSON_1], ... [API_KEY_1]" }`

Response: `{ "scan_id": "uuid", "text": "Dear Priya, ... [API_KEY_1]" }`. Same rules as `/ask`'s `response`: redacted types and unknown placeholders stay as-is. Text up to 200,000 chars (413 above).

**Errors:** `{ "detail": "message" }` with HTTP 4xx/5xx. Unknown `scan_id` → 404.

**CORS:** only the origins in `CORS_ORIGINS` (default: the local web UI) and `CORS_ORIGIN_REGEX` (default: Chrome extensions) may call the API from a browser.

---

## 7. Environment Variables (`.env.example`)

```
# Cloud model (OpenAI-compatible chat/completions endpoint)
CLOUD_BASE_URL=https://api.openai.com/v1
CLOUD_API_KEY=
CLOUD_MODEL=

# Local Gemma
GEMMA_ENABLED=true            # set false on machines without the model; rules-only mode
GEMMA_MODEL_ALIAS=gemma-4-e2b-it

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:8000
```

Never commit `.env`.

## 8. Pre-Event Code

Before the Hack Day we had a Gradio test app (`main.py`) and a model download helper used to benchmark Gemma 4 on our machine. `backend/gemma.py` reuses their Foundry Local loading and response-extraction logic, and the README states this honestly. Both files have since been removed from the repo; all Airlock features are built during the event.

## 9. Measured Gemma Facts (our machine)

- Model: Gemma 4 E2B IT, alias `gemma-4-e2b-it`, ONNX via WebGPU, run with Foundry Local SDK, cache ~6.9 GiB.
- Model load: ~47 s → **must load at server startup**, never per request.
- Image requests: ~8–12 s each on simple synthetic images. Text-only latency: to be measured.
- One model instance → one inference at a time (backend uses a lock).

## 10. Running

```
# backend (from repo root, on the machine with Gemma)
python -m venv .venv && .venv/Scripts/activate        # Windows; use source .venv/bin/activate on macOS/Linux
pip install -r backend/requirements.txt
uvicorn backend.main:app --host 0.0.0.0 --port 8000

# backend without Gemma (any teammate machine)
GEMMA_ENABLED=false uvicorn backend.main:app --host 0.0.0.0 --port 8000

# frontend
cd frontend && npm install && npm run dev -- -H 0.0.0.0
```

Teammates can point their frontend at Rahul's backend: `NEXT_PUBLIC_API_URL=http://<rahul-lan-ip>:8000`.

## 11. Timeline (today)

Time
Milestone

by 14:00
Every branch has a first commit. Teammate B's setup PR merged.

by 14:30
`rules.py` merged. Frontend works against mock data. Backend `/scan` works rules-only.

**15:00**
**MVP:** frontend → `/scan` (rules + Gemma) → `/ask` (cloud) → rehydrated answer on screen.

15:00–16:00
Stretch: screenshot scanning (Gemma vision), recall eval numbers, UI polish.

16:00
Feature freeze. Rehearse demo, record video, finish README, submit (tick Gemma 4 challenge).

## 12. Demo Script (≤ 2.5 min)

1. **Problem (20s):** "Every paste into cloud AI can leak customers and secrets. Regex can't understand context."
2. **Scan offline (40s):** Turn Wi-Fi off. Paste the Henderson sample. Scan Locally → entities appear, Gemma-caught items badged. Risk HIGH. "No internet — this happened on this laptop."
3. **Ask safely (40s):** Wi-Fi on. Ask Safely → show *what the cloud saw* (placeholders) next to *what you see* (real names restored).
4. **Leak test (20s):** Follow-up: "What was the API key?" → the cloud can't know; it never had it.
5. **Architecture (20s):** Rules for certainty, Gemma for context, cloud for intelligence. Local model is the gatekeeper.

## 13. Out of Scope Today

Auth, databases, Docker, Ollama migration, browser extension (roadmap only unless MVP is done early), multi-user admin, fine-tuning, RAG.
