"use client";

import { useEffect, useState } from "react";
import { Zap, Coins } from "./service-icons";

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
  const [error, setError] = useState(false);

  const fetchEvents = async () => {
    try {
      const res = await fetch("/api/activity");
      if (res.ok) {
        const data = await res.json();
        setEvents(data.events ?? []);
        setError(false);
      }
    } catch {
      setError(true);
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
        <h3 className="text-[13px] font-display font-semibold">Activity</h3>
        <div className="flex items-center gap-1.5">
          <div className="pulse-dot" style={{ width: 6, height: 6 }} />
          <span className="text-[11px] text-[var(--accent)] font-mono uppercase tracking-wider">Live</span>
        </div>
      </div>

      <div className="space-y-3 max-h-96 overflow-y-auto">
        {loading && (
          <p className="text-xs text-[var(--text-muted)] text-center py-4">
            Loading activity...
          </p>
        )}

        {!loading && error && (
          <p className="text-xs text-red-400 text-center py-4">
            Failed to load activity
          </p>
        )}

        {!loading && !error && events.length === 0 && (
          <div className="text-center py-4">
            <p className="text-xs text-[var(--text-muted)]">
              No claims yet
            </p>
            <p className="text-[10px] text-[var(--text-muted)] mt-1">
              Fee claims from Tend services will appear here in real-time
            </p>
          </div>
        )}

        {events.map((event, i) => (
          <div
            key={`${event.signature}-${i}`}
            className="flex items-start gap-3 text-xs pb-3 border-b border-[var(--border)] last:border-0"
          >
            <span className="flex-shrink-0 mt-0.5" style={{ color: event.isTendService ? "var(--accent)" : "var(--text-muted)" }}>
              {event.isTendService ? <Zap size={16} /> : <Coins size={16} />}
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
