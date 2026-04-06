const SERVICES = [
  {
    id: "buyback-bot",
    name: "Buyback Bot",
    icon: "↩",
    description:
      "Automatically claims fees and buys back the token, creating sustained buy pressure.",
    defaultBps: 1500,
    minBps: 500,
    maxBps: 4000,
    category: "market-making",
    status: "available" as const,
    color: "#10b981",
  },
  {
    id: "fee-compounder",
    name: "Fee Compounder",
    icon: "🔄",
    description:
      "Claims accumulated fees and reinvests into liquidity positions.",
    defaultBps: 1000,
    minBps: 300,
    maxBps: 3000,
    category: "growth",
    status: "available" as const,
    color: "#06b6d4",
  },
  {
    id: "analytics",
    name: "Analytics Engine",
    icon: "📊",
    description:
      "Monitors holder distribution, fee flows, price action, and generates health reports.",
    defaultBps: 500,
    minBps: 200,
    maxBps: 1500,
    category: "analytics",
    status: "available" as const,
    color: "#8b5cf6",
  },
  {
    id: "growth-agent",
    name: "Growth Agent",
    icon: "📈",
    description:
      "AI-powered community engagement, market insights, and marketing strategies.",
    defaultBps: 2000,
    minBps: 500,
    maxBps: 4000,
    category: "growth",
    status: "available" as const,
    color: "#f59e0b",
  },
  {
    id: "market-maker",
    name: "Market Maker",
    icon: "💹",
    description:
      "Provides liquidity and maintains tight spreads. Reduces slippage for traders.",
    defaultBps: 2500,
    minBps: 1000,
    maxBps: 5000,
    category: "market-making",
    status: "coming-soon" as const,
    color: "#ec4899",
  },
  {
    id: "community-rewards",
    name: "Community Rewards",
    icon: "🎁",
    description:
      "Distributes fee revenue to top holders and active community members.",
    defaultBps: 1500,
    minBps: 500,
    maxBps: 3000,
    category: "community",
    status: "coming-soon" as const,
    color: "#6366f1",
  },
];

export default function ServicesPage() {
  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-8">
        <h2 className="text-3xl font-bold gradient-text">
          Service Marketplace
        </h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Autonomous AI services paid via fee-sharing
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {SERVICES.map((service) => (
          <div
            key={service.id}
            className="card flex flex-col"
            style={{
              borderColor:
                service.status === "available"
                  ? service.color + "33"
                  : undefined,
            }}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <span
                  className="text-3xl w-12 h-12 rounded-xl flex items-center justify-center"
                  style={{ backgroundColor: service.color + "1a" }}
                >
                  {service.icon}
                </span>
                <div>
                  <h3 className="font-semibold">{service.name}</h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    {service.category}
                  </p>
                </div>
              </div>
              {service.status === "coming-soon" && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--bg)] border border-[var(--border)] text-[var(--text-muted)]">
                  SOON
                </span>
              )}
            </div>

            <p className="text-xs text-[var(--text-muted)] flex-1 mb-4">
              {service.description}
            </p>

            <div className="border-t border-[var(--border)] pt-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-muted)]">Default cost</span>
                <span className="font-mono font-semibold">
                  {service.defaultBps} BPS (
                  {(service.defaultBps / 100).toFixed(1)}%)
                </span>
              </div>
              <div className="flex items-center justify-between text-xs mt-1">
                <span className="text-[var(--text-muted)]">Range</span>
                <span className="font-mono">
                  {service.minBps}–{service.maxBps} BPS
                </span>
              </div>
            </div>

            {service.status === "available" && (
              <div className="mt-3 pt-3 border-t border-[var(--border)]">
                <p className="text-[10px] text-[var(--text-muted)] text-center">
                  Ask Claude: &quot;Add {service.id} to my token&quot;
                </p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
