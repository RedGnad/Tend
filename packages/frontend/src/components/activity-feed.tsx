"use client";

import { useEffect, useState } from "react";

interface ActivityEvent {
  wallet: string;
  amount: string;
  signature: string;
  timestamp: number;
  tokenMint: string;
  serviceId: string | null;
  isTendService: boolean;
}

function formatSol(lamports: string | number): string {
  return (Number(lamports) / 1_000_000_000).toFixed(4) + " SOL";
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts * 1000;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function ActivityFeed() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEvents = async () => {
    try {
      const res = await fetch("/api/activity");
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events ?? []);
      }
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(fetchEvents, 30_000); // Poll every 30s
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold">Live Activity</h3>
        <div className="flex items-center gap-1.5">
          <div className="pulse-dot" />
          <span className="text-xs text-[var(--accent)]">Live</span>
        </div>
      </div>

      <div className="space-y-3 max-h-96 overflow-y-auto">
        {loading && (
          <p className="text-xs text-[var(--text-muted)] text-center py-4">
            Loading activity...
          </p>
        )}

        {!loading && events.length === 0 && (
          <p className="text-xs text-[var(--text-muted)] text-center py-4">
            No activity yet. Add services to tokens to see claims here.
          </p>
        )}

        {events.map((event, i) => (
          <div
            key={`${event.signature}-${i}`}
            className="flex items-start gap-3 text-xs pb-3 border-b border-[var(--border)] last:border-0"
          >
            <span className="text-base flex-shrink-0 mt-0.5">
              {event.isTendService ? "⚡" : "💰"}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[var(--text)]">
                {event.isTendService ? (
                  <>
                    <span className="text-[var(--accent)]">
                      {event.serviceId}
                    </span>{" "}
                    claimed {formatSol(event.amount)}
                  </>
                ) : (
                  <>
                    {event.wallet.slice(0, 6)}... claimed{" "}
                    {formatSol(event.amount)}
                  </>
                )}
              </p>
              <a
                href={`https://solscan.io/tx/${event.signature}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-[var(--text-muted)] hover:text-[var(--accent)] truncate block mt-0.5"
              >
                {event.signature.slice(0, 20)}...
              </a>
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
