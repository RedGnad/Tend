import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import type { BagsClient } from "@tend/shared";
import type { AnalyticsReport, AgentDecision } from "@tend/shared";
import { WSOL_MINT_STR, LAMPORTS_PER_SOL } from "@tend/shared";
import { log, logError } from "./logger.js";
import { loadState } from "./state-reader.js";
import { saveReport } from "./report-store.js";

const AnalyticsSchema = z.object({
  health_score: z.number().min(1).max(10),
  trend: z.enum(["growing", "stable", "declining"]),
  key_insights: z.array(z.string()).max(3),
  risks: z.array(z.string()).max(3),
  opportunities: z.array(z.string()).max(3),
});

const SYSTEM_PROMPT = `Token analytics for Bags.fm. Given token data, assess health and provide insights.
Score 1-3=poor, 4-6=moderate, 7-10=healthy. Base on fee activity, holder count, buyback effectiveness. Keep arrays to 2-3 items max, each under 15 words.`;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY required");
    client = new Anthropic({ apiKey });
  }
  return client;
}

export async function runAnalytics(
  bags: BagsClient,
  tokenMint: string
): Promise<AnalyticsReport | null> {
  try {
    log(`[analytics] Running intelligence report for ${tokenMint.slice(0, 8)}...`);

    // Collect data
    const [lifetimeFees, creators] = await Promise.all([
      bags.getTokenLifetimeFees(tokenMint).catch(() => 0),
      bags.getTokenCreators(tokenMint).catch(() => []),
    ]);

    let priceSol = 0;
    try {
      const quote = await bags.getQuote(WSOL_MINT_STR, tokenMint, LAMPORTS_PER_SOL);
      const decimals = quote.routePlan?.[0]?.outputMintDecimals ?? 9;
      const tokensPerSol = Number(quote.outAmount) / 10 ** decimals;
      if (tokensPerSol > 0) priceSol = 1 / tokensPerSol;
    } catch { /* unavailable */ }

    const lifetimeFeeSol = lifetimeFees / LAMPORTS_PER_SOL;
    let feeVelocity = "none";
    if (lifetimeFeeSol > 1) feeVelocity = "high";
    else if (lifetimeFeeSol > 0.1) feeVelocity = "medium";
    else if (lifetimeFeeSol > 0.01) feeVelocity = "low";

    // Get buyback history from state
    const state = await loadState();
    const decisions = (state?.decisions ?? []).filter(
      (d: AgentDecision) => d.tokenMint === tokenMint
    );
    const buybacks = decisions.filter((d: AgentDecision) => d.execution.executed);
    const buybackCount = buybacks.length;
    const buybackSuccessRate = decisions.length > 0
      ? buybacks.length / decisions.length
      : 0;

    const userMessage = `Token ${tokenMint.slice(0, 8)}: lifetime_fees=${lifetimeFeeSol.toFixed(4)} SOL, velocity=${feeVelocity}, holders=${creators.length}, price=${priceSol.toFixed(9)} SOL, buybacks=${buybackCount}, success_rate=${(buybackSuccessRate * 100).toFixed(0)}%`;

    log(`[analytics] Requesting analysis from Claude...`);

    const anthropic = getClient();
    const response = await anthropic.messages.parse({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      output_config: {
        format: zodOutputFormat(AnalyticsSchema as any),
      },
    });

    const parsed = response.parsed_output;
    if (!parsed) throw new Error("No parsed output");

    const report: AnalyticsReport = {
      timestamp: Date.now(),
      tokenMint,
      health_score: parsed.health_score,
      trend: parsed.trend,
      key_insights: parsed.key_insights,
      risks: parsed.risks,
      opportunities: parsed.opportunities,
      data: {
        lifetime_fees_sol: lifetimeFeeSol,
        fee_velocity: feeVelocity,
        holders: creators.length,
        price_sol: priceSol,
        buyback_count: buybackCount,
        buyback_success_rate: buybackSuccessRate,
      },
    };

    await saveReport(report);
    log(`[analytics] Report saved: score=${report.health_score}/10, trend=${report.trend}`);
    return report;
  } catch (err) {
    logError(`[analytics] Failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}
