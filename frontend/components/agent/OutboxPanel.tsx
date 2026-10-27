"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { CANARY } from "@/lib/agent/highlight";
import { MODE_META } from "@/lib/agent/modes";
import { MODES, type Mode, type Run } from "@/lib/agent/types";
import { RichText } from "./primitives";

interface Entry {
  key: string;
  mode: Mode;
  kind: "email" | "shell";
  to: string;
  subject: string;
  body: string;
  ts: number;
  order: number;
}

const toTime = (ts: number | string): number => {
  if (typeof ts === "number") return ts;
  const n = Number(ts);
  return Number.isFinite(n) ? n : Date.parse(ts) / 1000 || 0;
};

type Runs = Record<Mode, Run | null>;

const COLS = "sm:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1.4fr)]";

function OutboxRow({ e }: { e: Entry }) {
  const evil = e.kind === "email" ? e.to.endsWith("evil.test") : e.body.includes("evil.test");
  const [open, setOpen] = useState(evil || e.body.includes(CANARY));
  return (
    <li className="border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`grid w-full items-start gap-x-4 gap-y-0.5 px-4 py-2.5 text-left text-sm hover:bg-panel/60 ${COLS}`}
      >
        <span className="flex items-center gap-1.5 text-ink">
          <ChevronRight className={`h-4 w-4 shrink-0 text-mist transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
          {MODE_META[e.mode].label}
        </span>
        {e.kind === "email" ? (
          <span className="min-w-0 break-words font-mono text-[13px] text-ink">
            <RichText text={e.to} />
            {evil && <span className="ml-2 font-sans text-xs font-medium text-threat">attacker</span>}
          </span>
        ) : (
          <span className="text-mist">Shell command (simulated)</span>
        )}
        {e.kind === "email" ? (
          <span className="min-w-0 break-words text-mist">{e.subject}</span>
        ) : (
          <span className="min-w-0 break-words font-mono text-[13px] text-ink">
            <RichText text={e.body} />
            {evil && <span className="ml-2 font-sans text-xs font-medium text-threat">attacker</span>}
          </span>
        )}
      </button>
      {open && e.kind === "email" && (
        <div className="px-4 pb-3 sm:pl-[calc(1rem+7rem+1rem)]">
          <p className="rounded-md bg-panel p-3 font-mono text-[13px] leading-relaxed text-ink">
            <RichText text={e.body} />
          </p>
        </div>
      )}
    </li>
  );
}

/** Everything the agents sent (emails and shell commands) across all three columns, newest first. */
export function OutboxPanel({ runs }: { runs: Runs }) {
  const entries = useMemo(() => {
    const out: Entry[] = [];
    let order = 0;
    for (const mode of MODES) {
      const run = runs[mode];
      if (!run) continue;
      for (const m of run.outbox_delta) {
        out.push({ key: `${mode}-${m.id}`, mode, kind: "email", to: m.to, subject: m.subject, body: m.body, ts: toTime(m.ts), order: order++ });
      }
      run.shell_delta.forEach((c, i) => {
        out.push({ key: `${mode}-${c.run_id}-sh${i}`, mode, kind: "shell", to: "", subject: "", body: c.command, ts: toTime(c.ts), order: order++ });
      });
    }
    return out.sort((a, b) => b.ts - a.ts || b.order - a.order);
  }, [runs]);

  return (
    <section aria-labelledby="outbox-title" className="overflow-hidden rounded-lg border border-line bg-hull">
      <h2 id="outbox-title" className="border-b border-line px-4 py-3 text-base font-semibold text-ink">
        Outbox — every email the agents sent
      </h2>
      {entries.length === 0 ? (
        <p className="px-4 py-6 text-sm text-mist">Nothing sent yet. Run the comparison to see what each agent sent, and to whom.</p>
      ) : (
        <>
          <div className={`hidden gap-x-4 border-b border-line px-4 py-2 text-[13px] text-mist sm:grid ${COLS}`}>
            <span className="pl-[22px]">Mode</span>
            <span>To</span>
            <span>Subject</span>
          </div>
          <ul>
            {entries.map((e) => (
              <OutboxRow key={e.key} e={e} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
