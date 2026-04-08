const SERVICES = [
  {
    id: "buyback-bot",
    name: "Buyback Bot",
    icon: "↩",
    description:
      "Automatically claims trading fees and buys back the token, creating sustained buy pressure and reducing circulating supply.",
    defaultBps: 1500,
    minBps: 500,
    maxBps: 4000,
    category: "market-making",
    status: "available" as const,
    color: "#10b981",
    highlight: "Most Popular",
  },
  {
    id: "fee-compounder",
    name: "Fee Compounder",
    icon: "🔄",
    description:
      "Claims accumulated fees and reinvests into liquidity positions, deepening the pool and reducing slippage over time.",
    defaultBps: 1000,
    minBps: 300,
    maxBps: 3000,
    category: "growth",
    status: "available" as const,
    color: "#06b6d4",
    highlight: null,
  },
  {
    id: "analytics",
    name: "Analytics Engine",
    icon: "📊",
    description:
      "Monitors holder distribution, fee velocity, price action, and generates on-demand health reports via Claude.",
    defaultBps: 500,
    minBps: 200,
    maxBps: 1500,
    category: "analytics",
    status: "available" as const,
    color: "#8b5cf6",
    highlight: null,
  },
  {
    id: "growth-agent",
    name: "Growth Agent",
    icon: "📈",
    description:
      "AI-powered community engagement, market trend analysis, and automated marketing strategy execution.",
    defaultBps: 2000,
    minBps: 500,
    maxBps: 4000,
    category: "growth",
    status: "available" as const,
    color: "#f59e0b",
    highlight: null,
  },
  {
    id: "market-maker",
    name: "Market Maker",
    icon: "💹",
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
    icon: "🎁",
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
  return (
    <div className="max-w-6xl mx-auto fade-in">
      <div className="mb-8">
        <h2 className="text-3xl font-bold gradient-text">
          Service Marketplace
        </h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Autonomous AI services paid through fee-sharing — no subscriptions, no
          upfront cost
        </p>
      </div>

      {/* Value prop */}
      <div className="card !p-5 mb-8 border-[var(--accent)]/20">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-[var(--accent)]/10 flex items-center justify-center text-xl flex-shrink-0">
            ⚡
          </div>
          <div>
            <p className="text-sm font-semibold">
              Services are paid from your token&apos;s trading fees
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              You allocate a percentage of fee-sharing. The service earns only
              when your token has volume. Zero risk — remove anytime.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {SERVICES.map((service) => (
          <div
            key={service.id}
            className="card flex flex-col group"
            style={{
              borderColor:
                service.status === "available"
                  ? service.color + "22"
                  : undefined,
            }}
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <span
                  className="text-2xl w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110"
                  style={{ backgroundColor: service.color + "15" }}
                >
                  {service.icon}
                </span>
                <div>
                  <h3 className="font-semibold text-sm">{service.name}</h3>
                  <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
                    {service.category}
                  </p>
                </div>
              </div>
              {service.status === "coming-soon" && (
                <span className="badge badge-muted">SOON</span>
              )}
              {service.highlight && (
                <span className="badge badge-accent">{service.highlight}</span>
              )}
            </div>

            <p className="text-xs text-[var(--text-muted)] leading-relaxed flex-1 mb-4">
              {service.description}
            </p>

            <div className="border-t border-[var(--border)] pt-3 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-muted)]">Default</span>
                <span className="font-mono font-semibold">
                  {(service.defaultBps / 100).toFixed(1)}%
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-muted)]">Range</span>
                <span className="font-mono text-[var(--text-muted)]">
                  {(service.minBps / 100).toFixed(1)}% –{" "}
                  {(service.maxBps / 100).toFixed(1)}%
                </span>
              </div>
            </div>

            {service.status === "available" && (
              <a
                href="/"
                className="mt-3 pt-3 border-t border-[var(--border)] text-center text-xs text-[var(--accent)] hover:text-white transition-colors block"
              >
                Add to your token →
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
