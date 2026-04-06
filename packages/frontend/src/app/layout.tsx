import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tend — Fee-sharing as a service",
  description:
    "Transform Bags.fm fee-sharing into a payment rail for autonomous AI services",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">
        <div className="flex min-h-screen">
          {/* Sidebar */}
          <aside className="w-64 border-r border-[var(--border)] p-6 flex flex-col gap-8">
            <div>
              <h1 className="text-2xl font-bold gradient-text">Tend</h1>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Fee-sharing as a service
              </p>
            </div>

            <nav className="flex flex-col gap-1">
              <a
                href="/"
                className="px-3 py-2 rounded-lg text-sm hover:bg-[var(--bg-card)] transition-colors"
              >
                Overview
              </a>
              <a
                href="/services"
                className="px-3 py-2 rounded-lg text-sm hover:bg-[var(--bg-card)] transition-colors"
              >
                Services
              </a>
            </nav>

            <div className="mt-auto">
              <div className="card text-xs">
                <div className="flex items-center gap-2 mb-2">
                  <div className="pulse-dot" />
                  <span className="text-[var(--accent)]">Agent Active</span>
                </div>
                <p className="text-[var(--text-muted)]">
                  Buyback bot, fee claimer running
                </p>
              </div>
            </div>
          </aside>

          {/* Main content */}
          <main className="flex-1 p-8 overflow-auto">{children}</main>
        </div>
      </body>
    </html>
  );
}
