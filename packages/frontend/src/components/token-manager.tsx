"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import type { ManagedToken } from "@tend/shared";
import { ServiceCard } from "./service-card";
import { FeeFlow } from "./fee-flow";
import { AddServiceModal } from "./add-service-modal";

interface TokenData {
  tokens: ManagedToken[];
  adminMints: string[];
}

export function TokenManager() {
  const { publicKey, connected } = useWallet();
  const [data, setData] = useState<TokenData>({ tokens: [], adminMints: [] });
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState<string | null>(null);
  const [tokenMintInput, setTokenMintInput] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);

  const fetchTokens = useCallback(async () => {
    setLoading(true);
    try {
      const wallet = publicKey?.toBase58() ?? "";
      const res = await fetch(`/api/tokens?wallet=${wallet}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {
      // Silent
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  const handleRemoveService = async (
    tokenMint: string,
    serviceId: string
  ) => {
    setRemoving(`${tokenMint}:${serviceId}`);
    try {
      const res = await fetch("/api/services/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenMint, serviceId }),
      });
      if (res.ok) {
        await fetchTokens();
      }
    } catch {
      // Silent
    } finally {
      setRemoving(null);
    }
  };

  if (!connected) {
    return (
      <div className="card text-center py-16 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-[var(--accent)]/5 to-transparent pointer-events-none" />
        <div className="relative z-10">
          <div className="w-16 h-16 rounded-2xl bg-[var(--accent)]/10 flex items-center justify-center text-3xl mx-auto mb-5">
            ⚡
          </div>
          <h3 className="text-xl font-bold mb-2">Connect your wallet</h3>
          <p className="text-sm text-[var(--text-muted)] max-w-md mx-auto leading-relaxed">
            Connect your Solana wallet to manage AI services on your Bags.fm
            tokens. Fee-sharing becomes a payment rail for autonomous services.
          </p>
          <div className="flex items-center justify-center gap-6 mt-6 text-xs text-[var(--text-muted)]">
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
              Revocable anytime
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Add token by mint */}
      <div className="card">
        <h3 className="text-sm font-semibold mb-3">Manage a Token</h3>
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Enter token mint address..."
            value={tokenMintInput}
            onChange={(e) => setTokenMintInput(e.target.value)}
            className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-2 text-sm font-mono text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
          />
          <button
            onClick={() => {
              if (tokenMintInput.trim()) {
                setShowAddModal(tokenMintInput.trim());
              }
            }}
            disabled={!tokenMintInput.trim()}
            className="px-6 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-40"
            style={{
              background:
                "linear-gradient(135deg, var(--accent), var(--accent-secondary))",
              color: "white",
            }}
          >
            Add Service
          </button>
        </div>

        {data.adminMints.length > 0 && (
          <div className="mt-3">
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide mb-2">
              Your admin tokens
            </p>
            <div className="flex flex-wrap gap-2">
              {data.adminMints.map((mint) => (
                <button
                  key={mint}
                  onClick={() => {
                    setTokenMintInput(mint);
                    setShowAddModal(mint);
                  }}
                  className="text-xs font-mono px-3 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] hover:border-[var(--accent)] transition-colors"
                >
                  {mint.slice(0, 8)}...{mint.slice(-4)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Managed tokens list */}
      {loading && data.tokens.length === 0 && (
        <div className="card text-center py-8">
          <p className="text-sm text-[var(--text-muted)]">
            Loading tokens...
          </p>
        </div>
      )}

      {data.tokens.length === 0 && !loading && (
        <div className="card text-center py-12">
          <p className="text-lg font-semibold mb-2">No tokens managed yet</p>
          <p className="text-sm text-[var(--text-muted)]">
            Enter a token mint address above and add your first AI service.
          </p>
        </div>
      )}

      {data.tokens.map((token) => (
        <div
          key={token.tokenMint}
          className="space-y-4 pb-6 border-b border-[var(--border)] last:border-0"
        >
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">
                <a
                  href={`/tokens/${token.tokenMint}`}
                  className="hover:text-[var(--accent)] transition-colors"
                >
                  {token.tokenMint.slice(0, 12)}...
                </a>
              </h3>
              <p className="text-xs text-[var(--text-muted)]">
                {token.services.length} service(s) | Creator:{" "}
                {(token.creatorBps / 100).toFixed(1)}%
              </p>
            </div>
            <button
              onClick={() => setShowAddModal(token.tokenMint)}
              className="text-xs px-4 py-2 rounded-lg border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10 transition-colors"
            >
              + Add Service
            </button>
          </div>

          <FeeFlow token={token} />

          <div className="grid grid-cols-2 gap-4">
            {token.services.map((service) => (
              <div key={service.serviceId} className="relative group">
                <ServiceCard service={service} />
                <button
                  onClick={() =>
                    handleRemoveService(token.tokenMint, service.serviceId)
                  }
                  disabled={
                    removing ===
                    `${token.tokenMint}:${service.serviceId}`
                  }
                  className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 text-xs px-2 py-1 rounded bg-[var(--danger)]/20 text-[var(--danger)] hover:bg-[var(--danger)]/30 transition-all"
                >
                  {removing ===
                  `${token.tokenMint}:${service.serviceId}`
                    ? "..."
                    : "Remove"}
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Add service modal */}
      {showAddModal && (
        <AddServiceModal
          tokenMint={showAddModal}
          existingServiceIds={
            data.tokens
              .find((t) => t.tokenMint === showAddModal)
              ?.services.map((s) => s.serviceId) ?? []
          }
          availableBps={
            data.tokens.find((t) => t.tokenMint === showAddModal)
              ?.creatorBps ?? 10_000
          }
          onClose={() => setShowAddModal(null)}
          onAdded={fetchTokens}
        />
      )}
    </div>
  );
}
