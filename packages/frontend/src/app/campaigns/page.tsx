"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Gift, TrendingUp, Users, Zap } from "lucide-react";
import type { Campaign } from "@tend/shared";

type CampaignWithStats = Campaign & {
  stats: {
    uniqueTraders: number;
    totalPayouts: number;
    totalPaidLamports: string;
  };
};

interface GlobalStats {
  liveCampaigns: number;
  totalCampaigns: number;
  totalPayouts: number;
  totalPaidLamports: string;
  totalVolumeLamports: string;
  uniqueEarners: number;
}

function formatSol(lamports: number | string | bigint): string {
  const sol = Number(lamports) / 1_000_000_000;
  if (sol >= 1000) return (sol / 1000).toFixed(1) + "K";
  if (sol >= 1) return sol.toFixed(2);
  if (sol > 0) return sol.toFixed(4);
  return "0";
}

function poolProgress(c: Campaign): number {
  const cap = Number(c.poolCapLamports);
  if (cap === 0) return 0;
  return Math.min(100, (Number(c.poolSpentLamports) / cap) * 100);
}

function campaignHeadline(c: Campaign): { value: string; label: string } {
  switch (c.type) {
    case "cashback":
      return {
        value: `${(c.config.cashbackBps / 100).toFixed(1)}%`,
        label: "Cashback / buy",
      };
    case "holder":
      return {
        value: `${(c.config.rewardBps / 100).toFixed(1)}%`,
        label: `Holder · ${c.config.minHoldHours}h min`,
      };
    case "sprint": {
      const bonusSol = (
        Number(c.config.bonusLamports) / 1_000_000_000
      ).toFixed(3);
      return {
        value: `${bonusSol} SOL`,
        label: `Bonus · ${c.config.maxWinners} winners`,
      };
    }
    case "referral":
      return {
        value: `${(c.config.referrerBps / 100).toFixed(1)}%`,
        label: "Referral",
      };
  }
}

function campaignTypeBadge(c: Campaign): string {
  switch (c.type) {
    case "cashback":
      return "CASHBACK";
    case "holder":
      return "HOLDER";
    case "sprint":
      return "SPRINT";
    case "referral":
      return "REFERRAL";
  }
}

function CampaignCard({ c }: { c: CampaignWithStats }) {
  const progress = poolProgress(c);
  const remaining =
    BigInt(c.poolCapLamports) - BigInt(c.poolSpentLamports);
  const symbol = c.tokenInfo?.symbol ?? c.tokenMint.slice(0, 4).toUpperCase();
  const isLive = c.status === "live";
  const headline = campaignHeadline(c);
  const typeLabel = campaignTypeBadge(c);

  return (
    <Link
      href={`/campaigns/${c.tokenMint}`}
      className="block bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-5 hover:border-[var(--border-hover)] transition-colors group"
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-[var(--accent-dim)] flex items-center justify-center font-bold font-display gradient-text flex-shrink-0">
            {symbol.charAt(0)}
          </div>
          <div className="min-w-0">
            <p className="font-semibold font-display truncate">${symbol}</p>
            <p className="text-[11px] text-[var(--text-muted)] font-mono truncate">
              {c.tokenMint.slice(0, 4)}...{c.tokenMint.slice(-4)}
            </p>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
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
          {c.status}
        </span>
      </div>

      <div className="mb-3">
        <span className="inline-block text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg)] text-[var(--text-muted)] font-mono font-semibold tracking-wider border border-[var(--border)]">
          {typeLabel}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-[var(--bg)] rounded-lg p-3">
          <p className="text-lg font-semibold font-mono gradient-text">
            {headline.value}
          </p>
          <p className="text-[10px] text-[var(--text-muted)] mt-0.5 uppercase tracking-wider">
            {headline.label}
          </p>
        </div>
        <div className="bg-[var(--bg)] rounded-lg p-3">
          <p className="text-lg font-semibold font-mono">
            {formatSol(remaining)} SOL
          </p>
          <p className="text-[10px] text-[var(--text-muted)] mt-0.5 uppercase tracking-wider">
            Pool left
          </p>
        </div>
      </div>

      <div className="h-1 w-full bg-[var(--bg)] rounded-full overflow-hidden mb-3">
        <div
          className="h-full bg-[var(--accent)] transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <Users size={11} />
            {c.stats.uniqueTraders} earners
          </span>
          <span>·</span>
          <span className="font-mono">
            {formatSol(c.stats.totalPaidLamports)} paid
          </span>
        </div>
        <span className="text-[var(--accent)] group-hover:underline font-medium inline-flex items-center gap-1">
          View <ArrowRight size={11} />
        </span>
      </div>
    </Link>
  );
}

function CampaignSkeleton() {
  return (
    <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-[var(--border)] shimmer" />
        <div className="flex-1">
          <div className="h-4 w-20 bg-[var(--border)] rounded shimmer mb-1" />
          <div className="h-3 w-16 bg-[var(--border)] rounded shimmer" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="h-14 bg-[var(--bg)] rounded-lg shimmer" />
        <div className="h-14 bg-[var(--bg)] rounded-lg shimmer" />
      </div>
      <div className="h-1 w-full bg-[var(--border)] rounded-full shimmer" />
    </div>
  );
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<CampaignWithStats[] | null>(null);
  const [stats, setStats] = useState<GlobalStats | null>(null);

  useEffect(() => {
    fetch("/api/campaigns")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setCampaigns(d?.campaigns ?? []))
      .catch(() => setCampaigns([]));
    fetch("/api/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setStats(d))
      .catch(() => setStats(null));
  }, []);

  const live = (campaigns ?? []).filter((c) => c.status === "live");
  const paused = (campaigns ?? []).filter((c) => c.status === "paused");
  const depleted = (campaigns ?? []).filter((c) => c.status === "depleted");

  const statItems = [
    {
      label: "Live campaigns",
      value: stats ? stats.liveCampaigns.toString() : "—",
      icon: TrendingUp,
    },
    {
      label: "SOL paid out",
      value: stats ? formatSol(stats.totalPaidLamports) : "—",
      icon: Gift,
    },
    {
      label: "Unique earners",
      value: stats ? stats.uniqueEarners.toString() : "—",
      icon: Users,
    },
  ];

  return (
    <div className="max-w-[1080px] mx-auto px-6 py-10">
      <div className="mb-8">
        <p className="text-[11px] text-[var(--accent)] uppercase tracking-[0.15em] font-mono font-semibold mb-2">
          Live campaigns
        </p>
        <h1 className="text-[clamp(1.8rem,4vw,2.6rem)] font-bold font-display tracking-tight mb-2">
          Earn SOL from creator fees
        </h1>
        <p className="text-[14px] text-[var(--text-muted)] max-w-[520px]">
          Pick a campaign, trade the token, earn SOL. Every payout on-chain,
          every wallet vetted by the AI fraud gate.
        </p>
        <p className="text-[11px] text-[var(--text-muted)] max-w-[520px] mt-2">
          Note — if a token ran multiple campaign types, the detail page shows
          the highest-priority entry (live &gt; paused &gt; completed). Past
          payouts from every type stay visible in its history.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-px rounded-2xl overflow-hidden bg-[var(--border)] mb-10">
        {statItems.map((it) => (
          <div key={it.label} className="bg-[var(--bg-card)] p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-[var(--accent-dim)] flex items-center justify-center flex-shrink-0">
              <it.icon size={16} className="text-[var(--accent)]" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
                {it.label}
              </p>
              <p className="text-xl font-bold font-mono">{it.value}</p>
            </div>
          </div>
        ))}
      </div>

      {campaigns === null ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <CampaignSkeleton />
          <CampaignSkeleton />
          <CampaignSkeleton />
        </div>
      ) : campaigns.length === 0 ? (
        <div className="text-center py-16 bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl">
          <p className="text-[var(--text-secondary)] text-sm mb-2">
            No campaigns yet.
          </p>
          <p className="text-[var(--text-muted)] text-xs mb-5">
            Be the first creator to activate Tend on your Bags token.
          </p>
          <Link
            href="/creator"
            className="gradient-btn px-5 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2"
          >
            Activate a campaign <Zap size={13} />
          </Link>
        </div>
      ) : (
        <>
          {live.length > 0 && (
            <div className="mb-10">
              <div className="flex items-center gap-2 mb-4">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_6px_var(--accent)]" />
                <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Live now ({live.length})
                </h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {live.map((c) => (
                  <CampaignCard key={`${c.tokenMint}-${c.type}`} c={c} />
                ))}
              </div>
            </div>
          )}

          {paused.length > 0 && (
            <div className="mb-10">
              <div className="flex items-center gap-2 mb-4">
                <span className="w-1.5 h-1.5 rounded-full bg-[#eab308]" />
                <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Paused ({paused.length})
                </h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {paused.map((c) => (
                  <CampaignCard key={`${c.tokenMint}-${c.type}`} c={c} />
                ))}
              </div>
            </div>
          )}

          {depleted.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-4">
                <span className="w-1.5 h-1.5 rounded-full bg-[#a1a1aa]" />
                <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                  Completed ({depleted.length})
                </h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {depleted.map((c) => (
                  <CampaignCard key={`${c.tokenMint}-${c.type}`} c={c} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
