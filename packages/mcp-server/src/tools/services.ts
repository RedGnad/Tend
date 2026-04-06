import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SERVICE_REGISTRY, getService } from "../state/service-registry.js";
import type { FeeShareOrchestrator } from "../services/orchestrator.js";
import type { StateManager } from "../state/index.js";
import { formatSol } from "@tend/shared";

export function registerServiceTools(
  server: McpServer,
  orchestrator: FeeShareOrchestrator,
  state: StateManager
) {
  server.tool(
    "list_available_services",
    "List all available Tend AI services that can be attached to a token's fee-sharing. Shows service name, description, cost in basis points, and category.",
    {},
    async () => {
      const lines = SERVICE_REGISTRY.map((s) => {
        const statusIcon = s.status === "available" ? "[AVAILABLE]" : "[COMING SOON]";
        return [
          `${statusIcon} ${s.name} (${s.id})`,
          `  Category: ${s.category}`,
          `  Cost: ${s.defaultBps} BPS (${(s.defaultBps / 100).toFixed(1)}%) | Range: ${s.minBps}-${s.maxBps} BPS`,
          `  ${s.description}`,
        ].join("\n");
      });

      return {
        content: [
          {
            type: "text" as const,
            text: [
              "=== Tend Service Marketplace ===",
              `${SERVICE_REGISTRY.filter((s) => s.status === "available").length} available, ${SERVICE_REGISTRY.filter((s) => s.status === "coming-soon").length} coming soon`,
              "",
              "BPS = Basis Points (100 BPS = 1% of fee revenue)",
              "",
              ...lines,
            ].join("\n"),
          },
        ],
      };
    }
  );

  server.tool(
    "add_service_to_token",
    "Add an AI service to a token's fee-sharing configuration. The service receives a share of trading fees in exchange for providing autonomous value (buybacks, analytics, etc).",
    {
      tokenMint: z.string().describe("Solana token mint address"),
      serviceId: z
        .string()
        .describe(
          "Service ID from list_available_services (e.g., 'buyback-bot')"
        ),
      bps: z
        .number()
        .min(100)
        .max(5000)
        .optional()
        .describe(
          "Basis points to allocate (default: service default). 100 BPS = 1%"
        ),
    },
    async ({ tokenMint, serviceId, bps }) => {
      try {
        const { service, signatures } = await orchestrator.addServiceToToken(
          tokenMint,
          serviceId,
          bps
        );
        const serviceDef = getService(serviceId)!;
        return {
          content: [
            {
              type: "text" as const,
              text: [
                `✓ ${serviceDef.name} added to token`,
                "",
                `Token: ${tokenMint}`,
                `Service: ${serviceDef.name} (${serviceId})`,
                `Allocation: ${service.bps} BPS (${(service.bps / 100).toFixed(1)}%)`,
                `Service Wallet: ${service.claimerWallet}`,
                `Transaction: ${signatures[0]}`,
                "",
                "The service will begin operating automatically.",
                "Use 'service_status' to monitor its activity.",
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
    "remove_service_from_token",
    "Remove an AI service from a token's fee-sharing. The service's allocation is returned to the creator.",
    {
      tokenMint: z.string().describe("Solana token mint address"),
      serviceId: z.string().describe("Service ID to remove"),
    },
    async ({ tokenMint, serviceId }) => {
      try {
        const { removed, signatures } =
          await orchestrator.removeServiceFromToken(tokenMint, serviceId);
        return {
          content: [
            {
              type: "text" as const,
              text: [
                `✓ Service removed`,
                "",
                `Removed: ${removed.serviceId}`,
                `Freed: ${removed.bps} BPS (${(removed.bps / 100).toFixed(1)}%) returned to creator`,
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
    "service_status",
    "Check the status and stats of active services on a token. Shows fees earned, claims, and service activity.",
    {
      tokenMint: z.string().describe("Solana token mint address"),
      serviceId: z
        .string()
        .optional()
        .describe("Specific service ID, or omit for all services"),
    },
    async ({ tokenMint, serviceId }) => {
      const token = state.getManagedToken(tokenMint);
      if (!token) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Token ${tokenMint} is not managed by Tend.`,
            },
          ],
        };
      }

      const services = serviceId
        ? token.services.filter((s) => s.serviceId === serviceId)
        : token.services;

      if (services.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: serviceId
                ? `Service "${serviceId}" not found on this token.`
                : "No services active on this token.",
            },
          ],
        };
      }

      const lines = services.map((s) => {
        const def = getService(s.serviceId);
        const lastClaim = s.stats.lastClaimAt
          ? new Date(s.stats.lastClaimAt).toISOString()
          : "Never";
        return [
          `[${s.status.toUpperCase()}] ${def?.name ?? s.serviceId}`,
          `  Allocation: ${s.bps} BPS (${(s.bps / 100).toFixed(1)}%)`,
          `  Wallet: ${s.claimerWallet}`,
          `  Fees Earned: ${formatSol(s.stats.totalFeesEarned)}`,
          `  Fees Claimed: ${formatSol(s.stats.totalFeesClaimed)}`,
          `  Last Claim: ${lastClaim}`,
          `  Actions: ${s.stats.actionsPerformed}`,
          `  Active Since: ${new Date(s.activatedAt).toISOString()}`,
        ].join("\n");
      });

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `=== Services on ${tokenMint.slice(0, 8)}... ===`,
              `Creator: ${token.creatorBps} BPS (${(token.creatorBps / 100).toFixed(1)}%)`,
              `Services: ${token.totalServiceBps} BPS (${(token.totalServiceBps / 100).toFixed(1)}%)`,
              "",
              ...lines,
            ].join("\n"),
          },
        ],
      };
    }
  );
}
