/**
 * Pool sustainability forecast.
 *
 * Looks at the last 24h of payouts (spend) and fee claims (revenue) to
 * project how long the remaining pool lasts at the current rate.
 *
 * Inputs come from the API route — recentPayouts and feeClaims are capped
 * at 20 entries, so on very busy campaigns the 24h rate is a lower bound.
 * Good enough for a directional signal; we don't claim more than that.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type SustainabilityForecast =
  | { kind: "no-activity" }
  | { kind: "self-sustaining"; netLamportsPerDay: bigint }
  | { kind: "depleting"; daysRemaining: number; netLamportsPerDay: bigint };

interface PayoutLike {
  rewardLamports: string;
  status: string;
  paidAt?: number | null;
}

interface FeeClaimLike {
  claimedLamports: string;
  createdAt: number;
}

export function calculateSustainability(
  remainingLamports: bigint,
  recentPayouts: readonly PayoutLike[],
  feeClaims: readonly FeeClaimLike[],
  now: number = Date.now()
): SustainabilityForecast {
  const cutoff = now - DAY_MS;

  const spend24h = recentPayouts
    .filter((p) => p.status === "paid" && (p.paidAt ?? 0) > cutoff)
    .reduce((sum, p) => sum + BigInt(p.rewardLamports), 0n);

  const revenue24h = feeClaims
    .filter((c) => c.createdAt > cutoff)
    .reduce((sum, c) => sum + BigInt(c.claimedLamports), 0n);

  if (spend24h === 0n && revenue24h === 0n) return { kind: "no-activity" };

  const net = revenue24h - spend24h;
  if (net >= 0n) return { kind: "self-sustaining", netLamportsPerDay: net };

  const deficit = -net;
  const daysRemaining = Number(remainingLamports) / Number(deficit);
  return { kind: "depleting", daysRemaining, netLamportsPerDay: net };
}
