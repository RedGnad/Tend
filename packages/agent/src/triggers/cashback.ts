import type {
  BagsClient,
  CashbackCampaign,
  FraudDecision,
  RewardPayout,
} from "@tend/shared";
import { withStateLock } from "../state-lock.js";
import { detectNewBuys } from "../swap-detector.js";
import { checkFraud } from "../fraud-detector.js";
import { log } from "../logger.js";
import { canAccrue } from "../treasury-health.js";
import { emptyTriggerResult, type TriggerResult } from "./types.js";

// Cashback-specific guardrails
const MIN_REWARD_LAMPORTS = 100_000n; // 0.0001 SOL — under this, skip accrual
const PAYOUT_COOLDOWN_MS = 60 * 1000; // per-trader cooldown on the same campaign

export function computeCashbackReward(
  campaign: CashbackCampaign,
  swapVolumeLamports: bigint
): bigint {
  const raw =
    (swapVolumeLamports * BigInt(campaign.config.cashbackBps)) / 10_000n;
  if (raw < MIN_REWARD_LAMPORTS) return 0n;
  const remaining =
    BigInt(campaign.poolCapLamports) - BigInt(campaign.poolSpentLamports);
  if (remaining <= 0n) return 0n;
  return raw > remaining ? remaining : raw;
}

function makePayoutId(swapTxSig: string, traderWallet: string): string {
  return `${swapTxSig.slice(0, 16)}-${traderWallet.slice(0, 8)}`;
}

async function persistFraudDecision(decision: FraudDecision): Promise<void> {
  await withStateLock(async (state) => {
    if (!state.fraudDecisions) state.fraudDecisions = [];
    if (state.fraudDecisions.some((d) => d.id === decision.id)) return;
    state.fraudDecisions.push(decision);
  });
}

/**
 * Idempotent accrual of a cashback payout:
 * - dedup on (swapSig, trader)
 * - per-trader 60s cooldown on the same campaign
 * - pool cap clamp + auto-flip to "depleted" when exhausted
 */
async function tryAccrueCashbackPayout(
  campaign: CashbackCampaign,
  buy: {
    signature: string;
    blockTime: number;
    traderWallet: string;
    solSpentLamports: bigint;
  }
): Promise<boolean> {
  let accrued = false;
  await withStateLock(async (state) => {
    if (!state.rewardPayouts) state.rewardPayouts = [];
    if (!state.campaigns) state.campaigns = [];

    const id = makePayoutId(buy.signature, buy.traderWallet);
    if (state.rewardPayouts.some((p) => p.id === id)) return;

    const now = Date.now();
    const recent = state.rewardPayouts.find(
      (p) =>
        p.tokenMint === campaign.tokenMint &&
        p.traderWallet === buy.traderWallet &&
        (p.campaignType ?? "cashback") === "cashback" &&
        now - p.createdAt < PAYOUT_COOLDOWN_MS
    );
    if (recent) return;

    const liveCampaign = state.campaigns.find(
      (c) => c.tokenMint === campaign.tokenMint && c.type === "cashback"
    );
    if (!liveCampaign || liveCampaign.status !== "live") return;

    const reward = computeCashbackReward(
      liveCampaign as CashbackCampaign,
      buy.solSpentLamports
    );
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
      campaignType: "cashback",
    };
    state.rewardPayouts.push(payout);

    const newSpent = BigInt(liveCampaign.poolSpentLamports) + reward;
    liveCampaign.poolSpentLamports = newSpent.toString();
    if (newSpent >= BigInt(liveCampaign.poolCapLamports)) {
      liveCampaign.status = "depleted";
    }
    accrued = true;
  });
  return accrued;
}

/**
 * Cashback trigger — detects new BUY swaps since the cursor, runs each through
 * the AI fraud gate, and accrues payouts for allowed swaps. The dispatcher
 * owns cursor advancement (using the returned maxFreshBlockTime) and the
 * shared payout-executor owns the on-chain SOL leg.
 */
export async function runCashbackTrigger(
  bags: BagsClient,
  campaign: CashbackCampaign,
  sinceTimestamp: number,
  excludeWallets: Set<string>
): Promise<{ result: TriggerResult; maxFreshBlockTime: number }> {
  const result = emptyTriggerResult();

  const { buys, maxFreshBlockTime } = await detectNewBuys(
    bags,
    campaign.tokenMint,
    sinceTimestamp,
    excludeWallets
  );
  result.swapsDetected = buys.length;

  if (buys.length > 0) {
    log(
      `[rewards:cashback] ${campaign.tokenMint.slice(0, 8)} — ${buys.length} new buy(s)`
    );
  }

  for (const buy of buys) {
    const decision = await checkFraud(bags, campaign, {
      kind: "swap",
      signature: buy.signature,
      traderWallet: buy.traderWallet,
      solSpentLamports: buy.solSpentLamports,
    });
    await persistFraudDecision(decision);

    if (decision.decision === "allow") {
      result.fraudAllowed += 1;
      // Treasury solvency gate — skip accrual if the admin wallet can't
      // cover this payout on top of existing obligations. Better to skip
      // one cashback than queue a debt the executor can never drain.
      const reward =
        (buy.solSpentLamports * BigInt(campaign.config.cashbackBps)) /
        10_000n;
      if (reward > 0n && !(await canAccrue(bags, reward))) {
        log(
          `[rewards:cashback] treasury underfunded — skipping accrual (${reward} lamports)`
        );
        continue;
      }
      const accrued = await tryAccrueCashbackPayout(campaign, buy);
      if (accrued) result.payoutsAccrued += 1;
    } else if (decision.decision === "reject") {
      result.fraudRejected += 1;
    } else {
      result.fraudHeld += 1;
    }
  }

  return { result, maxFreshBlockTime };
}
