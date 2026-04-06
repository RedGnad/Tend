import type { BagsClient, ActiveService } from "@tend/shared";
import { loadKeypair, formatSol } from "@tend/shared";
import { getServiceWallet } from "./state-reader.js";
import { log, logError } from "./logger.js";

export interface ClaimResult {
  tokenMint: string;
  serviceId: string;
  claimed: boolean;
  amount: number;
  signatures: string[];
  error?: string;
}

export async function runFeeClaim(
  bags: BagsClient,
  tokenMint: string,
  service: ActiveService
): Promise<ClaimResult> {
  const result: ClaimResult = {
    tokenMint,
    serviceId: service.serviceId,
    claimed: false,
    amount: 0,
    signatures: [],
  };

  try {
    const walletEntry = await getServiceWallet(service.serviceId, tokenMint);
    if (!walletEntry) {
      result.error = "Service wallet not found";
      return result;
    }

    const serviceKeypair = loadKeypair(walletEntry.secretKey);

    // Check claimable
    const positions = await bags.getClaimablePositions(
      serviceKeypair.publicKey
    );
    const tokenPositions = positions.filter(
      (p) => p.baseMint === tokenMint
    );

    if (tokenPositions.length === 0) return result;

    const totalClaimable = tokenPositions.reduce(
      (sum, p) => sum + p.totalClaimableLamportsUserShare,
      0
    );

    if (totalClaimable === 0) return result;

    log(
      `[claim] ${service.serviceId} on ${tokenMint.slice(0, 8)}...: ${formatSol(totalClaimable)} claimable`
    );

    const signatures = await bags.claimFees(tokenMint, serviceKeypair);
    result.claimed = true;
    result.amount = totalClaimable;
    result.signatures = signatures;

    log(
      `[claim] Claimed ${formatSol(totalClaimable)} for ${service.serviceId}`
    );
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    logError(
      `[claim] ${service.serviceId} on ${tokenMint.slice(0, 8)}...`,
      result.error
    );
  }

  return result;
}
