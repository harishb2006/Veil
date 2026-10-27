// <Badge tone="safe">Allowed</Badge>: small, subtle label. <Pill dot tone="inner">…</Pill>: status text with a dot.
import type { ReactNode } from "react";
import { TONES, type Tone } from "./tone";

export function Badge({
  tone = "neutral",
  className = "",
  title,
  children,
}: {
  tone?: Tone;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium leading-4 ${TONES[tone].soft} ${className}`}
    >
      {children}
    </span>
  );
}

export function Pill({
  tone = "neutral",
  dot = false,
  className = "",
  title,
  children,
}: {
  tone?: Tone;
  dot?: boolean;
  /** Accepted for compatibility; there is no looping animation in this design. */
  pulse?: boolean;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span title={title} className={`inline-flex items-center gap-2 whitespace-nowrap text-sm font-medium ${TONES[tone].text} ${className}`}>
      {dot && <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${TONES[tone].dot}`} />}
      {children}
    </span>
  );
}
