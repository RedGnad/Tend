"use client";

import { useEffect, useState } from "react";

interface NetworkStats {
  topTokens: number;
  totalFees: string;
}

export function StatsBar() {
  const [stats, setStats] = useState<NetworkStats | null>(null);

  useEffect(() => {
    fetch("/api/leaderboard")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to fetch");
        return r.json();
      })
      .then((d) => {
        const tokens = d.tokens ?? [];
        const totalFees = tokens.reduce(
          (sum: number, t: { lifetimeFees: string }) =>
            sum + Number(t.lifetimeFees),
          0
        );
        setStats({
          topTokens: tokens.length,
          totalFees: (totalFees / 1_000_000_000).toFixed(2),
        });
      })
      .catch(() => {});
  }, []);

  const items = [
    {
      label: "Bags.fm Tokens",
      value: stats ? `${stats.topTokens}+` : "...",
      sub: "With fee-sharing",
    },
    {
      label: "Total Fees Generated",
      value: stats ? `${stats.totalFees} SOL` : "...",
      sub: "Across top tokens",
    },
    {
      label: "Available Services",
      value: "4",
      sub: "Buyback, Analytics, ...",
    },
    {
      label: "Protocol",
      value: "LIVE",
      accent: true,
      pulse: true,
      sub: "Solana Mainnet",
    },
  ];

  return (
    <div className="grid grid-cols-4 gap-4">
      {items.map((stat) => (
        <div key={stat.label} className="card !p-4">
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-2">
            {stat.label}
          </p>
          <div className="flex items-center gap-2">
            {"pulse" in stat && stat.pulse && <div className="pulse-dot" />}
            <p
              className={`text-2xl font-bold stat-value ${
                "accent" in stat && stat.accent ? "text-[var(--accent)]" : ""
              }`}
            >
              {stat.value}
            </p>
          </div>
          <p className="text-[10px] text-[var(--text-muted)] mt-1">{stat.sub}</p>
        </div>
      ))}
    </div>
  );
}
