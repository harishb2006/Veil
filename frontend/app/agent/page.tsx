import type { Metadata } from "next";
import { MissionControl } from "@/components/agent/MissionControl";

export const metadata: Metadata = {
  title: "Live demo",
  description: "Run the same task and the same agent with no protection, Airlock v1 and Full Airlock, side by side.",
};

export default function AgentPage() {
  return <MissionControl />;
}
