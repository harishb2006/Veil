// Step 2-3 of the inner door: three lanes, device | airlock | cloud. Lanes have no gap so the airlock's tint and
// dashed walls run continuously down the page.
import { ArrowLeft, ArrowRight, Braces, Cloud, Lock, ShieldCheck } from "lucide-react";
import { Fragment } from "react";
import { Spinner } from "@/components/ui/Spinner";
import type { AskResponse, Entity, ScanResponse } from "@/lib/types";
import { ErrorBanner, type ErrorInfo } from "./ErrorBanner";
import { HighlightedText, MARK } from "./HighlightedText";
import { Manifest } from "./Manifest";

export interface Turn {
  question?: string;
  answer: AskResponse;
}

const GATE_WALLS = "lg:border-x lg:border-line";

function Row({ device, gate, cloud }: { device?: React.ReactNode; gate?: React.ReactNode; cloud?: React.ReactNode }) {
  return (
    <>
      <div className="px-4 py-4 sm:px-6">{device}</div>
      <div className={`bg-panel/50 px-4 py-4 ${GATE_WALLS}`}>{gate}</div>
      <div className="px-4 py-4 sm:px-6">{cloud}</div>
    </>
  );
}

function LaneHeads({ cloudModel }: { cloudModel?: string }) {
  const head = "z-10 flex items-center gap-2 border-b border-line py-3 backdrop-blur lg:sticky lg:top-14";
  const title = "text-[13px] font-semibold text-ink";
  return (
    <>
      <div className={`${head} bg-void/85 px-4 sm:px-6`}>
        <Lock className="h-4 w-4 text-mist" aria-hidden />
        <span className={title}>On this device</span>
        <span className="text-xs text-safe">Private</span>
      </div>
      <div className={`${head} justify-center bg-panel px-4 ${GATE_WALLS}`}>
        <Braces className="h-4 w-4 text-mist" aria-hidden />
        <span className={title}>Inner door</span>
      </div>
      <div className={`${head} bg-void/85 px-4 sm:px-6`}>
        <Cloud className="h-4 w-4 text-mist" aria-hidden />
        <span className={title}>Cloud model</span>
        <span className="truncate text-xs text-mist">{cloudModel ?? "sees placeholders only"}</span>
      </div>
    </>
  );
}

function Card({
  label,
  meta,
  restored = false,
  className = "",
  children,
}: {
  label: string;
  meta?: string;
  restored?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`rounded-lg border bg-hull p-4 ${restored ? "border-safe/40" : "border-line"} ${className}`}>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className={`text-sm font-medium ${restored ? "text-safe" : "text-mist"}`}>{label}</p>
        {meta && <p className="truncate text-[11px] tabular-nums text-mist">{meta}</p>}
      </div>
      <div className="text-[15px] leading-[1.7] text-ink/90">{children}</div>
    </div>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-1 text-xs text-mist">
      {items.map(([swatch, label]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className={`h-3 w-3 rounded-[3px] ${swatch}`} /> {label}
        </span>
      ))}
    </p>
  );
}

function Sealed({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-28 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line p-4 text-center text-sm text-mist">
      <Lock className="h-5 w-5" aria-hidden />
      {children}
    </div>
  );
}

function Typing({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-hull p-4">
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className="typing-dot h-1.5 w-1.5 rounded-full bg-mist" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </span>
      <span className="text-sm text-mist">{label}</span>
    </div>
  );
}

function Connector({
  direction,
  title,
  detail,
  busy = false,
}: {
  direction: "out" | "back";
  title: string;
  detail?: string;
  busy?: boolean;
}) {
  const back = direction === "back";
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <div className="flex w-full items-center gap-2">
        <span className="h-px flex-1 bg-line" />
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-full border bg-hull ${
            back ? "border-safe/40 text-safe" : "border-line text-ink"
          }`}
        >
          {busy ? <Spinner className="h-3.5 w-3.5" /> : back ? <ArrowLeft className="h-4 w-4" aria-hidden /> : <ArrowRight className="h-4 w-4" aria-hidden />}
        </span>
        <span className="h-px flex-1 bg-line" />
      </div>
      <p className="text-[13px] font-medium text-ink">{title}</p>
      {detail && <p className="text-xs text-mist">{detail}</p>}
    </div>
  );
}

function ScanningGate({ seconds, withGemma }: { seconds: number; withGemma: boolean }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <div className="relative flex h-14 w-14 items-center justify-center">
        <span className="absolute inset-0 animate-spin rounded-full border-2 border-line border-t-ink" />
        <ShieldCheck className="h-6 w-6 text-ink" aria-hidden />
      </div>
      <p className="text-[15px] font-medium text-ink">
        Scanning on this device
        {withGemma ? (
          <>
            {" "}
            with Gemma 4…
          </>
        ) : (
          " (rules only)…"
        )}
      </p>
      <p className="text-sm tabular-nums text-mist">{seconds}s · nothing has left this machine</p>
    </div>
  );
}

function restoredSummary(answer: AskResponse, entities: Entity[]): string {
  const restored = entities.filter((e) => !e.redacted && answer.response.includes(e.text)).length;
  const kept = entities.filter((e) => e.redacted && answer.cloud_response_raw.includes(e.replacement)).length;
  const parts: string[] = [];
  if (restored) parts.push(`${restored} value${restored === 1 ? "" : "s"} restored`);
  if (kept) parts.push(`${kept} secret${kept === 1 ? "" : "s"} kept hidden`);
  return parts.join(" · ") || "Nothing to restore";
}

export function Workspace({
  text,
  scan,
  scanning,
  scanSeconds,
  gemmaExpected,
  scanError,
  turns,
  asking,
  pendingQuestion,
  askError,
}: {
  text: string;
  scan: ScanResponse | null;
  scanning: boolean;
  scanSeconds: number;
  gemmaExpected: boolean;
  scanError: ErrorInfo | null;
  turns: Turn[];
  asking: boolean;
  pendingQuestion?: string;
  askError: ErrorInfo | null;
}) {
  const entities = scan?.entities ?? [];
  const sent = turns.length > 0 || asking;

  return (
    <div className="grid min-h-full grid-cols-1 content-start lg:grid-cols-[minmax(0,1fr)_21rem_minmax(0,1fr)]">
      <LaneHeads cloudModel={turns.at(-1)?.answer.cloud_model} />

      <Row
        device={
          <div>
            <Card label="Your text">
              {scan ? (
                <HighlightedText text={text} entities={entities} mode="original" />
              ) : (
                <p className="whitespace-pre-wrap break-words">{text}</p>
              )}
            </Card>
            {scan && (
              <Legend
                items={[
                  [MARK.rule, "Caught by a rule"],
                  [MARK.gemma, "Caught by Gemma"],
                ]}
              />
            )}
          </div>
        }
        gate={
          scanning ? (
            <ScanningGate seconds={scanSeconds} withGemma={gemmaExpected} />
          ) : scanError ? (
            <ErrorBanner {...scanError} />
          ) : scan ? (
            <Manifest scan={scan} />
          ) : null
        }
        cloud={
          scan ? (
            <div>
              <Card label={sent ? "Sent to the cloud" : "Ready to send"}>
                <HighlightedText text={scan.sanitized_text} entities={entities} mode="sanitized" />
              </Card>
              <Legend
                items={[
                  [MARK.placeholder, "Restored later"],
                  [MARK.redacted, "Never restored"],
                ]}
              />
            </div>
          ) : (
            <Sealed>Nothing has left this device.</Sealed>
          )
        }
      />

      {turns.map((turn, i) => (
        <Fragment key={i}>
          {turn.question && (
            <Row
              device={
                <Card label="You asked">
                  <p className="whitespace-pre-wrap break-words">{turn.question}</p>
                </Card>
              }
              gate={<Connector direction="out" title="Sanitized" detail="Same placeholders as before" />}
              cloud={
                <Card label="Sent to the cloud">
                  <HighlightedText text={turn.answer.cloud_saw} entities={entities} mode="sanitized" />
                </Card>
              }
            />
          )}
          <Row
            device={
              <Card label="What you see · restored here" restored>
                <HighlightedText text={turn.answer.response} entities={entities} mode="response" />
              </Card>
            }
            gate={<Connector direction="back" title="Restored locally" detail={restoredSummary(turn.answer, entities)} />}
            cloud={
              <Card
                label="Cloud replied"
                meta={turn.answer.timings_ms.cloud != null ? `${turn.answer.timings_ms.cloud} ms` : undefined}
              >
                <HighlightedText text={turn.answer.cloud_response_raw} entities={entities} mode="sanitized" />
              </Card>
            }
          />
        </Fragment>
      ))}

      {asking && (
        <Row
          device={
            pendingQuestion ? (
              <Card label="You asked">
                <p className="whitespace-pre-wrap break-words">{pendingQuestion}</p>
              </Card>
            ) : (
              <Sealed>The answer will be restored here.</Sealed>
            )
          }
          gate={<Connector direction="out" title="Sending placeholders only" busy />}
          cloud={<Typing label="The cloud model is answering…" />}
        />
      )}

      {askError && !asking && <Row gate={<ErrorBanner {...askError} />} />}
    </div>
  );
}
