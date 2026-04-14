#!/usr/bin/env node
/**
 * Diagnostic: fetch recent sigs for a mint and print classification.
 * For each sig: who's the fee payer, what's the token delta for the mint,
 * was it a buy / sell / transfer / mint-op, and why we keep or filter.
 *
 * Purpose: verify getSignaturesForAddress(mint) surfaces actual DEX swaps.
 * If it only returns mint/burn events, we have a blind spot.
 */

import { BagsClient, loadKeypair } from "@tend/shared";
import { PublicKey } from "@solana/web3.js";

const DEFAULT_MINT = "6qa9oCypYpnWZyZNQ8v36eLbmWmcgHRv4MuU7BXQBAGS";
const LIMIT = 50;

function fmt(n: number): string {
  const sol = n / 1_000_000_000;
  if (Math.abs(sol) >= 0.001) return sol.toFixed(6);
  return sol.toExponential(2);
}

async function main() {
  const mint = process.argv[2] ?? DEFAULT_MINT;
  const rpcUrl = process.env.SOLANA_RPC_URL!;
  const apiKey = process.env.BAGS_API_KEY!;
  const privateKey = process.env.TEND_PRIVATE_KEY!;
  const keypair = loadKeypair(privateKey);
  const bags = new BagsClient({ apiKey, rpcUrl, privateKey: keypair });

  const mintPubkey = new PublicKey(mint);
  const sigs = await bags.connection.getSignaturesForAddress(
    mintPubkey,
    { limit: LIMIT },
    "confirmed"
  );

  console.log(`\n=== diag-detector: ${mint.slice(0, 8)} ===`);
  console.log(`total sigs: ${sigs.length}\n`);

  let buys = 0;
  let sells = 0;
  let noTokenChange = 0;
  let errored = 0;
  let mintBurn = 0;
  let other = 0;

  const classifications: string[] = [];

  for (let i = 0; i < sigs.length; i++) {
    const sigInfo = sigs[i];
    if (sigInfo.err) {
      errored += 1;
      classifications.push(`${i.toString().padStart(2)}. ERR   ${sigInfo.signature.slice(0, 16)}`);
      continue;
    }

    try {
      const tx = await bags.connection.getParsedTransaction(sigInfo.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      });
      if (!tx || !tx.meta) {
        other += 1;
        continue;
      }

      const accountKeys = tx.transaction.message.accountKeys;
      const feePayerIdx = accountKeys.findIndex((k) => k.signer && k.writable);
      if (feePayerIdx < 0) {
        other += 1;
        continue;
      }
      const feePayer = accountKeys[feePayerIdx].pubkey.toBase58();

      const pre = tx.meta.preTokenBalances ?? [];
      const post = tx.meta.postTokenBalances ?? [];

      // Aggregate ALL token balance changes for this mint across all owners
      const mintDeltas: Record<string, bigint> = {};
      for (const b of pre) {
        if (b.mint !== mint) continue;
        const owner = b.owner ?? "?";
        mintDeltas[owner] = (mintDeltas[owner] ?? 0n) - BigInt(b.uiTokenAmount.amount);
      }
      for (const b of post) {
        if (b.mint !== mint) continue;
        const owner = b.owner ?? "?";
        mintDeltas[owner] = (mintDeltas[owner] ?? 0n) + BigInt(b.uiTokenAmount.amount);
      }

      const nonZeroDeltas = Object.entries(mintDeltas).filter(([, v]) => v !== 0n);

      if (nonZeroDeltas.length === 0) {
        noTokenChange += 1;
        classifications.push(
          `${i.toString().padStart(2)}. MINT-OP  ${sigInfo.signature.slice(0, 16)}  (no token delta)`
        );
        mintBurn += 1;
        continue;
      }

      // Look for fee payer in deltas
      const feePayerDelta = mintDeltas[feePayer] ?? 0n;
      const preSol = tx.meta.preBalances[feePayerIdx] ?? 0;
      const postSol = tx.meta.postBalances[feePayerIdx] ?? 0;
      const solDelta = postSol - preSol; // negative = spent

      let kind = "OTHER ";
      if (feePayerDelta > 0n && solDelta < -10_000) {
        kind = "BUY   ";
        buys += 1;
      } else if (feePayerDelta < 0n && solDelta > 10_000) {
        kind = "SELL  ";
        sells += 1;
      } else if (feePayerDelta === 0n) {
        kind = "XFER  ";
        other += 1;
      } else {
        kind = "OTHER ";
        other += 1;
      }

      classifications.push(
        `${i.toString().padStart(2)}. ${kind} ${sigInfo.signature.slice(0, 16)}  ` +
          `feepayer=${feePayer.slice(0, 6)} tokenΔ=${feePayerDelta.toString()} solΔ=${fmt(solDelta)}`
      );
    } catch (err) {
      errored += 1;
      classifications.push(
        `${i.toString().padStart(2)}. PARSE-ERR ${sigInfo.signature.slice(0, 16)}: ${err instanceof Error ? err.message.slice(0, 40) : "?"}`
      );
    }
  }

  console.log("Per-sig:");
  for (const line of classifications) console.log("  " + line);

  console.log("\nSummary:");
  console.log(`  buys:          ${buys}`);
  console.log(`  sells:         ${sells}`);
  console.log(`  no-token-op:   ${noTokenChange} (likely mint/metadata ops)`);
  console.log(`  other/xfer:    ${other}`);
  console.log(`  errored:       ${errored}`);
  console.log("");
}

main().catch((err) => {
  console.error("diag failed:", err);
  process.exit(1);
});
