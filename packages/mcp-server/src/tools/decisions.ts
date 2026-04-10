import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { formatSol } from "@tend/shared";
import type { StateManager } from "../state/index.js";

export function registerDecisionTools(
  server: McpServer,
  state: StateManager
) {
  server.tool(
    "agent_decision_log",
    "Show the AI buyback agent's recent decisions with inputs, reasoning, actions taken, and outcomes.",
    {
      tokenMint: z
        .string()
        .optional()
        .describe("Filter decisions for a specific token mint (optional)"),
      limit: z
        .number()
        .default(10)
        .optional()
        .describe("Number of recent decisions to show (default: 10, max: 50)"),
    },
    async ({ tokenMint, limit }) => {
      const count = Math.min(limit ?? 10, 50);
      const decisions = state.getDecisions(tokenMint, count);

      if (decisions.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: tokenMint
                ? `No agent decisions recorded for ${tokenMint.slice(0, 12)}...`
                : "No agent decisions recorded yet. The buyback agent logs decisions here when it runs.",
            },
          ],
        };
      }

      const lines = decisions.map((d) => {
        const ts = new Date(d.timestamp).toISOString();
        const action = d.decision.action.toUpperCase();
        const pct = d.decision.amount_pct;

        const parts = [
          `[${ts}] ${action}${pct > 0 ? ` ${pct}%` : ""} — ${d.tokenMint.slice(0, 12)}...`,
          `  Reasoning: ${d.decision.reasoning}`,
          `  Inputs: price=${d.inputs.price_sol.toFixed(9)} SOL, claimable=${d.inputs.claimable_sol.toFixed(6)} SOL, velocity=${d.inputs.fee_velocity}, wallet=${d.inputs.wallet_balance_sol.toFixed(6)} SOL`,
        ];

        if (d.execution.executed) {
          parts.push(
            `  Result: Swapped ${formatSol(d.execution.amount_lamports ?? 0)}` +
              (d.execution.tokens_bought
                ? `, got ${d.execution.tokens_bought.toFixed(2)} tokens`
                : "") +
              (d.execution.tx_signature
                ? `, tx=${d.execution.tx_signature.slice(0, 16)}...`
                : "")
          );
        } else if (d.execution.error) {
          parts.push(`  Result: Not executed — ${d.execution.error}`);
        } else {
          parts.push(`  Result: Held (no action taken)`);
        }

        return parts.join("\n");
      });

      const header = tokenMint
        ? `=== Agent Decisions for ${tokenMint.slice(0, 12)}... (${decisions.length} shown) ===`
        : `=== Agent Decision Log (${decisions.length} shown) ===`;

      return {
        content: [
          {
            type: "text" as const,
            text: [header, "", ...lines].join("\n"),
          },
        ],
      };
    }
  );
}
