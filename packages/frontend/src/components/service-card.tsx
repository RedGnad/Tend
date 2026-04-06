"use client";

import type { ActiveService } from "@tend/shared";

const SERVICE_ICONS: Record<string, string> = {
  "buyback-bot": "↩",
  "fee-compounder": "🔄",
  analytics: "📊",
  "growth-agent": "📈",
  "market-maker": "💹",
  "community-rewards": "🎁",
};

const STATUS_COLORS: Record<string, string> = {
  active: "var(--accent)",
  paused: "var(--warning)",
  error: "var(--danger)",
};

function formatSol(lamports: string | number): string {
  return (Number(lamports) / 1_000_000_000).toFixed(4) + " SOL";
}

export function ServiceCard({ service }: { service: ActiveService }) {
  const icon = SERVICE_ICONS[service.serviceId] ?? "⚙";
  const statusColor = STATUS_COLORS[service.status] ?? "var(--text-muted)";

  return (
    <div className="card">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{icon}</span>
          <div>
            <h3 className="font-semibold text-sm">{service.serviceId}</h3>
            <p className="text-xs text-[var(--text-muted)]">
              {service.bps} BPS ({(service.bps / 100).toFixed(1)}%)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: statusColor }}
          />
          <span
            className="text-xs uppercase font-medium"
            style={{ color: statusColor }}
          >
            {service.status}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-[var(--text-muted)]">Fees Earned</p>
          <p className="font-mono mt-0.5">
            {formatSol(service.stats.totalFeesEarned)}
          </p>
        </div>
        <div>
          <p className="text-[var(--text-muted)]">Fees Claimed</p>
          <p className="font-mono mt-0.5">
            {formatSol(service.stats.totalFeesClaimed)}
          </p>
        </div>
        <div>
          <p className="text-[var(--text-muted)]">Actions</p>
          <p className="font-mono mt-0.5">{service.stats.actionsPerformed}</p>
        </div>
        <div>
          <p className="text-[var(--text-muted)]">Last Claim</p>
          <p className="font-mono mt-0.5">
            {service.stats.lastClaimAt
              ? new Date(service.stats.lastClaimAt).toLocaleDateString()
              : "Never"}
          </p>
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-[var(--border)]">
        <p className="text-[10px] text-[var(--text-muted)] font-mono truncate">
          Wallet: {service.claimerWallet}
        </p>
      </div>
    </div>
  );
}
