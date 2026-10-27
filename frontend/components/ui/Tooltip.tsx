// <Tooltip label="Why">…trigger…</Tooltip>: CSS-only tooltip shown on hover and keyboard focus of the trigger.
import type { ReactNode } from "react";

export function Tooltip({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <span className={`group/tip relative inline-flex ${className}`}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-max max-w-64 -translate-x-1/2 rounded-md border border-line bg-hull px-2.5 py-1.5 text-center text-xs leading-snug text-ink opacity-0 shadow-[0_4px_16px_rgb(0_0_0/0.08)] transition-opacity group-hover/tip:opacity-100 group-focus-within/tip:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
