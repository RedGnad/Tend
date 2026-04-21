"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import { provisionSquadsCustody } from "@/lib/provision-squads";
import {
  ArrowRight,
  Coins,
  Sparkles,
  Shield,
  Zap,
  Gift,
  Trophy,
  CheckCircle,
  Loader2,
  Repeat,
  Wallet,
  Settings,
  Bot,
} from "lucide-react";
import type { Campaign } from "@tend/shared";

function formatSol(lamports: number | string | bigint): string {
  const sol = Number(lamports) / 1_000_000_000;
  if (sol >= 1000) return (sol / 1000).toFixed(1) + "K";
  if (sol >= 1) return sol.toFixed(2);
  if (sol > 0) return sol.toFixed(4);
  return "0";
}

// Inlined to keep the client bundle free of node:crypto.
// Keep in sync with buildAuthMessage in packages/shared/src/wallet-auth.ts.
function buildAuthMessage(p: {
  action: string;
  mint: string;
  type: string;
  timestampMs: number;
}): string {
  return `tend:${p.action}:${p.mint}:${p.type}:${p.timestampMs}`;
}

type CreateStep =
  | "idle"
  | "fetching"
  | "prov-signing"
  | "prov-preparing"
  | "prov-sending"
  | "prov-confirming"
  | "prov-submitting";

type RouteStep =
  | "idle"
  | "preparing"
  | "signing"
  | "sending"
  | "confirming";

type CampaignType = "cashback" | "holder" | "sprint";

type MyCampaign = Campaign & {
  stats: {
    uniqueTraders: number;
    totalPayouts: number;
    totalPaidLamports: string;
    feesClaimedLamports: string;
    feeClaimCount: number;
    lastFeeClaimAt: number | null;
  };
};

interface FormState {
  tokenMint: string;
  type: CampaignType;
  poolCapSol: string;
  cashbackPct: string;
  cashbackMinSwapSol: string;
  rewardPct: string;
  minHoldHours: string;
  snapshotHours: string;
  bonusSol: string;
  maxWinners: string;
  minBuySol: string;
}

const DEFAULTS: FormState = {
  tokenMint: "",
  type: "cashback",
  poolCapSol: "0.05",
  cashbackPct: "2",
  cashbackMinSwapSol: "0.01",
  rewardPct: "1",
  minHoldHours: "1",
  snapshotHours: "2",
  bonusSol: "0.005",
  maxWinners: "5",
  minBuySol: "0.01",
};

const TYPE_INFO: Record<
  CampaignType,
  { icon: typeof Gift; label: string; tagline: string }
> = {
  cashback: {
    icon: Gift,
    label: "Cashback",
    tagline: "Reward every qualifying buy with SOL back",
  },
  holder: {
    icon: Coins,
    label: "Holder dividends",
    tagline: "Pay holders pro-rata on each snapshot",
  },
  sprint: {
    icon: Trophy,
    label: "Launch sprint",
    tagline: "Flat SOL bonus to first N buyers",
  },
};

export default function CreatorPage() {
  const { publicKey, connected, signMessage, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();

  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<CreateStep>("idle");
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Live trust-signal stats — builds confidence for new creators
  const [trustStats, setTrustStats] = useState<{
    totalPaidLamports: string;
    liveCampaigns: number;
    uniqueEarners: number;
  } | null>(null);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setTrustStats({
          totalPaidLamports: d.totalPaidLamports ?? "0",
          liveCampaigns: d.liveCampaigns ?? 0,
          uniqueEarners: d.uniqueEarners ?? 0,
        });
      })
      .catch(() => {});
  }, []);

  // Campaigns owned by the connected wallet — only rendered when length > 0,
  // so a non-creator (or disconnected) visitor never sees a flicker.
  const [myCampaigns, setMyCampaigns] = useState<MyCampaign[]>([]);

  useEffect(() => {
    if (!connected || !publicKey) {
      setMyCampaigns([]);
      return;
    }
    const wallet = publicKey.toBase58();
    let cancelled = false;
    fetch(`/api/me/campaigns?wallet=${wallet}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        setMyCampaigns(d?.campaigns ?? []);
      })
      .catch(() => {
        if (!cancelled) setMyCampaigns([]);
      });
    return () => {
      cancelled = true;
    };
  }, [connected, publicKey]);

  // Fee-share routing — optional follow-up after campaign create
  const [routeBps, setRouteBps] = useState("10"); // % of fee-share to Tend
  const [routing, setRouting] = useState(false);
  const [routeStep, setRouteStep] = useState<RouteStep>("idle");
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeDone, setRouteDone] = useState(false);
  const [routeSigs, setRouteSigs] = useState<string[]>([]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
    setSuccess(false);
  }

  async function handleRouteFees() {
    if (!connected || !publicKey || !signMessage || !sendTransaction) {
      setVisible(true);
      return;
    }
    const tokenMint = form.tokenMint.trim();
    if (!tokenMint) {
      setRouteError("Token mint missing");
      return;
    }
    const pct = parseFloat(routeBps);
    if (!Number.isFinite(pct) || pct < 0.01 || pct > 50) {
      setRouteError("Route % must be between 0.01 and 50");
      return;
    }
    const tendBps = Math.round(pct * 100);

    setRouting(true);
    setRouteError(null);
    try {
      // 1. Sign auth message
      setRouteStep("signing");
      const timestampMs = Date.now();
      const message = buildAuthMessage({
        action: "route-fees",
        mint: tokenMint,
        type: "_", // unused for fee-share routing, kept for message-format parity
        timestampMs,
      });
      const sigBytes = await signMessage(new TextEncoder().encode(message));

      // 2. Ask agent to assemble REPLACE-semantics txs
      setRouteStep("preparing");
      const prepRes = await fetch("/api/campaigns/fee-share/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenMint,
          message,
          signature: bs58.encode(sigBytes),
          publicKey: publicKey.toBase58(),
          tendBps,
        }),
      });
      const prepData = await prepRes.json().catch(() => ({}));
      if (!prepRes.ok) {
        throw new Error(prepData.error || `Failed to prepare (${prepRes.status})`);
      }
      const txs: Array<{ transaction: string; blockhash: string }> = Array.isArray(
        prepData.transactions
      )
        ? prepData.transactions
        : [];
      if (txs.length === 0) {
        throw new Error("Agent returned no transactions");
      }

      // 3. Sign + send each tx with the connected wallet (creator pays fees)
      const sigs: string[] = [];
      for (const { transaction } of txs) {
        setRouteStep("sending");
        const tx = VersionedTransaction.deserialize(
          Buffer.from(transaction, "base64")
        );
        const sig = await sendTransaction(tx, connection);
        setRouteStep("confirming");
        const latest = await connection.getLatestBlockhash("confirmed");
        await connection.confirmTransaction(
          {
            signature: sig,
            blockhash: latest.blockhash,
            lastValidBlockHeight: latest.lastValidBlockHeight,
          },
          "confirmed"
        );
        sigs.push(sig);
      }
      setRouteSigs(sigs);
      setRouteDone(true);
    } catch (e) {
      setRouteError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setRouteStep("idle");
      setRouting(false);
    }
  }

  async function handleSubmit() {
    if (!connected || !publicKey || !signMessage || !sendTransaction) {
      setVisible(true);
      return;
    }

    const tokenMint = form.tokenMint.trim();
    if (!tokenMint || tokenMint.length < 32) {
      setError("Enter a valid token mint address");
      return;
    }
    try {
      new PublicKey(tokenMint);
    } catch {
      setError("Token mint is not a valid Solana address");
      return;
    }

    const poolCapSol = parseFloat(form.poolCapSol);
    if (!Number.isFinite(poolCapSol) || poolCapSol < 0.001) {
      setError("Pool must be at least 0.001 SOL");
      return;
    }
    const lamports = Math.round(poolCapSol * 1_000_000_000);

    // Type-specific validation + config
    const config: Record<string, number | string> = {};
    if (form.type === "cashback") {
      const bps = Math.round(parseFloat(form.cashbackPct) * 100);
      if (!Number.isFinite(bps) || bps < 1 || bps > 2000) {
        setError("Cashback must be between 0.01% and 20%");
        return;
      }
      config.cashbackBps = bps;
      const minSwapSol = parseFloat(form.cashbackMinSwapSol);
      if (!Number.isFinite(minSwapSol) || minSwapSol < 0) {
        setError("Min swap volume must be ≥ 0 SOL");
        return;
      }
      if (minSwapSol > 0) {
        config.minSwapLamports = Math.round(
          minSwapSol * 1_000_000_000
        ).toString();
      }
    } else if (form.type === "holder") {
      const bps = Math.round(parseFloat(form.rewardPct) * 100);
      const minHold = parseFloat(form.minHoldHours);
      const snap = parseFloat(form.snapshotHours);
      if (!Number.isFinite(bps) || bps < 1 || bps > 2000) {
        setError("Reward rate must be between 0.01% and 20%");
        return;
      }
      if (!Number.isFinite(minHold) || minHold < 0) {
        setError("Min hold hours must be ≥ 0");
        return;
      }
      if (!Number.isFinite(snap) || snap < 1) {
        setError("Snapshot interval must be ≥ 1 hour");
        return;
      }
      config.rewardBps = bps;
      config.minHoldHours = minHold;
      config.snapshotCronHours = snap;
    } else if (form.type === "sprint") {
      const bonusSol = parseFloat(form.bonusSol);
      const maxWinners = parseInt(form.maxWinners);
      const minBuySol = parseFloat(form.minBuySol);
      if (!Number.isFinite(bonusSol) || bonusSol <= 0) {
        setError("Bonus per winner must be > 0");
        return;
      }
      if (!Number.isFinite(maxWinners) || maxWinners < 1) {
        setError("Max winners must be ≥ 1");
        return;
      }
      if (!Number.isFinite(minBuySol) || minBuySol <= 0) {
        setError("Min buy must be > 0");
        return;
      }
      config.bonusLamports = Math.round(bonusSol * 1_000_000_000).toString();
      config.maxWinners = maxWinners;
      config.minBuyLamports = Math.round(minBuySol * 1_000_000_000).toString();
    }

    setSubmitting(true);
    setError(null);

    try {
      // Pre-flight: refuse before the user signs when a live or paused
      // campaign of the same (mint, type) already exists. The agent re-checks
      // this server-side, but surfacing it here avoids a wallet popup only
      // to see it fail.
      setStep("fetching");
      const listRes = await fetch("/api/campaigns");
      const listData = await listRes.json().catch(() => ({}));
      const existing: Array<{
        tokenMint: string;
        type: string;
        status: string;
        creatorWallet: string;
      }> = Array.isArray(listData.campaigns) ? listData.campaigns : [];
      const conflict = existing.find(
        (c) =>
          c.tokenMint === tokenMint &&
          c.type === form.type &&
          (c.status === "live" || c.status === "paused")
      );
      if (conflict) {
        const owner =
          conflict.creatorWallet === publicKey.toBase58()
            ? "you"
            : `${conflict.creatorWallet.slice(0, 4)}…${conflict.creatorWallet.slice(-4)}`;
        throw new Error(
          `A ${form.type} campaign on this mint is already ${conflict.status} (created by ${owner}). Pause or wait for it to deplete before creating a new one.`
        );
      }

      // Single provision flow: one signMessage + one merged tx that creates
      // the Squads multisig, attaches the SpendingLimit, and funds the vault.
      // The agent persists the campaign row only after the tx confirms, so a
      // cancelled signature leaves no orphan state.
      await provisionSquadsCustody({
        tokenMint,
        type: form.type,
        publicKeyB58: publicKey.toBase58(),
        capLamports: BigInt(lamports),
        period: "day",
        fundLamports: BigInt(lamports),
        campaignConfig: config,
        connection,
        signMessage,
        sendTransaction,
        onStep: (s) => setStep(`prov-${s}` as CreateStep),
      });
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setStep("idle");
      setSubmitting(false);
    }
  }

  const TypeIcon = TYPE_INFO[form.type].icon;

  return (
    <div className="max-w-[960px] mx-auto px-6 py-16">
      {/* Hero */}
      <section className="text-center relative mb-16">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[400px] rounded-full blur-[140px] bg-[var(--accent)] opacity-[0.05] pointer-events-none" />
        <div className="relative">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--border)] text-[11px] text-[var(--text-muted)] font-mono uppercase tracking-wider mb-6">
            <Sparkles size={11} className="text-[var(--accent)]" />
            For Bags creators
          </div>
          <h1 className="text-[clamp(2rem,5vw,3.2rem)] font-bold font-display tracking-tight leading-[1.08] mb-5 max-w-[760px] mx-auto">
            Turn your creator fees into{" "}
            <span className="gradient-text">real buyers</span>.
          </h1>
          <p className="text-[16px] text-[var(--text-secondary)] leading-relaxed max-w-[580px] mx-auto mb-10">
            Allocate a slice of your Bags fee-share to a reward pool. Three
            live campaign types, one AI fraud gate, every payout auditable
            on-chain.
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <a
              href="#create"
              className="gradient-btn px-6 py-3 rounded-xl text-[14px] font-semibold inline-flex items-center gap-2"
            >
              Launch a campaign <ArrowRight size={14} />
            </a>
            <Link
              href="/campaigns"
              className="btn-secondary px-6 py-3 rounded-xl text-[14px] inline-flex items-center gap-2"
            >
              See live campaigns
            </Link>
          </div>
        </div>
      </section>

      {/* Trust band — real numbers from live state */}
      {trustStats && Number(trustStats.totalPaidLamports) > 0 && (
        <section className="mb-12">
          <div className="bg-[var(--bg-card)] border border-[rgba(0,255,178,0.15)] rounded-2xl p-5 grid grid-cols-3 gap-4">
            <div>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">
                SOL paid to traders
              </p>
              <p className="text-2xl font-bold font-mono gradient-text">
                {formatSol(trustStats.totalPaidLamports)}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">
                Live campaigns
              </p>
              <p className="text-2xl font-bold font-mono gradient-text">
                {trustStats.liveCampaigns}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">
                Unique earners
              </p>
              <p className="text-2xl font-bold font-mono gradient-text">
                {trustStats.uniqueEarners}
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Your campaigns — rendered only when the connected wallet owns ≥1 campaign */}
      {myCampaigns.length > 0 && (
        <section className="mb-16">
          <p className="text-[11px] text-[var(--accent)] uppercase tracking-[0.15em] font-mono font-semibold mb-2">
            Your campaigns
          </p>
          <h2 className="text-[clamp(1.4rem,3vw,1.9rem)] font-bold font-display tracking-tight mb-6">
            {myCampaigns.length === 1 ? "1 active campaign" : `${myCampaigns.length} active campaigns`}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {myCampaigns.map((c) => {
              const symbol =
                c.tokenInfo?.symbol ?? c.tokenMint.slice(0, 4).toUpperCase();
              const cap = BigInt(c.poolCapLamports);
              const spent = BigInt(c.poolSpentLamports);
              const remaining = cap > spent ? cap - spent : 0n;
              const pctLeft =
                cap > 0n ? Number((remaining * 10000n) / cap) / 100 : 0;
              const statusColor =
                c.status === "live"
                  ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                  : c.status === "paused"
                    ? "bg-[rgba(234,179,8,0.12)] text-[#eab308]"
                    : "bg-[rgba(239,68,68,0.12)] text-[#ef4444]";
              return (
                <Link
                  key={`${c.tokenMint}:${c.type}`}
                  href={`/campaigns/${c.tokenMint}?type=${c.type}`}
                  className="bg-[var(--bg-card)] border border-[rgba(0,255,178,0.15)] rounded-2xl p-5 hover:border-[var(--accent)] transition group"
                >
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-[var(--accent-dim)] flex items-center justify-center text-sm font-bold font-display gradient-text flex-shrink-0">
                        {symbol.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-[14px] truncate">
                          ${symbol}
                        </p>
                        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                          <span
                            className={`text-[9px] px-1.5 py-0.5 rounded font-semibold uppercase ${statusColor}`}
                          >
                            {c.status}
                          </span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold uppercase bg-[var(--bg)] text-[var(--text-muted)] font-mono">
                            {c.type}
                          </span>
                          {c.squadsSpendingLimitPda && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold uppercase bg-[var(--bg)] text-[var(--text-secondary)] font-mono">
                              squads
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <ArrowRight
                      size={14}
                      className="text-[var(--text-muted)] group-hover:text-[var(--accent)] flex-shrink-0 mt-1"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3 pt-3 border-t border-[var(--border)]">
                    <div>
                      <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-0.5">
                        Pool left
                      </p>
                      <p className="text-[13px] font-mono font-semibold">
                        {formatSol(remaining)}{" "}
                        <span className="text-[var(--text-muted)] font-normal">
                          / {formatSol(cap.toString())} SOL
                        </span>
                      </p>
                      <p className="text-[10px] text-[var(--text-muted)] font-mono">
                        {pctLeft.toFixed(0)}% remaining
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-0.5">
                        Activity
                      </p>
                      <p className="text-[13px] font-mono font-semibold">
                        {c.stats.uniqueTraders} trader
                        {c.stats.uniqueTraders === 1 ? "" : "s"}
                      </p>
                      <p className="text-[10px] text-[var(--text-muted)] font-mono">
                        {c.stats.totalPayouts} payout
                        {c.stats.totalPayouts === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* How it works — 3-step flow so new creators know what they're signing up for */}
      <section className="mb-16">
        <p className="text-[11px] text-[var(--accent)] uppercase tracking-[0.15em] font-mono font-semibold mb-2">
          How it works
        </p>
        <h2 className="text-[clamp(1.4rem,3vw,1.9rem)] font-bold font-display tracking-tight mb-6">
          Three steps, then the agent runs it
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              icon: Wallet,
              step: "01",
              title: "Connect + fund",
              desc: "Connect the wallet that owns the Bags token. Transfer an initial pool (0.05 SOL is enough to try).",
            },
            {
              icon: Settings,
              step: "02",
              title: "Configure the campaign",
              desc: "Pick cashback, holder dividends, or a launch sprint. Set the rate. Sign the auth message to register the campaign.",
            },
            {
              icon: Bot,
              step: "03",
              title: "Agent takes over",
              desc: "The Tend agent watches trades, runs every wallet through the AI fraud gate, and pays rewards on-chain. You watch it happen.",
            },
          ].map((s) => (
            <div
              key={s.step}
              className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-6 relative"
            >
              <span className="absolute top-4 right-4 text-[10px] font-mono text-[var(--text-muted)] tracking-wider">
                {s.step}
              </span>
              <div className="w-9 h-9 rounded-xl bg-[var(--accent-dim)] flex items-center justify-center mb-4">
                <s.icon size={16} className="text-[var(--accent)]" />
              </div>
              <h3 className="text-[15px] font-semibold font-display mb-2">
                {s.title}
              </h3>
              <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
                {s.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Why — different aesthetic treatment from the 3-step flow so visitors
          parse this as a separate cluster (value props, not ordered steps). */}
      <section className="mb-16">
        <p className="text-[11px] text-[var(--accent)] uppercase tracking-[0.15em] font-mono font-semibold mb-2">
          Why Tend
        </p>
        <h2 className="text-[clamp(1.4rem,3vw,1.9rem)] font-bold font-display tracking-tight mb-6">
          Real acquisition, not vanity volume
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
          {
            icon: Coins,
            title: "Real on-chain acquisition",
            desc: "Every SOL of reward routes to a real buyer or holder wallet, logged with a Solscan link. No bots, no inflated volume.",
          },
          {
            icon: Zap,
            title: "Funded by your fees",
            desc: "Pool is topped up from your Bags creator fee-share. No upfront capital, no marketing agency.",
          },
          {
            icon: Shield,
            title: "AI-vetted payouts",
            desc: "Every payout clears a Claude Haiku fraud gate before it ships. Sybil patterns, bot clusters, and self-buys get rejected.",
          },
        ].map((b) => (
          <div
            key={b.title}
            className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-6"
          >
            <div className="w-9 h-9 rounded-xl bg-[var(--accent-dim)] flex items-center justify-center mb-4">
              <b.icon size={16} className="text-[var(--accent)]" />
            </div>
            <h3 className="text-[15px] font-semibold font-display mb-2">
              {b.title}
            </h3>
            <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
              {b.desc}
            </p>
          </div>
        ))}
        </div>
      </section>

      {/* ── Create campaign form ── */}
      <section id="create" className="mb-16 scroll-mt-20">
        <p className="text-[11px] text-[var(--accent)] uppercase tracking-[0.15em] font-mono font-semibold mb-2">
          Launch a campaign
        </p>
        <h2 className="text-[clamp(1.4rem,3vw,1.9rem)] font-bold font-display tracking-tight mb-2">
          Set up your reward pool
        </h2>
        <p className="text-[14px] text-[var(--text-muted)] mb-8 max-w-[640px]">
          Connect your wallet, pick a campaign type, set your parameters.
          The Tend agent handles swap detection, fraud screening, and payouts.
        </p>

        {success ? (
          <div className="bg-[var(--bg-card)] border border-[rgba(0,255,178,0.25)] rounded-2xl p-8">
            <div className="text-center">
              <CheckCircle
                size={40}
                className="text-[var(--accent)] mx-auto mb-4"
              />
              <h3 className="text-xl font-bold font-display mb-2">
                Campaign created
              </h3>
              <p className="text-[14px] text-[var(--text-muted)] mb-4">
                Your {TYPE_INFO[form.type].label.toLowerCase()} campaign is live.
                The Tend agent will start processing qualifying events.
              </p>
            </div>

            {/* ── Optional fee-share routing ── */}
            <div className="mt-8 pt-8 border-t border-[var(--border)]">
              <div className="flex items-center gap-2 mb-3">
                <Repeat size={14} className="text-[var(--accent)]" />
                <span className="text-[11px] text-[var(--accent)] uppercase tracking-[0.15em] font-mono font-semibold">
                  Optional · Auto-replenish
                </span>
              </div>
              <h4 className="text-[15px] font-semibold font-display mb-2">
                Route a slice of your Bags fee-share to keep the pool funded
              </h4>
              <p className="text-[13px] text-[var(--text-muted)] mb-4 leading-relaxed">
                Without this, you&apos;ll need to manually top up the pool when
                it runs low. With it, every Bags fee claim auto-grows the pool.
                You can update or revert the split anytime from Bags.
              </p>

              {routeDone ? (
                <div className="bg-[var(--bg)] rounded-xl p-4 border border-[rgba(0,255,178,0.25)]">
                  <p className="text-[13px] text-[var(--accent)] mb-2 font-semibold">
                    Fee-share routed
                  </p>
                  <p className="text-[12px] text-[var(--text-muted)] mb-2">
                    {routeBps}% of future Bags fees will flow to the campaign
                    pool. Bags will reflect the change after the next claim.
                  </p>
                  {routeSigs.length > 0 && (
                    <div className="space-y-1">
                      {routeSigs.map((s) => (
                        <a
                          key={s}
                          href={`https://solscan.io/tx/${s}`}
                          target="_blank"
                          rel="noopener"
                          className="block text-[11px] font-mono text-[var(--accent)] hover:underline truncate"
                        >
                          {s}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="flex items-end gap-3 mb-4">
                    <div className="flex-1">
                      <label className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider font-semibold mb-2 block">
                        Route to Tend (% of fee-share)
                      </label>
                      <input
                        type="number"
                        value={routeBps}
                        onChange={(e) => {
                          setRouteBps(e.target.value);
                          setRouteError(null);
                        }}
                        step="0.5"
                        min="0.01"
                        max="50"
                        disabled={routing}
                        className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-[13px] font-mono focus:outline-none focus:border-[var(--accent)] transition-colors disabled:opacity-50"
                      />
                    </div>
                    <button
                      onClick={handleRouteFees}
                      disabled={routing}
                      className="gradient-btn px-5 py-2.5 rounded-lg text-[13px] font-semibold inline-flex items-center gap-2 disabled:opacity-50"
                    >
                      {routing ? (
                        <>
                          <Loader2 size={13} className="animate-spin" />
                          {routeStep === "signing" && "Sign auth..."}
                          {routeStep === "preparing" && "Preparing..."}
                          {routeStep === "sending" && "Sign tx..."}
                          {routeStep === "confirming" && "Confirming..."}
                          {routeStep === "idle" && "Working..."}
                        </>
                      ) : (
                        <>Enable auto-replenish</>
                      )}
                    </button>
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)] mb-2">
                    Existing claimers stay — their share is reduced prorata so
                    the total still equals 100%. Only the token&apos;s fee-share
                    admin can run this.
                  </p>
                  {routeError && (
                    <p className="text-[12px] text-red-400">{routeError}</p>
                  )}
                </>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 mt-8">
              <Link
                href={`/campaigns/${form.tokenMint}?type=${form.type}`}
                className="gradient-btn px-5 py-2.5 rounded-lg text-sm font-semibold inline-flex items-center gap-2"
              >
                Open my campaign <ArrowRight size={13} />
              </Link>
              <Link
                href="/campaigns"
                className="btn-secondary px-5 py-2.5 rounded-lg text-sm"
              >
                Browse all
              </Link>
              <button
                onClick={() => {
                  setSuccess(false);
                  setForm(DEFAULTS);
                  setRouteDone(false);
                  setRouteError(null);
                  setRouteSigs([]);
                  setRouteBps("10");
                }}
                className="btn-secondary px-5 py-2.5 rounded-lg text-sm"
              >
                Create another
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-6 md:p-8">
            {/* Campaign type selector */}
            <div className="mb-6">
              <label className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider font-semibold mb-3 block">
                Campaign type
              </label>
              <div className="grid grid-cols-3 gap-3">
                {(["cashback", "holder", "sprint"] as CampaignType[]).map(
                  (t) => {
                    const info = TYPE_INFO[t];
                    const Icon = info.icon;
                    const active = form.type === t;
                    return (
                      <button
                        key={t}
                        onClick={() => set("type", t)}
                        className={`text-left rounded-xl p-4 border transition-colors ${
                          active
                            ? "border-[var(--accent)] bg-[var(--accent-dim)]"
                            : "border-[var(--border)] bg-[var(--bg)] hover:border-[var(--border-hover)]"
                        }`}
                      >
                        <Icon
                          size={16}
                          className={
                            active
                              ? "text-[var(--accent)] mb-2"
                              : "text-[var(--text-muted)] mb-2"
                          }
                        />
                        <p
                          className={`text-[13px] font-semibold mb-0.5 ${active ? "text-[var(--accent)]" : ""}`}
                        >
                          {info.label}
                        </p>
                        <p className="text-[10px] text-[var(--text-muted)] leading-snug">
                          {info.tagline}
                        </p>
                      </button>
                    );
                  },
                )}
              </div>
            </div>

            {/* Token mint */}
            <div className="mb-5">
              <label className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider font-semibold mb-2 block">
                Token mint address
              </label>
              <input
                type="text"
                value={form.tokenMint}
                onChange={(e) => set("tokenMint", e.target.value)}
                placeholder="e.g. 6qa9oCypYpnWZyZNQ8v36eLbmWmcgHRv4MuU7BXQBAGS"
                className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-3 text-[13px] font-mono placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] transition-colors"
              />
            </div>

            {/* Pool cap */}
            <div className="mb-5">
              <label className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider font-semibold mb-2 block">
                Reward budget (SOL)
              </label>
              <input
                type="number"
                value={form.poolCapSol}
                onChange={(e) => set("poolCapSol", e.target.value)}
                step="0.01"
                min="0.001"
                max="10"
                className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-3 text-[13px] font-mono focus:outline-none focus:border-[var(--accent)] transition-colors"
              />
              <p className="text-[10px] text-[var(--text-muted)] mt-1">
                Maximum SOL to distribute. Funded from your token&apos;s trading fees.
              </p>
            </div>

            {/* Type-specific params */}
            {form.type === "cashback" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
                <div>
                  <label className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider font-semibold mb-2 block">
                    Cashback rate (%)
                  </label>
                  <input
                    type="number"
                    value={form.cashbackPct}
                    onChange={(e) => set("cashbackPct", e.target.value)}
                    step="0.5"
                    min="0.1"
                    max="50"
                    className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-3 text-[13px] font-mono focus:outline-none focus:border-[var(--accent)] transition-colors"
                  />
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">
                    % of each qualifying buy returned as SOL cashback
                  </p>
                </div>
                <div>
                  <label className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider font-semibold mb-2 block">
                    Min swap volume (SOL)
                  </label>
                  <input
                    type="number"
                    value={form.cashbackMinSwapSol}
                    onChange={(e) =>
                      set("cashbackMinSwapSol", e.target.value)
                    }
                    step="0.005"
                    min="0"
                    className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-3 text-[13px] font-mono focus:outline-none focus:border-[var(--accent)] transition-colors"
                  />
                  <p className="text-[10px] text-[var(--text-muted)] mt-1">
                    Buys below this size are ignored (anti-spam floor). 0 = no floor.
                  </p>
                </div>
                {parseFloat(form.cashbackPct) > 3 && (
                  <div className="sm:col-span-2 mt-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[11px] text-[var(--text-secondary)] leading-relaxed">
                    <span className="font-semibold text-[var(--text-primary)]">
                      Heads up.
                    </span>{" "}
                    Bags creator fees run ~1–2% of volume, so above 3% cashback
                    the pool won&apos;t refill itself from fee-share alone. That&apos;s
                    fine if you&apos;re funding a short kick-off campaign or topping
                    up manually — just worth knowing.
                  </div>
                )}
              </div>
            )}

            {form.type === "holder" && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
                <div>
                  <label className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider font-semibold mb-2 block">
                    Reward per snapshot (%)
                  </label>
                  <input
                    type="number"
                    value={form.rewardPct}
                    onChange={(e) => set("rewardPct", e.target.value)}
                    step="0.1"
                    min="0.1"
                    max="20"
                    className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-3 text-[13px] font-mono focus:outline-none focus:border-[var(--accent)] transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider font-semibold mb-2 block">
                    Min hold (hours)
                  </label>
                  <input
                    type="number"
                    value={form.minHoldHours}
                    onChange={(e) => set("minHoldHours", e.target.value)}
                    step="1"
                    min="1"
                    max="168"
                    className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-3 text-[13px] font-mono focus:outline-none focus:border-[var(--accent)] transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider font-semibold mb-2 block">
                    Snapshot every (hours)
                  </label>
                  <input
                    type="number"
                    value={form.snapshotHours}
                    onChange={(e) => set("snapshotHours", e.target.value)}
                    step="1"
                    min="1"
                    max="24"
                    className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-3 text-[13px] font-mono focus:outline-none focus:border-[var(--accent)] transition-colors"
                  />
                </div>
              </div>
            )}

            {form.type === "sprint" && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
                <div>
                  <label className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider font-semibold mb-2 block">
                    Bonus per winner (SOL)
                  </label>
                  <input
                    type="number"
                    value={form.bonusSol}
                    onChange={(e) => set("bonusSol", e.target.value)}
                    step="0.001"
                    min="0.001"
                    max="1"
                    className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-3 text-[13px] font-mono focus:outline-none focus:border-[var(--accent)] transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider font-semibold mb-2 block">
                    Max winners
                  </label>
                  <input
                    type="number"
                    value={form.maxWinners}
                    onChange={(e) => set("maxWinners", e.target.value)}
                    step="1"
                    min="1"
                    max="100"
                    className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-3 text-[13px] font-mono focus:outline-none focus:border-[var(--accent)] transition-colors"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider font-semibold mb-2 block">
                    Min buy (SOL)
                  </label>
                  <input
                    type="number"
                    value={form.minBuySol}
                    onChange={(e) => set("minBuySol", e.target.value)}
                    step="0.001"
                    min="0.001"
                    max="1"
                    className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-3 text-[13px] font-mono focus:outline-none focus:border-[var(--accent)] transition-colors"
                  />
                </div>
              </div>
            )}

            {/* Summary */}
            <div className="bg-[var(--bg)] rounded-xl p-4 mb-6 border border-[var(--border)]">
              <div className="flex items-center gap-2 mb-2">
                <TypeIcon size={14} className="text-[var(--accent)]" />
                <span className="text-[12px] font-semibold text-[var(--accent)] uppercase tracking-wider">
                  Summary
                </span>
              </div>
              <div className="text-[13px] text-[var(--text-secondary)] space-y-1">
                <p>
                  <span className="text-[var(--text-muted)]">Type:</span>{" "}
                  {TYPE_INFO[form.type].label}
                </p>
                <p>
                  <span className="text-[var(--text-muted)]">Pool:</span>{" "}
                  {form.poolCapSol || "0"} SOL
                </p>
                {form.type === "cashback" && (
                  <p>
                    <span className="text-[var(--text-muted)]">Rate:</span>{" "}
                    {form.cashbackPct}% cashback on every qualifying buy
                  </p>
                )}
                {form.type === "holder" && (
                  <p>
                    <span className="text-[var(--text-muted)]">Rule:</span>{" "}
                    {form.rewardPct}% per snapshot, hold {form.minHoldHours}h
                    min, every {form.snapshotHours}h
                  </p>
                )}
                {form.type === "sprint" && (
                  <p>
                    <span className="text-[var(--text-muted)]">Rule:</span>{" "}
                    {form.bonusSol} SOL to first {form.maxWinners} buyers (min{" "}
                    {form.minBuySol} SOL)
                  </p>
                )}
              </div>
            </div>

            {/* Error */}
            {error && (
              <p className="text-[13px] text-red-400 mb-4">{error}</p>
            )}

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="gradient-btn w-full px-6 py-3.5 rounded-xl text-[15px] font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  {step === "fetching" && "Checking for conflicts…"}
                  {step === "prov-signing" && "Sign to authorize the campaign…"}
                  {step === "prov-preparing" && "Preparing the vault…"}
                  {step === "prov-sending" && "Approve in your wallet…"}
                  {step === "prov-confirming" && "Confirming on-chain…"}
                  {step === "prov-submitting" && "Registering the campaign…"}
                  {step === "idle" && "Working…"}
                </>
              ) : !connected ? (
                <>Connect wallet to launch</>
              ) : (
                <>
                  <Zap size={15} />
                  Launch campaign ({form.poolCapSol || "0"} SOL)
                </>
              )}
            </button>
            {submitting && (
              <p className="text-[11px] text-[var(--text-muted)] text-center mt-3">
                Two wallet prompts: one to authorize the campaign, one to
                approve the on-chain vault that will custody and pay out your SOL.
              </p>
            )}

            {connected && (
              <p className="text-[10px] text-[var(--text-muted)] text-center mt-3 font-mono">
                Creating as {publicKey?.toBase58().slice(0, 6)}...
                {publicKey?.toBase58().slice(-4)}
              </p>
            )}
          </div>
        )}
      </section>

      {/* Claude Desktop — visual conversation mockup */}
      <section className="mb-16">
        <p className="text-[11px] text-[var(--accent)] uppercase tracking-[0.15em] font-mono font-semibold mb-2">
          Also available
        </p>
        <h2 className="text-[clamp(1.4rem,3vw,1.9rem)] font-bold font-display tracking-tight mb-2">
          Manage campaigns from a conversation
        </h2>
        <p className="text-[14px] text-[var(--text-muted)] mb-6 max-w-[640px]">
          Prefer natural language? Connect Tend to Claude Desktop and manage
          everything from a chat.
        </p>

        <div className="bg-[#1a1a1a] border border-[var(--border)] rounded-2xl overflow-hidden">
          {/* Fake window bar */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)]">
            <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
            <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
            <span className="w-3 h-3 rounded-full bg-[#28c840]" />
            <span className="text-[11px] text-[var(--text-muted)] ml-3 font-mono">
              Claude Desktop
            </span>
            <span className="ml-auto text-[10px] text-[var(--text-muted)] font-mono uppercase tracking-wider px-2 py-0.5 rounded border border-[var(--border)] bg-[var(--bg)]">
              Example
            </span>
          </div>

          <div className="p-6 space-y-5">
            {/* User message */}
            <div className="flex justify-end">
              <div className="bg-[var(--accent-dim)] border border-[rgba(0,255,178,0.15)] rounded-2xl rounded-br-md px-4 py-3 max-w-[420px]">
                <p className="text-[13px] text-[var(--text-secondary)]">
                  Create a 5% cashback campaign on $TEND with a 0.1 SOL pool
                </p>
              </div>
            </div>

            {/* Claude response */}
            <div className="flex justify-start">
              <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl rounded-bl-md px-4 py-3 max-w-[480px]">
                <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
                  Done. Cashback campaign created on $TEND:
                </p>
                <div className="mt-2 bg-[var(--bg)] rounded-lg p-3 space-y-1 text-[12px] font-mono">
                  <p><span className="text-[var(--text-muted)]">Type:</span> <span className="text-[var(--accent)]">Cashback 5%</span></p>
                  <p><span className="text-[var(--text-muted)]">Pool:</span> 0.1 SOL</p>
                  <p><span className="text-[var(--text-muted)]">Status:</span> <span className="text-[var(--accent)]">Live</span></p>
                </div>
                <p className="text-[12px] text-[var(--text-muted)] mt-2">
                  The agent is now watching for qualifying swaps.
                </p>
              </div>
            </div>

            {/* User follow-up */}
            <div className="flex justify-end">
              <div className="bg-[var(--accent-dim)] border border-[rgba(0,255,178,0.15)] rounded-2xl rounded-br-md px-4 py-3 max-w-[420px]">
                <p className="text-[13px] text-[var(--text-secondary)]">
                  How&apos;s the campaign doing? Any payouts yet?
                </p>
              </div>
            </div>

            {/* Claude stats response */}
            <div className="flex justify-start">
              <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl rounded-bl-md px-4 py-3 max-w-[480px]">
                <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed">
                  3 payouts so far, 2 unique earners:
                </p>
                <div className="mt-2 bg-[var(--bg)] rounded-lg p-3 space-y-1 text-[12px] font-mono">
                  <p><span className="text-[var(--text-muted)]">Paid:</span> 0.066 SOL</p>
                  <p><span className="text-[var(--text-muted)]">Pool left:</span> 0.034 SOL</p>
                  <p><span className="text-[var(--text-muted)]">Fraud blocked:</span> 1 wallet (sybil pattern)</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section>
        <div
          className="bg-[var(--bg-card)] border rounded-2xl p-10 text-center"
          style={{ borderColor: "rgba(0, 255, 178, 0.12)" }}
        >
          <h2 className="text-[clamp(1.3rem,3vw,1.8rem)] font-bold font-display tracking-tight mb-3">
            Ready to grow your token?
          </h2>
          <p className="text-[13px] text-[var(--text-muted)] max-w-[520px] mx-auto mb-6">
            Connect your wallet, pick your campaign type, and your reward pool
            is live in under a minute.
          </p>
          <a
            href="#create"
            className="gradient-btn px-6 py-2.5 rounded-lg text-sm font-semibold inline-flex items-center gap-2"
          >
            Launch a campaign <ArrowRight size={13} />
          </a>
        </div>
      </section>
    </div>
  );
}
