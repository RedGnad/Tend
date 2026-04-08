"use client";

import { useEffect, useState } from "react";
import { ServiceCard } from "@/components/service-card";
import { FeeFlow } from "@/components/fee-flow";
import { ActivityFeed } from "@/components/activity-feed";
import { AddServiceModal } from "@/components/add-service-modal";
import type { ManagedToken } from "@tend/shared";

interface TokenHealth {
  tokenMint: string;
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
  claimStats: Array<{
    username: string;
    royaltyBps: number;
    totalClaimed: string;
    wallet: string;
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

  const fetchHealth = async () => {
    try {
      const res = await fetch(`/api/tokens/${mint}/health`);
      if (res.ok) {
        setHealth(await res.json());
      }
    } catch {
      // Silent
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
          <p className="text-[var(--text-muted)]">Failed to load token data</p>
        </div>
      </div>
    );
  }

  const managed = health.managed;

  return (
    <div className="max-w-6xl mx-auto fade-in">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] mb-3">
          <a href="/" className="hover:text-white transition-colors">
            Dashboard
          </a>
          <span>/</span>
          <span>Token</span>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold font-mono">
              {mint.slice(0, 16)}...
            </h2>
            <div className="flex items-center gap-3 mt-1">
              <a
                href={`https://bags.fm/token/${mint}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[var(--accent)] hover:underline"
              >
                Bags.fm
              </a>
              <a
                href={`https://solscan.io/token/${mint}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-[var(--text-muted)] hover:text-white transition-colors"
              >
                Solscan
              </a>
            </div>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="gradient-btn px-5 py-2.5 rounded-xl text-sm font-semibold"
          >
            + Add Service
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="card">
          <p className="text-xs text-[var(--text-muted)] mb-1">Lifetime Fees</p>
          <p className="text-2xl font-bold">
            {formatSol(health.lifetimeFees)}
          </p>
        </div>
        <div className="card">
          <p className="text-xs text-[var(--text-muted)] mb-1">Total Claimed</p>
          <p className="text-2xl font-bold">
            {formatSol(health.totalClaimed)}
          </p>
        </div>
        <div className="card">
          <p className="text-xs text-[var(--text-muted)] mb-1">Unclaimed</p>
          <p className="text-2xl font-bold gradient-text">
            {formatSol(health.unclaimedEstimate)}
          </p>
        </div>
        <div className="card">
          <p className="text-xs text-[var(--text-muted)] mb-1">
            Active Services
          </p>
          <p className="text-2xl font-bold">
            {managed?.services.length ?? 0}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left */}
        <div className="col-span-2 space-y-6">
          {/* Fee flow */}
          {managed && managed.services.length > 0 && (
            <FeeFlow token={managed} />
          )}

          {/* Creators / claimers */}
          <div className="card">
            <h3 className="text-sm font-semibold mb-3">
              Fee Distribution (on-chain)
            </h3>
            <div className="space-y-2">
              {health.claimStats.map((c, i) => {
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
                        {c.royaltyBps} BPS (
                        {(c.royaltyBps / 100).toFixed(1)}%)
                      </span>
                      <span className="text-[var(--text-muted)]">
                        {formatSol(c.totalClaimed)} claimed
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Services */}
          {managed && managed.services.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-3">Active Services</h3>
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
          <ActivityFeed />

          {/* Creators */}
          <div className="card">
            <h3 className="text-sm font-semibold mb-3">Creators</h3>
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
          availableBps={10_000}
          onClose={() => setShowAddModal(false)}
          onAdded={fetchHealth}
        />
      )}
    </div>
  );
}
