import type { Metadata } from "next";
import { PrivacyApp } from "@/components/privacy/PrivacyApp";

export const metadata: Metadata = {
  title: "Inner door — Veil",
  description: "Scan private text locally, send only placeholders to a cloud model and restore the answer on your machine.",
};

export default function PrivacyPage() {
  return <PrivacyApp />;
}
