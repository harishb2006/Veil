"use client";
// The three result tabs of the firewall lab: X-ray (raw content with flagged spans), What the agent sees
// (content_for_model with Airlock markers styled) and Human view (visible_text).
import { useRef } from "react";
import { revealInvisible, segmentFindings, segmentMarkers } from "@/lib/highlight";
import type { Finding, FirewallResult } from "@/lib/types";

export type TabId = "xray" | "agent" | "human";

const TABS: { id: TabId; label: string }[] = [
  { id: "xray", label: "X-ray" },
  { id: "agent", label: "What the agent sees" },
  { id: "human", label: "Human view" },
];

export function markClass(f: Finding, active: boolean): string {
  const ring = active ? " outline outline-2 outline-ink" : "";
  const line = "underline decoration-2 underline-offset-2";
  if (f.severity === "high") return `bg-threat/10 text-ink ${line} decoration-threat${ring}`;
  return `bg-outer/10 text-ink ${line} decoration-outer${ring}`;
}

function XRay({ raw, findings, activeId, onPick }: { raw: string; findings: Finding[]; activeId: string | null; onPick: (id: string) => void }) {
  const segs = segmentFindings(raw, findings);
  return (
    <div>
      <pre className="scroll-thin max-h-[26rem] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-panel p-4 font-mono text-[12.5px] leading-relaxed text-mist">
        {segs.map((s, i) =>
          s.finding ? (
            <mark
              key={i}
              id={`xray-${s.finding.id}`}
              role="button"
              tabIndex={0}
              onClick={() => onPick(s.finding!.id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onPick(s.finding!.id))}
              title={`${s.finding.kind}: ${s.finding.reason}${s.finding.hidden ? " (hidden from humans)" : ""}`}
              className={`box-decoration-clone cursor-pointer rounded-[2px] px-[1px] ${markClass(s.finding, activeId === s.finding.id)}`}
            >
              {revealInvisible(s.text)}
            </mark>
          ) : (
            <span key={i}>{revealInvisible(s.text)}</span>
          ),
        )}
      </pre>
      <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-mist">
        <span>
          <span className="bg-outer/10 underline decoration-outer decoration-2 underline-offset-2">Underlined</span> hidden from humans or flagged
        </span>
        <span>
          <span className="bg-threat/10 underline decoration-threat decoration-2 underline-offset-2">Red</span> high severity
        </span>
        <span className="font-mono">⟦zw⟧ zero-width · invisible tag characters shown decoded</span>
      </p>
    </div>
  );
}

function AgentView({ text }: { text: string }) {
  return (
    <div>
      <pre className="scroll-thin max-h-[26rem] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-panel p-4 font-sans text-sm leading-relaxed text-ink">
        {segmentMarkers(text).map((s, i) =>
          s.marker === "removed" || s.marker === "quarantined" ? (
            <span key={i} className="mx-0.5 inline-block rounded bg-threat/10 px-1.5 py-0.5 font-mono text-[12px] font-medium text-threat">
              {s.text}
            </span>
          ) : s.marker === "datamark" ? (
            <span key={i} className="font-mono text-[11px] text-mist">
              {s.text}
            </span>
          ) : (
            <span key={i}>{s.text}</span>
          ),
        )}
      </pre>
      <p className="mt-3 text-xs leading-relaxed text-mist">
        This is the only version of the content the model receives. It is wrapped in{" "}
        <code className="font-mono text-ink">&lt;&lt;UNTRUSTED&gt;&gt;</code> markers so the model knows it is data,
        not instructions.
      </p>
    </div>
  );
}

function HumanView({ text }: { text: string }) {
  return (
    <div>
      <div className="scroll-thin max-h-[26rem] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-panel p-4 text-sm leading-relaxed text-ink">
        {text || <span className="text-mist">(nothing visible)</span>}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-mist">What a person reading the page or email would actually see.</p>
    </div>
  );
}

export function ResultTabs({
  tab,
  onTab,
  raw,
  result,
  activeId,
  onPick,
}: {
  tab: TabId;
  onTab: (t: TabId) => void;
  raw: string;
  result: FirewallResult;
  activeId: string | null;
  onPick: (id: string) => void;
}) {
  const refs = useRef<Record<TabId, HTMLButtonElement | null>>({ xray: null, agent: null, human: null });

  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = TABS[(i + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length].id;
    onTab(next);
    refs.current[next]?.focus();
  };

  return (
    <div>
      <div role="tablist" aria-label="Result views" className="flex gap-5 border-b border-line">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => onTab(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={`-mb-px border-b-2 py-2.5 text-sm font-medium transition-colors ${
              tab === t.id ? "border-ink text-ink" : "border-transparent text-mist hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="pt-4">
        {tab === "xray" && <XRay raw={raw} findings={result.findings} activeId={activeId} onPick={onPick} />}
        {tab === "agent" && <AgentView text={result.content_for_model} />}
        {tab === "human" && <HumanView text={result.visible_text} />}
      </div>
    </div>
  );
}
