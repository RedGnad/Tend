import type {
  BagsClient,
  FraudDecision,
  HolderCampaign,
  RewardPayout,
} from "@tend/shared";
import { withStateLock } from "../state-lock.js";
import { checkFraud } from "../fraud-detector.js";
import {
  snapshotHolders,
  type HolderSnapshotEntry,
} from "../holder-snapshot.js";
import { log } from "../logger.js";
import { emptyTriggerResult, type TriggerResult } from "./types.js";

// Holder-specific guardrails
const MIN_REWARD_LAMPORTS = 100_000n; // 0.0001 SOL — skip dust payouts

function makePayoutId(
  tokenMint: string,
  snapshotAt: number,
  ownerWallet: string
): string {
  // Unique per (campaign, snapshot, wallet). Matches FraudDecision.id shape.
  return `hldr-${tokenMint.slice(0, 8)}-${snapshotAt}-${ownerWallet.slice(0, 8)}`;
}

async function persistFraudDecision(decision: FraudDecision): Promise<void> {
  await withStateLock(async (state) => {
    if (!state.fraudDecisions) state.fraudDecisions = [];
    if (state.fraudDecisions.some((d) => d.id === decision.id)) return;
    state.fraudDecisions.push(decision);
  });
}

/**
 * Idempotent accrual for a holder pro-rata payout:
 * - dedup on (campaign, snapshotAt, wallet) via payoutId
 * - pool cap clamp + auto-flip to "depleted" when exhausted
 * - re-reads the live campaign inside the lock for safety
 */
async function tryAccrueHolderPayout(
  campaign: HolderCampaign,
  snapshotAt: number,
  ownerWallet: string,
  rewardLamports: bigint,
  synthSignature: string,
  balanceRaw: bigint
): Promise<boolean> {
  if (rewardLamports < MIN_REWARD_LAMPORTS) return false;
  let accrued = false;
  await withStateLock(async (state) => {
    if (!state.rewardPayouts) state.rewardPayouts = [];
    if (!state.campaigns) state.campaigns = [];

    const id = makePayoutId(campaign.tokenMint, snapshotAt, ownerWallet);
    if (state.rewardPayouts.some((p) => p.id === id)) return;

    const liveCampaign = state.campaigns.find(
      (c) => c.tokenMint === campaign.tokenMint
    );
    if (
      !liveCampaign ||
      liveCampaign.status !== "live" ||
      liveCampaign.type !== "holder"
    )
      return;

    const remaining =
      BigInt(liveCampaign.poolCapLamports) -
      BigInt(liveCampaign.poolSpentLamports);
    if (remaining <= 0n) return;
    const debit = rewardLamports > remaining ? remaining : rewardLamports;
    if (debit < MIN_REWARD_LAMPORTS) return;

    const payout: RewardPayout = {
      id,
      tokenMint: campaign.tokenMint,
      traderWallet: ownerWallet,
      swapTxSig: synthSignature,
      swapVolumeLamports: balanceRaw.toString(),
      rewardLamports: debit.toString(),
      payoutTxSig: null,
      status: "accrued",
      createdAt: Date.now(),
    };
    state.rewardPayouts.push(payout);

    const newSpent = BigInt(liveCampaign.poolSpentLamports) + debit;
    liveCampaign.poolSpentLamports = newSpent.toString();
    if (newSpent >= BigInt(liveCampaign.poolCapLamports)) {
      liveCampaign.status = "depleted";
    }
    accrued = true;
  });
  return accrued;
}

interface EligibleHolder {
  entry: HolderSnapshotEntry;
  holdHours: number;
}

/**
 * Filter holders eligible for this snapshot:
 * - balance > 0 (snapshotHolders already enforces this)
 * - hold duration >= campaign.config.minHoldHours
 * - firstSeenBlockTime known (null = unknown = skip for safety)
 */
function filterEligible(
  entries: HolderSnapshotEntry[],
  snapshotAt: number,
  minHoldHours: number
): EligibleHolder[] {
  const eligible: EligibleHolder[] = [];
  for (const e of entries) {
    if (e.firstSeenBlockTime === null) continue;
    const heldSeconds = snapshotAt - e.firstSeenBlockTime;
    const holdHours = Math.floor(heldSeconds / 3600);
    if (holdHours < minHoldHours) continue;
    eligible.push({ entry: e, holdHours });
  }
  return eligible;
}

/**
 * Holder dividends trigger — Plan E S2.
 *
 * On each rewards-distributor tick, checks if `snapshotCronHours` has elapsed
 * since the last snapshot for this campaign. If yes, enumerates holders,
 * filters by min hold duration, runs each eligible wallet through the AI
 * fraud gate, and accrues pro-rata payouts drawn from a per-snapshot budget
 * (poolCap * rewardBps / 10_000).
 *
 * The dispatcher owns the cursor advance (uses the returned nextCursor), and
 * the shared payout-executor handles on-chain SOL transfers.
 */
export async function runHolderTrigger(
  bags: BagsClient,
  campaign: HolderCampaign,
  lastSnapshotAt: number,
  excludeWallets: Set<string>
): Promise<{ result: TriggerResult; nextCursor: number | null }> {
  const result = emptyTriggerResult();

  const nowSec = Math.floor(Date.now() / 1000);
  const cronSec = Math.max(1, campaign.config.snapshotCronHours) * 3600;
  if (lastSnapshotAt > 0 && nowSec - lastSnapshotAt < cronSec) {
    // Not yet due — stay quiet.
    return { result, nextCursor: null };
  }

  log(
    `[rewards:holder] ${campaign.tokenMint.slice(0, 8)} — snapshot starting (minHold=${campaign.config.minHoldHours}h cron=${campaign.config.snapshotCronHours}h)`
  );

  let snapshot;
  try {
    snapshot = await snapshotHolders(bags, campaign.tokenMint, excludeWallets);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`holder-snapshot: ${msg}`);
    return { result, nextCursor: null };
  }

  const eligible = filterEligible(
    snapshot.entries,
    snapshot.snapshotAt,
    campaign.config.minHoldHours
  );

  if (eligible.length === 0) {
    log(
      `[rewards:holder] ${campaign.tokenMint.slice(0, 8)} — no eligible holders (scanned ${snapshot.totalHoldersScanned}, min ${campaign.config.minHoldHours}h)`
    );
    return { result, nextCursor: snapshot.snapshotAt };
  }

  // Snapshot budget: poolCap * rewardBps / 10_000 (flat per snapshot), clamped
  // by remaining pool. Over time, pool depletes deterministically.
  const remaining =
    BigInt(campaign.poolCapLamports) - BigInt(campaign.poolSpentLamports);
  if (remaining <= 0n) {
    return { result, nextCursor: snapshot.snapshotAt };
  }
  const rawBudget =
    (BigInt(campaign.poolCapLamports) *
      BigInt(campaign.config.rewardBps)) /
    10_000n;
  const snapshotBudget = rawBudget > remaining ? remaining : rawBudget;

  if (snapshotBudget < MIN_REWARD_LAMPORTS) {
    log(
      `[rewards:holder] ${campaign.tokenMint.slice(0, 8)} — budget ${snapshotBudget} below min reward, skipping snapshot`
    );
    return { result, nextCursor: snapshot.snapshotAt };
  }

  // Pro-rata denominator from eligible balances
  const totalEligibleBalance = eligible.reduce(
    (sum, h) => sum + h.entry.balanceRaw,
    0n
  );
  if (totalEligibleBalance === 0n) {
    return { result, nextCursor: snapshot.snapshotAt };
  }

  log(
    `[rewards:holder] ${campaign.tokenMint.slice(0, 8)} — ${eligible.length} eligible, budget=${snapshotBudget} lamports`
  );

  for (const h of eligible) {
    result.swapsDetected += 1; // reuse field for "events processed"
    const share =
      (snapshotBudget * h.entry.balanceRaw) / totalEligibleBalance;
    if (share < MIN_REWARD_LAMPORTS) continue;

    const synthSig = `holder-${campaign.tokenMint.slice(0, 8)}-${snapshot.snapshotAt}-${h.entry.ownerWallet.slice(0, 8)}`;

    const decision = await checkFraud(bags, campaign, {
      kind: "holder",
      signature: synthSig,
      traderWallet: h.entry.ownerWallet,
      balanceRaw: h.entry.balanceRaw,
      holdHours: h.holdHours,
    });
    await persistFraudDecision(decision);

    if (decision.decision === "allow") {
      result.fraudAllowed += 1;
      const accrued = await tryAccrueHolderPayout(
        campaign,
        snapshot.snapshotAt,
        h.entry.ownerWallet,
        share,
        synthSig,
        h.entry.balanceRaw
      );
      if (accrued) result.payoutsAccrued += 1;
    } else if (decision.decision === "reject") {
      result.fraudRejected += 1;
    } else {
      result.fraudHeld += 1;
    }
  }

  return { result, nextCursor: snapshot.snapshotAt };
}
