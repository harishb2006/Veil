/** Text segmentation helpers: placeholder / canary / attacker tokens, and X-ray finding highlights. */

import type { Finding, ToolArgs } from "./types";

// Never rehydrated by the backend (docs/AGENT_CONTEXT.md §3).
export const REDACTED_TYPES = new Set(["API_KEY", "PASSWORD", "JWT", "CARD", "GOV_ID"]);
export const CANARY = "demo_canary_7f3a9Qx2LmZ8vB4nK1";

export type TokenKind = "text" | "placeholder" | "redacted" | "canary" | "evil" | "marker" | "datamark";

export interface TokenSegment {
  text: string;
  kind: TokenKind;
}

const TOKEN_RE = new RegExp(
  [
    `(?<canary>${CANARY})`,
    String.raw`(?<marker>\[(?:REMOVED BY VEIL|VEIL QUARANTINED)[^\]]*\])`,
    String.raw`(?<datamark><<\/?UNTRUSTED[^>]*>>)`,
    String.raw`(?<placeholder>\[[A-Z][A-Z_]*_\d+\])`,
    String.raw`(?<evil>[\w.+-]+@[\w-]*evil\.test|(?:https?:\/\/)?[\w.-]*evil\.test(?:\/[^\s"'<>]*)?)`,
  ].join("|"),
  "g",
);

/** Split text into plain text and highlightable tokens. */
export function tokenize(text: string): TokenSegment[] {
  const out: TokenSegment[] = [];
  let pos = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const start = m.index ?? 0;
    if (start > pos) out.push({ text: text.slice(pos, start), kind: "text" });
    const g = m.groups ?? {};
    let kind: TokenKind = "text";
    if (g.canary) kind = "canary";
    else if (g.marker) kind = "marker";
    else if (g.datamark) kind = "datamark";
    else if (g.placeholder) {
      const type = g.placeholder.slice(1, g.placeholder.lastIndexOf("_"));
      kind = REDACTED_TYPES.has(type) ? "redacted" : "placeholder";
    } else if (g.evil) kind = "evil";
    out.push({ text: m[0], kind });
    pos = start + m[0].length;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), kind: "text" });
  return out;
}

export function argToString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return JSON.stringify(value);
}

/** Keys whose executed value differs from what the cloud saw (i.e. rehydrated locally). */
export function rehydratedKeys(cloud?: ToolArgs | null, executed?: ToolArgs | null): string[] {
  if (!cloud || !executed) return [];
  return Object.keys(executed).filter((k) => argToString(executed[k]) !== argToString(cloud[k]));
}

// ----------------------------------------------------------------- X-ray

export interface XRaySegment {
  text: string;
  finding?: Finding;
  /** For invisible characters: what to show instead (the decoded text). */
  decoded?: string;
}

const TAG_RUN_RE = /[\u{E0000}-\u{E007F}]+/gu;

export function decodeTags(s: string): string {
  return Array.from(s)
    .map((c) => {
      const cp = c.codePointAt(0) ?? 0;
      return cp >= 0xe0000 && cp <= 0xe007f ? String.fromCharCode(cp - 0xe0000) : c;
    })
    .join("");
}

interface Range {
  start: number;
  end: number;
  finding: Finding;
  decoded?: string;
}

const SEVERITY_RANK = { low: 0, medium: 1, high: 2 } as const;

/** Locate each finding in the raw content and split into plain / highlighted segments. */
export function xraySegments(raw: string, findings: Finding[]): { segments: XRaySegment[]; unplaced: Finding[] } {
  const ranges: Range[] = [];
  const unplaced: Finding[] = [];
  const tagRuns = [...raw.matchAll(TAG_RUN_RE)].map((m) => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, text: m[0] }));
  const overlaps = (s: number, e: number) => ranges.some((r) => s < r.end && e > r.start);

  // Highest severity first so the most important finding wins an overlap.
  const ordered = [...findings].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  for (const f of ordered) {
    let placed = false;
    if (f.text) {
      let from = 0;
      for (;;) {
        const idx = raw.indexOf(f.text, from);
        if (idx === -1) break;
        if (!overlaps(idx, idx + f.text.length)) {
          ranges.push({ start: idx, end: idx + f.text.length, finding: f });
          placed = true;
          break;
        }
        from = idx + 1;
      }
    }
    if (!placed && f.kind === "UNICODE_TAG") {
      const run = tagRuns.find((t) => !overlaps(t.start, t.end));
      if (run) {
        ranges.push({ start: run.start, end: run.end, finding: f, decoded: decodeTags(run.text) });
        placed = true;
      }
    }
    if (!placed) unplaced.push(f);
  }

  ranges.sort((a, b) => a.start - b.start);
  const segments: XRaySegment[] = [];
  let pos = 0;
  for (const r of ranges) {
    if (r.start > pos) segments.push({ text: raw.slice(pos, r.start) });
    segments.push({ text: raw.slice(r.start, r.end), finding: r.finding, decoded: r.decoded });
    pos = r.end;
  }
  if (pos < raw.length) segments.push({ text: raw.slice(pos) });
  return { segments, unplaced };
}

/** Clip segments to the character window [start, end) of the concatenated text. */
export function clipSegments(segments: XRaySegment[], start: number, end: number): XRaySegment[] {
  const out: XRaySegment[] = [];
  let pos = 0;
  for (const seg of segments) {
    const s = pos;
    const e = pos + seg.text.length;
    pos = e;
    if (e <= start || s >= end) continue;
    if (seg.finding) {
      out.push(seg);
    } else {
      out.push({ text: seg.text.slice(Math.max(0, start - s), seg.text.length - Math.max(0, e - end)) });
    }
  }
  return out;
}

export function firstFindingStart(segments: XRaySegment[]): number {
  let pos = 0;
  for (const seg of segments) {
    if (seg.finding) return pos;
    pos += seg.text.length;
  }
  return 0;
}
