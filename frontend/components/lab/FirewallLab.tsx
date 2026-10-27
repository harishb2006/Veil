"use client";
// Firewall lab: pick or paste content, send it through POST /firewall/scan and X-ray the findings.
// Falls back to an in-browser simulation (with a visible "Demo data" badge) when the backend is unreachable.
import { AlertTriangle, ScanSearch } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MockBadge } from "@/components/site/MockBadge";
import { useMockMode } from "@/components/site/useMockMode";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Kbd } from "@/components/ui/Kbd";
import { Spinner } from "@/components/ui/Spinner";
import { ApiError, errorMessage } from "@/lib/api";
import { getSamples, getSandboxPage, scanContent } from "@/lib/firewall";
import { BUILTIN_EXAMPLES, type BuiltinExample } from "@/lib/samples";
import type { ContentType, FirewallResult, SamplePage, Samples } from "@/lib/types";
import { ResultTabs, type TabId } from "./ResultViews";
import { FindingsList, Timings, VerdictBanner } from "./Verdict";

const TYPES: { id: ContentType; label: string }[] = [
  { id: "html", label: "HTML" },
  { id: "text", label: "Text" },
  { id: "email", label: "Email" },
];

function attackLabel(attack: string | null) {
  return attack ? <span className="text-outer">{attack}</span> : <span className="text-mist">clean</span>;
}

export function FirewallLab() {
  const { useMock, setUseMock, ready } = useMockMode();
  const [fallback, setFallback] = useState(false);
  const mock = useMock || fallback;

  const [samples, setSamples] = useState<Samples | null>(null);
  const [content, setContent] = useState("");
  const [contentType, setContentType] = useState<ContentType>("html");
  const [selected, setSelected] = useState<string>("custom");
  const [result, setResult] = useState<FirewallResult | null>(null);
  const [scannedRaw, setScannedRaw] = useState("");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("xray");
  const [activeId, setActiveId] = useState<string | null>(null);
  const seq = useRef(0);
  const [bootKey, setBootKey] = useState(0);
  const bootedKey = useRef(-1);

  const runScan = useCallback(
    async (raw: string, type: ContentType, forceMock = false) => {
      if (!raw.trim()) return;
      const id = ++seq.current;
      setScanning(true);
      setError(null);
      setActiveId(null);
      const wantMock = mock || forceMock;
      try {
        const res = await scanContent(raw, type, { useMock: wantMock });
        if (id !== seq.current) return;
        setResult(res);
        setScannedRaw(raw);
      } catch (err) {
        if (id !== seq.current) return;
        if (!wantMock && err instanceof ApiError && err.unreachable) {
          setFallback(true);
          try {
            const res = await scanContent(raw, type, { useMock: true });
            if (id !== seq.current) return;
            setResult(res);
            setScannedRaw(raw);
          } catch (e2) {
            setError(errorMessage(e2));
          }
        } else {
          setError(errorMessage(err));
        }
      } finally {
        if (id === seq.current) setScanning(false);
      }
    },
    [mock],
  );

  const pickBuiltin = useCallback(
    (ex: BuiltinExample) => {
      setSelected(`builtin:${ex.id}`);
      setContent(ex.content);
      setContentType(ex.content_type);
      setTab("xray");
      void runScan(ex.content, ex.content_type);
    },
    [runScan],
  );

  const pickPage = useCallback(
    async (page: SamplePage) => {
      setSelected(`page:${page.url}`);
      setError(null);
      setTab("xray");
      try {
        const html = await getSandboxPage(page.url, mock);
        setContent(html);
        setContentType("html");
        void runScan(html, "html");
      } catch (err) {
        setError(errorMessage(err));
      }
    },
    [mock, runScan],
  );

  // Load the sandbox samples, then scan the first built-in example so the page opens with a result.
  // Re-runs only when the data source is toggled (bootKey); runScan is read through a ref so that the
  // fallback switch below doesn't cancel the boot sequence half way.
  const runScanRef = useRef(runScan);
  useEffect(() => {
    runScanRef.current = runScan;
  });
  useEffect(() => {
    if (!ready || bootedKey.current === bootKey) return;
    bootedKey.current = bootKey;
    (async () => {
      let wantMock = useMock;
      try {
        setSamples(await getSamples(useMock));
      } catch (err) {
        if (err instanceof ApiError && err.unreachable) {
          wantMock = true;
          setFallback(true);
          setSamples(await getSamples(true));
        }
      }
      const first = BUILTIN_EXAMPLES[0];
      setSelected(`builtin:${first.id}`);
      setContent(first.content);
      setContentType(first.content_type);
      void runScanRef.current(first.content, first.content_type, wantMock);
    })();
  }, [ready, bootKey, useMock]);

  const pickFinding = (id: string) => {
    setActiveId((cur) => (cur === id ? null : id));
    setTab("xray");
  };

  return (
    <div className="container-page pb-8 pt-14 sm:pt-20">
      <header className="mb-10 max-w-3xl">
        <h1>Firewall lab</h1>
        <p className="prose-measure mt-4 text-lg text-mist">
          Pick a page or paste your own content. The outer door finds text a person can&apos;t see and orders aimed at an AI,
          removes them, and shows you exactly what the model receives instead.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {mock && <MockBadge label="Demo data · simulated in the browser" />}
          <button
            type="button"
            onClick={() => {
              setFallback(false);
              setUseMock(!mock);
              setSamples(null);
              setBootKey((k) => k + 1);
            }}
            className="text-sm text-mist underline decoration-line underline-offset-4 hover:text-ink"
          >
            {mock ? "Try the live backend" : "Use demo data"}
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        {/* input */}
        <div className="min-w-0 space-y-5">
          <Card padded={false}>
            <div className="border-b border-line px-4 py-3">
              <p className="text-sm font-medium text-ink">Pick a sample</p>
            </div>
            <div className="scroll-thin max-h-72 space-y-1 overflow-y-auto p-2">
              {samples && !mock && samples.pages.length > 0 && (
                <>
                  <p className="px-2 pb-1 pt-2 text-xs text-mist">Sandbox pages (from the backend)</p>
                  {samples.pages.map((p) => (
                    <SampleRow
                      key={p.url}
                      active={selected === `page:${p.url}`}
                      title={p.title}
                      sub={p.url}
                      badge={attackLabel(p.attack)}
                      onClick={() => void pickPage(p)}
                    />
                  ))}
                  <p className="px-2 pb-1 pt-3 text-xs text-mist">Built-in examples</p>
                </>
              )}
              {BUILTIN_EXAMPLES.map((ex) => (
                <SampleRow
                  key={ex.id}
                  active={selected === `builtin:${ex.id}`}
                  title={ex.title}
                  sub={ex.tagline}
                  badge={attackLabel(ex.attack)}
                  onClick={() => pickBuiltin(ex)}
                />
              ))}
            </div>
          </Card>

          <Card padded={false}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
              <p className="text-sm font-medium text-ink">Content</p>
              <div role="group" aria-label="Content type" className="flex rounded-md border border-line bg-panel p-0.5">
                {TYPES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={contentType === t.id}
                    onClick={() => setContentType(t.id)}
                    className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                      contentType === t.id ? "bg-hull text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-mist hover:text-ink"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <textarea
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                setSelected("custom");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void runScan(content, contentType);
              }}
              spellCheck={false}
              aria-label="Content to scan"
              placeholder="Paste HTML, a plain-text document or an email…"
              className="scroll-thin block h-64 w-full resize-y bg-transparent px-4 py-3 font-mono text-[12.5px] leading-relaxed text-ink placeholder:text-mist focus:outline-none"
            />
            <div className="flex items-center justify-between gap-3 border-t border-line bg-panel/60 px-4 py-3">
              <p className="hidden text-xs text-mist sm:block">
                <Kbd>Ctrl</Kbd> <Kbd>↵</Kbd> to scan · {content.length.toLocaleString()} chars
              </p>
              <Button
                variant="primary"
                className="max-sm:w-full sm:ml-auto"
                disabled={!content.trim() || scanning}
                onClick={() => void runScan(content, contentType)}
              >
                {scanning ? <Spinner /> : <ScanSearch className="h-4 w-4" aria-hidden />}
                Scan content
              </Button>
            </div>
          </Card>
        </div>

        {/* output */}
        <div className="min-w-0 space-y-5" aria-live="polite">
          {error && (
            <div role="alert" className="flex items-start gap-3 rounded-lg border border-threat/30 bg-threat/[0.06] p-4 text-sm text-ink">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-threat" aria-hidden />
              <p>{error}</p>
            </div>
          )}

          {!result && !error && (
            <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-line text-sm text-mist">
              {scanning ? (
                <span className="flex items-center gap-2">
                  <Spinner /> Scanning locally…
                </span>
              ) : (
                "Pick a sample or paste content to see the verdict."
              )}
            </div>
          )}

          {result && (
            <div className={`space-y-5 transition-opacity ${scanning ? "opacity-50" : ""}`}>
              <VerdictBanner result={result} />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Timings result={result} />
                {scanning && (
                  <span className="flex items-center gap-2 text-xs text-mist">
                    <Spinner className="h-3 w-3" /> Re-scanning…
                  </span>
                )}
              </div>
              <Card className="!p-4 sm:!p-5">
                <ResultTabs tab={tab} onTab={setTab} raw={scannedRaw} result={result} activeId={activeId} onPick={pickFinding} />
              </Card>
              <div>
                <h2 className="mb-3 text-lg">Findings</h2>
                <FindingsList findings={result.findings} activeId={activeId} onPick={pickFinding} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SampleRow({
  active,
  title,
  sub,
  badge,
  onClick,
}: {
  active: boolean;
  title: string;
  sub: string;
  badge: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${
        active ? "bg-panel shadow-[inset_2px_0_0_var(--color-ink)]" : "hover:bg-panel/60"
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{title}</span>
        <span className="block truncate text-xs text-mist">{sub}</span>
      </span>
      <span className="shrink-0 text-xs font-medium">{badge}</span>
    </button>
  );
}
