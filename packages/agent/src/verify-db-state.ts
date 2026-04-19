#!/usr/bin/env node
/**
 * Compare ~/.tend/state.json to the Postgres backend and report diffs.
 * Read-only — never writes to either side.
 *
 * Usage:
 *   npm run build:agent
 *   node --env-file=.env.local packages/agent/build/verify-db-state.js
 *
 * Exit code: 0 if parity, 1 if any collection differs. Run this after the
 * migrate script and before flipping TEND_STATE_BACKEND=db.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { TEND_STATE_DIR, TEND_STATE_FILE } from "@tend/shared";
import type { TendState } from "@tend/shared";
import { loadStateFromDb, closeDb } from "@tend/shared/db";

const STATE_PATH = join(homedir(), TEND_STATE_DIR, TEND_STATE_FILE);

function keySet<T>(items: readonly T[] | undefined, pk: (t: T) => string): Set<string> {
  return new Set((items ?? []).map(pk));
}

function diffSet(fileSet: Set<string>, dbSet: Set<string>): {
  onlyInFile: string[];
  onlyInDb: string[];
} {
  const onlyInFile = [...fileSet].filter((k) => !dbSet.has(k));
  const onlyInDb = [...dbSet].filter((k) => !fileSet.has(k));
  return { onlyInFile, onlyInDb };
}

function report(
  label: string,
  diff: { onlyInFile: string[]; onlyInDb: string[] },
  fileCount: number,
  dbCount: number
): boolean {
  const ok = diff.onlyInFile.length === 0 && diff.onlyInDb.length === 0;
  const badge = ok ? "OK " : "DIFF";
  console.log(`[${badge}] ${label}: file=${fileCount} db=${dbCount}`);
  if (diff.onlyInFile.length) {
    console.log(`  only in file (${diff.onlyInFile.length}):`);
    for (const k of diff.onlyInFile.slice(0, 5)) console.log(`    ${k}`);
    if (diff.onlyInFile.length > 5) console.log(`    …and ${diff.onlyInFile.length - 5} more`);
  }
  if (diff.onlyInDb.length) {
    console.log(`  only in db (${diff.onlyInDb.length}):`);
    for (const k of diff.onlyInDb.slice(0, 5)) console.log(`    ${k}`);
    if (diff.onlyInDb.length > 5) console.log(`    …and ${diff.onlyInDb.length - 5} more`);
  }
  return ok;
}

async function main() {
  if (!existsSync(STATE_PATH)) {
    console.error(`No state file at ${STATE_PATH} — nothing to compare.`);
    process.exit(1);
  }

  const raw = await readFile(STATE_PATH, "utf-8");
  const file = JSON.parse(raw) as TendState;
  console.log(`File:  ${STATE_PATH}`);

  const db = await loadStateFromDb();
  console.log("DB:    Neon Postgres (via DATABASE_URL)\n");

  let allOk = true;

  // Wallet pool — compare publicKey sets
  allOk = report(
    "wallet_pool",
    diffSet(
      keySet(file.walletPool, (w) => w.publicKey),
      keySet(db.walletPool, (w) => w.publicKey)
    ),
    file.walletPool?.length ?? 0,
    db.walletPool.length
  ) && allOk;

  // Campaigns — composite PK (tokenMint, type)
  allOk = report(
    "campaigns",
    diffSet(
      keySet(file.campaigns, (c) => `${c.tokenMint}|${(c as { type?: string }).type ?? "?"}`),
      keySet(db.campaigns, (c) => `${c.tokenMint}|${c.type}`)
    ),
    file.campaigns?.length ?? 0,
    db.campaigns?.length ?? 0
  ) && allOk;

  // Reward payouts — id
  allOk = report(
    "reward_payouts",
    diffSet(
      keySet(file.rewardPayouts, (p) => p.id),
      keySet(db.rewardPayouts, (p) => p.id)
    ),
    file.rewardPayouts?.length ?? 0,
    db.rewardPayouts?.length ?? 0
  ) && allOk;

  // Fraud decisions — id
  allOk = report(
    "fraud_decisions",
    diffSet(
      keySet(file.fraudDecisions, (f) => f.id),
      keySet(db.fraudDecisions, (f) => f.id)
    ),
    file.fraudDecisions?.length ?? 0,
    db.fraudDecisions?.length ?? 0
  ) && allOk;

  // Campaign deposits — txSig
  allOk = report(
    "campaign_deposits",
    diffSet(
      keySet(file.campaignDeposits, (d) => d.txSig),
      keySet(db.campaignDeposits, (d) => d.txSig)
    ),
    file.campaignDeposits?.length ?? 0,
    db.campaignDeposits?.length ?? 0
  ) && allOk;

  // Campaign withdrawals — txSig
  allOk = report(
    "campaign_withdrawals",
    diffSet(
      keySet(file.campaignWithdrawals, (w) => w.txSig),
      keySet(db.campaignWithdrawals, (w) => w.txSig)
    ),
    file.campaignWithdrawals?.length ?? 0,
    db.campaignWithdrawals?.length ?? 0
  ) && allOk;

  // Fee claim events — natural composite (mint, createdAt, firstSig)
  const feeKey = (e: { tokenMint: string; createdAt: number; signatures: string[] }) =>
    `${e.tokenMint}|${e.createdAt}|${e.signatures[0] ?? ""}`;
  allOk = report(
    "fee_claim_events",
    diffSet(
      keySet(file.feeClaimEvents, feeKey),
      keySet(db.feeClaimEvents, feeKey)
    ),
    file.feeClaimEvents?.length ?? 0,
    db.feeClaimEvents?.length ?? 0
  ) && allOk;

  // Cursors — Record<mint, number>; diff both keys and values
  const fileSwap = file.swapCursors ?? {};
  const dbSwap = db.swapCursors ?? {};
  const swapKeyDiff = diffSet(new Set(Object.keys(fileSwap)), new Set(Object.keys(dbSwap)));
  const swapValueMismatches = Object.keys(fileSwap).filter(
    (k) => k in dbSwap && fileSwap[k] !== dbSwap[k]
  );
  const swapOk =
    swapKeyDiff.onlyInFile.length === 0 &&
    swapKeyDiff.onlyInDb.length === 0 &&
    swapValueMismatches.length === 0;
  console.log(
    `[${swapOk ? "OK " : "DIFF"}] swap_cursors: file=${Object.keys(fileSwap).length} db=${Object.keys(dbSwap).length}${swapValueMismatches.length ? ` valueMismatches=${swapValueMismatches.length}` : ""}`
  );
  allOk = swapOk && allOk;

  const fileHolder = file.holderSnapshotCursors ?? {};
  const dbHolder = db.holderSnapshotCursors ?? {};
  const holderKeyDiff = diffSet(
    new Set(Object.keys(fileHolder)),
    new Set(Object.keys(dbHolder))
  );
  const holderValueMismatches = Object.keys(fileHolder).filter(
    (k) => k in dbHolder && fileHolder[k] !== dbHolder[k]
  );
  const holderOk =
    holderKeyDiff.onlyInFile.length === 0 &&
    holderKeyDiff.onlyInDb.length === 0 &&
    holderValueMismatches.length === 0;
  console.log(
    `[${holderOk ? "OK " : "DIFF"}] holder_snapshot_cursors: file=${Object.keys(fileHolder).length} db=${Object.keys(dbHolder).length}${holderValueMismatches.length ? ` valueMismatches=${holderValueMismatches.length}` : ""}`
  );
  allOk = holderOk && allOk;

  // Heartbeat — single scalar
  const heartOk = (file.agentHeartbeat ?? null) === (db.agentHeartbeat ?? null);
  console.log(
    `[${heartOk ? "OK " : "DIFF"}] agent_heartbeat: file=${file.agentHeartbeat ?? "—"} db=${db.agentHeartbeat ?? "—"}`
  );
  allOk = heartOk && allOk;

  console.log(allOk ? "\nParity OK — safe to flip TEND_STATE_BACKEND=db." : "\nDiff detected — do NOT flip the flag until you reconcile.");

  await closeDb();
  process.exit(allOk ? 0 : 1);
}

main().catch(async (err) => {
  console.error("Verify failed:", err);
  await closeDb().catch(() => {});
  process.exit(2);
});
