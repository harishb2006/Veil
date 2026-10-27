"use client";

import { useState } from "react";
import type { Finding, Mode } from "@/lib/agent/types";
import { Expandable, RichText } from "./primitives";
import { XRayText } from "./XRayText";

type Tab = "xray" | "model";

const TABS: { id: Tab; label: string }[] = [
  { id: "xray", label: "What the page contained" },
  { id: "model", label: "What the agent saw" },
];

/** Inline detail of a tool result: the X-ray of the raw content, and what the agent actually saw. */
export function ResultDetail({
  raw,
  forModel,
  findings,
  mode,
  scanned,
}: {
  raw: string;
  forModel: string;
  findings: Finding[];
  mode: Mode;
  scanned: boolean;
}) {
  const [tab, setTab] = useState<Tab>("xray");
  return (
    <div>
      <div role="tablist" className="mb-2 flex gap-4 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 pb-1.5 text-[13px] ${
              tab === t.id ? "border-ink font-medium text-ink" : "border-transparent text-mist hover:text-ink"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "xray" ? (
        <>
          {!scanned && (
            <p className="mb-2 text-[13px] text-mist">
              {mode === "full" ? "Nothing flagged." : "No outer door in this mode: the agent read this content unscanned."}
            </p>
          )}
          <XRayText raw={raw} findings={findings} />
        </>
      ) : (
        <Expandable long={forModel.length > 600} collapsedClass="max-h-48">
          <pre className="whitespace-pre-wrap break-words rounded-md bg-panel p-3 font-mono text-[13px] leading-relaxed text-ink">
            <RichText text={forModel} />
          </pre>
        </Expandable>
      )}
    </div>
  );
}
