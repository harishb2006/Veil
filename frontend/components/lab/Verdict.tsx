// Verdict line, timings and findings list for the firewall lab.
import { Check, ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { revealInvisible } from "@/lib/highlight";
import type { Finding, FirewallResult, Severity, Verdict } from "@/lib/types";
import type { Tone } from "@/components/ui/tone";
import { TONES } from "@/components/ui/tone";

const VERDICT: Record<Verdict, { tone: Tone; label: string; icon: typeof Check; blurb: string }> = {
  ALLOW: {
    tone: "safe",
    label: "Allowed",
    icon: ShieldCheck,
    blurb: "Nothing needed removing. The agent receives the content, marked as untrusted data.",
  },
  SANITIZED: {
    tone: "outer",
    label: "Sanitized",
    icon: ShieldAlert,
    blurb: "Hidden or hostile text was removed. The agent only receives the cleaned version.",
  },
  QUARANTINED: {
    tone: "threat",
    label: "Quarantined",
    icon: ShieldX,
    blurb: "Too much of this content was hostile to keep any of it. The agent only receives a short notice.",
  },
};

const SEVERITY_TEXT: Record<Severity, string> = { low: "text-mist", medium: "text-outer", high: "text-threat" };

export function VerdictBanner({ result }: { result: FirewallResult }) {
  const v = VERDICT[result.verdict] ?? VERDICT.ALLOW;
  const Icon = v.icon;
  const n = result.findings.length;
  return (
    <div className="border-b border-line pb-5">
      <p role="status" className={`flex items-center gap-2 text-xl font-semibold tracking-tight ${TONES[v.tone].text}`}>
        <Icon className="h-5 w-5" aria-hidden />
        {v.label}
        <span className="text-base font-normal text-mist">
          · {n} finding{n === 1 ? "" : "s"}
        </span>
      </p>
      <p className="prose-measure mt-1.5 text-sm text-mist">{v.blurb}</p>
    </div>
  );
}

export function Timings({ result }: { result: FirewallResult }) {
  const { rules, gemma } = result.timings_ms;
  return (
    <p className="text-xs text-mist">
      Rules{rules !== undefined ? ` ${rules} ms` : ""} ·{" "}
      {result.gemma_used ? `Gemma${gemma !== undefined ? ` ${gemma} ms` : ""}` : "Gemma not used"}
    </p>
  );
}

function truncate(s: string, n = 220): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

export function FindingsList({
  findings,
  activeId,
  onPick,
}: {
  findings: Finding[];
  activeId: string | null;
  onPick: (id: string) => void;
}) {
  if (findings.length === 0) {
    return (
      <p className="rounded-lg border border-line bg-hull p-4 text-sm text-mist">
        No findings. Nothing in this content looks like an instruction aimed at an AI.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-hull">
      {findings.map((f) => (
        <li key={f.id}>
          <button
            type="button"
            onClick={() => onPick(f.id)}
            aria-pressed={activeId === f.id}
            className={`w-full px-4 py-3 text-left transition-colors hover:bg-panel/60 ${activeId === f.id ? "bg-panel" : ""}`}
          >
            <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
              <span className="font-mono text-[13px] font-medium text-ink">{f.kind}</span>
              <span className={`font-medium ${SEVERITY_TEXT[f.severity]}`}>{f.severity} severity</span>
              <span className="text-mist">
                · {f.hidden ? "hidden from humans" : "in plain sight"} · found by {f.tier === "gemma" ? "Gemma" : "a rule"}
              </span>
            </p>
            <p className="mt-1 text-sm text-ink">{f.reason}</p>
            <p className="mt-2 break-words rounded bg-panel px-2 py-1.5 font-mono text-xs leading-snug text-mist">
              {truncate(revealInvisible(f.text))}
            </p>
          </button>
        </li>
      ))}
    </ul>
  );
}
