"use client";
// Wraps the app so every `motion` animation respects the OS "reduce motion" setting, and drives the
// cursor spotlight: one pointer listener writes --mx / --my onto the .spotlight element under the cursor.
import { MotionConfig } from "motion/react";
import { useEffect } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const onMove = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>(".spotlight");
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    const onOut = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.<HTMLElement>(".spotlight");
      if (el && !el.contains(e.relatedTarget as Node | null)) {
        el.style.setProperty("--mx", "-400px");
        el.style.setProperty("--my", "-400px");
      }
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerout", onOut, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerout", onOut);
    };
  }, []);

  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
