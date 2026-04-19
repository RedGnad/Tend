import type { BagsClient } from "@tend/shared";
import { loadState } from "./state-reader.js";
import { ADMIN_MIN_RESERVE_LAMPORTS } from "./payout-executor.js";

/**
 * Treasury health snapshot — single source of truth for solvency.
 *
 * The admin wallet is a shared treasury across all campaigns. Without a
 * health view, accruals can pile up beyond what the wallet can pay, payouts
 * silently stop with only a log line, and operators have no signal that
 * the system is over-promised.
 *
 * `surplusLamports` is what's safely available right now AFTER paying every
 * accrued + in-flight payout AND keeping the rent reserve. Negative means
 * we're under-promised — payouts will fail until topped up.
 */
export interface TreasuryHealth {
  adminWallet: string;
  balanceLamports: string;
  reserveLamports: string;
  /** sum of accrued + submitted (in-flight) payout amounts */
  obligationsLamports: string;
  /** balance - obligations - reserve. Negative = underfunded */
  surplusLamports: string;
  /** "healthy" | "low" | "critical" — for dashboard badges + alerting */
  status: "healthy" | "low" | "critical";
  measuredAt: number;
}

const LOW_THRESHOLD_LAMPORTS = 10_000_000n; // 0.01 SOL surplus = warn
const CRITICAL_THRESHOLD_LAMPORTS = 0n; // <= 0 surplus = critical

export async function getTreasuryHealth(
  bags: BagsClient
): Promise<TreasuryHealth> {
  const adminPub = bags.keypair.publicKey;
  const balance = BigInt(await bags.connection.getBalance(adminPub));

  const state = await loadState();
  const obligations =
    (state?.rewardPayouts ?? [])
      .filter((p) => p.status === "accrued" || p.status === "submitted")
      .reduce((sum, p) => sum + BigInt(p.rewardLamports), 0n);

  const reserve = ADMIN_MIN_RESERVE_LAMPORTS;
  const surplus = balance - obligations - reserve;

  let status: TreasuryHealth["status"];
  if (surplus <= CRITICAL_THRESHOLD_LAMPORTS) status = "critical";
  else if (surplus < LOW_THRESHOLD_LAMPORTS) status = "low";
  else status = "healthy";

  return {
    adminWallet: adminPub.toBase58(),
    balanceLamports: balance.toString(),
    reserveLamports: reserve.toString(),
    obligationsLamports: obligations.toString(),
    surplusLamports: surplus.toString(),
    status,
    measuredAt: Date.now(),
  };
}

/**
 * True when the treasury cannot safely cover one more payout of
 * `nextPayoutLamports` on top of existing obligations + reserve.
 * Triggers should call this before accruing to avoid building a backlog
 * the executor can never drain.
 */
export async function canAccrue(
  bags: BagsClient,
  nextPayoutLamports: bigint
): Promise<boolean> {
  const h = await getTreasuryHealth(bags);
  const surplus = BigInt(h.surplusLamports);
  return surplus >= nextPayoutLamports;
}
