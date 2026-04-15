#!/usr/bin/env node
/**
 * Run a single rewards-distributor tick. Reads state.json, detects swaps,
 * accrues payouts, optionally sends SOL (unless DRY_RUN_PAYOUTS=1).
 *
 * Requires a live campaign seeded in ~/.tend/state.json. Always BACKUP first.
 *
 *   DRY_RUN_PAYOUTS=1 node --env-file=.env.local packages/agent/build/test-rewards-tick.js
 */

import { BagsClient, loadKeypair } from "@tend/shared";
import { runRewardsDistributor } from "./rewards-distributor.js";
import { loadState } from "./state-reader.js";

async function main() {
  const apiKey = process.env.BAGS_API_KEY;
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const privateKey = process.env.TEND_PRIVATE_KEY;

  if (!apiKey || !rpcUrl || !privateKey) {
    console.error("Missing env: BAGS_API_KEY, SOLANA_RPC_URL, TEND_PRIVATE_KEY");
    process.exit(1);
  }

  const keypair = loadKeypair(privateKey);
  const bags = new BagsClient({ apiKey, rpcUrl, privateKey: keypair });

  console.log("\n=== rewards tick test ===");
  console.log(`admin:   ${keypair.publicKey.toBase58()}`);
  console.log(
    `dry-run: ${process.env.DRY_RUN_PAYOUTS === "1" ? "YES (no on-chain)" : "NO (will send SOL!)"}`
  );

  const stateBefore = await loadState();
  const campaignsBefore = stateBefore?.campaigns ?? [];
  const payoutsBefore = stateBefore?.rewardPayouts ?? [];
  console.log(`state:   ${campaignsBefore.length} campaign(s), ${payoutsBefore.length} existing payout(s)\n`);

  if (campaignsBefore.filter((c) => c.status === "live").length === 0) {
    console.log("⚠️  No live campaigns in state.json — nothing to do.");
    console.log("   Seed one manually. Example (append to state.campaigns):");
    console.log(JSON.stringify(
      {
        tokenMint: "6qa9oCypYpnWZyZNQ8v36eLbmWmcgHRv4MuU7BXQBAGS",
        creatorWallet: keypair.publicKey.toBase58(),
        type: "cashback",
        config: { cashbackBps: 500 },
        poolCapLamports: "10000000",
        poolSpentLamports: "0",
        status: "live",
        createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
      },
      null,
      2
    ));
    return;
  }

  const t0 = Date.now();
  const result = await runRewardsDistributor(bags);
  const elapsed = Date.now() - t0;

  console.log(`\n=== tick result (${(elapsed / 1000).toFixed(1)}s) ===`);
  console.log(`  campaignsProcessed: ${result.campaignsProcessed}`);
  console.log(`  swapsDetected:      ${result.swapsDetected}`);
  console.log(`  payoutsAccrued:     ${result.payoutsAccrued}`);
  console.log(`  payoutsPaid:        ${result.payoutsPaid}`);
  if (result.errors.length > 0) {
    console.log(`  errors:             ${result.errors.length}`);
    for (const e of result.errors) console.log(`    • ${e}`);
  }

  const stateAfter = await loadState();
  const payoutsAfter = stateAfter?.rewardPayouts ?? [];
  const newPayouts = payoutsAfter.slice(payoutsBefore.length);

  if (newPayouts.length > 0) {
    console.log(`\n=== new payouts (${newPayouts.length}) ===`);
    for (const p of newPayouts) {
      console.log(
        `  ${p.status.padEnd(8)} ${p.rewardLamports.padStart(10)} lamp → ${p.traderWallet.slice(0, 8)}  (swap ${p.swapTxSig.slice(0, 10)})`
      );
    }
  }

  console.log("");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
