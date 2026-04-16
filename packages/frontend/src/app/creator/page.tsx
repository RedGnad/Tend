"use client";

import { useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
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
} from "lucide-react";

type CampaignType = "cashback" | "holder" | "sprint";

interface FormState {
  tokenMint: string;
  type: CampaignType;
  poolCapSol: string;
  cashbackPct: string;
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
  cashbackPct: "5",
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
  const { publicKey, connected } = useWallet();
  const { setVisible } = useWalletModal();

  const [form, setForm] = useState<FormState>(DEFAULTS);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setError(null);
    setSuccess(false);
  }

  async function handleSubmit() {
    if (!connected || !publicKey) {
      setVisible(true);
      return;
    }

    if (!form.tokenMint || form.tokenMint.length < 32) {
      setError("Enter a valid token mint address");
      return;
    }

    const poolCapSol = parseFloat(form.poolCapSol);
    if (isNaN(poolCapSol) || poolCapSol <= 0) {
      setError("Pool cap must be greater than 0");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const config: Record<string, number | string> = {};
      if (form.type === "cashback") {
        config.cashbackBps = Math.round(parseFloat(form.cashbackPct) * 100);
      } else if (form.type === "holder") {
        config.rewardBps = Math.round(parseFloat(form.rewardPct) * 100);
        config.minHoldHours = parseFloat(form.minHoldHours);
        config.snapshotCronHours = parseFloat(form.snapshotHours);
      } else if (form.type === "sprint") {
        config.bonusSol = parseFloat(form.bonusSol);
        config.maxWinners = parseInt(form.maxWinners);
        config.minBuySol = parseFloat(form.minBuySol);
      }

      const res = await fetch("/api/campaigns/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenMint: form.tokenMint.trim(),
          creatorWallet: publicKey.toBase58(),
          type: form.type,
          poolCapSol,
          config,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to create campaign");
      }

      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
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

      {/* Why */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-16">
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
          <div className="bg-[var(--bg-card)] border border-[rgba(0,255,178,0.25)] rounded-2xl p-8 text-center">
            <CheckCircle
              size={40}
              className="text-[var(--accent)] mx-auto mb-4"
            />
            <h3 className="text-xl font-bold font-display mb-2">
              Campaign created
            </h3>
            <p className="text-[14px] text-[var(--text-muted)] mb-6">
              Your {TYPE_INFO[form.type].label.toLowerCase()} campaign is live.
              The Tend agent will start processing qualifying events.
            </p>
            <div className="flex items-center justify-center gap-3">
              <Link
                href="/campaigns"
                className="gradient-btn px-5 py-2.5 rounded-lg text-sm font-semibold inline-flex items-center gap-2"
              >
                View campaigns <ArrowRight size={13} />
              </Link>
              <button
                onClick={() => {
                  setSuccess(false);
                  setForm(DEFAULTS);
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
              <div className="mb-5">
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
                  Creating...
                </>
              ) : !connected ? (
                <>Connect wallet to launch</>
              ) : (
                <>
                  <Zap size={15} />
                  Launch campaign
                </>
              )}
            </button>

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
