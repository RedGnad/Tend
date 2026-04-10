import type { AgentDecision } from "@tend/shared";
import { withStateLock } from "./state-lock.js";
import { log, logError } from "./logger.js";

const MAX_DECISIONS = 200;

export async function saveDecision(decision: AgentDecision): Promise<void> {
  try {
    await withStateLock((state) => {
      state.decisions.push(decision);
      if (state.decisions.length > MAX_DECISIONS) {
        state.decisions = state.decisions.slice(-MAX_DECISIONS);
      }
    });
    log(`[decision-store] Saved decision: ${decision.decision.action} for ${decision.tokenMint.slice(0, 8)}...`);
  } catch (err) {
    logError(`[decision-store] Failed to save decision:`, err);
  }
}
