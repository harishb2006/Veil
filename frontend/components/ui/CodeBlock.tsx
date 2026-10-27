"use client";
// <CodeBlock label="send_email" copy>…</CodeBlock>: monospace block on the panel colour with an optional header
// label and copy button. Children are rendered as-is inside <pre>, so you can nest highlight spans.
// `copy` takes the exact text to put on the clipboard (string).
import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import { TONES, type Tone } from "./tone";

export function CodeBlock({
  label,
  tone = "neutral",
  copy,
  className = "",
  children,
}: {
  label?: string;
  tone?: Tone;
  copy?: string;
  className?: string;
  children: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    if (copy === undefined) return;
    try {
      await navigator.clipboard.writeText(copy);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be unavailable (insecure context); the text stays selectable.
    }
  };
  return (
    <div className={`overflow-hidden rounded-lg border bg-panel ${TONES[tone].border} ${className}`}>
      {(label || copy !== undefined) && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-3.5 py-1.5">
          <span className={`font-mono text-xs ${tone === "neutral" ? "text-mist" : TONES[tone].text}`}>{label}</span>
          {copy !== undefined && (
            <button
              type="button"
              onClick={onCopy}
              className="-mr-1.5 inline-flex items-center gap-1.5 rounded px-1.5 py-1 text-xs font-medium text-mist transition-colors hover:text-ink"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-safe" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
              <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
            </button>
          )}
        </div>
      )}
      <pre className="scroll-thin overflow-x-auto whitespace-pre-wrap break-words px-3.5 py-3 font-mono text-[13px] leading-relaxed text-ink">
        {children}
      </pre>
    </div>
  );
}
