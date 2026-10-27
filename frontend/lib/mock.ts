// Mock backends so every page can be shown without the API. Detection here is a toy:
//  - mockApi: v1 inner door (a few regexes plus a fixed list of "contextual" terms from the samples)
//  - mockFirewallScan: v2 outer door (regex-based hidden-content and phrase detection)
// Results are always shown with a visible "Demo data" badge; none of this is a measurement.

import { REDACTED_TYPES } from "./highlight";
import { BUILTIN_EXAMPLES } from "./samples";
import type {
  AirlockApi,
  AskResponse,
  ContentType,
  Entity,
  EntityRisk,
  EntitySource,
  Finding,
  FirewallResult,
  Health,
  OverallRisk,
  SamplePage,
  Samples,
  ScanResponse,
  Severity,
  Verdict,
} from "./types";

const HIGH_TYPES = new Set([...REDACTED_TYPES, "EMAIL", "MEDICAL", "FINANCIAL"]);
const MEDIUM_TYPES = new Set(["PERSON", "ORG", "PHONE", "ADDRESS", "HR", "PROJECT", "INTERNAL_URL", "IP_ADDRESS"]);

const RULES: [string, RegExp][] = [
  ["INTERNAL_URL", /\bhttps?:\/\/[\w.-]+\.(?:internal|corp|local|lan)\b(?:[^\s,;]*[^\s,;.])?/g],
  ["EMAIL", /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g],
  ["API_KEY", /\b(?:sk|pk|rk|ak)_(?:live|test)_[A-Za-z0-9]{8,}\b|\bAKIA[0-9A-Z]{16}\b|\bghp_[A-Za-z0-9]{20,}\b/g],
  ["PASSWORD", /(?<=\bpassword(?:\s+is)?[\s:=]+)(?!is\b)[^\s,;]*[^\s,;.]/gi],
  ["CARD", /\b(?:\d{4}[ -]?){3}\d{4}\b/g],
  ["GOV_ID", /\b\d{4} \d{4} \d{4}\b/g],
  ["IP_ADDRESS", /\b(?:\d{1,3}\.){3}\d{1,3}\b/g],
  ["PHONE", /\+\d{1,3}(?:[\s-]?\d{2,5}){2,4}\b|\b[6-9]\d{4}[\s-]?\d{5}\b/g],
];

// What the local model would catch that no regex can.
const CONTEXTUAL: { text: string; type: string; reason: string }[] = [
  { text: "Henderson", type: "ORG", reason: "Customer account name" },
  { text: "Priya", type: "PERSON", reason: "Named customer contact (CFO)" },
  { text: "40L renewal", type: "FINANCIAL", reason: "Deal value for a named customer" },
  { text: "Project Falcon", type: "PROJECT", reason: "Internal project codename" },
  { text: "Mateo", type: "PERSON", reason: "Named service owner" },
  { text: "Northstar", type: "ORG", reason: "Organisation tied to the leaked credentials" },
  { text: "Anika Rao", type: "PERSON", reason: "Treating doctor" },
  { text: "Leena", type: "PERSON", reason: "Patient name" },
  { text: "diabetes", type: "MEDICAL", reason: "Diagnosis linked to a named patient" },
  { text: "severe peanut allergy", type: "MEDICAL", reason: "Health condition linked to a named patient" },
  { text: "Project Nimbus", type: "PROJECT", reason: "Internal project codename" },
  { text: "Ibrahim", type: "PERSON", reason: "Named on-call engineer" },
];

function entityRisk(type: string): EntityRisk {
  if (HIGH_TYPES.has(type)) return "HIGH";
  if (MEDIUM_TYPES.has(type)) return "MEDIUM";
  return "LOW";
}

function overallRisk(entities: Entity[]): OverallRisk {
  if (entities.length === 0) return "NONE";
  if (entities.some((e) => e.risk === "HIGH")) return "HIGH";
  if (entities.some((e) => e.risk === "MEDIUM")) return "MEDIUM";
  return "LOW";
}

interface Span {
  start: number;
  end: number;
  type: string;
  source: EntitySource;
  reason?: string;
}

function detect(text: string): Span[] {
  const spans: Span[] = [];
  for (const [type, re] of RULES) {
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      spans.push({ start, end: start + m[0].length, type, source: "rule" });
    }
  }
  for (const c of CONTEXTUAL) {
    let i = text.indexOf(c.text);
    while (i !== -1) {
      spans.push({ start: i, end: i + c.text.length, type: c.type, source: "gemma", reason: c.reason });
      i = text.indexOf(c.text, i + c.text.length);
    }
  }
  spans.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const kept: Span[] = [];
  for (const s of spans) {
    const last = kept[kept.length - 1];
    if (!last || s.start >= last.end) kept.push(s);
  }
  return kept;
}

function buildScan(text: string): ScanResponse {
  const spans = detect(text);
  const byValue = new Map<string, Entity>();
  const perType = new Map<string, number>();
  let sanitized = "";
  let pos = 0;

  for (const s of spans) {
    const value = text.slice(s.start, s.end);
    let entity = byValue.get(value);
    if (!entity) {
      const n = (perType.get(s.type) ?? 0) + 1;
      perType.set(s.type, n);
      entity = {
        type: s.type,
        text: value,
        replacement: `[${s.type}_${n}]`,
        risk: entityRisk(s.type),
        source: s.source,
        redacted: REDACTED_TYPES.has(s.type),
        count: 0,
        reason: s.reason,
      };
      byValue.set(value, entity);
    }
    entity.count += 1;
    sanitized += text.slice(pos, s.start) + entity.replacement;
    pos = s.end;
  }
  sanitized += text.slice(pos);

  const entities = [...byValue.values()];
  const gemmaMs = 2600 + Math.round(Math.random() * 1200);
  return {
    scan_id: crypto.randomUUID(),
    risk: overallRisk(entities),
    entities,
    sanitized_text: sanitized,
    gemma_used: true,
    timings_ms: { rules: 2, gemma: gemmaMs, total: gemmaMs + 4 },
  };
}

function sanitize(text: string, entities: Entity[]): string {
  let out = text;
  for (const e of [...entities].sort((a, b) => b.text.length - a.text.length)) {
    out = out.split(e.text).join(e.replacement);
  }
  return out;
}

function rehydrate(text: string, entities: Entity[]): string {
  let out = text;
  for (const e of entities) {
    if (!e.redacted) out = out.split(e.replacement).join(e.text);
  }
  return out;
}

function placeholdersOf(entities: Entity[], types: string[]): string[] {
  return entities.filter((e) => types.includes(e.type)).map((e) => e.replacement);
}

function firstAnswer(entities: Entity[]): string {
  const people = placeholdersOf(entities, ["PERSON"]);
  const orgs = placeholdersOf(entities, ["ORG", "PROJECT"]);
  const secrets = entities.filter((e) => e.redacted).map((e) => e.replacement);
  const lines = ["Here's how I'd handle this:"];
  if (people.length) lines.push(`• Reply directly to ${people[0]} and acknowledge their concern first.`);
  if (orgs.length) lines.push(`• Keep the focus on ${orgs.join(" and ")} — be concrete about what is already done.`);
  if (secrets.length) {
    lines.push(`• Don't paste ${secrets.join(", ")} into messages or docs; rotate anything that was shared.`);
  }
  lines.push(people.length ? `Suggested opener: "Hi ${people[0]}, thanks for being upfront with us…"` : "Let me know if you want a full draft.");
  return lines.join("\n");
}

function followUpAnswer(question: string, entities: Entity[]): string {
  const secrets = entities.filter((e) => e.redacted);
  if (/\b(key|password|secret|token|card|aadhaar|credential)s?\b/i.test(question) && secrets.length) {
    return (
      `I don't know the actual value. In what you sent me it only appears as ${secrets.map((e) => e.replacement).join(", ")} — ` +
      "the real value was removed before it reached me. Check your secrets manager."
    );
  }
  const person = placeholdersOf(entities, ["PERSON"])[0];
  return person
    ? `Sure. Based on our conversation, I'd keep ${person} in the loop and follow up within two working days.`
    : "Sure — based on what you shared, I'd follow up within two working days.";
}

const scans = new Map<string, ScanResponse>();
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const mockApi: AirlockApi = {
  async health(): Promise<Health> {
    await delay(150);
    return {
      ok: true,
      gemma_loaded: true,
      gemma_status: "loaded",
      model_alias: "gemma-4-e2b-it (mock)",
      cloud_configured: true,
      firewall: { rules: true, gemma_injection: true },
      agent: { provider: "scripted", model: "scripted-demo-agent (mock)" },
    };
  },

  async scan(text) {
    await delay(1800);
    const scan = buildScan(text);
    scans.set(scan.scan_id, scan);
    return scan;
  },

  async ask({ scan_id, question }): Promise<AskResponse> {
    await delay(1200);
    const scan = scans.get(scan_id);
    if (!scan) throw new Error("Scan not found (mock). Scan the text again.");
    const { entities } = scan;
    const cloudSaw = question ? sanitize(question, entities) : scan.sanitized_text;
    const raw = question ? followUpAnswer(cloudSaw, entities) : firstAnswer(entities);
    return {
      scan_id,
      cloud_model: "mock-cloud-model",
      cloud_saw: cloudSaw,
      cloud_response_raw: raw,
      response: rehydrate(raw, entities),
      timings_ms: { cloud: 1150 },
    };
  },
};

// ---------- outer door mock ----------

const ZW_RE = /[\u200B-\u200D\u2060\uFEFF]+/g;
const BIDI_RE = /[\u202A-\u202E\u2066-\u2069]+/g;
const TAG_RE = /[\u{E0000}-\u{E007F}]+/gu;
const B64_RE = /[A-Za-z0-9+/]{24,}={0,2}/g;
const HIDDEN_EL_RE =
  /<(\w+)\b[^>]*style="[^"]*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?![.\d])|font-size\s*:\s*[01]px|left\s*:\s*-\d{3,}px|color\s*:\s*#fff(?:fff)?[^"]*background(?:-color)?\s*:\s*#fff(?:fff)?)[^"]*"[^>]*>([\s\S]*?)<\/\1>/gi;
const COMMENT_RE = /<!--([\s\S]*?)-->/g;

// Phrases aimed at an AI (the real backend uses a richer scorer plus Gemma for plain-sight cases).
const AI_ADDRESSED = /\b(?:ai|assistant|agent|model|llm)\b[^.\n]{0,60}\b(?:reading|processing|summari[sz]ing|browsing)\b/i;
const TOOL_ACTION = /\b(?:send|email|forward|upload|curl|run|read the file|rm -rf)\b[^.\n]{0,120}/i;
const OVERRIDE = /\b(?:ignore|disregard)\b[^.\n]{0,24}\b(?:previous|prior|above)\b[^.\n]{0,24}\binstructions\b/i;

function stripTags(html: string): string {
  return html
    .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(HIDDEN_EL_RE, " ")
    .replace(COMMENT_RE, " ")
    .replace(/<\/(p|div|li|h\d|section|article|header|footer|tr)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeTags(run: string): string {
  return Array.from(run, (c) => String.fromCharCode((c.codePointAt(0) ?? 0xe0000) - 0xe0000)).join("");
}

function severityFor(text: string, hidden: boolean): Severity {
  const imperative = AI_ADDRESSED.test(text) || OVERRIDE.test(text) || TOOL_ACTION.test(text);
  if (hidden) return imperative ? "high" : "low";
  return AI_ADDRESSED.test(text) && TOOL_ACTION.test(text) ? "high" : "medium";
}

function isQuoted(sentence: string): boolean {
  return /["\u201C][^"\u201D]*(?:ignore|disregard)[^"\u201D]*["\u201D]/i.test(sentence);
}

export function mockFirewallScanSync(content: string, contentType: ContentType = "text"): FirewallResult {
  const t0 = performance.now();
  const findings: Finding[] = [];
  const add = (f: Omit<Finding, "id">) => findings.push({ ...f, id: `f${findings.length + 1}` });
  const looksHtml = contentType === "html" || /<\/?[a-z][\s\S]*>/i.test(content);

  if (looksHtml) {
    for (const m of content.matchAll(HIDDEN_EL_RE)) {
      const inner = stripTags(m[2]) || m[2].trim();
      if (!inner) continue;
      add({ tier: "rule", kind: "HIDDEN_CSS", text: m[2].trim(), severity: severityFor(inner, true), reason: "Text hidden from humans by CSS", hidden: true });
    }
    for (const m of content.matchAll(COMMENT_RE)) {
      const inner = m[1].trim();
      if (inner.length < 8) continue;
      add({ tier: "rule", kind: "COMMENT", text: inner, severity: severityFor(inner, true), reason: "HTML comment, invisible to readers", hidden: true });
    }
  }
  for (const m of content.matchAll(TAG_RE)) {
    const decoded = decodeTags(m[0]);
    add({ tier: "rule", kind: "UNICODE_TAG", text: decoded, severity: "high", reason: "Invisible Unicode tag characters", hidden: true });
  }
  for (const m of content.matchAll(ZW_RE)) {
    add({ tier: "rule", kind: "ZERO_WIDTH", text: m[0], severity: "low", reason: "Zero-width characters", hidden: true });
  }
  for (const m of content.matchAll(BIDI_RE)) {
    add({ tier: "rule", kind: "BIDI", text: m[0], severity: "low", reason: "Bidirectional control characters", hidden: true });
  }
  for (const m of content.matchAll(B64_RE)) {
    try {
      const decoded = atob(m[0]);
      if (/^[\x20-\x7e\n]+$/.test(decoded)) {
        add({ tier: "rule", kind: "BASE64", text: decoded, severity: severityFor(decoded, true), reason: "Base64 that decodes to text", hidden: true });
      }
    } catch {
      // not base64
    }
  }

  // Plain-sight orders: scan the human-visible text sentence by sentence.
  const visible = (looksHtml ? stripTags(content) : content).replace(TAG_RE, "").replace(ZW_RE, "").replace(BIDI_RE, "");
  for (const raw of visible.split(/(?<=[.!?])\s+|\n+/)) {
    const sentence = raw.trim();
    if (sentence.length < 12 || isQuoted(sentence)) continue;
    const aimed = AI_ADDRESSED.test(sentence) || OVERRIDE.test(sentence);
    if (!aimed) continue;
    add({
      tier: "rule",
      kind: "INSTRUCTION",
      text: sentence,
      severity: severityFor(sentence, false),
      reason: "Order aimed at an AI, not a human reader",
      hidden: false,
    });
  }

  // content_for_model: built from visible text, high visible spans replaced, hidden content never shown.
  let forModel = visible;
  const removedVisible = findings.filter((f) => !f.hidden && f.severity === "high");
  for (const f of removedVisible) forModel = forModel.replace(f.text, "[REMOVED BY VEIL: instruction aimed at AI]");

  const droppedHidden = findings.some((f) => f.hidden);
  const flaggedChars = findings.filter((f) => !f.hidden && f.severity !== "low").reduce((n, f) => n + f.text.length, 0);
  const tagAndHigh = findings.some((f) => f.kind === "UNICODE_TAG") && findings.some((f) => f.kind === "INSTRUCTION" && f.severity === "high");
  const hiddenHigh = findings.filter((f) => f.hidden && f.severity === "high").length;
  const quarantined = tagAndHigh || (visible.length > 0 && flaggedChars / visible.length > 0.5);
  const verdict: Verdict = quarantined ? "QUARANTINED" : droppedHidden || removedVisible.length ? "SANITIZED" : "ALLOW";

  const content_for_model = quarantined
    ? `[VEIL QUARANTINED this result from fetch_page: ${Math.max(1, hiddenHigh + removedVisible.length)} instructions found]`
    : forModel;
  const rulesMs = Math.max(1, Math.round(performance.now() - t0));
  return {
    verdict,
    findings,
    content_for_model: `<<UNTRUSTED source="fetch_page">>\n${content_for_model}\n<</UNTRUSTED>>`,
    visible_text: visible,
    timings_ms: { rules: rulesMs, gemma: 0 },
    gemma_used: false,
  };
}

export async function mockFirewallScan(content: string, contentType: ContentType = "text"): Promise<FirewallResult> {
  await delay(450);
  return mockFirewallScanSync(content, contentType);
}

export function mockSamples(): Samples {
  const pages: SamplePage[] = BUILTIN_EXAMPLES.filter((e) => e.content_type === "html").map((e) => ({
    url: `demo://${e.id}`,
    title: e.title,
    attack: e.attack,
  }));
  return { scenarios: [], pages };
}
