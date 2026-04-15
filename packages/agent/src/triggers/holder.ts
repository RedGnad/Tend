import type { BagsClient, HolderCampaign } from "@tend/shared";
import { log } from "../logger.js";
import { emptyTriggerResult, type TriggerResult } from "./types.js";

/**
 * Holder dividends trigger — Plan E S2-S3.
 *
 * Will snapshot token holders on a cron cadence, route each candidate through
 * the AI fraud gate for sybil detection (the anti-BagsFuel edge), and emit
 * accrued RewardPayout rows. The shared payout-executor handles on-chain SOL.
 *
 * Not yet implemented — returns an empty result so the dispatcher can handle
 * mixed-type campaign lists without erroring.
 */
export async function runHolderTrigger(
  _bags: BagsClient,
  campaign: HolderCampaign
): Promise<{ result: TriggerResult }> {
  log(
    `[rewards:holder] ${campaign.tokenMint.slice(0, 8)} — trigger not yet implemented (Plan E S2-S3)`
  );
  return { result: emptyTriggerResult() };
}
