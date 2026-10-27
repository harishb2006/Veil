"use client";
// <SiteHeader/>: sticky glass top bar with the wordmark, the five routes, backend status, GitHub and a mobile menu.
import { Github, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { LogoMark } from "@/components/ui/DoorIcons";
import { ScrollProgress } from "@/components/fx/ScrollProgress";
import { REPO_URL } from "@/lib/site";
import { StatusPill } from "./StatusPill";

export const NAV: { href: string; label: string }[] = [
  { href: "/", label: "Overview" },
  { href: "/agent", label: "Live demo" },
  { href: "/lab", label: "Firewall lab" },
  { href: "/privacy", label: "Privacy" },
  { href: "/start", label: "Docs" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <header className="sticky top-0 z-50 border-b border-line/80 bg-void/75 backdrop-blur-xl">
      <div className="container-page flex h-16 items-center gap-8">
        <Link href="/" className="flex items-center gap-2.5" aria-label="Veil home">
          <LogoMark className="h-6 w-6" />
          <span className="font-mono text-[15px] font-semibold uppercase tracking-[0.2em]">Veil</span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative rounded-md px-3 py-1.5 text-sm transition-colors ${
                  active ? "text-ink" : "text-mist hover:text-ink"
                }`}
              >
                {item.label}
                {active && <span aria-hidden className="absolute inset-x-3 -bottom-[17px] h-px bg-signal" />}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <StatusPill />
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Veil on GitHub"
            className="hidden h-9 w-9 items-center justify-center rounded-md text-mist transition-colors hover:text-ink sm:inline-flex"
          >
            <Github className="h-[18px] w-[18px]" aria-hidden />
          </a>
          <span className="hidden md:contents">
            <Button href="/agent" size="sm">
              Try the demo
            </Button>
          </span>
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-mist hover:text-ink md:hidden"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      <ScrollProgress />

      {open && (
        <nav id="mobile-nav" aria-label="Main" className="border-t border-line bg-void px-4 py-2 md:hidden">
          <ul>
            {NAV.map((item) => {
              const active = isActive(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`block border-b border-line/70 py-3 text-[15px] ${active ? "font-medium text-signal" : "text-mist"}`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
            <li>
              <a href={REPO_URL} target="_blank" rel="noreferrer" className="block py-3 text-[15px] text-mist">
                GitHub
              </a>
            </li>
          </ul>
        </nav>
      )}
    </header>
  );
}
