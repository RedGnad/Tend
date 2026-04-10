import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import type { AllocationRecommendation, AnalyticsReport, AgentDecision } from "@tend/shared";
import { log, logError } from "./logger.js";
import { loadState } from "./state-reader.js";
import { saveAllocation } from "./report-store.js";

const AllocationSchema = z.object({
  recommendations: z.array(z.object({
    serviceId: z.string(),
    currentBps: z.number(),
    suggestedBps: z.number(),
    reasoning: z.string(),
  })),
  overall_assessment: z.string(),
});

const SYSTEM_PROMPT = `Fee allocation advisor for Bags.fm tokens. Given current allocation and service performance, recommend optimal fee splits.
Guardrails: creator must keep >=5000 BPS (50%). No service >3000 BPS (30%). Advisory-only services (allocation-advisor) always get 0 BPS. Total must equal 10000.`;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY required");
    client = new Anthropic({ apiKey });
  }
  return client;
}

export async function runAllocationAdvisor(
  tokenMint: string
): Promise<AllocationRecommendation | null> {
  try {
    log(`[allocation] Running allocation analysis for ${tokenMint.slice(0, 8)}...`);

    const state = await loadState();
    if (!state) {
      log(`[allocation] No state found, skipping`);
      return null;
    }

    const token = state.managedTokens[tokenMint];
    if (!token) {
      log(`[allocation] Token ${tokenMint.slice(0, 8)}... not managed, skipping`);
      return null;
    }

    // Current allocation
    const currentAlloc = token.services.map((s) => ({
      serviceId: s.serviceId,
      bps: s.bps,
      status: s.status,
    }));

    // Buyback performance
    const decisions = (state.decisions ?? []).filter(
      (d: AgentDecision) => d.tokenMint === tokenMint
    );
    const executed = decisions.filter((d: AgentDecision) => d.execution.executed);

    // Latest analytics report
    const reports = (state.reports ?? []).filter(
      (r: AnalyticsReport) => r.tokenMint === tokenMint
    );
    const latestReport = reports.length > 0 ? reports[reports.length - 1] : null;

    const userMessage = `Token ${tokenMint.slice(0, 8)}: creator=${token.creatorBps} BPS, services=${JSON.stringify(currentAlloc)}, buyback_decisions=${decisions.length}, buyback_executed=${executed.length}${latestReport ? `, health=${latestReport.health_score}/10, trend=${latestReport.trend}` : ""}`;

    log(`[allocation] Requesting recommendation from Claude...`);

    const anthropic = getClient();
    const response = await anthropic.messages.parse({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
      output_config: {
        format: zodOutputFormat(AllocationSchema as any),
      },
    });

    const parsed = response.parsed_output;
    if (!parsed) throw new Error("No parsed output");

    // Enforce guardrails on recommendations
    const recs = parsed.recommendations.map((r: any) => ({
      serviceId: r.serviceId as string,
      currentBps: r.currentBps as number,
      suggestedBps: Math.min(3000, Math.max(0, r.suggestedBps as number)),
      reasoning: r.reasoning as string,
    }));

    // Hard guardrail: creator must keep >= 5000 BPS (50%)
    const totalSuggestedServiceBps = recs.reduce((sum: number, r: { suggestedBps: number }) => sum + r.suggestedBps, 0);
    if (totalSuggestedServiceBps > 5000) {
      // Scale down proportionally to fit within 5000 BPS ceiling
      const scale = 5000 / totalSuggestedServiceBps;
      for (const r of recs) {
        r.suggestedBps = Math.floor(r.suggestedBps * scale);
      }
      log(`[allocation] Guardrail: scaled service BPS from ${totalSuggestedServiceBps} to ${recs.reduce((s: number, r: { suggestedBps: number }) => s + r.suggestedBps, 0)} (creator >= 50%)`);
    }

    const recommendation: AllocationRecommendation = {
      timestamp: Date.now(),
      tokenMint,
      recommendations: recs,
      overall_assessment: parsed.overall_assessment,
    };

    await saveAllocation(recommendation);
    log(`[allocation] Recommendation saved: ${recs.length} services analyzed`);
    return recommendation;
  } catch (err) {
    logError(`[allocation] Failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}
