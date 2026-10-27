/** Live backend client for the agent endpoints (docs/BUILD_PLAN.md §5). */

import type {
  Health,
  Mode,
  OutboxItem,
  PageResponse,
  Run,
  RunIds,
  Samples,
} from "./types";

export const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** True for failures that mean "backend unreachable" (as opposed to an HTTP error response). */
export function isNetworkError(err: unknown): boolean {
  return !(err instanceof ApiError);
}

async function request<T>(path: string, init?: RequestInit, timeoutMs = 8000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body: unknown = await res.json();
        if (body && typeof body === "object" && "detail" in body) detail = String((body as { detail: unknown }).detail);
      } catch {
        /* keep statusText */
      }
      throw new ApiError(res.status, detail || `HTTP ${res.status}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export const liveApi = {
  getSamples: () => request<Samples>("/sandbox/samples"),
  startRun: async (task: string, mode: Mode) =>
    (await request<{ run_id: string }>("/agent/run", post({ task, mode }))).run_id,
  compare: async (task: string) =>
    (await request<{ run_ids: RunIds }>("/agent/compare", post({ task }))).run_ids,
  getRun: (runId: string) => request<Run>(`/agent/runs/${encodeURIComponent(runId)}`),
  getOutbox: async () => (await request<{ outbox: OutboxItem[] }>("/sandbox/outbox")).outbox,
  resetSandbox: async () => {
    await request<{ ok: boolean }>("/sandbox/reset", post({}));
  },
  getPage: (url: string) => request<PageResponse>(`/sandbox/page?url=${encodeURIComponent(url)}`),
  getHealth: () => request<Health>("/health", undefined, 4000),
};
