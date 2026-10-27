"use client";

import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { tokenize, type TokenKind } from "@/lib/agent/highlight";

const TOKEN_CLASS: Record<TokenKind, string> = {
  text: "",
  placeholder: "rounded bg-inner/10 px-1 font-mono text-[0.95em] text-inner",
  redacted: "rounded bg-inner/10 px-1 font-mono text-[0.95em] text-inner",
  canary: "rounded bg-threat/10 px-1 font-mono text-[0.95em] font-medium text-threat",
  evil: "font-medium text-threat",
  marker: "rounded bg-panel px-1 font-mono text-[0.95em] text-gate",
  datamark: "font-mono text-xs text-mist",
};

/** Text with placeholders as blue mono tokens, the real canary and attacker addresses in red. */
export function RichText({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span className={`whitespace-pre-wrap break-words ${className}`}>
      {tokenize(text).map((seg, i) =>
        seg.kind === "text" ? (
          <span key={i}>{seg.text}</span>
        ) : seg.kind === "canary" ? (
          <span key={i}>
            <span className={TOKEN_CLASS.canary}>{seg.text}</span>
            <span className="ml-1.5 font-sans text-xs font-medium text-threat">real secret</span>
          </span>
        ) : (
          <span
            key={i}
            className={TOKEN_CLASS[seg.kind]}
            title={
              seg.kind === "placeholder" || seg.kind === "redacted"
                ? "Placeholder: the cloud model never sees the real value"
                : seg.kind === "evil"
                  ? "Attacker-controlled destination"
                  : undefined
            }
          >
            {seg.text}
          </span>
        ),
      )}
    </span>
  );
}

/** Clamps tall content with a fade and a show more / less toggle. */
export function Expandable({
  children,
  long,
  collapsedClass = "max-h-40",
}: {
  children: ReactNode;
  long: boolean;
  collapsedClass?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!long) return <>{children}</>;
  return (
    <div>
      <div className={`relative ${open ? "" : `${collapsedClass} overflow-hidden`}`}>
        {children}
        {!open && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-panel to-transparent" />}
      </div>
      <button type="button" onClick={() => setOpen((o) => !o)} className="mt-1 inline-flex items-center gap-1 text-xs text-mist hover:text-ink">
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        {open ? "Show less" : "Show more"}
      </button>
    </div>
  );
}
