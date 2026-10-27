"use client";
// <ScrollProgress/>: a 1px brand-coloured bar along the bottom of the header that fills as the page scrolls.
import { motion, useScroll, useSpring } from "motion/react";

export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 200, damping: 40, restDelta: 0.001 });
  return <motion.div aria-hidden style={{ scaleX }} className="absolute inset-x-0 -bottom-px h-px origin-left bg-signal" />;
}
