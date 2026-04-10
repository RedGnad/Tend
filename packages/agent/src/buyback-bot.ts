import { PublicKey } from "@solana/web3.js";
import type { BagsClient, ActiveService, AgentDecision, MarketSnapshot, TendState } from "@tend/shared";
import { WSOL_MINT_STR, loadKeypair, formatSol, LAMPORTS_PER_SOL } from "@tend/shared";
import { getServiceWallet, loadState } from "./state-reader.js";
import { getAdvisorDecision } from "./ai-advisor.js";
import { saveDecision } from "./decision-store.js";
import { log, logError } from "./logger.js";

// Default config
const DEFAULT_MIN_CLAIM_LAMPORTS = 1_000_000; // 0.001 SOL
const SWAP_FEE_BUFFER_LAMPORTS = 100_000; // 0.0001 SOL reserved for swap tx fees
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes

// Track last buy time per token (in-memory, resets on restart)
const lastBuyTime = new Map<string, number>();

export interface BuybackResult {
  tokenMint: string;
  claimed: boolean;
  claimAmount: number;
  swapped: boolean;
  swapSignature?: string;
  tokensBought?: number;
  decision?: AgentDecision;
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

    // Check cooldown
    const cooldownMs =
      (service.config.cooldownMs as number) ?? DEFAULT_COOLDOWN_MS;
    const lastBuy = lastBuyTime.get(tokenMint) ?? 0;
    if (Date.now() - lastBuy < cooldownMs) {
      log(`[buyback] Cooldown active, skipping (${Math.round((cooldownMs - (Date.now() - lastBuy)) / 1000)}s remaining)`);
      return result;
    }

    log(`[buyback] Claiming ${formatSol(totalClaimable)}...`);

    // Step 1: Claim fees
    const claimSigs = await bags.claimFees(tokenMint, serviceKeypair);
    result.claimed = true;
    result.claimAmount = totalClaimable;

    log(
      `[buyback] Claimed ${formatSol(totalClaimable)} in ${claimSigs.length} tx(s)`
    );

    // Step 2: Collect market snapshot
    const snapshot = await collectMarketSnapshot(
      bags,
      tokenMint,
      serviceWallet,
      totalClaimable
    );

    // Step 3: Get AI decision
    let tokenSymbol = tokenMint.slice(0, 6);
    try {
      const meta = await bags.getTokenMetadata(tokenMint);
      if (meta) tokenSymbol = meta.symbol;
    } catch { /* use truncated mint */ }

    const aiDecision = await getAdvisorDecision(snapshot, tokenSymbol, tokenMint);

    // Build decision log entry
    const decision: AgentDecision = {
      timestamp: Date.now(),
      tokenMint,
      serviceId: service.serviceId,
      inputs: snapshot,
      decision: aiDecision,
      execution: { executed: false },
    };

    // Step 4: Execute the decision
    if (aiDecision.action === "hold") {
      log(`[buyback] AI decided to HOLD — ${aiDecision.reasoning}`);
      decision.execution = { executed: false };
    } else {
      const pct = aiDecision.amount_pct;
      const swapBase = totalClaimable - SWAP_FEE_BUFFER_LAMPORTS;

      if (swapBase <= 0) {
        log(`[buyback] Claimed amount too small to swap after fee buffer`);
        decision.execution = {
          executed: false,
          error: "Amount too small after fee buffer",
        };
      } else {
        const swapAmount = Math.floor((swapBase * pct) / 100);

        if (swapAmount <= 0) {
          decision.execution = {
            executed: false,
            error: "Calculated swap amount is zero",
          };
        } else {
          // Get token balance before swap
          const mintPk = new PublicKey(tokenMint);
          const tokenAccountsBefore =
            await bags.connection.getParsedTokenAccountsByOwner(serviceWallet, {
              mint: mintPk,
            });
          const tokensBefore =
            tokenAccountsBefore.value.length > 0
              ? tokenAccountsBefore.value[0].account.data.parsed.info
                  .tokenAmount.uiAmount ?? 0
              : 0;

          log(
            `[buyback] AI: ${aiDecision.action} ${pct}% — swapping ${formatSol(swapAmount)} SOL → ${tokenSymbol}`
          );

          // Execute swap
          const { signature } = await bags.executeSwap(
            WSOL_MINT_STR,
            tokenMint,
            swapAmount,
            serviceKeypair
          );

          await bags.connection.confirmTransaction(signature, "confirmed");

          // Measure tokens received
          const tokenAccountsAfter =
            await bags.connection.getParsedTokenAccountsByOwner(serviceWallet, {
              mint: mintPk,
            });
          const tokensAfter =
            tokenAccountsAfter.value.length > 0
              ? tokenAccountsAfter.value[0].account.data.parsed.info
                  .tokenAmount.uiAmount ?? 0
              : 0;

          result.swapped = true;
          result.swapSignature = signature;
          result.tokensBought = tokensAfter - tokensBefore;

          decision.execution = {
            executed: true,
            tx_signature: signature,
            amount_lamports: swapAmount,
            tokens_bought: result.tokensBought,
          };

          lastBuyTime.set(tokenMint, Date.now());

          log(
            `[buyback] Buyback complete! ${result.tokensBought.toFixed(2)} tokens bought, sig=${signature.slice(0, 16)}...`
          );
        }
      }
    }

    // Step 5: Persist decision log
    result.decision = decision;
    await saveDecision(decision);
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    logError(`[buyback] ${tokenMint.slice(0, 8)}...`, result.error);
  }

  return result;
}

async function collectMarketSnapshot(
  bags: BagsClient,
  tokenMint: string,
  serviceWallet: PublicKey,
  claimableLamports: number
): Promise<MarketSnapshot> {
  // Gather data in parallel where possible
  const [lifetimeFees, walletBalance, creators, state] = await Promise.all([
    bags.getTokenLifetimeFees(tokenMint).catch(() => 0),
    bags.connection.getBalance(serviceWallet).catch(() => 0),
    bags.getTokenCreators(tokenMint).catch(() => []),
    loadState(),
  ]);

  // Get price via a quote for 1 SOL
  let priceSol = 0;
  try {
    const quote = await bags.getQuote(WSOL_MINT_STR, tokenMint, LAMPORTS_PER_SOL);
    // Bags tokens use 6 decimals by default
    const tokensPerSol = Number(quote.outAmount) / 1e6;
    if (tokensPerSol > 0) priceSol = 1 / tokensPerSol;
  } catch { /* price unavailable */ }

  // Compute price delta from last decision's snapshot
  let priceDeltaPct: number | undefined;
  if (priceSol > 0 && state) {
    const prevDecisions = (state.decisions ?? [])
      .filter((d: AgentDecision) => d.tokenMint === tokenMint && d.inputs.price_sol > 0);
    if (prevDecisions.length > 0) {
      const prevPrice = prevDecisions[prevDecisions.length - 1].inputs.price_sol;
      priceDeltaPct = ((priceSol - prevPrice) / prevPrice) * 100;
    }
  }

  // Fee velocity heuristic based on lifetime fees
  const lifetimeFeeSol = lifetimeFees / LAMPORTS_PER_SOL;
  let feeVelocity: MarketSnapshot["fee_velocity"] = "none";
  if (lifetimeFeeSol > 1) feeVelocity = "high";
  else if (lifetimeFeeSol > 0.1) feeVelocity = "medium";
  else if (lifetimeFeeSol > 0.01) feeVelocity = "low";

  return {
    price_sol: priceSol,
    price_delta_pct: priceDeltaPct,
    volume_24h_sol: 0, // Not available via BagsClient — set to 0
    lifetime_fees_sol: lifetimeFeeSol,
    claimable_sol: claimableLamports / LAMPORTS_PER_SOL,
    wallet_balance_sol: walletBalance / LAMPORTS_PER_SOL,
    holders: creators.length, // creator count as proxy — holders not available from SDK
    fee_velocity: feeVelocity,
  };
}
