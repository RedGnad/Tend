"use client";

import { useEffect, useState } from "react";

interface ActivityEvent {
  type: "claim" | "buyback" | "config" | "service";
  message: string;
  timestamp: number;
  signature?: string;
}

// Simulated feed — in production, poll from Bags API claim events
const DEMO_EVENTS: ActivityEvent[] = [
  {
    type: "service",
    message: "Buyback Bot activated on token",
    timestamp: Date.now() - 60_000,
  },
  {
    type: "claim",
    message: "Fee Compounder claimed 0.05 SOL",
    timestamp: Date.now() - 120_000,
  },
  {
    type: "buyback",
    message: "Buyback Bot purchased 1,234 tokens for 0.1 SOL",
    timestamp: Date.now() - 300_000,
  },
  {
    type: "config",
    message: "Fee allocation rebalanced: Buyback 15% → 20%",
    timestamp: Date.now() - 600_000,
  },
  {
    type: "claim",
    message: "Analytics Engine claimed 0.02 SOL",
    timestamp: Date.now() - 900_000,
  },
];

const TYPE_ICONS: Record<string, string> = {
  claim: "💰",
  buyback: "↩",
  config: "⚙",
  service: "🔌",
};

const TYPE_COLORS: Record<string, string> = {
  claim: "var(--accent)",
  buyback: "var(--accent-secondary)",
  config: "var(--warning)",
  service: "#8b5cf6",
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function ActivityFeed() {
  const [events, setEvents] = useState<ActivityEvent[]>(DEMO_EVENTS);

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold">Live Activity</h3>
        <div className="flex items-center gap-1.5">
          <div className="pulse-dot" />
          <span className="text-xs text-[var(--accent)]">Live</span>
        </div>
      </div>

      <div className="space-y-3 max-h-80 overflow-y-auto">
        {events.map((event, i) => (
          <div
            key={i}
            className="flex items-start gap-3 text-xs pb-3 border-b border-[var(--border)] last:border-0"
          >
            <span className="text-base flex-shrink-0 mt-0.5">
              {TYPE_ICONS[event.type]}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[var(--text)]">{event.message}</p>
              {event.signature && (
                <p className="font-mono text-[var(--text-muted)] truncate mt-0.5">
                  tx: {event.signature}
                </p>
              )}
            </div>
            <span className="text-[var(--text-muted)] flex-shrink-0">
              {timeAgo(event.timestamp)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
