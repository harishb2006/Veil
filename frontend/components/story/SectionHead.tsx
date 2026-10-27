"use client";
// <SectionHead index="01" eyebrow="The attack" title="…">lead</SectionHead>: mono eyebrow, a title that
// "decrypts" from random glyphs as it scrolls into view, and an optional lead paragraph.
// Screen readers always get the real title; the animation is skipped under prefers-reduced-motion.
import { useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Reveal } from "./Reveal";

const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*<>/\\";
const FRAMES = 18;

function Decrypt({ text }: { text: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "0px 0px -80px 0px" });
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(text);

  useEffect(() => {
    if (!inView || reduced) return;
    let frame = 0;
    const id = setInterval(() => {
      frame += 1;
      const settled = Math.floor((frame / FRAMES) * text.length);
      setShown(
        text
          .split("")
          .map((ch, i) => (i < settled || ch === " " ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]))
          .join(""),
      );
      if (frame >= FRAMES) {
        clearInterval(id);
        setShown(text);
      }
    }, 30);
    return () => clearInterval(id);
  }, [inView, reduced, text]);

  return (
    <span ref={ref} aria-label={text}>
      <span aria-hidden>{shown}</span>
    </span>
  );
}

export function SectionHead({
  index,
  eyebrow,
  title,
  children,
  center = false,
}: {
  index?: string;
  eyebrow: string;
  title: string;
  children?: ReactNode;
  center?: boolean;
}) {
  return (
    <Reveal className={center ? "mx-auto text-center" : ""}>
      <p className={`flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-signal ${center ? "justify-center" : ""}`}>
        {index && <span className="text-mist">{index}</span>}
        <span aria-hidden className="h-px w-6 bg-signal/60" />
        {eyebrow}
      </p>
      <h2 className={`mt-4 max-w-[24ch] text-ink ${center ? "mx-auto" : ""}`}>
        <Decrypt text={title} />
      </h2>
      {children && <div className={`prose-measure mt-4 text-[17px] leading-relaxed text-mist ${center ? "mx-auto" : ""}`}>{children}</div>}
    </Reveal>
  );
}
