// Overview, section 5: a short paragraph and a plain list of the stack, with Gemma 4 credited.
import { Reveal } from "./Reveal";

const STACK: { name: string; role: string }[] = [
  { name: "Gemma 4 E2B IT", role: "Open-weight model from Google, run locally. Finds private data and injected instructions that rules miss." },
  { name: "Foundry Local", role: "Microsoft's runtime that loads and serves Gemma on your machine." },
  { name: "FastAPI", role: "The local backend: scan, firewall, gate and agent endpoints." },
  { name: "BeautifulSoup", role: "Parses HTML so hidden elements, comments and attributes can be found." },
  { name: "Next.js, React, Tailwind CSS", role: "This console." },
];

export function OpenSource() {
  return (
    <section id="open" className="container-page scroll-mt-20 border-t border-line py-20">
      <Reveal>
        <h2 className="max-w-[24ch]">Built in the open</h2>
        <p className="prose-measure mt-4 text-mist">
          Airlock is Apache-2.0 and the source is on{" "}
          <a
            href="https://github.com/rahulrr-coder/Agents-Firewall"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
          >
            GitHub
          </a>
          . Scanning happens on your machine; only placeholder text can reach a cloud model, and only if you configure one.
          Much of the v2 code was written with an AI coding assistant, directed and reviewed by the team.
        </p>
        <dl className="mt-8 max-w-3xl divide-y divide-line border-y border-line">
          {STACK.map((s) => (
            <div key={s.name} className="grid gap-1 py-3 sm:grid-cols-[14rem_1fr] sm:gap-6">
              <dt className="text-[15px] font-medium text-ink">{s.name}</dt>
              <dd className="text-[15px] text-mist">{s.role}</dd>
            </div>
          ))}
        </dl>
      </Reveal>
    </section>
  );
}
