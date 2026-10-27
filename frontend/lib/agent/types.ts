/** Types mirroring the frozen run dict (docs/BUILD_PLAN.md §1, §3, §5). */

export type Mode = "raw" | "full";
export const MODES: readonly Mode[] = ["raw", "full"];

export type Severity = "low" | "medium" | "high";
export type FindingTier = "rule" | "gemma";
export type FindingKind =
  | "HIDDEN_CSS"
  | "COMMENT"
  | "ATTR"
  | "ZERO_WIDTH"
  | "UNICODE_TAG"
  | "VARIATION_SELECTOR"
  | "BIDI"
  | "BASE64"
  | "INSTRUCTION"
  | "ROLE_SPOOF"
  | "EXFIL_URL";

export interface Finding {
  id: string;
  tier: FindingTier;
  kind: FindingKind | (string & {});
  /** Exact text the agent would have read (decoded text for UNICODE_TAG / BASE64). */
  text: string;
  severity: Severity;
  reason: string;
  hidden: boolean;
}

export type Verdict = "ALLOW" | "SANITIZED" | "QUARANTINED";
export type GateOutcome = "allow" | "block" | "needs_approval";

export interface GateDecision {
  decision: GateOutcome;
  reason: string;
  rule: string | null;
}

export type ToolName =
  | "fetch_page"
  | "read_inbox"
  | "read_email"
  | "read_file"
  | "send_email"
  | "run_shell";

export type ToolArgs = Record<string, unknown>;

export type StepType = "tool_call" | "tool_result" | "final";

export interface Step {
  i: number;
  type: StepType;
  tool?: ToolName | (string & {}) | null;
  args_cloud_saw?: ToolArgs | null;
  args_executed?: ToolArgs | null;
  decision?: GateDecision | null;
  verdict?: Verdict | null;
  findings?: Finding[];
  raw_content?: string | null;
  content_for_model?: string | null;
  ms?: number;
}

export interface OutboxItem {
  id: string;
  run_id: string;
  to: string;
  subject: string;
  body: string;
  ts: number | string;
}

export interface ShellItem {
  run_id: string;
  command: string;
  ts: number | string;
}

export interface RunSummary {
  tool_calls: number;
  blocked: number;
  findings: number;
  leaked_canary: boolean;
  attacker_reached: boolean;
}

export interface TranscriptMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export type RunStatus = "running" | "done" | "error";

export interface Run {
  run_id: string;
  mode: Mode;
  status: RunStatus;
  task: string;
  task_cloud_saw: string;
  agent: { provider: string; model: string };
  tainted: boolean;
  steps: Step[];
  final: string | null;
  final_cloud_raw: string | null;
  outbox_delta: OutboxItem[];
  shell_delta: ShellItem[];
  summary: RunSummary;
  error: string | null;
  started_at: number;
  ms: number;
  /** Not part of the frozen shape; rendered when a backend provides it. */
  transcript?: TranscriptMessage[];
}

export interface Scenario {
  id: string;
  title: string;
  tagline: string;
  task: string;
  url: string;
  attack: string | null;
  attacker: string | null;
  clean: boolean;
}

export interface SamplePage {
  url: string;
  title: string;
  attack: string | null;
}

export interface Samples {
  scenarios: Scenario[];
  pages: SamplePage[];
}

export interface Health {
  firewall?: { rules: boolean; gemma_injection: boolean };
  agent?: { provider: string; model: string };
  [key: string]: unknown;
}

export interface RunIds {
  raw: string;
  full: string;
}

export interface PageResponse {
  url: string;
  html: string;
}

/** Everything the mission-control UI needs from a backend (live or mock). */
export interface AgentClient {
  isMock(): boolean;
  getSamples(): Promise<Samples>;
  startRun(task: string, mode: Mode): Promise<string>;
  compare(task: string): Promise<RunIds>;
  getRun(runId: string): Promise<Run>;
  getOutbox(): Promise<OutboxItem[]>;
  resetSandbox(): Promise<void>;
  getPage(url: string): Promise<PageResponse>;
  getHealth(): Promise<Health>;
}
