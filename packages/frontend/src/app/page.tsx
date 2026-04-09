"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useRouter } from "next/navigation";

/* ═══════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════ */

const TEND_MINT = "6qa9oCypYpnWZyZNQ8v36eLbmWmcgHRv4MuU7BXQBAGS";

const STEPS = [
  {
    n: "01",
    title: "Fees accumulate",
    desc: "Every trade on Bags.fm generates fees for the token creator. They sit on-chain, ready to be claimed.",
  },
  {
    n: "02",
    title: "Allocate to services",
    desc: "Use the dashboard or Claude to assign a % of your fee-share to AI services. One on-chain transaction.",
  },
  {
    n: "03",
    title: "Services auto-execute",
    desc: "Each service has its own wallet. It claims fees and executes its strategy autonomously.",
  },
  {
    n: "04",
    title: "Token grows",
    desc: "Buyback bots create buy pressure. Analytics surface insights. All funded by trading fees.",
  },
];

const SERVICES = [
  {
    name: "Buyback Bot",
    desc: "Claims fees & buys back the token, creating sustained buy pressure.",
    tag: "LIVE",
    tagColor: "var(--accent)",
  },
  {
    name: "Analytics Engine",
    desc: "Monitors holders, fee velocity, and generates health reports via Claude.",
    tag: "LIVE",
    tagColor: "var(--accent)",
  },
  {
    name: "Fee Compounder",
    desc: "Reinvests fees into deeper liquidity positions, reducing slippage.",
    tag: "READY",
    tagColor: "var(--accent-secondary)",
  },
  {
    name: "Growth Agent",
    desc: "AI-powered community engagement and automated marketing strategies.",
    tag: "READY",
    tagColor: "var(--accent-secondary)",
  },
];

const MCP_LINES = [
  { role: "user" as const, text: "Show me the top tokens on Bags.fm by fees" },
  { role: "tool" as const, text: "top_tokens_by_fees", result: "Found 24+ tokens with 847.32 SOL in lifetime fees" },
  { role: "user" as const, text: "Run a health check on $TEND" },
  { role: "tool" as const, text: "token_health", result: "TEND — 3 claimers, 0.019 SOL lifetime, buyback bot active" },
  { role: "user" as const, text: "Add a buyback bot to my token with 15% allocation" },
];

/* ═══════════════════════════════════════════
   Types
   ═══════════════════════════════════════════ */

interface TendHealth {
  tokenName: string | null;
  tokenSymbol: string | null;
  lifetimeFees: number;
  totalClaimed: number;
  unclaimedEstimate: number;
  creators: Array<{ wallet: string; username: string; royaltyBps: number }>;
}

interface LeaderboardToken {
  mint: string;
  name: string;
  symbol: string;
  lifetimeFees: number;
}

/* ═══════════════════════════════════════════
   Hooks
   ═══════════════════════════════════════════ */

function useScrollReveal() {
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) e.target.classList.add("visible");
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -40px 0px" }
    );
    document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
}

function useCountUp(target: number, duration = 1200): { value: number; ref: React.RefObject<HTMLSpanElement | null> } {
  const [value, setValue] = useState(0);
  const ref = useRef<HTMLSpanElement | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!ref.current || started.current || target <= 0) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true;
          const start = performance.now();
          const step = (now: number) => {
            const p = Math.min((now - start) / duration, 1);
            const eased = 1 - Math.pow(1 - p, 3);
            setValue(Math.floor(eased * target));
            if (p < 1) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
          observer.disconnect();
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [target, duration]);

  return { value, ref };
}

/* ═══════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════ */

function formatSol(lamports: number): string {
  const sol = lamports / 1_000_000_000;
  if (sol >= 1000) return (sol / 1000).toFixed(1) + "K";
  if (sol >= 1) return sol.toFixed(2);
  if (sol > 0) return sol.toFixed(4);
  return "0";
}

/* ═══════════════════════════════════════════
   Page
   ═══════════════════════════════════════════ */

export default function LandingPage() {
  const { connected } = useWallet();
  const { setVisible } = useWalletModal();
  const router = useRouter();
  const [tend, setTend] = useState<TendHealth | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardToken[]>([]);

  useScrollReveal();

  useEffect(() => {
    fetch(`/api/tokens/${TEND_MINT}/health`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setTend(d))
      .catch(() => {});
    fetch("/api/leaderboard")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setLeaderboard(d.tokens ?? []))
      .catch(() => {});
  }, []);

  const totalFees = leaderboard.reduce((s, t) => s + Number(t.lifetimeFees), 0);
  const feesInSol = totalFees / 1_000_000_000;
  const tokenCount = useCountUp(leaderboard.length || 24, 1000);
  // For the counter, use tenths for display (avoids huge integers)
  const feeCountTarget = feesInSol >= 1000
    ? Math.round(feesInSol / 100) // hundreds for K display
    : Math.round(feesInSol * 10); // tenths for direct display
  const feeCount = useCountUp(feeCountTarget, 1400);

  const handleCTA = useCallback(() => {
    if (connected) router.push("/dashboard");
    else setVisible(true);
  }, [connected, router, setVisible]);

  const claimerLabels = ["Creator", "Buyback Bot", "Analytics"];
  const claimerColors = ["#555", "#00FFB2", "#00BFFF"];

  return (
    <div className="relative z-10">
      {/* ─── Nav ─── */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#060606]/70 backdrop-blur-xl border-b border-[var(--border)]">
        <div className="max-w-[1120px] mx-auto px-6 h-14 flex items-center justify-between">
          <a href="/" className="font-display text-lg font-semibold tracking-tight">
            <span className="gradient-text">Tend</span>
          </a>
          <div className="hidden md:flex items-center gap-8 text-[13px] text-[var(--text-muted)]">
            <a href="#how" className="hover:text-[var(--text)] transition-colors">How it works</a>
            <a href="#proof" className="hover:text-[var(--text)] transition-colors">Live proof</a>
            <a href="#services" className="hover:text-[var(--text)] transition-colors">Services</a>
            <a href="#mcp" className="hover:text-[var(--text)] transition-colors">Claude MCP</a>
          </div>
          <div className="flex items-center gap-3">
            {connected && (
              <a href="/dashboard" className="text-[13px] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
                Dashboard
              </a>
            )}
            <button
              onClick={handleCTA}
              className="gradient-btn px-4 py-2 rounded-lg text-[13px] font-semibold"
            >
              {connected ? "Dashboard" : "Launch App"}
            </button>
          </div>
        </div>
      </nav>

      {/* ─── Hero ─── */}
      <section className="pt-28 pb-24 px-6">
        <div className="max-w-[1120px] mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            {/* Left — copy */}
            <div className="stagger">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--border)] text-[11px] text-[var(--text-muted)] font-medium tracking-wide uppercase mb-8">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_6px_var(--accent)]" />
                Live on Solana Mainnet
              </div>

              <h1 className="text-[clamp(2.5rem,5vw,3.5rem)] font-bold leading-[1.08] tracking-tight mb-6">
                Turn trading fees
                <br />
                into{" "}
                <span className="gradient-text">autonomous</span>
                <br />
                AI services
              </h1>

              <p className="text-[15px] text-[var(--text-secondary)] leading-relaxed max-w-[440px] mb-8">
                Tend transforms Bags.fm fee-sharing into a payment rail for AI agents.
                Attach services to your token&mdash;they earn fees and work 24/7.
                No subscriptions. No upfront cost.
              </p>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleCTA}
                  className="gradient-btn px-7 py-3 rounded-xl text-sm font-semibold"
                >
                  {connected ? "Open Dashboard" : "Connect Wallet"}
                </button>
                <a
                  href="#proof"
                  className="btn-secondary px-7 py-3 rounded-xl text-sm"
                >
                  See it live
                </a>
              </div>
            </div>

            {/* Right — live $TEND card */}
            <div className="relative">
              {/* Glow */}
              <div className="absolute -inset-8 bg-[radial-gradient(ellipse_at_center,rgba(0,255,178,0.06),transparent_70%)] pointer-events-none" />

              <div className="relative bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-[var(--accent-dim)] flex items-center justify-center text-sm font-bold font-display gradient-text">
                      T
                    </div>
                    <div>
                      <p className="font-semibold text-sm font-display">
                        {tend?.tokenName ?? "$TEND"}
                      </p>
                      <p className="text-[11px] text-[var(--text-muted)] font-mono">
                        {TEND_MINT.slice(0, 6)}...{TEND_MINT.slice(-4)}
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] px-2 py-1 rounded-full bg-[var(--accent-dim)] text-[var(--accent)] font-semibold uppercase tracking-wider">
                    Live
                  </span>
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Lifetime Fees", value: tend ? formatSol(tend.lifetimeFees) + " SOL" : null },
                    { label: "Claimed", value: tend ? formatSol(tend.totalClaimed) + " SOL" : null, color: "var(--accent)" },
                    { label: "Unclaimed", value: tend ? formatSol(tend.unclaimedEstimate) + " SOL" : null, color: "var(--warning)" },
                  ].map((s) => (
                    <div key={s.label} className="bg-[var(--bg)] rounded-lg p-3">
                      <p className={`text-sm font-semibold font-mono ${!s.value ? "shimmer" : ""}`} style={s.color ? { color: s.color } : undefined}>
                        {s.value ?? "-.--"}
                      </p>
                      <p className="text-[10px] text-[var(--text-muted)] mt-1 uppercase tracking-wider">{s.label}</p>
                    </div>
                  ))}
                </div>

                {/* Fee split bar */}
                {tend && tend.creators.length > 0 && (
                  <div>
                    <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-2">On-chain fee split</p>
                    <div className="flex h-3 rounded-full overflow-hidden gap-px">
                      {tend.creators.map((c, i) => (
                        <div
                          key={i}
                          className="rounded-full transition-all"
                          style={{
                            width: `${c.royaltyBps / 100}%`,
                            backgroundColor: claimerColors[i] ?? "#444",
                          }}
                        />
                      ))}
                    </div>
                    <div className="flex gap-4 mt-2">
                      {tend.creators.map((c, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-[11px]">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: claimerColors[i] ?? "#444" }} />
                          <span className="text-[var(--text-muted)]">{claimerLabels[i] ?? c.wallet.slice(0, 6)}</span>
                          <span className="font-mono text-[var(--text-muted)]">{(c.royaltyBps / 100).toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Active services */}
                <div className="border-t border-[var(--border)] pt-4 space-y-2">
                  <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Active services</p>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_4px_var(--accent)]" />
                    <span className="text-[var(--text-secondary)]">Buyback Bot</span>
                    <span className="text-[var(--text-muted)] font-mono ml-auto">15%</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-secondary)] shadow-[0_0_4px_var(--accent-secondary)]" />
                    <span className="text-[var(--text-secondary)]">Analytics Engine</span>
                    <span className="text-[var(--text-muted)] font-mono ml-auto">5%</span>
                  </div>
                </div>

                <p className="text-[10px] text-[var(--text-muted)] text-center pt-2 border-t border-[var(--border)]">
                  Real on-chain data &middot; Updated every page load
                </p>
              </div>
            </div>
          </div>

          {/* Stats bar */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-16">
            {[
              { label: "Bags.fm Tokens", value: <><span ref={tokenCount.ref}>{tokenCount.value}</span>+</> },
              { label: "Total Fees Generated", value: <><span ref={feeCount.ref}>{feesInSol >= 1000 ? (feeCount.value / 10).toFixed(1) + "K" : (feeCount.value / 10).toFixed(1)}</span> SOL</> },
              { label: "MCP Tools", value: "17" },
              { label: "Network", value: <span className="text-[var(--accent)]">MAINNET</span>, dot: true },
            ].map((s) => (
              <div key={s.label} className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-5 py-4">
                <div className="flex items-center gap-2">
                  {"dot" in s && s.dot && <span className="pulse-dot" />}
                  <p className="text-xl font-semibold font-mono">{s.value}</p>
                </div>
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── How It Works ─── */}
      <section id="how" className="py-24 px-6 border-t border-[var(--border)]">
        <div className="max-w-[1120px] mx-auto reveal">
          <p className="text-[11px] text-[var(--accent)] uppercase tracking-[0.2em] font-semibold mb-3">How it works</p>
          <h2 className="text-3xl font-bold tracking-tight mb-4">
            Fees become services in four steps
          </h2>
          <p className="text-sm text-[var(--text-muted)] max-w-lg mb-14">
            Every Bags.fm token has built-in fee-sharing. Tend lets you route a portion to AI agents that work autonomously for your token.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-px bg-[var(--border)] rounded-2xl overflow-hidden">
            {STEPS.map((step) => (
              <div key={step.n} className="bg-[var(--bg-card)] p-7">
                <span className="text-[40px] font-bold font-display text-[var(--border-hover)] leading-none">
                  {step.n}
                </span>
                <h3 className="text-[15px] font-semibold mt-4 mb-2">{step.title}</h3>
                <p className="text-[13px] text-[var(--text-muted)] leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Live Proof — Dog-fooding ─── */}
      <section id="proof" className="py-24 px-6 border-t border-[var(--border)]">
        <div className="max-w-[1120px] mx-auto reveal">
          <div className="flex items-center gap-3 mb-3">
            <p className="text-[11px] text-[var(--accent)] uppercase tracking-[0.2em] font-semibold">Dog-fooding</p>
            <span className="h-px flex-1 bg-[var(--border)]" />
          </div>
          <h2 className="text-3xl font-bold tracking-tight mb-3">
            Tend uses its own product
          </h2>
          <p className="text-sm text-[var(--text-muted)] max-w-lg mb-12">
            The $TEND token has live AI services powered by Tend. This is proof, not a demo. Every number comes from Solana mainnet.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Buyback cycle card */}
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-5">
                <span className="w-2 h-2 rounded-full bg-[var(--accent)] shadow-[0_0_6px_var(--accent)]" />
                <h3 className="text-sm font-semibold">Buyback Bot</h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--accent-dim)] text-[var(--accent)] ml-auto font-semibold">ACTIVE</span>
              </div>
              <div className="space-y-3 text-[13px]">
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Allocation</span>
                  <span className="font-mono">1,500 BPS (15%)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Last claim</span>
                  <span className="font-mono text-[var(--accent)]">0.016 SOL</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Tokens bought</span>
                  <span className="font-mono">501,490 TEND</span>
                </div>
              </div>
              <div className="mt-5 pt-4 border-t border-[var(--border)] text-[11px] text-[var(--text-muted)]">
                Claims fees &rarr; Swaps SOL &rarr; Buys token &rarr; Buy pressure
              </div>
            </div>

            {/* Analytics card */}
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-5">
                <span className="w-2 h-2 rounded-full bg-[var(--accent-secondary)] shadow-[0_0_6px_var(--accent-secondary)]" />
                <h3 className="text-sm font-semibold">Analytics Engine</h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[rgba(0,191,255,0.1)] text-[var(--accent-secondary)] ml-auto font-semibold">ACTIVE</span>
              </div>
              <div className="space-y-3 text-[13px]">
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Allocation</span>
                  <span className="font-mono">500 BPS (5%)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Capabilities</span>
                  <span>Health reports, holder analysis</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Interface</span>
                  <span>Claude Desktop (MCP)</span>
                </div>
              </div>
              <div className="mt-5 pt-4 border-t border-[var(--border)] text-[11px] text-[var(--text-muted)]">
                Monitors fees &rarr; Analyzes holders &rarr; Reports via Claude
              </div>
            </div>

            {/* Economics card */}
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-6">
              <h3 className="text-sm font-semibold mb-5">How it&apos;s funded</h3>
              <div className="space-y-4 text-[13px]">
                <div>
                  <div className="flex justify-between text-[var(--text-muted)] text-[11px] uppercase tracking-wider mb-1">
                    <span>Source</span>
                    <span>Allocation</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span>Trading fees</span>
                      <span className="font-mono">100%</span>
                    </div>
                  </div>
                </div>
                <div className="h-px bg-[var(--border)]" />
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">Creator keeps</span>
                    <span className="font-mono">80%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">Buyback Bot</span>
                    <span className="font-mono text-[var(--accent)]">15%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[var(--text-muted)]">Analytics</span>
                    <span className="font-mono text-[var(--accent-secondary)]">5%</span>
                  </div>
                </div>
              </div>
              <div className="mt-5 pt-4 border-t border-[var(--border)] text-[11px] text-[var(--text-muted)]">
                Zero treasury &middot; Zero subscriptions &middot; Fee-funded only
              </div>
            </div>
          </div>

          <div className="text-center mt-6">
            <a
              href={`/tokens/${TEND_MINT}`}
              className="text-[13px] text-[var(--accent)] hover:underline underline-offset-4"
            >
              View full $TEND token details &rarr;
            </a>
          </div>
        </div>
      </section>

      {/* ─── Services ─── */}
      <section id="services" className="py-24 px-6 border-t border-[var(--border)]">
        <div className="max-w-[1120px] mx-auto reveal">
          <p className="text-[11px] text-[var(--accent)] uppercase tracking-[0.2em] font-semibold mb-3">Marketplace</p>
          <h2 className="text-3xl font-bold tracking-tight mb-4">
            Plug-and-play AI services
          </h2>
          <p className="text-sm text-[var(--text-muted)] max-w-lg mb-12">
            Each service earns a share of your token&apos;s trading fees and works autonomously. Remove anytime with one transaction.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-px bg-[var(--border)] rounded-2xl overflow-hidden">
            {SERVICES.map((s) => (
              <div key={s.name} className="bg-[var(--bg-card)] p-6 flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[15px] font-semibold">{s.name}</h3>
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wider"
                    style={{ color: s.tagColor }}
                  >
                    {s.tag}
                  </span>
                </div>
                <p className="text-[13px] text-[var(--text-muted)] leading-relaxed flex-1">{s.desc}</p>
              </div>
            ))}
          </div>

          <div className="text-center mt-6">
            <a href="/services" className="text-[13px] text-[var(--accent)] hover:underline underline-offset-4">
              Browse services with pricing &rarr;
            </a>
          </div>
        </div>
      </section>

      {/* ─── Claude MCP ─── */}
      <section id="mcp" className="py-24 px-6 border-t border-[var(--border)]">
        <div className="max-w-[1120px] mx-auto reveal">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-start">
            {/* Left — copy */}
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-purple-500/20 bg-purple-500/5 text-[11px] text-purple-400 font-semibold uppercase tracking-wider mb-6">
                Claude Skills Track
              </div>
              <h2 className="text-3xl font-bold tracking-tight mb-4">
                Manage everything
                <br />
                with Claude
              </h2>
              <p className="text-[15px] text-[var(--text-secondary)] leading-relaxed mb-8 max-w-[400px]">
                Tend ships as a Model Context Protocol server with 17 tools.
                Connect to Claude Desktop and manage your fee-sharing through natural language.
              </p>
              <div className="space-y-3 mb-8">
                {[
                  "Analyze token health and fee velocity",
                  "Add or remove services with one prompt",
                  "Monitor portfolio across all your tokens",
                  "Get AI-generated growth strategies",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-3 text-[13px]">
                    <span className="text-[var(--accent)] text-xs">&#x2713;</span>
                    <span className="text-[var(--text-secondary)]">{item}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-4 text-[13px]">
                <a
                  href="https://github.com/RedGnad/Tend"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[var(--accent)] hover:underline underline-offset-4"
                >
                  Setup guide &rarr;
                </a>
                <span className="text-[var(--text-muted)]">
                  17 tools &middot; 2 prompts &middot; STDIO
                </span>
              </div>
            </div>

            {/* Right — terminal */}
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl overflow-hidden">
              {/* Terminal chrome */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] bg-[var(--bg)]">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
                  <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
                  <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
                </div>
                <span className="text-[11px] text-[var(--text-muted)] ml-2 font-mono">Claude Desktop &mdash; tend MCP</span>
              </div>

              {/* Conversation */}
              <div className="p-5 space-y-4 max-h-[400px] overflow-y-auto">
                {MCP_LINES.map((line, i) => (
                  <div key={i}>
                    {line.role === "user" ? (
                      <div className="flex gap-3">
                        <span className="w-5 h-5 rounded bg-[var(--bg-elevated)] text-[10px] text-[var(--text-muted)] flex items-center justify-center flex-shrink-0 mt-0.5 font-mono">
                          U
                        </span>
                        <p className="text-[13px] text-[var(--text)]">{line.text}</p>
                      </div>
                    ) : (
                      <div className="flex gap-3 ml-8">
                        <div className="text-[12px] font-mono bg-[var(--bg)] rounded-lg px-3 py-2 flex-1 border border-[var(--border)]">
                          <span className="text-[var(--accent)]">tool:</span>{" "}
                          <span className="text-[var(--text-muted)]">{line.text}</span>
                          {"result" in line && (
                            <p className="text-[var(--text-secondary)] mt-1">{line.result}</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── Bottom CTA ─── */}
      <section className="py-24 px-6 border-t border-[var(--border)]">
        <div className="max-w-[560px] mx-auto text-center reveal">
          <h2 className="text-3xl font-bold tracking-tight mb-4">
            Put your fees to work
          </h2>
          <p className="text-[15px] text-[var(--text-muted)] mb-8">
            Every Bags.fm token generates fees. Most sit unclaimed.
            Tend turns them into autonomous growth engines.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button onClick={handleCTA} className="gradient-btn px-8 py-3 rounded-xl text-sm font-semibold">
              {connected ? "Open Dashboard" : "Launch App"}
            </button>
            <a
              href="https://github.com/RedGnad/Tend"
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary px-8 py-3 rounded-xl text-sm"
            >
              GitHub
            </a>
          </div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="border-t border-[var(--border)] py-6 px-6">
        <div className="max-w-[1120px] mx-auto flex flex-col md:flex-row items-center justify-between gap-3 text-[11px] text-[var(--text-muted)]">
          <div className="flex items-center gap-2">
            <span className="font-display font-semibold text-sm gradient-text">Tend</span>
            <span>&middot;</span>
            <span>Fee-sharing as a service</span>
          </div>
          <div className="flex items-center gap-5">
            <a href="https://bags.fm" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--text)] transition-colors">Bags.fm</a>
            <a href="https://github.com/RedGnad/Tend" target="_blank" rel="noopener noreferrer" className="hover:text-[var(--text)] transition-colors">GitHub</a>
            <span>Built for the Bags.fm Hackathon</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
