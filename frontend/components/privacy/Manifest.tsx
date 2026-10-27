// The airlock's manifest: everything held back from the cloud, and who caught it.
import { Check, Lock, Sparkles } from "lucide-react";
import type { ScanResponse } from "@/lib/types";
import { RiskBadge, SourceBadge } from "./Badges";

export function Manifest({ scan }: { scan: ScanResponse }) {
  const { entities, timings_ms: t } = scan;
  const gemmaCount = entities.filter((e) => e.source === "gemma").length;
  const ruleCount = entities.length - gemmaCount;

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between rounded-lg border border-line bg-hull p-4">
        <div>
          <p className="mb-1 text-sm font-medium text-mist">Risk</p>
          <RiskBadge risk={scan.risk} size="lg" />
        </div>
        <div className="text-right">
          <p className="text-4xl font-semibold leading-none tracking-tight tabular-nums text-ink">{entities.length}</p>
          <p className="mt-1 text-xs text-mist">held back</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-line bg-hull px-3 py-2.5">
          <p className="text-2xl font-semibold leading-none tabular-nums text-ink">{ruleCount}</p>
          <p className="mt-1 text-xs text-mist">caught by rules</p>
        </div>
        <div className="rounded-lg border border-line bg-hull px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-2xl font-semibold leading-none tabular-nums text-ink">
            {gemmaCount}
            <Sparkles className="h-4 w-4 text-mist" aria-hidden />
          </p>
          <p className="mt-1 text-xs text-mist">only Gemma caught</p>
        </div>
      </div>

      {!scan.gemma_used && (
        <p className="rounded-lg border border-outer/30 bg-outer/[0.07] px-3 py-2 text-xs text-outer">
          Gemma wasn&apos;t available for this scan — rule results only. Contextual items may be missed.
        </p>
      )}

      {entities.length === 0 ? (
        <p className="rounded-lg border border-line bg-hull p-3 text-sm text-mist">Nothing sensitive found.</p>
      ) : (
        <ul className="scroll-thin max-h-[19rem] space-y-1.5 overflow-y-auto pb-8 pr-1 [mask-image:linear-gradient(to_bottom,black_86%,transparent)]">
          {entities.map((e) => (
            <li
              key={e.text}
              className="rounded-lg border border-line bg-hull px-3 py-2.5"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-medium text-ink" title={e.text}>
                  {e.text}
                </span>
                <span className={`shrink-0 font-mono text-[11px] ${e.redacted ? "text-threat" : "text-inner"}`}>
                  {e.replacement}
                  {e.count > 1 && <span className="ml-1 text-mist">×{e.count}</span>}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <SourceBadge source={e.source} />
                <RiskBadge risk={e.risk} />
                {e.redacted && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-threat">
                    <Lock className="h-3 w-3" aria-hidden /> never restored
                  </span>
                )}
              </div>
              {e.reason && <p className="mt-1.5 text-xs leading-snug text-mist">{e.reason}</p>}
            </li>
          ))}
        </ul>
      )}

      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] tabular-nums text-mist">
        <span className="inline-flex items-center gap-1 font-medium text-safe">
          <Check className="h-3 w-3" aria-hidden /> Processed locally
        </span>
        {t.rules != null && <span>· rules {t.rules} ms</span>}
        {scan.gemma_used && t.gemma != null && <span>· Gemma {t.gemma} ms</span>}
      </p>
    </div>
  );
}
