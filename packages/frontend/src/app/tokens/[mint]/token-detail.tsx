"use client";

import { useEffect, useState } from "react";
import { ServiceCard } from "@/components/service-card";
import { ActivityFeed } from "@/components/activity-feed";
import { DecisionFeed } from "@/components/decision-feed";
import { IntelligenceReport } from "@/components/intelligence-report";
import { AddServiceModal } from "@/components/add-service-modal";
import type { ManagedToken } from "@tend/shared";

interface TokenHealth {
  tokenMint: string;
  tokenName: string | null;
  tokenSymbol: string | null;
  lifetimeFees: number;
  totalClaimed: number;
  unclaimedEstimate: number;
  creators: Array<{
    username: string;
    royaltyBps: number;
    wallet: string;
    isAdmin?: boolean;
    provider: string | null;
  }>;
  recentClaims: Array<{
    amount: string | number;
    wallet: string;
    timestamp: number;
  }>;
  managed: ManagedToken | null;
}

function formatSol(lamports: number | string): string {
  return (Number(lamports) / 1_000_000_000).toFixed(4) + " SOL";
}

export function TokenDetail({ mint }: { mint: string }) {
  const [health, setHealth] = useState<TokenHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const fetchHealth = async () => {
    setError(null);
    try {
      const res = await fetch(`/api/tokens/${mint}/health`);
      if (res.ok) {
        setHealth(await res.json());
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Token not found on Bags.fm");
      }
    } catch {
      setError("Failed to connect to Bags.fm API");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
  }, [mint]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="card text-center py-16">
          <p className="text-[var(--text-muted)]">Loading token data...</p>
        </div>
      </div>
    );
  }

  if (!health) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="card text-center py-16">
          <p className="text-red-400 mb-2">{error || "Failed to load token data"}</p>
          <a href="/dashboard" className="text-xs text-[var(--accent)] hover:underline">
            ← Back to dashboard
          </a>
        </div>
      </div>
    );
  }

  const managed = health.managed;

  // Aggregate claimed amounts per wallet from claim events
  const claimedByWallet: Record<string, number> = {};
  for (const e of health.recentClaims) {
    claimedByWallet[e.wallet] =
      (claimedByWallet[e.wallet] || 0) + Number(e.amount);
  }

  const feeDistribution = health.creators.map((c) => ({
    wallet: c.wallet,
    username: c.username,
    bps: c.royaltyBps,
    claimed: claimedByWallet[c.wallet]
      ? String(claimedByWallet[c.wallet])
      : null as string | null,
  }));

  return (
    <div className="max-w-6xl mx-auto fade-in">
      {/* Header */}
      <div className="mb-10">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-[12px] text-[var(--text-muted)] mb-4 font-mono">
          <a href="/dashboard" className="hover:text-[var(--accent)] transition-colors">
            Dashboard
          </a>
          <span className="text-[var(--border-hover)]">/</span>
          <span className="text-[var(--text-secondary)]">Token</span>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-2xl font-semibold tracking-tight">
              {health.tokenName
                ? `${health.tokenName}`
                : mint.slice(0, 16) + "..."}
              {health.tokenSymbol && (
                <span className="text-[var(--accent)] ml-2">${health.tokenSymbol}</span>
              )}
            </h2>
            {health.tokenName && (
              <p className="text-[12px] text-[var(--text-muted)] font-mono mt-1">{mint}</p>
            )}
            <div className="flex items-center gap-3 mt-2">
              <a
                href={`https://bags.fm/${mint}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] text-[var(--accent)] hover:underline font-medium"
              >
                Bags.fm ↗
              </a>
              <a
                href={`https://solscan.io/token/${mint}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[12px] text-[var(--text-muted)] hover:text-white transition-colors"
              >
                Solscan ↗
              </a>
            </div>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="gradient-btn px-6 py-3 rounded-xl text-sm font-semibold"
          >
            + Add Service
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="card card-accent">
          <p className="text-[11px] text-[var(--text-muted)] mb-2 uppercase tracking-wider font-mono">Lifetime Fees</p>
          <p className="text-xl font-bold stat-value">
            {formatSol(health.lifetimeFees)}
          </p>
          <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
            1% of all trading volume
          </p>
        </div>
        <div className="card card-accent">
          <p className="text-[11px] text-[var(--text-muted)] mb-2 uppercase tracking-wider font-mono">Unclaimed</p>
          <p className="text-xl font-bold gradient-text stat-value">
            {formatSol(health.unclaimedEstimate)}
          </p>
          <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
            Available to claim now
          </p>
        </div>
        <div className="card card-accent">
          <p className="text-[11px] text-[var(--text-muted)] mb-2 uppercase tracking-wider font-mono">Active Services</p>
          <p className="text-xl font-bold stat-value">{managed?.services.length ?? 0}</p>
          <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
            AI-powered strategies
          </p>
        </div>
        <div className="card card-accent">
          <p className="text-[11px] text-[var(--text-muted)] mb-2 uppercase tracking-wider font-mono">Fee Claimers</p>
          <p className="text-xl font-bold stat-value text-[var(--accent)]">{feeDistribution.length}</p>
          <p className="text-[11px] text-[var(--text-muted)] mt-1.5">
            {formatSol(health.totalClaimed)} claimed total
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left */}
        <div className="lg:col-span-2 space-y-6">
          {/* Fee distribution */}
          <div className="card">
            <h3 className="text-[13px] font-display font-semibold mb-4 flex items-center gap-2">
              <span className="text-[var(--accent)]">●</span> Fee Distribution
              <span className="text-[10px] font-mono text-[var(--text-muted)] font-normal">on-chain</span>
            </h3>
            {feeDistribution.length > 0 ? (
              <>
                {/* Visual bar */}
                <div className="flex h-3 rounded-full overflow-hidden mb-4">
                  {feeDistribution.map((c, i) => {
                    const isTend = managed?.services.some(
                      (s) => s.claimerWallet === c.wallet
                    );
                    const colors = [
                      "bg-[var(--accent)]",
                      "bg-[var(--accent-secondary)]",
                      "bg-purple-500",
                      "bg-amber-500",
                      "bg-rose-500",
                    ];
                    return (
                      <div
                        key={i}
                        className={`${isTend ? "bg-[var(--accent)]" : colors[i % colors.length]} transition-all`}
                        style={{ width: `${(c.bps / 100)}%` }}
                        title={`${c.username || c.wallet.slice(0, 8)} — ${c.bps} BPS`}
                      />
                    );
                  })}
                </div>
                <div className="space-y-2">
                  {feeDistribution.map((c, i) => {
                    const isTend = managed?.services.some(
                      (s) => s.claimerWallet === c.wallet
                    );
                    const tendService = managed?.services.find(
                      (s) => s.claimerWallet === c.wallet
                    );
                    return (
                      <div
                        key={i}
                        className="flex items-center justify-between text-xs py-2 border-b border-[var(--border)] last:border-0"
                      >
                        <div className="flex items-center gap-2">
                          {isTend && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent)]/20 text-[var(--accent)]">
                              TEND
                            </span>
                          )}
                          <span>
                            {isTend
                              ? tendService?.serviceId
                              : c.username || c.wallet.slice(0, 8) + "..."}
                          </span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="font-mono">
                            {c.bps} BPS ({(c.bps / 100).toFixed(1)}%)
                          </span>
                          {c.claimed !== null && (
                            <span className="text-[var(--text-muted)]">
                              {formatSol(c.claimed)} claimed
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="text-xs text-[var(--text-muted)] py-4 text-center">
                No fee-share config found. This token may not have claimers set up yet.
              </p>
            )}
          </div>

          {/* Services */}
          {managed && managed.services.length > 0 && (
            <div>
              <h3 className="text-[13px] font-display font-semibold mb-4 flex items-center gap-2">
                <span className="text-[var(--accent)]">●</span> Active Services
              </h3>
              <div className="grid grid-cols-2 gap-4">
                {managed.services.map((s) => (
                  <ServiceCard key={s.serviceId} service={s} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right */}
        <div className="space-y-6">
          <DecisionFeed mint={mint} />
          <IntelligenceReport mint={mint} />
          <ActivityFeed />

          {/* Creators */}
          <div className="card">
            <h3 className="text-[13px] font-display font-semibold mb-3">Creators</h3>
            <div className="space-y-2">
              {health.creators.map((c, i) => (
                <div key={i} className="text-xs flex justify-between">
                  <span>
                    {c.username || c.wallet.slice(0, 8) + "..."}
                    {c.isAdmin && (
                      <span className="ml-1 text-[var(--accent)]">
                        [admin]
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-[var(--text-muted)]">
                    {c.royaltyBps} BPS
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* How it works — show when no services */}
          {(!managed || managed.services.length === 0) && (
            <div className="card">
              <h3 className="text-[13px] font-display font-semibold mb-3">How Tend works</h3>
              <div className="space-y-3 text-xs text-[var(--text-muted)]">
                <div className="flex gap-2">
                  <span className="text-[var(--accent)] font-bold shrink-0">1.</span>
                  <span>Add an AI service (buyback bot, analytics, etc.) to this token</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-[var(--accent)] font-bold shrink-0">2.</span>
                  <span>Tend allocates a % of trading fees (BPS) to the service wallet</span>
                </div>
                <div className="flex gap-2">
                  <span className="text-[var(--accent)] font-bold shrink-0">3.</span>
                  <span>The service auto-claims fees and executes its strategy on-chain</span>
                </div>
              </div>
              <a
                href="/services"
                className="block mt-4 text-xs text-[var(--accent)] hover:underline"
              >
                Browse available services →
              </a>
            </div>
          )}
        </div>
      </div>

      {showAddModal && managed && (
        <AddServiceModal
          tokenMint={mint}
          existingServiceIds={managed.services.map((s) => s.serviceId)}
          availableBps={managed.creatorBps}
          onClose={() => setShowAddModal(false)}
          onAdded={fetchHealth}
        />
      )}

      {showAddModal && !managed && (
        <AddServiceModal
          tokenMint={mint}
          existingServiceIds={[]}
          availableBps={10_000 - feeDistribution.reduce((s, c) => s + c.bps, 0)}
          onClose={() => setShowAddModal(false)}
          onAdded={fetchHealth}
        />
      )}
    </div>
  );
}
