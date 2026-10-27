// Colour tones shared by ui components. Class names are written out in full so Tailwind can see them.
// Colour only carries meaning: inner = privacy / placeholders, outer = hidden text / findings, gate = neutral,
// safe = allowed / clean, threat = blocked / leaked / attack, neutral = everything else.
export type Tone = "neutral" | "inner" | "outer" | "gate" | "safe" | "threat";

export interface ToneClasses {
  text: string; // coloured text
  soft: string; // subtle tint + text, for badges
  border: string; // coloured border
  dot: string; // solid fill (dots, bars)
  glow: string; // kept for compatibility; always empty in this design
  gradient: string; // kept for compatibility; always empty in this design
}

export const TONES: Record<Tone, ToneClasses> = {
  neutral: { text: "text-mist", soft: "bg-panel text-mist", border: "border-line", dot: "bg-mist", glow: "", gradient: "" },
  inner: { text: "text-inner", soft: "bg-inner/[0.07] text-inner", border: "border-inner/30", dot: "bg-inner", glow: "", gradient: "" },
  outer: { text: "text-outer", soft: "bg-outer/[0.09] text-outer", border: "border-outer/30", dot: "bg-outer", glow: "", gradient: "" },
  gate: { text: "text-gate", soft: "bg-panel text-gate", border: "border-line", dot: "bg-gate", glow: "", gradient: "" },
  safe: { text: "text-safe", soft: "bg-safe/[0.08] text-safe", border: "border-safe/30", dot: "bg-safe", glow: "", gradient: "" },
  threat: { text: "text-threat", soft: "bg-threat/[0.07] text-threat", border: "border-threat/30", dot: "bg-threat", glow: "", gradient: "" },
};
