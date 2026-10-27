// Overview: what the outer door catches, one tile per finding kind (the same kinds the eval reports on).
import { Reveal } from "./Reveal";
import { SectionHead } from "./SectionHead";

const KINDS: { kind: string; title: string; body: string }[] = [
  { kind: "HIDDEN_CSS", title: "CSS-hidden text", body: "display:none, visibility:hidden, off-screen positioning and clipped boxes." },
  { kind: "WHITE_TEXT", title: "Invisible colours", body: "Text set in the page's own background colour, or fully transparent." },
  { kind: "TINY_TEXT", title: "Microscopic fonts", body: "1px type and zero-height containers a person will never notice." },
  { kind: "COMMENT", title: "HTML comments", body: "Instructions tucked inside <!-- --> that extractors still pass on." },
  { kind: "ATTR", title: "Attribute payloads", body: "Orders tucked into alt, title and other attribute text." },
  { kind: "ZERO_WIDTH", title: "Zero-width characters", body: "Invisible code points spliced into text to hide orders aimed at an AI." },
  { kind: "UNICODE_TAG", title: "Unicode tag smuggling", body: "ASCII mirrored into the invisible U+E0000 tag block." },
  { kind: "BASE64", title: "Encoded blobs", body: "Base64 strings that decode to instructions aimed at a model." },
  { kind: "EXFIL_URL", title: "Exfiltration links", body: "Orders to send data to an outside address, and image links that leak it." },
  { kind: "PLAIN_SIGHT", title: "Plain-sight orders", body: "Visible text addressed to an AI. Gemma 4 flags what rules can't." },
  { kind: "SHELL", title: "Shell commands", body: "Commands the page wants the agent to run. The gate stops them regardless." },
];

export function Capabilities() {
  return (
    <section id="catches" className="container-page scroll-mt-20 border-t border-line py-20">
      <SectionHead index="04" eyebrow="Detection" title="What the outer door catches">
        Rules handle the mechanical tricks in about two milliseconds. The local model covers what rules can&apos;t see. Anything
        that slips past both still has to get through the gate.
      </SectionHead>

      <Reveal className="mt-12">
        <ul className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {KINDS.map((k) => (
            <li key={k.kind} className="spotlight bg-hull p-5 transition-colors hover:bg-panel">
              <code className="font-mono text-[11px] tracking-wider text-outer">{k.kind}</code>
              <p className="mt-2 font-medium text-ink">{k.title}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-mist">{k.body}</p>
            </li>
          ))}
          <li className="flex flex-col justify-center bg-panel p-5">
            <p className="font-mono text-[11px] tracking-wider text-signal">ALWAYS ON</p>
            <p className="mt-2 font-medium text-ink">Provenance-aware gate</p>
            <p className="mt-1.5 text-sm leading-relaxed text-mist">Every tool argument carries its origin, so missed detections still can&apos;t act.</p>
          </li>
        </ul>
      </Reveal>
    </section>
  );
}
