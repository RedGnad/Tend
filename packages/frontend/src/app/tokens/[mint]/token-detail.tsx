"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  ArrowLeft,
  ExternalLink,
  Bot,
  TrendingUp,
  TrendingDown,
  Minus,
  Shield,
  Zap,
  Clock,
  Share2,
} from "lucide-react";
import { ActivateModal } from "@/components/activate-modal";
import type { ManagedToken, AgentDecision, AnalyticsReport } from "@tend/shared";

interface TokenHealth {
  tokenMint: string;
  tokenName: string | null;
  tokenSymbol: string | null;
  lifetimeFees: number;
  totalClaimed: number;
  unclaimedEstimate: number;
  creators: Array<{
    username: string;
    royaltyBps: number;
    wallet: string;
    isAdmin?: boolean;
    provider: string | null;
  }>;
  recentClaims: Array<{
    amount: string | number;
    wallet: string;
    timestamp: number;
  }>;
  managed: ManagedToken | null;
}

function formatSol(lamports: number | string): string {
  const sol = Number(lamports) / 1_000_000_000;
  if (sol >= 1000) return (sol / 1000).toFixed(1) + "K SOL";
  if (sol >= 1) return sol.toFixed(2) + " SOL";
  if (sol > 0) return sol.toFixed(4) + " SOL";
  return "0 SOL";
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function ActionBadge({ action }: { action: string }) {
  const config: Record<string, { bg: string; text: string; label: string }> = {
    buy: { bg: "rgba(16, 185, 129, 0.12)", text: "#34d399", label: "BUY" },
    partial_buy: {
      bg: "rgba(251, 191, 36, 0.12)",
      text: "#fbbf24",
      label: "PARTIAL BUY",
    },
    hold: { bg: "rgba(113, 113, 122, 0.12)", text: "#a1a1aa", label: "HOLD" },
  };
  const s = config[action] ?? config.hold;
  return (
    <span
      className="text-[10px] font-mono font-bold px-2 py-0.5 rounded"
      style={{ backgroundColor: s.bg, color: s.text }}
    >
      {s.label}
    </span>
  );
}

function TrendBadge({ trend }: { trend: string }) {
  const config: Record<string, { icon: typeof TrendingUp; color: string }> = {
    growing: { icon: TrendingUp, color: "#34d399" },
    stable: { icon: Minus, color: "#60a5fa" },
    declining: { icon: TrendingDown, color: "#f87171" },
  };
  const s = config[trend] ?? config.stable;
  const Icon = s.icon;
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded uppercase"
      style={{ backgroundColor: s.color + "18", color: s.color }}
    >
      <Icon size={10} />
      {trend}
    </span>
  );
}

function HealthBar({ score }: { score: number }) {
  const pct = (score / 10) * 100;
  const color =
    score >= 7 ? "#34d399" : score >= 4 ? "#fbbf24" : "#f87171";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-xs font-mono font-semibold" style={{ color }}>
        {score}/10
      </span>
    </div>
  );
}

export function TokenDetail({ mint }: { mint: string }) {
  const [health, setHealth] = useState<TokenHealth | null>(null);
  const [decisions, setDecisions] = useState<AgentDecision[]>([]);
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showAllDecisions, setShowAllDecisions] = useState(false);

  const { connected } = useWallet();
  const { setVisible } = useWalletModal();

  const fetchAll = async () => {
    setError(null);
    try {
      const [healthRes, decisionsRes, reportsRes] = await Promise.all([
        fetch(`/api/tokens/${mint}/health`),
        fetch(`/api/decisions?mint=${mint}`).catch(() => null),
        fetch(`/api/reports?mint=${mint}`).catch(() => null),
      ]);

      if (healthRes.ok) {
        setHealth(await healthRes.json());
      } else {
        const data = await healthRes.json().catch(() => ({}));
        setError(data.error || "Token not found on Bags.fm");
      }

      if (decisionsRes?.ok) {
        const data = await decisionsRes.json();
        setDecisions(data.decisions ?? []);
      }

      if (reportsRes?.ok) {
        const data = await reportsRes.json();
        const reports = data.reports ?? [];
        if (reports.length > 0) setReport(reports[0]);
      }
    } catch {
      setError("Failed to connect to Bags.fm API");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, [mint]);

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleActivate = () => {
    if (!connected) {
      setVisible(true);
    } else {
      setShowAddModal(true);
    }
  };

  if (loading) {
    return (
      <div className="max-w-[1280px] mx-auto px-6 py-8">
        <div className="flex items-center justify-center py-32">
          <div className="flex items-center gap-3 text-[var(--text-muted)] text-sm">
            <div className="w-4 h-4 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            Loading token data...
          </div>
        </div>
      </div>
    );
  }

  if (!health) {
    return (
      <div className="max-w-[1280px] mx-auto px-6 py-8">
        <div className="text-center py-32">
          <p className="text-[var(--danger)] text-sm mb-3">
            {error || "Failed to load token data"}
          </p>
          <Link
            href="/"
            className="text-xs text-[var(--accent)] hover:underline"
          >
            Back to scores
          </Link>
        </div>
      </div>
    );
  }

  const managed = health.managed;
  const tendActive = !!managed && managed.services.length > 0;
  const activeServiceCount = managed?.services.length ?? 0;

  const feeDistribution = health.creators.map((c) => ({
    wallet: c.wallet,
    username: c.username,
    bps: c.royaltyBps,
    isTend: managed?.services.some((s) => s.claimerWallet === c.wallet),
    tendServiceId: managed?.services.find((s) => s.claimerWallet === c.wallet)
      ?.serviceId,
  }));

  return (
    <div className="max-w-[1280px] mx-auto px-6 py-8 fade-in">
      {/* ─── Back + Header ─── */}
      <div className="flex items-center gap-2 text-[12px] text-[var(--text-muted)] mb-5 font-mono">
        <Link
          href="/"
          className="flex items-center gap-1 hover:text-[var(--accent)] transition-colors"
        >
          <ArrowLeft size={12} />
          Scores
        </Link>
        <span className="text-[var(--border-hover)]">/</span>
        <span className="text-[var(--text-secondary)]">
          {health.tokenSymbol ?? mint.slice(0, 8)}
        </span>
      </div>

      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-1.5">
            <h1 className="font-display text-2xl font-bold tracking-tight">
              {health.tokenName ?? mint.slice(0, 16) + "..."}
            </h1>
            {health.tokenSymbol && (
              <span className="text-[var(--accent)] font-display font-semibold text-lg">
                ${health.tokenSymbol}
              </span>
            )}
            {tendActive && (
              <span
                className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded"
                style={{
                  backgroundColor: "rgba(0, 255, 178, 0.08)",
                  color: "var(--accent)",
                  border: "1px solid rgba(0, 255, 178, 0.2)",
                }}
              >
                <Bot size={10} />
                {activeServiceCount} active
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-[12px]">
            <span className="font-mono text-[var(--text-muted)]">
              {mint.slice(0, 6)}...{mint.slice(-4)}
            </span>
            <a
              href={`https://bags.fm/${mint}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent)] hover:underline inline-flex items-center gap-1"
            >
              Bags.fm <ExternalLink size={10} />
            </a>
            <a
              href={`https://solscan.io/token/${mint}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--text-muted)] hover:text-white transition-colors inline-flex items-center gap-1"
            >
              Solscan <ExternalLink size={10} />
            </a>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleShare}
            className="btn-secondary px-3 py-2 rounded-lg text-xs flex items-center gap-1.5"
          >
            <Share2 size={12} />
            {copied ? "Copied!" : "Share"}
          </button>
          <button
            onClick={handleActivate}
            className="gradient-btn px-5 py-2 rounded-lg text-sm font-semibold flex items-center gap-1.5"
          >
            <Zap size={14} />
            {connected
              ? tendActive
                ? "Add Service"
                : "Activate Tend"
              : "Connect & Activate"}
          </button>
        </div>
      </div>

      {/* ─── Stats Row ─── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-4 py-4">
          <p className="text-xl font-semibold font-mono">
            {formatSol(health.lifetimeFees)}
          </p>
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-1">
            Lifetime Fees
          </p>
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-4 py-4">
          <p className="text-xl font-semibold font-mono text-[var(--accent)]">
            {formatSol(health.unclaimedEstimate)}
          </p>
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-1">
            Unclaimed
          </p>
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-4 py-4">
          <p className="text-xl font-semibold font-mono">
            {activeServiceCount}
          </p>
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-1">
            Active Services
          </p>
        </div>
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-4 py-4">
          <p className="text-xl font-semibold font-mono">
            {health.creators.length}
          </p>
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-1">
            Fee Claimers
          </p>
        </div>
      </div>

      {/* ─── Main Grid ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ─── Left Column: Growth Feed ─── */}
        <div className="lg:col-span-2 space-y-6">
          {/* Growth Feed */}
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bot size={14} className="text-[var(--accent)]" />
                <h2 className="text-sm font-display font-semibold">
                  Live Growth Feed
                </h2>
              </div>
              {decisions.length > 0 && (
                <span className="text-[10px] text-[var(--text-muted)] font-mono">
                  {decisions.length} decision
                  {decisions.length > 1 ? "s" : ""}
                </span>
              )}
            </div>

            {decisions.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <Bot
                  size={24}
                  className="text-[var(--text-muted)] mx-auto mb-2.5 opacity-30"
                />
                <p className="text-sm text-[var(--text-muted)] mb-1">
                  No agent activity yet
                </p>
                <p className="text-xs text-[var(--text-muted)] max-w-sm mx-auto">
                  {tendActive
                    ? "The agent is active. Decisions will appear here as fees accumulate."
                    : "Activate Tend to see AI-powered buyback decisions and growth actions."}
                </p>
              </div>
            ) : (
              <>
                <div className="divide-y divide-[var(--border)]">
                  {decisions
                    .slice(0, showAllDecisions ? 30 : 5)
                    .map((d, i) => (
                      <div
                        key={i}
                        className="px-5 py-3.5 hover:bg-[var(--bg-card-hover)] transition-colors"
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <ActionBadge action={d.decision.action} />
                            {d.decision.amount_pct > 0 && (
                              <span className="text-[11px] font-mono text-[var(--text-secondary)]">
                                {d.decision.amount_pct}%
                              </span>
                            )}
                            {d.execution.executed &&
                              d.execution.tokens_bought !== undefined &&
                              d.execution.tokens_bought > 0 && (
                                <span className="text-[11px] font-mono text-[var(--accent)]">
                                  +
                                  {d.execution.tokens_bought.toLocaleString(
                                    undefined,
                                    { maximumFractionDigits: 0 }
                                  )}{" "}
                                  tokens
                                </span>
                              )}
                          </div>
                          <div className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                            <Clock size={10} />
                            <span className="font-mono">
                              {timeAgo(d.timestamp)}
                            </span>
                          </div>
                        </div>

                        <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed mb-1.5">
                          {d.decision.reasoning}
                        </p>

                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 text-[10px] text-[var(--text-muted)] font-mono">
                            <span>
                              price={d.inputs.price_sol.toFixed(9)}
                            </span>
                            <span>vel={d.inputs.fee_velocity}</span>
                          </div>
                          {d.execution.executed &&
                            d.execution.tx_signature && (
                              <a
                                href={`https://solscan.io/tx/${d.execution.tx_signature}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[10px] text-[var(--accent)] hover:underline font-mono inline-flex items-center gap-1"
                              >
                                {d.execution.tx_signature.slice(0, 12)}...
                                <ExternalLink size={8} />
                              </a>
                            )}
                        </div>
                      </div>
                    ))}
                </div>
                {decisions.length > 5 && (
                  <button
                    onClick={() => setShowAllDecisions(!showAllDecisions)}
                    className="w-full py-2.5 text-xs text-[var(--accent)] hover:bg-[var(--bg-card-hover)] transition-colors border-t border-[var(--border)] font-medium"
                  >
                    {showAllDecisions
                      ? "Show less"
                      : `Show all ${decisions.length} decisions`}
                  </button>
                )}
              </>
            )}
          </div>

          {/* Fee Distribution */}
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-5">
            <h3 className="text-sm font-display font-semibold mb-4 flex items-center gap-2">
              <span className="text-[var(--accent)]">●</span>
              On-chain Fee Distribution
            </h3>

            {feeDistribution.length > 0 ? (
              <>
                {/* Bar */}
                <div className="flex h-2.5 rounded-full overflow-hidden gap-px mb-4">
                  {feeDistribution.map((c, i) => {
                    const colors = [
                      "#555",
                      "var(--accent)",
                      "var(--accent-secondary)",
                      "#a855f7",
                      "#f59e0b",
                    ];
                    return (
                      <div
                        key={i}
                        className="rounded-full transition-all"
                        style={{
                          width: `${c.bps / 100}%`,
                          backgroundColor: c.isTend
                            ? "var(--accent)"
                            : colors[i % colors.length],
                        }}
                        title={`${c.username || c.wallet.slice(0, 8)} — ${c.bps} BPS`}
                      />
                    );
                  })}
                </div>

                {/* Legend */}
                <div className="space-y-1.5">
                  {feeDistribution.map((c, i) => {
                    const colors = [
                      "#555",
                      "var(--accent)",
                      "var(--accent-secondary)",
                      "#a855f7",
                      "#f59e0b",
                    ];
                    return (
                      <div
                        key={i}
                        className="flex items-center justify-between text-[12px] py-1"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{
                              backgroundColor: c.isTend
                                ? "var(--accent)"
                                : colors[i % colors.length],
                            }}
                          />
                          {c.isTend && (
                            <span className="text-[9px] px-1.5 py-px rounded bg-[var(--accent-dim)] text-[var(--accent)] font-semibold">
                              TEND
                            </span>
                          )}
                          <span className="text-[var(--text-secondary)]">
                            {c.isTend
                              ? c.tendServiceId
                              : c.username ||
                                c.wallet.slice(0, 6) + "..." + c.wallet.slice(-4)}
                          </span>
                        </div>
                        <span className="font-mono text-[var(--text-muted)]">
                          {(c.bps / 100).toFixed(0)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <p className="text-xs text-[var(--text-muted)] py-4 text-center">
                No fee-share config found on-chain.
              </p>
            )}
          </div>
        </div>

        {/* ─── Right Column ─── */}
        <div className="space-y-6">
          {/* Intelligence Report */}
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-5">
            <h3 className="text-sm font-display font-semibold mb-4 flex items-center gap-2">
              <Bot size={14} className="text-purple-400" />
              Intelligence Report
            </h3>

            {!report ? (
              <p className="text-xs text-[var(--text-muted)] py-4 text-center leading-relaxed">
                No reports yet. The Analytics Engine generates reports every 2
                hours when active.
              </p>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-mono">
                      Health
                    </span>
                    <TrendBadge trend={report.trend} />
                  </div>
                  <HealthBar score={report.health_score} />
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">Fees</span>
                    <span className="font-mono">
                      {report.data.lifetime_fees_sol.toFixed(4)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">Velocity</span>
                    <span className="font-mono">
                      {report.data.fee_velocity}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">Holders</span>
                    <span className="font-mono">{report.data.holders}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">Buybacks</span>
                    <span className="font-mono">
                      {report.data.buyback_count}
                    </span>
                  </div>
                </div>

                {report.key_insights.length > 0 && (
                  <div>
                    <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-mono mb-1.5">
                      Insights
                    </p>
                    <ul className="space-y-1">
                      {report.key_insights.map((insight, i) => (
                        <li
                          key={i}
                          className="text-[12px] text-[var(--text-secondary)] flex gap-1.5"
                        >
                          <span className="text-[var(--accent)] shrink-0">
                            ›
                          </span>
                          {insight}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {report.risks.length > 0 && (
                  <div>
                    <p className="text-[10px] text-red-400/70 uppercase tracking-wider font-mono mb-1.5">
                      Risks
                    </p>
                    <ul className="space-y-1">
                      {report.risks.map((risk, i) => (
                        <li
                          key={i}
                          className="text-[12px] text-[var(--text-secondary)] flex gap-1.5"
                        >
                          <span className="text-red-400 shrink-0">!</span>
                          {risk}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {report.opportunities.length > 0 && (
                  <div>
                    <p className="text-[10px] text-emerald-400/70 uppercase tracking-wider font-mono mb-1.5">
                      Opportunities
                    </p>
                    <ul className="space-y-1">
                      {report.opportunities.map((opp, i) => (
                        <li
                          key={i}
                          className="text-[12px] text-[var(--text-secondary)] flex gap-1.5"
                        >
                          <span className="text-emerald-400 shrink-0">+</span>
                          {opp}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="text-[10px] text-[var(--text-muted)] font-mono text-right">
                  {new Date(report.timestamp).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            )}
          </div>

          {/* Activate Tend CTA */}
          {!tendActive && (
            <div
              className="bg-[var(--bg-card)] border rounded-2xl p-5"
              style={{ borderColor: "rgba(0, 255, 178, 0.15)" }}
            >
              <h3 className="text-sm font-display font-semibold mb-2 flex items-center gap-2">
                <Zap size={14} className="text-[var(--accent)]" />
                Activate Tend
              </h3>
              <p className="text-xs text-[var(--text-muted)] leading-relaxed mb-4">
                Route trading fees to automatic buybacks, rewards, or treasury.
                One transaction, fully revocable.
              </p>

              <button
                onClick={handleActivate}
                className="w-full gradient-btn py-2.5 rounded-lg text-sm font-semibold"
              >
                {connected ? "Activate Now" : "Connect Wallet"}
              </button>
            </div>
          )}

          {/* Active Services */}
          {tendActive && managed && (
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-5">
              <h3 className="text-sm font-display font-semibold mb-3 flex items-center gap-2">
                <Shield size={14} className="text-[var(--accent)]" />
                Active Services
              </h3>
              <div className="space-y-2.5">
                {managed.services.map((s) => (
                  <div
                    key={s.serviceId}
                    className="flex items-center justify-between text-[12px] py-2 border-b border-[var(--border)] last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_4px_var(--accent)]" />
                      <span className="font-medium">
                        {s.serviceId}
                      </span>
                    </div>
                    <span className="font-mono text-[var(--text-muted)]">
                      {s.bps} BPS
                    </span>
                  </div>
                ))}
              </div>
              <button
                onClick={() => setShowAddModal(true)}
                className="w-full mt-3 btn-secondary py-2 rounded-lg text-xs"
              >
                + Add another service
              </button>
            </div>
          )}

          {/* How it works — for tokens without Tend */}
          {!tendActive && (
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-5">
              <h3 className="text-sm font-display font-semibold mb-3">
                How Tend works
              </h3>
              <div className="space-y-3 text-xs text-[var(--text-muted)]">
                {[
                  "Connect your wallet (must be token admin)",
                  "Choose an AI service and set fee allocation",
                  "Sign one on-chain transaction to configure fee-sharing",
                  "Services auto-claim and execute — all logged with reasoning",
                ].map((step, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="text-[var(--accent)] font-bold shrink-0 font-mono">
                      {i + 1}.
                    </span>
                    <span>{step}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ─── Activate Modal ─── */}
      {showAddModal && (
        <ActivateModal
          tokenMint={mint}
          existingServiceIds={managed?.services.map((s) => s.serviceId) ?? []}
          availableBps={
            managed?.creatorBps ??
            10_000 - feeDistribution.reduce((s, c) => s + c.bps, 0)
          }
          onClose={() => setShowAddModal(false)}
          onActivated={fetchAll}
        />
      )}
    </div>
  );
}
