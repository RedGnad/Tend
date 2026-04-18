# Tend. Turn your Bags fees into a growth engine

**Every Bags.fm token generates trading fees.** Most creators let them sit. Tend puts them to work, automatically rewarding your community in SOL while an AI agent protects every payout from bots and sybils.

---

## The problem

Bags creators have fees flowing in but no way to turn them into **community growth**. Rewards programs are **complex** to build, **expensive** to run, and vulnerable to **bots farming** them dry.

## The solution

Tend gives creators 3 campaign types, set it up in seconds, the AI agent handles everything else:

**Cashback :** Traders get a % of their buy back in SOL. Every qualifying purchase is detected automatically, no matter which DEX they use — Jupiter, Phantom swap, Raydium, anywhere.

**Holder Dividends :** Long-term holders earn pro-rata SOL from periodic snapshots (configurable interval). Minimum hold times filter out flippers.

**Sprint :** Flat SOL bonus to the first N buyers. Creates urgency at launch. Bots get blocked, real traders get paid.

All 3 types are live on $TEND right now with real payouts flowing.

---

## The fee-sharing flywheel

This is how fees become growth:

1. Creator seeds a campaign pool (the bootstrap)
2. Trading activity generates fees on Bags.fm
3. The agent claims those fees automatically (every 30 min) and grows the pool
4. Traders earn SOL back — cashback, dividends, or sprint bonuses
5. More rewards attract more trading, which generates more fees

The pool replenishes itself. The dashboard shows the breakdown: how much was seeded by the creator vs. how much was auto-claimed from trading fees.

---

## What makes Tend different: AI in the money path

Most "AI" crypto projects use AI for chatbots or analytics dashboards. In Tend, **the agent decides whether real money moves or not.**

Every single payout passes through a AI fraud gate before any SOL leaves the pool. The gate analyzes wallet age, transaction history, and payout patterns, then returns allow / reject / hold with written reasoning.

**Real example, same launch campaign, opposite verdicts:**

A 6-day-old wallet with 6 transactions tried to claim a sprint bonus. Claude blocked it:
*"Wallet is 6 days old with only 6 total transactions, just below the 7-day organic threshold. Launch sprint campaigns are high-risk for sniping."*

A 3-year-old wallet with 1000+ transactions claimed the same bonus. Claude approved it:
*"Wallet shows strong legitimacy signals: well-established on-chain history, active transaction count, no previous payouts on this campaign."*

Result: Legitimate trader got 0.005 SOL. Bot got nothing. Pool protected.

---

## On-chain proof

Every payout is verifiable on Solscan:

- **Cashback:** 0.060876 SOL to M5q9egYv... — [https://solscan.io/tx/3xJdN7thAvRUYrsbb3kEJL9PNM32tKRZrrE1v7LCHAfs6PAaxwFPQKEMB2gupBLdZKDmqzvW3uc4bUuKuf2C8qni](https://solscan.io/tx/3xJdN7thAvRUYrsbb3kEJL9PNM32tKRZrrE1v7LCHAfs6PAaxwFPQKEMB2gupBLdZKDmqzvW3uc4bUuKuf2C8qni)
- **Sprint:** 0.005 SOL to 8y2Eo1dk... — [https://solscan.io/tx/4kdjsRMZParkWSLKdthLqu3VVfJEL4pXC9evs7WXshcPR8pZ2TmjMpGqqvvBkGiWQYMk17W2qxWVdDREc3guaFFb](https://solscan.io/tx/4kdjsRMZParkWSLKdthLqu3VVfJEL4pXC9evs7WXshcPR8pZ2TmjMpGqqvvBkGiWQYMk17W2qxWVdDREc3guaFFb)
- **Holder:** 0.00125 SOL to zCu1hXVf... — [https://solscan.io/tx/2XBJQwE6hojePbBZ7fM4RpzitEAX9AsF4jUiw1Se311xysSoU5rQq63oMUGd57h2Pw95FbdWJJEWHh7NMvP6Ma56](https://solscan.io/tx/2XBJQwE6hojePbBZ7fM4RpzitEAX9AsF4jUiw1Se311xysSoU5rQq63oMUGd57h2Pw95FbdWJJEWHh7NMvP6Ma56)

24 payouts total across 3 campaign types. 8 AI fraud decisions logged.

---

## For creators: set up in seconds, manage from Claude Desktop

Creators can launch campaigns from the dashboard or through Claude Desktop with the MCP server:

*"Create a 5% cashback campaign on $TEND with a 0.1 SOL pool"*
*"Show me the stats for my holder campaign"*
*"Top up the sprint pool with 0.3 SOL"*

6 focused MCP tools cover the full creator workflow: launch a cashback / holder / sprint campaign, pause, top up the pool, and view live stats.

---

## Deep Bags.fm integration

Tend is built entirely on the Bags platform:

- Fee claiming — `claimFees` collects accrued SOL from fee-share positions, auto-reinvested into campaign pools
- Fee-share routing — creator fees flow directly into reward pools on-chain
- Real-time trade detection — every buy on any DEX is captured via Solana RPC
- Token analytics and metadata for campaign dashboards

---

## Architecture

- **Agent :** Node.js scheduler with 2 core loops: fee claiming (every 30 min) and rewards distribution (every 2 min). Claude Haiku 4.5 fraud gate with Zod v4 structured outputs
- **Frontend :** Next.js 15, Tailwind v4, embedded Birdeye charts + Jupiter swap, wallet-adapter (Phantom/Solflare)
- **MCP Server :** 6 creator tools + 1 resource + 1 prompt, STDIO transport, callable from Claude Desktop
- **Security :** AES-256-GCM encrypted wallet keys, file-level locking, bounded agent authority, fail-closed fraud gate
- **Infra :** Vercel (dashboard), Render (agent), live state bridge between the two

**Try it now:** [https://tend-frontend.vercel.app](https://tend-frontend.vercel.app)

**$TEND token:** [https://bags.fm/6qa9oCypYpnWZyZNQ8v36eLbmWmcgHRv4MuU7BXQBAGS](https://bags.fm/6qa9oCypYpnWZyZNQ8v36eLbmWmcgHRv4MuU7BXQBAGS)
