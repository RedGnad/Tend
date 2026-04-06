import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PublicKey, Keypair } from "@solana/web3.js";
import type { BagsClient } from "@tend/shared";
import { formatSol } from "@tend/shared";
import type { StateManager } from "../state/index.js";

export function registerLaunchTools(
  server: McpServer,
  bags: BagsClient,
  state: StateManager
) {
  server.tool(
    "launch_token",
    "Launch a new token on Bags.fm with Tend fee-sharing pre-configured. Creates the token, sets up fee-share config with services, and launches on the bonding curve.",
    {
      name: z.string().describe("Token name (e.g., 'My Token')"),
      symbol: z.string().max(10).describe("Token symbol (e.g., 'MYTKN')"),
      description: z.string().describe("Token description"),
      imageUrl: z.string().url().describe("URL to token logo image"),
      initialBuySol: z
        .number()
        .min(0.001)
        .max(10)
        .default(0.01)
        .optional()
        .describe("Initial buy amount in SOL (default: 0.01)"),
      twitter: z.string().optional().describe("Twitter handle"),
      website: z.string().optional().describe("Website URL"),
      services: z
        .array(
          z.object({
            serviceId: z.string(),
            bps: z.number().min(100).max(5000),
          })
        )
        .optional()
        .describe(
          "Services to attach at launch with BPS allocations. Remaining BPS goes to creator."
        ),
    },
    async ({ name, symbol, description, imageUrl, initialBuySol, twitter, website, services }) => {
      try {
        // Step 1: Create token info
        const tokenInfo = await bags.createTokenInfo({
          name,
          symbol,
          description,
          imageUrl,
          twitter,
          website,
        });

        // Step 2: Build fee claimers
        const serviceAllocations = services ?? [];
        const totalServiceBps = serviceAllocations.reduce(
          (sum, s) => sum + s.bps,
          0
        );
        const creatorBps = 10_000 - totalServiceBps;

        if (creatorBps < 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: Total service BPS (${totalServiceBps}) exceeds 10000`,
              },
            ],
            isError: true,
          };
        }

        const claimers: Array<{ wallet: string; bps: number }> = [
          { wallet: bags.keypair.publicKey.toBase58(), bps: creatorBps },
        ];

        // Assign wallets for services
        for (const svc of serviceAllocations) {
          const wallet = state.assignWallet(svc.serviceId, tokenInfo.tokenMint);
          if (!wallet) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: No available wallets in pool",
                },
              ],
              isError: true,
            };
          }
          claimers.push({ wallet: wallet.publicKey, bps: svc.bps });
        }

        // Step 3: Create fee-share config
        const configResult = await bags.createFeeShareConfig(
          tokenInfo.tokenMint,
          claimers,
          bags.keypair.publicKey.toBase58()
        );

        // Step 4: Launch on bonding curve
        const buyLamports = Math.floor((initialBuySol ?? 0.01) * 1e9);
        const launchSig = await bags.launchToken({
          metadataUrl: tokenInfo.tokenLaunch.uri!,
          tokenMint: new PublicKey(tokenInfo.tokenMint),
          initialBuyLamports: buyLamports,
          configKey: new PublicKey(configResult.configKey),
        });

        // Step 5: Register in state
        const activeServices = serviceAllocations.map((svc) => {
          const wallet = state.getWalletForService(
            svc.serviceId,
            tokenInfo.tokenMint
          )!;
          return {
            serviceId: svc.serviceId,
            tokenMint: tokenInfo.tokenMint,
            bps: svc.bps,
            activatedAt: Date.now(),
            config: {},
            status: "active" as const,
            claimerWallet: wallet.publicKey,
            stats: {
              totalFeesEarned: "0",
              totalFeesClaimed: "0",
              actionsPerformed: 0,
            },
          };
        });

        await state.addManagedToken({
          tokenMint: tokenInfo.tokenMint,
          adminWallet: bags.keypair.publicKey.toBase58(),
          services: activeServices,
          creatorBps,
          totalServiceBps,
          lifetimeFees: "0",
          createdAt: Date.now(),
        });

        const serviceLines = serviceAllocations.map(
          (s) => `  ${s.serviceId}: ${s.bps} BPS (${(s.bps / 100).toFixed(1)}%)`
        );

        return {
          content: [
            {
              type: "text" as const,
              text: [
                `✓ Token launched on Bags.fm!`,
                "",
                `Name: ${name} ($${symbol})`,
                `Mint: ${tokenInfo.tokenMint}`,
                `Initial Buy: ${formatSol(buyLamports)}`,
                `Launch TX: ${launchSig}`,
                "",
                `── Fee Distribution ──`,
                `  Creator: ${creatorBps} BPS (${(creatorBps / 100).toFixed(1)}%)`,
                ...serviceLines,
                "",
                `View: https://bags.fm/token/${tokenInfo.tokenMint}`,
                "",
                serviceAllocations.length > 0
                  ? "Services are now active and will begin operating automatically."
                  : "Use 'add_service_to_token' to attach AI services.",
              ].join("\n"),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "top_tokens_by_fees",
    "Show the top Bags.fm tokens ranked by lifetime fee revenue. Useful for finding high-performing tokens to manage.",
    {},
    async () => {
      try {
        const topTokens = await bags.getTopTokensByLifetimeFees();

        const lines = topTokens.slice(0, 15).map((t, i) => {
          const name = t.tokenInfo?.name ?? "Unknown";
          const symbol = t.tokenInfo?.symbol ?? "???";
          const price = t.tokenLatestPrice?.priceUSD
            ? `$${t.tokenLatestPrice.priceUSD.toFixed(6)}`
            : "N/A";
          const mcap = t.tokenInfo?.mcap
            ? `$${(t.tokenInfo.mcap / 1000).toFixed(1)}K`
            : "N/A";

          return `  ${i + 1}. ${name} ($${symbol}) — Fees: ${formatSol(t.lifetimeFees)} | MCap: ${mcap} | Price: ${price}`;
        });

        return {
          content: [
            {
              type: "text" as const,
              text: [
                "=== Top Bags Tokens by Lifetime Fees ===",
                "",
                ...lines,
              ].join("\n"),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
