// <SectionHeading title="…">optional lead paragraph</SectionHeading>. Sentence-case title, plain lead.
// `eyebrow` renders as a small sentence-case label; use it rarely. `tone` / `align` are kept for compatibility.
import type { ReactNode } from "react";
import type { Tone } from "./tone";

export function SectionHeading({
  eyebrow,
  title,
  align = "left",
  as: Tag = "h2",
  children,
}: {
  eyebrow?: string;
  title: ReactNode;
  tone?: Tone;
  align?: "left" | "center";
  as?: "h1" | "h2" | "h3";
  children?: ReactNode;
}) {
  return (
    <div className={align === "center" ? "mx-auto text-center" : ""}>
      {eyebrow && <p className="mb-2 text-sm font-medium text-mist">{eyebrow}</p>}
      <Tag className="max-w-[28ch] text-ink">{title}</Tag>
      {children && <div className="prose-measure mt-4 text-base leading-relaxed text-mist">{children}</div>}
    </div>
  );
}
