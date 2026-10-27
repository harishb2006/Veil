// <MockBadge/>: shown wherever simulated data is on screen. <MockBadge label="…" /> to customise the text.
import { Pill } from "@/components/ui/Badge";

export function MockBadge({ label = "Demo data", title }: { label?: string; title?: string }) {
  return (
    <Pill
      tone="outer"
      dot
      title={title ?? "The backend isn't being used: these results are simulated in the browser for demonstration."}
    >
      {label}
    </Pill>
  );
}
