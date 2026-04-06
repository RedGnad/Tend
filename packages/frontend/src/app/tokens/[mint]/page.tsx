import { getManagedToken } from "@/lib/state";
import { ServiceCard } from "@/components/service-card";
import { FeeFlow } from "@/components/fee-flow";
import { ActivityFeed } from "@/components/activity-feed";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

function formatSol(lamports: string | number): string {
  return (Number(lamports) / 1_000_000_000).toFixed(4) + " SOL";
}

export default async function TokenPage({
  params,
}: {
  params: Promise<{ mint: string }>;
}) {
  const { mint } = await params;
  const token = await getManagedToken(mint);

  if (!token) notFound();

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] mb-2">
          <a href="/" className="hover:underline">
            Dashboard
          </a>
          <span>/</span>
          <span>Token</span>
        </div>
        <h2 className="text-2xl font-bold font-mono">{mint}</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Managed since{" "}
          {new Date(token.createdAt).toLocaleDateString()}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="card">
          <p className="text-xs text-[var(--text-muted)] mb-1">
            Active Services
          </p>
          <p className="text-2xl font-bold">{token.services.length}</p>
        </div>
        <div className="card">
          <p className="text-xs text-[var(--text-muted)] mb-1">
            Creator Share
          </p>
          <p className="text-2xl font-bold">
            {(token.creatorBps / 100).toFixed(1)}%
          </p>
        </div>
        <div className="card">
          <p className="text-xs text-[var(--text-muted)] mb-1">
            Service Share
          </p>
          <p className="text-2xl font-bold gradient-text">
            {(token.totalServiceBps / 100).toFixed(1)}%
          </p>
        </div>
        <div className="card">
          <p className="text-xs text-[var(--text-muted)] mb-1">
            Lifetime Fees
          </p>
          <p className="text-2xl font-bold">{formatSol(token.lifetimeFees)}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left — fee flow + services */}
        <div className="col-span-2 space-y-6">
          <FeeFlow token={token} />

          <div>
            <h3 className="text-sm font-semibold mb-3">Active Services</h3>
            <div className="grid grid-cols-2 gap-4">
              {token.services.map((service) => (
                <ServiceCard
                  key={service.serviceId}
                  service={service}
                />
              ))}
            </div>
          </div>

          {/* Admin wallet */}
          <div className="card">
            <h3 className="text-sm font-semibold mb-2">Admin</h3>
            <p className="font-mono text-xs text-[var(--text-muted)]">
              {token.adminWallet}
            </p>
          </div>
        </div>

        {/* Right — activity */}
        <div>
          <ActivityFeed />
        </div>
      </div>
    </div>
  );
}
