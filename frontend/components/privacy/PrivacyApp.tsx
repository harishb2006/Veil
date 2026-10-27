"use client";
// Inner door workspace (v1): paste → scan locally (POST /scan) → ask the cloud safely (POST /ask) → restore locally.
// Same API calls as v1. When the backend is unreachable it switches to the in-browser mock and shows a badge.
import { ArrowLeft, ArrowRight, Cloud, RefreshCw, Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MockBadge } from "@/components/site/MockBadge";
import { useMockMode } from "@/components/site/useMockMode";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { ApiError, errorMessage, getApi } from "@/lib/api";
import { SAMPLES } from "@/lib/samples";
import type { Health, ScanResponse } from "@/lib/types";
import { Composer } from "./Composer";
import { ErrorBanner, type ErrorInfo } from "./ErrorBanner";
import { Workspace, type Turn } from "./Workspace";

const HEALTH_POLL_MS = 10_000;
const FOLLOW_UPS = ["What was the API key?", "Make it shorter and friendlier."];

type HealthState = { status: "loading" } | { status: "ok"; health: Health } | { status: "down"; error: string };

function useElapsedSeconds(running: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!running) return;
    setSeconds(0);
    const started = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(id);
  }, [running]);
  return seconds;
}

function askErrorTitle(err: unknown): string {
  if (errorMessage(err).includes("Refusing to send")) return "Blocked: a secret was about to leave";
  if (err instanceof ApiError && err.status === 502) return "Cloud model error";
  return "Ask failed";
}

export function PrivacyApp() {
  const { useMock, setUseMock, ready } = useMockMode();
  const [health, setHealth] = useState<HealthState>({ status: "loading" });

  const [view, setView] = useState<"compose" | "workspace">("compose");
  const [text, setText] = useState(SAMPLES[0].text);
  const [scannedText, setScannedText] = useState("");
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<{ message: string; status: number | null } | null>(null);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [asking, setAsking] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<string>();
  const [askError, setAskError] = useState<unknown>(null);
  const [question, setQuestion] = useState("");

  const endRef = useRef<HTMLDivElement>(null);
  const scanSeconds = useElapsedSeconds(scanning);
  const api = getApi(useMock);

  // Health: poll the backend; if it can't be reached at all, fall back to the mock so the page still works.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const check = () =>
      getApi(useMock)
        .health()
        .then((h) => !cancelled && setHealth({ status: "ok", health: h }))
        .catch((err) => {
          if (cancelled) return;
          setHealth({ status: "down", error: errorMessage(err) });
          if (!useMock && err instanceof ApiError && err.unreachable) setUseMock(true);
        });
    setHealth({ status: "loading" });
    check();
    const id = setInterval(check, HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [useMock, ready, setUseMock]);

  useEffect(() => {
    if (turns.length || asking || askError) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, asking, askError]);

  const runScan = useCallback(async () => {
    const input = text.trim();
    if (!input || scanning) return;
    setView("workspace");
    setScannedText(input);
    setScan(null);
    setScanning(true);
    setScanError(null);
    setAskError(null);
    setTurns([]);
    try {
      setScan(await api.scan(input));
    } catch (err) {
      setScanError({ message: errorMessage(err), status: err instanceof ApiError ? err.status : null });
    } finally {
      setScanning(false);
    }
  }, [api, text, scanning]);

  const runAsk = useCallback(
    async (followUp?: string) => {
      if (!scan || asking) return;
      const q = followUp?.trim() || undefined;
      setAsking(true);
      setPendingQuestion(q);
      setAskError(null);
      if (q) setQuestion("");
      try {
        const answer = await api.ask(q ? { scan_id: scan.scan_id, question: q } : { scan_id: scan.scan_id });
        setTurns((prev) => [...prev, { question: q, answer }]);
      } catch (err) {
        setAskError(err);
        if (q) setQuestion(q);
      } finally {
        setAsking(false);
        setPendingQuestion(undefined);
      }
    },
    [api, scan, asking],
  );

  const backToCompose = () => {
    setView("compose");
    setScan(null);
    setScanError(null);
    setTurns([]);
    setAskError(null);
  };

  const gemmaExpected = health.status !== "ok" || health.health.gemma_loaded;
  const gemmaLoading = health.status === "ok" && health.health.gemma_status === "loading";

  const scanErrorInfo: ErrorInfo | null = scanError && {
    title: scanError.status === 503 ? "Not ready yet" : "Scan failed",
    message: scanError.message,
    action: { label: "Retry", onClick: runScan },
  };
  const askErrorInfo: ErrorInfo | null = askError
    ? {
        title: askErrorTitle(askError),
        message: errorMessage(askError),
        action:
          askError instanceof ApiError && askError.status === 404 ? { label: "Scan again", onClick: runScan } : undefined,
      }
    : null;

  const demoToggle = (
    <>
      {useMock && <MockBadge label="Demo data · simulated in the browser" />}
      <button
        type="button"
        onClick={() => setUseMock(!useMock)}
        className="text-sm text-mist underline decoration-line underline-offset-4 hover:text-ink"
      >
        {useMock ? "Try the live backend" : "Use demo data"}
      </button>
    </>
  );

  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] flex-col">
      {view === "workspace" && (
        <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-3 px-4 pt-4 sm:px-6">{demoToggle}</div>
      )}

      <div className="flex-1">
        {view === "compose" ? (
          <Composer
            text={text}
            onTextChange={setText}
            samples={SAMPLES}
            onScan={runScan}
            scanning={scanning}
            toolbar={demoToggle}
            notice={
              gemmaLoading && (
                <p className="flex items-center gap-2.5 rounded-lg border border-line bg-panel px-4 py-3 text-sm text-ink">
                  <Spinner className="h-3.5 w-3.5 text-mist" />
                  Gemma is still loading on the backend (about a minute after startup). Scans will work once it&apos;s
                  ready.
                </p>
              )
            }
          />
        ) : (
          <>
            <Workspace
              text={scannedText}
              scan={scan}
              scanning={scanning}
              scanSeconds={scanSeconds}
              gemmaExpected={gemmaExpected}
              scanError={scanErrorInfo}
              turns={turns}
              asking={asking}
              pendingQuestion={pendingQuestion}
              askError={askErrorInfo}
            />
            <div ref={endRef} />
          </>
        )}
      </div>

      {view === "workspace" && (
        <div className="sticky bottom-0 z-30 border-t border-line bg-void/90 backdrop-blur">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
            <Button variant="secondary" onClick={backToCompose} disabled={scanning || asking}>
              {turns.length > 0 ? <RefreshCw className="h-4 w-4" aria-hidden /> : <ArrowLeft className="h-4 w-4" aria-hidden />}
              {turns.length > 0 ? "New scan" : "Edit text"}
            </Button>

            {scanning && (
              <p className="flex items-center gap-2 text-sm text-mist">
                <Spinner className="h-3.5 w-3.5" /> Scanning locally — nothing leaves this device.
              </p>
            )}

            {scan && turns.length === 0 && (
              <>
                <p className="ml-auto hidden text-sm text-mist md:block">
                  Only the <span className="font-medium text-ink">cloud lane</span> will be sent.
                </p>
                <Button onClick={() => runAsk()} disabled={asking} className="max-md:ml-auto">
                  {asking ? <Spinner /> : <Cloud className="h-4 w-4" aria-hidden />}
                  {asking ? "Asking the cloud…" : "Ask the cloud safely"}
                  {!asking && <ArrowRight className="h-4 w-4" aria-hidden />}
                </Button>
              </>
            )}

            {scan && turns.length > 0 && (
              <form
                className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (question.trim()) runAsk(question);
                }}
              >
                {FOLLOW_UPS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => runAsk(q)}
                    disabled={asking}
                    className="rounded-md border border-line bg-hull px-3 py-1.5 text-xs font-medium text-mist transition-colors hover:border-mist/50 hover:text-ink disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
                <input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Ask a follow-up — same placeholders, same session"
                  aria-label="Follow-up question"
                  className="h-9 min-w-56 flex-1 rounded-md border border-line bg-hull px-3 text-sm text-ink placeholder:text-mist focus:border-ink focus:outline-none"
                />
                <Button type="submit" disabled={asking || !question.trim()}>
                  {asking ? <Spinner /> : <Send className="h-4 w-4" aria-hidden />}
                  Send
                </Button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
