"use client";

import { usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletButton } from "./wallet-button";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: "◉" },
  { href: "/services", label: "Services", icon: "⚡" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { connected } = useWallet();

  return (
    <aside className="w-64 border-r border-[var(--border)] p-6 flex flex-col gap-8 flex-shrink-0 relative z-10">
      <div>
        <h1 className="text-2xl font-bold gradient-text tracking-tight">
          Tend
        </h1>
        <p className="text-[10px] text-[var(--text-muted)] mt-1 uppercase tracking-[0.2em]">
          Fee-sharing as a service
        </p>
      </div>

      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          return (
            <a
              key={item.href}
              href={item.href}
              className={`px-3 py-2.5 rounded-lg text-sm flex items-center gap-2.5 transition-all ${
                isActive
                  ? "bg-[var(--bg-card)] text-white border border-[var(--border)]"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg-card)] hover:text-white"
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
          <div className="card !p-3 text-xs">
            <div className="flex items-center gap-2 mb-1">
              <div className="pulse-dot" />
              <span className="text-[var(--accent)] font-medium">
                Mainnet
              </span>
            </div>
            <p className="text-[var(--text-muted)]">
              Connected to Solana
            </p>
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
