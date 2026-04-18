import type { BagsClient } from "@tend/shared";
import { log } from "./logger.js";

export type DepositCheck =
  | { ok: true; amountLamports: bigint }
  | { ok: false; error: string };

/**
 * Verify an on-chain SOL deposit before crediting a campaign pool.
 *
 * Requirements:
 *   - Transaction exists and is confirmed
 *   - Contains at least one SystemProgram.transfer from `expectedFrom` to
 *     `expectedTo` whose summed lamports match or exceed `minAmountLamports`
 *
 * Returns the exact amount transferred between the two wallets so callers
 * credit the recorded value (not the declared one).
 */
export async function verifyDepositTx(
  bags: BagsClient,
  txSig: string,
  expectedFrom: string,
  expectedTo: string,
  minAmountLamports: bigint
): Promise<DepositCheck> {
  let parsed;
  try {
    parsed = await bags.connection.getParsedTransaction(txSig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
  } catch (err) {
    return { ok: false, error: `RPC error: ${(err as Error).message}` };
  }

  if (!parsed) {
    return { ok: false, error: "Transaction not found or not yet confirmed" };
  }
  if (parsed.meta?.err) {
    return { ok: false, error: "Transaction failed on-chain" };
  }

  const instructions = parsed.transaction.message.instructions;
  let totalTransferred = 0n;

  for (const ix of instructions) {
    if (!("parsed" in ix)) continue;
    if (ix.program !== "system") continue;
    const p = ix.parsed as { type?: string; info?: Record<string, unknown> };
    if (p.type !== "transfer") continue;
    const info = p.info ?? {};
    if (info.source !== expectedFrom) continue;
    if (info.destination !== expectedTo) continue;
    const lamports =
      typeof info.lamports === "number" || typeof info.lamports === "string"
        ? BigInt(info.lamports)
        : 0n;
    totalTransferred += lamports;
  }

  if (totalTransferred === 0n) {
    return {
      ok: false,
      error: `No SystemProgram.transfer found from ${expectedFrom.slice(0, 8)}… to ${expectedTo.slice(0, 8)}…`,
    };
  }
  if (totalTransferred < minAmountLamports) {
    return {
      ok: false,
      error: `Transferred ${totalTransferred} lamports, expected ≥ ${minAmountLamports}`,
    };
  }

  log(
    `[deposit] Verified ${totalTransferred} lamports from ${expectedFrom.slice(0, 8)}… (tx ${txSig.slice(0, 8)}…)`
  );
  return { ok: true, amountLamports: totalTransferred };
}
