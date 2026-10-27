"use client";

import { Loader2 } from "lucide-react";
import { MODE_META } from "@/lib/agent/modes";
import { MODES, type Health, type Mode, type Scenario } from "@/lib/agent/types";

const CUSTOM = "";
const selectClass =
  "rounded-md border border-line bg-hull px-2.5 py-1.5 text-sm text-ink focus-visible:outline-2 disabled:opacity-50";

function AgentLine({ health }: { health: Health | null }) {
  const agent = health?.agent;
  if (!agent) return <p className="text-[13px] text-mist">Agent: checking…</p>;
  const gemma = health?.firewall ? ` Gemma check ${health.firewall.gemma_injection ? "on" : "off"}.` : "";
  return (
    <p className="text-[13px] text-mist">
      {agent.provider === "scripted" ? (
        "Agent: scripted demo agent — obeys any instruction it reads (worst case)."
      ) : (
        <>
          Agent: <span className="font-mono">{agent.model}</span> via {agent.provider}.
        </>
      )}
      {gemma}
    </p>
  );
}

export function RunControls({
  scenarios,
  selectedId,
  onSelect,
  task,
  onTask,
  mode,
  onMode,
  onRunAll,
  onRunOne,
  onReset,
  presenter,
  onPresenter,
  busy,
  ready,
  health,
  error,
}: {
  scenarios: Scenario[] | null;
  selectedId: string | null;
  onSelect: (s: Scenario) => void;
  task: string;
  onTask: (t: string) => void;
  mode: Mode;
  onMode: (m: Mode) => void;
  onRunAll: () => void;
  onRunOne: () => void;
  onReset: () => void;
  presenter: boolean;
  onPresenter: () => void;
  busy: boolean;
  ready: boolean;
  health: Health | null;
  error: string | null;
}) {
  const canRun = ready && !busy && task.trim().length > 0;
  const textBtn =
    "rounded-sm text-sm text-mist underline-offset-4 hover:text-ink hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label htmlFor="agent-scenario" className="text-sm text-mist">
          Scenario
        </label>
        <select
          id="agent-scenario"
          value={selectedId ?? CUSTOM}
          disabled={!scenarios}
          onChange={(e) => {
            const s = scenarios?.find((x) => x.id === e.target.value);
            if (s) onSelect(s);
            e.currentTarget.blur(); // hand the keyboard back to the R / 1-4 shortcuts
          }}
          className={`${selectClass} min-w-0 max-w-full sm:min-w-[18rem]`}
        >
          {!scenarios && <option value="">Loading scenarios…</option>}
          {selectedId === null && scenarios && <option value={CUSTOM}>Custom task</option>}
          {scenarios?.map((s, i) => (
            <option key={s.id} value={s.id}>
              {i + 1}. {s.title}
              {s.clean ? " (clean)" : ""}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="agent-task" className="sr-only">
          Task for the agent
        </label>
        <textarea
          id="agent-task"
          value={task}
          onChange={(e) => onTask(e.target.value)}
          rows={2}
          spellCheck={false}
          placeholder="Summarise https://shop.test/aurora-x2 and email the summary to my manager priya@acme.test"
          className="w-full resize-y rounded-md border border-line bg-panel px-3 py-2 text-sm leading-relaxed text-ink placeholder:text-mist"
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onRunAll}
            disabled={!canRun}
            className="inline-flex items-center gap-2 rounded-md bg-signal px-4 py-2 text-sm font-medium text-void transition-colors hover:bg-signal/85 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Run comparison
          </button>
          <span className="text-[13px] text-mist">press R</span>
        </div>

        <div className="flex items-center gap-2">
          <button type="button" onClick={onRunOne} disabled={!canRun} className={textBtn}>
            Run one mode
          </button>
          <select
            aria-label="Mode for a single run"
            value={mode}
            onChange={(e) => {
              onMode(e.target.value as Mode);
              e.currentTarget.blur();
            }}
            className={selectClass}
          >
            {MODES.map((m) => (
              <option key={m} value={m}>
                {MODE_META[m].label}
              </option>
            ))}
          </select>
        </div>

        <button type="button" onClick={onReset} disabled={busy} className={textBtn}>
          Reset
        </button>
        <button
          type="button"
          onClick={onPresenter}
          aria-pressed={presenter}
          className={`${textBtn} ${presenter ? "font-medium !text-ink underline" : ""}`}
        >
          Presenter mode (P)
        </button>
      </div>

      <div className="space-y-0.5">
        <AgentLine health={health} />
        <p className="text-[13px] text-mist">Shortcuts: R run comparison, 1–4 pick scenario, P presenter mode, Esc close panel.</p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-threat">
          {error}
        </p>
      )}
    </div>
  );
}
