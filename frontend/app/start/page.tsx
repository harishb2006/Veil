import type { Metadata } from "next";
import { CodeBlock } from "@/components/ui/CodeBlock";

export const metadata: Metadata = {
  title: "Get started — Airlock",
  description: "Run the Airlock console locally, or put the firewall in front of your own agent over a local HTTP API or MCP.",
};

const SECTIONS = [
  { id: "what", label: "What Airlock is" },
  { id: "console", label: "Run the console" },
  { id: "api", label: "Use the HTTP API" },
  { id: "mcp", label: "Use it over MCP" },
  { id: "roadmap", label: "Not built yet" },
];

const BACKEND = `python -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
cp .env.example .env
uvicorn backend.main:app --port 8000`;

const FRONTEND = `cd frontend
npm install
npm run dev`;

const MCP_CONFIG = `{
  "mcpServers": {
    "veil": {
      "command": "/abs/path/to/Agents-Firewall/.venv/bin/python",
      "args": ["/abs/path/to/Agents-Firewall/backend/mcp_server.py"],
      "env": { "GEMMA_ENABLED": "false" }
    }
  }
}`;

const RULES_ONLY = `GEMMA_ENABLED=false uvicorn backend.main:app --port 8000`;

const CURL = `curl -s http://localhost:8000/firewall/scan \\
  -H "Content-Type: application/json" \\
  -d '{
    "content": "<html>…the page your tool fetched…</html>",
    "content_type": "html",
    "tool": "fetch_page"
  }'`;

const RESPONSE = `{
  "verdict": "SANITIZED",              // ALLOW | SANITIZED | QUARANTINED
  "findings": [ { "kind": "HIDDEN_CSS", "severity": "high", "hidden": true, "reason": "…", "text": "…" } ],
  "content_for_model": "…cleaned text, wrapped in <<UNTRUSTED>> markers…",
  "visible_text": "…what a person would see…",
  "gemma_used": false,
  "timings_ms": { "rules": 2 }
}`;

const PY = `import requests

AIRLOCK = "http://localhost:8000"

def safe_tool_result(tool_name: str, raw: str, content_type: str = "text") -> str:
    """Scan a tool result before it goes into the model's context."""
    r = requests.post(
        f"{AIRLOCK}/firewall/scan",
        json={"content": raw, "content_type": content_type, "tool": tool_name},
        timeout=30,
    )
    r.raise_for_status()
    scan = r.json()
    # Log scan["verdict"] and scan["findings"] if you want an audit trail.
    return scan["content_for_model"]   # never pass the raw content to the model`;

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-24 text-[1.625rem]">
      {children}
    </h2>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-panel px-1 py-0.5 text-[0.875em] text-ink">{children}</code>;
}

export default function StartPage() {
  return (
    <div className="container-page pb-8 pt-14 sm:pt-20">
      <div className="grid gap-12 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-16">
        <nav aria-label="On this page" className="hidden lg:block">
          <div className="sticky top-24">
            <p className="mb-3 text-sm font-medium text-ink">On this page</p>
            <ul className="space-y-2 border-l border-line text-sm">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="-ml-px block border-l border-transparent pl-4 text-mist hover:border-ink hover:text-ink">
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </nav>

        <article className="min-w-0 max-w-[720px]">
          <h1>Get started</h1>
          <p className="mt-5 text-lg text-mist">
            Three ways in: run the console to see Airlock work, or put the firewall in front of an agent you already have, over HTTP or MCP.
          </p>

          <section className="mt-14 space-y-4">
            <H2 id="what">What Airlock is</H2>
            <p className="text-mist">
              Airlock is a local service plus this web console. The service is a FastAPI app that runs on your machine, with
              Gemma 4 served by Foundry Local for the checks that rules can&apos;t make. The console is a Next.js app that talks to it.
            </p>
            <p className="text-mist">
              It is not a hosted product, and that is deliberate: the scanner reads your private mail and files, so your data
              should never leave your machine to be scanned. There is no account and no sign-up.
            </p>
          </section>

          <section className="mt-14 space-y-4">
            <H2 id="console">Option 1: run the console</H2>
            <p className="text-mist">
              You need Python 3.11+ and Node.js 20+. Foundry Local with Gemma 4 E2B IT (<Code>gemma-4-e2b-it</Code>) is optional; without it
              the outer door runs on rules alone. No API key is needed, because the demo agent is scripted and the sandbox has no live web.
            </p>
            <h3 className="pt-2 text-lg">1. Start the backend, from the repo root</h3>
            <CodeBlock label="bash" copy={BACKEND}>{BACKEND}</CodeBlock>
            <p className="text-sm text-mist">
              Gemma loads in the background (about a minute); <Code>/health</Code> answers immediately. On a machine without the model, start it
              rules-only instead:
            </p>
            <CodeBlock label="bash" copy={RULES_ONLY}>{RULES_ONLY}</CodeBlock>
            <h3 className="pt-2 text-lg">2. Start the console</h3>
            <CodeBlock label="bash" copy={FRONTEND}>{FRONTEND}</CodeBlock>
            <p className="text-mist">
              Open <Code>http://localhost:3000</Code>. The status text in the header shows whether the backend is reachable and whether Gemma is
              loaded. If the backend is down, the pages fall back to clearly labelled demo data.
            </p>
          </section>

          <section className="mt-14 space-y-4">
            <H2 id="api">Option 2: put it in front of your own agent</H2>
            <p className="text-mist">
              Scan every tool result before your model sees it. Send the raw content to <Code>POST /firewall/scan</Code> with the body{" "}
              <Code>{`{content, content_type, tool}`}</Code>, where <Code>content_type</Code> is <Code>html</Code>, <Code>text</Code> or{" "}
              <Code>email</Code>.
            </p>
            <CodeBlock label="curl" copy={CURL}>{CURL}</CodeBlock>
            <p className="text-sm text-mist">The response, trimmed:</p>
            <CodeBlock label="response">{RESPONSE}</CodeBlock>
            <p className="text-mist">
              Use <Code>verdict</Code> to decide what to log or surface, and give the model <Code>content_for_model</Code> instead of the raw
              content. Hidden text is already removed from it, and it is wrapped in <Code>{"<<UNTRUSTED>>"}</Code> markers so the model treats
              it as data. If the verdict is <Code>QUARANTINED</Code>, it is a short notice rather than the page.
            </p>
            <CodeBlock label="python" copy={PY}>{PY}</CodeBlock>
            <h3 className="pt-2 text-lg">Other endpoints</h3>
            <ul className="list-disc space-y-2 pl-5 text-mist marker:text-line">
              <li>
                <Code>POST /scan</Code> with <Code>{`{text, scan_id?}`}</Code> is the inner door. It returns <Code>sanitized_text</Code> with
                placeholders and a <Code>scan_id</Code> that keeps them stable across messages.
              </li>
              <li>
                <Code>POST /rehydrate</Code> with <Code>{`{scan_id, text}`}</Code> restores placeholders in a reply locally. Secrets are never restored.
              </li>
              <li>
                <Code>POST /agent/run</Code> with <Code>{`{task, mode}`}</Code> starts the sandboxed demo agent (<Code>raw</Code> or <Code>full</Code>) and returns a <Code>run_id</Code>; poll <Code>GET /agent/runs/&#123;run_id&#125;</Code>. Email is written to a fake
                outbox and shell commands are never executed.
              </li>
            </ul>
            <p className="text-sm text-mist">
              The backend only accepts browser requests from <Code>http://localhost:3000</Code> by default; set <Code>CORS_ORIGINS</Code> to change that.
              Server-side callers are not affected.
            </p>
          </section>

          <section className="mt-14 space-y-4">
            <H2 id="mcp">Option 3: use it from Claude Desktop or Cursor (MCP)</H2>
            <p className="text-mist">
              Airlock also runs as a local MCP server over stdio. The client starts it as a child process on your machine; nothing goes
              to a hosted service. Add this to <Code>claude_desktop_config.json</Code> (or <Code>.cursor/mcp.json</Code>) with your own
              absolute paths, after installing the backend as in Option 1:
            </p>
            <CodeBlock label="json" copy={MCP_CONFIG}>{MCP_CONFIG}</CodeBlock>
            <p className="text-mist">It exposes six tools that use the same engine as this console:</p>
            <ul className="list-disc space-y-2 pl-5 text-mist marker:text-line">
              <li><Code>veil_fetch</Code> fetches a page and returns it through the outer door, with a verdict and findings.</li>
              <li><Code>veil_scan</Code> does the same for content the client already has: an email, a file, another tool&apos;s output.</li>
              <li><Code>veil_protect</Code> swaps private values for placeholders that remember where they came from.</li>
              <li><Code>veil_check_action</Code> asks the gate before sending email or running a command.</li>
              <li><Code>veil_rehydrate</Code> restores your own values in a reply; <Code>veil_reset</Code> starts a new run.</li>
            </ul>
            <p className="text-sm text-mist">
              Setup for Windows and Cursor, and a recommended client instruction, are in <Code>docs/MCP.md</Code>.
            </p>
          </section>

          <section className="mt-14 space-y-4">
            <H2 id="roadmap">Not built yet</H2>
            <ul className="divide-y divide-line border-y border-line">
              <li className="py-4">
                <p className="font-medium text-ink">Browser extension</p>
                <p className="mt-1 text-sm text-mist">
                  Airlock v1 shipped an extension for ChatGPT, Claude and Gemini in the earlier repository. Bringing the outer door to the
                  browser is planned, not done.
                </p>
              </li>
              <li className="py-4">
                <p className="font-medium text-ink">Images and audit log</p>
                <p className="mt-1 text-sm text-mist">
                  Reading text hidden in images with Gemma 4 vision, and a persistent audit log of every verdict, are planned, not done.
                </p>
              </li>
            </ul>
          </section>
        </article>
      </div>
    </div>
  );
}
