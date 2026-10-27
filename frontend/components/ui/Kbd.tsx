// <Kbd>Ctrl</Kbd> <Kbd>↵</Kbd>: keyboard hint.
import type { ReactNode } from "react";

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-panel px-1.5 py-0.5 font-mono text-[11px] text-mist">{children}</kbd>
  );
}
