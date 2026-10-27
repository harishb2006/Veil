// <Ticker/>: an endless strip of the decisions Veil makes in the sandbox scenarios. Pauses on hover;
// under prefers-reduced-motion it stops and the strip simply scrolls by hand.
const EVENTS: { tag: string; tone: string; text: string }[] = [
  { tag: "SANITIZED", tone: "text-outer", text: "HIDDEN_CSS · shop.test/aurora-x2" },
  { tag: "BLOCKED", tone: "text-threat", text: "send_email → attacker@evil.test" },
  { tag: "REDACTED", tone: "text-inner", text: "sk_live_… → [API_KEY_1]" },
  { tag: "QUARANTINED", tone: "text-threat", text: "UNICODE_TAG · devtool-setup" },
  { tag: "ALLOWED", tone: "text-safe", text: "send_email → [EMAIL_1] · origin=user" },
  { tag: "SANITIZED", tone: "text-outer", text: "COMMENT · inbox / invoice" },
  { tag: "BLOCKED", tone: "text-threat", text: "run_shell · origin=fetch_page" },
  { tag: "ALLOW", tone: "text-safe", text: "prompt-injection-explained · clean" },
];

function Items() {
  return (
    <>
      {EVENTS.map((e, i) => (
        <li key={i} className="flex shrink-0 items-center gap-2.5 px-6 font-mono text-xs">
          <span className={`font-semibold ${e.tone}`}>{e.tag}</span>
          <span className="text-mist">{e.text}</span>
          <span aria-hidden className="ml-6 h-1 w-1 rounded-full bg-line" />
        </li>
      ))}
    </>
  );
}

export function Ticker() {
  return (
    <div className="ticker scroll-thin relative overflow-x-auto border-y border-line bg-hull/60 py-3 [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
      <p className="sr-only">Example decisions from the sandbox scenarios.</p>
      <ul className="ticker-track flex w-max">
        <Items />
        <Items />
      </ul>
    </div>
  );
}
