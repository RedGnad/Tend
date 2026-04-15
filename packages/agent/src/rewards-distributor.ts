import type { BagsClient, Campaign } from "@tend/shared";
import { migrateCampaign } from "@tend/shared";
import { withStateLock } from "./state-lock.js";
import { loadState } from "./state-reader.js";
import { runCashbackTrigger } from "./triggers/cashback.js";
import { runHolderTrigger } from "./triggers/holder.js";
import { runSprintTrigger } from "./triggers/sprint.js";
import type { TriggerResult } from "./triggers/types.js";
import { payoutAccrued } from "./payout-executor.js";
import { log, logError } from "./logger.js";

/**
 * Rewards dispatcher — Plan E architecture.
 *
 * Each tick:
 *   1. Load live campaigns from state (migrated on read)
 *   2. Dispatch each to its type-specific trigger:
 *        cashback → runCashbackTrigger  (real, S1)
 *        holder   → runHolderTrigger    (real, S2)
 *        sprint   → runSprintTrigger    (stub, S4)
 *        referral → no-op               (Q3)
 *   3. Triggers accrue RewardPayout rows into state
 *   4. Shared payout-executor owns the on-chain SOL leg for all types
 */

export interface RewardsTickResult {
  campaignsProcessed: number;
  swapsDetected: number;
  fraudAllowed: number;
  fraudRejected: number;
  fraudHeld: number;
  payoutsAccrued: number;
  payoutsPaid: number;
  errors: string[];
}

function mergeTriggerResult(
  tick: RewardsTickResult,
  trigger: TriggerResult
): void {
  tick.swapsDetected += trigger.swapsDetected;
  tick.fraudAllowed += trigger.fraudAllowed;
  tick.fraudRejected += trigger.fraudRejected;
  tick.fraudHeld += trigger.fraudHeld;
  tick.payoutsAccrued += trigger.payoutsAccrued;
  tick.errors.push(...trigger.errors);
}

export async function runRewardsDistributor(
  bags: BagsClient
): Promise<RewardsTickResult> {
  const result: RewardsTickResult = {
    campaignsProcessed: 0,
    swapsDetected: 0,
    fraudAllowed: 0,
    fraudRejected: 0,
    fraudHeld: 0,
    payoutsAccrued: 0,
    payoutsPaid: 0,
    errors: [],
  };

  const state = await loadState();
  if (!state) return result;

  // Migrate legacy shapes on read — any cashbackBps-top-level campaigns
  // get coerced into { type: "cashback", config: { cashbackBps } }.
  const liveCampaigns: Campaign[] = (state.campaigns ?? [])
    .map(migrateCampaign)
    .filter((c) => c.status === "live");
  if (liveCampaigns.length === 0) return result;

  log(`[rewards] Dispatching ${liveCampaigns.length} live campaign(s)`);

  const excludeWallets = new Set<string>([
    bags.keypair.publicKey.toBase58(),
    ...liveCampaigns.map((c) => c.creatorWallet),
  ]);

  for (const campaign of liveCampaigns) {
    try {
      if (campaign.type === "cashback") {
        const sinceTimestamp =
          state.swapCursors?.[campaign.tokenMint] ??
          Math.floor(campaign.createdAt / 1000);

        const { result: triggerResult, maxFreshBlockTime } =
          await runCashbackTrigger(
            bags,
            campaign,
            sinceTimestamp,
            excludeWallets
          );
        mergeTriggerResult(result, triggerResult);

        // Advance cursor to the max blockTime of fresh signatures — non-buy
        // events (mint/burn/transfer noise) shouldn't cause re-scan loops.
        if (maxFreshBlockTime > sinceTimestamp) {
          await withStateLock(async (s) => {
            if (!s.swapCursors) s.swapCursors = {};
            s.swapCursors[campaign.tokenMint] = maxFreshBlockTime;
          });
        }
      } else if (campaign.type === "holder") {
        const lastSnapshotAt =
          state.holderSnapshotCursors?.[campaign.tokenMint] ?? 0;

        const { result: triggerResult, nextCursor } = await runHolderTrigger(
          bags,
          campaign,
          lastSnapshotAt,
          excludeWallets
        );
        mergeTriggerResult(result, triggerResult);

        if (nextCursor !== null && nextCursor > lastSnapshotAt) {
          await withStateLock(async (s) => {
            if (!s.holderSnapshotCursors) s.holderSnapshotCursors = {};
            s.holderSnapshotCursors[campaign.tokenMint] = nextCursor;
          });
        }
      } else if (campaign.type === "sprint") {
        const { result: triggerResult } = await runSprintTrigger(
          bags,
          campaign
        );
        mergeTriggerResult(result, triggerResult);
      } else if (campaign.type === "referral") {
        // Coming Q3 — skip silently, no work to do.
      }

      result.campaignsProcessed += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(`[rewards] Campaign ${campaign.tokenMint} failed:`, err);
      result.errors.push(`${campaign.tokenMint}: ${msg}`);
    }
  }

  const paid = await payoutAccrued(bags);
  result.payoutsPaid += paid;

  return result;
}
