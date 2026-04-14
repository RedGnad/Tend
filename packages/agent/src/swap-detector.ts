import {
  PublicKey,
  type ParsedTransactionWithMeta,
  type ConfirmedSignatureInfo,
} from "@solana/web3.js";
import type { BagsClient } from "@tend/shared";
import { log } from "./logger.js";

export interface DetectedBuy {
  signature: string;
  blockTime: number;
  traderWallet: string;
  solSpentLamports: bigint;
  tokensReceived: string; // raw amount (no decimals applied)
}

export interface DetectionResult {
  buys: DetectedBuy[];
  /** max blockTime seen across ALL fresh signatures (buy or not) — use for cursor advance */
  maxFreshBlockTime: number;
}

const MAX_SIGNATURES_PER_TICK = 50;
const MIN_SOL_VOLUME_LAMPORTS = 1_000_000n; // 0.001 SOL — ignore dust

/**
 * Fetch new buy transactions on a token mint since `sinceTimestamp`.
 * Uses Solana RPC only (no extra API key). Parses preTokenBalances vs
 * postTokenBalances to detect wallets whose token balance increased (=buy),
 * computes SOL volume from preBalances[0] - postBalances[0] on fee payer.
 *
 * Heuristic: approximates volume from the signer's SOL delta on a buy.
 * Excludes the admin/creator wallet (self-claims, self-trades).
 */
export async function detectNewBuys(
  bags: BagsClient,
  tokenMint: string,
  sinceTimestamp: number,
  excludeWallets: Set<string>
): Promise<DetectionResult> {
  const mintPubkey = new PublicKey(tokenMint);

  let signatures: ConfirmedSignatureInfo[];
  try {
    signatures = await bags.connection.getSignaturesForAddress(
      mintPubkey,
      { limit: MAX_SIGNATURES_PER_TICK },
      "confirmed"
    );
  } catch (err) {
    log(
      `[swap-detector] getSignaturesForAddress failed for ${tokenMint.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`
    );
    return { buys: [], maxFreshBlockTime: sinceTimestamp };
  }

  const fresh = signatures.filter(
    (s) =>
      s.blockTime !== null &&
      s.blockTime !== undefined &&
      s.blockTime > sinceTimestamp &&
      !s.err
  );

  const maxFreshBlockTime = fresh.reduce(
    (max, s) => ((s.blockTime ?? 0) > max ? (s.blockTime ?? 0) : max),
    sinceTimestamp
  );

  if (fresh.length === 0) {
    return { buys: [], maxFreshBlockTime };
  }

  // Parse in small batches to avoid RPC timeouts
  const buys: DetectedBuy[] = [];
  for (const sigInfo of fresh) {
    try {
      const tx = await bags.connection.getParsedTransaction(
        sigInfo.signature,
        {
          maxSupportedTransactionVersion: 0,
          commitment: "confirmed",
        }
      );
      if (!tx) continue;

      const buy = extractBuyFromTransaction(tx, tokenMint, excludeWallets);
      if (buy) {
        buys.push({
          ...buy,
          signature: sigInfo.signature,
          blockTime: sigInfo.blockTime ?? 0,
        });
      }
    } catch (err) {
      log(
        `[swap-detector] parse failed ${sigInfo.signature.slice(0, 10)}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return { buys, maxFreshBlockTime };
}

interface PartialBuy {
  traderWallet: string;
  solSpentLamports: bigint;
  tokensReceived: string;
}

function extractBuyFromTransaction(
  tx: ParsedTransactionWithMeta,
  tokenMint: string,
  excludeWallets: Set<string>
): PartialBuy | null {
  if (!tx.meta || tx.meta.err) return null;

  const accountKeys = tx.transaction.message.accountKeys;
  if (accountKeys.length === 0) return null;

  // Fee payer = signer = trader wallet (first writable signer)
  const feePayerIdx = accountKeys.findIndex((k) => k.signer && k.writable);
  if (feePayerIdx < 0) return null;
  const traderWallet = accountKeys[feePayerIdx].pubkey.toBase58();

  if (excludeWallets.has(traderWallet)) return null;

  const preTokenBalances = tx.meta.preTokenBalances ?? [];
  const postTokenBalances = tx.meta.postTokenBalances ?? [];

  // Find trader's token balance delta for the target mint
  const preBalance = preTokenBalances.find(
    (b) => b.mint === tokenMint && b.owner === traderWallet
  );
  const postBalance = postTokenBalances.find(
    (b) => b.mint === tokenMint && b.owner === traderWallet
  );

  const pre = BigInt(preBalance?.uiTokenAmount.amount ?? "0");
  const post = BigInt(postBalance?.uiTokenAmount.amount ?? "0");
  const delta = post - pre;

  // Must be a net positive token balance change → buy
  if (delta <= 0n) return null;

  // SOL spent = preBalances[feePayerIdx] - postBalances[feePayerIdx]
  const preSol = BigInt(tx.meta.preBalances[feePayerIdx] ?? 0);
  const postSol = BigInt(tx.meta.postBalances[feePayerIdx] ?? 0);
  const solSpent = preSol - postSol;

  if (solSpent < MIN_SOL_VOLUME_LAMPORTS) return null;

  return {
    traderWallet,
    solSpentLamports: solSpent,
    tokensReceived: delta.toString(),
  };
}
