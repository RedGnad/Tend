# Tend

**Programmable growth layer for Bags.fm tokens.** Four campaign types, one AI fraud gate, every payout auditable on-chain.

Creators allocate a slice of their Bags fee-share to a live reward pool. Traders earn real SOL back when they qualify. The Tend agent watches the chain, a Claude fraud gate vets every payout, and the SOL ships to the trader's wallet with a Solscan tx link. No platform middleman, no points, no airdrops.

## Campaign types

| Type | How it works | Status |
|---|---|---|
| **Cashback** | Reward every qualifying buy with a % of the trade back in SOL | Live |
| **Holder dividends** | Pay holders pro-rata on each snapshot, gated by a minimum hold time | Live |
| **Launch sprint** | Flat SOL bonus to the first N qualifying buyers | Live |
| **Referral** | Pay referrers a share of trades from wallets they bring | Q3 (stub) |

All four types share the same infrastructure: Bags SDK integration, on-chain fee routing, Claude Haiku fraud gate, SOL payout executor, file-locked shared state, and frontend UI. The agent dispatcher picks the right trigger per campaign type on each tick.

## AI fraud gate — in the critical money path

Every payout — across all types — passes through a Claude Haiku 4.5 fraud gate before it ships on-chain. The gate takes the campaign, the event (swap or holder snapshot), and recent history, and returns one of `allow / reject / hold` with a structured reason. Rejected payouts never touch the chain; held ones queue for creator review.

This is not AI decoration. If the gate is down, payouts stop. If the gate says no, no SOL moves.

Bounded authority: the agent can only emit payouts inside campaign budgets, has per-wallet and per-campaign cooldowns, and cannot withdraw or transfer funds outside the payout rail.

## How it works

```
 Creator activates campaign ──→ Bags fee-share routes % to pool wallet
                                       │
                                       ▼
       Agent tick (every minute) ──→ per-type trigger
       ├── cashback / sprint: scan new swaps on the mint
       └── holder: snapshot token holders (cron-throttled)
                                       │
                                       ▼
            Claude Haiku fraud gate  ──→ allow / reject / hold
                                       │
                                       ▼
               Accrue RewardPayout ──→ Shared payout executor
                                       │
                                       ▼
              SOL sent to trader ──→ Solscan tx link in dashboard
```

## Stack

- **Monorepo**: npm workspaces (`shared`, `agent`, `mcp-server`, `frontend`)
- **AI**: Claude Haiku 4.5 with structured outputs (Zod v4) via `@anthropic-ai/sdk`
- **Solana**: `@solana/web3.js` + `@bagsfm/bags-sdk`
- **MCP**: `@modelcontextprotocol/sdk` (STDIO) — creator console
- **Frontend**: Next.js 15, Tailwind CSS v4, wallet-adapter

## Interfaces

**Public dashboard** — `/` landing, `/campaigns` live lineup, `/campaigns/[mint]` detail with payout feed, `/me` user rewards, `/creator` creator activation flow.

**MCP creator console** — 6 tools callable from Claude Desktop:

```
"Create a 2% cashback campaign on $TEND with a 0.5 SOL pool"
"Show me the stats for my holder campaign"
"Top up the sprint pool with 0.3 SOL"
```

## Quick start

```bash
git clone https://github.com/RedGnad/Tend.git && cd Tend
npm install && cp .env.example .env
# Fill: BAGS_API_KEY, SOLANA_RPC_URL, TEND_PRIVATE_KEY, ANTHROPIC_API_KEY
npm run build
```

```bash
npm run dev:dashboard    # Dashboard at http://localhost:3000
npm run dev:agent        # Rewards dispatcher + payout executor
```

**Claude Desktop** — Add to `claude_desktop_config.json`:

```json
{
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
}
```

## Architecture

```
packages/
├── shared/       # Campaign/payout types, Bags SDK wrapper, Solana utils, crypto
├── agent/        # Rewards dispatcher, per-type triggers, fraud gate, payout executor
├── mcp-server/   # 6 MCP tools (STDIO transport) — creator console
└── frontend/     # Next.js 15 dashboard + read-only API routes
```

Agent dispatcher (`packages/agent/src/rewards-distributor.ts`):

```
cashback → runCashbackTrigger   swap-driven · shared swapCursors
holder   → runHolderTrigger     cron-driven · holderSnapshotCursors
sprint   → runSprintTrigger     swap-driven + maxWinners gate · swapCursors
referral → no-op                Q3
```

## Security

- **AES-256-GCM at rest** — service wallet private keys encrypted before writing to disk
- **File-level locking** — cross-process mutex on `~/.tend/state.json` prevents concurrent corruption
- **Intent chain** — prepare→submit flow with `prepareId` prevents replay attacks
- **Heartbeat liveness** — agent emits every 60s, frontend detects stale agents
- **Bounded fraud gate** — every payout vetted by Claude before the on-chain leg; rejected = no tx
- **Local-first state** — deployed dashboard is read-only; all writes require local agent or wallet-sign flow

## Hackathon tracks

Built for [Bags Hackathon](https://bags.fm/hackathon)

- **Fee Sharing** — Programmable growth engine on top of Bags fee-share
- **AI Agents** — Claude Haiku in the critical payout path, not decoration
- **Claude Skills** — MCP server as the creator console for all four campaign types
- **Bags API** — Deep integration across fee-share, claims, trades, on-chain routing

The $TEND token runs live on Solana mainnet: [`6qa9oCypYpnWZyZNQ8v36eLbmWmcgHRv4MuU7BXQBAGS`](https://bags.fm/6qa9oCypYpnWZyZNQ8v36eLbmWmcgHRv4MuU7BXQBAGS)

## License

MIT
