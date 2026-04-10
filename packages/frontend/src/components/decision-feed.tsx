"use client";

import { useEffect, useState } from "react";
import type { AgentDecision } from "@tend/shared";

function formatSol(lamports: number): string {
  return (lamports / 1_000_000_000).toFixed(6);
}

function ActionBadge({ action }: { action: string }) {
  const styles: Record<string, { bg: string; text: string; label: string }> = {
    buy: { bg: "bg-emerald-500/15", text: "text-emerald-400", label: "BUY" },
    partial_buy: { bg: "bg-amber-500/15", text: "text-amber-400", label: "PARTIAL" },
    hold: { bg: "bg-zinc-500/15", text: "text-zinc-400", label: "HOLD" },
  };
  const s = styles[action] ?? styles.hold;
  return (
    <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

export function DecisionFeed({ mint }: { mint: string }) {
  const [decisions, setDecisions] = useState<AgentDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/decisions?mint=${mint}`)
      .then((r) => r.json())
      .then((data) => {
        setDecisions(data.decisions ?? []);
        setMessage(data.message ?? null);
      })
      .catch(() => setMessage("Failed to load decisions"))
      .finally(() => setLoading(false));
  }, [mint]);

  return (
    <div className="card">
      <h3 className="text-[13px] font-display font-semibold mb-3 flex items-center gap-2">
        <span className="text-[var(--accent)]">●</span> Agent Decisions
      </h3>

      {loading && (
        <p className="text-xs text-[var(--text-muted)] py-4 text-center">Loading...</p>
      )}

      {!loading && decisions.length === 0 && (
        <p className="text-xs text-[var(--text-muted)] py-4 text-center leading-relaxed">
          {message || "No agent decisions yet. Run the Tend agent locally to see AI-powered buyback decisions."}
        </p>
      )}

      {!loading && decisions.length > 0 && (
        <div className="space-y-3">
          {decisions.slice(0, 10).map((d, i) => (
            <div key={i} className="border-b border-[var(--border)] pb-3 last:border-0 last:pb-0">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <ActionBadge action={d.decision.action} />
                  {d.decision.amount_pct > 0 && (
                    <span className="text-[11px] font-mono text-[var(--text-secondary)]">
                      {d.decision.amount_pct}%
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-[var(--text-muted)] font-mono">
                  {new Date(d.timestamp).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>

              <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed mb-1.5">
                {d.decision.reasoning}
              </p>

              <div className="flex items-center gap-3 text-[10px] text-[var(--text-muted)] font-mono">
                <span>price={d.inputs.price_sol.toFixed(9)}</span>
                <span>fees={d.inputs.claimable_sol.toFixed(6)}</span>
                <span>vel={d.inputs.fee_velocity}</span>
              </div>

              {d.execution.executed && d.execution.tx_signature && (
                <a
                  href={`https://solscan.io/tx/${d.execution.tx_signature}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block mt-1.5 text-[10px] text-[var(--accent)] hover:underline font-mono"
                >
                  tx={d.execution.tx_signature.slice(0, 16)}... ↗
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
