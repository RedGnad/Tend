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

const SYSTEM_PROMPT = `You are the fraud gate for Tend, a consumer rewards program that pays real SOL to users participating in live Bags creator-token campaigns. Each campaign is one of: cashback (reward per buy), holder dividends (pro-rata per snapshot to eligible holders), launch sprint (bonus to first real buyers). Your job: for each eligible wallet, decide whether to allow, reject, or hold the payout.

Action space (strict):
- allow:  organic participant → pay the reward
- reject: strong sybil / wash / farm evidence → drop, pool is not debited
- hold:   ambiguous / insufficient signal → human reviews via dashboard

Reject signals (any one strong enough):
- Wallet created in the last 1h with no prior on-chain history
- Zero other token interactions (fresh gas-funded wallet spinning up just for this)
- Multiple payouts in the last hour from brand-new wallets (< 7 days) — classic sybil
- For swaps: amount suspiciously close to the minimum threshold repeatedly
- For holders: hold duration is exactly the campaign minimum + wallet is brand new (snipe pattern)

Important: a well-established wallet (> 30 days, > 50 txs) receiving several payouts over days/weeks is NORMAL organic usage, not farming. Only flag repeated payouts as farming when the wallet is new or the payouts cluster within minutes/hours.

Allow signals:
- Wallet age > 7 days, > 20 total txs, normal browsing pattern
- Swap amount or balance looks organic (not exact round-number patterns)
- Has interacted with other Bags / Solana DEXs before
- Holder: hold duration well above the campaign minimum, wallet has history

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
  tokenMint: string,
  campaignType?: string
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
      (p) => p.traderWallet === traderWallet && p.tokenMint === tokenMint && (!campaignType || p.campaignType === campaignType)
    );
    ctx.priorTendPayouts = priors.length;
  } catch { /* loadState already logs */ }

  return ctx;
}

function makeDecisionId(swapTxSig: string, traderWallet: string): string {
  return `${swapTxSig.slice(0, 16)}-${traderWallet.slice(0, 8)}`;
}

function describeCampaign(campaign: Campaign): string {
  const symbol = campaign.tokenInfo?.symbol ?? campaign.tokenMint.slice(0, 4);
  switch (campaign.type) {
    case "cashback":
      return `$${symbol} (cashback ${(campaign.config.cashbackBps / 100).toFixed(1)}%)`;
    case "holder":
      return `$${symbol} (holder dividends ${(campaign.config.rewardBps / 100).toFixed(1)}%)`;
    case "sprint":
      return `$${symbol} (launch sprint)`;
  }
}

function buildUserMessage(
  campaign: Campaign,
  event: FraudEvent,
  ctx: WalletContext
): string {
  const ageStr =
    ctx.walletAgeHours === null
      ? "unknown"
      : ctx.walletAgeHours < 24
        ? `${ctx.walletAgeHours}h`
        : `${Math.floor(ctx.walletAgeHours / 24)}d`;
  const txStr = ctx.txCount === null ? "unknown" : `${ctx.txCount}`;
  const walletShort = `${event.traderWallet.slice(0, 6)}..${event.traderWallet.slice(-4)}`;

  let action: string;
  if (event.kind === "holder") {
    const holdHours =
      event.holdHours === null ? "unknown" : `${event.holdHours}h`;
    action = `Holder ${walletShort} has held the token for ${holdHours} and is eligible for this snapshot's pro-rata dividend. Wallet age: ${ageStr}. On-chain tx count: ${txStr}. Prior Tend payouts on this campaign: ${ctx.priorTendPayouts}.`;
  } else {
    const solSpent = (
      Number(event.solSpentLamports) / 1_000_000_000
    ).toFixed(6);
    action = `Trader ${walletShort} bought for ${solSpent} SOL. Wallet age: ${ageStr}. On-chain tx count: ${txStr}. Prior Tend payouts on this campaign: ${ctx.priorTendPayouts}.`;
  }

  return `Campaign ${describeCampaign(campaign)}.
${action}
Decide: allow, reject, or hold.`;
}

/**
 * Discriminated fraud event. Swap kind carries SOL spent; holder kind carries
 * hold duration. Both flow through the same gate for a unified audit trail.
 */
export type FraudEvent =
  | {
      kind: "swap";
      signature: string;
      traderWallet: string;
      solSpentLamports: bigint;
    }
  | {
      kind: "holder";
      /** Synthetic id unique per (campaign, snapshot, wallet). */
      signature: string;
      traderWallet: string;
      /** Holder's raw token balance at snapshot time (metadata for payout). */
      balanceRaw: bigint;
      /** Hours the wallet has held the token (null if unknown). */
      holdHours: number | null;
    };

/**
 * Main gate entry point. Returns the FraudDecision record (also persisted).
 * On any failure → HOLD (fail-closed for money, never auto-allow).
 */
export async function checkFraud(
  bags: BagsClient,
  campaign: Campaign,
  event: FraudEvent
): Promise<FraudDecision> {
  const id = makeDecisionId(event.signature, event.traderWallet);
  const volumeLamports =
    event.kind === "swap"
      ? event.solSpentLamports.toString()
      : event.balanceRaw.toString();

  // Idempotent: if we already decided on this swap, return the cached decision
  const existingState = await loadState();
  const prior = (existingState?.fraudDecisions ?? []).find((d) => d.id === id);
  if (prior) {
    log(`[fraud] Cached decision for ${id}: ${prior.decision}`);
    return prior;
  }

  const walletContext = await fetchWalletContext(
    bags,
    event.traderWallet,
    campaign.tokenMint,
    campaign.type
  );

  const anthropic = getClient();

  // No API key / fallback → HOLD
  if (!anthropic) {
    return {
      id,
      tokenMint: campaign.tokenMint,
      campaignType: campaign.type,
      traderWallet: event.traderWallet,
      swapTxSig: event.signature,
      swapVolumeLamports: volumeLamports,
      decision: "hold",
      reasoning: "AI gate offline (no API key) — held for manual review",
      flags: ["api_offline"],
      model: "fallback",
      checkedAt: Date.now(),
      walletContext,
    };
  }

  const userMessage = buildUserMessage(campaign, event, walletContext);

  log(
    `[fraud] Checking ${event.kind} ${event.signature.slice(0, 10)} trader=${event.traderWallet.slice(0, 6)} age=${walletContext.walletAgeHours}h txs=${walletContext.txCount} priors=${walletContext.priorTendPayouts}`
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
      campaignType: campaign.type,
      traderWallet: event.traderWallet,
      swapTxSig: event.signature,
      swapVolumeLamports: volumeLamports,
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
      campaignType: campaign.type,
      traderWallet: event.traderWallet,
      swapTxSig: event.signature,
      swapVolumeLamports: volumeLamports,
      decision: "hold",
      reasoning: `Gate error (${msg.slice(0, 80)}) — held for manual review`,
      flags: ["gate_error"],
      model: MODEL,
      checkedAt: Date.now(),
      walletContext,
    };
  }
}
