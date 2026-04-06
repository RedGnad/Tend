# Tend — Fee-sharing as a service

## Project
MCP Server + Dashboard for Bags.fm Solana hackathon ($1M prize pool).
Transforms fee-sharing into a payment rail for AI services.

## Stack
- Monorepo: npm workspaces (`packages/shared`, `packages/mcp-server`, `packages/agent`, `packages/frontend`)
- MCP: `@modelcontextprotocol/sdk` v1.29 (STDIO transport)
- Solana: `@solana/web3.js` + `@bagsfm/bags-sdk` v1.3.5
- Frontend: Next.js 15, Tailwind v4, Recharts
- Agent: Vercel AI SDK + Anthropic SDK

## Build
```bash
npm run build           # all packages
npm run build:shared    # shared types + SDK wrapper
npm run build:mcp       # MCP server
npm run dev:dashboard   # Next.js dev
npm run dev:agent       # Agent runtime
```

## Key Architecture
- `packages/shared/src/bags-client.ts` — All Bags SDK interactions, handles tx signing
- `packages/mcp-server/src/services/orchestrator.ts` — Fee-share config management
- `packages/mcp-server/src/state/` — StateManager (persists to `~/.tend/state.json`)
- `packages/mcp-server/src/tools/` — 15 MCP tools across 4 groups

## Conventions
- All shared types in `@tend/shared`
- Never `console.log` in MCP server (STDIO) — use `console.error` for debug
- BPS = basis points (100 = 1%, 10000 = 100%)
- All amounts in lamports internally, format with `formatSol()` for display
- State persisted as JSON file, no database

## MCP Server Config
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
