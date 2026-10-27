"use client";
// Overview, section 4: results. Loads /eval-results.json (written by the eval script). No number is hardcoded:
// everything shown, including the caption facts, comes from that file. Missing file gives an honest empty state.
import { useEffect, useState } from "react";
import type { DetectionStats, EvalResults, ModeStats } from "@/lib/types";
import { Reveal } from "./Reveal";

type Load = { state: "loading" } | { state: "missing" } | { state: "ready"; data: EvalResults };

function frac(v: number | undefined): number | undefined {
  if (typeof v !== "number" || Number.isNaN(v)) return undefined;
  return v > 1 ? v / 100 : v;
}
function pct(v: number | undefined): string {
  const f = frac(v);
  return f === undefined ? "n/a" : `${Math.round(f * 1000) / 10}%`;
}

const MODES: { key: "raw" | "v1" | "full"; label: string }[] = [
  { key: "raw", label: "Raw (no protection)" },
  { key: "v1", label: "Airlock v1 (inner door)" },
  { key: "full", label: "Full Airlock" },
];

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`px-4 py-3 font-medium ${className}`}>{children}</th>;
}

function EndToEnd({ data }: { data: EvalResults }) {
  const e = data.end_to_end ?? {};
  const cell = (m: ModeStats | undefined, k: keyof ModeStats, bad: boolean) => {
    const v = m?.[k];
    const f = frac(typeof v === "number" ? v : undefined);
    const tone = f === undefined ? "text-mist" : bad ? (f > 0 ? "text-threat" : "text-safe") : f >= 1 ? "text-safe" : "text-ink";
    return <td className={`px-4 py-3 tabular-nums ${tone} font-medium`}>{pct(typeof v === "number" ? v : undefined)}</td>;
  };
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-hull">
      <table className="w-full min-w-[560px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-line text-mist">
            <Th>Mode</Th>
            <Th>Attack succeeded</Th>
            <Th>Real key leaked</Th>
            <Th>Clean tasks completed</Th>
          </tr>
        </thead>
        <tbody>
          {MODES.map(({ key, label }) => (
            <tr key={key} className="border-b border-line last:border-0">
              <td className={`px-4 py-3 ${key === "full" ? "font-semibold text-ink" : "text-ink"}`}>{label}</td>
              {cell(e[key], "attack_success_rate", true)}
              {cell(e[key], "canary_leak_rate", true)}
              {cell(e[key], "clean_task_completion", false)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Detection({ rules, both }: { rules?: DetectionStats; both?: DetectionStats }) {
  const kinds = Array.from(new Set([...Object.keys(rules?.recall_by_kind ?? {}), ...Object.keys(both?.recall_by_kind ?? {})]));
  if (!rules && !both) return null;
  return (
    <div>
      <h3 className="text-xl">Detection by attack kind</h3>
      <p className="mt-2 text-sm text-mist">
        Share of attacks in each category that the outer door flagged.
        {rules?.fpr !== undefined && (
          <>
            {" "}
            False positives on clean content, rules only: <span className="font-medium text-ink">{pct(rules.fpr)}</span>
            {rules.n_clean ? ` (${rules.n_clean} clean items)` : ""}.
          </>
        )}
        {both?.fpr !== undefined && (
          <>
            {" "}
            With Gemma: <span className="font-medium text-ink">{pct(both.fpr)}</span>.
          </>
        )}
      </p>
      <div className="mt-5 overflow-x-auto rounded-xl border border-line bg-hull">
        <table className="w-full min-w-[480px] border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line text-mist">
              <Th>Attack kind</Th>
              <Th className="w-[45%]">Rules only</Th>
              {both && <Th>Rules + Gemma</Th>}
            </tr>
          </thead>
          <tbody>
            {kinds.map((k) => {
              const v = rules?.recall_by_kind?.[k];
              const f = frac(v) ?? 0;
              return (
                <tr key={k} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5 font-mono text-[13px] text-ink">{k}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-3">
                      <div className="h-1.5 flex-1 rounded-full bg-panel">
                        <div className={`h-full rounded-full ${f > 0 ? "bg-ink" : "bg-threat"}`} style={{ width: `${Math.max(f * 100, f > 0 ? 3 : 0)}%` }} />
                      </div>
                      <span className={`w-12 text-right tabular-nums ${f === 0 ? "font-medium text-threat" : "text-ink"}`}>{pct(v)}</span>
                    </div>
                  </td>
                  {both && <td className="px-4 py-2.5 tabular-nums text-ink">{pct(both.recall_by_kind?.[k])}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Caption({ data }: { data: EvalResults }) {
  const e = data.end_to_end ?? {};
  const n = e.full?.n ?? e.raw?.n;
  const rules = data.detection?.rules_only;
  const parts: string[] = [];
  if (n) parts.push(`${n} items`);
  if (rules?.n_attacks !== undefined && rules?.n_clean !== undefined) parts.push(`${rules.n_attacks} attacks and ${rules.n_clean} clean`);
  const door = data.gemma?.available ? "outer door with Gemma 4 loaded" : "rules-only outer door (Gemma 4 not loaded)";
  const agent = data.agent?.provider === "scripted" ? "a scripted worst-case agent that obeys every instruction it can parse" : data.agent?.model ? `agent ${data.agent.model}` : null;
  return (
    <div className="prose-measure space-y-2 text-sm text-mist">
      <p>
        Measured with the {door}
        {agent ? `, against ${agent}` : ""}
        {parts.length ? `, on ${parts.join(": ")}` : ""}.
        {data.latency_ms?.median_per_tool_result !== undefined && ` Median scan time per tool result: ${data.latency_ms.median_per_tool_result} ms.`}
      </p>
      {data.notes && <p>{data.notes}</p>}
      {data.generated_at && <p className="text-xs">Generated {data.generated_at.slice(0, 10)} from <code>eval-results.json</code>.</p>}
    </div>
  );
}

export function Results() {
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/eval-results.json", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<EvalResults>) : Promise.reject(new Error("missing"))))
      .then((data) => !cancelled && setLoad({ state: "ready", data }))
      .catch(() => !cancelled && setLoad({ state: "missing" }));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section id="results" className="container-page scroll-mt-20 border-t border-line py-20">
      <Reveal>
        <h2 className="max-w-[24ch]">Results</h2>
        <p className="prose-measure mt-4 text-mist">
          Every number below is read from the evaluation output when this page loads. Nothing is typed in by hand.
        </p>
      </Reveal>

      <div className="mt-10 min-h-[22rem] space-y-10">
        {load.state === "loading" && <p className="text-sm text-mist">Loading results…</p>}
        {load.state === "missing" && (
          <div className="rounded-xl border border-dashed border-line p-6 text-sm text-mist">
            <p className="font-medium text-ink">No evaluation results published yet.</p>
            <p className="mt-1">
              Run <code className="rounded bg-panel px-1 py-0.5 text-ink">python eval/run_injection_eval.py</code> from the repo root to
              write <code className="rounded bg-panel px-1 py-0.5 text-ink">frontend/public/eval-results.json</code>, then reload.
            </p>
          </div>
        )}
        {load.state === "ready" && (
          <>
            <div>
              <h3 className="text-xl">End to end</h3>
              <p className="mt-2 mb-5 text-sm text-mist">The same tasks run three ways. Lower is better for the first two columns.</p>
              <EndToEnd data={load.data} />
            </div>
            <Detection rules={load.data.detection?.rules_only} both={load.data.detection?.rules_plus_gemma} />
            <Caption data={load.data} />
          </>
        )}
      </div>
    </section>
  );
}
