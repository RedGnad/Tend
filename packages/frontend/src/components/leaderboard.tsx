"use client";

import { useEffect, useState } from "react";

interface LeaderboardToken {
  mint: string;
  name: string;
  symbol: string;
  lifetimeFees: number;
  image: string | null;
}

function formatSol(lamports: number): string {
  const sol = lamports / 1_000_000_000;
  if (sol >= 1000) return (sol / 1000).toFixed(1) + "K SOL";
  if (sol >= 1) return sol.toFixed(2) + " SOL";
  return sol.toFixed(4) + " SOL";
}

export function Leaderboard() {
  const [tokens, setTokens] = useState<LeaderboardToken[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/leaderboard")
      .then((r) => r.json())
      .then((d) => setTokens(d.tokens ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold">Top Tokens by Fees</h3>
        <span className="badge badge-muted">Bags.fm</span>
      </div>

      {loading && (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="h-10 rounded-lg bg-[var(--bg)] animate-pulse"
            />
          ))}
        </div>
      )}

      {!loading && tokens.length === 0 && (
        <p className="text-xs text-[var(--text-muted)] text-center py-6">
          No data available
        </p>
      )}

      {!loading && tokens.length > 0 && (
        <div className="space-y-1">
          {tokens.slice(0, 10).map((token, i) => (
            <a
              key={token.mint}
              href={`/tokens/${token.mint}`}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[var(--bg-card-hover)] transition-colors group"
            >
              <span
                className="text-xs font-bold w-6 text-center flex-shrink-0"
                style={{
                  color:
                    i === 0
                      ? "#fbbf24"
                      : i === 1
                        ? "#94a3b8"
                        : i === 2
                          ? "#d97706"
                          : "var(--text-muted)",
                }}
              >
                {i + 1}
              </span>
              {token.image && (
                <img
                  src={token.image}
                  alt=""
                  className="w-6 h-6 rounded-full flex-shrink-0"
                />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate group-hover:text-[var(--accent)] transition-colors">
                  {token.name || token.mint.slice(0, 8) + "..."}
                </p>
                <p className="text-[10px] text-[var(--text-muted)] font-mono">
                  {token.symbol}
                </p>
              </div>
              <span className="text-xs font-mono text-[var(--text-muted)]">
                {formatSol(token.lifetimeFees)}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
