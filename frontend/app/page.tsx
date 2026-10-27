// Overview: what the product is, the attack it stops, how it works, the measured results and the stack.
import { Attack } from "@/components/story/Attack";
import { Hero } from "@/components/story/Hero";
import { HowItWorks } from "@/components/story/HowItWorks";
import { OpenSource } from "@/components/story/OpenSource";
import { Results } from "@/components/story/Results";

export default function OverviewPage() {
  return (
    <>
      <Hero />
      <Attack />
      <HowItWorks />
      <Results />
      <OpenSource />
    </>
  );
}
