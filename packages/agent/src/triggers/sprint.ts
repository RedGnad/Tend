import type {
  BagsClient,
  Campaign,
  FraudDecision,
  RewardPayout,
  SprintCampaign,
} from "@tend/shared";
import { withStateLock } from "../state-lock.js";
import { detectNewBuys } from "../swap-detector.js";
import { checkFraud } from "../fraud-detector.js";
import { log } from "../logger.js";
import { emptyTriggerResult, type TriggerResult } from "./types.js";

// Sprint-specific guardrails
const MIN_REWARD_LAMPORTS = 100_000n; // 0.0001 SOL floor

function makePayoutId(swapTxSig: string, traderWallet: string): string {
  // Same shape as cashback — per (swap, wallet), idempotent across ticks.
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
 * Idempotent accrual for a sprint bonus:
 * - dedup on (swap, wallet)
 * - enforce maxWinners (count of prior payouts on this mint)
 * - enforce one-bonus-per-wallet
 * - flat bonusLamports, clamped to pool remaining
 * - auto-depletes when winners == maxWinners or pool exhausted
 */
async function tryAccrueSprintPayout(
  campaign: SprintCampaign,
  buy: {
    signature: string;
    traderWallet: string;
    solSpentLamports: bigint;
  }
): Promise<boolean> {
  let accrued = false;
  await withStateLock(async (state) => {
    if (!state.rewardPayouts) state.rewardPayouts = [];
    if (!state.campaigns) state.campaigns = [];

    const id = makePayoutId(buy.signature, buy.traderWallet);
    if (state.rewardPayouts.some((p: RewardPayout) => p.id === id)) return;

    const liveCampaign = state.campaigns.find(
      (c: Campaign): c is SprintCampaign =>
        c.tokenMint === campaign.tokenMint && c.type === "sprint"
    );
    if (!liveCampaign || liveCampaign.status !== "live") return;

    // Existing winners for THIS sprint (accrued + paid + failed all count —
    // a failed payout still used a slot). Filter by campaignType so payouts
    // from a prior cashback/holder campaign on the same mint don't bleed in.
    const priorWinners = state.rewardPayouts.filter(
      (p: RewardPayout) =>
        p.tokenMint === campaign.tokenMint &&
        (p.campaignType ?? "cashback") === "sprint"
    );
    if (priorWinners.length >= liveCampaign.config.maxWinners) {
      // Sprint is full — flip status and stop.
      if (liveCampaign.status === "live") {
        liveCampaign.status = "depleted";
      }
      return;
    }
    // One bonus per wallet.
    if (priorWinners.some((p) => p.traderWallet === buy.traderWallet)) return;

    const bonus = BigInt(liveCampaign.config.bonusLamports);
    if (bonus < MIN_REWARD_LAMPORTS) return;

    const remaining =
      BigInt(liveCampaign.poolCapLamports) -
      BigInt(liveCampaign.poolSpentLamports);
    if (remaining <= 0n) return;
    const debit = bonus > remaining ? remaining : bonus;
    if (debit < MIN_REWARD_LAMPORTS) return;

    const payout: RewardPayout = {
      id,
      tokenMint: campaign.tokenMint,
      traderWallet: buy.traderWallet,
      swapTxSig: buy.signature,
      swapVolumeLamports: buy.solSpentLamports.toString(),
      rewardLamports: debit.toString(),
      payoutTxSig: null,
      status: "accrued",
      createdAt: Date.now(),
      campaignType: "sprint",
    };
    state.rewardPayouts.push(payout);

    const newSpent = BigInt(liveCampaign.poolSpentLamports) + debit;
    liveCampaign.poolSpentLamports = newSpent.toString();

    // Depletion: winners full OR pool empty.
    const totalWinners = priorWinners.length + 1;
    if (
      totalWinners >= liveCampaign.config.maxWinners ||
      newSpent >= BigInt(liveCampaign.poolCapLamports)
    ) {
      liveCampaign.status = "depleted";
    }
    accrued = true;
  });
  return accrued;
}

/**
 * Launch sprint trigger — Plan E S4.
 *
 * Pays a flat SOL bonus to the first `maxWinners` wallets that buy at least
 * `minBuyLamports`. Each wallet wins at most once. The AI fraud gate filters
 * every qualifying buy — snipe bots and fresh-wallet farms get rejected
 * before the bonus slot is used.
 *
 * Shares `swapCursors` with the cashback trigger: per mint there is at most
 * one live campaign at a time, so cursor semantics are consistent.
 */
export async function runSprintTrigger(
  bags: BagsClient,
  campaign: SprintCampaign,
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

  const minBuy = BigInt(campaign.config.minBuyLamports);
  const qualifying = buys.filter((b) => b.solSpentLamports >= minBuy);
  result.swapsDetected = qualifying.length;

  if (qualifying.length > 0) {
    log(
      `[rewards:sprint] ${campaign.tokenMint.slice(0, 8)} — ${qualifying.length} qualifying buy(s) (minBuy=${minBuy} lamports)`
    );
  }

  for (const buy of qualifying) {
    const decision = await checkFraud(bags, campaign, {
      kind: "swap",
      signature: buy.signature,
      traderWallet: buy.traderWallet,
      solSpentLamports: buy.solSpentLamports,
    });
    await persistFraudDecision(decision);

    if (decision.decision === "allow") {
      result.fraudAllowed += 1;
      const accrued = await tryAccrueSprintPayout(campaign, buy);
      if (accrued) result.payoutsAccrued += 1;
    } else if (decision.decision === "reject") {
      result.fraudRejected += 1;
    } else {
      result.fraudHeld += 1;
    }
  }

  return { result, maxFreshBlockTime };
}
