// Backend client shared by every page. Exports: API_URL, ApiError, request<T>(), errorMessage(),
// MOCK_BY_DEFAULT, getHealth(), getApi() (v1 scan/ask with mock fallback).
import { mockApi } from "./mock";
import type { AirlockApi, AskRequest, AskResponse, Health, ScanResponse } from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");
export const MOCK_BY_DEFAULT = process.env.NEXT_PUBLIC_USE_MOCK === "true";

// Gemma can take several seconds per scan; the cloud call can be slow too.
const REQUEST_TIMEOUT_MS = 120_000;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number | null,
  ) {
    super(message);
    this.name = "ApiError";
  }
  /** True when the backend could not be reached at all (as opposed to answering with an error). */
  get unreachable(): boolean {
    return this.status === null;
  }
}

function describeStatus(status: number, detail: string): string {
  switch (status) {
    case 400:
    case 413:
    case 422:
      return detail || `The backend rejected the request (${status}).`;
    case 404:
      return detail || "Not found. The backend may have restarted. Try again.";
    case 502:
      return `The cloud model returned an error${detail ? `: ${detail}` : "."}`;
    case 503:
      return detail || "The backend isn't ready yet. Try again shortly.";
    default:
      return `Backend error ${status}${detail ? `: ${detail}` : ""}`;
  }
}

/** JSON request against the Veil backend. Throws ApiError (status null = unreachable / timeout). */
export async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...rest } = init ?? {};
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...rest,
      headers: { "Content-Type": "application/json", ...(rest.headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      throw new ApiError(`The backend took longer than ${Math.round(timeoutMs / 1000)}s to answer.`, null);
    }
    throw new ApiError(`Can't reach the Veil backend at ${API_URL}. Is it running?`, null);
  }

  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = typeof body?.detail === "string" ? body.detail : JSON.stringify(body?.detail ?? body);
    } catch {
      // Non-JSON error body; the status code alone will have to do.
    }
    throw new ApiError(describeStatus(res.status, detail), res.status);
  }
  return (await res.json()) as T;
}

export function getHealth(): Promise<Health> {
  return request<Health>("/health", { timeoutMs: 4000 });
}

const httpApi: AirlockApi = {
  health: () => getHealth(),
  scan: (text) => request<ScanResponse>("/scan", { method: "POST", body: JSON.stringify({ text }) }),
  ask: (req: AskRequest) => request<AskResponse>("/ask", { method: "POST", body: JSON.stringify(req) }),
};

export function getApi(useMock: boolean): AirlockApi {
  return useMock ? mockApi : httpApi;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
