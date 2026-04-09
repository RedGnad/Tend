"use client";

import { usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletButton } from "./wallet-button";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: "◉" },
  { href: "/services", label: "Services", icon: "⚡" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { connected } = useWallet();

  return (
    <aside className="w-60 border-r border-[var(--border)] p-5 flex flex-col gap-6 flex-shrink-0 relative z-10">
      <a href="/" className="block">
        <h1 className="text-xl font-bold font-display gradient-text tracking-tight">
          Tend
        </h1>
        <p className="text-[10px] text-[var(--text-muted)] mt-0.5 uppercase tracking-[0.15em]">
          Fee-sharing as a service
        </p>
      </a>

      <nav className="flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);
          return (
            <a
              key={item.href}
              href={item.href}
              className={`px-3 py-2 rounded-lg text-[13px] flex items-center gap-2.5 transition-colors ${
                isActive
                  ? "bg-[var(--bg-card)] text-white border border-[var(--border)]"
                  : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-card)]"
              }`}
            >
              <span className="text-xs">{item.icon}</span>
              {item.label}
            </a>
          );
        })}
      </nav>

      <div className="mt-auto space-y-4">
        <WalletButton />

        {connected && (
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg p-3 text-xs">
            <div className="flex items-center gap-2 mb-0.5">
              <div className="pulse-dot" style={{ width: 6, height: 6 }} />
              <span className="text-[var(--accent)] font-medium text-[11px]">
                Mainnet
              </span>
            </div>
            <p className="text-[var(--text-muted)] text-[11px]">Solana</p>
          </div>
        )}

        <div className="text-[10px] text-[var(--text-muted)] text-center">
          Powered by{" "}
          <a
            href="https://bags.fm"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--accent)] hover:underline"
          >
            Bags.fm
          </a>
        </div>
      </div>
    </aside>
  );
}
