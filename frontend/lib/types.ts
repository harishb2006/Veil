// Shared API shapes. v1 shapes mirror docs/V1_CONTEXT.md; v2 shapes mirror docs/BUILD_PLAN.md §1-§5.

// ---------- v1: inner door ----------

export type OverallRisk = "NONE" | "LOW" | "MEDIUM" | "HIGH";
export type EntityRisk = "LOW" | "MEDIUM" | "HIGH";
export type EntitySource = "rule" | "gemma";

export interface Health {
  ok: boolean;
  gemma_loaded: boolean;
  gemma_status?: "disabled" | "not_loaded" | "loading" | "loaded" | "failed";
  model_alias: string;
  cloud_configured: boolean;
  // v2 additions (absent when talking to a v1 backend)
  firewall?: { rules: boolean; gemma_injection: boolean };
  agent?: { provider: string; model: string };
}

export interface Entity {
  type: string;
  text: string;
  replacement: string;
  risk: EntityRisk;
  source: EntitySource;
  redacted: boolean;
  count: number;
  reason?: string;
}

export interface ScanResponse {
  scan_id: string;
  risk: OverallRisk;
  entities: Entity[];
  sanitized_text: string;
  gemma_used: boolean;
  timings_ms: { rules?: number; gemma?: number; total?: number };
}

export interface AskRequest {
  scan_id: string;
  question?: string;
}

export interface AskResponse {
  scan_id: string;
  cloud_model: string;
  cloud_saw: string;
  cloud_response_raw: string;
  response: string;
  timings_ms: { cloud?: number };
}

export interface AirlockApi {
  health(): Promise<Health>;
  scan(text: string): Promise<ScanResponse>;
  ask(req: AskRequest): Promise<AskResponse>;
}

// ---------- v2: outer door ----------

export type ContentType = "html" | "text" | "email";
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
export type Verdict = "ALLOW" | "SANITIZED" | "QUARANTINED";

export interface Finding {
  id: string;
  tier: FindingTier;
  kind: FindingKind | string;
  text: string;
  severity: Severity;
  reason: string;
  hidden: boolean;
}

export interface FirewallResult {
  verdict: Verdict;
  findings: Finding[];
  content_for_model: string;
  visible_text: string;
  timings_ms: { rules?: number; gemma?: number };
  gemma_used: boolean;
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

// ---------- published evaluation (frontend/public/eval-results.json) ----------
// Everything is optional: the page renders only what the file actually contains.

export interface DetectionStats {
  recall?: number;
  fpr?: number;
  recall_by_kind?: Record<string, number>;
  n_attacks?: number;
  n_clean?: number;
}

export interface ModeStats {
  attack_success_rate?: number;
  canary_leak_rate?: number;
  clean_task_completion?: number;
  n?: number;
}

export interface EvalResults {
  generated_at?: string;
  gemma?: { available?: boolean; model?: string };
  agent?: { provider?: string; model?: string };
  detection?: { rules_only?: DetectionStats; rules_plus_gemma?: DetectionStats };
  end_to_end?: { raw?: ModeStats; full?: ModeStats };
  latency_ms?: { median_per_tool_result?: number };
  notes?: string;
}
