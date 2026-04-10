"use client";

import { useEffect, useState } from "react";
import type { AnalyticsReport } from "@tend/shared";

function TrendBadge({ trend }: { trend: string }) {
  const styles: Record<string, { bg: string; text: string }> = {
    growing: { bg: "bg-emerald-500/15", text: "text-emerald-400" },
    stable: { bg: "bg-blue-500/15", text: "text-blue-400" },
    declining: { bg: "bg-red-500/15", text: "text-red-400" },
  };
  const s = styles[trend] ?? styles.stable;
  return (
    <span className={`text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded ${s.bg} ${s.text} uppercase`}>
      {trend}
    </span>
  );
}

function HealthBar({ score }: { score: number }) {
  const pct = (score / 10) * 100;
  const color =
    score >= 7 ? "bg-emerald-400" : score >= 4 ? "bg-amber-400" : "bg-red-400";

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[12px] font-mono font-semibold">{score}/10</span>
    </div>
  );
}

export function IntelligenceReport({ mint }: { mint: string }) {
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/reports?mint=${mint}`)
      .then((r) => r.json())
      .then((data) => {
        const reports = data.reports ?? [];
        if (reports.length > 0) {
          setReport(reports[0]); // newest first
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [mint]);

  return (
    <div className="card">
      <h3 className="text-[13px] font-display font-semibold mb-3 flex items-center gap-2">
        <span className="text-purple-400">●</span> Intelligence Report
      </h3>

      {loading && (
        <p className="text-xs text-[var(--text-muted)] py-4 text-center">Loading...</p>
      )}

      {!loading && !report && (
        <p className="text-xs text-[var(--text-muted)] py-4 text-center leading-relaxed">
          No intelligence reports yet. The Analytics Engine generates reports every 2 hours when the agent runs.
        </p>
      )}

      {!loading && report && (
        <div className="space-y-4">
          {/* Health + trend */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider font-mono">Health Score</span>
              <TrendBadge trend={report.trend} />
            </div>
            <HealthBar score={report.health_score} />
          </div>

          {/* Data summary */}
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="flex justify-between">
              <span className="text-[var(--text-muted)]">Fees</span>
              <span className="font-mono">{report.data.lifetime_fees_sol.toFixed(4)} SOL</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-muted)]">Velocity</span>
              <span className="font-mono">{report.data.fee_velocity}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-muted)]">Holders</span>
              <span className="font-mono">{report.data.holders}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[var(--text-muted)]">Buybacks</span>
              <span className="font-mono">{report.data.buyback_count}</span>
            </div>
          </div>

          {/* Insights */}
          {report.key_insights.length > 0 && (
            <div>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-mono mb-1.5">Insights</p>
              <ul className="space-y-1">
                {report.key_insights.map((insight, i) => (
                  <li key={i} className="text-[12px] text-[var(--text-secondary)] flex gap-1.5">
                    <span className="text-[var(--accent)] shrink-0">›</span>
                    {insight}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Risks */}
          {report.risks.length > 0 && (
            <div>
              <p className="text-[10px] text-red-400/70 uppercase tracking-wider font-mono mb-1.5">Risks</p>
              <ul className="space-y-1">
                {report.risks.map((risk, i) => (
                  <li key={i} className="text-[12px] text-[var(--text-secondary)] flex gap-1.5">
                    <span className="text-red-400 shrink-0">!</span>
                    {risk}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Opportunities */}
          {report.opportunities.length > 0 && (
            <div>
              <p className="text-[10px] text-emerald-400/70 uppercase tracking-wider font-mono mb-1.5">Opportunities</p>
              <ul className="space-y-1">
                {report.opportunities.map((opp, i) => (
                  <li key={i} className="text-[12px] text-[var(--text-secondary)] flex gap-1.5">
                    <span className="text-emerald-400 shrink-0">+</span>
                    {opp}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Timestamp */}
          <p className="text-[10px] text-[var(--text-muted)] font-mono text-right">
            {new Date(report.timestamp).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
      )}
    </div>
  );
}
