# Tend. Turn your Bags fees into a growth engine

**Every Bags.fm token generates trading fees.** Most creators let them sit. Tend puts them to work, automatically rewarding your community in SOL while an AI agent protects every payout from bots and sybils.

---

## The problem

Bags creators have fees flowing in but no way to turn them into **community growth**. Rewards programs are **complex** to build, **expensive** to run, and vulnerable to **bots farming** them dry.

## The solution

Tend gives creators **3 campaign types**, set it up in seconds, the AI agent handles **everything else:**

**Cashback :** Traders get a % of their buy back in SOL. Every qualifying purchase is detected automatically, no matter which DEX they use — Jupiter, Phantom swap, Raydium, anywhere.

**Holder Dividends :** Long-term holders earn pro-rata SOL from periodic snapshots (configurable interval). Minimum hold times filter out flippers.

**Sprint :** Flat SOL bonus to the first N buyers. Creates urgency at launch. Bots get blocked, real traders get paid.

All 3 types are live on $TEND right now with **real payouts** flowing.

---

## The fee-sharing flywheel

This is how **fees become growth:**

1. Creator **seeds** a campaign pool (the bootstrap) and **routes a slice of their Bags fee-share** into Tend with a one-click wallet signature (default 10%, capped at 50%, existing claimers reduced prorata)
2. Trading activity **generates fees** on Bags.fm
3. The agent claims that routed share automatically (every 30 min) and **grows the pool**
4. **Traders earn SOL** back, cashback, dividends, or sprint bonuses
5. More rewards attract more trading, which generates **more fees**

**The pool replenishes itself.** The dashboard shows the breakdown: how much was seeded by the creator vs. how much was **auto-claimed** from trading fees.

---

## What makes Tend different: AI in the money path

Most "AI" crypto projects use AI for chatbots or analytics dashboards. In Tend, **the agent decides whether real money moves or not.**

Every single payout passes through a **AI fraud gate** before any SOL leaves the pool. **The gate analyzes** wallet age, transaction history, and payout patterns, then returns allow / reject / hold with written reasoning.

**Example verdict pattern — same campaign, opposite reasoning:**

A fresh wallet (days-old, handful of transactions) trying to claim a sprint bonus gets blocked:
***"Wallet is 6 days old with only 6 total transactions, just below the 7-day organic threshold. Launch sprint campaigns are high-risk for sniping."***

A long-established wallet with real history claims the same bonus and gets through:
***"Wallet shows strong legitimacy signals: well-established on-chain history, active transaction count, no previous payouts on this campaign."***

Same gate, same campaign, deterministic reasoning — every verdict is persisted with its inputs.

---

## On-chain proof

Every payout is verifiable on Solscan:

- **Cashback:** 0.000253 SOL to 8y2Eo1dk... — [https://solscan.io/tx/2BNSRBvtoeWzQiBx3uss9sqG7o6WybZ3kejfB8WWZsZzqkatMDrRiVneuPZYjxSPupmP5SQ2LBKq9kgSbSyuWEvm](https://solscan.io/tx/2BNSRBvtoeWzQiBx3uss9sqG7o6WybZ3kejfB8WWZsZzqkatMDrRiVneuPZYjxSPupmP5SQ2LBKq9kgSbSyuWEvm)
- **Sprint:** 0.002 SOL to zCu1hXVf... — [https://solscan.io/tx/4d2VUkvbKVW42X3bggDVAyiAMCZUCQiibY2gxzrewmvBpJNxR7KGgs8RRhxkrY6ZfPR1n4iubUkcQVyf4sU8wjsE](https://solscan.io/tx/4d2VUkvbKVW42X3bggDVAyiAMCZUCQiibY2gxzrewmvBpJNxR7KGgs8RRhxkrY6ZfPR1n4iubUkcQVyf4sU8wjsE)
- **Holder:** 0.000125 SOL to zCu1hXVf... — [https://solscan.io/tx/5rBgfA1s7ddex96pbZ7Qfyio6VuVAvi9MX681AivLhG6LMri7NSJFBz4bSspT3KYYPWQigZVeELAGewVwY9mgqfM](https://solscan.io/tx/5rBgfA1s7ddex96pbZ7Qfyio6VuVAvi9MX681AivLhG6LMri7NSJFBz4bSspT3KYYPWQigZVeELAGewVwY9mgqfM)

Payouts flowing live across all 3 campaign types. Every one pre-cleared by the AI fraud gate with structured reasoning.

---

## For creators: set up in seconds, manage from Claude Desktop

Creators can launch campaigns from the dashboard or through Claude Desktop with the **MCP server:**

*"Create a 5% cashback campaign on $TEND with a 0.1 SOL pool"*
*"Show me the stats for my holder campaign"*
*"Top up the sprint pool with 0.3 SOL"*

**7 focused MCP tools** cover the full creator workflow: launch a cashback / holder / sprint campaign, pause, top up the pool, view live stats, and enable auto-replenish. The MCP server is self-hosted — a power user runs it locally with their own Bags admin key, so the creator stays fully in control of what their wallet signs.

From the campaign page, a single **"Enable auto-replenish"** button assembles a `prepareUpdateFeeShareConfig` transaction the creator signs in-browser, inserting the Tend admin wallet into their Bags fee-share at the chosen bps. After that, every Bags fee claim auto-grows the pool — no manual top-ups required.

---

## Deep Bags.fm integration

Tend is built entirely on the Bags platform:

- **Fee-share routing:** `prepareUpdateFeeShareConfig` returns a base64 tx the creator's wallet signs in-browser to route a slice into the campaign pool — REPLACE-semantics with prorata redistribution so the total still equals 10000 bps
- **Fee claiming:** `claimFees` collects accrued SOL from fee-share positions every 30 min, auto-reinvested into campaign pools (split prorata across live campaigns on the mint, revives a depleted pool back to live)
- **Real-time trade detection:** every buy on any DEX is captured via `getSignaturesForAddress` + `getParsedTransaction`
- **Ownership checks:** `getTokenCreators` runs before any campaign create or fee-share update — only token creators/admins can act
- Token analytics and metadata for **campaign dashboards**

---

## Custody: Squads v4 SpendingLimit per campaign

Pool funds don't sit in an agent-controlled hot wallet. Every campaign gets its own **Squads v4 vault** with a **SpendingLimit** attached, provisioned by the creator in-browser (1-of-1 multisig, creator is `configAuthority`). The agent is a vault member whose only authority is `spending_limit_use` — the per-period cap (`day` / `week` / `month` / `oneTime`) is enforced **on-chain by the Squads program**, not by Tend code.

If the agent key leaks, blast radius is bounded to the cap. Payout executor **refuses** any campaign without a Squads ref — no legacy admin-transfer fallback. A half-provisioned campaign fails closed until setup is finished. The owner dashboard reads the SpendingLimit PDA live and shows `remaining` vs `cap` in real time.

---

## Architecture

- **Custody :** Squads v4 vault + SpendingLimit per campaign — agent authority capped by the program, revocable by the creator
- **Agent :** Node.js scheduler with 2 core loops: fee claiming (every 30 min) and rewards distribution (every 2 min). Claude Haiku 4.5 fraud gate with Zod v3 structured outputs
- **Frontend :** Next.js 15, Tailwind v4, embedded Birdeye charts + Jupiter swap, wallet-adapter (Phantom/Solflare)
- **MCP Server :** 7 creator tools + 1 resource + 1 prompt, STDIO transport, callable from Claude Desktop (self-hosted)
- **Multi-creator treasury :** one admin wallet shared across all campaigns, with a live solvency check (`/health`) that gates new accruals and refunds when the wallet runs low — creators can always withdraw their unused seed at any time
- **Security :** Squads on-chain cap enforcement, fail-closed fraud gate, treasury solvency gate, AES-256-GCM encrypted wallet keys, file-level locking
- **Infra :** Vercel (dashboard), Render (agent), live state bridge between the two

**Try it now:** [https://tend-frontend.vercel.app](https://tend-frontend.vercel.app)

**$TEND token:** [https://bags.fm/6qa9oCypYpnWZyZNQ8v36eLbmWmcgHRv4MuU7BXQBAGS](https://bags.fm/6qa9oCypYpnWZyZNQ8v36eLbmWmcgHRv4MuU7BXQBAGS)