// Overview, closing band: one line, two actions, over the grid and glow used by the hero.
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Reveal } from "./Reveal";

export function CallToAction() {
  return (
    <section className="container-page pt-8">
      <Reveal>
        <div className="relative overflow-hidden rounded-2xl border border-line bg-hull px-6 py-14 text-center sm:px-12 sm:py-20">
          <div aria-hidden className="bg-grid pointer-events-none absolute inset-0" />
          <div aria-hidden className="glow-signal pointer-events-none absolute -bottom-40 left-1/2 h-[360px] w-[640px] -translate-x-1/2" />
          <div className="relative">
            <p className="font-mono text-xs uppercase tracking-[0.18em] text-signal">Two minutes, no account</p>
            <h2 className="mx-auto mt-4 max-w-[22ch] text-ink">Put a boundary between your agent and the internet.</h2>
            <p className="mx-auto mt-4 max-w-xl text-mist">
              Run the backend and console locally, or point your own agent at the HTTP API or the MCP server.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Button href="/start" size="lg">
                Get started <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
              <Button href="/lab" size="lg" variant="secondary">
                Scan a page in the lab
              </Button>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
