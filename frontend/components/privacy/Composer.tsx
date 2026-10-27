// Step 1 of the inner door: paste private text, then scan it locally.
import { Lock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/Kbd";
import { Spinner } from "@/components/ui/Spinner";
import type { Sample } from "@/lib/samples";

const HOW_IT_WORKS = [
  {
    title: "Scanned on this device",
    body: "Rules catch keys and emails. Gemma 4 runs locally and catches what only context reveals.",
  },
  {
    title: "Only placeholders leave",
    body: "Priya becomes [PERSON_1], so the cloud model can still reason about the request.",
  },
  {
    title: "Answers restored here",
    body: "Real names are restored on your machine. Secrets never are.",
  },
];

export function Composer({
  text,
  onTextChange,
  samples,
  onScan,
  scanning,
  notice,
  toolbar,
}: {
  text: string;
  onTextChange: (text: string) => void;
  samples: Sample[];
  onScan: () => void;
  scanning: boolean;
  notice?: React.ReactNode;
  toolbar?: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-10 pt-10 sm:px-6 sm:pt-14">
      <h1>Privacy</h1>
      <p className="prose-measure mt-4 text-lg text-mist">
        The inner door. Use a cloud model without handing it your private data.
        Paste what you&apos;d normally send to a cloud AI. Veil finds the private parts on this device, and only
        placeholders ever leave it.
      </p>

      {toolbar && <div className="mt-4 flex flex-wrap items-center gap-3">{toolbar}</div>}

      {notice && <div className="mt-5">{notice}</div>}

      <div className="mt-7 overflow-hidden rounded-xl border border-line bg-hull transition-colors focus-within:border-mist">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5 text-xs text-mist">
          <span className="flex items-center gap-1.5 font-medium">
            <Lock className="h-3.5 w-3.5" aria-hidden />
            Private text · stays on this device
          </span>
          <span className="tabular-nums">{text.length.toLocaleString()} characters</span>
        </div>
        <textarea
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onScan();
          }}
          spellCheck={false}
          aria-label="Private text to scan"
          placeholder="Paste anything you'd normally send to a cloud AI…"
          className="scroll-thin block h-44 w-full resize-none bg-transparent px-4 py-3.5 text-base leading-relaxed text-ink placeholder:text-mist focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-2 border-t border-line bg-panel/60 px-3 py-2.5">
          <span className="px-1 text-xs text-mist">Samples</span>
          {samples.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => onTextChange(s.text)}
              aria-pressed={text === s.text}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                text === s.text ? "border-ink bg-hull text-ink" : "border-line bg-hull text-mist hover:border-mist/50 hover:text-ink"
              }`}
            >
              {s.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-3 max-sm:w-full max-sm:justify-end">
            <span className="hidden items-center gap-1 sm:inline-flex">
              <Kbd>Ctrl</Kbd>
              <Kbd>↵</Kbd>
            </span>
            <Button onClick={onScan} disabled={!text.trim() || scanning}>
              {scanning ? <Spinner /> : <ShieldCheck className="h-4 w-4" aria-hidden />}
              Scan locally
            </Button>
          </div>
        </div>
      </div>

      <ol className="mt-9 grid gap-6 border-t border-line pt-6 sm:grid-cols-3">
        {HOW_IT_WORKS.map(({ title, body }, i) => (
          <li key={title}>
            <p className="text-sm font-semibold text-ink">
              <span className="mr-2 font-mono font-normal text-mist">{i + 1}</span>
              {title}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-mist">{body}</p>
          </li>
        ))}
      </ol>

      <p className="mt-7 text-xs text-mist">
        Veil is a local privacy-assistance layer: rules plus a small local model. Detection is not perfect — it
        reduces exposure, it doesn&apos;t guarantee it.
      </p>
    </div>
  );
}
