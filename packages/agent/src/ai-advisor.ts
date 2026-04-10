import Anthropic from "@anthropic-ai/sdk";
import type { MarketSnapshot } from "@tend/shared";
import { log, logError } from "./logger.js";

export interface AdvisorDecision {
  action: "buy" | "hold" | "partial_buy";
  amount_pct: number; // 0-100
  reasoning: string;
}

const SYSTEM_PROMPT = `Buyback advisor for a Bags.fm token. Given market data, return ONLY JSON:
{"action":"buy"|"hold"|"partial_buy","amount_pct":0-100,"reasoning":"<1 sentence>"}

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
  tokenSymbol: string
): Promise<AdvisorDecision> {
  const anthropic = getClient();

  const userMessage = `${tokenSymbol}: price=${snapshot.price_sol.toFixed(9)} SOL, fees=${snapshot.lifetime_fees_sol.toFixed(4)}, claimable=${snapshot.claimable_sol.toFixed(6)}, wallet=${snapshot.wallet_balance_sol.toFixed(6)}, velocity=${snapshot.fee_velocity}, holders=${snapshot.holders}`;

  log(`[advisor] Requesting decision from Claude for ${tokenSymbol}...`);

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 100,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  log(`[advisor] Raw response: ${text}`);

  try {
    // Strip markdown code fences if present (```json ... ```)
    let jsonStr = text.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1].trim();

    const parsed = JSON.parse(jsonStr);
    const decision: AdvisorDecision = {
      action: parsed.action,
      amount_pct: parsed.amount_pct,
      reasoning: parsed.reasoning,
    };

    // Validate bounds
    if (!["buy", "hold", "partial_buy"].includes(decision.action)) {
      throw new Error(`Invalid action: ${decision.action}`);
    }
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
    logError(`[advisor] Failed to parse decision: ${text}`);
    // Fallback: hold if we can't parse
    return {
      action: "hold",
      amount_pct: 0,
      reasoning: "AI response could not be parsed — holding as safety fallback",
    };
  }
}
