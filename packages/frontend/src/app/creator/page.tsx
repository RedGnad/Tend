import Link from "next/link";
import {
  ArrowRight,
  Coins,
  Sparkles,
  Shield,
  Zap,
  Gift,
  Trophy,
  GitBranch,
  Play,
  Settings,
  Terminal,
  ExternalLink,
} from "lucide-react";

export default function CreatorPage() {
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
          <p className="text-[16px] text-[var(--text-secondary)] leading-relaxed max-w-[580px] mx-auto mb-10">
            Allocate a slice of your Bags fee-share to a reward pool. Three
            live campaign types, one AI fraud gate, every payout auditable
            on-chain.
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <a
              href="#activate"
              className="gradient-btn px-6 py-3 rounded-xl text-[14px] font-semibold inline-flex items-center gap-2"
            >
              How to activate <ArrowRight size={14} />
            </a>
            <Link
              href="/campaigns"
              className="btn-secondary px-6 py-3 rounded-xl text-[14px] inline-flex items-center gap-2"
            >
              See live campaigns
            </Link>
          </div>
        </div>
      </section>

      {/* Why */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-16">
        {[
          {
            icon: Coins,
            title: "Real on-chain acquisition",
            desc: "Every SOL of reward routes to a real buyer or holder wallet, logged with a Solscan link. No bots, no inflated volume.",
          },
          {
            icon: Zap,
            title: "Funded by your fees",
            desc: "Pool is topped up from your Bags creator fee-share. No upfront capital, no marketing agency.",
          },
          {
            icon: Shield,
            title: "AI-vetted payouts",
            desc: "Every payout clears a Claude Haiku fraud gate before it ships. Sybil patterns, bot clusters, and self-buys get rejected.",
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

      {/* Campaign types — creator-facing */}
      <section className="mb-16">
        <p className="text-[11px] text-[var(--accent)] uppercase tracking-[0.15em] font-mono font-semibold mb-2">
          Three live growth loops
        </p>
        <h2 className="text-[clamp(1.4rem,3vw,1.9rem)] font-bold font-display tracking-tight mb-6">
          Pick what fits your stage
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              icon: Gift,
              name: "Cashback",
              when: "Best for steady volume",
              knobs: "cashbackBps · poolCap",
              desc: "Every qualifying buy gets a % of the trade back in SOL. Traders have a direct reason to buy your token over the one next door.",
            },
            {
              icon: Coins,
              name: "Holder dividends",
              when: "Best for loyalty",
              knobs: "rewardBps · minHoldHours · snapshotCronHours",
              desc: "Pay holders pro-rata on each snapshot. Gated by minimum hold time — punishes flippers, rewards believers.",
            },
            {
              icon: Trophy,
              name: "Launch sprint",
              when: "Best for launch day",
              knobs: "bonusSol · maxWinners · minBuySol",
              desc: "Flat SOL bonus to the first N qualifying buyers. Creates real launch-day urgency without airdrop farming.",
            },
          ].map((t) => (
            <div
              key={t.name}
              className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-5"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-xl bg-[var(--accent-dim)] flex items-center justify-center">
                  <t.icon size={15} className="text-[var(--accent)]" />
                </div>
                <div>
                  <h3 className="text-[15px] font-semibold font-display">
                    {t.name}
                  </h3>
                  <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
                    {t.when}
                  </p>
                </div>
              </div>
              <p className="text-[12px] text-[var(--text-muted)] leading-relaxed mb-3">
                {t.desc}
              </p>
              <p className="text-[10px] font-mono text-[var(--accent)] bg-[var(--bg)] rounded-md px-2 py-1.5 border border-[var(--border)]">
                {t.knobs}
              </p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-[var(--text-muted)] mt-4 text-center">
          Referral campaigns ship in Q3 — same fraud gate, same payout rail.
        </p>
      </section>

      {/* How to activate — 3 steps */}
      <section id="activate" className="mb-16 scroll-mt-20">
        <p className="text-[11px] text-[var(--accent)] uppercase tracking-[0.15em] font-mono font-semibold mb-2">
          How to activate
        </p>
        <h2 className="text-[clamp(1.4rem,3vw,1.9rem)] font-bold font-display tracking-tight mb-2">
          Three steps to launch your first campaign
        </h2>
        <p className="text-[14px] text-[var(--text-muted)] mb-8 max-w-[640px]">
          Tend is open-source. Clone the repo, configure your token, and the
          agent handles everything from swap detection to payout.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-[var(--border)] rounded-2xl overflow-hidden mb-8">
          {[
            {
              step: "01",
              icon: GitBranch,
              title: "Clone & configure",
              desc: "Clone the repo, add your BAGS_API_KEY, SOLANA_RPC_URL, and TEND_PRIVATE_KEY. Define your campaign type and parameters in the agent config.",
            },
            {
              step: "02",
              icon: Play,
              title: "Run the agent",
              desc: "Start the Tend agent. It watches the chain for qualifying swaps, runs every wallet through the Claude AI fraud gate, and pays out SOL automatically.",
            },
            {
              step: "03",
              icon: Settings,
              title: "Monitor & adjust",
              desc: "Check the dashboard for live stats, payout history, and fraud verdicts. Pause, top-up, or launch new campaigns as you go.",
            },
          ].map((s) => (
            <div key={s.step} className="bg-[var(--bg-card)] p-8">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-[32px] font-bold font-display text-[var(--border-hover)] leading-none">
                  {s.step}
                </span>
                <div className="w-8 h-8 rounded-lg bg-[var(--accent-dim)] flex items-center justify-center">
                  <s.icon size={14} className="text-[var(--accent)]" />
                </div>
              </div>
              <h3 className="text-base font-semibold mb-2">{s.title}</h3>
              <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">
                {s.desc}
              </p>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-center gap-3 flex-wrap">
          <a
            href="https://github.com/RedGnad/Tend"
            target="_blank"
            rel="noopener noreferrer"
            className="gradient-btn px-6 py-3 rounded-xl text-[14px] font-semibold inline-flex items-center gap-2"
          >
            View on GitHub <ExternalLink size={13} />
          </a>
          <a
            href="#mcp"
            className="btn-secondary px-6 py-3 rounded-xl text-[14px] inline-flex items-center gap-2"
          >
            <Terminal size={14} />
            Advanced: Claude Desktop
          </a>
        </div>
      </section>

      {/* MCP — secondary, collapsed feel */}
      <section id="mcp" className="mb-16 scroll-mt-20">
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-2">
            <Terminal size={14} className="text-[var(--accent)]" />
            <p className="text-[11px] text-[var(--accent)] uppercase tracking-[0.15em] font-mono font-semibold">
              Advanced: Claude Desktop MCP
            </p>
          </div>
          <p className="text-[14px] text-[var(--text-muted)] mb-5 max-w-[640px]">
            Tend also ships as an MCP server. Power users can manage campaigns
            in natural language from Claude Desktop — create, pause, top-up,
            and review payouts from a chat.
          </p>

          <pre className="text-[11px] font-mono bg-[var(--bg)] border border-[var(--border)] rounded-lg p-4 overflow-x-auto leading-relaxed mb-5">
{`{
  "mcpServers": {
    "tend": {
      "command": "node",
      "args": ["<path>/packages/mcp-server/build/index.js"],
      "env": {
        "BAGS_API_KEY": "...",
        "SOLANA_RPC_URL": "...",
        "TEND_PRIVATE_KEY": "...",
        "ANTHROPIC_API_KEY": "..."
      }
    }
  }
}`}
          </pre>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[
              "create_campaign",
              "view_campaign_stats",
              "topup_pool",
              "pause_campaign",
              "create_holder_campaign",
              "create_sprint_campaign",
            ].map((tool) => (
              <div
                key={tool}
                className="text-[10px] font-mono text-[var(--accent)] bg-[var(--bg)] rounded-md px-2 py-1.5 border border-[var(--border)] truncate"
              >
                {tool}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section>
        <div
          className="bg-[var(--bg-card)] border rounded-2xl p-10 text-center"
          style={{ borderColor: "rgba(0, 255, 178, 0.12)" }}
        >
          <h2 className="text-[clamp(1.3rem,3vw,1.8rem)] font-bold font-display tracking-tight mb-3">
            Running Tend on your own token?
          </h2>
          <p className="text-[13px] text-[var(--text-muted)] max-w-[520px] mx-auto mb-6">
            The repo is open-source. Clone it, plug in your keys, and your
            first campaign is live in under five minutes.
          </p>
          <a
            href="https://github.com/RedGnad/Tend"
            target="_blank"
            rel="noopener noreferrer"
            className="gradient-btn px-6 py-2.5 rounded-lg text-sm font-semibold inline-flex items-center gap-2"
          >
            View on GitHub <ArrowRight size={13} />
          </a>
        </div>
      </section>
    </div>
  );
}
