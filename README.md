# Tend

**Turn Bags.fm trading fees into an automated growth engine.** Creator fees are claimed on-chain, pooled into reward campaigns, and distributed to traders — all managed by an AI agent that blocks bots and sybils.

**Live now:** [tend-frontend.vercel.app](https://tend-frontend.vercel.app) | Agent: [tend-agent.onrender.com](https://tend-agent.onrender.com/health) | Token: [`$TEND`](https://bags.fm/6qa9oCypYpnWZyZNQ8v36eLbmWmcgHRv4MuU7BXQBAGS)

Multi-creator production app. One Tend admin wallet acts as the shared treasury across all campaigns; the agent verifies solvency across every creator's pending obligations before accruing new payouts or releasing withdrawals. The treasury health is exposed at `/health` and gates payout accrual automatically when the wallet runs low.

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
            |-- holder: snapshot holders (cron, per-campaign)
                                           |
                                           v
                  Claude Haiku fraud gate  -->  allow / reject / hold
                                           |
                                           v
                    SOL sent to trader  -->  Solscan tx link in dashboard
```

The creator seeds the pool at launch. Trading activity generates fees that the agent claims and reinvests into the pool automatically. More trading = more fees = more rewards = more trading. Self-sustaining.

## On-chain proof

Real SOL payouts shipped across all 3 campaign types on Solana mainnet. Every tx verifiable on Solscan:

| Campaign | Wallet | SOL | Tx |
|---|---|---|---|
| Cashback | `8y2Eo1dk...` | 0.000253 | [`2BNSRBvt...`](https://solscan.io/tx/2BNSRBvtoeWzQiBx3uss9sqG7o6WybZ3kejfB8WWZsZzqkatMDrRiVneuPZYjxSPupmP5SQ2LBKq9kgSbSyuWEvm) |
| Cashback | `8y2Eo1dk...` | 0.000251 | [`3y8AQmqX...`](https://solscan.io/tx/3y8AQmqXByQqTPMUFuQCVfx6zxa1XFZhjFpqo2mowgQFVVuo8kkvDUEk9LnKVK1JuZTKcKYdLwiU2Z1hUpBFHhsv) |
| Sprint | `zCu1hXVf...` | 0.002000 | [`4d2VUkvb...`](https://solscan.io/tx/4d2VUkvbKVW42X3bggDVAyiAMCZUCQiibY2gxzrewmvBpJNxR7KGgs8RRhxkrY6ZfPR1n4iubUkcQVyf4sU8wjsE) |
| Holder | `zCu1hXVf...` | 0.000125 | [`5rBgfA1s...`](https://solscan.io/tx/5rBgfA1s7ddex96pbZ7Qfyio6VuVAvi9MX681AivLhG6LMri7NSJFBz4bSspT3KYYPWQigZVeELAGewVwY9mgqfM) |

AI fraud decisions logged with structured reasoning — every payout passes the gate before SOL moves.

## Campaign types

| Type | Mechanic | Status |
|---|---|---|
| **Cashback** | % of each qualifying buy returned in SOL | Live on $TEND |
| **Sprint** | Flat SOL bonus to the first N buyers | Live on $TEND |
| **Holder** | Pro-rata SOL dividends on periodic snapshots (configurable), min hold time | Live on $TEND |

All three share the same infrastructure: Bags fee claiming, Claude fraud gate, SOL payout executor, and dashboard UI.

## AI fraud gate — in the critical money path

Every payout passes through Claude Haiku 4.5 before SOL moves on-chain. The gate returns `allow / reject / hold` with structured reasoning. If the gate says no, no SOL moves. If the gate is down, payouts stop.

**Example verdict pattern — same campaign, opposite reasoning:**

A fresh wallet (days-old, handful of transactions) trying to claim a sprint bonus:

> *"Wallet is 6 days old with only 6 total transactions, just below the 7-day organic threshold. Launch sprint campaigns are high-risk for sniping."*  → **blocked**

A long-established wallet claiming the same bonus:

> *"Wallet shows strong legitimacy signals: well-established on-chain history, active transaction count, no previous payouts on this campaign."*  → **allowed**

Every verdict is persisted with its inputs and reasoning, and drives whether SOL moves.

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

Uses Zod v3 structured outputs. Decision logs persisted with full inputs, reasoning, and outcome. Fail-closed: if the AI is unreachable, payouts stop.

**Creator controls** — creators sign campaign lifecycle events (create, pause, resume, topup, route-fees, withdraw) directly from the web app at `/creator` and `/campaigns/[mint]`. Each mutation is a wallet ed25519 signature over `tend:<action>:<mint>:<type>:<ts>` (±5 min window, anti-replay via txSig), funded by an on-chain SOL transfer the agent verifies before applying state. Token ownership is checked against `getTokenCreators` before any campaign create succeeds, so a wallet can only operate on mints it owns or admins on Bags. Unused pool seed is refundable at any time via a creator-signed withdraw action — the agent verifies treasury solvency across all creators before releasing funds.

**Auto-replenish** — the `route-fees` action lets a creator one-click insert the Tend admin wallet into their Bags fee-share config at a chosen bps (default 10%, capped at 50%). Existing claimers stay — their share is reduced prorata so the total still equals 10000 bps. Once routed, every Bags fee claim auto-grows the campaign pool. The agent assembles the REPLACE-semantics update via `prepareUpdateFeeShareConfig` and the creator's wallet signs the resulting `VersionedTransaction` in-browser. No manual top-ups required.

The MCP server is an optional shortcut for Claude Desktop users and exposes 7 operations as tools (self-hosted by power users with their own Bags admin key):

```
"Create a 2% cashback campaign on $TEND with a 0.5 SOL pool"
"Show me the stats for my holder campaign"
"Top up the sprint pool with 0.3 SOL"
```

## Stack

- **Monorepo**: npm workspaces (`shared`, `agent`, `mcp-server`, `frontend`)
- **AI**: Claude Haiku 4.5 + `@anthropic-ai/sdk` + Zod v3 structured outputs
- **Solana**: `@solana/web3.js` + `@bagsfm/bags-sdk`
- **MCP**: `@modelcontextprotocol/sdk` (STDIO transport)
- **Frontend**: Next.js 15, Tailwind CSS v4, wallet-adapter
- **Infra**: Vercel (dashboard), Render (agent), live state bridge

## Architecture

```
packages/
  shared/       Types, Bags SDK wrapper, Solana utils, Squads v4 client, AES-256-GCM crypto
  agent/        Fee claimer, rewards dispatcher, per-type triggers, fraud gate, payout executor, treasury-health
  mcp-server/   7 MCP tools (STDIO) — creator console (optional, self-hosted)
  frontend/     Next.js 15 dashboard + read-only API routes
```

**Agent loop (2 ticks):**
- `tickCampaignFeeClaims` (30 min) — claim Bags trading fees → grow campaign pools
- `tickRewards` (2 min) — detect trades → fraud gate → accrue payouts → send SOL

## Custody — Squads v4 SpendingLimit per campaign

Every campaign's pool lives in its own **Squads v4 vault** with a **SpendingLimit** attached — not in an agent-controlled hot wallet. The agent is a vault member whose only authority is `spending_limit_use`, enforced **on-chain** by the Squads program:

- Creator signs the vault + SpendingLimit provisioning in-browser (1-of-1 multisig, creator is `configAuthority`).
- The SpendingLimit caps `amount` per `period` (`day` / `week` / `month` / `oneTime`).
- Payout executor **refuses** any campaign without a Squads ref — no legacy admin-transfer fallback. A half-provisioned campaign fails closed until the creator finishes setup.
- Even if the agent key leaks, blast radius is bounded to the per-period cap. Creator can revoke or remove the SpendingLimit directly via the Squads program.

The owner dashboard reads the SpendingLimit PDA live and shows `remaining` vs `cap` in real time.

## Treasury health — fail-closed solvency gate

The shared Tend admin wallet is audited every 5 minutes: `balance − (pending payouts + refund obligations across all creators)`. If the surplus drops into the `low` or `critical` band, alerts fire and the scheduler blocks new accruals and withdrawals until the wallet is topped up. Treasury state is exposed publicly at `/health`.

## Quick start

```bash
npm install && cp .env.example .env
# Set: BAGS_API_KEY, SOLANA_RPC_URL, TEND_PRIVATE_KEY, ANTHROPIC_API_KEY
npm run build
npm run dev:dashboard    # Dashboard at localhost:3000
npm run dev:agent        # Rewards agent
```

## Security

- **Squads v4 custody** — campaign pools held in on-chain vaults with per-period SpendingLimits. Agent authority is capped by the program, not by Tend code. Mandatory on the payout path
- **Treasury solvency gate** — `/health` audits surplus every 5 min across all creators' obligations; accruals and withdrawals stop fail-closed when the shared admin wallet goes into `low` / `critical`
- **Fail-closed fraud gate** — every payout vetted by Claude Haiku before the on-chain leg; if the gate is down, payouts stop
- **Intent chain** — prepare/submit flow with `prepareId` prevents replay; mutations are wallet-signed ed25519 messages with a ±5 min window
- **AES-256-GCM** — service wallet keys encrypted at rest; concurrent-write contention retries up to 3× on SQLSTATE 40001

## Hackathon tracks

Built for [The Bags Hackathon](https://bags.fm/hackathon) ($1M prize pool)

- **Fee Sharing** — trading fees automatically claimed and recycled into community reward campaigns
- **AI Agents** — Claude Haiku in the critical payout path, not decoration
- **Claude Skills** — MCP server as the creator console
- **Bags API** — deep integration across fee-share, claims, trades, token data
