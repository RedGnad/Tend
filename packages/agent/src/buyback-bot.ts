import { PublicKey } from "@solana/web3.js";
import type { BagsClient, ActiveService } from "@tend/shared";
import { WSOL_MINT_STR, loadKeypair, formatSol } from "@tend/shared";
import { getServiceWallet } from "./state-reader.js";
import { log, logError } from "./logger.js";

// Default config
const DEFAULT_MIN_CLAIM_LAMPORTS = 1_000_000; // 0.001 SOL
const SWAP_FEE_BUFFER_LAMPORTS = 100_000; // 0.0001 SOL reserved for swap tx fees

export interface BuybackResult {
  tokenMint: string;
  claimed: boolean;
  claimAmount: number;
  swapped: boolean;
  swapSignature?: string;
  tokensBought?: number;
  error?: string;
}

export async function runBuyback(
  bags: BagsClient,
  tokenMint: string,
  service: ActiveService
): Promise<BuybackResult> {
  const result: BuybackResult = {
    tokenMint,
    claimed: false,
    claimAmount: 0,
    swapped: false,
  };

  try {
    // Get the service wallet
    const walletEntry = await getServiceWallet(service.serviceId, tokenMint);
    if (!walletEntry) {
      result.error = "Service wallet not found";
      return result;
    }

    const serviceKeypair = loadKeypair(walletEntry.secretKey);
    const serviceWallet = serviceKeypair.publicKey;

    log(
      `[buyback] Checking ${tokenMint.slice(0, 8)}... wallet=${serviceWallet.toBase58().slice(0, 8)}...`
    );

    // Check claimable fees
    const positions = await bags.getClaimablePositions(serviceWallet);
    const tokenPositions = positions.filter(
      (p) => p.baseMint === tokenMint
    );

    if (tokenPositions.length === 0) {
      log(`[buyback] No claimable positions for ${tokenMint.slice(0, 8)}...`);
      return result;
    }

    const totalClaimable = tokenPositions.reduce(
      (sum, p) => sum + p.totalClaimableLamportsUserShare,
      0
    );

    const minClaim =
      (service.config.minClaimLamports as number) ??
      DEFAULT_MIN_CLAIM_LAMPORTS;

    if (totalClaimable < minClaim) {
      log(
        `[buyback] Claimable ${formatSol(totalClaimable)} below threshold ${formatSol(minClaim)}`
      );
      return result;
    }

    log(`[buyback] Claiming ${formatSol(totalClaimable)}...`);

    // Claim fees
    const claimSigs = await bags.claimFees(tokenMint, serviceKeypair);
    result.claimed = true;
    result.claimAmount = totalClaimable;

    log(
      `[buyback] Claimed ${formatSol(totalClaimable)} in ${claimSigs.length} tx(s)`
    );

    // Swap the claimed amount minus a small buffer for tx fees
    const swapAmount = totalClaimable - SWAP_FEE_BUFFER_LAMPORTS;

    if (swapAmount <= 0) {
      log(`[buyback] Claimed amount too small to swap after fee buffer`);
      return result;
    }

    // Get token balance before swap to measure bought amount
    const mintPk = new PublicKey(tokenMint);
    const tokenAccountsBefore = await bags.connection.getParsedTokenAccountsByOwner(
      serviceWallet,
      { mint: mintPk }
    );
    const tokensBefore = tokenAccountsBefore.value.length > 0
      ? tokenAccountsBefore.value[0].account.data.parsed.info.tokenAmount.uiAmount ?? 0
      : 0;

    // Execute buyback: SOL → token
    log(
      `[buyback] Swapping ${formatSol(swapAmount)} SOL → ${tokenMint.slice(0, 8)}...`
    );

    const { signature } = await bags.executeSwap(
      WSOL_MINT_STR,
      tokenMint,
      swapAmount,
      serviceKeypair
    );

    // Confirm the swap
    await bags.connection.confirmTransaction(signature, "confirmed");

    // Measure tokens received
    const tokenAccountsAfter = await bags.connection.getParsedTokenAccountsByOwner(
      serviceWallet,
      { mint: mintPk }
    );
    const tokensAfter = tokenAccountsAfter.value.length > 0
      ? tokenAccountsAfter.value[0].account.data.parsed.info.tokenAmount.uiAmount ?? 0
      : 0;

    result.swapped = true;
    result.swapSignature = signature;
    result.tokensBought = tokensAfter - tokensBefore;

    log(
      `[buyback] Buyback complete! ${result.tokensBought.toFixed(2)} tokens bought, sig=${signature.slice(0, 16)}...`
    );
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    logError(`[buyback] ${tokenMint.slice(0, 8)}...`, result.error);
  }

  return result;
}
