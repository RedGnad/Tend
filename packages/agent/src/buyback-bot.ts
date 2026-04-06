import { Keypair, PublicKey } from "@solana/web3.js";
import type { BagsClient, ActiveService } from "@tend/shared";
import { WSOL_MINT_STR, loadKeypair, formatSol, lamportsToSol } from "@tend/shared";
import { getServiceWallet } from "./state-reader.js";
import { log, logError } from "./logger.js";

// Default config
const DEFAULT_MIN_CLAIM_LAMPORTS = 10_000_000; // 0.01 SOL
const MIN_SOL_FOR_TX_FEES = 5_000_000; // 0.005 SOL

export interface BuybackResult {
  tokenMint: string;
  claimed: boolean;
  claimAmount: number;
  swapped: boolean;
  swapSignature?: string;
  tokensBought?: string;
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

    // Check balance for swap
    const balance = await bags.connection.getBalance(serviceWallet);
    const swapAmount = balance - MIN_SOL_FOR_TX_FEES;

    if (swapAmount <= 0) {
      log(`[buyback] Insufficient balance for swap after fees`);
      return result;
    }

    // Execute buyback: SOL → token
    log(
      `[buyback] Swapping ${formatSol(swapAmount)} SOL → ${tokenMint.slice(0, 8)}...`
    );

    const { signature, result: swapResult } = await bags.executeSwap(
      WSOL_MINT_STR,
      tokenMint,
      swapAmount,
      serviceKeypair
    );

    result.swapped = true;
    result.swapSignature = signature;
    result.tokensBought = swapResult.transaction ? "confirmed" : "pending";

    log(
      `[buyback] Buyback complete! sig=${signature.slice(0, 16)}...`
    );
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    logError(`[buyback] ${tokenMint.slice(0, 8)}...`, result.error);
  }

  return result;
}
