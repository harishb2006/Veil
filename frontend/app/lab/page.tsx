import type { Metadata } from "next";
import { FirewallLab } from "@/components/lab/FirewallLab";

export const metadata: Metadata = {
  title: "Firewall lab — Airlock",
  description: "Scan a web page, email or document for hidden instructions and see exactly what an AI agent would read.",
};

export default function LabPage() {
  return <FirewallLab />;
}
