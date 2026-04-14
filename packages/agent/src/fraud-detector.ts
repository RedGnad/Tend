import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import { PublicKey } from "@solana/web3.js";
import type { BagsClient, Campaign, FraudDecision } from "@tend/shared";
import { log, logError } from "./logger.js";
import { loadState } from "./state-reader.js";

/**
 * Fraud / sybil gate for the rewards distributor.
 *
 * Runs BEFORE accrual — rejected swaps never touch the pool. Every decision
 * (allow / reject / hold) is persisted to state.fraudDecisions for audit.
 *
 * Model: Claude Haiku 4.5. Structured output via Zod.
 * Fallback: any failure (network, parse, timeout) returns HOLD, never auto-allow.
 *
 * Action space (bounded):
 *   - allow  → proceed to accrual
 *   - reject → drop, no pool debit, logged with reasoning
 *   - hold   → pending manual review (dashboard / MCP)
 */

const MODEL = "claude-haiku-4-5-20251001";
const ANTHROPIC_TIMEOUT_MS = 8_000;

const DecisionSchema = z.object({
  decision: z.enum(["allow", "reject", "hold"]),
  reasoning: z.string().min(1).max(400),
  flags: z.array(z.string()).max(6),
});

const SYSTEM_PROMPT = `You are the fraud gate for Tend, a consumer rewards program that pays real SOL cashback to traders who buy Bags creator tokens during live campaigns. Your job: for each detected buy, decide whether to allow, reject, or hold the payout.

Action space (strict):
- allow:  normal organic trader → pay the cashback
- reject: strong sybil / wash trading evidence → drop, pool is not debited
- hold:   ambiguous / insufficient signal → human reviews via dashboard

Reject signals (any one strong enough):
- Wallet created in the last 1h with no prior on-chain history
- Zero other token interactions (fresh gas-funded wallet spinning up just for this)
- Pattern: trader already received multiple Tend payouts on this same campaign in the last hour (farming)
- Swap amount suspiciously close to the minimum threshold repeatedly

Allow signals:
- Wallet age > 7 days, > 20 total txs, normal browsing pattern
- Swap amount is organic-looking (not exact round-number patterns)
- Has interacted with other Bags / Solana DEXs before

Hold signals:
- Wallet is new but has some legitimate activity (e.g. 1-3 days old, few txs)
- Contradictory signals

Be decisive. Be cheap on tokens. Return only valid JSON matching the schema.`;

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logError("[fraud] ANTHROPIC_API_KEY missing — gate will HOLD all payouts");
    return null;
  }
  client = new Anthropic({ apiKey });
  return client;
}

interface WalletContext {
  walletAgeHours: number | null;
  txCount: number | null;
  priorTendPayouts: number;
}

/**
 * Fetch lightweight wallet context (age, tx count) via Solana RPC.
 * Caps at 100 sigs to keep this cheap. Returns nulls on failure — the model
 * handles partial inputs and will tend to HOLD when it can't read the wallet.
 */
async function fetchWalletContext(
  bags: BagsClient,
  traderWallet: string,
  tokenMint: string
): Promise<WalletContext> {
  const ctx: WalletContext = {
    walletAgeHours: null,
    txCount: null,
    priorTendPayouts: 0,
  };

  try {
    const pubkey = new PublicKey(traderWallet);
    const sigs = await bags.connection.getSignaturesForAddress(
      pubkey,
      { limit: 100 },
      "confirmed"
    );
    ctx.txCount = sigs.length;
    const oldest = sigs.reduce<number | null>((min, s) => {
      if (!s.blockTime) return min;
      if (min === null) return s.blockTime;
      return s.blockTime < min ? s.blockTime : min;
    }, null);
    if (oldest !== null) {
      const ageMs = Date.now() - oldest * 1000;
      ctx.walletAgeHours = Math.floor(ageMs / (60 * 60 * 1000));
    }
  } catch (err) {
    log(
      `[fraud] wallet context fetch failed for ${traderWallet.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Count prior Tend payouts for this wallet on this campaign
  try {
    const state = await loadState();
    const priors = (state?.rewardPayouts ?? []).filter(
      (p) => p.traderWallet === traderWallet && p.tokenMint === tokenMint
    );
    ctx.priorTendPayouts = priors.length;
  } catch { /* loadState already logs */ }

  return ctx;
}

function makeDecisionId(swapTxSig: string, traderWallet: string): string {
  return `${swapTxSig.slice(0, 16)}-${traderWallet.slice(0, 8)}`;
}

function buildUserMessage(
  campaign: Campaign,
  traderWallet: string,
  solSpentLamports: bigint,
  ctx: WalletContext
): string {
  const symbol = campaign.tokenInfo?.symbol ?? campaign.tokenMint.slice(0, 4);
  const solSpent = (Number(solSpentLamports) / 1_000_000_000).toFixed(6);
  const ageStr =
    ctx.walletAgeHours === null
      ? "unknown"
      : ctx.walletAgeHours < 24
        ? `${ctx.walletAgeHours}h`
        : `${Math.floor(ctx.walletAgeHours / 24)}d`;
  const txStr = ctx.txCount === null ? "unknown" : `${ctx.txCount}`;

  return `Campaign $${symbol} (cashback ${(campaign.cashbackBps / 100).toFixed(1)}%).
Trader ${traderWallet.slice(0, 6)}..${traderWallet.slice(-4)} bought for ${solSpent} SOL.
Wallet age: ${ageStr}. On-chain tx count: ${txStr}. Prior Tend payouts on this campaign: ${ctx.priorTendPayouts}.
Decide: allow, reject, or hold.`;
}

/**
 * Main gate entry point. Returns the FraudDecision record (also persisted).
 * On any failure → HOLD (fail-closed for money, never auto-allow).
 */
export async function checkFraud(
  bags: BagsClient,
  campaign: Campaign,
  buy: {
    signature: string;
    traderWallet: string;
    solSpentLamports: bigint;
  }
): Promise<FraudDecision> {
  const id = makeDecisionId(buy.signature, buy.traderWallet);

  // Idempotent: if we already decided on this swap, return the cached decision
  const existingState = await loadState();
  const prior = (existingState?.fraudDecisions ?? []).find((d) => d.id === id);
  if (prior) {
    log(`[fraud] Cached decision for ${id}: ${prior.decision}`);
    return prior;
  }

  const walletContext = await fetchWalletContext(
    bags,
    buy.traderWallet,
    campaign.tokenMint
  );

  const anthropic = getClient();

  // No API key / fallback → HOLD
  if (!anthropic) {
    return {
      id,
      tokenMint: campaign.tokenMint,
      traderWallet: buy.traderWallet,
      swapTxSig: buy.signature,
      swapVolumeLamports: buy.solSpentLamports.toString(),
      decision: "hold",
      reasoning: "AI gate offline (no API key) — held for manual review",
      flags: ["api_offline"],
      model: "fallback",
      checkedAt: Date.now(),
      walletContext,
    };
  }

  const userMessage = buildUserMessage(
    campaign,
    buy.traderWallet,
    buy.solSpentLamports,
    walletContext
  );

  log(
    `[fraud] Checking swap ${buy.signature.slice(0, 10)} trader=${buy.traderWallet.slice(0, 6)} age=${walletContext.walletAgeHours}h txs=${walletContext.txCount} priors=${walletContext.priorTendPayouts}`
  );

  try {
    const response = await Promise.race([
      anthropic.messages.parse({
        model: MODEL,
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
        output_config: {
          format: zodOutputFormat(DecisionSchema as any),
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("fraud check timeout")),
          ANTHROPIC_TIMEOUT_MS
        )
      ),
    ]);

    const parsed = (response as any).parsed_output;
    if (!parsed) throw new Error("no parsed output");

    const decision: FraudDecision = {
      id,
      tokenMint: campaign.tokenMint,
      traderWallet: buy.traderWallet,
      swapTxSig: buy.signature,
      swapVolumeLamports: buy.solSpentLamports.toString(),
      decision: parsed.decision,
      reasoning: parsed.reasoning,
      flags: parsed.flags ?? [],
      model: MODEL,
      checkedAt: Date.now(),
      walletContext,
    };

    log(
      `[fraud] → ${decision.decision.toUpperCase()} — ${decision.reasoning}`
    );
    return decision;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError(`[fraud] Check failed: ${msg}`);
    return {
      id,
      tokenMint: campaign.tokenMint,
      traderWallet: buy.traderWallet,
      swapTxSig: buy.signature,
      swapVolumeLamports: buy.solSpentLamports.toString(),
      decision: "hold",
      reasoning: `Gate error (${msg.slice(0, 80)}) — held for manual review`,
      flags: ["gate_error"],
      model: MODEL,
      checkedAt: Date.now(),
      walletContext,
    };
  }
}
