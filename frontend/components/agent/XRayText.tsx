"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { clipSegments, firstFindingStart, xraySegments, type XRaySegment } from "@/lib/agent/highlight";
import type { Finding } from "@/lib/agent/types";

const WINDOW = 720;

function markClass(f: Finding): string {
  const base = "box-decoration-clone rounded-[3px] px-0.5 underline decoration-2 underline-offset-2";
  if (f.severity === "high") return `${base} bg-threat/10 decoration-threat`;
  if (f.hidden) return `${base} bg-outer/15 decoration-outer`;
  return `${base} bg-outer/10 decoration-outer/60`;
}

const kindLabel = (k: string) => k.replaceAll("_", " ").toLowerCase();

const tooltip = (f: Finding) =>
  `${kindLabel(f.kind)} · ${f.severity} severity · ${f.reason} · caught by ${f.tier === "gemma" ? "Gemma" : "a rule"}`;

/** Raw content with each finding highlighted: red tint = high severity, amber underline = hidden text. */
export function XRayText({ raw, findings }: { raw: string; findings: Finding[] }) {
  const [open, setOpen] = useState(false);
  const { segments, unplaced } = useMemo(() => xraySegments(raw, findings), [raw, findings]);
  const long = raw.length > WINDOW;

  const shown = useMemo(() => {
    if (!long || open) return segments;
    const start = Math.max(0, firstFindingStart(segments) - 160);
    return clipSegments(segments, start, start + WINDOW);
  }, [segments, long, open]);
  const clippedStart = long && !open && firstFindingStart(segments) > 160;
  const clippedEnd = long && !open;

  const render = (seg: XRaySegment, i: number) =>
    seg.finding ? (
      <mark key={i} title={tooltip(seg.finding)} className={markClass(seg.finding)}>
        {seg.decoded !== undefined ? (
          <>
            <span className="font-sans text-xs text-outer">invisible: </span>
            {seg.decoded}
          </>
        ) : (
          seg.text
        )}
      </mark>
    ) : (
      <span key={i}>{seg.text}</span>
    );

  return (
    <div>
      <pre className="whitespace-pre-wrap break-words rounded-md bg-panel p-3 font-mono text-[13px] leading-relaxed text-mist">
        {clippedStart && <span>… </span>}
        {shown.map(render)}
        {clippedEnd && <span> …</span>}
      </pre>
      {long && (
        <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1 inline-flex items-center gap-1 text-xs text-mist hover:text-ink">
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
          {open ? "Collapse" : `Show full content (${raw.length.toLocaleString()} chars)`}
        </button>
      )}
      {findings.length > 0 && (
        <ul className="mt-2 space-y-1">
          {findings.map((f) => (
            <li key={f.id} className="text-[13px] leading-snug text-mist">
              <span className={f.severity === "high" ? "font-medium text-threat" : "font-medium text-outer"}>
                {kindLabel(f.kind)}, {f.severity}
              </span>{" "}
              <span className="text-ink">{f.reason}</span> ({f.tier === "gemma" ? "Gemma" : "rule"})
              {unplaced.includes(f) && <span className="font-mono"> decoded: {f.text}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
