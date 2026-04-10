# Tend

**Turn Bags.fm trading fees into measurable token growth.**

Every Bags.fm token generates trading fees. Today, creators claim them manually — or forget entirely. Tend changes that: allocate a share of your fees to AI services that claim, analyze, and reinvest automatically. No subscriptions. No upfront cost. Services earn only when your token has volume.

## Before / After

| | Without Tend | With Tend |
|---|---|---|
| **Fee claiming** | Manual, forgotten | Automatic, every 5 min |
| **Buyback timing** | Guesswork or never | AI-decided (buy/hold/partial) with reasoning |
| **Token health** | No visibility | Health score, trend, risks, opportunities |
| **Fee allocation** | Static, set once | AI recommends optimal splits |
| **Security** | N/A | AES-256-GCM encrypted wallets, bounded AI |

## How it works

```
Trading fees (1%) ──→ On-chain fee split
                         ├── Creator (configurable %)
                         ├── Buyback Bot (claims → AI decision → buy token)
                         └── Analytics Engine (monitors → reports via Claude)
                              ↓
                         Allocation Advisor (recommends optimal split)
```

One on-chain transaction to activate. Fully revocable anytime.

## What's live

Three AI services forming a closed feedback loop — each uses Claude API, every decision is logged with inputs, reasoning, and on-chain outcome.

| Service | How it works | Cycle |
|---------|-------------|-------|
| **Buyback Bot** | Claims fees → collects market snapshot → Claude decides buy/hold/partial → executes swap → logs decision | 5 min |
| **Analytics Engine** | Collects on-chain data → Claude generates health score, trend, risks/opportunities | 2 hours |
| **Allocation Advisor** | Reads performance data → Claude recommends optimal fee splits (advisory-only, free) | 6 hours |

The $TEND token runs all three on Solana mainnet: [`6qa9oCypYpnWZyZNQ8v36eLbmWmcgHRv4MuU7BXQBAGS`](https://bags.fm/6qa9oCypYpnWZyZNQ8v36eLbmWmcgHRv4MuU7BXQBAGS)

## Interfaces

**Dashboard** — Connect your wallet, explore tokens, view fee distributions, track agent decisions and analytics reports. Self-service UI for managing services.

**Claude Desktop (MCP)** — 21 tools via Model Context Protocol. Manage everything through natural language:

```
"Add the buyback bot to my token with 15% allocation"
"Show me the agent's recent decisions"
"What's the health score for $TEND?"
```

## Security

- **AES-256-GCM encryption at rest** — Service wallet private keys encrypted before writing to disk
- **Local-first** — State lives on your machine. The deployed dashboard is read-only
- **Bounded AI** — Every action has a finite action space, max amounts, cooldowns. The agent cannot withdraw or transfer
- **File-level locking** — Cross-process mutex prevents concurrent state corruption
- **Intent chain** — prepare→submit flow with prepareId prevents replay attacks
- **Heartbeat liveness** — Agent heartbeat every 60s, frontend detects stale agents

## Quick start

```bash
git clone https://github.com/RedGnad/Tend.git && cd Tend
npm install && cp .env.example .env
# Fill: BAGS_API_KEY, SOLANA_RPC_URL, TEND_PRIVATE_KEY, ANTHROPIC_API_KEY
npm run build
```

```bash
npm run dev:dashboard    # Dashboard at http://localhost:3000
npm run start:agent      # Agent runtime (buyback 5m, claims 30m, analytics 2h, allocation 6h)
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
        "TEND_PRIVATE_KEY": "..."
      }
    }
  }
}
```

## Architecture

```
packages/
├── shared/       # Types, Bags SDK wrapper, Solana utils, crypto
├── agent/        # Buyback bot + fee claimer + analytics + allocation advisor
├── mcp-server/   # 21 MCP tools (STDIO transport), 48 tests
└── frontend/     # Next.js 15, Tailwind v4, wallet connect, 12 API routes
```

## Stack

- **AI**: Claude Haiku with structured outputs (Zod schemas) via `@anthropic-ai/sdk`
- **Solana**: `@solana/web3.js` + `@bagsfm/bags-sdk`
- **MCP**: `@modelcontextprotocol/sdk` (STDIO)
- **Frontend**: Next.js 15, Tailwind CSS v4

## Hackathon tracks

Built for [Bags Hackathon](https://bags.fm/hackathon)

- **AI Agents** — Autonomous buyback agent with Claude-powered decisions
- **Claude Skills** — First MCP server for Bags.fm
- **Bags API** — Deep integration across fee-share, claims, trades, launch
- **Fee Sharing** — Fee-sharing as a programmable growth engine

## License

MIT
