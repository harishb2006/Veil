import type { Metadata, Viewport } from "next";
// Fonts are bundled from npm (no CDN), so the demo still works with Wi-Fi off.
import "@fontsource-variable/inter";
import "@fontsource-variable/geist-mono";
import "./globals.css";
import { Providers } from "@/components/site/Providers";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";

export const metadata: Metadata = {
  title: "Veil — a runtime security layer for AI agents",
  description:
    "Veil scans what your AI agent reads for hidden instructions and keeps private values out of what it sends. It runs locally, on an open-weight Gemma 4.",
};

export const viewport: Viewport = {
  themeColor: "#07080a",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-signal focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-void"
          >
            Skip to content
          </a>
          <SiteHeader />
          <main id="main">{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}
