// Overview: what the product is, a ticker of decisions, its three layers, the live flow diagram, the attack it
// stops, what it catches, provenance, the measured results, the stack and a closing call to action.
import { Ticker } from "@/components/fx/Ticker";
import { Attack } from "@/components/story/Attack";
import { CallToAction } from "@/components/story/CallToAction";
import { Capabilities } from "@/components/story/Capabilities";
import { Flow } from "@/components/story/Flow";
import { Hero } from "@/components/story/Hero";
import { HowItWorks } from "@/components/story/HowItWorks";
import { OpenSource } from "@/components/story/OpenSource";
import { Pillars } from "@/components/story/Pillars";
import { Results } from "@/components/story/Results";

export default function OverviewPage() {
  return (
    <>
      <Hero />
      <Ticker />
      <Pillars />
      <Flow />
      <Attack />
      <Capabilities />
      <HowItWorks />
      <Results />
      <OpenSource />
      <CallToAction />
    </>
  );
}
