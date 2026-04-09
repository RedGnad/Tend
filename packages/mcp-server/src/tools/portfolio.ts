import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { BagsClient } from "@tend/shared";
import { formatSol } from "@tend/shared";
import type { StateManager } from "../state/index.js";
import { getService } from "../state/service-registry.js";

export function registerPortfolioTools(
  server: McpServer,
  bags: BagsClient,
  state: StateManager
) {
  server.tool(
    "all_managed_tokens",
    "List all tokens currently managed by Tend with their service count, allocations, and lifetime fees.",
    {},
    async () => {
      const tokens = state.getAllManagedTokens();

      if (tokens.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No tokens are currently managed by Tend. Use 'add_service_to_token' to get started.",
            },
          ],
        };
      }

      const lines: string[] = [];
      for (const token of tokens) {
        let lifetimeFees: number;
        try {
          lifetimeFees = await bags.getTokenLifetimeFees(token.tokenMint);
        } catch {
          lifetimeFees = 0;
        }

        lines.push(
          [
            `Token: ${token.tokenMint.slice(0, 12)}...`,
            `  Services: ${token.services.length} active`,
            `  Creator: ${token.creatorBps} BPS (${(token.creatorBps / 100).toFixed(1)}%)`,
            `  Services: ${token.totalServiceBps} BPS (${(token.totalServiceBps / 100).toFixed(1)}%)`,
            `  Lifetime Fees: ${formatSol(lifetimeFees)}`,
            `  Managed Since: ${new Date(token.createdAt).toISOString()}`,
          ].join("\n")
        );
      }

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `=== Tend Portfolio: ${tokens.length} token(s) ===`,
              "",
              ...lines,
            ].join("\n"),
          },
        ],
      };
    }
  );

  server.tool(
    "total_revenue",
    "Show total fee revenue earned across all managed tokens and services.",
    {
      periodDays: z
        .number()
        .default(7)
        .optional()
        .describe("Period in days to calculate revenue (default: 7)"),
    },
    async ({ periodDays }) => {
      const tokens = state.getAllManagedTokens();

      if (tokens.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No tokens managed. No revenue to report.",
            },
          ],
        };
      }

      let totalLifetimeFees = 0;
      let totalServiceFees = 0;
      const tokenBreakdown: string[] = [];

      for (const token of tokens) {
        try {
          const lifetimeFees = await bags.getTokenLifetimeFees(
            token.tokenMint
          );
          totalLifetimeFees += lifetimeFees;

          const serviceFees = token.services.reduce(
            (sum, s) => sum + (Number(s.stats.totalFeesClaimed) || 0),
            0
          );
          totalServiceFees += serviceFees;

          tokenBreakdown.push(
            `  ${token.tokenMint.slice(0, 12)}...: ${formatSol(lifetimeFees)} lifetime, ${formatSol(serviceFees)} to services`
          );
        } catch {
          tokenBreakdown.push(
            `  ${token.tokenMint.slice(0, 12)}...: Error fetching data`
          );
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: [
              "=== Tend Revenue Report ===",
              "",
              `Tokens Managed: ${tokens.length}`,
              `Total Lifetime Fees: ${formatSol(totalLifetimeFees)}`,
              `Fees Claimed by Services: ${formatSol(totalServiceFees)}`,
              `Active Services: ${tokens.reduce((sum, t) => sum + t.services.length, 0)}`,
              "",
              "── Per Token ──",
              ...tokenBreakdown,
            ].join("\n"),
          },
        ],
      };
    }
  );

  server.tool(
    "service_performance",
    "Show cross-token performance metrics for a specific service type or all services.",
    {
      serviceId: z
        .string()
        .optional()
        .describe("Service ID to analyze, or omit for all"),
    },
    async ({ serviceId }) => {
      const tokens = state.getAllManagedTokens();
      const allServices = tokens.flatMap((t) => t.services);

      const filtered = serviceId
        ? allServices.filter((s) => s.serviceId === serviceId)
        : allServices;

      if (filtered.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: serviceId
                ? `No active instances of "${serviceId}" across managed tokens.`
                : "No active services across managed tokens.",
            },
          ],
        };
      }

      // Group by service type
      const byType = new Map<string, typeof filtered>();
      for (const s of filtered) {
        const existing = byType.get(s.serviceId) ?? [];
        existing.push(s);
        byType.set(s.serviceId, existing);
      }

      const lines: string[] = [];
      for (const [id, instances] of byType) {
        const def = getService(id);
        const totalEarned = instances.reduce(
          (sum, s) => sum + Number(s.stats.totalFeesEarned),
          0
        );
        const totalClaimed = instances.reduce(
          (sum, s) => sum + Number(s.stats.totalFeesClaimed),
          0
        );
        const totalActions = instances.reduce(
          (sum, s) => sum + s.stats.actionsPerformed,
          0
        );
        const avgBps = Math.round(
          instances.reduce((sum, s) => sum + s.bps, 0) / instances.length
        );

        lines.push(
          [
            `${def?.name ?? id}`,
            `  Instances: ${instances.length} across ${new Set(instances.map((s) => s.tokenMint)).size} token(s)`,
            `  Avg Allocation: ${avgBps} BPS (${(avgBps / 100).toFixed(1)}%)`,
            `  Total Earned: ${formatSol(totalEarned)}`,
            `  Total Claimed: ${formatSol(totalClaimed)}`,
            `  Total Actions: ${totalActions}`,
          ].join("\n")
        );
      }

      return {
        content: [
          {
            type: "text" as const,
            text: [
              "=== Service Performance ===",
              "",
              ...lines,
            ].join("\n"),
          },
        ],
      };
    }
  );
}
