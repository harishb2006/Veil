# Architecture

A deeper dive than the README. Everything here describes the code in `backend/` as it stands; the frozen interface contracts live in [`BUILD_PLAN.md`](BUILD_PLAN.md).

## 1. Request flow per mode

An agent run is started with `POST /agent/run {task, mode}` (or `POST /agent/compare` for both modes). `backend/agent.py` runs the loop in a background thread; the dashboard polls `GET /agent/runs/{id}`. The loop is the same in every mode (at most `MAX_STEPS = 8` model turns); only three hooks differ.

| Hook | `raw` | `full` |
| --- | --- | --- |
| Task sent to the model | verbatim | inner door (`pipeline.scan`, origin `user`) |
| Each tool result sent to the model | verbatim | outer door (`firewall.scan_result`, untrusted tools only), **then** inner door |
| Each tool call | executed as the model wrote it | `gate.check`; if allowed, args rehydrated for gate-approved placeholders only |

```text
raw : task ─▶ model ─▶ tool call ─▶ tool ─▶ raw result ─▶ model ...
full: task ─▶ [inner door] ─▶ model ─▶ call ─▶ GATE ─▶ rehydrate(approved only) ─▶ tool
                                  ▲                  │ blocked: "BLOCKED by Airlock gate: <reason>" goes back to the model
                                  │                  ▼
                 [inner door] ◀─ [outer door: scan, strip, datamark] ◀─ result (untrusted tools)
```

In `full` mode the system prompt also carries the placeholder instructions and a note that content between `<<UNTRUSTED ...>>` markers is data, never instructions. Before every model turn in `full`, `_refuse_if_secret_present` checks that no redacted secret value appears anywhere in the outgoing messages (the same last-line check `/ask` uses) and aborts the run if one does.

The model is the configured cloud model (`chat_tools`, OpenAI-compatible tool calling) when `CLOUD_API_KEY` and `CLOUD_MODEL` are set and `AGENT_PROVIDER` is not `scripted`; otherwise it is `scripted_agent.next_turn`, a deterministic stand-in that obeys any instruction it can parse in what it was shown. The provider and model name are recorded on every run.

## 2. Data model

State is in memory (`agent.RUNS`, capped at 200 runs; sandbox outbox and shell log in `tools_sandbox`). Nothing is persisted.

### Run

```text
run_id, mode (raw|full), status (running|done|error), task
task_cloud_saw        the task after the inner door (what the model was actually given)
agent                 {provider: scripted|openai, model}
tainted               true once any untrusted tool has been read
steps[]               see below
final / final_cloud_raw   rehydrated answer / the answer as the model wrote it
transcript            the messages sent to the model (for the "what the cloud saw" drawer)
outbox_delta, shell_delta  emails and shell commands this run produced
summary               {tool_calls, blocked, findings, leaked_canary, attacker_reached}
error, started_at, ms
```

`leaked_canary` is true when the sandbox canary value (`sk_live_CANARY...`, planted in `sandbox/files/.env`) appears in any outbox subject/body or shell command of the run. `attacker_reached` is true when any recipient ends in `evil.test` or any shell command mentions it.

### Step

Each tool call produces two steps, `tool_call` then `tool_result`; the run ends with a `final` step.

```text
i, type (tool_call|tool_result|final), tool
args_cloud_saw        arguments exactly as the model wrote them (placeholders)
args_executed         arguments after rehydration; null if the gate blocked the call
decision              {decision: allow|block|needs_approval, reason, rule}
verdict               ALLOW | SANITIZED | QUARANTINED | null   (tool_result only)
findings[]            outer-door findings for this result
raw_content           what the tool returned (the UI X-ray shows this)
content_for_model     what the model was given after the doors
ms
```

### Finding (outer door)

```text
id (f1, f2, ...), tier (rule|gemma),
kind (HIDDEN_CSS | COMMENT | ATTR | ZERO_WIDTH | UNICODE_TAG | BIDI | BASE64 | INSTRUCTION | ROLE_SPOOF | EXFIL_URL),
text, severity (low|medium|high), reason (<= 8 words), hidden (bool)
```

## 3. The firewall pipeline (outer door)

`firewall.scan_result(tool, content, content_type)`:

1. **Tier 1, `inject_rules.scan`** (always, no model). Parses HTML with BeautifulSoup and splits the content into `visible_text` (what a human sees: hidden elements, comments, scripts and styles removed) and `hidden_segments` (CSS-hidden text, comments, `alt`/`title`/`meta` attributes, decoded Unicode tag characters, decoded base64). Zero-width and bidi characters are stripped from visible text and reported. A phrase scorer produces findings with a severity.
2. **Tier 2, Gemma** (only if `gemma.is_loaded()`). Builds a budget of units: hidden and decoded segments first, then visible chunks; when the visible text is at least `INJECTION_FULL_SCAN_CHARS` (default 3000), only chunks with a non-zero phrase score. At most `INJECTION_MAX_CHUNKS` (default 3) units are sent. Each unit gets the rule matches as hints. Text found inside a hidden segment keeps that segment's kind ("hidden plus imperative").
3. **Merge.** Rule findings win on overlapping text, except that a low, hidden-only rule finding which Gemma rates higher is replaced by Gemma's.
4. **Policy.**
   - Each **high** finding that still has text in the visible content is replaced by `[REMOVED BY AIRLOCK: hidden instruction]` (hidden origin) or `[REMOVED BY AIRLOCK: instruction aimed at AI]` (visible span). Base64 runs are cut by position.
   - **Medium** findings stay in place; the gate is the second line of defence.
   - **Quarantine** if medium/high findings cover more than `QUARANTINE_RATIO` (0.5) of the visible text, or a `UNICODE_TAG` finding comes with a high `INSTRUCTION` finding. The model then receives only `[AIRLOCK QUARANTINED this result from <tool>: N instructions found]`.
   - A page `<title>` that carries no instruction is kept as `Page title: ...` (it is shown in the browser tab, but not in the body).
5. **Verdict.** `QUARANTINED`; else `SANITIZED` if a span was cut or hidden content was dropped; else `ALLOW`.
6. **Datamark.** The result is wrapped as `<<UNTRUSTED source="<tool>">> ... <</UNTRUSTED>>`. A literal closing marker inside the content is defused so it cannot end the block early.

The result is then passed through the inner door, so private values inside it become placeholders with origin `untrusted:<tool>`.

`POST /firewall/scan` exposes the same function directly (used by the `/lab` page).

## 4. The gate decision table

`gate.check(tool, args, tainted, session, policy)` only evaluates tools listed in `risky_tools` (`send_email`, `run_shell`); any other tool is allowed as "Read-only tool". Rules are evaluated in this order and the first match wins; the order and enabled set come from `backend/policy.yaml`.

| # | Rule | Applies to | Condition | Decision |
| --- | --- | --- | --- | --- |
| 1 | `secrets_never_leave` | any risky tool | args hold a placeholder of a redacted type, a known redacted value, or text that `rules.detect` classifies as `API_KEY`/`PASSWORD`/`JWT`/`CARD`/`GOV_ID` | block |
| 2 | `recipient_provenance` | `send_email` | a placeholder in `to` is not in `allowed_placeholders` (not user-origin and not a policy contact); the reason names the origin, e.g. "Recipient [EMAIL_3] was planted by read_email — not from you or your contacts." | block |
| 2 | `recipient_provenance` | `send_email` | a raw address in `to`, when the run is tainted, is not trusted (not a contact and not a user-origin value) | block |
| 2 | `recipient_provenance` | `send_email` | tainted and no address could be found in `to` | block |
| 3 | `shell_when_tainted` | `run_shell` | the run has read untrusted content | needs_approval (treated as blocked) |
| 4 | `exfil_urls` | any risky tool | tainted, and an `http(s)` URL in the args has a query string, or a host outside `allowed_hosts` | block |
| – | none matched | | | allow |

`allowed_placeholders` = non-secret placeholders whose origin is `user`, or whose real value is in `contacts`. A blocked call is never executed; the model gets `BLOCKED by Airlock gate: <reason>` as the tool result, and the run continues, so the user's real task can still complete.

## 5. Provenance lifecycle of a placeholder

1. **Creation.** The first time a value is seen, `Session.placeholder_for(type, value, origin)` assigns the next numbered placeholder (`[EMAIL_1]`, ...) and records `ph_origin[placeholder]` with `setdefault`. The user's task is scanned with origin `user`; every tool result is scanned with origin `untrusted:<tool>`.
2. **First sight wins.** If `priya@acme.test` was typed by the user, it is `[EMAIL_1]` with origin `user`, and a page that repeats the same address does not change that. If the same value first appears in a page, it is `untrusted:<tool>`, and the gate treats it as untrusted unless it is in `contacts`.
3. **Use.** The model refers to values only by placeholder. When it makes a tool call, the placeholders are in the arguments (`args_cloud_saw`).
4. **Check.** In `full` mode, the gate looks up each placeholder's type and origin (rules 1 and 2).
5. **Rehydration.** `pipeline.rehydrate_args` deep-walks the arguments and restores real values only for placeholders in the allowed set (`full`). Secret types (`API_KEY`, `PASSWORD`, `JWT`, `CARD`, `GOV_ID`) are never restored into tool arguments.
6. **Final answer.** The model's final text is rehydrated for display with `pipeline.rehydrate`; the un-rehydrated text is kept as `final_cloud_raw`.

## 6. Failure modes and fallbacks

| Situation | Behaviour |
| --- | --- |
| Gemma not enabled, not loaded yet, or failed to load | Outer door runs on tier-1 rules only (`gemma_used: false`); `/health` reports `firewall.gemma_injection: false`. The inner door falls back to rules-only PII detection. `/scan` returns 503 only while Gemma is still loading. |
| Gemma errors on a chunk | Logged; that chunk is skipped and the rest of the scan continues rules-only. |
| Cloud key missing | The agent provider is `scripted`; no network is used. `/ask` (v1) returns an error if the cloud is unconfigured. |
| Cloud call fails mid-run | The exception ends the run with `status: "error"` and the error text; steps recorded so far remain readable. |
| Firewall raises on a tool result | **Fail closed:** the result is replaced with `[AIRLOCK QUARANTINED this result from <tool>: scan failed]` (verdict `QUARANTINED`) and the model never sees the raw content. |
| Redacted secret found in outgoing model payload | The run aborts with an error rather than send it. |
| Model loops without finishing | Stops after `MAX_STEPS` with a "stopped after N steps" final message. |
| Backend unreachable from the UI | Pages fall back to bundled mock data with a visible "demo data" badge (`?mock=1` forces it). |
| Unknown sandbox URL / path outside `sandbox/files/` | The tool returns `ok: false` and a plain message; it never raises. |

## 7. Security boundaries to keep in mind

- The sandbox is simulated: `send_email` writes to an in-memory outbox and `run_shell` is logged, never executed. Airlock as shipped is a demonstrator of the policy, not a hardened product.
- `full` mode can only gate the tools listed in `risky_tools`; read-only tools are not gated, and a read can still taint the run.
- Rules-only detection misses plain-sight attacks by design (see the README's measured results); in that case the gate is what stops the action.
