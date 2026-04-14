"use client";

import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  ArrowRight,
  Coins,
  Sparkles,
  Shield,
  Wallet,
  Zap,
} from "lucide-react";

export default function CreatorPage() {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();

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
          <p className="text-[16px] text-[var(--text-secondary)] leading-relaxed max-w-[560px] mx-auto mb-10">
            Allocate a slice of your Bags fee-share to a reward pool. Traders
            get SOL back when they buy your token — acquisition you can measure
            on-chain.
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            {connected ? (
              <button
                disabled
                className="gradient-btn px-6 py-3 rounded-xl text-[14px] font-semibold inline-flex items-center gap-2 opacity-60 cursor-not-allowed"
                title="Coming next"
              >
                Activate campaign <ArrowRight size={14} />
              </button>
            ) : (
              <button
                onClick={() => setVisible(true)}
                className="gradient-btn px-6 py-3 rounded-xl text-[14px] font-semibold inline-flex items-center gap-2"
              >
                <Wallet size={14} />
                Connect wallet
              </button>
            )}
            <Link
              href="/campaigns"
              className="btn-secondary px-6 py-3 rounded-xl text-[14px] inline-flex items-center gap-2"
            >
              See live campaigns
            </Link>
          </div>
          {connected && (
            <p className="text-[11px] text-[var(--text-muted)] font-mono mt-5">
              Self-serve creator flow ships next — reach out for early access.
            </p>
          )}
        </div>
      </section>

      {/* Why */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-16">
        {[
          {
            icon: Coins,
            title: "Real on-chain acquisition",
            desc: "Every SOL of cashback routes to a real buyer wallet, logged with a Solscan link. No bots, no inflated volume.",
          },
          {
            icon: Zap,
            title: "Funded by your fees",
            desc: "Pool is topped up from your Bags creator fee-share. No upfront capital, no marketing agency.",
          },
          {
            icon: Shield,
            title: "Bounded + auditable",
            desc: "Set the cashback %, the pool cap, and the campaign duration. Tend agents never exceed your caps.",
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

      {/* How */}
      <section className="mb-16">
        <p className="text-[11px] text-[var(--accent)] uppercase tracking-[0.15em] font-mono font-semibold mb-2">
          How it works
        </p>
        <h2 className="text-[clamp(1.4rem,3vw,1.9rem)] font-bold font-display tracking-tight mb-6">
          Four steps to a live campaign
        </h2>
        <div className="space-y-3">
          {[
            {
              step: "01",
              title: "Connect the admin wallet of your Bags token",
              desc: "Only the fee-share admin can authorize Tend. No custody, no seed phrase — just a wallet signature.",
            },
            {
              step: "02",
              title: "Set your parameters",
              desc: "Pick the cashback % (e.g. 5%), the pool cap (e.g. 1 SOL), and the duration. You can pause anytime.",
            },
            {
              step: "03",
              title: "Tend hooks into Bags fee-share",
              desc: "A service wallet is added to your fee-share config. Part of every trade flows into the reward pool.",
            },
            {
              step: "04",
              title: "Traders earn, you get on-chain acquisition",
              desc: "The Tend agent detects qualifying buys, computes cashback, and sends SOL to buyers. Every payout is auditable.",
            },
          ].map((s) => (
            <div
              key={s.step}
              className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-5 flex gap-5"
            >
              <span className="text-[28px] font-bold font-display text-[var(--border-hover)] leading-none flex-shrink-0 w-12">
                {s.step}
              </span>
              <div>
                <h3 className="text-[14px] font-semibold mb-1">{s.title}</h3>
                <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
                  {s.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section>
        <div
          className="bg-[var(--bg-card)] border rounded-2xl p-10 text-center"
          style={{ borderColor: "rgba(0, 255, 178, 0.12)" }}
        >
          <h2 className="text-[clamp(1.3rem,3vw,1.8rem)] font-bold font-display tracking-tight mb-3">
            Ready to activate Tend on your token?
          </h2>
          <p className="text-[13px] text-[var(--text-muted)] max-w-[480px] mx-auto mb-6">
            Self-serve flow is shipping soon. Meanwhile, reach out and we&apos;ll
            set up your campaign by hand in under an hour.
          </p>
          <a
            href="https://x.com/messages/compose"
            target="_blank"
            rel="noopener noreferrer"
            className="gradient-btn px-6 py-2.5 rounded-lg text-sm font-semibold inline-flex items-center gap-2"
          >
            Get early access <ArrowRight size={13} />
          </a>
        </div>
      </section>
    </div>
  );
}
