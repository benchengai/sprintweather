import type { Metadata, Viewport } from "next";
import Link from "next/link";

import { Limitations, ResearchBasis } from "@/components/Panels";
import { isDemo } from "@/lib/data";

import "./globals.css";

export const metadata: Metadata = {
  title: "SprintWeather",
  description: "An opt-in, self-reported, k-anonymous team pulse for sprint retrospectives.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <div className="wrap">
            <Link href="/" className="brand">
              SprintWeather
            </Link>
            <nav className="nav" aria-label="Main">
              <Link href="/retro/">Retro view</Link>
              <Link href="/checkin/">Check-in</Link>
              <Link href="/privacy/">Privacy model</Link>
              <Link href="/facilitator/">Facilitator</Link>
            </nav>
          </div>
        </header>
        {isDemo ? (
          <div className="banner" role="note">
            <div className="wrap">
              <strong>Demo with synthetic data.</strong> A fictional 20-person team over six sprints; the answers come from a
              seeded script. Themes are saved, unedited outputs of a real pipeline run over hand-written synthetic notes.
              Nothing here describes a real person.
            </div>
          </div>
        ) : (
          <div className="banner" role="note">
            <div className="wrap">
              <strong>Local mode.</strong> Data stays in <code>.data/store.json</code> on this machine. No login: run it only on
              a machine you trust.
            </div>
          </div>
        )}
        <main>
          <div className="wrap">{children}</div>
        </main>
        <footer className="site-footer">
          <div className="wrap">
            <ResearchBasis />
            <Limitations />
            <p className="small muted">
              Self-report only: SprintWeather never infers anyone&apos;s emotions and never shows an individual&apos;s answers.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
