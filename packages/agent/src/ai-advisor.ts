import Anthropic from "@anthropic-ai/sdk";
import type { MarketSnapshot } from "@tend/shared";
import { log, logError } from "./logger.js";

export interface AdvisorDecision {
  action: "buy" | "hold" | "partial_buy";
  amount_pct: number; // 0-100
  reasoning: string;
}

const SYSTEM_PROMPT = `You are the Tend Buyback Advisor — an autonomous agent managing buyback operations for a Bags.fm creator token.

Your job: Given a market snapshot, decide whether to execute a buyback (swap SOL for the token).

## Decision Space (STRICT — only these 3 actions)
- "buy": Swap 100% of claimable SOL for the token. Use when conditions strongly favor buying.
- "partial_buy": Swap a percentage (amount_pct: 10-90) of claimable SOL. Use for moderate conviction.
- "hold": Do nothing, wait for better conditions. Use when buying now would be suboptimal.

## Decision Factors
- **Fee velocity**: High velocity = token is actively traded = good time to buy (the buyback creates visible buy pressure).
- **Wallet balance**: If very low (<0.001 SOL), hold to avoid failed transactions from insufficient fees.
- **Claimable amount**: Larger amounts justify buying; tiny amounts may not be worth the tx fees.
- **Volume context**: Higher 24h volume means the buyback will have less relative price impact (good).

## Guardrails (enforced by the system, not you)
- Max buy = wallet balance (no borrowing)
- Min claim threshold is checked before you're called
- Cooldown between buys is enforced externally

## Response Format
Reply with ONLY valid JSON, no markdown, no explanation outside the JSON:
{"action": "buy" | "hold" | "partial_buy", "amount_pct": 0-100, "reasoning": "1-2 sentence explanation"}

For "buy", set amount_pct to 100.
For "hold", set amount_pct to 0.
For "partial_buy", set amount_pct between 10 and 90.`;

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

  const userMessage = `Market snapshot for ${tokenSymbol}:
- Token price: ${snapshot.price_sol.toFixed(9)} SOL
- 24h volume: ${snapshot.volume_24h_sol.toFixed(4)} SOL
- Lifetime fees: ${snapshot.lifetime_fees_sol.toFixed(4)} SOL
- Claimable now: ${snapshot.claimable_sol.toFixed(6)} SOL
- Agent wallet balance: ${snapshot.wallet_balance_sol.toFixed(6)} SOL
- Holders: ${snapshot.holders}
- Fee velocity: ${snapshot.fee_velocity}

Should I execute a buyback now?`;

  log(`[advisor] Requesting decision from Claude for ${tokenSymbol}...`);

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  log(`[advisor] Raw response: ${text}`);

  try {
    const parsed = JSON.parse(text.trim());
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
