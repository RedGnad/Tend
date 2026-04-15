import Link from "next/link";
import {
  ArrowRight,
  Coins,
  Sparkles,
  Shield,
  Terminal,
  Zap,
  Gift,
  Trophy,
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

      {/* How to activate — via MCP */}
      <section id="activate" className="mb-16 scroll-mt-20">
        <p className="text-[11px] text-[var(--accent)] uppercase tracking-[0.15em] font-mono font-semibold mb-2">
          How to activate
        </p>
        <h2 className="text-[clamp(1.4rem,3vw,1.9rem)] font-bold font-display tracking-tight mb-2">
          Your control plane lives in Claude Desktop
        </h2>
        <p className="text-[14px] text-[var(--text-muted)] mb-8 max-w-[640px]">
          Tend ships as an MCP server — the creator console is natural
          language. Install once, then drive every campaign from a chat.
        </p>

        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Terminal size={14} className="text-[var(--accent)]" />
            <h3 className="text-[13px] font-semibold font-mono uppercase tracking-wider">
              1 · Add Tend to{" "}
              <code className="text-[var(--accent)]">
                claude_desktop_config.json
              </code>
            </h3>
          </div>
          <pre className="text-[11px] font-mono bg-[var(--bg)] border border-[var(--border)] rounded-lg p-4 overflow-x-auto leading-relaxed">
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
        </div>

        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Terminal size={14} className="text-[var(--accent)]" />
            <h3 className="text-[13px] font-semibold font-mono uppercase tracking-wider">
              2 · Six creator tools, one conversation
            </h3>
          </div>
          <div className="space-y-3">
            {[
              {
                tool: "create_campaign",
                example:
                  '"Create a 2% cashback campaign on <mint> with a 0.04 SOL pool"',
              },
              {
                tool: "create_holder_campaign",
                example:
                  '"Create a holder campaign on <mint>: 1% per snapshot, 1h min hold, every 2h, 0.02 SOL pool"',
              },
              {
                tool: "create_sprint_campaign",
                example:
                  '"Launch a sprint on <mint>: 0.005 SOL bonus, 6 winners, min buy 0.01 SOL, 0.03 SOL pool"',
              },
              {
                tool: "view_campaign_stats",
                example: '"Show me the stats for my <mint> campaign"',
              },
              {
                tool: "topup_pool",
                example: '"Top up the <mint> pool with 0.02 SOL"',
              },
              {
                tool: "pause_campaign",
                example: '"Pause the <mint> campaign"',
              },
            ].map((cmd) => (
              <div
                key={cmd.tool}
                className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4 text-[12px]"
              >
                <code className="font-mono text-[var(--accent)] sm:w-[200px] flex-shrink-0">
                  {cmd.tool}
                </code>
                <span className="text-[var(--text-muted)] italic leading-relaxed">
                  {cmd.example}
                </span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-[var(--text-muted)] mt-5 pt-4 border-t border-[var(--border)]">
            Under the hood each tool calls the Bags SDK, writes the canonical
            state, and (for creation) broadcasts a real on-chain tx. No hidden
            writes, no local-only fantasy.
          </p>
        </div>
      </section>

      {/* Bottom CTA */}
      <section>
        <div
          className="bg-[var(--bg-card)] border rounded-2xl p-10 text-center"
          style={{ borderColor: "rgba(0, 255, 178, 0.12)" }}
        >
          <h2 className="text-[clamp(1.3rem,3vw,1.8rem)] font-bold font-display tracking-tight mb-3">
            Running Bags Tend on your own token?
          </h2>
          <p className="text-[13px] text-[var(--text-muted)] max-w-[520px] mx-auto mb-6">
            The repo is open-source. Clone it, plug in your keys, and your
            control plane is live in under five minutes.
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
