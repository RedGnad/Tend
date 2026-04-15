/**
 * Shared trigger result shape. Each campaign-type trigger returns these
 * counters so the dispatcher in rewards-distributor.ts can aggregate across
 * all campaigns in a tick.
 *
 * Triggers own their detection logic (swap feed, holder snapshot, sprint
 * threshold) AND the fraud-gate call. They emit accrued RewardPayout rows
 * into state; the shared payout-executor owns the on-chain leg.
 */
export interface TriggerResult {
  swapsDetected: number;
  fraudAllowed: number;
  fraudRejected: number;
  fraudHeld: number;
  payoutsAccrued: number;
  errors: string[];
}

export function emptyTriggerResult(): TriggerResult {
  return {
    swapsDetected: 0,
    fraudAllowed: 0,
    fraudRejected: 0,
    fraudHeld: 0,
    payoutsAccrued: 0,
    errors: [],
  };
}
