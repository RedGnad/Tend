import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { FeeShareOrchestrator } from "../services/orchestrator.js";
import type { StateManager } from "../state/index.js";
import { getService } from "../state/service-registry.js";
import { formatSol } from "@tend/shared";

export function registerManageTools(
  server: McpServer,
  orchestrator: FeeShareOrchestrator,
  state: StateManager
) {
  server.tool(
    "configure_strategy",
    "Update the configuration for a specific service on a token. Each service has different configurable parameters.",
    {
      tokenMint: z.string().describe("Solana token mint address"),
      serviceId: z.string().describe("Service ID to configure"),
      config: z
        .record(z.unknown())
        .describe(
          "Service-specific configuration. E.g., for buyback-bot: { minAmount: 0.01, frequency: 'every-5m' }"
        ),
    },
    async ({ tokenMint, serviceId, config }) => {
      const service = state.getActiveService(tokenMint, serviceId);
      if (!service) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Service "${serviceId}" not found on token ${tokenMint}`,
            },
          ],
          isError: true,
        };
      }

      Object.assign(service.config, config);
      const token = state.getManagedToken(tokenMint)!;
      await state.updateManagedToken(token);

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `✓ Configuration updated for ${serviceId}`,
              "",
              `Current config:`,
              JSON.stringify(service.config, null, 2),
            ].join("\n"),
          },
        ],
      };
    }
  );

  server.tool(
    "set_allocation",
    "Rebalance the fee-sharing allocation across all active services on a token. Remaining BPS automatically go to the creator.",
    {
      tokenMint: z.string().describe("Solana token mint address"),
      allocations: z
        .array(
          z.object({
            serviceId: z.string(),
            bps: z.number().min(100).max(5000),
          })
        )
        .describe("New BPS allocations for each service"),
    },
    async ({ tokenMint, allocations }) => {
      try {
        const signatures = await orchestrator.rebalanceAllocations(
          tokenMint,
          allocations
        );

        const token = state.getManagedToken(tokenMint)!;
        const breakdown = token.services.map(
          (s) =>
            `  ${s.serviceId}: ${s.bps} BPS (${(s.bps / 100).toFixed(1)}%)`
        );

        return {
          content: [
            {
              type: "text" as const,
              text: [
                "✓ Allocations rebalanced",
                "",
                `Creator: ${token.creatorBps} BPS (${(token.creatorBps / 100).toFixed(1)}%)`,
                ...breakdown,
                "",
                `Transaction: ${signatures[0]}`,
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
    "claim_fees",
    "Claim accumulated fees for Tend services on a token. Claims for a specific service or all services.",
    {
      tokenMint: z.string().describe("Solana token mint address"),
      serviceId: z
        .string()
        .optional()
        .describe("Specific service to claim for, or omit for all"),
    },
    async ({ tokenMint, serviceId }) => {
      try {
        const results = await orchestrator.claimServiceFees(
          tokenMint,
          serviceId
        );

        const lines = results.map((r) => {
          if (r.signatures.length === 0) {
            return `  ${r.serviceId}: No fees to claim`;
          }
          return `  ${r.serviceId}: ${r.signatures.length} claim(s) — tx: ${r.signatures[0]}`;
        });

        return {
          content: [
            {
              type: "text" as const,
              text: [
                "✓ Fee claims processed",
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
    "emergency_stop",
    "EMERGENCY: Remove ALL Tend services from a token immediately. Returns 100% of fees to the creator. Use this if something goes wrong.",
    {
      tokenMint: z.string().describe("Solana token mint address"),
    },
    async ({ tokenMint }) => {
      try {
        const { removed, signatures } =
          await orchestrator.emergencyStop(tokenMint);

        const removedLines = removed.map(
          (s) => `  ${s.serviceId}: ${s.bps} BPS freed`
        );

        return {
          content: [
            {
              type: "text" as const,
              text: [
                "⚠ EMERGENCY STOP EXECUTED",
                "",
                `Token: ${tokenMint}`,
                `Services removed: ${removed.length}`,
                ...removedLines,
                "",
                "Creator now receives 100% of fees.",
                `Transaction: ${signatures[0]}`,
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
