// Overview, section 2: the three layers as cards (inspect, gate, redact), each linking to the page that shows it.
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { GateIcon, InnerDoorIcon, OuterDoorIcon } from "@/components/ui/DoorIcons";
import { Reveal } from "./Reveal";
import { SectionHead } from "./SectionHead";

const PILLARS = [
  {
    verb: "Inspect",
    name: "Outer door",
    Icon: OuterDoorIcon,
    tone: "text-outer",
    body: "Every page, email and file the agent reads is scanned before the model sees it. Hidden text is removed and the rest is wrapped as untrusted.",
    href: "/lab",
    cta: "Open the firewall lab",
  },
  {
    verb: "Enforce",
    name: "Gate",
    Icon: GateIcon,
    tone: "text-threat",
    body: "Risky tool calls such as send_email or run_shell are checked against where their arguments came from. Data planted by a web page can't steer them.",
    href: "/agent",
    cta: "Watch the gate in a live run",
  },
  {
    verb: "Redact",
    name: "Inner door",
    Icon: InnerDoorIcon,
    tone: "text-inner",
    body: "Names, keys and passwords become typed placeholders before anything reaches a cloud model, and are restored locally only where the gate allows.",
    href: "/privacy",
    cta: "Try the privacy workspace",
  },
];

export function Pillars() {
  return (
    <section id="layers" className="container-page scroll-mt-20 py-20">
      <SectionHead index="01" eyebrow="Three layers" title="Inspect. Enforce. Redact.">
        Detecting a prompt injection helps. Enforcing what the agent may do is the real boundary. Veil does both, and each layer
        works even when another misses.
      </SectionHead>

      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {PILLARS.map(({ verb, name, Icon, tone, body, href, cta }, i) => (
          <Reveal key={name} delay={i * 0.05}>
            <Link href={href} className="card-hover group flex h-full flex-col rounded-xl border border-line bg-hull p-6">
              <div className="flex items-center justify-between">
                <span className={`inline-flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-panel ${tone}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <span className="font-mono text-xs text-mist">{name}</span>
              </div>
              <h3 className="mt-6 text-2xl text-ink">{verb}</h3>
              <p className="mt-3 flex-1 text-[15px] leading-relaxed text-mist">{body}</p>
              <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-ink transition-colors group-hover:text-signal">
                {cta} <ArrowUpRight className="h-4 w-4" aria-hidden />
              </span>
            </Link>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
