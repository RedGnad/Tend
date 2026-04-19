#!/usr/bin/env node
/**
 * One-shot migration: ~/.tend/state.json → Postgres (Neon).
 *
 * Usage:
 *   node --env-file=.env.local packages/agent/build/migrate-state-to-db.js           # safe mode
 *   node --env-file=.env.local packages/agent/build/migrate-state-to-db.js --force   # truncate + reload
 *
 * Safe mode: aborts if any target table has rows. --force truncates first so reruns
 * always converge DB to the current state.json snapshot.
 *
 * Wallet secrets are copied ciphertext-in → ciphertext-out: we never decrypt here.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { sql } from "drizzle-orm";
import { TEND_STATE_DIR, TEND_STATE_FILE, migrateCampaign } from "@tend/shared";
import type { TendState } from "@tend/shared";
import {
  getDb,
  closeDb,
  walletPool,
  campaigns,
  rewardPayouts,
  fraudDecisions,
  campaignDeposits,
  campaignWithdrawals,
  feeClaimEvents,
  swapCursors,
  holderSnapshotCursors,
  agentMeta,
} from "@tend/shared/db";

const STATE_PATH = join(homedir(), TEND_STATE_DIR, TEND_STATE_FILE);

const TABLES = [
  ["wallet_pool", walletPool],
  ["campaigns", campaigns],
  ["reward_payouts", rewardPayouts],
  ["fraud_decisions", fraudDecisions],
  ["campaign_deposits", campaignDeposits],
  ["campaign_withdrawals", campaignWithdrawals],
  ["fee_claim_events", feeClaimEvents],
  ["swap_cursors", swapCursors],
  ["holder_snapshot_cursors", holderSnapshotCursors],
  ["agent_meta", agentMeta],
] as const;

async function main() {
  const force = process.argv.includes("--force");

  if (!existsSync(STATE_PATH)) {
    console.error(`No state file at ${STATE_PATH} — nothing to migrate.`);
    process.exit(1);
  }

  const raw = await readFile(STATE_PATH, "utf-8");
  const state = JSON.parse(raw) as TendState;
  console.log(`Loaded state from ${STATE_PATH}`);

  const db = getDb();

  // ── Pre-flight: count existing rows. In safe mode, any row aborts. ────────
  const counts: Record<string, number> = {};
  for (const [name, t] of TABLES) {
    const res = await db.execute(sql`select count(*)::int as c from ${t}`);
    const row = (res.rows?.[0] as { c: number | string } | undefined) ?? { c: 0 };
    counts[name] = Number(row.c ?? 0);
  }
  const populated = Object.entries(counts).filter(([, n]) => n > 0);
  if (populated.length && !force) {
    console.error("Target tables already contain rows:");
    for (const [name, n] of populated) console.error(`  ${name}: ${n}`);
    console.error("Rerun with --force to truncate and reload.");
    await closeDb();
    process.exit(1);
  }

  if (force && populated.length) {
    console.log("--force: truncating all tables");
    // RESTART IDENTITY so fee_claim_events.id restarts from 1.
    await db.execute(sql`
      truncate table
        ${walletPool},
        ${campaigns},
        ${rewardPayouts},
        ${fraudDecisions},
        ${campaignDeposits},
        ${campaignWithdrawals},
        ${feeClaimEvents},
        ${swapCursors},
        ${holderSnapshotCursors},
        ${agentMeta}
      restart identity cascade
    `);
  }

  // ── Insert, slice by slice ────────────────────────────────────────────────
  const inserted: Record<string, number> = {};

  if (state.walletPool?.length) {
    await db.insert(walletPool).values(
      state.walletPool.map((w) => ({
        publicKey: w.publicKey,
        secretKey: w.secretKey, // ciphertext — preserved as-is
        assignedTo: w.assignedTo ?? null,
      }))
    );
    inserted.wallet_pool = state.walletPool.length;
  }

  if (state.campaigns?.length) {
    const migrated = state.campaigns.map(migrateCampaign);
    await db.insert(campaigns).values(
      migrated.map((c) => ({
        tokenMint: c.tokenMint,
        type: c.type,
        creatorWallet: c.creatorWallet,
        poolCapLamports: c.poolCapLamports,
        poolSpentLamports: c.poolSpentLamports,
        feesClaimedLamports: c.feesClaimedLamports ?? null,
        feeClaimCount: c.feeClaimCount ?? null,
        lastFeeClaimAt: c.lastFeeClaimAt ?? null,
        status: c.status,
        createdAt: c.createdAt,
        tokenInfo: c.tokenInfo ?? null,
        config: c.config,
      }))
    );
    inserted.campaigns = migrated.length;
  }

  if (state.rewardPayouts?.length) {
    await db.insert(rewardPayouts).values(
      state.rewardPayouts.map((p) => ({
        id: p.id,
        tokenMint: p.tokenMint,
        traderWallet: p.traderWallet,
        swapTxSig: p.swapTxSig,
        swapVolumeLamports: p.swapVolumeLamports,
        rewardLamports: p.rewardLamports,
        payoutTxSig: p.payoutTxSig,
        status: p.status,
        submittedAt: p.submittedAt ?? null,
        createdAt: p.createdAt,
        paidAt: p.paidAt ?? null,
        failedAttempts: p.failedAttempts ?? null,
        lastError: p.lastError ?? null,
        campaignType: p.campaignType ?? null,
      }))
    );
    inserted.reward_payouts = state.rewardPayouts.length;
  }

  if (state.fraudDecisions?.length) {
    await db.insert(fraudDecisions).values(
      state.fraudDecisions.map((f) => ({
        id: f.id,
        tokenMint: f.tokenMint,
        traderWallet: f.traderWallet,
        swapTxSig: f.swapTxSig,
        swapVolumeLamports: f.swapVolumeLamports,
        decision: f.decision,
        reasoning: f.reasoning,
        flags: f.flags,
        model: f.model,
        checkedAt: f.checkedAt,
        walletContext: f.walletContext,
      }))
    );
    inserted.fraud_decisions = state.fraudDecisions.length;
  }

  if (state.campaignDeposits?.length) {
    await db.insert(campaignDeposits).values(
      state.campaignDeposits.map((d) => ({
        txSig: d.txSig,
        tokenMint: d.tokenMint,
        campaignType: d.campaignType,
        fromWallet: d.fromWallet,
        amountLamports: d.amountLamports,
        kind: d.kind,
        createdAt: d.createdAt,
      }))
    );
    inserted.campaign_deposits = state.campaignDeposits.length;
  }

  if (state.campaignWithdrawals?.length) {
    await db.insert(campaignWithdrawals).values(
      state.campaignWithdrawals.map((w) => ({
        txSig: w.txSig,
        tokenMint: w.tokenMint,
        campaignType: w.campaignType,
        toWallet: w.toWallet,
        amountLamports: w.amountLamports,
        createdAt: w.createdAt,
      }))
    );
    inserted.campaign_withdrawals = state.campaignWithdrawals.length;
  }

  if (state.feeClaimEvents?.length) {
    await db.insert(feeClaimEvents).values(
      state.feeClaimEvents.map((e) => ({
        tokenMint: e.tokenMint,
        claimedLamports: e.claimedLamports,
        signatures: e.signatures,
        source: e.source,
        createdAt: e.createdAt,
      }))
    );
    inserted.fee_claim_events = state.feeClaimEvents.length;
  }

  const swapEntries = Object.entries(state.swapCursors ?? {});
  if (swapEntries.length) {
    await db.insert(swapCursors).values(
      swapEntries.map(([tokenMint, value]) => ({ tokenMint, value }))
    );
    inserted.swap_cursors = swapEntries.length;
  }

  const holderEntries = Object.entries(state.holderSnapshotCursors ?? {});
  if (holderEntries.length) {
    await db.insert(holderSnapshotCursors).values(
      holderEntries.map(([tokenMint, value]) => ({ tokenMint, value }))
    );
    inserted.holder_snapshot_cursors = holderEntries.length;
  }

  if (state.agentHeartbeat) {
    await db.insert(agentMeta).values({
      key: "heartbeat",
      valueNumber: state.agentHeartbeat,
      valueText: null,
      updatedAt: Date.now(),
    });
    inserted.agent_meta = 1;
  }

  console.log("Migration complete. Rows inserted:");
  for (const [name, n] of Object.entries(inserted)) {
    console.log(`  ${name}: ${n}`);
  }
  if (Object.keys(inserted).length === 0) {
    console.log("  (state.json was empty — nothing to insert)");
  }

  await closeDb();
}

main().catch(async (err) => {
  console.error("Migration failed:", err);
  await closeDb().catch(() => {});
  process.exit(1);
});
