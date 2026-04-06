#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BagsClient, loadKeypair, createConnection } from "@tend/shared";
import { StateManager } from "./state/index.js";
import { FeeShareOrchestrator } from "./services/orchestrator.js";
import { registerServiceTools } from "./tools/services.js";
import { registerTokenTools } from "./tools/token.js";
import { registerManageTools } from "./tools/manage.js";
import { registerPortfolioTools } from "./tools/portfolio.js";
import { registerLaunchTools } from "./tools/launch.js";

// All debug output to stderr (STDIO transport requirement)
const log = (...args: unknown[]) => console.error("[tend]", ...args);

async function main() {
  // Validate env
  const apiKey = process.env.BAGS_API_KEY;
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const privateKey = process.env.TEND_PRIVATE_KEY;

  if (!apiKey || !rpcUrl || !privateKey) {
    log(
      "Missing required env vars: BAGS_API_KEY, SOLANA_RPC_URL, TEND_PRIVATE_KEY"
    );
    process.exit(1);
  }

  // Init services
  const keypair = loadKeypair(privateKey);
  log(`Wallet: ${keypair.publicKey.toBase58()}`);

  const bags = new BagsClient({
    apiKey,
    rpcUrl,
    privateKey: keypair,
  });

  const state = new StateManager();
  await state.init();
  log("State loaded");

  const orchestrator = new FeeShareOrchestrator(bags, state);

  // Create MCP server
  const server = new McpServer({
    name: "tend",
    version: "1.0.0",
  });

  // Register all tool groups
  registerServiceTools(server, orchestrator, state);
  registerTokenTools(server, bags, state);
  registerManageTools(server, orchestrator, state);
  registerPortfolioTools(server, bags, state);
  registerLaunchTools(server, bags, state);

  // ── MCP Resources ──
  server.resource("status", "tend://status", async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/plain",
        text: [
          `Tend Protocol Status`,
          `Wallet: ${keypair.publicKey.toBase58()}`,
          `Managed Tokens: ${state.getAllManagedTokens().length}`,
          `Active Services: ${state.getAllManagedTokens().reduce((s, t) => s + t.services.length, 0)}`,
          `Assigned Wallets: ${state.getAssignedWallets().length}/20`,
        ].join("\n"),
      },
    ],
  }));

  // ── MCP Prompts ──
  server.prompt(
    "setup-new-token",
    "Guide for setting up a new token with Tend services",
    { tokenMint: z.string().describe("Token mint address") },
    ({ tokenMint }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `I want to set up Tend services on token ${tokenMint}.`,
              "",
              "Please:",
              "1. Check the token health first",
              "2. Show me available services",
              "3. Recommend which services to add based on the token's current state",
              "4. Add the services I approve",
              "5. Show me the final fee breakdown",
            ].join("\n"),
          },
        },
      ],
    })
  );

  server.prompt(
    "optimize-allocations",
    "Analyze and optimize fee-sharing allocations for best results",
    { tokenMint: z.string().describe("Token mint address") },
    ({ tokenMint }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `Analyze the fee-sharing allocations on token ${tokenMint}.`,
              "",
              "Please:",
              "1. Show current service status and performance",
              "2. Show the before/after comparison",
              "3. Suggest allocation changes to maximize token health",
              "4. Apply changes if I approve",
            ].join("\n"),
          },
        },
      ],
    })
  );

  log(
    "Registered 17 tools + 1 resource + 2 prompts"
  );

  // Connect via STDIO
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("MCP server running on STDIO");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
