"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { AddServiceModal } from "./add-service-modal";
import { ExploreToken } from "./explore-token";
import { Zap } from "./service-icons";
import type { ManagedToken } from "@tend/shared";

interface AdminToken {
  tokenMint: string;
  lifetimeFees: string;
  claimers: Array<{
    wallet: string;
    username: string;
    bps: number;
    totalClaimed: string;
  }>;
  managed: ManagedToken | null;
}

function formatSol(lamports: string | number): string {
  const sol = Number(lamports) / 1_000_000_000;
  if (sol >= 1000) return (sol / 1000).toFixed(1) + "K SOL";
  if (sol >= 1) return sol.toFixed(2) + " SOL";
  if (sol > 0) return sol.toFixed(4) + " SOL";
  return "0 SOL";
}

export function TokenManager() {
  const { publicKey, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const [tokens, setTokens] = useState<AdminToken[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState<string | null>(null);

  const fetchTokens = useCallback(async () => {
    if (!publicKey) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/tokens?wallet=${publicKey.toBase58()}`);
      if (!res.ok) throw new Error("Failed to load");
      const data = await res.json();
      setTokens(data.adminTokens ?? []);
    } catch {
      setError("Failed to load your tokens");
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    if (connected && publicKey) {
      fetchTokens();
    } else {
      setTokens([]);
    }
  }, [connected, publicKey, fetchTokens]);

  // ─── Not connected ───
  if (!connected) {
    return (
      <div className="space-y-6">
        <div className="card card-accent text-center py-16 relative overflow-hidden">
          {/* Background glow */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-64 rounded-full blur-3xl bg-[var(--accent)] opacity-[0.03] pointer-events-none" />
          <div className="relative z-10">
            <div className="w-16 h-16 rounded-2xl bg-[var(--accent)]/10 flex items-center justify-center mx-auto mb-5 border border-[var(--accent)]/10 text-[var(--accent)]">
              <Zap size={28} />
            </div>
            <h3 className="text-2xl font-display font-semibold mb-3 tracking-tight">
              Attach AI services to your tokens
            </h3>
            <p className="text-[14px] text-[var(--text-secondary)] max-w-md mx-auto leading-relaxed mb-6">
              Connect your wallet to manage fee-sharing on your Bags.fm tokens.
              Add buyback bots, analytics engines, and growth agents that earn
              fees and work autonomously.
            </p>
            <button
              onClick={() => setVisible(true)}
              className="gradient-btn px-8 py-3 rounded-xl text-sm font-semibold"
            >
              Connect Wallet
            </button>
            <div className="flex items-center justify-center gap-6 mt-6 text-[12px] text-[var(--text-muted)] font-mono">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
                On-chain
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-secondary)]" />
                Non-custodial
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--warning)]" />
                Revocable
              </span>
            </div>
          </div>
        </div>
        <ExploreToken />
      </div>
    );
  }

  // ─── Loading ───
  if (loading && tokens.length === 0) {
    return (
      <div className="card text-center py-12">
        <div className="w-8 h-8 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-[var(--text-muted)]">
          Loading your tokens...
        </p>
      </div>
    );
  }

  // ─── Error ───
  if (error) {
    return (
      <div className="card text-center py-12">
        <p className="text-sm text-red-400 mb-3">{error}</p>
        <button
          onClick={fetchTokens}
          className="text-xs text-[var(--accent)] hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  // ─── No admin tokens ───
  if (tokens.length === 0) {
    return (
      <div className="space-y-6">
        <div className="card text-center py-10">
          <p className="text-lg font-semibold mb-2">No admin tokens found</p>
          <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto">
            You don&apos;t have fee-share admin rights on any Bags.fm token.
            Launch a token on{" "}
            <a
              href="https://bags.fm"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent)] hover:underline"
            >
              bags.fm
            </a>{" "}
            or explore any token below.
          </p>
        </div>
        <ExploreToken />
      </div>
    );
  }

  // ─── Connected with tokens ───
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--text-muted)]">
          Your Tokens ({tokens.length})
        </h3>
        <button
          onClick={fetchTokens}
          className="text-xs text-[var(--text-muted)] hover:text-white transition-colors"
        >
          Refresh
        </button>
      </div>

      {tokens.map((token) => {
        const totalBps = token.claimers.reduce((sum, c) => sum + c.bps, 0);
        const serviceCount = token.managed?.services.length ?? 0;

        return (
          <div key={token.tokenMint} className="card space-y-4">
            {/* Token header */}
            <div className="flex items-start justify-between">
              <div>
                <a
                  href={`/tokens/${token.tokenMint}`}
                  className="text-lg font-bold hover:text-[var(--accent)] transition-colors"
                >
                  {token.tokenMint.slice(0, 6)}...{token.tokenMint.slice(-4)}
                </a>
                <div className="flex items-center gap-4 mt-1 text-xs text-[var(--text-muted)]">
                  <span>Lifetime fees: {formatSol(token.lifetimeFees)}</span>
                  {serviceCount > 0 && (
                    <span className="text-[var(--accent)]">
                      {serviceCount} service{serviceCount > 1 ? "s" : ""} active
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <a
                  href={`/tokens/${token.tokenMint}`}
                  className="px-3 py-2 rounded-lg text-xs font-medium border border-[var(--border)] hover:border-[var(--accent)] transition-colors"
                >
                  Details
                </a>
                <button
                  onClick={() => setShowAddModal(token.tokenMint)}
                  className="gradient-btn px-4 py-2 rounded-lg text-xs font-semibold"
                >
                  + Add Service
                </button>
              </div>
            </div>

            {/* Fee distribution bar */}
            {token.claimers.length > 0 && (
              <div>
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide mb-2">
                  Fee Split
                </p>
                <div className="flex h-4 rounded-full overflow-hidden mb-3">
                  {token.claimers.map((c, i) => {
                    const isTend = token.managed?.services.some(
                      (s) => s.claimerWallet === c.wallet
                    );
                    const tendService = token.managed?.services.find(
                      (s) => s.claimerWallet === c.wallet
                    );
                    const colors = [
                      "bg-slate-500",
                      "bg-[var(--accent-secondary)]",
                      "bg-purple-500",
                      "bg-amber-500",
                      "bg-rose-500",
                    ];
                    return (
                      <div
                        key={i}
                        className={`${isTend ? "bg-[var(--accent)]" : colors[i % colors.length]} transition-all relative group`}
                        style={{
                          width: `${(c.bps / (totalBps || 10000)) * 100}%`,
                        }}
                        title={`${isTend ? tendService?.serviceId : c.username || c.wallet.slice(0, 8)} — ${c.bps} BPS (${(c.bps / 100).toFixed(1)}%)`}
                      />
                    );
                  })}
                </div>

                {/* Legend */}
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {token.claimers.map((c, i) => {
                    const isTend = token.managed?.services.some(
                      (s) => s.claimerWallet === c.wallet
                    );
                    const tendService = token.managed?.services.find(
                      (s) => s.claimerWallet === c.wallet
                    );
                    const colors = [
                      "bg-slate-500",
                      "bg-[var(--accent-secondary)]",
                      "bg-purple-500",
                      "bg-amber-500",
                      "bg-rose-500",
                    ];
                    return (
                      <div key={i} className="flex items-center gap-1.5 text-xs">
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${isTend ? "bg-[var(--accent)]" : colors[i % colors.length]}`}
                        />
                        <span className={isTend ? "text-[var(--accent)] font-medium" : "text-[var(--text-muted)]"}>
                          {isTend
                            ? tendService?.serviceId
                            : c.username || c.wallet.slice(0, 8) + "..."}
                        </span>
                        <span className="font-mono text-[var(--text-muted)]">
                          {(c.bps / 100).toFixed(1)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Active services detail */}
            {token.managed && token.managed.services.length > 0 && (
              <div className="border-t border-[var(--border)] pt-3">
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide mb-2">
                  Active Services
                </p>
                <div className="space-y-2">
                  {token.managed.services.map((s) => (
                    <div
                      key={s.serviceId}
                      className="flex items-center justify-between py-2 px-3 rounded-lg bg-[var(--bg)] text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />
                        <span className="font-medium">{s.serviceId}</span>
                        <span className="text-[var(--text-muted)] font-mono">
                          {s.bps} BPS
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[var(--text-muted)]">
                        <span>
                          {Number(s.stats.totalFeesClaimed) > 0
                            ? formatSol(s.stats.totalFeesClaimed) + " claimed"
                            : "Waiting for fees"}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            s.status === "active"
                              ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                              : "bg-red-500/15 text-red-400"
                          }`}
                        >
                          {s.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* No services CTA */}
            {(!token.managed || token.managed.services.length === 0) && (
              <div className="border-t border-[var(--border)] pt-3 text-center">
                <p className="text-xs text-[var(--text-muted)] mb-2">
                  No AI services yet. Add one to start earning automated returns.
                </p>
                <button
                  onClick={() => setShowAddModal(token.tokenMint)}
                  className="text-xs text-[var(--accent)] hover:underline"
                >
                  Browse services →
                </button>
              </div>
            )}

            {/* Links */}
            <div className="flex items-center gap-3 text-xs border-t border-[var(--border)] pt-3">
              <a
                href={`https://bags.fm/${token.tokenMint}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--accent)] hover:underline"
              >
                Bags.fm
              </a>
              <a
                href={`https://solscan.io/token/${token.tokenMint}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--text-muted)] hover:text-white transition-colors"
              >
                Solscan
              </a>
            </div>
          </div>
        );
      })}

      <ExploreToken />

      {showAddModal && (
        <AddServiceModal
          tokenMint={showAddModal}
          existingServiceIds={
            tokens
              .find((t) => t.tokenMint === showAddModal)
              ?.managed?.services.map((s) => s.serviceId) ?? []
          }
          availableBps={
            tokens.find((t) => t.tokenMint === showAddModal)?.managed
              ?.creatorBps ?? 10_000
          }
          onClose={() => setShowAddModal(null)}
          onAdded={fetchTokens}
        />
      )}
    </div>
  );
}
