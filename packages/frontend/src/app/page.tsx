"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Zap,
  Users,
  TrendingUp,
  Gift,
  Sparkles,
  ShieldCheck,
  Coins,
  Trophy,
} from "lucide-react";
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
        label: "Cashback on every buy",
      };
    case "holder":
      return {
        value: `${(c.config.rewardBps / 100).toFixed(1)}%`,
        label: `Holder reward · ${c.config.minHoldHours}h min`,
      };
    case "sprint": {
      const bonusSol = (Number(c.config.bonusLamports) / 1_000_000_000).toFixed(
        3,
      );
      return {
        value: `${bonusSol} SOL`,
        label: `Bonus · ${c.config.maxWinners} winners`,
      };
    }
  }
}

function CyclingWord({
  words,
  interval = 2200,
}: {
  words: string[];
  interval?: number;
}) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (words.length <= 1) return;
    const t = setInterval(
      () => setIdx((i) => (i + 1) % words.length),
      interval,
    );
    return () => clearInterval(t);
  }, [words, interval]);

  const longest = words.reduce((a, b) => (b.length > a.length ? b : a), "");
  return (
    <span
      className="relative inline-block align-baseline text-right"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="invisible" aria-hidden="true">
        {longest}
      </span>
      {words.map((w, i) => (
        <span
          key={w}
          className={`absolute inset-0 text-right transition-all duration-500 ease-out ${
            i === idx
              ? "opacity-100 translate-y-0"
              : "opacity-0 -translate-y-2 pointer-events-none"
          }`}
          aria-hidden={i !== idx}
        >
          {w}
        </span>
      ))}
    </span>
  );
}

function FeaturedCampaign({ c }: { c: CampaignWithStats }) {
  const progress = poolProgress(c);
  const remaining = BigInt(c.poolCapLamports) - BigInt(c.poolSpentLamports);
  const symbol = c.tokenInfo?.symbol ?? c.tokenMint.slice(0, 4).toUpperCase();
  const name = c.tokenInfo?.name ?? symbol;

  return (
    <Link
      href={`/campaigns/${c.tokenMint}?type=${c.type}`}
      className="block relative overflow-hidden rounded-3xl p-px group"
      style={{
        background:
          "linear-gradient(135deg, rgba(0,255,178,0.35), rgba(0,255,178,0.02) 45%, rgba(0,255,178,0.25))",
      }}
    >
      <div className="relative bg-[var(--bg-card)] rounded-[23px] p-8 md:p-10">
        <div className="absolute -top-20 -right-20 w-[320px] h-[320px] rounded-full blur-[100px] bg-[var(--accent)] opacity-[0.08] pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-2 mb-6">
            <span className="inline-flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-full font-semibold uppercase tracking-wider bg-[var(--accent-dim)] text-[var(--accent)]">
              <Sparkles size={10} />
              Featured
            </span>
            <span
              className={`inline-flex items-center gap-1.5 text-[10px] px-2.5 py-1 rounded-full font-semibold uppercase tracking-wider ${
                c.status === "live"
                  ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                  : "bg-[rgba(234,179,8,0.12)] text-[#eab308]"
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  c.status === "live"
                    ? "bg-[var(--accent)] shadow-[0_0_4px_var(--accent)]"
                    : "bg-[#eab308]"
                }`}
              />
              {c.status === "live" ? "Live now" : c.status}
            </span>
          </div>

          <div className="flex items-start justify-between gap-6 mb-8 flex-wrap">
            <div className="flex items-center gap-4 min-w-0">
              <div className="w-16 h-16 rounded-2xl bg-[var(--accent-dim)] flex items-center justify-center text-3xl font-bold font-display gradient-text flex-shrink-0">
                {symbol.charAt(0)}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-2xl md:text-3xl font-bold font-display truncate">
                    ${symbol}
                  </h2>
                  {name !== symbol && (
                    <span className="text-[14px] text-[var(--text-muted)] truncate">
                      {name}
                    </span>
                  )}
                </div>
                <p className="text-[12px] text-[var(--text-muted)] font-mono">
                  {c.tokenMint.slice(0, 6)}...{c.tokenMint.slice(-6)}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">
                {campaignHeadline(c).label}
              </p>
              <p className="text-4xl md:text-5xl font-bold font-mono gradient-text leading-none">
                {campaignHeadline(c).value}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-6">
            <div className="bg-[var(--bg)] rounded-xl p-4">
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">
                Pool remaining
              </p>
              <p className="text-lg font-semibold font-mono">
                {formatSol(remaining)} SOL
              </p>
            </div>
            <div className="bg-[var(--bg)] rounded-xl p-4">
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">
                Earners
              </p>
              <p className="text-lg font-semibold font-mono">
                {c.stats.uniqueTraders}
              </p>
            </div>
            <div className="bg-[var(--bg)] rounded-xl p-4">
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">
                Paid out
              </p>
              <p className="text-lg font-semibold font-mono gradient-text">
                {formatSol(c.stats.totalPaidLamports)} SOL
              </p>
            </div>
          </div>

          <div className="h-1.5 w-full bg-[var(--bg)] rounded-full overflow-hidden mb-5">
            <div
              className="h-full bg-[var(--accent)] transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>

          <div className="flex items-center justify-between flex-wrap gap-3">
            <p className="text-[12px] text-[var(--text-muted)]">
              {progress.toFixed(1)}% of pool distributed
            </p>
            <span className="gradient-btn px-5 py-2.5 rounded-xl text-[13px] font-semibold inline-flex items-center gap-2">
              View campaign <ArrowRight size={13} />
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

function CampaignCard({ c }: { c: CampaignWithStats }) {
  const progress = poolProgress(c);
  const remaining = BigInt(c.poolCapLamports) - BigInt(c.poolSpentLamports);
  const symbol = c.tokenInfo?.symbol ?? c.tokenMint.slice(0, 4).toUpperCase();

  return (
    <Link
      href={`/campaigns/${c.tokenMint}?type=${c.type}`}
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
            c.status === "live"
              ? "bg-[var(--accent-dim)] text-[var(--accent)]"
              : "bg-[rgba(234,179,8,0.12)] text-[#eab308]"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              c.status === "live"
                ? "bg-[var(--accent)] shadow-[0_0_4px_var(--accent)]"
                : "bg-[#eab308]"
            }`}
          />
          {c.status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-[var(--bg)] rounded-lg p-3">
          <p className="text-lg font-semibold font-mono gradient-text">
            {campaignHeadline(c).value}
          </p>
          <p className="text-[10px] text-[var(--text-muted)] mt-0.5 uppercase tracking-wider">
            {c.type === "cashback"
              ? "Cashback"
              : c.type === "holder"
                ? "Holder"
                : c.type === "sprint"
                  ? "Sprint"
                  : "Referral"}
          </p>
        </div>
        <div className="bg-[var(--bg)] rounded-lg p-3">
          <p className="text-lg font-semibold font-mono">
            {formatSol(remaining)} SOL
          </p>
          <p className="text-[10px] text-[var(--text-muted)] mt-0.5 uppercase tracking-wider">
            Remaining
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
        <span className="inline-flex items-center gap-1">
          <Users size={11} />
          {c.stats.uniqueTraders} earners
        </span>
        <span className="text-[var(--accent)] group-hover:underline font-medium inline-flex items-center gap-1">
          Join <ArrowRight size={11} />
        </span>
      </div>
    </Link>
  );
}

function StatsBar({ stats }: { stats: GlobalStats | null }) {
  const items = [
    {
      label: "SOL paid to traders",
      value: stats ? formatSol(stats.totalPaidLamports) : "—",
      suffix: "SOL",
      icon: Gift,
    },
    {
      label: "Unique earners",
      value: stats ? stats.uniqueEarners.toString() : "—",
      suffix: "wallets",
      icon: Users,
    },
    {
      label: "Live campaigns",
      value: stats ? stats.liveCampaigns.toString() : "—",
      suffix: "active",
      icon: TrendingUp,
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-px rounded-2xl overflow-hidden bg-[var(--border)]">
      {items.map((it) => (
        <div
          key={it.label}
          className="bg-[var(--bg-card)] p-5 flex items-center gap-4"
        >
          <div className="w-10 h-10 rounded-xl bg-[var(--accent-dim)] flex items-center justify-center flex-shrink-0">
            <it.icon size={16} className="text-[var(--accent)]" />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
              {it.label}
            </p>
            <p className="text-xl font-bold font-mono truncate">
              {it.value}{" "}
              <span className="text-[11px] font-normal text-[var(--text-muted)] font-sans">
                {it.suffix}
              </span>
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function HomePage() {
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

  const all = campaigns ?? [];
  const live = all.filter((c) => c.status === "live");
  const featured = live[0] ?? all[0];
  const others = all.filter((c) => c !== featured).slice(0, 3);

  return (
    <div className="max-w-[1080px] mx-auto px-6">
      {/* Hero */}
      <section className="pt-20 pb-10 text-center relative">
        <div className="absolute top-10 left-1/2 -translate-x-1/2 w-[700px] h-[500px] rounded-full blur-[160px] bg-[var(--accent)] opacity-[0.06] pointer-events-none" />

        <div className="relative">
          <div className="inline-flex items-center gap-2 flex-wrap justify-center mb-7">
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--border)] text-[11px] text-[var(--text-muted)] font-mono uppercase tracking-wider">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_6px_var(--accent)]" />
              Live on Solana Mainnet
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[rgba(0,255,178,0.2)] bg-[var(--accent-dim)] text-[11px] text-[var(--accent)] font-mono uppercase tracking-wider">
              <ShieldCheck size={11} />
              AI-protected payouts
            </span>
          </div>

          <h1 className="text-[clamp(2.4rem,5.4vw,4rem)] font-bold font-display tracking-tight leading-[1.05] mb-6 max-w-[820px] mx-auto">
            <CyclingWord words={["Trade", "Hold", "Sprint"]} /> Bags tokens.
            <br />
            Earn <span className="gradient-text">real SOL</span>.
          </h1>

          <div className="text-[17px] text-[var(--text-secondary)] leading-[1.65] max-w-[640px] mx-auto mb-9 space-y-2">
            <p>Creators fund the rewards from their Bags fees.</p>
            <p>
              Three ways to earn: Trade, Hold, Sprint and participate campains.
              All paid in SOL, straight to your wallet.
            </p>
          </div>

          <div className="flex items-center justify-center gap-3 flex-wrap mb-12">
            <Link
              href="/campaigns"
              className="gradient-btn px-7 py-3.5 rounded-xl text-[15px] font-semibold inline-flex items-center gap-2"
            >
              Browse live campaigns
              <ArrowRight size={16} />
            </Link>
            <Link
              href="/creator"
              className="btn-secondary px-7 py-3.5 rounded-xl text-[15px] inline-flex items-center gap-2"
            >
              <Zap size={15} />
              For creators
            </Link>
          </div>

          <StatsBar stats={stats} />
        </div>
      </section>

      {/* Featured campaign */}
      {featured && (
        <section className="pb-8">
          <FeaturedCampaign c={featured} />
        </section>
      )}

      {/* Other campaigns or empty state */}
      <section className="pb-20">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-[11px] text-[var(--accent)] uppercase tracking-[0.15em] font-mono font-semibold mb-1">
              {featured ? "More campaigns" : "Campaigns"}
            </p>
            <h2 className="text-[clamp(1.3rem,3vw,1.8rem)] font-bold font-display tracking-tight">
              {featured ? "All $TEND campaigns" : "Earn SOL on these tokens"}
            </h2>
          </div>
          {all.length > (featured ? 4 : 3) && (
            <Link
              href="/campaigns"
              className="text-sm text-[var(--accent)] hover:underline inline-flex items-center gap-1"
            >
              View all <ArrowRight size={13} />
            </Link>
          )}
        </div>

        {campaigns === null ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="h-44 bg-[var(--bg-card)] rounded-2xl shimmer" />
            <div className="h-44 bg-[var(--bg-card)] rounded-2xl shimmer" />
            <div className="h-44 bg-[var(--bg-card)] rounded-2xl shimmer" />
          </div>
        ) : featured ? (
          others.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {others.map((c) => (
                <CampaignCard key={c.tokenMint} c={c} />
              ))}
            </div>
          ) : (
            <div className="bg-[var(--bg-card)] border border-dashed border-[var(--border)] rounded-2xl p-8 text-center">
              <p className="text-[13px] text-[var(--text-muted)] mb-4">
                Only one live campaign right now. More creators are coming.
              </p>
              <Link
                href="/creator"
                className="text-[13px] text-[var(--accent)] hover:underline inline-flex items-center gap-1"
              >
                Activate a campaign on your token <ArrowRight size={12} />
              </Link>
            </div>
          )
        ) : (
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-10 text-center">
            <div className="inline-flex w-12 h-12 rounded-2xl bg-[var(--accent-dim)] items-center justify-center mb-4">
              <Zap className="text-[var(--accent)]" size={20} />
            </div>
            <p className="text-[15px] text-[var(--text-secondary)] mb-2 font-medium">
              Campaigns warming up.
            </p>
            <p className="text-[12px] text-[var(--text-muted)] mb-6 max-w-[380px] mx-auto">
              Be the first to launch a reward pool on your Bags token and start
              paying real traders.
            </p>
            <Link
              href="/creator"
              className="gradient-btn px-5 py-2.5 rounded-lg text-sm font-semibold inline-flex items-center gap-2"
            >
              Activate a campaign <Zap size={13} />
            </Link>
          </div>
        )}
      </section>

      {/* Campaign types */}
      <section className="pb-20">
        <div className="text-center mb-8">
          <p className="text-[11px] text-[var(--accent)] uppercase tracking-[0.15em] font-mono font-semibold mb-2">
            Three campaign types
          </p>
          <h2 className="text-[clamp(1.4rem,3vw,2rem)] font-bold font-display tracking-tight mb-3">
            Pick the growth loop that fits your token
          </h2>
          <p className="text-[13px] text-[var(--text-muted)] max-w-[540px] mx-auto">
            Every type shares the same fraud gate, the same on-chain payout
            rail, and the same creator console. Mix and match as you grow.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            {
              icon: Gift,
              name: "Cashback",
              tag: "Live",
              live: true,
              desc: "Reward every qualifying buy with a % of the trade back in SOL. Best for steady volume.",
            },
            {
              icon: Coins,
              name: "Holder dividends",
              tag: "Live",
              live: true,
              desc: "Pay holders pro-rata on each snapshot, gated by a minimum hold time. Best for loyalty.",
            },
            {
              icon: Trophy,
              name: "Launch sprint",
              tag: "Live",
              live: true,
              desc: "Flat SOL bonus to the first N qualifying buyers. Best for launch-day momentum.",
            },
          ].map((t) => (
            <div
              key={t.name}
              className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-5 flex flex-col"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="w-10 h-10 rounded-xl bg-[var(--accent-dim)] flex items-center justify-center">
                  <t.icon size={16} className="text-[var(--accent)]" />
                </div>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
                    t.live
                      ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                      : "bg-[rgba(113,113,122,0.12)] text-[#a1a1aa]"
                  }`}
                >
                  {t.tag}
                </span>
              </div>
              <h3 className="text-[15px] font-semibold font-display mb-2">
                {t.name}
              </h3>
              <p className="text-[12px] text-[var(--text-muted)] leading-relaxed">
                {t.desc}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-6 flex items-center justify-center gap-2 text-[12px] text-[var(--text-muted)]">
          <ShieldCheck size={13} className="text-[var(--accent)]" />
          <span>
            Every payout — across all types — passes through the same Claude
            fraud gate before it ships on-chain.
          </span>
        </div>
      </section>

      {/* How it works */}
      <section className="pb-20">
        <p className="text-[11px] text-[var(--accent)] uppercase tracking-[0.15em] font-mono font-semibold mb-2 text-center">
          How it works
        </p>
        <h2 className="text-[clamp(1.4rem,3vw,2rem)] font-bold font-display tracking-tight mb-8 text-center">
          Three steps. No catch.
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-[var(--border)] rounded-2xl overflow-hidden">
          {[
            {
              step: "01",
              title: "Pick a campaign",
              desc: "Browse live campaigns. Each one shows the reward type, rate, and SOL pool remaining.",
            },
            {
              step: "02",
              title: "Trade or hold",
              desc: "Buy or hold the token. The Tend agent watches the chain and collects qualifying events.",
            },
            {
              step: "03",
              title: "Get SOL back",
              desc: "The AI fraud gate clears each payout, then the agent ships SOL to your wallet with a Solscan tx link.",
            },
          ].map((s) => (
            <div key={s.step} className="bg-[var(--bg-card)] p-8">
              <span className="text-[40px] font-bold font-display text-[var(--border-hover)] leading-none">
                {s.step}
              </span>
              <h3 className="text-base font-semibold mt-4 mb-2">{s.title}</h3>
              <p className="text-[14px] text-[var(--text-muted)] leading-relaxed">
                {s.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* For creators callout */}
      <section className="pb-24">
        <div
          className="bg-[var(--bg-card)] border rounded-2xl p-10 text-center relative overflow-hidden"
          style={{ borderColor: "rgba(0, 255, 178, 0.12)" }}
        >
          <div className="absolute -top-20 left-1/2 -translate-x-1/2 w-[500px] h-[300px] rounded-full blur-[120px] bg-[var(--accent)] opacity-[0.05] pointer-events-none" />
          <div className="relative">
            <p className="text-[11px] text-[var(--accent)] uppercase tracking-[0.15em] font-mono font-semibold mb-3">
              For creators
            </p>
            <h2 className="text-[clamp(1.3rem,3vw,1.9rem)] font-bold font-display tracking-tight mb-3">
              Turn your creator fees into real users
            </h2>
            <p className="text-[14px] text-[var(--text-muted)] max-w-[500px] mx-auto mb-6">
              Allocate a slice of your Bags fee-share to a live reward pool.
              Traders earn SOL back when they buy your token — acquisition you
              can see on-chain.
            </p>
            <Link
              href="/creator"
              className="gradient-btn px-6 py-2.5 rounded-lg text-sm font-semibold inline-flex items-center gap-2"
            >
              Launch a campaign <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
