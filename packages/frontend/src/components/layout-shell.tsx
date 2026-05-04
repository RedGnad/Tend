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
      aria-current={active ? "page" : undefined}
      className={`relative rounded-md px-3.5 py-2 text-[13px] font-medium transition-all duration-200 ${
        active
          ? "bg-white/[0.065] text-[var(--text)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]"
          : "text-[var(--text-secondary)] hover:bg-white/[0.045] hover:text-[var(--text)]"
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
        <div className="max-w-[1080px] mx-auto px-6 py-2 md:py-0 md:h-14 relative flex flex-wrap items-center justify-between gap-y-2">
          <Link
            href="/"
            className="flex items-center gap-2 flex-shrink-0"
          >
            <span className="font-display text-xl font-bold gradient-text tracking-tight">
              Tend
            </span>
          </Link>

          <div className="order-3 flex w-full items-center justify-center gap-1 rounded-lg border border-white/[0.075] bg-white/[0.035] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] md:order-none md:absolute md:left-1/2 md:top-1/2 md:w-auto md:-translate-x-1/2 md:-translate-y-1/2">
            <NavLink href="/campaigns" label="Campaigns" />
            <NavLink href="/me" label="Rewards" />
            <NavLink href="/creator" label="For creators" />
          </div>

          <div className="flex items-center gap-3">
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
