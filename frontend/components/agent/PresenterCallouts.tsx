"use client";

import { MODE_META } from "@/lib/agent/modes";
import { calloutText } from "@/lib/agent/outcome";
import type { Mode, Run } from "@/lib/agent/types";

/** Numbered narration line under a column header in presenter mode; derived from what the run did. */
export function PresenterNote({ mode, run }: { mode: Mode; run: Run | null }) {
  const meta = MODE_META[mode];
  return (
    <p className="flex gap-2 border-b border-line bg-panel px-4 py-2 text-[15px] leading-snug text-ink">
      <span className="font-semibold tabular-nums text-mist">{meta.presenterStep}.</span>
      <span>{run ? calloutText(mode, run) : meta.presenterIdle}</span>
    </p>
  );
}
