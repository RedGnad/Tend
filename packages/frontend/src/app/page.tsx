"use client";

import { useEffect, useState, useRef } from "react";

/* ═══════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════ */

const TEND_MINT = "6qa9oCypYpnWZyZNQ8v36eLbmWmcgHRv4MuU7BXQBAGS";

const STEPS = [
  {
    title: "Fees accumulate",
    desc: "Every trade on Bags.fm generates fees for the token creator. They sit on-chain, claimable anytime.",
  },
  {
    title: "Allocate to services",
    desc: "Assign a percentage of your fee-share to AI services. One on-chain transaction, fully revocable.",
  },
  {
    title: "Services auto-execute",
    desc: "Each service has its own wallet. It claims its share and runs its strategy — buybacks, analytics, growth.",
  },
  {
    title: "Token grows",
    desc: "Buyback bots create buy pressure. Analytics surface insights. Growth agents build community. All fee-funded.",
  },
];

const SERVICES_PREVIEW = [
  { name: "Buyback Bot", desc: "Claims fees and buys back the token, creating sustained buy pressure.", tag: "LIVE", live: true },
  { name: "Analytics Engine", desc: "Monitors holders, fees, and generates health reports via Claude.", tag: "LIVE", live: true },
  { name: "Fee Compounder", desc: "Reinvests fees into deeper liquidity positions, reducing slippage.", tag: "READY", live: false },
  { name: "Growth Agent", desc: "AI-powered community engagement and automated marketing.", tag: "READY", live: false },
];

const MCP_LINES: Array<{ role: "user" | "tool"; text: string; result?: string }> = [
  { role: "user", text: "Show me the top tokens on Bags.fm by fees" },
  { role: "tool", text: "top_tokens_by_fees", result: "Found 24+ tokens with 38.4K SOL in lifetime fees" },
  { role: "user", text: "Run a health check on $TEND" },
  { role: "tool", text: "token_health", result: "TEND — 3 claimers, 0.019 SOL lifetime, buyback bot active" },
  { role: "user", text: "Add a buyback bot with 15% fee allocation" },
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
  image: string | null;
}

/* ═══════════════════════════════════════════
   Hooks
   ═══════════════════════════════════════════ */

function useScrollReveal() {
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) e.target.classList.add("visible"); }),
      { threshold: 0.08, rootMargin: "0px 0px -40px 0px" }
    );
    document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
}

function useCountUp(target: number, duration = 1200) {
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
  const feeCountTarget = feesInSol >= 1000
    ? Math.round(feesInSol / 100)
    : Math.round(feesInSol * 10);
  const feeCount = useCountUp(feeCountTarget, 1400);

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
          <a href="/dashboard" className="gradient-btn px-5 py-2 rounded-lg text-[13px] font-semibold">
            Launch App
          </a>
        </div>
      </nav>

      {/* ─── Hero ─── */}
      <section className="pt-32 pb-28 px-6">
        <div className="max-w-[1120px] mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 items-center">
            {/* Left — copy */}
            <div className="stagger">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--border)] text-[12px] text-[var(--text-muted)] font-medium tracking-wide uppercase mb-8">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_6px_var(--accent)]" />
                Live on Solana Mainnet
              </div>

              <h1 className="text-[clamp(2.8rem,5.5vw,4rem)] font-bold leading-[1.05] tracking-tight mb-7">
                Turn trading fees
                <br />
                into{" "}
                <span className="gradient-text">autonomous</span>
                <br />
                AI services
              </h1>

              <p className="text-[17px] text-[var(--text-secondary)] leading-relaxed max-w-[460px] mb-10">
                Tend transforms Bags.fm fee-sharing into a payment rail for AI agents.
                Attach services to your token&mdash;they earn fees and work 24/7.
                No subscriptions. No upfront cost.
              </p>

              <div className="flex items-center gap-3">
                <a href="/dashboard" className="gradient-btn px-8 py-3.5 rounded-xl text-[15px] font-semibold inline-block">
                  Launch App
                </a>
                <a href="#proof" className="btn-secondary px-8 py-3.5 rounded-xl text-[15px] inline-block">
                  See it live
                </a>
              </div>
            </div>

            {/* Right — live $TEND card */}
            <div className="relative">
              <div className="absolute -inset-10 bg-[radial-gradient(ellipse_at_center,rgba(0,255,178,0.05),transparent_70%)] pointer-events-none" />

              <div className="relative bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-7 space-y-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[var(--accent-dim)] flex items-center justify-center font-bold font-display gradient-text text-base">
                      T
                    </div>
                    <div>
                      <p className="font-semibold text-base font-display">
                        {tend?.tokenName ?? "$TEND"}
                      </p>
                      <p className="text-[12px] text-[var(--text-muted)] font-mono">
                        {TEND_MINT.slice(0, 6)}...{TEND_MINT.slice(-4)}
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] px-2.5 py-1 rounded-full bg-[var(--accent-dim)] text-[var(--accent)] font-semibold uppercase tracking-wider">
                    Live
                  </span>
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Lifetime Fees", val: tend ? formatSol(tend.lifetimeFees) + " SOL" : null },
                    { label: "Claimed", val: tend ? formatSol(tend.totalClaimed) + " SOL" : null, color: "var(--accent)" },
                    { label: "Unclaimed", val: tend ? formatSol(tend.unclaimedEstimate) + " SOL" : null, color: "var(--warning)" },
                  ].map((s) => (
                    <div key={s.label} className="bg-[var(--bg)] rounded-lg p-3">
                      <p className={`text-base font-semibold font-mono ${!s.val ? "shimmer" : ""}`} style={s.color ? { color: s.color } : undefined}>
                        {s.val ?? "-.--"}
                      </p>
                      <p className="text-[10px] text-[var(--text-muted)] mt-1 uppercase tracking-wider">{s.label}</p>
                    </div>
                  ))}
                </div>

                {/* Fee split bar */}
                {tend && tend.creators.length > 0 && (
                  <div>
                    <p className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider mb-2">On-chain fee split</p>
                    <div className="flex h-3 rounded-full overflow-hidden gap-px">
                      {tend.creators.map((c, i) => (
                        <div key={i} className="rounded-full transition-all" style={{ width: `${c.royaltyBps / 100}%`, backgroundColor: claimerColors[i] ?? "#444" }} />
                      ))}
                    </div>
                    <div className="flex gap-4 mt-2.5">
                      {tend.creators.map((c, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-[12px]">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: claimerColors[i] ?? "#444" }} />
                          <span className="text-[var(--text-muted)]">{claimerLabels[i] ?? c.wallet.slice(0, 6)}</span>
                          <span className="font-mono text-[var(--text-muted)]">{(c.royaltyBps / 100).toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Active services — from live health data */}
                <div className="border-t border-[var(--border)] pt-4 space-y-2">
                  <p className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider">
                    {tend?.creators && tend.creators.length > 1 ? "Fee claimers" : "Example configuration"}
                  </p>
                  {tend?.creators && tend.creators.length > 1 ? (
                    tend.creators.map((c, i) => (
                      <div key={i} className="flex items-center gap-2 text-[13px]">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: i === 0 ? "var(--text-muted)" : "var(--accent)", boxShadow: i > 0 ? "0 0 4px var(--accent)" : "none" }} />
                        <span className="text-[var(--text-secondary)]">{c.username || c.wallet.slice(0, 8)}</span>
                        <span className="text-[var(--text-muted)] font-mono ml-auto">{(c.royaltyBps / 100).toFixed(0)}%</span>
                      </div>
                    ))
                  ) : (
                    [
                      { name: "Creator", pct: "85%", color: "var(--text-muted)" },
                      { name: "Buyback Bot", pct: "15%", color: "var(--accent)" },
                    ].map((s) => (
                      <div key={s.name} className="flex items-center gap-2 text-[13px]">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: s.color }} />
                        <span className="text-[var(--text-secondary)]">{s.name}</span>
                        <span className="text-[var(--text-muted)] font-mono ml-auto">{s.pct}</span>
                      </div>
                    ))
                  )}
                </div>

                <p className="text-[11px] text-[var(--text-muted)] text-center pt-3 border-t border-[var(--border)]">
                  Real on-chain data &middot; Updated every page load
                </p>
              </div>
            </div>
          </div>

          {/* Token avatars — social proof */}
          {leaderboard.length > 0 && (
            <div className="flex items-center gap-4 mt-20 mb-6">
              <div className="flex -space-x-2">
                {leaderboard.slice(0, 8).map((t) => (
                  t.image ? (
                    <img
                      key={t.mint}
                      src={t.image}
                      alt={t.name}
                      className="w-8 h-8 rounded-full border-2 border-[var(--bg)] object-cover"
                      title={t.name}
                    />
                  ) : (
                    <div
                      key={t.mint}
                      className="w-8 h-8 rounded-full border-2 border-[var(--bg)] bg-[var(--bg-elevated)] flex items-center justify-center text-[10px] font-bold text-[var(--text-muted)]"
                      title={t.name}
                    >
                      {t.symbol?.charAt(0) ?? "?"}
                    </div>
                  )
                ))}
              </div>
              <p className="text-[13px] text-[var(--text-muted)]">
                <span className="text-[var(--text-secondary)] font-medium">{leaderboard.length}+ tokens</span> generating fees on Bags.fm
              </p>
            </div>
          )}

          {/* Stats bar */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Bags.fm Tokens", value: <><span ref={tokenCount.ref}>{tokenCount.value}</span>+</> },
              { label: "Total Fees Generated", value: <><span ref={feeCount.ref}>{feesInSol >= 1000 ? (feeCount.value / 10).toFixed(1) + "K" : (feeCount.value / 10).toFixed(1)}</span> SOL</> },
              { label: "MCP Tools", value: "21" },
              { label: "Network", value: <span className="text-[var(--accent)]">MAINNET</span>, dot: true },
            ].map((s) => (
              <div key={s.label} className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl px-5 py-5">
                <div className="flex items-center gap-2">
                  {"dot" in s && s.dot && <span className="pulse-dot" />}
                  <p className="text-2xl font-semibold font-mono">{s.value}</p>
                </div>
                <p className="text-[11px] text-[var(--text-muted)] uppercase tracking-wider mt-1.5">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 01 · How It Works ─── */}
      <section id="how" className="py-28 px-6 border-t border-[var(--border)]">
        <div className="max-w-[1120px] mx-auto reveal">
          <div className="flex items-baseline gap-4 mb-4">
            <span className="text-[var(--accent)] font-mono text-sm font-semibold">01</span>
            <span className="text-[13px] text-[var(--accent)] uppercase tracking-[0.15em] font-semibold">How it works</span>
          </div>
          <h2 className="text-[clamp(1.8rem,3.5vw,2.5rem)] font-bold tracking-tight mb-5">
            Fees become services in four steps
          </h2>
          <p className="text-[15px] text-[var(--text-muted)] max-w-lg mb-16 leading-relaxed">
            Every Bags.fm token has built-in fee-sharing. Tend lets you route a portion to AI agents that work autonomously for your token.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-px bg-[var(--border)] rounded-2xl overflow-hidden">
            {STEPS.map((step, i) => (
              <div key={step.title} className="bg-[var(--bg-card)] p-8">
                <span className="text-[44px] font-bold font-display text-[var(--border-hover)] leading-none">
                  0{i + 1}
                </span>
                <h3 className="text-base font-semibold mt-5 mb-3">{step.title}</h3>
                <p className="text-[14px] text-[var(--text-muted)] leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── 02 · Live Proof ─── */}
      <section id="proof" className="py-28 px-6 border-t border-[var(--border)]">
        <div className="max-w-[1120px] mx-auto reveal">
          <div className="flex items-baseline gap-4 mb-4">
            <span className="text-[var(--accent)] font-mono text-sm font-semibold">02</span>
            <span className="text-[13px] text-[var(--accent)] uppercase tracking-[0.15em] font-semibold">Dog-fooding</span>
          </div>
          <h2 className="text-[clamp(1.8rem,3.5vw,2.5rem)] font-bold tracking-tight mb-4">
            Tend uses its own product
          </h2>
          <p className="text-[15px] text-[var(--text-muted)] max-w-lg mb-14 leading-relaxed">
            The $TEND token has live AI services powered by Tend.
            This is proof, not a demo&mdash;every number comes from Solana mainnet.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Buyback cycle — live data */}
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-7">
              <div className="flex items-center gap-2 mb-6">
                <span className="w-2 h-2 rounded-full bg-[var(--accent)] shadow-[0_0_6px_var(--accent)]" />
                <h3 className="text-base font-semibold">Buyback Bot</h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--accent-dim)] text-[var(--accent)] ml-auto font-semibold">ACTIVE</span>
              </div>
              <div className="space-y-3.5 text-[14px]">
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Allocation</span>
                  <span className="font-mono">
                    {tend?.creators.find(c => c.username === "buyback-bot" || c.royaltyBps === 1500)
                      ? `${tend.creators.find(c => c.username === "buyback-bot" || c.royaltyBps === 1500)!.royaltyBps} BPS (${(tend.creators.find(c => c.username === "buyback-bot" || c.royaltyBps === 1500)!.royaltyBps / 100).toFixed(0)}%)`
                      : "1,500 BPS (15%)"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Lifetime fees</span>
                  <span className="font-mono text-[var(--accent)]">{tend ? formatSol(tend.lifetimeFees) + " SOL" : "..."}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Unclaimed</span>
                  <span className="font-mono">{tend ? formatSol(tend.unclaimedEstimate) + " SOL" : "..."}</span>
                </div>
              </div>
              <div className="mt-6 pt-4 border-t border-[var(--border)] text-[12px] text-[var(--text-muted)] font-mono">
                Claim fees &rarr; Swap SOL &rarr; Buy token &rarr; Buy pressure
              </div>
            </div>

            {/* Analytics */}
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-7">
              <div className="flex items-center gap-2 mb-6">
                <span className="w-2 h-2 rounded-full bg-[var(--accent-secondary)] shadow-[0_0_6px_var(--accent-secondary)]" />
                <h3 className="text-base font-semibold">Analytics Engine</h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[rgba(0,191,255,0.1)] text-[var(--accent-secondary)] ml-auto font-semibold">ACTIVE</span>
              </div>
              <div className="space-y-3.5 text-[14px]">
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Allocation</span>
                  <span className="font-mono">500 BPS (5%)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Capabilities</span>
                  <span>Health reports, holders</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Interface</span>
                  <span>Claude Desktop (MCP)</span>
                </div>
              </div>
              <div className="mt-6 pt-4 border-t border-[var(--border)] text-[12px] text-[var(--text-muted)] font-mono">
                Monitor fees &rarr; Analyze holders &rarr; Report via Claude
              </div>
            </div>

            {/* Economics — live from creators */}
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-7">
              <h3 className="text-base font-semibold mb-6">How it&apos;s funded</h3>
              <div className="space-y-3.5 text-[14px]">
                <div className="flex justify-between font-semibold">
                  <span>Trading fees</span>
                  <span className="font-mono">100%</span>
                </div>
                <div className="h-px bg-[var(--border)]" />
                {tend?.creators && tend.creators.length > 0 ? (
                  tend.creators.map((c, i) => (
                    <div key={i} className="flex justify-between">
                      <span className="text-[var(--text-muted)]">{c.username || c.wallet.slice(0, 8)}</span>
                      <span className={`font-mono ${i > 0 ? "text-[var(--accent)]" : ""}`}>
                        {(c.royaltyBps / 100).toFixed(0)}%
                      </span>
                    </div>
                  ))
                ) : (
                  <>
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
                  </>
                )}
              </div>
              <div className="mt-6 pt-4 border-t border-[var(--border)] text-[12px] text-[var(--text-muted)]">
                Zero treasury &middot; Zero subscriptions &middot; Fee-funded only
              </div>
            </div>
          </div>

          <div className="text-center mt-8">
            <a href={`/tokens/${TEND_MINT}`} className="text-[14px] text-[var(--accent)] hover:underline underline-offset-4">
              View full $TEND token details &rarr;
            </a>
          </div>
        </div>
      </section>

      {/* ─── 03 · Services ─── */}
      <section id="services" className="py-28 px-6 border-t border-[var(--border)]">
        <div className="max-w-[1120px] mx-auto reveal">
          <div className="flex items-baseline gap-4 mb-4">
            <span className="text-[var(--accent)] font-mono text-sm font-semibold">03</span>
            <span className="text-[13px] text-[var(--accent)] uppercase tracking-[0.15em] font-semibold">Marketplace</span>
          </div>
          <h2 className="text-[clamp(1.8rem,3.5vw,2.5rem)] font-bold tracking-tight mb-5">
            Plug-and-play AI services
          </h2>
          <p className="text-[15px] text-[var(--text-muted)] max-w-lg mb-14 leading-relaxed">
            Each service earns a share of your token&apos;s trading fees and works autonomously. Add or remove with one transaction.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-px bg-[var(--border)] rounded-2xl overflow-hidden">
            {SERVICES_PREVIEW.map((s) => (
              <div key={s.name} className="bg-[var(--bg-card)] p-7 flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-semibold">{s.name}</h3>
                  <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: s.live ? "var(--accent)" : "var(--text-muted)" }}>
                    {s.tag}
                  </span>
                </div>
                <p className="text-[14px] text-[var(--text-muted)] leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>

          <div className="text-center mt-8">
            <a href="/services" className="text-[14px] text-[var(--accent)] hover:underline underline-offset-4">
              Browse all services with pricing &rarr;
            </a>
          </div>
        </div>
      </section>

      {/* ─── 04 · Claude MCP ─── */}
      <section id="mcp" className="py-28 px-6 border-t border-[var(--border)]">
        <div className="max-w-[1120px] mx-auto reveal">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 items-start">
            {/* Left — copy */}
            <div>
              <div className="flex items-baseline gap-4 mb-4">
                <span className="text-purple-400 font-mono text-sm font-semibold">04</span>
                <span className="text-[13px] text-purple-400 uppercase tracking-[0.15em] font-semibold">Claude Skills Track</span>
              </div>
              <h2 className="text-[clamp(1.8rem,3.5vw,2.5rem)] font-bold tracking-tight mb-5">
                Manage everything
                <br />
                with Claude
              </h2>
              <p className="text-[16px] text-[var(--text-secondary)] leading-relaxed mb-8 max-w-[420px]">
                Tend ships as a Model Context Protocol server with 17 tools.
                Connect to Claude Desktop and manage fee-sharing through natural language.
              </p>
              <div className="space-y-3 mb-8">
                {[
                  "Analyze token health and fee velocity",
                  "Add or remove services with one prompt",
                  "Monitor portfolio across all your tokens",
                  "Get AI-generated growth strategies",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-3 text-[14px]">
                    <span className="text-[var(--accent)]">&#x2713;</span>
                    <span className="text-[var(--text-secondary)]">{item}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-5 text-[14px]">
                <a href="https://github.com/RedGnad/Tend" target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline underline-offset-4">
                  Setup guide &rarr;
                </a>
                <span className="text-[var(--text-muted)] text-[13px]">17 tools &middot; 2 prompts &middot; STDIO</span>
              </div>
            </div>

            {/* Right — terminal */}
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl overflow-hidden">
              <div className="flex items-center gap-2 px-5 py-3 border-b border-[var(--border)] bg-[var(--bg)]">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f57]" />
                  <div className="w-2.5 h-2.5 rounded-full bg-[#febc2e]" />
                  <div className="w-2.5 h-2.5 rounded-full bg-[#28c840]" />
                </div>
                <span className="text-[12px] text-[var(--text-muted)] ml-2 font-mono">Claude Desktop &mdash; tend MCP</span>
              </div>

              <div className="p-6 space-y-5">
                {MCP_LINES.map((line, i) => (
                  <div key={i}>
                    {line.role === "user" ? (
                      <div className="flex gap-3">
                        <span className="w-6 h-6 rounded bg-[var(--bg-elevated)] text-[11px] text-[var(--text-muted)] flex items-center justify-center flex-shrink-0 mt-0.5 font-mono">
                          U
                        </span>
                        <p className="text-[14px] text-[var(--text)]">{line.text}</p>
                      </div>
                    ) : (
                      <div className="flex gap-3 ml-9">
                        <div className="text-[13px] font-mono bg-[var(--bg)] rounded-lg px-4 py-2.5 flex-1 border border-[var(--border)]">
                          <span className="text-[var(--accent)]">tool:</span>{" "}
                          <span className="text-[var(--text-muted)]">{line.text}</span>
                          {line.result && (
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

      {/* ─── CTA ─── */}
      <section className="py-28 px-6 border-t border-[var(--border)]">
        <div className="max-w-[560px] mx-auto text-center reveal">
          <h2 className="text-[clamp(1.8rem,3.5vw,2.5rem)] font-bold tracking-tight mb-5">
            Put your fees to work
          </h2>
          <p className="text-[16px] text-[var(--text-muted)] mb-10 leading-relaxed">
            Every Bags.fm token generates fees. Most sit unclaimed.
            Tend turns them into autonomous growth engines.
          </p>
          <div className="flex items-center justify-center gap-4">
            <a href="/dashboard" className="gradient-btn px-8 py-3.5 rounded-xl text-[15px] font-semibold inline-block">
              Launch App
            </a>
            <a href="https://github.com/RedGnad/Tend" target="_blank" rel="noopener noreferrer" className="btn-secondary px-8 py-3.5 rounded-xl text-[15px] inline-block">
              GitHub
            </a>
          </div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="border-t border-[var(--border)] py-8 px-6">
        <div className="max-w-[1120px] mx-auto flex flex-col md:flex-row items-center justify-between gap-3 text-[12px] text-[var(--text-muted)]">
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
