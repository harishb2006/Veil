"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MotionConfig } from "motion/react";
import { useBackend } from "@/lib/agent/useBackend";
import { useRun } from "@/lib/agent/useRun";
import { MODES, type Mode, type Run, type Scenario } from "@/lib/agent/types";
import { CloudSawDrawer } from "./CloudSawDrawer";
import { Lane } from "./Lane";
import { OutboxPanel } from "./OutboxPanel";
import { RunControls } from "./RunControls";

type RunIds = Partial<Record<Mode, string>>;

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function MissionControl() {
  const { client, ready, usingMock, mockReason, health, samples } = useBackend();

  const [task, setTask] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("full");
  const [ids, setIds] = useState<RunIds>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [presenter, setPresenter] = useState(false);
  const [drawer, setDrawer] = useState<Mode | null>(null);

  const raw = useRun(client, ids.raw ?? null);
  const full = useRun(client, ids.full ?? null);
  const states = { raw, full };
  const runs = useMemo<Record<Mode, Run | null>>(
    () => ({ raw: raw.run, full: full.run }),
    [raw.run, full.run],
  );

  const scenarios = samples?.scenarios ?? null;

  const selectScenario = useCallback((s: Scenario) => {
    setSelectedId(s.id);
    setTask(s.task);
  }, []);

  // Start on the hero scenario so the presenter can press R straight away.
  useEffect(() => {
    if (scenarios?.length && selectedId === null && task === "") selectScenario(scenarios[0]);
  }, [scenarios, selectedId, task, selectScenario]);

  const onTask = useCallback(
    (t: string) => {
      setTask(t);
      const match = scenarios?.find((s) => s.task === t);
      setSelectedId(match?.id ?? null);
    },
    [scenarios],
  );

  const runAll = useCallback(async () => {
    if (!ready || busy || !task.trim()) return;
    setBusy(true);
    setError(null);
    setDrawer(null);
    try {
      const run_ids = await client.compare(task.trim());
      setIds({ raw: run_ids.raw, full: run_ids.full });
    } catch (err) {
      setError(err instanceof Error ? `Could not start the runs: ${err.message}` : "Could not start the runs.");
    } finally {
      setBusy(false);
    }
  }, [client, ready, busy, task]);

  const runOne = useCallback(async () => {
    if (!ready || busy || !task.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const id = await client.startRun(task.trim(), mode);
      setIds((prev) => ({ ...prev, [mode]: id }));
    } catch (err) {
      setError(err instanceof Error ? `Could not start the run: ${err.message}` : "Could not start the run.");
    } finally {
      setBusy(false);
    }
  }, [client, ready, busy, task, mode]);

  const reset = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await client.resetSandbox();
      setIds({});
      setDrawer(null);
    } catch (err) {
      setError(err instanceof Error ? `Could not reset the sandbox: ${err.message}` : "Could not reset the sandbox.");
    } finally {
      setBusy(false);
    }
  }, [client]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        setDrawer(null);
        return;
      }
      if (isTyping(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === "r") {
        e.preventDefault();
        void runAll();
      } else if (key === "p") {
        setPresenter((p) => !p);
      } else if (/^[1-4]$/.test(key)) {
        const s = scenarios?.[Number(key) - 1];
        if (s) selectScenario(s);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runAll, scenarios, selectScenario]);

  const closeDrawer = useCallback(() => setDrawer(null), []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <header className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-ink">Live demo</h1>
              <p className="mt-1 text-[15px] text-mist">Same task, same agent, with and without Airlock.</p>
            </div>
            {usingMock && (
              <p
                className="text-sm text-outer"
                title={
                  mockReason === "forced"
                    ? "Demo data forced by ?mock=1 (or NEXT_PUBLIC_USE_MOCK). Scripted runs, no backend."
                    : "The backend is unreachable, so these are scripted demo runs."
                }
              >
                Demo data: recorded scripted runs, no backend
              </p>
            )}
          </div>

          <RunControls
            scenarios={scenarios}
            selectedId={selectedId}
            onSelect={selectScenario}
            task={task}
            onTask={onTask}
            mode={mode}
            onMode={setMode}
            onRunAll={() => void runAll()}
            onRunOne={() => void runOne()}
            onReset={() => void reset()}
            presenter={presenter}
            onPresenter={() => setPresenter((p) => !p)}
            busy={busy}
            ready={ready}
            health={health}
            error={error}
          />
        </header>

        <div className="grid gap-4 lg:grid-cols-2">
          {MODES.map((m) => (
            <Lane
              key={m}
              mode={m}
              runId={ids[m] ?? null}
              run={runs[m]}
              error={states[m].error}
              presenter={presenter}
              onOpenCloud={setDrawer}
            />
          ))}
        </div>

        <OutboxPanel runs={runs} />
      </div>

      <CloudSawDrawer mode={drawer} run={drawer ? runs[drawer] : null} onClose={closeDrawer} />
    </MotionConfig>
  );
}
