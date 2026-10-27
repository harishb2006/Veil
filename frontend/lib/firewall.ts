// Firewall lab client: POST /firewall/scan, GET /sandbox/samples, GET /sandbox/page?url=.
// Each call falls back to the built-in mock only when the caller asks for it (useMock) so the UI can show a badge.
import { request } from "./api";
import { mockFirewallScan, mockSamples } from "./mock";
import { BUILTIN_EXAMPLES } from "./samples";
import type { ContentType, FirewallResult, Samples } from "./types";

export function scanContent(
  content: string,
  contentType: ContentType,
  opts: { tool?: string; useMock?: boolean } = {},
): Promise<FirewallResult> {
  if (opts.useMock) return mockFirewallScan(content, contentType);
  return request<FirewallResult>("/firewall/scan", {
    method: "POST",
    body: JSON.stringify({ content, content_type: contentType, tool: opts.tool ?? "fetch_page" }),
  });
}

export function getSamples(useMock = false): Promise<Samples> {
  return useMock ? Promise.resolve(mockSamples()) : request<Samples>("/sandbox/samples", { timeoutMs: 6000 });
}

export async function getSandboxPage(url: string, useMock = false): Promise<string> {
  if (useMock) {
    const id = url.replace("demo://", "");
    const ex = BUILTIN_EXAMPLES.find((e) => e.id === id);
    if (!ex) throw new Error("Unknown demo page.");
    return ex.content;
  }
  const res = await request<{ url: string; html: string }>(`/sandbox/page?url=${encodeURIComponent(url)}`, {
    timeoutMs: 8000,
  });
  return res.html;
}
