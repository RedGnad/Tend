"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "./sidebar";

export function LayoutShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLanding = pathname === "/";

  if (isLanding) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 p-8 lg:p-10 overflow-auto relative">
        {/* Subtle top-left glow */}
        <div className="absolute top-0 left-0 w-96 h-96 rounded-full blur-3xl bg-[var(--accent)] opacity-[0.015] pointer-events-none" />
        <div className="relative z-[1]">
          {children}
        </div>
      </main>
    </div>
  );
}
