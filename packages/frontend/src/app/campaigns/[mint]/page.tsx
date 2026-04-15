"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  ArrowLeft,
  ExternalLink,
  Users,
  TrendingUp,
  Zap,
} from "lucide-react";
import type { Campaign, RewardPayout } from "@tend/shared";

interface CampaignDetail {
  campaign: Campaign;
  stats: {
    uniqueTraders: number;
    totalPayouts: number;
    totalPaidLamports: string;
    totalVolumeLamports: string;
  };
  recentPayouts: RewardPayout[];
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

export default function CampaignDetailPage() {
  const params = useParams<{ mint: string }>();
  const mint = params.mint;
  const { publicKey, connected } = useWallet();

  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!mint) return;
    fetch(`/api/campaigns/${mint}`)
      .then((r) => {
        if (r.status === 404) {
          setNotFound(true);
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((d) => d && setDetail(d))
      .catch(() => setNotFound(true));
  }, [mint]);

  if (notFound) {
    return (
      <div className="max-w-[800px] mx-auto px-6 py-20 text-center">
        <p className="text-[var(--text-secondary)] mb-3">Campaign not found.</p>
        <Link
          href="/campaigns"
          className="text-[var(--accent)] hover:underline inline-flex items-center gap-1"
        >
          <ArrowLeft size={13} /> Back to campaigns
        </Link>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="max-w-[800px] mx-auto px-6 py-20">
        <div className="h-8 w-48 bg-[var(--border)] rounded shimmer mb-6" />
        <div className="h-32 bg-[var(--bg-card)] rounded-2xl shimmer mb-4" />
        <div className="h-40 bg-[var(--bg-card)] rounded-2xl shimmer" />
      </div>
    );
  }

  const { campaign, stats, recentPayouts } = detail;
  const symbol =
    campaign.tokenInfo?.symbol ?? campaign.tokenMint.slice(0, 4).toUpperCase();
  const name = campaign.tokenInfo?.name ?? symbol;
  const remaining =
    BigInt(campaign.poolCapLamports) - BigInt(campaign.poolSpentLamports);
  const progress = Math.min(
    100,
    (Number(campaign.poolSpentLamports) / Number(campaign.poolCapLamports)) *
      100
  );
  const isLive = campaign.status === "live";

  const myPayouts = connected
    ? recentPayouts.filter((p) => p.traderWallet === publicKey?.toBase58())
    : [];
  const myEarnedLamports = myPayouts.reduce(
    (sum, p) => sum + BigInt(p.rewardLamports),
    0n
  );

  return (
    <div className="max-w-[800px] mx-auto px-6 py-10">
      <Link
        href="/campaigns"
        className="text-[12px] text-[var(--text-muted)] hover:text-[var(--accent)] inline-flex items-center gap-1 mb-6"
      >
        <ArrowLeft size={12} /> All campaigns
      </Link>

      {/* Header */}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-6 mb-4">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-[var(--accent-dim)] flex items-center justify-center text-2xl font-bold font-display gradient-text">
              {symbol.charAt(0)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold font-display">${symbol}</h1>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg)] text-[var(--text-muted)] font-mono font-semibold tracking-wider border border-[var(--border)]">
                  {campaign.type.toUpperCase()}
                </span>
                {name !== symbol && (
                  <span className="text-[13px] text-[var(--text-muted)]">
                    {name}
                  </span>
                )}
              </div>
              <a
                href={`https://solscan.io/token/${campaign.tokenMint}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-[var(--text-muted)] font-mono hover:text-[var(--accent)] inline-flex items-center gap-1"
              >
                {campaign.tokenMint.slice(0, 6)}...{campaign.tokenMint.slice(-4)}
                <ExternalLink size={9} />
              </a>
            </div>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-full font-semibold uppercase tracking-wider ${
              isLive
                ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                : "bg-[rgba(113,113,122,0.12)] text-[#a1a1aa]"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                isLive
                  ? "bg-[var(--accent)] shadow-[0_0_4px_var(--accent)]"
                  : "bg-[#a1a1aa]"
              }`}
            />
            {campaign.status}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="bg-[var(--bg)] rounded-lg p-3">
            <p className="text-xl font-semibold font-mono gradient-text">
              {campaign.type === "cashback"
                ? `${(campaign.config.cashbackBps / 100).toFixed(1)}%`
                : campaign.type === "holder"
                  ? `${(campaign.config.rewardBps / 100).toFixed(1)}%`
                  : campaign.type === "sprint"
                    ? `${formatSol(campaign.config.bonusLamports)} SOL`
                    : campaign.type === "referral"
                      ? `${(campaign.config.referrerBps / 100).toFixed(1)}%`
                      : "—"}
            </p>
            <p className="text-[10px] text-[var(--text-muted)] mt-0.5 uppercase tracking-wider">
              {campaign.type === "cashback"
                ? "Cashback on buys"
                : campaign.type === "holder"
                  ? `Per snapshot · ${campaign.config.minHoldHours}h min`
                  : campaign.type === "sprint"
                    ? `Flat bonus · ${campaign.config.maxWinners} winners`
                    : "Referral payout"}
            </p>
          </div>
          <div className="bg-[var(--bg)] rounded-lg p-3">
            <p className="text-xl font-semibold font-mono">
              {formatSol(remaining)} SOL
            </p>
            <p className="text-[10px] text-[var(--text-muted)] mt-0.5 uppercase tracking-wider">
              Pool remaining
            </p>
          </div>
          <div className="bg-[var(--bg)] rounded-lg p-3">
            <p className="text-xl font-semibold font-mono">
              {formatSol(campaign.poolCapLamports)} SOL
            </p>
            <p className="text-[10px] text-[var(--text-muted)] mt-0.5 uppercase tracking-wider">
              Pool size
            </p>
          </div>
        </div>

        <div className="h-1.5 w-full bg-[var(--bg)] rounded-full overflow-hidden mb-2">
          <div
            className="h-full bg-[var(--accent)] transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
          <span>{progress.toFixed(1)}% distributed</span>
          <span>{formatSol(campaign.poolSpentLamports)} SOL paid out</span>
        </div>
      </div>

      {/* How to earn + CTA */}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-6 mb-4">
        <p className="text-[11px] text-[var(--accent)] uppercase tracking-[0.15em] font-mono font-semibold mb-3">
          How to earn
        </p>
        {campaign.type === "cashback" ? (
          <p className="text-[14px] text-[var(--text-secondary)] leading-relaxed mb-5">
            Buy ${symbol} on any Solana exchange. The Tend agent detects your
            trade on-chain, runs an AI fraud gate, and pays{" "}
            <span className="text-[var(--accent)] font-semibold">
              {(campaign.config.cashbackBps / 100).toFixed(1)}% cashback
            </span>{" "}
            on the SOL you spent — sent to your wallet within minutes.
          </p>
        ) : campaign.type === "holder" ? (
          <p className="text-[14px] text-[var(--text-secondary)] leading-relaxed mb-5">
            Hold ${symbol} for at least{" "}
            <span className="text-[var(--accent)] font-semibold">
              {campaign.config.minHoldHours}h
            </span>
            . Every {campaign.config.snapshotCronHours}h the Tend agent
            snapshots eligible holders, runs each wallet through the AI fraud
            gate, and pays a pro-rata share of{" "}
            <span className="text-[var(--accent)] font-semibold">
              {(campaign.config.rewardBps / 100).toFixed(1)}% of the pool
            </span>{" "}
            — sent to your wallet within minutes.
          </p>
        ) : campaign.type === "sprint" ? (
          <p className="text-[14px] text-[var(--text-secondary)] leading-relaxed mb-5">
            Be one of the first{" "}
            <span className="text-[var(--accent)] font-semibold">
              {campaign.config.maxWinners}
            </span>{" "}
            wallets to buy at least{" "}
            <span className="text-[var(--accent)] font-semibold">
              {formatSol(campaign.config.minBuyLamports)} SOL
            </span>{" "}
            of ${symbol}. The Tend agent runs an AI fraud gate (snipe bots and
            fresh-wallet farms are rejected) and pays a flat{" "}
            <span className="text-[var(--accent)] font-semibold">
              {formatSol(campaign.config.bonusLamports)} SOL
            </span>{" "}
            bonus to each qualifying winner. One bonus per wallet.
          </p>
        ) : (
          <p className="text-[14px] text-[var(--text-secondary)] leading-relaxed mb-5">
            This campaign type is live on-chain. The Tend agent handles
            eligibility, the AI fraud gate checks every wallet, and payouts
            hit your wallet within minutes.
          </p>
        )}
        {isLive ? (
          <a
            href={`https://jup.ag/swap/SOL-${campaign.tokenMint}`}
            target="_blank"
            rel="noopener noreferrer"
            className="gradient-btn px-6 py-3 rounded-xl text-sm font-semibold inline-flex items-center gap-2"
          >
            <Zap size={14} />
            {campaign.type === "holder"
              ? "Buy & hold on Jupiter"
              : "Trade on Jupiter"}{" "}
            <ExternalLink size={12} />
          </a>
        ) : (
          <p className="text-[12px] text-[var(--text-muted)]">
            This campaign&apos;s pool has been fully distributed.
          </p>
        )}
      </div>

      {/* My earnings (if connected) */}
      {connected && (
        <div
          className="bg-[var(--bg-card)] border rounded-2xl p-6 mb-4"
          style={{ borderColor: "rgba(0, 255, 178, 0.12)" }}
        >
          <p className="text-[11px] text-[var(--accent)] uppercase tracking-[0.15em] font-mono font-semibold mb-3">
            Your rewards on this campaign
          </p>
          {myPayouts.length > 0 ? (
            <div>
              <p className="text-2xl font-bold font-mono gradient-text mb-1">
                {formatSol(myEarnedLamports)} SOL
              </p>
              <p className="text-[12px] text-[var(--text-muted)]">
                from {myPayouts.length} qualifying{" "}
                {campaign.type === "holder"
                  ? myPayouts.length === 1
                    ? "snapshot"
                    : "snapshots"
                  : campaign.type === "sprint"
                    ? myPayouts.length === 1
                      ? "winning buy"
                      : "winning buys"
                    : myPayouts.length === 1
                      ? "trade"
                      : "trades"}
              </p>
            </div>
          ) : (
            <p className="text-[13px] text-[var(--text-muted)]">
              {campaign.type === "holder"
                ? `No rewards yet. Hold $${symbol} for ${campaign.config.minHoldHours}h+ to qualify.`
                : campaign.type === "sprint"
                  ? `No bonus yet. Buy ≥ ${formatSol(campaign.config.minBuyLamports)} SOL of $${symbol} before the sprint fills.`
                  : `No rewards yet. Trade $${symbol} to start earning.`}
            </p>
          )}
        </div>
      )}

      {/* Recent payouts */}
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <TrendingUp size={13} className="text-[var(--accent)]" />
            <p className="text-[11px] text-[var(--accent)] uppercase tracking-[0.15em] font-mono font-semibold">
              Recent payouts
            </p>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)]">
            <span className="inline-flex items-center gap-1">
              <Users size={11} />
              {stats.uniqueTraders}
            </span>
            <span>·</span>
            <span className="font-mono">
              {formatSol(stats.totalPaidLamports)} SOL paid
            </span>
          </div>
        </div>

        {recentPayouts.length === 0 ? (
          <p className="text-[13px] text-[var(--text-muted)] py-6 text-center">
            No payouts yet. Be the first.
          </p>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {recentPayouts.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between py-3 gap-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-mono text-[12px] truncate text-[var(--text-secondary)]">
                      {p.traderWallet.slice(0, 4)}...{p.traderWallet.slice(-4)}
                    </span>
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
                    {campaign.type === "holder"
                      ? "holder snapshot"
                      : `swap ${formatSol(p.swapVolumeLamports)} SOL`}{" "}
                    · {timeAgo(p.createdAt)}
                  </p>
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
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
