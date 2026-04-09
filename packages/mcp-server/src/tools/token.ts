import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BagsClient } from "@tend/shared";
import { formatSol } from "@tend/shared";
import type { StateManager } from "../state/index.js";

export function registerTokenTools(
  server: McpServer,
  bags: BagsClient,
  state: StateManager
) {
  server.tool(
    "token_health",
    "Get a comprehensive health report for a Bags token: lifetime fees, claim activity, creators, and current price data.",
    {
      tokenMint: z.string().describe("Solana token mint address"),
    },
    async ({ tokenMint }) => {
      try {
        const [lifetimeFees, creators, claimEvents, metadata] =
          await Promise.all([
            bags.getTokenLifetimeFees(tokenMint).catch(() => 0),
            bags.getTokenCreators(tokenMint).catch(() => []),
            bags.getTokenClaimEvents(tokenMint, { limit: 100 }).catch(() => []),
            bags.getTokenMetadata(tokenMint).catch(() => null),
          ]);

        const managed = state.getManagedToken(tokenMint);
        const tendServices = managed ? managed.services.length : 0;

        // Get actual claimable amounts per wallet for accurate unclaimed figure
        const { PublicKey } = await import("@solana/web3.js");
        const claimableByWallet: Record<string, number> = {};
        let totalUnclaimed = 0;
        for (const c of creators) {
          if (c.wallet && c.royaltyBps > 0) {
            try {
              const positions = await bags.getClaimablePositions(
                new PublicKey(c.wallet)
              );
              const tokenPositions = positions.filter(
                (p: { baseMint: string }) => p.baseMint === tokenMint
              );
              const claimable = tokenPositions.reduce(
                (s: number, p: { totalClaimableLamportsUserShare: number }) =>
                  s + p.totalClaimableLamportsUserShare,
                0
              );
              claimableByWallet[c.wallet] = claimable;
              totalUnclaimed += claimable;
            } catch {
              // Skip if position check fails
            }
          }
        }
        const totalClaimed = lifetimeFees - totalUnclaimed;

        const tokenLabel = metadata
          ? `${metadata.name} ($${metadata.symbol})`
          : tokenMint.slice(0, 8) + "...";

        const creatorLines = creators.map(
          (c: { username?: string; provider?: string | null; royaltyBps: number; isAdmin?: boolean; wallet?: string }) => {
            const claimable = c.wallet ? claimableByWallet[c.wallet] : undefined;
            const claimableStr = claimable !== undefined ? ` | Claimable: ${formatSol(claimable)}` : "";
            return `  ${c.username || c.wallet?.slice(0, 8) || "Unknown"} (${c.provider ?? "wallet"}) — ${c.royaltyBps} BPS (${(c.royaltyBps / 100).toFixed(1)}%)${c.isAdmin ? " [ADMIN]" : ""}${claimableStr}`;
          }
        );

        const claimLines = claimEvents.slice(0, 5).map(
          (e: { amount: string | number; wallet: string; timestamp: number }) =>
            `  ${formatSol(e.amount)} by ${e.wallet.slice(0, 8)}... at ${new Date(e.timestamp * 1000).toISOString()}`
        );

        return {
          content: [
            {
              type: "text" as const,
              text: [
                `=== Token Health: ${tokenLabel} ===`,
                `Mint: ${tokenMint}`,
                "",
                `Lifetime Fees: ${formatSol(lifetimeFees)}`,
                `Total Claimed: ${formatSol(totalClaimed)}`,
                `Unclaimed: ${formatSol(totalUnclaimed)}`,
                `Tend Services Active: ${tendServices}`,
                "",
                "── Fee Allocation ──",
                ...creatorLines,
                "",
                "── Recent Claims ──",
                ...(claimLines.length > 0
                  ? claimLines
                  : ["  No recent claim events"]),
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
    "fee_breakdown",
    "Show the fee distribution breakdown for a token: who receives what percentage of trading fees and how much they've claimed.",
    {
      tokenMint: z.string().describe("Solana token mint address"),
    },
    async ({ tokenMint }) => {
      try {
        const [creators, claimEvents, metadata] = await Promise.all([
          bags.getTokenCreators(tokenMint).catch(() => []),
          bags.getTokenClaimEvents(tokenMint, { limit: 200 }).catch(() => []),
          bags.getTokenMetadata(tokenMint).catch(() => null),
        ]);

        const managed = state.getManagedToken(tokenMint);

        // Aggregate claimed amounts per wallet from actual claim events
        const claimedByWallet: Record<string, number> = {};
        for (const e of claimEvents) {
          claimedByWallet[e.wallet] =
            (claimedByWallet[e.wallet] || 0) + Number(e.amount);
        }

        const totalBps = creators.reduce((sum: number, c: { royaltyBps: number }) => sum + c.royaltyBps, 0);

        const tokenLabel = metadata
          ? `${metadata.name} ($${metadata.symbol})`
          : tokenMint.slice(0, 8) + "...";

        const lines = creators.map((c: { wallet: string; username: string; royaltyBps: number }) => {
          const pct = ((c.royaltyBps / 10000) * 100).toFixed(1);
          const claimed = claimedByWallet[c.wallet] || 0;
          const isTendService =
            managed?.services.some(
              (s) => s.claimerWallet === c.wallet
            ) ?? false;
          const label = isTendService
            ? `[TEND] ${managed?.services.find((s) => s.claimerWallet === c.wallet)?.serviceId}`
            : c.username || c.wallet.slice(0, 8) + "...";

          return `  ${label}: ${c.royaltyBps} BPS (${pct}%) — Claimed: ${formatSol(claimed)}`;
        });

        return {
          content: [
            {
              type: "text" as const,
              text: [
                `=== Fee Breakdown: ${tokenLabel} ===`,
                "",
                `Total Allocated: ${totalBps} / 10000 BPS`,
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

  server.tool(
    "holder_analysis",
    "Analyze token holders: creator info, top holders, and concentration metrics.",
    {
      tokenMint: z.string().describe("Solana token mint address"),
    },
    async ({ tokenMint }) => {
      try {
        const [creators, metadata] = await Promise.all([
          bags.getTokenCreators(tokenMint),
          bags.getTokenMetadata(tokenMint).catch(() => null),
        ]);

        // Get top token accounts from Solana
        const { PublicKey } = await import("@solana/web3.js");
        const topAccounts =
          await bags.connection.getTokenLargestAccounts(
            new PublicKey(tokenMint)
          );

        const tokenLabel = metadata
          ? `${metadata.name} ($${metadata.symbol})`
          : tokenMint.slice(0, 8) + "...";

        const topHolders = topAccounts.value.slice(0, 10).map((a, i) => {
          const pct = a.uiAmount
            ? `${a.uiAmount.toLocaleString()} tokens`
            : `${a.amount} raw`;
          return `  ${i + 1}. ${a.address.toBase58().slice(0, 8)}... — ${pct}`;
        });

        const creatorLines = creators.map(
          (c) =>
            `  ${c.username || "Unknown"} (@${c.twitterUsername ?? c.providerUsername ?? "N/A"}) — ${c.royaltyBps} BPS`
        );

        return {
          content: [
            {
              type: "text" as const,
              text: [
                `=== Holder Analysis: ${tokenLabel} ===`,
                "",
                "── Creators ──",
                ...creatorLines,
                "",
                "── Top 10 Holders ──",
                ...topHolders,
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
    "before_after_comparison",
    "Compare token metrics before and after Tend services were activated. Shows fee velocity change and service impact.",
    {
      tokenMint: z.string().describe("Solana token mint address"),
      periodHours: z
        .number()
        .default(24)
        .optional()
        .describe("Comparison period in hours (default: 24)"),
    },
    async ({ tokenMint, periodHours }) => {
      const hours = periodHours ?? 24;
      const managed = state.getManagedToken(tokenMint);

      if (!managed) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Token ${tokenMint} is not managed by Tend. Add services first.`,
            },
          ],
        };
      }

      try {
        const claims = await bags.getTokenClaimEvents(tokenMint, {
          limit: 200,
        });

        const activatedAt = Math.min(
          ...managed.services.map((s) => s.activatedAt)
        );
        const activatedAtSec = Math.floor(activatedAt / 1000);

        const beforeClaims = claims.filter(
          (c) => c.timestamp < activatedAtSec
        );
        const afterClaims = claims.filter(
          (c) => c.timestamp >= activatedAtSec
        );

        const beforeTotal = beforeClaims.reduce(
          (sum, c) => sum + Number(c.amount),
          0
        );
        const afterTotal = afterClaims.reduce(
          (sum, c) => sum + Number(c.amount),
          0
        );

        const beforeAvgPerClaim =
          beforeClaims.length > 0 ? beforeTotal / beforeClaims.length : 0;
        const afterAvgPerClaim =
          afterClaims.length > 0 ? afterTotal / afterClaims.length : 0;

        // Service-specific claims
        const serviceClaimLines = managed.services.map((s) => {
          const serviceClaims = afterClaims.filter(
            (c) => c.wallet === s.claimerWallet
          );
          const total = serviceClaims.reduce(
            (sum, c) => sum + Number(c.amount),
            0
          );
          return `  ${s.serviceId}: ${serviceClaims.length} claims, ${formatSol(total)}`;
        });

        return {
          content: [
            {
              type: "text" as const,
              text: [
                `=== Before/After: ${tokenMint} ===`,
                `Services activated: ${new Date(activatedAt).toISOString()}`,
                "",
                "── BEFORE Tend ──",
                `  Total claims: ${beforeClaims.length}`,
                `  Total volume: ${formatSol(beforeTotal)}`,
                `  Avg per claim: ${formatSol(beforeAvgPerClaim)}`,
                "",
                "── AFTER Tend ──",
                `  Total claims: ${afterClaims.length}`,
                `  Total volume: ${formatSol(afterTotal)}`,
                `  Avg per claim: ${formatSol(afterAvgPerClaim)}`,
                "",
                "── Service Activity ──",
                ...serviceClaimLines,
                "",
                afterTotal > beforeTotal
                  ? `📈 Fee activity increased ${beforeTotal > 0 ? ((afterTotal / beforeTotal - 1) * 100).toFixed(0) + "%" : "from zero"} since Tend activation.`
                  : "Monitoring... more data needed for comparison.",
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
