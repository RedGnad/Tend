import {
  SystemProgram,
  Transaction,
  PublicKey,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import type { BagsClient } from "@tend/shared";
import { withStateLock } from "./state-lock.js";
import { loadState } from "./state-reader.js";
import { log, logError } from "./logger.js";

/**
 * Shared payout executor — type-agnostic.
 *
 * Each campaign trigger (cashback, holder, sprint) accrues RewardPayout rows
 * into state.rewardPayouts. This module owns the on-chain leg: for every row
 * in "accrued" status, send SOL from the admin wallet and flip to "paid".
 *
 * Bounded by MAX_PAYOUTS_PER_TICK and ADMIN_MIN_RESERVE_LAMPORTS so a surge
 * can't drain the creator wallet in a single tick.
 */

export const MAX_PAYOUTS_PER_TICK = 10;
export const ADMIN_MIN_RESERVE_LAMPORTS = 5_000_000n; // keep 0.005 SOL for fees
const MAX_PAYOUT_ATTEMPTS = 3;

const DRY_RUN_PAYOUTS = process.env.DRY_RUN_PAYOUTS === "1";

export async function payoutAccrued(bags: BagsClient): Promise<number> {
  const state = await loadState();
  if (!state) return 0;

  const accrued = (state.rewardPayouts ?? [])
    .filter(
      (p) =>
        p.status === "accrued" &&
        (p.failedAttempts ?? 0) < MAX_PAYOUT_ATTEMPTS
    )
    .slice(0, MAX_PAYOUTS_PER_TICK);
  if (accrued.length === 0) return 0;

  let paidCount = 0;
  const admin = bags.keypair;

  for (const payout of accrued) {
    try {
      const amount = BigInt(payout.rewardLamports);

      if (DRY_RUN_PAYOUTS) {
        log(
          `[payout][dry-run] would pay ${payout.rewardLamports} → ${payout.traderWallet.slice(0, 8)} (swap ${payout.swapTxSig.slice(0, 10)})`
        );
        await withStateLock(async (s) => {
          const p = (s.rewardPayouts ?? []).find((x) => x.id === payout.id);
          if (p) {
            p.status = "paid";
            p.payoutTxSig = "DRY_RUN";
            p.paidAt = Date.now();
          }
        });
        paidCount += 1;
        continue;
      }

      const balance = BigInt(
        await bags.connection.getBalance(admin.publicKey)
      );

      if (balance < amount + ADMIN_MIN_RESERVE_LAMPORTS) {
        log(
          `[payout] Admin balance ${balance} below reserve — stopping payouts`
        );
        break;
      }

      const tx = new Transaction();
      tx.add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 20_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
        SystemProgram.transfer({
          fromPubkey: admin.publicKey,
          toPubkey: new PublicKey(payout.traderWallet),
          lamports: Number(amount),
        })
      );

      const { blockhash, lastValidBlockHeight } =
        await bags.connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.feePayer = admin.publicKey;
      tx.sign(admin);

      const sig = await bags.connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });
      await bags.connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed"
      );

      await withStateLock(async (s) => {
        const p = (s.rewardPayouts ?? []).find((x) => x.id === payout.id);
        if (p) {
          p.status = "paid";
          p.payoutTxSig = sig;
          p.paidAt = Date.now();
        }
      });

      log(
        `[payout] Paid ${payout.rewardLamports} lamports → ${payout.traderWallet.slice(0, 8)} (${sig.slice(0, 10)})`
      );
      paidCount += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(`[payout] ${payout.id} failed:`, err);
      await withStateLock(async (s) => {
        const p = (s.rewardPayouts ?? []).find((x) => x.id === payout.id);
        if (!p) return;
        p.failedAttempts = (p.failedAttempts ?? 0) + 1;
        p.lastError = msg.slice(0, 240);
        if (p.failedAttempts >= MAX_PAYOUT_ATTEMPTS) {
          p.status = "failed";
          log(
            `[payout] ${payout.id} marked failed after ${p.failedAttempts} attempt(s)`
          );
        }
      });
    }
  }

  return paidCount;
}
