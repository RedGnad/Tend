"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ExploreToken() {
  const [mint, setMint] = useState("");
  const router = useRouter();

  const handleExplore = () => {
    const trimmed = mint.trim();
    if (trimmed) {
      router.push(`/tokens/${trimmed}`);
    }
  };

  return (
    <div className="card">
      <h3 className="text-sm font-semibold mb-1">Explore any token</h3>
      <p className="text-xs text-[var(--text-muted)] mb-3">
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
          onClick={handleExplore}
          disabled={!mint.trim()}
          className="px-5 py-2 rounded-lg text-sm font-semibold gradient-btn disabled:opacity-40"
        >
          View
        </button>
      </div>
    </div>
  );
}
