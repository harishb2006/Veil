// Text with entity highlights for the inner door. Real values get a underlined mark (light grey = caught by a rule,
// dark = caught only by Gemma, green = restored locally); placeholders are mono tokens (blue = restorable, red = never restored).
import { segment, type HighlightMode, type Segment } from "@/lib/highlight";
import type { Entity } from "@/lib/types";

export const MARK = {
  rule: "bg-ink/[0.06] underline decoration-mist decoration-2 underline-offset-2",
  gemma: "bg-ink/[0.06] underline decoration-ink decoration-2 underline-offset-2",
  restored: "bg-safe/10 underline decoration-safe decoration-2 underline-offset-2",
  placeholder: "bg-inner/[0.07]",
  redacted: "bg-threat/[0.07]",
};

const PEN = "rounded-[2px] px-[1px]";
const TOKEN = "rounded px-1 py-px font-mono text-[0.82em] font-medium";

function classFor(seg: Segment): string {
  switch (seg.kind) {
    case "original":
      return seg.entity?.source === "gemma" ? `${PEN} ${MARK.gemma} text-ink` : `${PEN} ${MARK.rule} text-ink`;
    case "placeholder":
      return `${TOKEN} ${MARK.placeholder} text-inner`;
    case "redacted":
      return `${TOKEN} ${MARK.redacted} text-threat`;
    case "restored":
      return `${PEN} ${MARK.restored} font-medium text-ink`;
    default:
      return "";
  }
}

function titleFor(seg: Segment): string | undefined {
  const e = seg.entity;
  if (!e) return seg.kind === "redacted" ? "Redacted — never restored" : seg.kind ? "Placeholder" : undefined;
  switch (seg.kind) {
    case "original":
      return `${e.type} → ${e.replacement} (${e.source === "gemma" ? "caught by Gemma" : "caught by a rule"})`;
    case "redacted":
      return `${e.type} — redacted, never restored`;
    case "restored":
      return `Restored locally from ${e.replacement}`;
    default:
      return `${e.type} placeholder`;
  }
}

export function HighlightedText({
  text,
  entities,
  mode,
  className = "",
}: {
  text: string;
  entities: Entity[];
  mode: HighlightMode;
  className?: string;
}) {
  return (
    <p className={`whitespace-pre-wrap break-words ${className}`}>
      {segment(text, entities, mode).map((seg, i) =>
        seg.kind ? (
          <mark key={i} title={titleFor(seg)} className={`box-decoration-clone ${classFor(seg)}`}>
            {seg.text}
          </mark>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </p>
  );
}
