/**
 * Backend selection with automatic demo-data fallback.
 * Live calls that fail because the backend is unreachable flip the client to the mock engine
 * (sticky) and retry there; run ids starting with "mock-" always go to the mock engine.
 */

import { isNetworkError, liveApi } from "./api";
import { isMockRunId, mockApi } from "./mock";
import type { AgentClient } from "./types";

export type MockReason = "forced" | "unreachable";

export interface ClientOptions {
  forceMock: boolean;
  onFallback: (reason: MockReason) => void;
}

export function createClient({ forceMock, onFallback }: ClientOptions): AgentClient {
  let mock = forceMock;
  if (forceMock) onFallback("forced");

  async function route<T>(
    live: () => Promise<T>,
    demo: () => Promise<T>,
    opts: { fallbackOnAnyError?: boolean } = {},
  ): Promise<T> {
    if (mock) return demo();
    try {
      return await live();
    } catch (err) {
      if (opts.fallbackOnAnyError || isNetworkError(err)) {
        mock = true;
        onFallback("unreachable");
        return demo();
      }
      throw err;
    }
  }

  return {
    isMock: () => mock,
    getSamples: () => route(liveApi.getSamples, mockApi.getSamples),
    startRun: (task, mode) => route(() => liveApi.startRun(task, mode), () => mockApi.startRun(task, mode)),
    compare: (task) => route(() => liveApi.compare(task), () => mockApi.compare(task)),
    getRun: (id) => (isMockRunId(id) ? mockApi.getRun(id) : liveApi.getRun(id)),
    getOutbox: () => route(liveApi.getOutbox, mockApi.getOutbox),
    resetSandbox: () => route(liveApi.resetSandbox, mockApi.resetSandbox),
    getPage: (url) => route(() => liveApi.getPage(url), () => mockApi.getPage(url)),
    getHealth: () => route(liveApi.getHealth, mockApi.getHealth, { fallbackOnAnyError: true }),
  };
}
