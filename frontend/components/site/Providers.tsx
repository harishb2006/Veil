"use client";
// Wraps the app so every `motion` animation respects the OS "reduce motion" setting.
import { MotionConfig } from "motion/react";

export function Providers({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
