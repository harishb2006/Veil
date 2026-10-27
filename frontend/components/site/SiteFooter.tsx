// <SiteFooter/>: one line about the project, links, licence and the honest v1 / v2 note. Mounted once in app/layout.tsx.
import Link from "next/link";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/agent", label: "Live demo" },
  { href: "/lab", label: "Firewall lab" },
  { href: "/privacy", label: "Privacy" },
  { href: "/start", label: "Get started" },
];

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="container-page py-10">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <p className="max-w-md text-sm text-ink">
            <span className="font-semibold">Airlock</span> scans what an AI agent reads and keeps private values out of what it
            sends. Runs locally on Gemma 4.
          </p>
          <nav aria-label="Footer">
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-mist">
              {LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="hover:text-ink">
                    {l.label}
                  </Link>
                </li>
              ))}
              <li>
                <a href="https://github.com/rahulrr-coder/Agents-Firewall" target="_blank" rel="noreferrer" className="hover:text-ink">
                  GitHub
                </a>
              </li>
            </ul>
          </nav>
        </div>
        <p className="prose-measure mt-8 text-xs leading-relaxed text-mist">
          Licensed under Apache-2.0. v1 (the inner door) was built at Amrita Hack Day; v2 (the outer door, the gate and this
          console) was built for Hacktoberfest Hack Day Coimbatore × Sri Shakthi Institute of Engineering and Technology, with
          Major League Hacking. Gemma 4 is an open-weight model from Google, run through Microsoft Foundry Local; Airlock is
          not affiliated with either company. The demo is a sandbox: no real email is sent and no shell command is executed.
        </p>
      </div>
    </footer>
  );
}
