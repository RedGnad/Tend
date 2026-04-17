import type { BagsClient } from "@tend/shared";
import { formatSol, loadKeypair } from "@tend/shared";
import { loadState } from "./state-reader.js";
import { withStateLock } from "./state-lock.js";
import { log, logError } from "./logger.js";

/**
 * Campaign fee claimer — the fee-sharing loop.
 *
 * For every token with a live/depleted campaign, checks if the admin wallet
 * (or legacy service wallets) has claimable Bags trading fees.  If so, claims
 * them on-chain and grows the campaign pool automatically.
 *
 * This is the bridge between Bags fee-share and campaign payouts:
 *   Trading fees  -->  claimed to admin wallet  -->  poolCapLamports grows
 *                                                -->  feesClaimedLamports tracked
 *
 * The payout executor continues to pay from admin wallet balance as before.
 * Net effect: the pool replenishes itself from trading activity.
 */

export interface FeeClaimResult {
  tokenMint: string;
  claimedLamports: bigint;
  signatures: string[];
  source: "admin" | "service-wallet";
}

export async function claimFeesForCampaigns(
  bags: BagsClient
): Promise<{ results: FeeClaimResult[]; totalClaimedLamports: bigint }> {
  const state = await loadState();
  if (!state) return { results: [], totalClaimedLamports: 0n };

  // Tokens that have active or depleted campaigns (depleted ones can revive)
  const campaignTokens = (state.campaigns ?? [])
    .filter((c) => c.status === "live" || c.status === "depleted")
    .map((c) => c.tokenMint);
  const uniqueMints = [...new Set(campaignTokens)];
  if (uniqueMints.length === 0) return { results: [], totalClaimedLamports: 0n };

  const results: FeeClaimResult[] = [];
  let totalClaimed = 0n;

  // 1. Try claiming from admin wallet (creator gets fees by default on Bags)
  try {
    const adminPositions = await bags.getClaimablePositions(
      bags.keypair.publicKey
    );

    for (const mint of uniqueMints) {
      const positions = adminPositions.filter((p) => p.baseMint === mint);
      const claimable = positions.reduce(
        (sum, p) => sum + BigInt(p.totalClaimableLamportsUserShare),
        0n
      );
      if (claimable === 0n) continue;

      log(
        `[fee-claim] Admin has ${formatSol(Number(claimable))} claimable on ${mint.slice(0, 8)}`
      );

      try {
        const sigs = await bags.claimFees(mint);
        if (sigs.length === 0) continue;

        results.push({
          tokenMint: mint,
          claimedLamports: claimable,
          signatures: sigs,
          source: "admin",
        });
        totalClaimed += claimable;

        log(
          `[fee-claim] Claimed ${formatSol(Number(claimable))} from admin for ${mint.slice(0, 8)} (${sigs.length} tx)`
        );
      } catch (err) {
        logError(`[fee-claim] Admin claim failed for ${mint.slice(0, 8)}:`, err);
      }
    }
  } catch (err) {
    logError("[fee-claim] Failed to check admin positions:", err);
  }

  // 2. Try claiming from service wallets (legacy fee-share config)
  const serviceWallets = (state.walletPool ?? []).filter((w) => w.assignedTo);
  for (const wallet of serviceWallets) {
    const assignedMint = wallet.assignedTo?.split(":")[1];
    if (!assignedMint || !uniqueMints.includes(assignedMint)) continue;

    // Skip if we already claimed this mint from admin
    if (results.some((r) => r.tokenMint === assignedMint)) continue;

    try {
      const kp = loadKeypair(wallet.secretKey);
      const positions = await bags.getClaimablePositions(kp.publicKey);
      const tokenPositions = positions.filter(
        (p) => p.baseMint === assignedMint
      );
      const claimable = tokenPositions.reduce(
        (sum, p) => sum + BigInt(p.totalClaimableLamportsUserShare),
        0n
      );
      if (claimable === 0n) continue;

      log(
        `[fee-claim] Service wallet has ${formatSol(Number(claimable))} claimable on ${assignedMint.slice(0, 8)}`
      );

      const sigs = await bags.claimFees(assignedMint, kp);

      // Sweep: transfer claimed SOL from service wallet to admin
      const { SystemProgram, Transaction, ComputeBudgetProgram } =
        await import("@solana/web3.js");
      const balance = BigInt(
        await bags.connection.getBalance(kp.publicKey)
      );
      const reserve = 5_000_000n; // keep 0.005 SOL for rent
      const sweepable = balance - reserve;
      if (sweepable > 0n) {
        const tx = new Transaction();
        tx.add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 20_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
          SystemProgram.transfer({
            fromPubkey: kp.publicKey,
            toPubkey: bags.keypair.publicKey,
            lamports: Number(sweepable),
          })
        );
        const { blockhash, lastValidBlockHeight } =
          await bags.connection.getLatestBlockhash("confirmed");
        tx.recentBlockhash = blockhash;
        tx.feePayer = kp.publicKey;
        tx.sign(kp);
        const sweepSig = await bags.connection.sendRawTransaction(
          tx.serialize(),
          { skipPreflight: false, maxRetries: 3 }
        );
        await bags.connection.confirmTransaction(
          { signature: sweepSig, blockhash, lastValidBlockHeight },
          "confirmed"
        );
        sigs.push(sweepSig);
        log(
          `[fee-claim] Swept ${formatSol(Number(sweepable))} from service wallet to admin`
        );
      }

      results.push({
        tokenMint: assignedMint,
        claimedLamports: claimable,
        signatures: sigs,
        source: "service-wallet",
      });
      totalClaimed += claimable;
    } catch (err) {
      logError(
        `[fee-claim] Service wallet claim failed for ${assignedMint?.slice(0, 8)}:`,
        err
      );
    }
  }

  // 3. Update campaign pools with claimed fees
  if (results.length > 0) {
    await withStateLock(async (s) => {
      for (const claim of results) {
        const campaigns = (s.campaigns ?? []).filter(
          (c) =>
            c.tokenMint === claim.tokenMint &&
            (c.status === "live" || c.status === "depleted")
        );
        if (campaigns.length === 0) continue;

        // Split fees proportionally across campaigns on this mint
        const perCampaign = claim.claimedLamports / BigInt(campaigns.length);
        if (perCampaign === 0n) continue;

        for (const c of campaigns) {
          const prevCap = BigInt(c.poolCapLamports);
          c.poolCapLamports = (prevCap + perCampaign).toString();
          c.feesClaimedLamports = (
            BigInt(c.feesClaimedLamports ?? "0") + perCampaign
          ).toString();
          c.feeClaimCount = (c.feeClaimCount ?? 0) + 1;
          c.lastFeeClaimAt = Date.now();

          // Un-deplete if pool grew past spent
          if (
            c.status === "depleted" &&
            BigInt(c.poolCapLamports) > BigInt(c.poolSpentLamports)
          ) {
            c.status = "live";
            log(
              `[fee-claim] Campaign ${c.type} on ${claim.tokenMint.slice(0, 8)} revived by fee income`
            );
          }
        }
      }
    });

    log(
      `[fee-claim] Total claimed: ${formatSol(Number(totalClaimed))} across ${results.length} token(s)`
    );
  }

  return { results, totalClaimedLamports: totalClaimed };
}
