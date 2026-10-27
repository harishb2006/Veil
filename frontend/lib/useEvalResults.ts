"use client";
// useEvalResults(): loads /eval-results.json (written by the eval script) once per page. Shared by the overview
// stats band and the Results section so both always show the same numbers.
import { useEffect, useState } from "react";
import type { EvalResults } from "./types";

export type EvalLoad = { state: "loading" } | { state: "missing" } | { state: "ready"; data: EvalResults };

let cache: Promise<EvalResults> | null = null;

export function useEvalResults(): EvalLoad {
  const [load, setLoad] = useState<EvalLoad>({ state: "loading" });

  useEffect(() => {
    let cancelled = false;
    cache ??= fetch("/eval-results.json", { cache: "no-store" }).then((r) =>
      r.ok ? (r.json() as Promise<EvalResults>) : Promise.reject(new Error("missing")),
    );
    cache
      .then((data) => !cancelled && setLoad({ state: "ready", data }))
      .catch(() => {
        cache = null;
        if (!cancelled) setLoad({ state: "missing" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return load;
}

/** Normalise a rate that may be a fraction (0.74) or a percentage (74) to a fraction. */
export function frac(v: number | undefined): number | undefined {
  if (typeof v !== "number" || Number.isNaN(v)) return undefined;
  return v > 1 ? v / 100 : v;
}

export function pct(v: number | undefined): string {
  const f = frac(v);
  return f === undefined ? "n/a" : `${Math.round(f * 1000) / 10}%`;
}
