"use client";

import { useEffect, useState } from "react";
import type { AgentClient, Run } from "./types";

export const POLL_MS = 500;
const MAX_CONSECUTIVE_ERRORS = 6;

export interface RunState {
  run: Run | null;
  error: string | null;
}

/** Keep the previous object when nothing visible changed, so polling never re-renders the timeline. */
function sameRun(a: Run, b: Run): boolean {
  return (
    a.status === b.status &&
    a.steps.length === b.steps.length &&
    a.outbox_delta.length === b.outbox_delta.length &&
    a.shell_delta.length === b.shell_delta.length &&
    a.tainted === b.tainted &&
    a.ms === b.ms &&
    a.final === b.final &&
    a.error === b.error
  );
}

/** Poll GET /agent/runs/{id} every 500ms until the run is done (or errored). */
export function useRun(client: AgentClient, runId: string | null): RunState {
  const [state, setState] = useState<RunState>({ run: null, error: null });

  useEffect(() => {
    setState({ run: null, error: null });
    if (!runId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;

    const poll = async () => {
      try {
        const next = await client.getRun(runId);
        if (cancelled) return;
        failures = 0;
        setState((prev) => (prev.run && sameRun(prev.run, next) && !prev.error ? prev : { run: next, error: null }));
        if (next.status === "running") timer = setTimeout(poll, POLL_MS);
      } catch (err) {
        if (cancelled) return;
        failures++;
        if (failures >= MAX_CONSECUTIVE_ERRORS) {
          setState((prev) => ({ run: prev.run, error: err instanceof Error ? err.message : "Lost connection to the backend" }));
          return;
        }
        timer = setTimeout(poll, POLL_MS * 2);
      }
    };
    poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [client, runId]);

  return state;
}
