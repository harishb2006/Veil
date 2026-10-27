// <Card>…</Card>: white surface with a hairline border. `tone` only tints the border when the card itself
// carries a finding. `glow` is accepted for compatibility and ignored. `padded={false}` when content brings its own padding.
import type { ReactNode } from "react";
import { TONES, type Tone } from "./tone";

export function Card({
  tone = "neutral",
  padded = true,
  className = "",
  children,
}: {
  tone?: Tone;
  glow?: boolean;
  padded?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-xl border bg-hull ${TONES[tone].border} ${padded ? "p-5 sm:p-6" : ""} ${className}`}>{children}</div>
  );
}
