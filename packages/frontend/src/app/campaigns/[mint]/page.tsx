"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  ArrowLeft,
  ExternalLink,
  Users,
  TrendingUp,
  Shield,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import type { Campaign, RewardPayout, FraudDecision } from "@tend/shared";
import { JupiterSwap } from "@/components/jupiter-swap";
import { PriceChart } from "@/components/price-chart";

interface CampaignDetail {
  campaign: Campaign;
  stats: {
    uniqueTraders: number;
    totalPayouts: number;
    totalPaidLamports: string;
    totalVolumeLamports: string;
  };
  recentPayouts: RewardPayout[];
  fraudDecisions?: FraudDecision[];
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
  const searchParams = useSearchParams();
  const mint = params.mint;
  const campaignType = searchParams.get("type");
  const { publicKey, connected } = useWallet();

  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [showAllFraud, setShowAllFraud] = useState(false);

  useEffect(() => {
    if (!mint) return;
    const qs = campaignType ? `?type=${campaignType}` : "";
    fetch(`/api/campaigns/${mint}${qs}`)
      .then((r) => {
        if (r.status === 404) {
          setNotFound(true);
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((d) => d && setDetail(d))
      .catch(() => setNotFound(true));
  }, [mint, campaignType]);

  if (notFound) {
    return (
      <div className="max-w-[900px] mx-auto px-6 py-20 text-center">
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
      <div className="max-w-[1280px] mx-auto px-6 py-10">
        <div className="h-16 bg-[var(--bg-card)] rounded-2xl shimmer mb-4" />
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
          <div className="h-[420px] bg-[var(--bg-card)] rounded-2xl shimmer" />
          <div className="h-[420px] bg-[var(--bg-card)] rounded-2xl shimmer" />
        </div>
      </div>
    );
  }

  const { campaign, stats, recentPayouts, fraudDecisions = [] } = detail;
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

  const visibleFraud = showAllFraud
    ? fraudDecisions
    : fraudDecisions.slice(0, 3);

  return (
    <div className="max-w-[1280px] mx-auto px-6 py-6">
      {/* Top bar: back + token identity + stats inline */}
      <div className="flex items-center gap-4 mb-4">
        <Link
          href="/campaigns"
          className="text-[var(--text-muted)] hover:text-[var(--accent)] flex-shrink-0"
        >
          <ArrowLeft size={16} />
        </Link>

        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-[var(--accent-dim)] flex items-center justify-center text-lg font-bold font-display gradient-text flex-shrink-0">
            {symbol.charAt(0)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold font-display">${symbol}</h1>
              {name !== symbol && (
                <span className="text-[13px] text-[var(--text-muted)] truncate">
                  {name}
                </span>
              )}
              <span
                className={`inline-flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
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
            <a
              href={`https://solscan.io/token/${campaign.tokenMint}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-[var(--text-muted)] font-mono hover:text-[var(--accent)] inline-flex items-center gap-1"
            >
              {campaign.tokenMint.slice(0, 6)}...
              {campaign.tokenMint.slice(-4)}
              <ExternalLink size={9} />
            </a>
          </div>
        </div>

        {/* Inline stats */}
        <div className="hidden md:flex items-center gap-6 flex-shrink-0">
          <div className="text-right">
            <p className="text-lg font-semibold font-mono gradient-text leading-tight">
              {campaign.type === "cashback"
                ? `${(campaign.config.cashbackBps / 100).toFixed(1)}%`
                : campaign.type === "holder"
                  ? `${(campaign.config.rewardBps / 100).toFixed(1)}%`
                  : `${formatSol(campaign.config.bonusLamports)} SOL`}
            </p>
            <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">
              {campaign.type === "cashback"
                ? "Cashback"
                : campaign.type === "holder"
                  ? "Per snapshot"
                  : "Bonus"}
            </p>
          </div>
          <div className="w-px h-8 bg-[var(--border)]" />
          <div className="text-right">
            <p className="text-lg font-semibold font-mono leading-tight">
              {formatSol(remaining)}
            </p>
            <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">
              SOL left
            </p>
          </div>
          <div className="w-px h-8 bg-[var(--border)]" />
          <div className="text-right">
            <p className="text-lg font-semibold font-mono leading-tight">
              {stats.uniqueTraders}
            </p>
            <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">
              Traders
            </p>
          </div>
        </div>
      </div>

      {/* Pool progress — thin, full width */}
      <div className="mb-4">
        <div className="h-1 w-full bg-[var(--bg-card)] rounded-full overflow-hidden">
          <div
            className="h-full bg-[var(--accent)] transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] mt-1">
          <span>{progress.toFixed(1)}% distributed</span>
          <span>
            {formatSol(campaign.poolSpentLamports)} /{" "}
            {formatSol(campaign.poolCapLamports)} SOL
          </span>
        </div>
      </div>

      {/* Main: chart (large) + swap (sidebar) */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4 mb-4">
        {/* Chart — takes most of the width */}
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-4 min-h-[420px]">
          <PriceChart mint={campaign.tokenMint} />
        </div>

        {/* Swap panel */}
        <div className="space-y-3">
          {/* Earn banner — the hook */}
          <div className="rounded-2xl p-4 border border-[rgba(0,255,178,0.2)] bg-[rgba(0,255,178,0.04)]">
            <div className="flex items-center gap-3 mb-1.5">
              <span className="text-3xl font-bold font-mono gradient-text leading-none">
                {campaign.type === "cashback"
                  ? `${(campaign.config.cashbackBps / 100).toFixed(0)}%`
                  : campaign.type === "holder"
                    ? `${(campaign.config.rewardBps / 100).toFixed(0)}%`
                    : `${formatSol(campaign.config.bonusLamports)} SOL`}
              </span>
              <span className="text-[13px] text-[var(--text-secondary)] font-semibold leading-tight">
                {campaign.type === "cashback"
                  ? "cashback on every buy"
                  : campaign.type === "holder"
                    ? "rewards per snapshot"
                    : "bonus per winner"}
              </span>
            </div>
            <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
              {campaign.type === "cashback"
                ? `Buy $${symbol} below → get SOL back in your wallet within minutes. AI fraud gate protects every payout.`
                : campaign.type === "holder"
                  ? `Hold $${symbol} for ${campaign.config.minHoldHours}h+ to qualify. Snapshots every ${campaign.config.snapshotCronHours}h. AI fraud gate protects every payout.`
                  : `${campaign.config.maxWinners} spots left. Buy ≥ ${formatSol(campaign.config.minBuyLamports)} SOL below to qualify. AI fraud gate protects every payout.`}
            </p>
            <div className="flex items-center gap-3 mt-2 text-[10px] font-mono text-[var(--text-muted)]">
              <span>{formatSol(remaining)} SOL left in pool</span>
              <span>·</span>
              <span>{stats.uniqueTraders} traders</span>
            </div>
          </div>

          {/* My rewards (if connected) */}
          {connected && myPayouts.length > 0 && (
            <div className="flex items-center justify-between rounded-xl p-3 bg-[var(--bg-card)] border border-[var(--border)]">
              <p className="text-[11px] text-[var(--text-muted)]">
                Your rewards
              </p>
              <p className="font-mono text-[var(--accent)] font-semibold text-[14px]">
                +{formatSol(myEarnedLamports)} SOL
              </p>
            </div>
          )}

          {/* Swap */}
          {isLive && (
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-4">
              <JupiterSwap outputMint={campaign.tokenMint} />
            </div>
          )}
        </div>
      </div>

      {/* Bottom row: fraud gate + recent payouts side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* AI Fraud Gate — compact table */}
        {fraudDecisions.length > 0 && (
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Shield size={12} className="text-[var(--accent)]" />
                <p className="text-[10px] text-[var(--accent)] uppercase tracking-[0.15em] font-mono font-semibold">
                  AI fraud gate
                </p>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] font-mono">
                {fraudDecisions.filter((d) => d.decision === "allow").length}{" "}
                allowed ·{" "}
                {fraudDecisions.filter((d) => d.decision !== "allow").length}{" "}
                blocked
              </p>
            </div>

            <div className="space-y-1.5">
              {visibleFraud.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-[var(--bg)] text-[12px]"
                >
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase flex-shrink-0 ${
                      d.decision === "allow"
                        ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                        : d.decision === "reject"
                          ? "bg-[rgba(239,68,68,0.12)] text-[#ef4444]"
                          : "bg-[rgba(234,179,8,0.12)] text-[#eab308]"
                    }`}
                  >
                    {d.decision}
                  </span>
                  <span className="font-mono text-[var(--text-secondary)] flex-shrink-0">
                    {d.traderWallet.slice(0, 4)}...{d.traderWallet.slice(-4)}
                  </span>
                  <span className="text-[var(--text-muted)] truncate flex-1 text-[11px] italic">
                    {d.reasoning}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)] font-mono flex-shrink-0">
                    {timeAgo(d.checkedAt)}
                  </span>
                </div>
              ))}
            </div>

            {fraudDecisions.length > 3 && (
              <button
                onClick={() => setShowAllFraud((v) => !v)}
                className="flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--accent)] mt-2 mx-auto"
              >
                {showAllFraud ? (
                  <>
                    Show less <ChevronUp size={12} />
                  </>
                ) : (
                  <>
                    Show {fraudDecisions.length - 3} more{" "}
                    <ChevronDown size={12} />
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {/* Recent payouts — compact */}
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TrendingUp size={12} className="text-[var(--accent)]" />
              <p className="text-[10px] text-[var(--accent)] uppercase tracking-[0.15em] font-mono font-semibold">
                Recent payouts
              </p>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
              <Users size={10} />
              <span className="font-mono">
                {stats.uniqueTraders} traders ·{" "}
                {formatSol(stats.totalPaidLamports)} SOL
              </span>
            </div>
          </div>

          {recentPayouts.length === 0 ? (
            <p className="text-[12px] text-[var(--text-muted)] py-4 text-center">
              No payouts yet. Be the first.
            </p>
          ) : (
            <div className="space-y-1.5">
              {recentPayouts.slice(0, 8).map((p) => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-[var(--bg)] text-[12px]"
                >
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase flex-shrink-0 ${
                      p.status === "paid"
                        ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                        : "bg-[rgba(234,179,8,0.12)] text-[#eab308]"
                    }`}
                  >
                    {p.status}
                  </span>
                  <span className="font-mono text-[var(--text-secondary)] flex-shrink-0">
                    {p.traderWallet.slice(0, 4)}...{p.traderWallet.slice(-4)}
                  </span>
                  <span className="text-[var(--text-muted)] flex-1 text-[11px] font-mono">
                    {campaign.type === "holder"
                      ? "snapshot"
                      : `${formatSol(p.swapVolumeLamports)} SOL`}
                  </span>
                  <span className="font-mono text-[var(--accent)] font-semibold flex-shrink-0">
                    +{formatSol(p.rewardLamports)}
                  </span>
                  {p.payoutTxSig && p.payoutTxSig !== "DRY_RUN" ? (
                    <a
                      href={`https://solscan.io/tx/${p.payoutTxSig}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-[var(--text-muted)] hover:text-[var(--accent)] flex-shrink-0"
                    >
                      <ExternalLink size={10} />
                    </a>
                  ) : (
                    <span className="w-[10px] flex-shrink-0" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
