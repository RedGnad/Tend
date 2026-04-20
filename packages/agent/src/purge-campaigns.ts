#!/usr/bin/env node
/**
 * Purge one or more campaigns (plus their related deposits / withdrawals /
 * payouts) from state. Useful to clean out pre-Squads test campaigns before
 * enforcing Squads-mandatory payouts.
 *
 * Usage:
 *   node packages/agent/build/purge-campaigns.js <mint1> [<mint2> …] [--force]
 *
 * Without `--force` the script prints what it would remove and exits with
 * code 2 (dry-run). Add `--force` to actually persist the removal.
 *
 * Honors `TEND_STATE_BACKEND=db` the same way the agent does; defaults to
 * the local `~/.tend/state.json` file backend otherwise.
 */

import { withStateLock } from "./state-lock.js";

const args = process.argv.slice(2);
const force = args.includes("--force");
const mints = args.filter((a) => !a.startsWith("--"));

if (mints.length === 0) {
  console.error(
    "Usage: purge-campaigns <mint1> [<mint2> …] [--force]\n\n" +
      "  Without --force the script prints what it would remove (dry-run)."
  );
  process.exit(1);
}

async function main() {
  const summary: Record<
    string,
    {
      campaigns: number;
      deposits: number;
      withdrawals: number;
      rewardPayouts: number;
    }
  > = {};
  for (const m of mints) {
    summary[m] = {
      campaigns: 0,
      deposits: 0,
      withdrawals: 0,
      rewardPayouts: 0,
    };
  }

  await withStateLock((s) => {
    const keep = new Set(mints);
    const matches = (x: { tokenMint: string }) => keep.has(x.tokenMint);

    if (Array.isArray(s.campaigns)) {
      for (const c of s.campaigns) {
        if (matches(c)) summary[c.tokenMint].campaigns += 1;
      }
    }
    if (Array.isArray(s.campaignDeposits)) {
      for (const d of s.campaignDeposits) {
        if (matches(d)) summary[d.tokenMint].deposits += 1;
      }
    }
    if (Array.isArray(s.campaignWithdrawals)) {
      for (const w of s.campaignWithdrawals) {
        if (matches(w)) summary[w.tokenMint].withdrawals += 1;
      }
    }
    if (Array.isArray(s.rewardPayouts)) {
      for (const p of s.rewardPayouts) {
        if (matches(p)) summary[p.tokenMint].rewardPayouts += 1;
      }
    }

    if (!force) return;

    if (Array.isArray(s.campaigns)) {
      s.campaigns = s.campaigns.filter((c) => !keep.has(c.tokenMint));
    }
    if (Array.isArray(s.campaignDeposits)) {
      s.campaignDeposits = s.campaignDeposits.filter(
        (d) => !keep.has(d.tokenMint)
      );
    }
    if (Array.isArray(s.campaignWithdrawals)) {
      s.campaignWithdrawals = s.campaignWithdrawals.filter(
        (w) => !keep.has(w.tokenMint)
      );
    }
    if (Array.isArray(s.rewardPayouts)) {
      s.rewardPayouts = s.rewardPayouts.filter((p) => !keep.has(p.tokenMint));
    }
  });

  const backend =
    process.env.TEND_STATE_BACKEND === "db" ? "postgres" : "file";
  console.log(`backend: ${backend}`);
  console.log(`mode: ${force ? "APPLIED" : "DRY-RUN"}\n`);
  for (const m of mints) {
    const s = summary[m];
    console.log(
      `${m}  campaigns=${s.campaigns} deposits=${s.deposits} withdrawals=${s.withdrawals} rewardPayouts=${s.rewardPayouts}`
    );
  }
  if (!force) {
    console.log(
      "\nDry-run only — re-run with --force to persist the removal."
    );
    process.exit(2);
  }
  console.log("\nPurge applied.");
}

main().catch((err) => {
  console.error("[purge] failed:", err);
  process.exit(1);
});
