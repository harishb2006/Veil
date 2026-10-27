"use client";
// <StatusPill/>: live backend status. Polls GET /health every 10 s; hover or focus it for the details
// (Gemma loaded or rules-only, agent provider, firewall tiers). Shows "Offline — demo data" in mock mode.
import { useEffect, useState } from "react";
import { MOCK_BY_DEFAULT, errorMessage, getHealth } from "@/lib/api";
import type { Health } from "@/lib/types";
import type { Tone } from "@/components/ui/tone";
import { TONES } from "@/components/ui/tone";

const POLL_MS = 10_000;

type State = { status: "loading" } | { status: "ok"; health: Health } | { status: "down"; error: string } | { status: "mock" };

function summary(s: State): { tone: Tone; label: string } {
  if (s.status === "mock") return { tone: "outer", label: "Offline — demo data" };
  if (s.status === "loading") return { tone: "neutral", label: "Checking backend…" };
  if (s.status === "down") return { tone: "threat", label: "Offline — demo data" };
  const h = s.health;
  if (h.gemma_status === "loading") return { tone: "inner", label: "Gemma 4 loading…" };
  return h.gemma_loaded ? { tone: "safe", label: "Gemma 4 loaded" } : { tone: "outer", label: "Backend: rules-only" };
}

function Row({ k, v, tone = "neutral" }: { k: string; v: string; tone?: Tone }) {
  return (
    <div className="flex items-baseline justify-between gap-6 text-xs">
      <dt className="text-mist">{k}</dt>
      <dd className={`text-right font-medium ${TONES[tone].text === "text-mist" ? "text-ink" : TONES[tone].text}`}>{v}</dd>
    </div>
  );
}

export function StatusPill() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    const flag = new URLSearchParams(window.location.search).get("mock");
    if (flag === "1" || flag === "true" || (MOCK_BY_DEFAULT && flag !== "0" && flag !== "false")) {
      setState({ status: "mock" });
      return;
    }
    let cancelled = false;
    const check = () =>
      getHealth()
        .then((health) => !cancelled && setState({ status: "ok", health }))
        .catch((err) => !cancelled && setState({ status: "down", error: errorMessage(err) }));
    check();
    const id = setInterval(check, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const { tone, label } = summary(state);
  const h = state.status === "ok" ? state.health : null;

  return (
    <div className="group/status relative">
      <button type="button" className="inline-flex items-center gap-2 rounded-md px-1.5 py-1 text-sm text-mist" aria-describedby="backend-status-details">
        <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${TONES[tone].dot}`} />
        <span className="hidden sm:inline">{label}</span>
        <span className="sm:hidden">Status</span>
      </button>
      <div
        id="backend-status-details"
        role="status"
        className="pointer-events-none invisible absolute right-0 top-full z-40 mt-2 w-72 rounded-lg border border-line bg-hull p-3.5 opacity-0 shadow-[0_8px_24px_rgb(0_0_0/0.5)] transition group-focus-within/status:visible group-focus-within/status:opacity-100 group-hover/status:visible group-hover/status:opacity-100"
      >
        <p className="mb-2 text-sm font-medium text-ink">Backend</p>
        <dl className="space-y-1.5">
          {state.status === "mock" && <Row k="Mode" v="Simulated in the browser" tone="outer" />}
          {state.status === "loading" && <Row k="Status" v="Checking…" />}
          {state.status === "down" && (
            <>
              <Row k="Status" v="Unreachable" tone="threat" />
              <p className="pt-1 text-xs leading-snug text-mist">{state.error} Pages fall back to demo data.</p>
            </>
          )}
          {h && (
            <>
              <Row
                k="Gemma"
                v={h.gemma_loaded ? `${h.model_alias} loaded` : h.gemma_status === "loading" ? "loading" : "not loaded · rules only"}
                tone={h.gemma_loaded ? "safe" : "outer"}
              />
              {h.firewall && (
                <Row
                  k="Firewall"
                  v={h.firewall.gemma_injection ? "rules + Gemma" : "rules only"}
                  tone={h.firewall.gemma_injection ? "safe" : "outer"}
                />
              )}
              {h.agent && (
                <Row
                  k="Agent"
                  v={h.agent.provider === "scripted" ? "scripted demo agent" : `${h.agent.provider} · ${h.agent.model}`}
                />
              )}
              <Row k="Cloud model" v={h.cloud_configured ? "configured" : "not configured"} tone={h.cloud_configured ? "safe" : "outer"} />
            </>
          )}
        </dl>
      </div>
    </div>
  );
}
