// RiskBadge and SourceBadge for the inner-door manifest.
import { Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { Tone } from "@/components/ui/tone";
import { TONES } from "@/components/ui/tone";
import type { EntitySource, OverallRisk } from "@/lib/types";

const RISK: Record<OverallRisk, { label: string; tone: Tone }> = {
  NONE: { label: "None", tone: "safe" },
  LOW: { label: "Low", tone: "neutral" },
  MEDIUM: { label: "Medium", tone: "outer" },
  HIGH: { label: "High", tone: "threat" },
};

export function RiskBadge({ risk, size = "sm" }: { risk: OverallRisk; size?: "sm" | "lg" }) {
  const { label, tone } = RISK[risk];
  if (size === "lg") {
    return (
      <span className={`inline-flex items-center gap-2 text-base font-semibold ${TONES[tone].text}`}>
        <span aria-hidden className={`h-2 w-2 rounded-full ${TONES[tone].dot}`} />
        {label}
      </span>
    );
  }
  return <Badge tone={tone}>{label}</Badge>;
}

export function SourceBadge({ source }: { source: EntitySource }) {
  if (source === "gemma") {
    return (
      <Badge tone="neutral">
        <Sparkles className="h-3 w-3" aria-hidden />
        Gemma
      </Badge>
    );
  }
  return <Badge tone="neutral">Rule</Badge>;
}
