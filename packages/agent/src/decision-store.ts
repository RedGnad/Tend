import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { AgentDecision, TendState } from "@tend/shared";
import { TEND_STATE_DIR, TEND_STATE_FILE } from "@tend/shared";
import { log, logError } from "./logger.js";

const TEND_DIR = join(homedir(), TEND_STATE_DIR);
const STATE_PATH = join(TEND_DIR, TEND_STATE_FILE);
const MAX_DECISIONS = 200;

export async function saveDecision(decision: AgentDecision): Promise<void> {
  try {
    if (!existsSync(TEND_DIR)) {
      await mkdir(TEND_DIR, { recursive: true });
    }

    let state: TendState = {
      managedTokens: {},
      walletPool: [],
      snapshots: [],
      decisions: [],
      reports: [],
      allocations: [],
    };

    if (existsSync(STATE_PATH)) {
      const raw = await readFile(STATE_PATH, "utf-8");
      state = JSON.parse(raw);
    }

    if (!state.decisions) state.decisions = [];
    state.decisions.push(decision);

    // Keep last N decisions
    if (state.decisions.length > MAX_DECISIONS) {
      state.decisions = state.decisions.slice(-MAX_DECISIONS);
    }

    await writeFile(STATE_PATH, JSON.stringify(state, null, 2));
    log(`[decision-store] Saved decision: ${decision.decision.action} for ${decision.tokenMint.slice(0, 8)}...`);
  } catch (err) {
    logError(`[decision-store] Failed to save decision:`, err);
  }
}
