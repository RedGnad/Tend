"use client";

import type { ManagedToken } from "@tend/shared";

interface FlowItem {
  label: string;
  bps: number;
  color: string;
}

const SERVICE_COLORS: Record<string, string> = {
  "buyback-bot": "#10b981",
  "fee-compounder": "#06b6d4",
  analytics: "#8b5cf6",
  "growth-agent": "#f59e0b",
  "market-maker": "#ec4899",
  "community-rewards": "#6366f1",
};

export function FeeFlow({ token }: { token: ManagedToken }) {
  const items: FlowItem[] = [
    {
      label: "Creator",
      bps: token.creatorBps,
      color: "#e5e5e5",
    },
    ...token.services.map((s) => ({
      label: s.serviceId,
      bps: s.bps,
      color: SERVICE_COLORS[s.serviceId] ?? "#888",
    })),
  ];

  const total = items.reduce((sum, i) => sum + i.bps, 0);

  return (
    <div className="card">
      <h3 className="text-sm font-semibold mb-4">Fee Distribution</h3>

      {/* Bar visualization */}
      <div className="h-8 rounded-lg overflow-hidden flex mb-4">
        {items.map((item, i) => (
          <div
            key={i}
            className="h-full transition-all duration-500"
            style={{
              width: `${(item.bps / total) * 100}%`,
              backgroundColor: item.color,
              opacity: 0.8,
            }}
            title={`${item.label}: ${item.bps} BPS (${(item.bps / 100).toFixed(1)}%)`}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 gap-2">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <div
              className="w-3 h-3 rounded-sm flex-shrink-0"
              style={{ backgroundColor: item.color, opacity: 0.8 }}
            />
            <span className="text-[var(--text-muted)] truncate">
              {item.label}
            </span>
            <span className="font-mono ml-auto">
              {(item.bps / 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>

      {/* Flow arrows */}
      <div className="mt-4 pt-4 border-t border-[var(--border)]">
        <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
          <span>Trading Fees</span>
          <span className="gradient-text font-medium">→ Tend Orchestrator →</span>
          <span>{items.length} recipient(s)</span>
        </div>
      </div>
    </div>
  );
}
