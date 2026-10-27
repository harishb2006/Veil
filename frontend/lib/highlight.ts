import type { Entity, Finding } from "./types";

export type SegmentKind = "original" | "placeholder" | "redacted" | "restored";

export interface Segment {
  text: string;
  kind?: SegmentKind;
  entity?: Entity;
}

export type HighlightMode =
  | "original" // raw text: mark the sensitive values
  | "sanitized" // placeholder text: mark [TYPE_N]
  | "response"; // rehydrated answer: mark restored values and leftover (redacted) placeholders

const PLACEHOLDER_RE = /\[([A-Z][A-Z_]*)_\d+\]/g;

// Never rehydrated by the backend (docs/V1_CONTEXT.md §6.1).
export const REDACTED_TYPES = new Set(["API_KEY", "PASSWORD", "JWT", "CARD", "GOV_ID"]);

interface Match {
  start: number;
  end: number;
  kind: SegmentKind;
  entity?: Entity;
}

function indexesOf(text: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let i = text.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = text.indexOf(needle, i + needle.length);
  }
  return out;
}

export function segment(text: string, entities: Entity[], mode: HighlightMode): Segment[] {
  const matches: Match[] = [];

  if (mode !== "sanitized") {
    for (const entity of entities) {
      if (mode === "response" && entity.redacted) continue;
      for (const start of indexesOf(text, entity.text)) {
        matches.push({
          start,
          end: start + entity.text.length,
          kind: mode === "original" ? "original" : "restored",
          entity,
        });
      }
    }
  }

  if (mode !== "original") {
    const byPlaceholder = new Map(entities.map((e) => [e.replacement, e]));
    for (const m of text.matchAll(PLACEHOLDER_RE)) {
      // Follow-up questions can mint placeholders the scan never returned; fall back to the type name.
      const entity = byPlaceholder.get(m[0]);
      const redacted = entity ? entity.redacted : REDACTED_TYPES.has(m[1]);
      const start = m.index ?? 0;
      matches.push({
        start,
        end: start + m[0].length,
        kind: redacted ? "redacted" : "placeholder",
        entity,
      });
    }
  }

  // Earliest first; on ties prefer the longest match. Drop anything overlapping an accepted match.
  matches.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));

  const segments: Segment[] = [];
  let pos = 0;
  for (const m of matches) {
    if (m.start < pos) continue;
    if (m.start > pos) segments.push({ text: text.slice(pos, m.start) });
    segments.push({ text: text.slice(m.start, m.end), kind: m.kind, entity: m.entity });
    pos = m.end;
  }
  if (pos < text.length) segments.push({ text: text.slice(pos) });
  return segments;
}

// ---------- outer door: findings over raw content (X-ray view) ----------


export interface FindingSegment {
  text: string;
  finding?: Finding;
}

const TAG_RUN_RE = /[\u{E0000}-\u{E007F}]+/gu;
const BASE64_RE = /[A-Za-z0-9+/]{24,}={0,2}/g;

/** Make invisible characters visible: tag characters decode to ASCII, zero-width/bidi become labelled glyphs. */
export function revealInvisible(text: string): string {
  return text
    .replace(/[\u{E0000}-\u{E007F}]/gu, (c) => String.fromCharCode((c.codePointAt(0) ?? 0xe0000) - 0xe0000))
    .replace(/[​-‍⁠﻿]/g, "⟦zw⟧")
    .replace(/[‪-‮⁦-⁩]/g, "⟦bidi⟧");
}

function rangesFor(raw: string, f: Finding): [number, number][] {
  if (f.text) {
    const direct: [number, number][] = [];
    let i = raw.indexOf(f.text);
    while (i !== -1 && direct.length < 8) {
      direct.push([i, i + f.text.length]);
      i = raw.indexOf(f.text, i + f.text.length);
    }
    if (direct.length) return direct;
  }
  // Decoded findings: the raw content holds the encoded form.
  const re = f.kind === "UNICODE_TAG" ? TAG_RUN_RE : f.kind === "BASE64" ? BASE64_RE : null;
  if (!re) return [];
  return Array.from(raw.matchAll(re), (m): [number, number] => [m.index ?? 0, (m.index ?? 0) + m[0].length]);
}

/** Split raw content into plain and flagged segments. On overlap the earliest / longest finding wins. */
export function segmentFindings(raw: string, findings: Finding[]): FindingSegment[] {
  const matches: { start: number; end: number; finding: Finding }[] = [];
  for (const f of findings) for (const [start, end] of rangesFor(raw, f)) matches.push({ start, end, finding: f });
  matches.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));

  const out: FindingSegment[] = [];
  let pos = 0;
  for (const m of matches) {
    if (m.start < pos) continue;
    if (m.start > pos) out.push({ text: raw.slice(pos, m.start) });
    out.push({ text: raw.slice(m.start, m.end), finding: m.finding });
    pos = m.end;
  }
  if (pos < raw.length) out.push({ text: raw.slice(pos) });
  return out;
}

const REMOVED_RE = /\[REMOVED BY VEIL[^\]]*\]|\[VEIL QUARANTINED[^\]]*\]|<<UNTRUSTED[^>]*>>|<<\/UNTRUSTED>>/g;

/** Split text into plain and Airlock marker segments (for "what the agent sees"). */
export function segmentMarkers(text: string): { text: string; marker?: "removed" | "quarantined" | "datamark" }[] {
  const out: { text: string; marker?: "removed" | "quarantined" | "datamark" }[] = [];
  let pos = 0;
  for (const m of text.matchAll(REMOVED_RE)) {
    const start = m.index ?? 0;
    if (start > pos) out.push({ text: text.slice(pos, start) });
    out.push({
      text: m[0],
      marker: m[0].startsWith("[REMOVED") ? "removed" : m[0].startsWith("[VEIL") ? "quarantined" : "datamark",
    });
    pos = start + m[0].length;
  }
  if (pos < text.length) out.push({ text: text.slice(pos) });
  return out;
}
