"use client";
// Shown in the Firewall lab while a scan runs. The rules tier finishes in milliseconds; the local Gemma pass can
// take a while on modest hardware, so this keeps the wait readable: a live timer, the stage we are in, and a
// plain note on why it takes time. Stages describe what the backend really does (rules first, then Gemma).
import { Check, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

function Step({ state, children }: { state: "done" | "active" | "todo"; children: React.ReactNode }) {
  return (
    <li className={`flex items-center gap-2.5 text-sm ${state === "todo" ? "text-mist/60" : state === "active" ? "text-ink" : "text-mist"}`}>
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
          state === "done" ? "border-safe/40 bg-safe/10 text-safe" : state === "active" ? "border-ink" : "border-line"
        }`}
      >
        {state === "done" ? (
          <Check className="h-3 w-3" aria-hidden />
        ) : state === "active" ? (
          <span className="typing-dot h-1.5 w-1.5 rounded-full bg-ink" />
        ) : null}
      </span>
      {children}
    </li>
  );
}

export function ScanProgress({ withGemma }: { withGemma: boolean }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex min-h-64 flex-col items-center justify-center gap-5 rounded-xl border border-dashed border-line px-6 py-8 text-center">
      <div className="relative flex h-14 w-14 items-center justify-center">
        <span className="absolute inset-0 animate-spin rounded-full border-2 border-line border-t-ink" />
        <ShieldCheck className="h-6 w-6 text-ink" aria-hidden />
      </div>

      <div>
        <p className="text-[15px] font-medium text-ink">{withGemma ? "Gemma is reading the page on this device…" : "Scanning locally…"}</p>
        <p className="mt-1 text-sm tabular-nums text-mist">{seconds}s · nothing leaves this machine</p>
      </div>

      <div className="relative h-1 w-full max-w-xs overflow-hidden rounded-full bg-line" aria-hidden>
        <span className="scan-sweep absolute inset-y-0 left-0 w-1/3 rounded-full bg-ink/70" />
      </div>

      <ul className="space-y-2 text-left">
        <Step state="done">Rules checked the page: hidden text, look-alike letters, encoded payloads</Step>
        {withGemma ? (
          <>
            <Step state="active">Local Gemma 4 is judging which lines try to give orders to an AI</Step>
            <Step state="todo">Merge findings, then remove or quarantine</Step>
          </>
        ) : (
          <Step state="active">Merging findings, then removing or quarantining</Step>
        )}
      </ul>

      {withGemma && (
        <p className="max-w-sm text-xs text-mist">
          The model runs on this laptop&apos;s own graphics chip, with no cloud call, so a scan can take up to a minute.
        </p>
      )}
    </div>
  );
}
