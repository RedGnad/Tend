import { TokenManager } from "@/components/token-manager";
import { ActivityFeed } from "@/components/activity-feed";
import { StatsBar } from "@/components/stats-bar";
import { Leaderboard } from "@/components/leaderboard";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <div className="max-w-6xl mx-auto fade-in">
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-3xl font-bold gradient-text">Dashboard</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Attach AI services to your tokens. They earn fees, they work for you.
        </p>
      </div>

      <StatsBar />

      {/* Main grid */}
      <div className="grid grid-cols-3 gap-6 mt-8">
        {/* Left — token management */}
        <div className="col-span-2 space-y-6">
          <TokenManager />
        </div>

        {/* Right — activity + leaderboard + explainer */}
        <div className="space-y-6">
          <ActivityFeed />
          <Leaderboard />

          <div className="card">
            <h3 className="text-sm font-semibold mb-3">How it works</h3>
            <div className="space-y-3 text-xs text-[var(--text-muted)]">
              <div className="flex gap-3">
                <span className="w-5 h-5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                  1
                </span>
                <p>Connect wallet & select your token</p>
              </div>
              <div className="flex gap-3">
                <span className="w-5 h-5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                  2
                </span>
                <p>Choose an AI service & set fee allocation</p>
              </div>
              <div className="flex gap-3">
                <span className="w-5 h-5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                  3
                </span>
                <p>Tend updates fee-sharing config on-chain</p>
              </div>
              <div className="flex gap-3">
                <span className="w-5 h-5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)] text-[10px] font-bold flex items-center justify-center flex-shrink-0">
                  4
                </span>
                <p>Services claim fees & execute autonomously</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
