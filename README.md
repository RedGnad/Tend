# Tend — Fee-sharing as a service

> Transform Bags.fm fee-sharing into a payment rail for autonomous AI services.

Tend is an MCP Server for Claude Desktop that lets creators manage AI services on their Bags.fm tokens through natural language. Instead of fee-sharing just splitting revenue between humans, it becomes an automatic payment protocol for autonomous services — buyback bots, analytics engines, growth agents, and more.

## How it works

```
Trading Fees → Tend Orchestrator → Creator (X%) + Buyback Bot (Y%) + Analytics (Z%)
```

1. **Launch a token** on Bags.fm
2. **Tell Claude**: "Add the buyback bot to my token with 20% allocation"
3. **Tend configures** fee-sharing splits on-chain via Bags SDK
4. **AI services** claim fees & execute autonomously (buybacks, analytics, etc.)

## Architecture

```
packages/
├── shared/          # Types, Bags SDK wrapper, Solana utils
├── mcp-server/      # 17 MCP tools (Claude Desktop interface)
├── agent/           # Autonomous service runtime (buyback bot, fee claimer)
└── frontend/        # Next.js dashboard (dark mode, fee flow viz)
```

## MCP Tools (17)

| Group | Tools | Description |
|-------|-------|-------------|
| **Services** | `list_available_services`, `add_service_to_token`, `remove_service_from_token`, `service_status` | Manage AI services on tokens |
| **Token** | `token_health`, `fee_breakdown`, `holder_analysis`, `before_after_comparison` | Token analytics & monitoring |
| **Manage** | `configure_strategy`, `set_allocation`, `claim_fees`, `emergency_stop` | Fine-tune & control services |
| **Portfolio** | `all_managed_tokens`, `total_revenue`, `service_performance` | Cross-token portfolio view |
| **Launch** | `launch_token`, `top_tokens_by_fees` | Launch tokens with services pre-configured |

## Available Services

| Service | Default BPS | Description |
|---------|-------------|-------------|
| **Buyback Bot** | 15% | Claims fees → buys back the token → buy pressure |
| **Fee Compounder** | 10% | Claims fees → reinvests into liquidity |
| **Analytics Engine** | 5% | Monitors holders, fees, price → health reports |
| **Growth Agent** | 20% | AI-powered community engagement & marketing |
| Market Maker | 25% | *Coming soon* |
| Community Rewards | 15% | *Coming soon* |

## Setup

### 1. Install

```bash
git clone https://github.com/user/tend.git
cd tend
npm install
npm run build
```

### 2. Environment

```bash
cp .env.example .env
# Fill in:
# BAGS_API_KEY      — from https://dev.bags.fm
# SOLANA_RPC_URL    — Helius free tier: https://helius.dev
# TEND_PRIVATE_KEY  — base58 Solana private key
```

### 3. Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "tend": {
      "command": "node",
      "args": ["/path/to/tend/packages/mcp-server/build/index.js"],
      "env": {
        "BAGS_API_KEY": "your-key",
        "SOLANA_RPC_URL": "https://mainnet.helius-rpc.com/?api-key=your-key",
        "TEND_PRIVATE_KEY": "your-base58-key"
      }
    }
  }
}
```

### 4. Start the Agent

```bash
npm run dev:agent
```

### 5. Dashboard

```bash
npm run dev:dashboard
# Open http://localhost:3000
```

## Example Conversations

> "Show me available Tend services"

> "Add the buyback bot to token ABC123... with 20% allocation"

> "What's the health of my token?"

> "Show me the fee breakdown"

> "Emergency stop all services on my token"

> "Launch a new token called MyToken with buyback bot at 15%"

## Stack

- **MCP**: `@modelcontextprotocol/sdk` (STDIO transport)
- **Solana**: `@solana/web3.js` + `@bagsfm/bags-sdk` v1.3.5
- **Frontend**: Next.js 15, Tailwind CSS v4
- **Agent**: Node.js scheduler (buyback every 5m, claims every 30m)

## Built for

[Bags Hackathon](https://bags.fm/hackathon) — $1M prize pool

Tracks: AI Agents, Claude Skills, Fee Sharing, DeFi
