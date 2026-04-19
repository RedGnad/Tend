# Tend

**Turn Bags.fm trading fees into an automated growth engine.** Creator fees are claimed on-chain, pooled into reward campaigns, and distributed to traders — all managed by an AI agent that blocks bots and sybils.

**Live now:** [tend-frontend.vercel.app](https://tend-frontend.vercel.app) | Agent: [tend-agent.onrender.com](https://tend-agent.onrender.com/health) | Token: [`$TEND`](https://bags.fm/6qa9oCypYpnWZyZNQ8v36eLbmWmcgHRv4MuU7BXQBAGS)

---

## The fee-sharing loop

```
Trader buys $TOKEN on any DEX
       |
       v
Bags.fm collects trading fees  -->  Agent claims fees (every 30 min)
                                           |
                                           v
                                    Campaign pool grows automatically
                                           |
                                           v
            Agent tick (every ~2 min)  -->  per-type trigger
            |-- cashback: scan new swaps on the mint
            |-- sprint: first N buyers get flat bonus
            |-- holder: snapshot holders (hourly)
                                           |
                                           v
                  Claude Haiku fraud gate  -->  allow / reject / hold
                                           |
                                           v
                    SOL sent to trader  -->  Solscan tx link in dashboard
```

The creator seeds the pool at launch. Trading activity generates fees that the agent claims and reinvests into the pool automatically. More trading = more fees = more rewards = more trading. Self-sustaining.

## On-chain proof

24 real SOL payouts shipped across 3 campaign types on Solana mainnet. Every tx verifiable on Solscan:

| Campaign | Wallet | SOL | Tx |
|---|---|---|---|
| Cashback | `2ZEgCyxU...` | 0.000206 | [`uJXZXahd...`](https://solscan.io/tx/uJXZXahd2hXJSGg6LYoBKFMDXkrMbBdN221ojo1R8Przm2tShPZwLXSXzKY6YzrQfUYzFA58MU5q4ovFyoyiqf3) |
| Cashback | `M5q9egYv...` | 0.060876 | [`3xJdN7th...`](https://solscan.io/tx/3xJdN7thAvRUYrsbb3kEJL9PNM32tKRZrrE1v7LCHAfs6PAaxwFPQKEMB2gupBLdZKDmqzvW3uc4bUuKuf2C8qni) |
| Sprint | `8y2Eo1dk...` | 0.005 | [`4kdjsRMZ...`](https://solscan.io/tx/4kdjsRMZParkWSLKdthLqu3VVfJEL4pXC9evs7WXshcPR8pZ2TmjMpGqqvvBkGiWQYMk17W2qxWVdDREc3guaFFb) |
| Holder | `zCu1hXVf...` | 0.00125 | [`2XBJQwE6...`](https://solscan.io/tx/2XBJQwE6hojePbBZ7fM4RpzitEAX9AsF4jUiw1Se311xysSoU5rQq63oMUGd57h2Pw95FbdWJJEWHh7NMvP6Ma56) |
| Holder | `8y2Eo1dk...` | 0.00125 | [`5CZMNr3a...`](https://solscan.io/tx/5CZMNr3aRwifR17fx8EMRgiCQkv21AUxgGqcERfdTuExtuG923UadpkuXrPm5nkVgkadcLh6hHj7bFnBppoQAgMr) |

8 AI fraud decisions logged (6 allowed, 1 rejected, 1 held).

## Campaign types

| Type | Mechanic | Status |
|---|---|---|
| **Cashback** | % of each qualifying buy returned in SOL | Live on $TEND |
| **Sprint** | Flat SOL bonus to the first N buyers | Live on $TEND |
| **Holder** | Pro-rata SOL dividends on periodic snapshots (configurable), min hold time | Live on $TEND |

All three share the same infrastructure: Bags fee claiming, Claude fraud gate, SOL payout executor, and dashboard UI.

## AI fraud gate — in the critical money path

Every payout passes through Claude Haiku 4.5 before SOL moves on-chain. The gate returns `allow / reject / hold` with structured reasoning. If the gate says no, no SOL moves. If the gate is down, payouts stop.

**Same campaign, same gate, opposite verdicts:**

A 6-day-old wallet with 6 transactions bought $TEND during the launch sprint. Claude blocked it:

> *"Wallet is 6 days old with only 6 total transactions, just below the 7-day organic threshold. Launch sprint campaigns are high-risk for sniping."*

A 1090-day-old wallet with 1000+ transactions made the same trade. Claude allowed it:

> *"Wallet shows strong legitimacy signals: well-established on-chain history, active transaction count, no previous payouts on this campaign."*

Result: 0.005 SOL bonus shipped. Bot got nothing.

## Bags API integration

Tend is built entirely on the Bags.fm platform:

- **Fee-share config** — `prepareUpdateFeeShareConfig` returns base64 txs the creator's wallet signs in-browser to route a slice of their Bags fee-share into the campaign pool
- **Fee claiming** — `claimFees` to collect accrued SOL from fee-share positions into campaign pools
- **Trade detection** — `getSignaturesForAddress` + `getParsedTransaction` to detect qualifying buys in real-time
- **Token data** — `getAdminTokenMints`, `getTokenCreators`, `getTokenLifetimeFees` for campaign dashboards and ownership checks

## Claude / Anthropic integration

| Service | Model | Cycle | What it does |
|---|---|---|---|
| **Fraud gate** | Claude Haiku 4.5 | Every payout | Structured `allow/reject/hold` with reasoning. Blocks sybils, snipe bots, wash traders |

Uses Zod v4 structured outputs. Decision logs persisted with full inputs, reasoning, and outcome. Fail-closed: if the AI is unreachable, payouts stop.

**Creator controls** — creators sign campaign lifecycle events (create, pause, resume, topup, route-fees) directly from the web app at `/creator` and `/campaigns/[mint]`. Each mutation is a wallet ed25519 signature over `tend:<action>:<mint>:<type>:<ts>` (±5 min window, anti-replay via txSig), funded by an on-chain SOL transfer the agent verifies before applying state. Token ownership is checked against `getTokenCreators` before any campaign create succeeds, so a wallet can only operate on mints it owns or admins on Bags.

**Auto-replenish** — the `route-fees` action lets a creator one-click insert the Tend admin wallet into their Bags fee-share config at a chosen bps (default 10%, capped at 50%). Existing claimers stay — their share is reduced prorata so the total still equals 10000 bps. Once routed, every Bags fee claim auto-grows the campaign pool. The agent assembles the REPLACE-semantics update via `prepareUpdateFeeShareConfig` and the creator's wallet signs the resulting `VersionedTransaction` in-browser. No manual top-ups required.

The MCP server is an optional shortcut for Claude Desktop users and exposes the same 6 operations as tools:

```
"Create a 2% cashback campaign on $TEND with a 0.5 SOL pool"
"Show me the stats for my holder campaign"
"Top up the sprint pool with 0.3 SOL"
```

## Stack

- **Monorepo**: npm workspaces (`shared`, `agent`, `mcp-server`, `frontend`)
- **AI**: Claude Haiku 4.5 + `@anthropic-ai/sdk` + Zod v4 structured outputs
- **Solana**: `@solana/web3.js` + `@bagsfm/bags-sdk`
- **MCP**: `@modelcontextprotocol/sdk` (STDIO transport)
- **Frontend**: Next.js 15, Tailwind CSS v4, wallet-adapter
- **Infra**: Vercel (dashboard), Render (agent), live state bridge

## Architecture

```
packages/
  shared/       Types, Bags SDK wrapper, Solana utils, AES-256-GCM crypto
  agent/        Fee claimer, rewards dispatcher, per-type triggers, fraud gate, payout executor
  mcp-server/   6 MCP tools (STDIO) — creator console (optional)
  frontend/     Next.js 15 dashboard + read-only API routes
```

**Agent loop (2 ticks):**
- `tickCampaignFeeClaims` (30 min) — claim Bags trading fees → grow campaign pools
- `tickRewards` (2 min) — detect trades → fraud gate → accrue payouts → send SOL

## Quick start

```bash
npm install && cp .env.example .env
# Set: BAGS_API_KEY, SOLANA_RPC_URL, TEND_PRIVATE_KEY, ANTHROPIC_API_KEY
npm run build
npm run dev:dashboard    # Dashboard at localhost:3000
npm run dev:agent        # Rewards agent
```

## Security

- **AES-256-GCM** — service wallet keys encrypted at rest
- **File-level locking** — mutex on state prevents concurrent corruption
- **Intent chain** — prepare/submit flow with `prepareId` prevents replay
- **Bounded agent** — payout-only authority within campaign budgets
- **Fail-closed fraud gate** — every payout vetted before the on-chain leg

## Hackathon tracks

Built for [The Bags Hackathon](https://bags.fm/hackathon) ($1M prize pool)

- **Fee Sharing** — trading fees automatically claimed and recycled into community reward campaigns
- **AI Agents** — Claude Haiku in the critical payout path, not decoration
- **Claude Skills** — MCP server as the creator console
- **Bags API** — deep integration across fee-share, claims, trades, token data
