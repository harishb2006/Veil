"use client";
// <SiteHeader/>: sticky top bar with the wordmark, the five routes, quiet backend status and a mobile menu.
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LogoMark } from "@/components/ui/DoorIcons";
import { StatusPill } from "./StatusPill";

export const NAV: { href: string; label: string }[] = [
  { href: "/", label: "Overview" },
  { href: "/agent", label: "Live demo" },
  { href: "/lab", label: "Firewall lab" },
  { href: "/privacy", label: "Privacy" },
  { href: "/start", label: "Get started" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [pathname]);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-void/90 backdrop-blur">
      <div className="container-page flex h-14 items-center gap-6">
        <Link href="/" className="flex items-center gap-2" aria-label="Airlock home">
          <LogoMark className="h-6 w-6" />
          <span className="text-[17px] font-semibold tracking-tight">Airlock</span>
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => {
            const active = isActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                  active ? "font-medium text-ink" : "text-mist hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <StatusPill />
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

      {open && (
        <nav id="mobile-nav" aria-label="Main" className="border-t border-line bg-void px-6 py-2 md:hidden">
          <ul>
            {NAV.map((item) => {
              const active = isActive(item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`block border-b border-line/70 py-3 text-[15px] ${active ? "font-medium text-ink" : "text-mist"}`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </header>
  );
}
