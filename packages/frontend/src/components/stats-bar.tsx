"use client";

import { useEffect, useState } from "react";
import type { ManagedToken } from "@tend/shared";

export function StatsBar() {
  const [tokens, setTokens] = useState<ManagedToken[]>([]);

  useEffect(() => {
    fetch("/api/tokens")
      .then((r) => r.json())
      .then((d) => setTokens(d.tokens ?? []))
      .catch(() => {});
  }, []);

  const totalServices = tokens.reduce(
    (sum, t) => sum + t.services.length,
    0
  );
  const totalServiceBps = tokens.reduce(
    (sum, t) => sum + t.totalServiceBps,
    0
  );

  const stats = [
    {
      label: "Managed Tokens",
      value: tokens.length.toString(),
      accent: false,
    },
    {
      label: "Active Services",
      value: totalServices.toString(),
      accent: false,
    },
    {
      label: "Fee Allocation",
      value:
        totalServiceBps > 0
          ? (totalServiceBps / 100).toFixed(1) + "%"
          : "--",
      accent: totalServiceBps > 0,
    },
    {
      label: "Protocol",
      value: "LIVE",
      accent: true,
      pulse: true,
    },
  ];

  return (
    <div className="grid grid-cols-4 gap-4">
      {stats.map((stat) => (
        <div key={stat.label} className="card !p-4">
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-2">
            {stat.label}
          </p>
          <div className="flex items-center gap-2">
            {stat.pulse && <div className="pulse-dot" />}
            <p
              className={`text-2xl font-bold stat-value ${
                stat.accent ? "text-[var(--accent)]" : ""
              }`}
            >
              {stat.value}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
