"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { ArrowRight, ExternalLink, Gift, Wallet } from "lucide-react";
import type { RewardPayout } from "@tend/shared";

interface EnrichedPayout extends RewardPayout {
  tokenInfo?: { name: string; symbol: string; image?: string };
}

interface MeResponse {
  wallet: string;
  totals: {
    accruedLamports: string;
    paidLamports: string;
    totalPayouts: number;
  };
  payouts: EnrichedPayout[];
}

function formatSol(lamports: number | string | bigint): string {
  const sol = Number(lamports) / 1_000_000_000;
  if (sol >= 1000) return (sol / 1000).toFixed(1) + "K";
  if (sol >= 1) return sol.toFixed(3);
  if (sol > 0) return sol.toFixed(5);
  return "0";
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function MePage() {
  const { publicKey, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const [data, setData] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!connected || !publicKey) {
      setData(null);
      return;
    }
    setLoading(true);
    fetch(`/api/me/rewards?wallet=${publicKey.toBase58()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [connected, publicKey]);

  if (!connected) {
    return (
      <div className="max-w-[720px] mx-auto px-6 py-20">
        <div className="text-center">
          <div className="inline-flex w-14 h-14 rounded-2xl bg-[var(--accent-dim)] items-center justify-center mb-5">
            <Gift className="text-[var(--accent)]" size={24} />
          </div>
          <h1 className="text-[clamp(1.6rem,4vw,2.2rem)] font-bold font-display tracking-tight mb-3">
            Your SOL cashback
          </h1>
          <p className="text-[14px] text-[var(--text-muted)] max-w-[440px] mx-auto mb-8">
            Connect your wallet to see every reward you&apos;ve earned from Tend
            campaigns, with Solscan links for every payout.
          </p>
          <button
            onClick={() => setVisible(true)}
            className="gradient-btn px-6 py-3 rounded-xl text-[14px] font-semibold inline-flex items-center gap-2"
          >
            <Wallet size={15} />
            Connect Wallet
          </button>
        </div>
      </div>
    );
  }

  const paid = data?.totals.paidLamports ?? "0";
  const accrued = data?.totals.accruedLamports ?? "0";
  const totalCount = data?.totals.totalPayouts ?? 0;
  const payouts = data?.payouts ?? [];

  return (
    <div className="max-w-[800px] mx-auto px-6 py-12">
      <p className="text-[11px] text-[var(--accent)] uppercase tracking-[0.15em] font-mono font-semibold mb-2">
        Your rewards
      </p>
      <h1 className="text-[clamp(1.6rem,4vw,2.2rem)] font-bold font-display tracking-tight mb-1">
        Cashback earned
      </h1>
      <p className="text-[13px] text-[var(--text-muted)] font-mono mb-8">
        {publicKey?.toBase58().slice(0, 6)}...{publicKey?.toBase58().slice(-6)}
      </p>

      {/* Totals */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8">
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-5">
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">
            Total paid
          </p>
          <p className="text-2xl font-bold font-mono gradient-text">
            {formatSol(paid)}
          </p>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">SOL</p>
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-5">
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">
            Pending
          </p>
          <p className="text-2xl font-bold font-mono">{formatSol(accrued)}</p>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">SOL</p>
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-5">
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">
            Qualifying events
          </p>
          <p className="text-2xl font-bold font-mono">{totalCount}</p>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">payouts</p>
        </div>
      </div>

      {/* Payouts list */}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-6">
        <p className="text-[11px] text-[var(--accent)] uppercase tracking-[0.15em] font-mono font-semibold mb-4">
          Payout history
        </p>

        {loading ? (
          <div className="space-y-3">
            <div className="h-12 bg-[var(--bg)] rounded-lg shimmer" />
            <div className="h-12 bg-[var(--bg)] rounded-lg shimmer" />
            <div className="h-12 bg-[var(--bg)] rounded-lg shimmer" />
          </div>
        ) : payouts.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-[14px] text-[var(--text-secondary)] mb-2">
              No cashback yet.
            </p>
            <p className="text-[12px] text-[var(--text-muted)] mb-6">
              Pick a live campaign and start trading.
            </p>
            <Link
              href="/campaigns"
              className="gradient-btn px-5 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2"
            >
              Browse campaigns <ArrowRight size={13} />
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {payouts.map((p) => {
              const symbol =
                p.tokenInfo?.symbol ?? p.tokenMint.slice(0, 4).toUpperCase();
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between py-3 gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-9 h-9 rounded-xl bg-[var(--accent-dim)] flex items-center justify-center text-sm font-bold font-display gradient-text flex-shrink-0">
                      {symbol.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/campaigns/${p.tokenMint}${p.campaignType ? `?type=${p.campaignType}` : ""}`}
                          className="font-semibold text-[13px] hover:text-[var(--accent)]"
                        >
                          ${symbol}
                        </Link>
                        <span
                          className={`text-[9px] px-1.5 py-0.5 rounded font-semibold uppercase ${
                            p.status === "paid"
                              ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                              : "bg-[rgba(234,179,8,0.12)] text-[#eab308]"
                          }`}
                        >
                          {p.status}
                        </span>
                      </div>
                      <p className="text-[10px] text-[var(--text-muted)] font-mono">
                        {p.campaignType === "holder"
                          ? "holder snapshot"
                          : `swap ${formatSol(p.swapVolumeLamports)} SOL`}{" "}
                        · {timeAgo(p.createdAt)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="font-mono text-[13px] text-[var(--accent)] font-semibold">
                      +{formatSol(p.rewardLamports)} SOL
                    </p>
                    {p.payoutTxSig && p.payoutTxSig !== "DRY_RUN" && (
                      <a
                        href={`https://solscan.io/tx/${p.payoutTxSig}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-[var(--text-muted)] hover:text-[var(--accent)] inline-flex items-center gap-0.5 font-mono"
                      >
                        tx <ExternalLink size={8} />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
