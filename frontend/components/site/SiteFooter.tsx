// <SiteFooter/>: brand blurb, link columns, licence and the honest v1 / v2 note. Mounted once in app/layout.tsx.
import Link from "next/link";
import { LogoMark } from "@/components/ui/DoorIcons";
import { REPO_URL } from "@/lib/site";

const COLUMNS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Product",
    links: [
      { href: "/", label: "Overview" },
      { href: "/agent", label: "Live demo" },
      { href: "/lab", label: "Firewall lab" },
      { href: "/privacy", label: "Privacy" },
    ],
  },
  {
    title: "Docs",
    links: [
      { href: "/start#console", label: "Run locally" },
      { href: "/start#api", label: "HTTP API" },
      { href: "/start#mcp", label: "MCP server" },
      { href: "/#results", label: "Evaluation" },
    ],
  },
  {
    title: "Project",
    links: [
      { href: REPO_URL, label: "GitHub" },
      { href: `${REPO_URL}/tree/main/docs`, label: "Architecture" },
      { href: `${REPO_URL}/issues`, label: "Issues" },
    ],
  },
];

function FooterLink({ href, label }: { href: string; label: string }) {
  const cls = "text-mist transition-colors hover:text-signal";
  return href.startsWith("http") ? (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {label}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {label}
    </Link>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line bg-hull/50">
      <div className="container-page py-14">
        <div className="grid gap-10 md:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div>
            <div className="flex items-center gap-2.5">
              <LogoMark className="h-6 w-6" />
              <span className="font-mono text-[15px] font-semibold uppercase tracking-[0.2em]">Veil</span>
            </div>
            <p className="mt-4 max-w-xs text-sm text-mist">
              Inspect what AI agents read. Control what they do. A runtime security layer that runs locally on Gemma 4.
            </p>
          </div>
          {COLUMNS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <p className="font-mono text-xs uppercase tracking-[0.16em] text-ink">{col.title}</p>
              <ul className="mt-4 space-y-2.5 text-sm">
                {col.links.map((l) => (
                  <li key={l.href}>
                    <FooterLink {...l} />
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="mt-12 border-t border-line pt-6">
          <p className="prose-measure text-xs leading-relaxed text-mist">
            Licensed under Apache-2.0. v1 (the inner door) was built at Amrita Hack Day; v2 (the outer door, the gate and this
            console) was built for Hacktoberfest Hack Day Coimbatore × Sri Shakthi Institute of Engineering and Technology, with
            Major League Hacking. Gemma 4 is an open-weight model from Google, run through Microsoft Foundry Local; Veil is not
            affiliated with either company. The demo is a sandbox: no real email is sent and no shell command is executed.
          </p>
        </div>
      </div>
    </footer>
  );
}
