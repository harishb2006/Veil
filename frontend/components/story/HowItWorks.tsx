// Overview: placeholders as capability tokens. A small, precise table of value → placeholder → origin → verdict.
import { Reveal } from "./Reveal";
import { SectionHead } from "./SectionHead";

const TOKENS: { value: string; placeholder: string; origin: string; allowed: "yes" | "blocked" | "never"; note: string }[] = [
  { value: "priya@acme.test", placeholder: "[EMAIL_1]", origin: "you", allowed: "yes", note: "Restored into the tool call" },
  { value: "attacker@evil.test", placeholder: "[EMAIL_2]", origin: "fetch_page", allowed: "blocked", note: "Planted by a web page" },
  { value: "sk_live_…", placeholder: "[API_KEY_1]", origin: "you", allowed: "never", note: "Never leaves" },
];

export function HowItWorks() {
  return (
    <section id="how" className="container-page scroll-mt-20 border-t border-line py-20">
      <SectionHead index="05" eyebrow="Provenance" title="Placeholders carry their origin">
          A placeholder is more than a redaction. It remembers where the value came from, and the gate uses that when the
          agent asks to put a real value back into a tool call.
      </SectionHead>

      <Reveal className="mt-12">
        <div className="overflow-x-auto rounded-xl border border-line bg-hull">
          <table className="w-full min-w-[620px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line bg-panel/60 font-mono text-xs uppercase tracking-[0.12em] text-mist">
                <th className="px-4 py-3 font-medium">Value</th>
                <th className="px-4 py-3 font-medium">Placeholder</th>
                <th className="px-4 py-3 font-medium">Origin</th>
                <th className="px-4 py-3 font-medium">Allowed in a tool call?</th>
              </tr>
            </thead>
            <tbody>
              {TOKENS.map((t) => (
                <tr key={t.placeholder} className="border-b border-line last:border-0">
                  <td className="px-4 py-3 font-mono text-[13px] text-ink">{t.value}</td>
                  <td className="px-4 py-3">
                    <code className="rounded bg-inner/[0.07] px-1.5 py-0.5 text-[13px] font-medium text-inner">{t.placeholder}</code>
                  </td>
                  <td className="px-4 py-3 font-mono text-[13px] text-mist">{t.origin}</td>
                  <td className="px-4 py-3">
                    <span className={t.allowed === "yes" ? "font-medium text-safe" : "font-medium text-threat"}>
                      {t.allowed === "yes" ? "Yes" : t.allowed === "blocked" ? "No, blocked" : "No, never leaves"}
                    </span>
                    <span className="ml-2 text-mist">{t.note}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Reveal>
    </section>
  );
}
