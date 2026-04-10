"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useRouter } from "next/navigation";
import { ServiceIcon, Zap } from "@/components/service-icons";

const SERVICES = [
  {
    id: "buyback-bot",
    name: "Buyback Bot",
    description:
      "Automatically claims trading fees and buys back the token, creating sustained buy pressure and reducing circulating supply.",
    defaultBps: 1500,
    minBps: 500,
    maxBps: 4000,
    category: "market-making",
    status: "available" as const,
    color: "#10b981",
    highlight: "Live",
  },
  {
    id: "fee-compounder",
    name: "Fee Compounder",
    description:
      "Claims accumulated fees and reinvests into liquidity positions, deepening the pool and reducing slippage over time.",
    defaultBps: 1000,
    minBps: 300,
    maxBps: 3000,
    category: "growth",
    status: "coming-soon" as const,
    color: "#06b6d4",
    highlight: null,
  },
  {
    id: "analytics",
    name: "Analytics Engine",
    description:
      "Monitors holder distribution, fee velocity, price action, and generates on-demand health reports via Claude.",
    defaultBps: 500,
    minBps: 200,
    maxBps: 1500,
    category: "analytics",
    status: "coming-soon" as const,
    color: "#8b5cf6",
    highlight: null,
  },
  {
    id: "growth-agent",
    name: "Growth Agent",
    description:
      "AI-powered community engagement, market trend analysis, and automated marketing strategy execution.",
    defaultBps: 2000,
    minBps: 500,
    maxBps: 4000,
    category: "growth",
    status: "coming-soon" as const,
    color: "#f59e0b",
    highlight: null,
  },
  {
    id: "market-maker",
    name: "Market Maker",
    description:
      "Provides active liquidity management and maintains tight spreads, reducing slippage for all traders.",
    defaultBps: 2500,
    minBps: 1000,
    maxBps: 5000,
    category: "market-making",
    status: "coming-soon" as const,
    color: "#ec4899",
    highlight: null,
  },
  {
    id: "community-rewards",
    name: "Community Rewards",
    description:
      "Distributes a share of fee revenue to top holders and active community members as loyalty incentives.",
    defaultBps: 1500,
    minBps: 500,
    maxBps: 3000,
    category: "community",
    status: "coming-soon" as const,
    color: "#6366f1",
    highlight: null,
  },
];

export default function ServicesPage() {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const router = useRouter();

  const handleAddService = () => {
    if (connected) {
      router.push("/dashboard");
    } else {
      setVisible(true);
    }
  };

  const available = SERVICES.filter((s) => s.status === "available");
  const comingSoon = SERVICES.filter((s) => s.status === "coming-soon");

  return (
    <div className="max-w-6xl mx-auto fade-in">
      {/* Header */}
      <div className="page-header mb-10">
        <p className="section-label mb-3"><span>02</span> — Services</p>
        <h2 className="gradient-text">Service Marketplace</h2>
        <p>
          Autonomous AI services paid through fee-sharing — no subscriptions, no
          upfront cost.
        </p>
      </div>

      {/* Value prop banner */}
      <div className="card card-accent !p-5 mb-8" style={{ borderColor: 'rgba(0, 255, 178, 0.12)' }}>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-[var(--accent)]/10 flex items-center justify-center flex-shrink-0 text-[var(--accent)]">
            <Zap size={22} />
          </div>
          <div>
            <p className="text-[15px] font-semibold font-display">
              Services are paid from your token&apos;s trading fees
            </p>
            <p className="text-[13px] text-[var(--text-secondary)] mt-0.5 leading-relaxed">
              Allocate a percentage of fee-sharing. The service earns only
              when your token has volume. Zero risk — remove anytime.
            </p>
          </div>
        </div>
      </div>

      {/* Available services */}
      <div className="mb-6">
        <p className="section-label mb-4"><span>●</span> Available now</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-5 mb-10">
        {available.map((service) => (
          <div
            key={service.id}
            className="card flex flex-col group relative overflow-hidden"
            style={{
              borderColor: service.color + "22",
            }}
          >
            {/* Subtle color glow */}
            <div
              className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-[0.04] pointer-events-none"
              style={{ backgroundColor: service.color }}
            />
            <div className="relative">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span
                    className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110"
                    style={{ backgroundColor: service.color + "15", color: service.color }}
                  >
                    <ServiceIcon serviceId={service.id} size={20} />
                  </span>
                  <div>
                    <h3 className="font-display font-semibold text-[15px]">{service.name}</h3>
                    <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-[0.12em] font-mono">
                      {service.category}
                    </p>
                  </div>
                </div>
                {service.highlight && (
                  <span className="badge badge-accent">{service.highlight}</span>
                )}
              </div>

              <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed flex-1 mb-5">
                {service.description}
              </p>

              <div className="border-t border-[var(--border)] pt-3 space-y-2">
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-[var(--text-muted)]">Default allocation</span>
                  <span className="font-mono font-semibold">
                    {(service.defaultBps / 100).toFixed(0)}%
                  </span>
                </div>
                <div className="flex items-center justify-between text-[13px]">
                  <span className="text-[var(--text-muted)]">Range</span>
                  <span className="font-mono text-[var(--text-muted)]">
                    {(service.minBps / 100).toFixed(0)}% – {(service.maxBps / 100).toFixed(0)}%
                  </span>
                </div>
              </div>

              <button
                onClick={handleAddService}
                className="mt-4 w-full py-2.5 rounded-lg text-sm font-semibold gradient-btn"
              >
                {connected ? "Add to your token" : "Connect wallet to add"}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Coming soon */}
      <div className="mb-6">
        <p className="section-label mb-4"><span>◌</span> Coming soon</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-5">
        {comingSoon.map((service) => (
          <div
            key={service.id}
            className="card flex flex-col opacity-60"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <span
                  className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: service.color + "10", color: service.color }}
                >
                  <ServiceIcon serviceId={service.id} size={20} />
                </span>
                <div>
                  <h3 className="font-display font-semibold text-[15px]">{service.name}</h3>
                  <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-[0.12em] font-mono">
                    {service.category}
                  </p>
                </div>
              </div>
              <span className="badge badge-muted">SOON</span>
            </div>

            <p className="text-[13px] text-[var(--text-secondary)] leading-relaxed flex-1 mb-4">
              {service.description}
            </p>

            <div className="border-t border-[var(--border)] pt-3">
              <div className="flex items-center justify-between text-[13px]">
                <span className="text-[var(--text-muted)]">Default allocation</span>
                <span className="font-mono text-[var(--text-muted)]">
                  {(service.defaultBps / 100).toFixed(0)}%
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
