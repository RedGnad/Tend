#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { BagsClient, loadKeypair } from "@tend/shared";
import { registerCampaignTools } from "./tools/campaigns.js";
import { AgentClient } from "./agent-client.js";

// All debug output to stderr (STDIO transport requirement)
const log = (...args: unknown[]) => console.error("[tend]", ...args);

async function main() {
  const apiKey = process.env.BAGS_API_KEY;
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const privateKey = process.env.TEND_PRIVATE_KEY;
  const agentUrl =
    process.env.TEND_AGENT_URL ?? "https://tend-agent.onrender.com";

  if (!apiKey || !rpcUrl || !privateKey) {
    log(
      "Missing required env vars: BAGS_API_KEY, SOLANA_RPC_URL, TEND_PRIVATE_KEY"
    );
    process.exit(1);
  }

  const keypair = loadKeypair(privateKey);
  log(`Creator wallet: ${keypair.publicKey.toBase58()}`);
  log(`Agent URL: ${agentUrl}`);

  const bags = new BagsClient({
    apiKey,
    rpcUrl,
    privateKey: keypair,
  });

  const agent = new AgentClient(bags, agentUrl);

  const server = new McpServer({
    name: "tend",
    version: "2.0.0",
  });

  registerCampaignTools(server, bags, keypair.publicKey.toBase58(), agent);

  // ── Resource: current creator status (reads from the agent) ──
  server.resource("status", "tend://status", async (uri) => {
    const state = await agent.fetchState();
    const campaigns = state.campaigns;
    const live = campaigns.filter((c) => c.status === "live").length;
    const paused = campaigns.filter((c) => c.status === "paused").length;
    const depleted = campaigns.filter((c) => c.status === "depleted").length;

    const paid = state.rewardPayouts.filter((p) => p.status === "paid");
    const totalPaid = paid.reduce(
      (sum, p) => sum + BigInt(p.rewardLamports),
      0n
    );
    const totalEarners = new Set(paid.map((p) => p.traderWallet)).size;

    return {
      contents: [
        {
          uri: uri.href,
          mimeType: "text/plain",
          text: [
            `Tend — Creator Console`,
            `Creator wallet: ${keypair.publicKey.toBase58()}`,
            `Agent: ${agent.agentUrl}`,
            ``,
            `Campaigns: ${campaigns.length} total — ${live} live, ${paused} paused, ${depleted} depleted`,
            `Total paid out: ${(Number(totalPaid) / 1_000_000_000).toFixed(6)} SOL`,
            `Earners reached: ${totalEarners}`,
          ].join("\n"),
        },
      ],
    };
  });

  // ── Prompt: single workflow — launch a campaign ──
  server.prompt(
    "launch-campaign",
    "Guide a creator through launching a reward campaign for their token",
    { tokenMint: z.string().describe("Token mint address") },
    ({ tokenMint }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: [
              `I want to launch a Tend reward campaign on ${tokenMint}.`,
              ``,
              `Please:`,
              `1. Check if a campaign already exists (view_campaign_stats)`,
              `2. Ask me for the cashback rate (typical: 1-5%) and pool size in SOL`,
              `3. Explain the tradeoff (higher cashback = more buyers, faster depletion)`,
              `4. Create the campaign once I confirm`,
              `5. Remind me the agent + fraud gate now take over automatically`,
            ].join("\n"),
          },
        },
      ],
    })
  );

  log("Registered 7 creator tools + 1 resource + 1 prompt");

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("MCP server running on STDIO");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
