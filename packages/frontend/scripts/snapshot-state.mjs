#!/usr/bin/env node
// Copy ~/.tend/state.json into frontend/public/state-snapshot.json,
// stripped of secrets, so the Vercel-deployed dashboard can serve
// the latest campaigns + payouts without live local state access.
//
// Usage: npm run snapshot:state (from packages/frontend)

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const STATE_PATH = join(homedir(), ".tend", "state.json");
const OUT_PATH = join(process.cwd(), "public", "state-snapshot.json");

if (!existsSync(STATE_PATH)) {
  console.error(`[snapshot] no state at ${STATE_PATH} — is the agent running?`);
  process.exit(1);
}

const raw = readFileSync(STATE_PATH, "utf-8");
const state = JSON.parse(raw);

// Strip anything sensitive or dev-only. The public snapshot only needs
// what the read-only frontend routes actually consume.
const sanitized = {
  campaigns: state.campaigns ?? [],
  rewardPayouts: state.rewardPayouts ?? [],
  fraudDecisions: (state.fraudDecisions ?? []).map((d) => ({
    ...d,
    // Fraud decisions are already non-sensitive but keep the shape explicit.
  })),
  swapCursors: state.swapCursors ?? {},
  holderSnapshotCursors: state.holderSnapshotCursors ?? {},
  agentHeartbeat: state.agentHeartbeat ?? null,
  snapshottedAt: Date.now(),
};

writeFileSync(OUT_PATH, JSON.stringify(sanitized, null, 2));
console.log(
  `[snapshot] wrote ${OUT_PATH} — ${sanitized.campaigns.length} campaigns, ${sanitized.rewardPayouts.length} payouts`
);
