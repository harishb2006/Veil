"use client";

import { memo, useMemo, useState } from "react";
import { motion } from "motion/react";
import { ChevronRight, MessageSquare } from "lucide-react";
import { argToString, rehydratedKeys } from "@/lib/agent/highlight";
import type { Mode, Run, Step, ToolArgs } from "@/lib/agent/types";
import { Expandable, RichText } from "./primitives";
import { ResultDetail } from "./ResultDetail";
import { ToolIcon } from "./ToolIcon";

const UNTRUSTED = new Set(["fetch_page", "read_inbox", "read_email", "read_file"]);

interface Row {
  key: string;
  call: Step | null;
  result: Step | null;
  final: Step | null;
}

/** Merge each tool_call with the tool_result that follows it into one row. */
function buildRows(steps: Step[]): Row[] {
  const rows: Row[] = [];
  for (let n = 0; n < steps.length; n++) {
    const s = steps[n];
    if (s.type === "tool_call") {
      const next = steps[n + 1];
      if (next && next.type === "tool_result" && next.tool === s.tool) {
        rows.push({ key: `s${s.i}`, call: s, result: next, final: null });
        n++;
      } else {
        rows.push({ key: `s${s.i}`, call: s, result: null, final: null });
      }
    } else if (s.type === "tool_result") {
      rows.push({ key: `s${s.i}`, call: null, result: s, final: null });
    } else {
      rows.push({ key: `s${s.i}`, call: null, result: null, final: s });
    }
  }
  return rows;
}

function shortArgs(step: Step): string {
  const a: ToolArgs = step.args_cloud_saw ?? {};
  const first = Object.values(a)[0];
  switch (step.tool) {
    case "fetch_page":
      return argToString(a.url).replace(/^https?:\/\//, "");
    case "send_email":
      return `→ ${argToString(a.to)}`;
    case "run_shell":
      return argToString(a.command);
    case "read_file":
      return argToString(a.path);
    default:
      return first === undefined ? "" : argToString(first);
  }
}

const mentionsEvil = (a?: ToolArgs | null) => !!a && Object.values(a).some((v) => argToString(v).includes("evil.test"));

type StatusTone = "safe" | "threat" | "outer" | "mist";
const TONE_TEXT: Record<StatusTone, string> = { safe: "text-safe", threat: "text-threat", outer: "text-outer", mist: "text-mist" };

function rowStatus(row: Row, running: boolean, last: boolean): { text: string; tone: StatusTone } {
  const { call, result } = row;
  if (call?.decision && call.decision.decision !== "allow") return { text: "blocked", tone: "threat" };
  if (result?.verdict === "QUARANTINED") return { text: "quarantined", tone: "threat" };
  const n = result?.findings?.length ?? 0;
  if (result?.verdict === "SANITIZED") return { text: n > 0 ? `sanitized · ${n} finding${n === 1 ? "" : "s"}` : "sanitized", tone: "outer" };
  if (n > 0) return { text: `${n} finding${n === 1 ? "" : "s"}`, tone: "outer" };
  if (call && mentionsEvil(call.args_executed ?? call.args_cloud_saw)) {
    return { text: call.tool === "run_shell" ? "attacker command" : "sent to attacker", tone: "threat" };
  }
  if (call && !result && running && last) return { text: "running", tone: "mist" };
  return { text: "ok", tone: "safe" };
}

const RESTORED_KEYS = new Set(["to", "url", "command", "path"]);

function restoredText(call: Step): string | null {
  const changed = rehydratedKeys(call.args_cloud_saw, call.args_executed);
  if (changed.length === 0 || !call.args_executed) return null;
  const ex = call.args_executed;
  return changed.map((k) => (RESTORED_KEYS.has(k) ? argToString(ex[k]) : k)).join(" · ");
}

function Detail({ row, mode, finalText }: { row: Row; mode: Mode; finalText: string | null }) {
  if (row.final) {
    const text = finalText ?? row.final.raw_content ?? row.final.content_for_model ?? "";
    return (
      <p className="text-sm leading-relaxed text-ink">
        <RichText text={text} />
      </p>
    );
  }
  const { call, result } = row;
  const raw = result?.raw_content ?? "";
  const detailable = !!result?.tool && UNTRUSTED.has(result.tool) && raw.length > 0;
  const args = Object.entries(call?.args_cloud_saw ?? {});
  return (
    <div className="space-y-3">
      {args.length > 0 && (
        <dl className="space-y-1">
          {args.map(([k, v]) => {
            const text = argToString(v);
            return (
              <div key={k} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2 text-[13px]">
                <dt className="font-mono text-mist">{k}</dt>
                <dd className="min-w-0 font-mono text-ink">
                  <Expandable long={text.length > 220} collapsedClass="max-h-24">
                    <RichText text={text} />
                  </Expandable>
                </dd>
              </div>
            );
          })}
        </dl>
      )}
      {call?.decision && (
        <p className="text-[13px] text-mist">
          {mode === "full" ? (
            <>
              Gate: {call.decision.decision === "allow" ? "allowed" : "blocked"}. <RichText text={call.decision.reason} />
            </>
          ) : (
            "No gate in this mode: the call ran unchecked."
          )}
        </p>
      )}
      {detailable && result && (
        <ResultDetail
          raw={raw}
          forModel={result.content_for_model ?? raw}
          findings={result.findings ?? []}
          mode={mode}
          scanned={(result.findings?.length ?? 0) > 0 || result.verdict != null}
        />
      )}
      {!detailable && result && (
        <p className="text-[13px] text-mist">
          Result: <RichText text={result.content_for_model ?? raw} />
        </p>
      )}
    </div>
  );
}

function ActivityRow({
  row,
  mode,
  finalText,
  running,
  last,
}: {
  row: Row;
  mode: Mode;
  finalText: string | null;
  running: boolean;
  last: boolean;
}) {
  const step = row.call ?? row.result ?? row.final;
  const [open, setOpen] = useState(false);
  if (!step) return null;

  const blocked = !!row.call?.decision && row.call.decision.decision !== "allow";
  const restored = row.call && !blocked ? restoredText(row.call) : null;
  const status = row.final ? null : rowStatus(row, running, last);
  const args = row.final ? "" : shortArgs(row.call ?? step);

  return (
    <motion.li initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }} className="border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-start gap-2.5 rounded-sm py-2.5 text-left hover:bg-panel/60"
      >
        <span className="mt-0.5 shrink-0 text-mist">
          {row.final ? <MessageSquare className="h-4 w-4" aria-hidden /> : <ToolIcon tool={step.tool} />}
        </span>
        <span className="min-w-0 flex-1 text-[13px] leading-snug">
          {row.final ? (
            <span className="text-sm font-medium text-ink">Agent&apos;s answer</span>
          ) : (
            <>
              <span className="font-mono font-medium text-ink">{step.tool}</span>{" "}
              <span className="font-mono text-mist">
                <RichText text={args} />
              </span>
            </>
          )}
        </span>
        {status && <span className={`shrink-0 text-[13px] ${TONE_TEXT[status.tone]}`}>{status.text}</span>}
        <ChevronRight className={`mt-0.5 h-4 w-4 shrink-0 text-mist transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
      </button>
      {blocked && row.call?.decision && (
        <p className="-mt-1 pb-2.5 pl-[26px] text-sm leading-snug text-threat">
          <RichText text={row.call.decision.reason} />
        </p>
      )}
      {restored && (
        <p className="-mt-1 pb-2.5 pl-[26px] text-[13px] leading-snug text-mist">
          → <RichText text={restored} /> (restored locally)
        </p>
      )}
      {open && (
        <div className="pb-3 pl-[26px]">
          <Detail row={row} mode={mode} finalText={finalText} />
        </div>
      )}
    </motion.li>
  );
}

const MemoRow = memo(ActivityRow);

/** Compact vertical list: one row per tool call merged with its result. */
export function ActivityLog({ run, mode }: { run: Run; mode: Mode }) {
  const rows = useMemo(() => buildRows(run.steps), [run.steps]);
  const running = run.status === "running";
  return (
    <ol aria-label="Activity log">
      {rows.map((row, i) => (
        <MemoRow key={`${run.run_id}-${row.key}`} row={row} mode={mode} finalText={run.final} running={running} last={i === rows.length - 1} />
      ))}
    </ol>
  );
}
