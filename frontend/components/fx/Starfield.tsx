"use client";
// <Starfield/>: a canvas of slowly drifting, twinkling points, placed absolutely behind hero content.
// Pauses when off screen or in a background tab; draws one still frame under prefers-reduced-motion.
import { useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";

type Star = { x: number; y: number; r: number; vx: number; vy: number; phase: number; accent: boolean };

const DENSITY = 1 / 9000; // stars per px²

export function Starfield({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    let stars: Star[] = [];
    let w = 0;
    let h = 0;
    let raf = 0;
    let visible = true;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars = Array.from({ length: Math.round(w * h * DENSITY) }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() * 1.1 + 0.3,
        vx: (Math.random() - 0.5) * 0.06,
        vy: -Math.random() * 0.08 - 0.02,
        phase: Math.random() * Math.PI * 2,
        accent: Math.random() < 0.12,
      }));
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        const a = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t / 900 + s.phase));
        ctx.fillStyle = s.accent ? `rgba(62,240,180,${a})` : `rgba(231,234,240,${a * 0.7})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const step = (t: number) => {
      for (const s of stars) {
        s.x += s.vx;
        s.y += s.vy;
        if (s.y < -2) s.y = h + 2;
        if (s.x < -2) s.x = w + 2;
        if (s.x > w + 2) s.x = -2;
      }
      draw(t);
      if (visible) raf = requestAnimationFrame(step);
    };

    resize();
    if (reduced) {
      draw(0);
      return;
    }
    raf = requestAnimationFrame(step);

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting && !document.hidden;
      cancelAnimationFrame(raf);
      if (visible) raf = requestAnimationFrame(step);
    });
    io.observe(canvas);
    const onVis = () => {
      visible = !document.hidden;
      cancelAnimationFrame(raf);
      if (visible) raf = requestAnimationFrame(step);
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [reduced]);

  return <canvas ref={ref} aria-hidden className={`pointer-events-none h-full w-full ${className}`} />;
}
