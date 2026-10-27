"use client";
// <CountUp to={73.8} decimals={1} suffix="%" />: counts up from 0 once it scrolls into view.
// Under prefers-reduced-motion it renders the final value straight away.
import { useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

const DURATION_MS = 1400;

export function CountUp({ to, decimals = 0, suffix = "" }: { to: number; decimals?: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  const reduced = useReducedMotion();
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      setValue(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min((now - start) / DURATION_MS, 1);
      setValue(to * (1 - Math.pow(1 - t, 3))); // ease-out cubic
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [inView, reduced, to]);

  return (
    <span ref={ref} aria-label={`${to.toFixed(decimals)}${suffix}`}>
      <span aria-hidden>
        {value.toFixed(decimals)}
        {suffix}
      </span>
    </span>
  );
}
