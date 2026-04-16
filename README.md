# Tend

**AI-managed rewards agent for Bags.fm creator tokens.** Creators fund a SOL reward pool from their fee-share. Traders earn SOL back. A Claude fraud gate vets every payout before it ships on-chain.

**Live now:** [tend-frontend.vercel.app](https://tend-frontend.vercel.app) | Agent: [tend-agent.onrender.com](https://tend-agent.onrender.com/health) | Token: [`$TEND`](https://bags.fm/6qa9oCypYpnWZyZNQ8v36eLbmWmcgHRv4MuU7BXQBAGS)

---

## On-chain proof

9 real SOL payouts shipped across 3 campaign types on Solana mainnet. Every tx verifiable on Solscan. Selection below:

| Campaign | Wallet | SOL | Tx |
|---|---|---|---|
| Cashback | `2ZEgCyxU...` | 0.000206 | [`uJXZXahd...`](https://solscan.io/tx/uJXZXahd2hXJSGg6LYoBKFMDXkrMbBdN221ojo1R8Przm2tShPZwLXSXzKY6YzrQfUYzFA58MU5q4ovFyoyiqf3) |
| Cashback | `M5q9egYv...` | 0.060876 | [`3xJdN7th...`](https://solscan.io/tx/3xJdN7thAvRUYrsbb3kEJL9PNM32tKRZrrE1v7LCHAfs6PAaxwFPQKEMB2gupBLdZKDmqzvW3uc4bUuKuf2C8qni) |
| Sprint | `8y2Eo1dk...` | 0.005 | [`4kdjsRMZ...`](https://solscan.io/tx/4kdjsRMZParkWSLKdthLqu3VVfJEL4pXC9evs7WXshcPR8pZ2TmjMpGqqvvBkGiWQYMk17W2qxWVdDREc3guaFFb) |
| Holder | `zCu1hXVf...` | 0.00125 | [`2XBJQwE6...`](https://solscan.io/tx/2XBJQwE6hojePbBZ7fM4RpzitEAX9AsF4jUiw1Se311xysSoU5rQq63oMUGd57h2Pw95FbdWJJEWHh7NMvP6Ma56) |
| Holder | `8y2Eo1dk...` | 0.00125 | [`5CZMNr3a...`](https://solscan.io/tx/5CZMNr3aRwifR17fx8EMRgiCQkv21AUxgGqcERfdTuExtuG923UadpkuXrPm5nkVgkadcLh6hHj7bFnBppoQAgMr) |

8 AI fraud decisions logged (6 allowed, 1 rejected, 1 held). Full example below.

## How it works

```
Creator activates campaign  -->  Bags fee-share routes % to reward pool
                                        |
                                        v
      Agent tick (every ~2 min)  -->  per-type trigger
      |-- cashback / sprint: scan new swaps on the mint
      |-- holder: snapshot token holders (hourly)
                                        |
                                        v
           Claude Haiku fraud gate  -->  allow / reject / hold
                                        |
                                        v
             SOL sent to trader  -->  Solscan tx link in dashboard
```

## Campaign types

| Type | Mechanic | Status |
|---|---|---|
| **Cashback** | % of each qualifying buy returned in SOL | Live on $TEND |
| **Sprint** | Flat SOL bonus to the first N buyers | Live on $TEND |
| **Holder** | Pro-rata SOL dividends on hourly snapshots, min hold time | Live on $TEND |

All three share the same infrastructure: Bags SDK fee routing, Claude fraud gate, SOL payout executor, and dashboard UI.

## AI fraud gate — in the critical money path

Every payout passes through Claude Haiku 4.5 before SOL moves on-chain. The gate returns `allow / reject / hold` with structured reasoning. If the gate says no, no SOL moves. If the gate is down, payouts stop.

**Same campaign, same gate, opposite verdicts:**

A 6-day-old wallet with 6 transactions bought $TEND during the launch sprint. Claude blocked it:

> *"Wallet is 6 days old with only 6 total transactions, just below the 7-day organic threshold. Launch sprint campaigns are high-risk for sniping."*

Flags: `new_wallet_6days`, `low_tx_count`. Sprint slot preserved.

A 1090-day-old wallet with 1000+ transactions made the same trade. Claude allowed it:

> *"Wallet shows strong legitimacy signals: well-established on-chain history, active transaction count, no previous payouts on this campaign."*

Result: 0.005 SOL bonus shipped. Buy tx: [`5rVWNpiR...`](https://solscan.io/tx/5rVWNpiRNikiyRPygLkBSaLtM4rgguMAbBgmtgJ5VeruhzENxx77g1cHFaVhRo4hjcbEGKcktLb3z32fCQxB9ksk) | Payout tx: [`4kdjsRMZ...`](https://solscan.io/tx/4kdjsRMZParkWSLKdthLqu3VVfJEL4pXC9evs7WXshcPR8pZ2TmjMpGqqvvBkGiWQYMk17W2qxWVdDREc3guaFFb)

Bounded authority: the agent can only pay within campaign budgets, has per-wallet cooldowns, and cannot withdraw funds outside the payout rail.

## Bags API integration

Tend is built entirely on the Bags.fm platform:

- **Fee-share config** — `prepareUpdateFeeShareConfig` + `submitFeeShareUpdate` to route creator fees to reward pool wallets
- **Claims** — `claimFees` to collect accrued SOL from fee-share positions
- **Trade detection** — `getSignaturesForAddress` + `getParsedTransaction` to detect qualifying buys in real-time
- **Token data** — `getCreatorTokens`, `getTokenAnalytics`, `getTokenCreators` for campaign dashboards
- **Launch** — `createToken` + `launchToken` for new token deployment with fee-share pre-configured

## Claude / Anthropic integration

Three AI services running in production via `@anthropic-ai/sdk`:

| Service | Model | Cycle | What it does |
|---|---|---|---|
| **Fraud gate** | Claude Haiku 4.5 | Every payout | Structured `allow/reject/hold` with reasoning. Blocks sybils, snipe bots, wash traders |
| **Buyback advisor** | Claude Haiku 4.5 | Every 5 min | Analyzes price, volume, fees, trend. Decides `buy/hold/partial_buy` with amount |
| **Analytics engine** | Claude Haiku 4.5 | Every 2h | Health score (1-10), trend, insights, risks, opportunities per token |

All three use Zod v4 structured outputs. Decision logs persisted with full inputs, reasoning, and outcome.

**MCP creator console** — 27 tools across 8 groups, callable from Claude Desktop:

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
- **Infra**: Vercel (dashboard), Render (agent), cron-job.org (keep-alive)

## Architecture

```
packages/
  shared/       Types, Bags SDK wrapper, Solana utils, AES-256-GCM crypto
  agent/        Rewards dispatcher, per-type triggers, fraud gate, payout executor
  mcp-server/   27 MCP tools (STDIO) — creator console
  frontend/     Next.js 15 dashboard + read-only API routes
```

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
- **Fraud gate** — every payout vetted before the on-chain leg

## Hackathon tracks

Built for [The Bags Hackathon](https://bags.fm/hackathon) ($1M prize pool)

- **Fee Sharing** — programmable rewards on top of Bags fee-share
- **AI Agents** — Claude Haiku in the critical payout path, not decoration
- **Claude Skills** — MCP server as the creator console
- **Bags API** — deep integration across fee-share, claims, trades, token launch
