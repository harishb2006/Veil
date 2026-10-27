// Overview, section 3: the three stages, then placeholders as capability tokens (a small, precise table).
import { Reveal } from "./Reveal";

const STAGES = [
  {
    name: "Outer door",
    does: "Scans everything the agent reads before the model sees it.",
    catches: "Text hidden with CSS, white or tiny fonts, comments, attributes, zero-width and Unicode tag characters, base64, and plain-sight orders aimed at an AI.",
  },
  {
    name: "Gate",
    does: "Checks every risky tool call the agent tries to make, such as sending email or running a command.",
    catches: "A call whose data came from untrusted content, such as an address planted by a web page.",
  },
  {
    name: "Inner door",
    does: "Replaces private values with typed placeholders before text goes to a cloud model, and restores them locally.",
    catches: "Names, emails, API keys, passwords, cards and other values that must not leave your machine.",
  },
];

const TOKENS: { value: string; placeholder: string; origin: string; allowed: "yes" | "blocked" | "never"; note: string }[] = [
  { value: "priya@acme.test", placeholder: "[EMAIL_1]", origin: "you", allowed: "yes", note: "Restored into the tool call" },
  { value: "attacker@evil.test", placeholder: "[EMAIL_2]", origin: "fetch_page", allowed: "blocked", note: "Planted by a web page" },
  { value: "sk_live_…", placeholder: "[API_KEY_1]", origin: "you", allowed: "never", note: "Never leaves" },
];

export function HowItWorks() {
  return (
    <section id="how" className="container-page scroll-mt-20 border-t border-line py-20">
      <Reveal>
        <h2 className="max-w-[24ch]">How Airlock works</h2>
        <p className="prose-measure mt-4 text-mist">
          Like a real airlock, there are two doors and you never open both at once. The agent works in the space between them.
        </p>
      </Reveal>

      <Reveal className="mt-10">
        <ol className="divide-y divide-line border-y border-line">
          {STAGES.map((s, i) => (
            <li key={s.name} className="grid gap-x-8 gap-y-2 py-6 md:grid-cols-[3rem_12rem_1fr_1fr]">
              <span className="font-mono text-sm text-mist">{i + 1}</span>
              <h3 className="text-lg font-semibold text-ink">{s.name}</h3>
              <p className="text-[15px] text-ink">{s.does}</p>
              <p className="text-[15px] text-mist">
                <span className="font-medium text-ink">Catches: </span>
                {s.catches}
              </p>
            </li>
          ))}
        </ol>
      </Reveal>

      <Reveal className="mt-16">
        <h3 className="text-xl">Placeholders carry their origin</h3>
        <p className="prose-measure mt-3 text-mist">
          A placeholder is more than a redaction. It remembers where the value came from, and the gate uses that when the
          agent asks to put a real value back into a tool call.
        </p>
        <div className="mt-6 overflow-x-auto rounded-xl border border-line bg-hull">
          <table className="w-full min-w-[620px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line text-mist">
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
