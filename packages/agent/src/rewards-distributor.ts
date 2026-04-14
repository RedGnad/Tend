import {
  SystemProgram,
  Transaction,
  PublicKey,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import type { BagsClient, Campaign, FraudDecision, RewardPayout } from "@tend/shared";
import { withStateLock } from "./state-lock.js";
import { loadState } from "./state-reader.js";
import { detectNewBuys } from "./swap-detector.js";
import { checkFraud } from "./fraud-detector.js";
import { log, logError } from "./logger.js";

// Guardrails
const MIN_REWARD_LAMPORTS = 100_000n; // 0.0001 SOL
const MAX_PAYOUTS_PER_TICK = 10;
const PAYOUT_COOLDOWN_MS = 60 * 1000; // 60s per trader
const ADMIN_MIN_RESERVE_LAMPORTS = 5_000_000n; // keep 0.005 SOL for fees
const MAX_PAYOUT_ATTEMPTS = 3; // after N failures → status "failed", stop retrying

// Dry-run: skip on-chain transfers, keep state mutations (accrue only)
const DRY_RUN_PAYOUTS = process.env.DRY_RUN_PAYOUTS === "1";

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

/**
 * Main tick for the rewards-distributor agent.
 * For each live campaign:
 *   1. Detect new qualifying BUY swaps since last cursor
 *   2. Compute cashback, persist as accrued RewardPayout
 *   3. Batch-send SOL for accrued payouts from admin wallet
 */
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

  const liveCampaigns = (state.campaigns ?? []).filter(
    (c) => c.status === "live"
  );
  if (liveCampaigns.length === 0) return result;

  log(`[rewards] Processing ${liveCampaigns.length} live campaign(s)`);

  const excludeWallets = new Set<string>([
    bags.keypair.publicKey.toBase58(),
    ...liveCampaigns.map((c) => c.creatorWallet),
  ]);

  for (const campaign of liveCampaigns) {
    try {
      const sinceTimestamp =
        state.swapCursors?.[campaign.tokenMint] ??
        Math.floor(campaign.createdAt / 1000);

      const { buys, maxFreshBlockTime } = await detectNewBuys(
        bags,
        campaign.tokenMint,
        sinceTimestamp,
        excludeWallets
      );
      result.swapsDetected += buys.length;

      if (buys.length > 0) {
        log(
          `[rewards] ${campaign.tokenMint.slice(0, 8)} — ${buys.length} new buy(s)`
        );
      }

      for (const buy of buys) {
        // Run the fraud gate BEFORE accrual. Decision is persisted regardless,
        // but only "allow" proceeds to accrual → rejected/held never debit pool.
        const decision = await checkFraud(bags, campaign, buy);
        await persistFraudDecision(decision);

        if (decision.decision === "allow") {
          result.fraudAllowed += 1;
          const accrued = await tryAccruePayout(campaign, buy);
          if (accrued) result.payoutsAccrued += 1;
        } else if (decision.decision === "reject") {
          result.fraudRejected += 1;
        } else {
          result.fraudHeld += 1;
        }
      }

      // Advance cursor to the max blockTime of ALL fresh signatures (buy or not),
      // so non-buy events (mint/burn/transfer noise) don't cause re-scan loops.
      if (maxFreshBlockTime > sinceTimestamp) {
        await withStateLock(async (s) => {
          if (!s.swapCursors) s.swapCursors = {};
          s.swapCursors[campaign.tokenMint] = maxFreshBlockTime;
        });
      }

      result.campaignsProcessed += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(`[rewards] Campaign ${campaign.tokenMint} failed:`, err);
      result.errors.push(`${campaign.tokenMint}: ${msg}`);
    }
  }

  // Batch-send SOL for all accrued payouts across campaigns
  const paid = await payoutAccrued(bags);
  result.payoutsPaid += paid;

  return result;
}

/**
 * Clamp a raw cashback to the pool remaining and the min threshold.
 */
export function computeRewardLamports(
  campaign: Campaign,
  swapVolumeLamports: bigint
): bigint {
  const raw = (swapVolumeLamports * BigInt(campaign.cashbackBps)) / 10_000n;
  if (raw < MIN_REWARD_LAMPORTS) return 0n;

  const remaining =
    BigInt(campaign.poolCapLamports) - BigInt(campaign.poolSpentLamports);
  if (remaining <= 0n) return 0n;

  return raw > remaining ? remaining : raw;
}

function makePayoutId(swapTxSig: string, traderWallet: string): string {
  return `${swapTxSig.slice(0, 16)}-${traderWallet.slice(0, 8)}`;
}

/**
 * Idempotent persist of a fraud decision. Skipped if an entry with the same id
 * already exists (cached decisions from checkFraud won't duplicate).
 */
async function persistFraudDecision(decision: FraudDecision): Promise<void> {
  await withStateLock(async (state) => {
    if (!state.fraudDecisions) state.fraudDecisions = [];
    if (state.fraudDecisions.some((d) => d.id === decision.id)) return;
    state.fraudDecisions.push(decision);
  });
}

/**
 * Persist a single accrued payout under the state lock.
 * - Skips duplicates (idempotent on swap signature)
 * - Respects per-trader cooldown (60s)
 * - Updates campaign pool spent counter
 * - Marks campaign depleted when pool exhausted
 */
async function tryAccruePayout(
  campaign: Campaign,
  buy: { signature: string; blockTime: number; traderWallet: string; solSpentLamports: bigint }
): Promise<boolean> {
  let accrued = false;
  await withStateLock(async (state) => {
    if (!state.rewardPayouts) state.rewardPayouts = [];
    if (!state.campaigns) state.campaigns = [];

    const id = makePayoutId(buy.signature, buy.traderWallet);
    if (state.rewardPayouts.some((p) => p.id === id)) return;

    // Per-trader cooldown — any payout on this campaign for this trader within 60s blocks
    const now = Date.now();
    const recent = state.rewardPayouts.find(
      (p) =>
        p.tokenMint === campaign.tokenMint &&
        p.traderWallet === buy.traderWallet &&
        now - p.createdAt < PAYOUT_COOLDOWN_MS
    );
    if (recent) return;

    const liveCampaign = state.campaigns.find(
      (c) => c.tokenMint === campaign.tokenMint
    );
    if (!liveCampaign || liveCampaign.status !== "live") return;

    const reward = computeRewardLamports(liveCampaign, buy.solSpentLamports);
    if (reward === 0n) return;

    const payout: RewardPayout = {
      id,
      tokenMint: campaign.tokenMint,
      traderWallet: buy.traderWallet,
      swapTxSig: buy.signature,
      swapVolumeLamports: buy.solSpentLamports.toString(),
      rewardLamports: reward.toString(),
      payoutTxSig: null,
      status: "accrued",
      createdAt: now,
    };
    state.rewardPayouts.push(payout);

    const newSpent =
      BigInt(liveCampaign.poolSpentLamports) + reward;
    liveCampaign.poolSpentLamports = newSpent.toString();
    if (newSpent >= BigInt(liveCampaign.poolCapLamports)) {
      liveCampaign.status = "depleted";
    }
    accrued = true;
  });
  return accrued;
}

/**
 * Send SOL from the admin wallet to each accrued payout recipient.
 * One transaction per payout (simplest, traceable). Respects:
 *   - MAX_PAYOUTS_PER_TICK to bound on-chain writes per cycle
 *   - ADMIN_MIN_RESERVE_LAMPORTS to avoid draining the fee wallet
 */
async function payoutAccrued(bags: BagsClient): Promise<number> {
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
          `[rewards][dry-run] would pay ${payout.rewardLamports} → ${payout.traderWallet.slice(0, 8)} (swap ${payout.swapTxSig.slice(0, 10)})`
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
          `[rewards] Admin balance ${balance} below reserve — stopping payouts`
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

      const sig = await bags.connection.sendRawTransaction(
        tx.serialize(),
        { skipPreflight: false, maxRetries: 3 }
      );
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
        `[rewards] Paid ${payout.rewardLamports} lamports → ${payout.traderWallet.slice(0, 8)} (${sig.slice(0, 10)})`
      );
      paidCount += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(`[rewards] Payout ${payout.id} failed:`, err);
      await withStateLock(async (s) => {
        const p = (s.rewardPayouts ?? []).find((x) => x.id === payout.id);
        if (!p) return;
        p.failedAttempts = (p.failedAttempts ?? 0) + 1;
        p.lastError = msg.slice(0, 240);
        if (p.failedAttempts >= MAX_PAYOUT_ATTEMPTS) {
          p.status = "failed";
          log(
            `[rewards] Payout ${payout.id} marked failed after ${p.failedAttempts} attempt(s)`
          );
        }
      });
    }
  }

  return paidCount;
}

export { MAX_PAYOUTS_PER_TICK, MIN_REWARD_LAMPORTS };
