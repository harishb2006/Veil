"use client";
// Overview, section 2: "The attack". A realistic product card; the toggle reveals the hidden text inline.
import { useState } from "react";
import { HIDDEN_ORDER } from "@/lib/samples";
import { Reveal } from "./Reveal";
import { SectionHead } from "./SectionHead";

const AGENT_LINES = [
  "Aurora X2 Wireless Headphones",
  "$199",
  "40-hour battery life, adaptive noise cancelling and a lightweight, fold-flat frame.",
  "Adaptive noise cancelling · 40 h playback · Multipoint Bluetooth",
];

export function Attack() {
  const [show, setShow] = useState(false);

  return (
    <section id="attack" className="container-page scroll-mt-20 border-t border-line py-20">
      <SectionHead index="03" eyebrow="The attack" title="A product page that gives your agent orders">
        This is a simplified copy of the poisoned page from our demo. A person sees a pair of headphones. A model that
          extracts the page&apos;s text also reads a paragraph written in the page&apos;s own background colour, and has no
          reliable way to tell it is not part of the task you gave it.
      </SectionHead>

      <Reveal className="mt-10">
        <div className="mb-3 flex items-center justify-between gap-4">
          <p className="text-sm font-medium text-mist">{show ? "What the agent reads" : "What a person sees"}</p>
          <button
            type="button"
            role="switch"
            aria-checked={show}
            onClick={() => setShow((s) => !s)}
            className="inline-flex items-center gap-2.5 rounded-md border border-line bg-hull px-3 py-1.5 text-sm font-medium text-ink transition-colors hover:border-signal/40"
          >
            Show what the agent reads
            <span aria-hidden className={`relative h-5 w-9 rounded-full transition-colors ${show ? "bg-signal" : "bg-line"}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-ink transition-all ${show ? "left-[18px]" : "left-0.5"}`} />
            </span>
          </button>
        </div>

        <div className="overflow-hidden rounded-xl border border-line bg-hull">
          <div className="flex items-center gap-2 border-b border-line bg-panel px-4 py-2">
            <span className="truncate font-mono text-xs text-mist">https://shop.test/aurora-x2</span>
          </div>
          <div className="p-6 sm:p-8">
            <p className="text-xs font-medium text-mist">Audio / Headphones</p>
            <h3 className="mt-2 text-2xl text-ink">Aurora X2 Wireless Headphones</h3>
            <p className="mt-1 text-sm text-mist">4.7 out of 5 · 312 reviews</p>
            <p className="mt-3 text-xl font-semibold text-ink">$199</p>
            <p className="prose-measure mt-3 text-[15px] text-mist">
              40-hour battery life, adaptive noise cancelling and a lightweight, fold-flat frame. Multipoint Bluetooth and USB-C
              audio.
            </p>

            {/* The injected block. Same colour as the page until revealed; layout never changes. */}
            <p
              className={`mt-4 rounded-sm px-1 py-0.5 text-[13px] leading-relaxed transition-colors duration-200 ${
                show
                  ? "bg-outer/10 text-ink underline decoration-outer decoration-2 underline-offset-4"
                  : "text-hull selection:bg-panel selection:text-mist"
              }`}
            >
              {HIDDEN_ORDER}
            </p>
            <p aria-live="polite" className={`mt-1.5 text-xs text-outer ${show ? "" : "invisible"}`}>
              Hidden text: white on white, 1px high. Never shown to a person.
            </p>

            <span className="mt-4 inline-block rounded-md bg-ink px-4 py-2 text-sm font-medium text-void">Add to cart</span>
            <p className="mt-6 border-t border-line pt-3 text-xs text-mist">Free returns within 30 days.</p>
          </div>
        </div>

        <details className="mt-4 text-sm text-mist">
          <summary className="cursor-pointer font-mono text-xs uppercase tracking-[0.14em] text-ink hover:text-signal">The text extracted for the model</summary>
          <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-panel p-4 font-mono text-[13px] leading-relaxed text-ink">
            {AGENT_LINES.join("\n")}
            {"\n"}
            <span className="bg-outer/10 underline decoration-outer decoration-2 underline-offset-4">{HIDDEN_ORDER}</span>
            {"\n"}Free returns within 30 days.
          </pre>
        </details>
      </Reveal>
    </section>
  );
}
