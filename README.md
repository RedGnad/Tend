# Tend

**Fee-sharing as a service for Bags.fm**

Tend transforms Bags.fm fee-sharing into an automatic payment rail for AI services. Creators allocate a percentage of their token's trading fees to autonomous services — buyback bots, analytics engines, growth agents — that execute on-chain without human intervention.

```
Trading Volume → 1% Fee → Tend Orchestrator → Creator (configurable) + Services (configurable)
                                                              ↓
                                                      Fee-share splits on-chain
                                                      Services claim & execute autonomously
```

## Why

Every Bags.fm token generates trading fees split among claimers. Today that's just humans manually claiming SOL. Tend makes fees **work** — services earn fees proportional to the value they create, and they execute autonomously. No subscriptions, no upfront cost. Services earn only when your token has volume.

## What's included

### MCP Server — 18 tools for Claude Desktop

The first and deepest MCP integration for Bags.fm. Tell Claude what you want in natural language:

```
"Add the buyback bot to my token with 20% allocation"
"What's the fee breakdown for token ABC123?"
"Show me the agent's recent decisions and reasoning"
"Launch a new token with buyback bot pre-configured"
```

| Group | Tools |
|-------|-------|
| **Services** | `list_available_services` `add_service_to_token` `remove_service_from_token` `service_status` |
| **Token** | `token_health` `fee_breakdown` `holder_analysis` `before_after_comparison` |
| **Manage** | `configure_strategy` `set_allocation` `claim_fees` `emergency_stop` |
| **Portfolio** | `all_managed_tokens` `total_revenue` `service_performance` |
| **Launch** | `launch_token` `top_tokens_by_fees` |
| **Agent** | `agent_decision_log` |

### Dashboard — self-service UI

Next.js 15 dark-mode dashboard with wallet connect. Manage services, view fee flows, track activity — all backed by live Bags API data.

- Wallet-gated token management
- Real-time fee distribution visualization
- Live activity feed (claim events from Bags API)
- Service marketplace with 1 active service + 5 coming soon
- Top tokens leaderboard by lifetime fees
- Per-token detail with on-chain claim stats

### Agent Runtime — AI-powered buyback agent

Autonomous agent that claims fees, collects market snapshots, and uses Claude API to decide whether to buy, hold, or partial-buy. Every decision is logged with inputs, reasoning, and outcome.

| Service | Default | Status |
|---------|---------|--------|
| **Buyback Bot** | 15% | **Active** — Claims fees, swaps SOL for token, creates buy pressure |
| Fee Compounder | 10% | *Coming soon* — Reinvests fees into liquidity positions |
| Analytics Engine | 5% | *Coming soon* — Monitors holders, fees, generates reports |
| Growth Agent | 20% | *Coming soon* — AI-powered community engagement |
| Market Maker | 25% | *Coming soon* — Active liquidity and tight spreads |
| Community Rewards | 15% | *Coming soon* — Fee revenue to top holders |

## Architecture

```
packages/
├── shared/          # Types, Bags SDK wrapper, Solana utils
│   └── bags-client  # Wraps all Bags SDK interactions (fee-share, claims, trades, launch)
├── mcp-server/      # 17 MCP tools + prompts + resources (STDIO transport)
│   ├── tools/       # 4 tool groups (services, token, manage, portfolio, launch)
│   ├── state/       # StateManager + service registry + wallet pool
│   └── services/    # Fee-share orchestrator (translates service config → on-chain tx)
├── agent/           # Buyback bot (5m interval) + fee claimer (30m interval)
└── frontend/        # Next.js 15, Tailwind v4, Recharts, Solana wallet adapter
    ├── components/  # TokenManager, FeeFlow, ServiceCards, ActivityFeed, Leaderboard
    └── api/         # 7 API routes (tokens, health, services, activity, leaderboard)
```

## Quick start

```bash
git clone https://github.com/RedGnad/Tend.git
cd Tend
npm install
cp .env.example .env
# Fill in BAGS_API_KEY, SOLANA_RPC_URL, TEND_PRIVATE_KEY
npm run build
```

### Claude Desktop (MCP)

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "tend": {
      "command": "node",
      "args": ["<path>/packages/mcp-server/build/index.js"],
      "env": {
        "BAGS_API_KEY": "...",
        "SOLANA_RPC_URL": "...",
        "TEND_PRIVATE_KEY": "..."
      }
    }
  }
}
```

### Dashboard

```bash
npm run dev:dashboard
# http://localhost:3000
```

### Agent

```bash
npm run dev:agent
# Buyback agent runs every 5 min (AI decision), fee claimer every 30 min
# Requires: ANTHROPIC_API_KEY env var
```

## Stack

- **MCP**: `@modelcontextprotocol/sdk` v1.29 (STDIO)
- **Solana**: `@solana/web3.js` + `@bagsfm/bags-sdk` v1.3.5
- **AI**: `@anthropic-ai/sdk` — Claude API for buyback decisions
- **Frontend**: Next.js 15, Tailwind CSS v4, Recharts
- **Runtime**: Node.js, TypeScript, npm workspaces

## Tracks

Built for [Bags Hackathon](https://bags.fm/hackathon) ($4M developer fund)

- **Claude Skills** — First MCP server for Bags.fm (18 tools)
- **Fee Sharing** — Fee-sharing as a programmable payment rail
- **AI Agents** — Decisional buyback agent powered by Claude API
- **Bags API** — Deep integration across all SDK modules

## $TEND Token

Live on Bags.fm: [`6qa9oCypYpnWZyZNQ8v36eLbmWmcgHRv4MuU7BXQBAGS`](https://bags.fm/6qa9oCypYpnWZyZNQ8v36eLbmWmcgHRv4MuU7BXQBAGS)

Dog-fooding Tend — fee-sharing config set at launch. Service wallets are managed by the Tend runtime.

## License

MIT
