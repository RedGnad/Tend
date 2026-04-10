import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { StateManager } from "../state/index.js";

export function registerIntelligenceTools(
  server: McpServer,
  state: StateManager
) {
  // ── Token Intelligence ──
  server.tool(
    "token_intelligence",
    "Show the latest AI-generated analytics report for a token: health score, trend, insights, risks, and opportunities.",
    {
      tokenMint: z.string().describe("Token mint address"),
      limit: z
        .number()
        .default(3)
        .optional()
        .describe("Number of recent reports to show (default: 3, max: 10)"),
    },
    async ({ tokenMint, limit }) => {
      const count = Math.min(limit ?? 3, 10);
      const reports = state.getReports(tokenMint, count);

      if (reports.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No analytics reports for ${tokenMint.slice(0, 12)}... yet. The Analytics Engine generates reports every 2 hours when running.`,
            },
          ],
        };
      }

      const lines = reports.map((r) => {
        const ts = new Date(r.timestamp).toISOString();
        const parts = [
          `[${ts}] Health: ${r.health_score}/10 | Trend: ${r.trend}`,
          `  Data: fees=${r.data.lifetime_fees_sol.toFixed(4)} SOL, velocity=${r.data.fee_velocity}, holders=${r.data.holders}, price=${r.data.price_sol.toFixed(9)} SOL`,
          `  Buybacks: ${r.data.buyback_count} total, ${(r.data.buyback_success_rate * 100).toFixed(0)}% success`,
          `  Insights: ${r.key_insights.join("; ")}`,
        ];
        if (r.risks.length > 0) {
          parts.push(`  Risks: ${r.risks.join("; ")}`);
        }
        if (r.opportunities.length > 0) {
          parts.push(`  Opportunities: ${r.opportunities.join("; ")}`);
        }
        return parts.join("\n");
      });

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `=== Token Intelligence for ${tokenMint.slice(0, 12)}... (${reports.length} report${reports.length > 1 ? "s" : ""}) ===`,
              "",
              ...lines,
            ].join("\n"),
          },
        ],
      };
    }
  );

  // ── Allocation Recommendations ──
  server.tool(
    "allocation_recommendations",
    "Show the latest AI-generated fee allocation recommendations for a token. Advisory-only — does not auto-execute.",
    {
      tokenMint: z.string().describe("Token mint address"),
      limit: z
        .number()
        .default(3)
        .optional()
        .describe("Number of recent recommendations to show (default: 3, max: 5)"),
    },
    async ({ tokenMint, limit }) => {
      const count = Math.min(limit ?? 3, 5);
      const allocations = state.getAllocations(tokenMint, count);

      if (allocations.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No allocation recommendations for ${tokenMint.slice(0, 12)}... yet. The Fee Allocation Advisor runs every 6 hours when the agent is active.`,
            },
          ],
        };
      }

      const lines = allocations.map((a) => {
        const ts = new Date(a.timestamp).toISOString();
        const recs = a.recommendations.map(
          (r) =>
            `    ${r.serviceId}: ${(r.currentBps / 100).toFixed(0)}% → ${(r.suggestedBps / 100).toFixed(0)}% — ${r.reasoning}`
        );
        return [
          `[${ts}]`,
          `  Assessment: ${a.overall_assessment}`,
          `  Recommendations:`,
          ...recs,
        ].join("\n");
      });

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `=== Allocation Recommendations for ${tokenMint.slice(0, 12)}... (${allocations.length} shown) ===`,
              "Advisory-only — use set_allocation to apply changes manually.",
              "",
              ...lines,
            ].join("\n"),
          },
        ],
      };
    }
  );

  // ── Approve Allocation ──
  server.tool(
    "approve_allocation",
    "View the latest allocation recommendation and get the set_allocation commands needed to apply it. Does NOT auto-execute — you must run the commands yourself.",
    {
      tokenMint: z.string().describe("Token mint address"),
    },
    async ({ tokenMint }) => {
      const allocations = state.getAllocations(tokenMint, 1);

      if (allocations.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No allocation recommendations for ${tokenMint.slice(0, 12)}... Run the agent to generate recommendations.`,
            },
          ],
        };
      }

      const latest = allocations[0];
      const ts = new Date(latest.timestamp).toISOString();

      const changes = latest.recommendations.filter(
        (r) => r.currentBps !== r.suggestedBps
      );

      if (changes.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Latest recommendation (${ts}): No changes suggested. Current allocations are optimal.\n\nAssessment: ${latest.overall_assessment}`,
            },
          ],
        };
      }

      const commands = changes.map(
        (r) =>
          `set_allocation(tokenMint="${tokenMint}", serviceId="${r.serviceId}", bps=${r.suggestedBps})`
      );

      return {
        content: [
          {
            type: "text" as const,
            text: [
              `=== Apply Allocation Recommendation (${ts}) ===`,
              `Assessment: ${latest.overall_assessment}`,
              "",
              "Suggested changes:",
              ...changes.map(
                (r) =>
                  `  ${r.serviceId}: ${(r.currentBps / 100).toFixed(0)}% → ${(r.suggestedBps / 100).toFixed(0)}% — ${r.reasoning}`
              ),
              "",
              "To apply, run these commands:",
              ...commands.map((c) => `  ${c}`),
              "",
              "⚠️ Review each change before executing. This tool does NOT auto-apply.",
            ].join("\n"),
          },
        ],
      };
    }
  );
}
