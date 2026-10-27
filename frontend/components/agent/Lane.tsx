"use client";

import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle, type LucideIcon } from "lucide-react";
import { MODE_META } from "@/lib/agent/modes";
import { counters, outcome, type OutcomeTone } from "@/lib/agent/outcome";
import type { Mode, Run } from "@/lib/agent/types";
import { ActivityLog } from "./ActivityLog";
import { PresenterNote } from "./PresenterCallouts";

const TONE: Record<OutcomeTone, { icon: LucideIcon; text: string }> = {
  threat: { icon: XCircle, text: "text-threat" },
  outer: { icon: AlertTriangle, text: "text-outer" },
  safe: { icon: CheckCircle2, text: "text-safe" },
  mist: { icon: Info, text: "text-mist" },
};

function Result({ run }: { run: Run }) {
  const c = counters(run);
  const counts = (
    <p className="mt-1 text-[13px] tabular-nums text-mist">
      {c.toolCalls} tool calls · {c.blocked} blocked · {c.findings} findings
    </p>
  );
  if (run.status === "running") {
    return (
      <div className="border-b border-line px-4 py-3">
        <p className="flex items-center gap-2 text-[15px] text-mist">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
          Running…
        </p>
        {counts}
      </div>
    );
  }
  const o = outcome(run);
  const { icon: Icon, text } = TONE[o.tone];
  return (
    <div className="border-b border-line px-4 py-3">
      <p className={`flex items-start gap-2 text-[15px] font-medium leading-snug ${text}`}>
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span className="min-w-0 break-words">{o.text}</span>
      </p>
      {counts}
    </div>
  );
}

export function Lane({
  mode,
  runId,
  run,
  error,
  presenter,
  onOpenCloud,
}: {
  mode: Mode;
  runId: string | null;
  run: Run | null;
  error: string | null;
  presenter: boolean;
  onOpenCloud: (mode: Mode) => void;
}) {
  const meta = MODE_META[mode];
  return (
    <section aria-label={meta.label} className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-hull">
      <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">{meta.label}</h2>
          <p className="mt-0.5 text-sm leading-snug text-mist">{meta.protection}</p>
        </div>
        <button
          type="button"
          disabled={!run}
          onClick={() => onOpenCloud(mode)}
          className="shrink-0 rounded-sm text-[13px] text-mist underline-offset-4 hover:text-ink hover:underline disabled:cursor-not-allowed disabled:no-underline disabled:opacity-50 disabled:hover:text-mist"
        >
          What the cloud saw
        </button>
      </header>

      {presenter && <PresenterNote mode={mode} run={run} />}

      {error && (
        <p role="alert" className="border-b border-line px-4 py-3 text-sm text-threat">
          Connection lost: {error}
        </p>
      )}
      {run && <Result run={run} />}

      <div className="min-h-[10rem] flex-1 px-4 py-1">
        {!run ? (
          <p className="py-8 text-center text-sm text-mist">
            {runId ? "Starting…" : "Run the comparison to see what this agent does."}
          </p>
        ) : (
          <ActivityLog run={run} mode={mode} />
        )}
      </div>
    </section>
  );
}
