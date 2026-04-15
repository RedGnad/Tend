import type { BagsClient, SprintCampaign } from "@tend/shared";
import { log } from "../logger.js";
import { emptyTriggerResult, type TriggerResult } from "./types.js";

/**
 * Launch sprint trigger — Plan E S4.
 *
 * Will detect the first N buyers crossing a volume threshold on a fresh token,
 * route each through the AI fraud gate for bot-pile-on detection, and emit a
 * capped set of bonus payouts.
 *
 * Not yet implemented — returns empty result so dispatcher handles mixed types.
 */
export async function runSprintTrigger(
  _bags: BagsClient,
  campaign: SprintCampaign
): Promise<{ result: TriggerResult }> {
  log(
    `[rewards:sprint] ${campaign.tokenMint.slice(0, 8)} — trigger not yet implemented (Plan E S4)`
  );
  return { result: emptyTriggerResult() };
}
