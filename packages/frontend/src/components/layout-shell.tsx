"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

function NavWalletButton() {
  const { publicKey, connected, connecting, disconnect, wallet, connect } =
    useWallet();
  const { setVisible } = useWalletModal();
  const prevWallet = useRef(wallet);

  useEffect(() => {
    if (wallet && wallet !== prevWallet.current && !connected && !connecting) {
      connect().catch(() => {});
    }
    prevWallet.current = wallet;
  }, [wallet, connected, connecting, connect]);

  if (connected && publicKey) {
    return (
      <button
        onClick={() => disconnect()}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] hover:border-[var(--border-hover)] transition-colors text-sm"
      >
        {wallet?.adapter.icon && (
          <img
            src={wallet.adapter.icon}
            alt=""
            className="w-3.5 h-3.5 rounded"
          />
        )}
        <span className="font-mono text-xs">
          {publicKey.toBase58().slice(0, 4)}...
          {publicKey.toBase58().slice(-4)}
        </span>
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
      </button>
    );
  }

  return (
    <button
      onClick={() => setVisible(true)}
      disabled={connecting}
      className="gradient-btn px-5 py-1.5 rounded-lg text-sm font-semibold"
    >
      {connecting ? "Connecting..." : "Connect Wallet"}
    </button>
  );
}

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active =
    href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      className={`text-[13px] transition-colors ${
        active
          ? "text-[var(--text)] font-medium"
          : "text-[var(--text-muted)] hover:text-[var(--text)]"
      }`}
    >
      {label}
    </Link>
  );
}

export function LayoutShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <nav className="sticky top-0 z-50 bg-[#060606]/80 backdrop-blur-xl border-b border-[var(--border)]">
        <div className="max-w-[1080px] mx-auto px-6 h-14 flex items-center justify-between">
          <Link
            href="/"
            className="flex items-center gap-2 flex-shrink-0"
          >
            <span className="font-display text-xl font-bold gradient-text tracking-tight">
              Tend
            </span>
          </Link>

          <div className="hidden md:flex items-center gap-6">
            <NavLink href="/campaigns" label="Campaigns" />
            <NavLink href="/me" label="Rewards" />
            <NavLink href="/creator" label="For creators" />
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] font-mono mr-2">
              <span
                className="pulse-dot"
                style={{ width: 5, height: 5 }}
              />
              <span className="text-[var(--accent)]">Mainnet</span>
            </div>
            <NavWalletButton />
          </div>
        </div>
      </nav>

      <main className="flex-1 relative">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full blur-3xl bg-[var(--accent)] opacity-[0.012] pointer-events-none" />
        <div className="relative z-[1]">{children}</div>
      </main>
    </div>
  );
}
