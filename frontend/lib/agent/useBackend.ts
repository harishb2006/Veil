"use client";

import { useEffect, useState } from "react";
import { createClient, type MockReason } from "./client";
import type { AgentClient, Health, Samples } from "./types";

export interface Backend {
  client: AgentClient;
  /** null until the first probe finished. */
  mockReason: MockReason | null;
  usingMock: boolean;
  ready: boolean;
  health: Health | null;
  samples: Samples | null;
}

function wantsMock(): boolean {
  if (process.env.NEXT_PUBLIC_USE_MOCK === "true") return true;
  try {
    const q = new URLSearchParams(window.location.search).get("mock");
    return q === "1" || q === "true";
  } catch {
    return false;
  }
}

/** Creates the client once (client-side only), probes /health + samples, and tracks demo-data fallback. */
export function useBackend(): Backend {
  const [mockReason, setMockReason] = useState<MockReason | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [samples, setSamples] = useState<Samples | null>(null);
  const [ready, setReady] = useState(false);
  // Placeholder until the effect creates the real client; the page does not call it before `ready`.
  const [client, setClient] = useState<AgentClient>(() => createClient({ forceMock: false, onFallback: () => undefined }));

  useEffect(() => {
    let cancelled = false;
    const next = createClient({
      forceMock: wantsMock(),
      onFallback: (reason) => {
        if (!cancelled) setMockReason((prev) => prev ?? reason);
      },
    });
    setClient(next);
    (async () => {
      try {
        const h = await next.getHealth();
        const s = await next.getSamples();
        if (cancelled) return;
        setHealth(h);
        setSamples(s);
      } catch {
        /* surfaced by the page via empty samples */
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    client,
    mockReason,
    usingMock: mockReason !== null,
    ready,
    health,
    samples,
  };
}
