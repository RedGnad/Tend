import { TokenManager } from "@/components/token-manager";
import { Leaderboard } from "@/components/leaderboard";
import { ActivityFeed } from "@/components/activity-feed";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <div className="max-w-6xl mx-auto fade-in">
      {/* Header */}
      <div className="page-header mb-10">
        <p className="section-label mb-3"><span>01</span> — Dashboard</p>
        <h2 className="gradient-text">Manage Your Tokens</h2>
        <p>Attach AI services to your Bags.fm tokens and let fees do the work.</p>
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left — token management */}
        <div className="lg:col-span-2 space-y-6">
          <TokenManager />
        </div>

        {/* Right — discovery + activity */}
        <div className="space-y-6">
          <Leaderboard />
          <ActivityFeed />
        </div>
      </div>
    </div>
  );
}
