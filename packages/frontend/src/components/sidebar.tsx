"use client";

import { usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletButton } from "./wallet-button";
import { LayoutDashboard, Zap } from "lucide-react";
import type { ComponentType } from "react";
import type { LucideProps } from "lucide-react";

const NAV_ITEMS: Array<{ href: string; label: string; Icon: ComponentType<LucideProps> }> = [
  { href: "/dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/services", label: "Services", Icon: Zap },
];

export function Sidebar() {
  const pathname = usePathname();
  const { connected } = useWallet();

  return (
    <aside className="w-64 border-r border-[var(--border)] flex flex-col flex-shrink-0 relative z-10">
      {/* Logo area */}
      <div className="p-6 pb-5">
        <a href="/" className="block group">
          <h1 className="text-2xl font-bold font-display gradient-text tracking-tight">
            Tend
          </h1>
          <p className="text-[10px] text-[var(--text-muted)] mt-0.5 uppercase tracking-[0.18em] font-mono">
            Fee-sharing as a service
          </p>
        </a>
      </div>

      {/* Separator */}
      <div className="mx-5 h-px bg-gradient-to-r from-[var(--border)] via-[var(--border-hover)] to-transparent" />

      {/* Navigation */}
      <nav className="flex flex-col gap-0.5 p-4">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);
          return (
            <a
              key={item.href}
              href={item.href}
              className={`px-3 py-2.5 rounded-lg text-[13px] flex items-center gap-3 transition-all ${
                isActive
                  ? "bg-[var(--bg-elevated)] text-white border border-[var(--border-hover)] shadow-sm"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-card)]"
              }`}
            >
              <item.Icon size={16} className={isActive ? "text-[var(--accent)]" : ""} strokeWidth={1.8} />
              <span className="font-medium">{item.label}</span>
              {isActive && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
              )}
            </a>
          );
        })}
      </nav>

      {/* Bottom section */}
      <div className="mt-auto p-5 space-y-4">
        <WalletButton />

        {connected && (
          <div className="bg-[var(--bg-elevated)] border border-[var(--border)] rounded-lg p-3">
            <div className="flex items-center gap-2 mb-0.5">
              <div className="pulse-dot" style={{ width: 6, height: 6 }} />
              <span className="text-[var(--accent)] font-medium text-[11px] font-mono uppercase tracking-wider">
                Mainnet
              </span>
            </div>
            <p className="text-[var(--text-muted)] text-[11px] font-mono">Solana</p>
          </div>
        )}

        <div className="text-center">
          <a
            href="https://bags.fm"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors font-mono uppercase tracking-wider"
          >
            Powered by Bags.fm
          </a>
        </div>
      </div>
    </aside>
  );
}
