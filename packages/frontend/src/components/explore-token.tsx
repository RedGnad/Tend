"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const TEND_MINT = "6qa9oCypYpnWZyZNQ8v36eLbmWmcgHRv4MuU7BXQBAGS";

export function ExploreToken() {
  const [mint, setMint] = useState("");
  const router = useRouter();

  const handleExplore = (address?: string) => {
    const trimmed = (address ?? mint).trim();
    if (trimmed) {
      router.push(`/tokens/${trimmed}`);
    }
  };

  return (
    <div className="card card-accent">
      <h3 className="text-[13px] font-display font-semibold mb-1">Explore any token</h3>
      <p className="text-[12px] text-[var(--text-muted)] mb-3">
        Paste a Bags.fm token mint to view its fee-share config and stats
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Token mint address..."
          value={mint}
          onChange={(e) => setMint(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleExplore()}
          className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm font-mono text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
        />
        <button
          onClick={() => handleExplore()}
          disabled={!mint.trim()}
          className="px-5 py-2 rounded-lg text-sm font-semibold gradient-btn disabled:opacity-40"
        >
          View
        </button>
      </div>
      {/* Quick suggestion */}
      <div className="mt-3 pt-3 border-t border-[var(--border)]">
        <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-mono mb-2">Try it</p>
        <button
          onClick={() => handleExplore(TEND_MINT)}
          className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors group"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
          <span className="font-medium">$TEND</span>
          <span className="text-[var(--text-muted)] font-mono text-[10px] group-hover:text-[var(--accent)]">
            {TEND_MINT.slice(0, 8)}...{TEND_MINT.slice(-4)}
          </span>
        </button>
      </div>
    </div>
  );
}
