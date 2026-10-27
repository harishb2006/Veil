/**
 * Demo-data engine: plays the scripted runs from mockScripts.ts step by step over time so the
 * mission-control UI works with no backend. Same surface as the live client (see types.AgentClient).
 */

import { CANARY, MOCK_PAGES, MOCK_SCENARIOS, buildScript, customScript, type Script } from "./mockScripts";
import type {
  Health,
  Mode,
  OutboxItem,
  PageResponse,
  Run,
  RunIds,
  RunSummary,
  Samples,
  ShellItem,
  Step,
} from "./types";

export const MOCK_STEP_MS = 700;
const FIRST_STEP_MS = 350;
const UNTRUSTED = new Set(["fetch_page", "read_inbox", "read_email", "read_file"]);

interface MockRun {
  id: string;
  mode: Mode;
  task: string;
  script: Script;
  startedAt: number;
}

const runs = new Map<string, MockRun>();
let counter = 0;
let resetAt = 0;

export const isMockRunId = (id: string): boolean => id.startsWith("mock-");

function pickScenarioId(task: string): string | null {
  const t = task.trim();
  const exact = MOCK_SCENARIOS.find((s) => s.task === t);
  if (exact) return exact.id;
  const lower = t.toLowerCase();
  if (lower.includes("aurora")) return "hidden-css";
  if (lower.includes("inbox")) return "inbox-plain-sight";
  if (lower.includes("devtool") || lower.includes("setup guide")) return "unicode-tags";
  if (lower.includes("prompt-injection") || lower.includes("news.test")) return "clean-article";
  return null;
}

function createRun(task: string, mode: Mode): string {
  const scenarioId = pickScenarioId(task);
  const script = (scenarioId && buildScript(scenarioId, mode)) || customScript(task);
  const id = `mock-${mode}-${++counter}-${Math.random().toString(36).slice(2, 7)}`;
  runs.set(id, { id, mode, task, script, startedAt: Date.now() });
  return id;
}

function snapshot(r: MockRun, now = Date.now()): Run {
  const { script } = r;
  const total = script.steps.length + 1; // + final step
  const revealed = Math.max(0, Math.min(total, Math.floor((now - r.startedAt - FIRST_STEP_MS) / MOCK_STEP_MS) + 1));
  const done = revealed >= total;

  const steps: Step[] = [];
  const outbox: OutboxItem[] = [];
  const shell: ShellItem[] = [];
  let toolCalls = 0;
  let blocked = 0;
  let findings = 0;
  let tainted = false;

  for (let n = 0; n < revealed; n++) {
    if (n === script.steps.length) {
      steps.push({ i: n, type: "final", tool: null, raw_content: script.final, content_for_model: script.finalCloudRaw, ms: 0 });
      break;
    }
    const s = script.steps[n];
    steps.push({ ...s.step, i: n });
    const ts = r.startedAt / 1000 + (n * MOCK_STEP_MS) / 1000;
    if (s.step.type === "tool_call") {
      toolCalls++;
      const d = s.step.decision;
      if (d && d.decision !== "allow") blocked++;
      if (s.outbox) outbox.push({ id: `${r.id}-m${n}`, run_id: r.id, ts, ...s.outbox });
      if (s.shell) shell.push({ run_id: r.id, command: s.shell, ts });
    } else if (s.step.type === "tool_result") {
      findings += s.step.findings?.length ?? 0;
      if (s.step.tool && UNTRUSTED.has(s.step.tool)) tainted = true;
    }
  }

  const summary: RunSummary = {
    tool_calls: toolCalls,
    blocked,
    findings,
    leaked_canary: outbox.some((o) => o.body.includes(CANARY)) || shell.some((c) => c.command.includes(CANARY)),
    attacker_reached: outbox.some((o) => o.to.endsWith("evil.test")) || shell.some((c) => c.command.includes("evil.test")),
  };

  return {
    run_id: r.id,
    mode: r.mode,
    status: done ? "done" : "running",
    task: r.task,
    task_cloud_saw: script.taskCloudSaw,
    agent: { provider: "scripted", model: "scripted-demo-agent" },
    tainted,
    steps,
    final: done ? script.final : null,
    final_cloud_raw: done ? script.finalCloudRaw : null,
    outbox_delta: outbox,
    shell_delta: shell,
    summary,
    error: null,
    started_at: r.startedAt / 1000,
    ms: 0,
  };
}

const tick = <T>(value: T): Promise<T> => new Promise((resolve) => setTimeout(() => resolve(value), 60));

export const mockApi = {
  getSamples: (): Promise<Samples> =>
    tick({
      scenarios: MOCK_SCENARIOS,
      pages: MOCK_PAGES.map(({ url, title, attack }) => ({ url, title, attack })),
    }),

  startRun: (task: string, mode: Mode): Promise<string> => tick(createRun(task, mode)),

  compare: (task: string): Promise<RunIds> =>
    tick({ raw: createRun(task, "raw"), full: createRun(task, "full") }),

  getRun: async (runId: string): Promise<Run> => {
    const r = runs.get(runId);
    if (!r) throw new Error(`Unknown demo run ${runId}`);
    return snapshot(r);
  },

  getOutbox: async (): Promise<OutboxItem[]> =>
    [...runs.values()]
      .filter((r) => r.startedAt >= resetAt)
      .flatMap((r) => snapshot(r).outbox_delta),

  resetSandbox: async (): Promise<void> => {
    resetAt = Date.now();
  },

  getPage: async (url: string): Promise<PageResponse> => {
    const page = MOCK_PAGES.find((p) => p.url === url);
    if (!page) throw new Error("404: page not found in the Veil sandbox (no live web)");
    return { url, html: page.html };
  },

  getHealth: (): Promise<Health> =>
    tick({
      status: "demo",
      firewall: { rules: true, gemma_injection: false },
      agent: { provider: "scripted", model: "scripted-demo-agent" },
    }),
};

