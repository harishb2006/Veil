# Run Airlock locally

Step-by-step setup for a team laptop, from clone to the live demo, plus a demo-day checklist and fixes for
common problems. Airlock is two local processes: a **FastAPI backend** on port 8000 and a **Next.js web
console** on port 3000. Nothing is hosted; no real email is sent and no shell command is executed.

## 1. Prerequisites

| Need | Version | Check |
| --- | --- | --- |
| Git | any | `git --version` |
| Python | 3.11 or newer | `python --version` (or `python3 --version`) |
| Node.js + npm | Node 20 or newer | `node --version` |
| Gemma 4 (optional) | Microsoft Foundry Local, model alias `gemma-4-e2b-it` | see §4 |
| Cloud model key (optional) | any OpenAI-compatible API with tool calling | only for a real-model agent |

Without Gemma, Airlock runs **rules-only**. Without a cloud key, the live demo uses the built-in **scripted
demo agent**. Both are fine for the demo.

## 2. Clone

```bash
git clone https://github.com/rahulrr-coder/Agents-Firewall.git
cd Agents-Firewall
```

## 3. Backend (terminal 1)

```bash
python -m venv .venv
# macOS / Linux
source .venv/bin/activate
# Windows (PowerShell)
.venv\Scripts\Activate.ps1

pip install -r backend/requirements.txt
cp .env.example .env            # Windows: copy .env.example .env
```

Open `.env` and pick a mode:

| Goal | Set in `.env` |
| --- | --- |
| Quickest start (no Gemma, no key) | `GEMMA_ENABLED=false` and leave `CLOUD_API_KEY` empty |
| With Gemma 4 (recommended for the jury) | `GEMMA_ENABLED=true` (see §4) |
| Real cloud model as the agent | `CLOUD_BASE_URL`, `CLOUD_API_KEY`, `CLOUD_MODEL` (must support tool calling); leave `AGENT_PROVIDER` empty |
| Force the scripted demo agent even with a key | `AGENT_PROVIDER=scripted` |

Start it **from the repo root** (not from inside `backend/`):

```bash
uvicorn backend.main:app --port 8000
```

Check it: open <http://localhost:8000/health>. You should see `"ok": true`, a `firewall` block and an
`agent` block. With Gemma enabled, `gemma_status` goes from `loading` to `loaded` in about a minute.

## 4. Gemma 4 (optional, for the Gemma track)

Airlock loads Gemma through the Foundry Local Python SDK (`foundry-local-sdk`, already in
`backend/requirements.txt`). On first start with `GEMMA_ENABLED=true` it registers the WebGPU execution
provider and downloads `gemma-4-e2b-it` if it isn't cached, so **do the first run on good Wi-Fi the day
before**. If the SDK can't find a runtime on your machine, install Microsoft Foundry Local from
<https://github.com/microsoft/Foundry-Local> and start the backend again.

- Model cache: `~/.foundry` (shared with other Foundry Local apps).
- Use a different alias with `GEMMA_MODEL_ALIAS=...`.
- If Gemma fails to load, the backend logs the error and keeps running rules-only; the header in the UI says
  "rules-only".
- **Offline at the venue:** start the backend while online, wait until `/health` shows
  `"gemma_status": "loaded"`, and only then turn Wi-Fi off. The SDK looks up its model catalog at startup; in
  our v1 testing it crashed when that lookup had no network.

## 5. Web console (terminal 2)

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:3000>. Pages: **Overview** `/`, **Live demo** `/agent`, **Firewall lab** `/lab`,
**Privacy** `/privacy` (the v1 inner door), **Get started** `/start`.

For a smoother demo use a production build: `npm run build && npm run start`.

The frontend calls `http://localhost:8000` by default. To change it, create `frontend/.env.local` with
`NEXT_PUBLIC_API_URL=http://<host>:8000`.

## 6. Try it

1. Open **Live demo**. *The poisoned product page* is preselected. Press **R** (Run comparison).
2. Watch the three columns: Raw emails the real key to `attacker@evil.test`; Airlock v1 leaks only
   `[API_KEY_1]`; Full Airlock removes the hidden order and Priya still gets her summary.
3. Pick *The invoice phish* and press **R**: in Full Airlock the gate blocks the planted recipient and says why.
4. Open **Firewall lab**, pick a page, and switch between X-ray and "What the agent sees".

Keyboard: **R** run, **1–4** pick scenario, **P** presenter notes, **Esc** close drawers.

## 7. Tests and evaluation

```bash
# from the repo root, with the venv active
GEMMA_ENABLED=false python -m pytest -q backend/tests

# with the backend running (terminal 1):
python eval/run_injection_eval.py                    # detection only
python eval/run_injection_eval.py --agent \
  --publish frontend/public/eval-results.json        # + end-to-end raw / v1 / full, updates the Overview page
```

Run the eval once with `GEMMA_ENABLED=false` and once with Gemma loaded: the published file keeps both
"rules-only" and "rules + Gemma" detection numbers side by side. Results are written to `eval/results/`.
Commit them so the Overview page and README show the measured numbers.

On Windows PowerShell, set variables like this instead: `$env:GEMMA_ENABLED="false"; python -m pytest -q backend/tests`.

## 8. Use it from your own agent

- HTTP: send each tool result to `POST /firewall/scan` with `{"content": "...", "content_type": "html|text|email", "tool": "fetch_page"}`
  and give your model `content_for_model` instead of the raw content. See `/start` in the console for curl
  and Python examples.
- MCP (Claude Desktop, Cursor): run `python -m backend.mcp_server`; config snippets and the six tools are in `docs/MCP.md`.

## 9. Demo-day checklist

- [ ] Day before: full setup done, Gemma downloaded and loading, `npm run build` done, eval run with Gemma and committed.
- [ ] Laptop on power; sleep and notifications off; browser zoom ~110% for the projector.
- [ ] Terminal 1: backend running; `/health` shows the mode you expect.
- [ ] Terminal 2: `npm run start` (production build).
- [ ] Browser tabs open: `/`, `/agent`, `/lab`. Press *Reset* on the Live demo before each judge.
- [ ] Backup tab: `http://localhost:3000/agent?mock=1` (demo data, works without the backend).
- [ ] Demo video on a phone; second laptop with the repo installed.

## 10. Troubleshooting

| Symptom | Fix |
| --- | --- |
| UI shows "Demo data" / "Offline" | Backend isn't reachable: check terminal 1, open `http://localhost:8000/health`, check `NEXT_PUBLIC_API_URL`. |
| Browser console shows a CORS error | Opening the UI from another device or IP? Add `http://<that-ip>:3000` to `CORS_ORIGINS` in `.env` and restart the backend. |
| `/scan` returns 503 | Gemma is still loading (about a minute). Wait, or set `GEMMA_ENABLED=false`. |
| `ModuleNotFoundError: backend` | Run `uvicorn backend.main:app` from the repo root, not from `backend/`. |
| Port already in use | `uvicorn backend.main:app --port 8001` and set `NEXT_PUBLIC_API_URL=http://localhost:8001`; or `npm run dev -- -p 3001` (then add that origin to `CORS_ORIGINS`). |
| Live demo run looks stuck or mixed up | Press *Reset*, pick the scenario again, press **R**. |
| `pip install` fails on `foundry-local-sdk` | Remove it from your local install (`pip install` the other lines) and run with `GEMMA_ENABLED=false`. |
| Agent errors with a real cloud model | The model must support tool calling; check `CLOUD_MODEL`, or set `AGENT_PROVIDER=scripted`. |
