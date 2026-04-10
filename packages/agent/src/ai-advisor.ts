import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { MarketSnapshot, AnalyticsReport } from "@tend/shared";
import { loadState } from "./state-reader.js";
import { log, logError } from "./logger.js";

export interface AdvisorDecision {
  action: "buy" | "hold" | "partial_buy";
  amount_pct: number; // 0-100
  reasoning: string;
}

const AdvisorSchema = z.object({
  action: z.enum(["buy", "hold", "partial_buy"]),
  amount_pct: z.number().min(0).max(100),
  reasoning: z.string(),
});

const SYSTEM_PROMPT = `Buyback advisor for a Bags.fm token. Given market data, decide whether to buy, hold, or partial_buy.
Rules: buy=100%, hold=0%, partial_buy=10-90%. Buy when fee velocity is high and claimable amount justifies tx fees. Hold if wallet<0.001 SOL or claimable is tiny. Guardrails (max buy, cooldown, min threshold) are enforced externally.`;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY env var is required for AI advisor");
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

export async function getAdvisorDecision(
  snapshot: MarketSnapshot,
  tokenSymbol: string,
  tokenMint?: string
): Promise<AdvisorDecision> {
  const anthropic = getClient();

  let analyticsCtx = "";
  if (tokenMint) {
    try {
      const state = await loadState();
      const reports = (state?.reports ?? []).filter(
        (r: AnalyticsReport) => r.tokenMint === tokenMint
      );
      if (reports.length > 0) {
        const latest = reports[reports.length - 1];
        analyticsCtx = `, health=${latest.health_score}/10, trend=${latest.trend}`;
      }
    } catch { /* no report available */ }
  }

  const userMessage = `${tokenSymbol}: price=${snapshot.price_sol.toFixed(9)} SOL, fees=${snapshot.lifetime_fees_sol.toFixed(4)}, claimable=${snapshot.claimable_sol.toFixed(6)}, wallet=${snapshot.wallet_balance_sol.toFixed(6)}, velocity=${snapshot.fee_velocity}, holders=${snapshot.holders}${analyticsCtx}`;

  log(`[advisor] Requesting decision from Claude for ${tokenSymbol}...`);

  try {
    const response = await anthropic.messages.parse({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 100,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      output_config: {
        format: zodOutputFormat(AdvisorSchema),
      },
    });

    const parsed = response.parsed_output;
    if (!parsed) throw new Error("No parsed output");

    const decision: AdvisorDecision = {
      action: parsed.action,
      amount_pct: parsed.amount_pct,
      reasoning: parsed.reasoning,
    };

    // Enforce bounds
    if (decision.action === "buy") decision.amount_pct = 100;
    if (decision.action === "hold") decision.amount_pct = 0;
    if (decision.action === "partial_buy") {
      decision.amount_pct = Math.max(10, Math.min(90, decision.amount_pct));
    }

    log(
      `[advisor] Decision: ${decision.action} (${decision.amount_pct}%) — ${decision.reasoning}`
    );
    return decision;
  } catch (err) {
    logError(`[advisor] Failed to get decision: ${err instanceof Error ? err.message : err}`);
    return {
      action: "hold",
      amount_pct: 0,
      reasoning: "AI response could not be parsed — holding as safety fallback",
    };
  }
}
