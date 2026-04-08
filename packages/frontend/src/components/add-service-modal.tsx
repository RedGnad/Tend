"use client";

import { useState } from "react";

const SERVICES = [
  {
    id: "buyback-bot",
    name: "Buyback Bot",
    icon: "↩",
    description: "Claims fees and buys back the token, creating buy pressure.",
    defaultBps: 1500,
    minBps: 500,
    maxBps: 4000,
    color: "#10b981",
  },
  {
    id: "fee-compounder",
    name: "Fee Compounder",
    icon: "🔄",
    description: "Claims fees and reinvests into liquidity positions.",
    defaultBps: 1000,
    minBps: 300,
    maxBps: 3000,
    color: "#06b6d4",
  },
  {
    id: "analytics",
    name: "Analytics Engine",
    icon: "📊",
    description: "Monitors holders, fees, price action, and health reports.",
    defaultBps: 500,
    minBps: 200,
    maxBps: 1500,
    color: "#8b5cf6",
  },
  {
    id: "growth-agent",
    name: "Growth Agent",
    icon: "📈",
    description: "AI-powered community engagement and marketing.",
    defaultBps: 2000,
    minBps: 500,
    maxBps: 4000,
    color: "#f59e0b",
  },
];

interface Props {
  tokenMint: string;
  existingServiceIds: string[];
  availableBps: number;
  onClose: () => void;
  onAdded: () => void;
}

export function AddServiceModal({
  tokenMint,
  existingServiceIds,
  availableBps,
  onClose,
  onAdded,
}: Props) {
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [bps, setBps] = useState(1500);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const service = SERVICES.find((s) => s.id === selectedService);

  const handleAdd = async () => {
    if (!selectedService) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/services/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenMint, serviceId: selectedService, bps }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      onAdded();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add service");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[var(--border)]">
          <h2 className="text-lg font-bold">Add Service</h2>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-white text-xl"
          >
            ×
          </button>
        </div>

        <div className="p-6">
          {!selectedService ? (
            /* Service selection */
            <div className="space-y-3">
              <p className="text-xs text-[var(--text-muted)] mb-4">
                Available BPS: {availableBps} ({(availableBps / 100).toFixed(1)}
                %)
              </p>
              {SERVICES.map((s) => {
                const isExisting = existingServiceIds.includes(s.id);
                const tooExpensive = s.minBps > availableBps;
                const disabled = isExisting || tooExpensive;

                return (
                  <button
                    key={s.id}
                    onClick={() => {
                      if (!disabled) {
                        setSelectedService(s.id);
                        setBps(Math.min(s.defaultBps, availableBps));
                      }
                    }}
                    disabled={disabled}
                    className={`w-full text-left p-4 rounded-xl border transition-colors ${
                      disabled
                        ? "border-[var(--border)] opacity-40 cursor-not-allowed"
                        : "border-[var(--border)] hover:border-[var(--border-hover)] cursor-pointer"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="text-2xl w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: s.color + "1a" }}
                      >
                        {s.icon}
                      </span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-sm">{s.name}</h3>
                          {isExisting && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent)]/20 text-[var(--accent)]">
                              ACTIVE
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">
                          {s.description}
                        </p>
                        <p className="text-xs font-mono mt-1">
                          {s.defaultBps} BPS (
                          {(s.defaultBps / 100).toFixed(1)}%)
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            /* BPS configuration */
            <div className="space-y-6">
              <button
                onClick={() => setSelectedService(null)}
                className="text-xs text-[var(--text-muted)] hover:text-white"
              >
                ← Back to services
              </button>

              <div className="flex items-center gap-3">
                <span
                  className="text-2xl w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: service!.color + "1a" }}
                >
                  {service!.icon}
                </span>
                <div>
                  <h3 className="font-bold">{service!.name}</h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    {service!.description}
                  </p>
                </div>
              </div>

              <div>
                <label className="text-xs text-[var(--text-muted)] block mb-2">
                  Fee allocation (BPS)
                </label>
                <input
                  type="range"
                  min={service!.minBps}
                  max={Math.min(service!.maxBps, availableBps)}
                  step={100}
                  value={bps}
                  onChange={(e) => setBps(Number(e.target.value))}
                  className="w-full accent-[var(--accent)]"
                />
                <div className="flex justify-between text-xs mt-1">
                  <span className="text-[var(--text-muted)]">
                    {service!.minBps} BPS
                  </span>
                  <span className="font-mono font-bold text-[var(--accent)]">
                    {bps} BPS ({(bps / 100).toFixed(1)}%)
                  </span>
                  <span className="text-[var(--text-muted)]">
                    {Math.min(service!.maxBps, availableBps)} BPS
                  </span>
                </div>
              </div>

              {/* Preview */}
              <div className="card !bg-[var(--bg)] text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Service</span>
                  <span>{service!.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Allocation</span>
                  <span className="font-mono">
                    {bps} BPS ({(bps / 100).toFixed(1)}%)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">
                    Creator remaining
                  </span>
                  <span className="font-mono">
                    {availableBps - bps} BPS (
                    {((availableBps - bps) / 100).toFixed(1)}%)
                  </span>
                </div>
              </div>

              {error && (
                <p className="text-xs text-[var(--danger)]">{error}</p>
              )}

              <button
                onClick={handleAdd}
                disabled={loading}
                className="w-full py-3 rounded-xl font-semibold text-sm transition-colors"
                style={{
                  background: loading
                    ? "var(--border)"
                    : `linear-gradient(135deg, var(--accent), var(--accent-secondary))`,
                  color: "white",
                }}
              >
                {loading ? "Adding service on-chain..." : "Add Service"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
