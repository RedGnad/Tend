import { getManagedTokens } from "@/lib/state";
import { ServiceCard } from "@/components/service-card";
import { FeeFlow } from "@/components/fee-flow";
import { ActivityFeed } from "@/components/activity-feed";

function formatSol(lamports: string | number): string {
  return (Number(lamports) / 1_000_000_000).toFixed(4);
}

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const tokens = await getManagedTokens();

  const totalServices = tokens.reduce(
    (sum, t) => sum + t.services.length,
    0
  );
  const totalServiceBps = tokens.reduce(
    (sum, t) => sum + t.totalServiceBps,
    0
  );

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-3xl font-bold gradient-text">Dashboard</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Fee-sharing orchestration overview
        </p>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="card">
          <p className="text-xs text-[var(--text-muted)] mb-1">
            Managed Tokens
          </p>
          <p className="text-2xl font-bold">{tokens.length}</p>
        </div>
        <div className="card">
          <p className="text-xs text-[var(--text-muted)] mb-1">
            Active Services
          </p>
          <p className="text-2xl font-bold">{totalServices}</p>
        </div>
        <div className="card">
          <p className="text-xs text-[var(--text-muted)] mb-1">
            Total Fee Allocation
          </p>
          <p className="text-2xl font-bold">
            {(totalServiceBps / 100).toFixed(1)}%
          </p>
        </div>
        <div className="card">
          <p className="text-xs text-[var(--text-muted)] mb-1">
            Protocol Status
          </p>
          <div className="flex items-center gap-2 mt-1">
            <div className="pulse-dot" />
            <span className="text-[var(--accent)] font-semibold">Active</span>
          </div>
        </div>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-3 gap-6">
        {/* Left column — tokens & services */}
        <div className="col-span-2 space-y-6">
          {tokens.length === 0 ? (
            <div className="card text-center py-12">
              <p className="text-lg font-semibold mb-2">No tokens managed</p>
              <p className="text-sm text-[var(--text-muted)]">
                Use Claude Desktop with the Tend MCP server to add services to
                your tokens.
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-4 font-mono">
                &quot;Add the buyback bot to my token&quot;
              </p>
            </div>
          ) : (
            tokens.map((token) => (
              <div key={token.tokenMint} className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-semibold">
                      <a
                        href={`/tokens/${token.tokenMint}`}
                        className="hover:underline"
                      >
                        {token.tokenMint.slice(0, 12)}...
                      </a>
                    </h3>
                    <p className="text-xs text-[var(--text-muted)]">
                      {token.services.length} service(s) |{" "}
                      Creator: {(token.creatorBps / 100).toFixed(1)}%
                    </p>
                  </div>
                </div>

                <FeeFlow token={token} />

                <div className="grid grid-cols-2 gap-4">
                  {token.services.map((service) => (
                    <ServiceCard
                      key={service.serviceId}
                      service={service}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Right column — activity */}
        <div className="space-y-6">
          <ActivityFeed />

          {/* Quick stats */}
          <div className="card">
            <h3 className="text-sm font-semibold mb-3">How it works</h3>
            <div className="space-y-3 text-xs text-[var(--text-muted)]">
              <div className="flex gap-2">
                <span className="text-[var(--accent)]">1.</span>
                <p>Launch a token on Bags.fm</p>
              </div>
              <div className="flex gap-2">
                <span className="text-[var(--accent)]">2.</span>
                <p>Tell Claude: &quot;Add buyback bot to my token&quot;</p>
              </div>
              <div className="flex gap-2">
                <span className="text-[var(--accent)]">3.</span>
                <p>Tend configures fee-sharing splits on-chain</p>
              </div>
              <div className="flex gap-2">
                <span className="text-[var(--accent)]">4.</span>
                <p>AI services claim fees & execute autonomously</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
