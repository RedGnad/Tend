#!/usr/bin/env node

import { createServer } from "node:http";
import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  BagsClient,
  loadKeypair,
  TEND_STATE_DIR,
  TEND_STATE_FILE,
  verifyWalletSignature,
  parseAuthMessage,
  isTimestampFresh,
  type SpendingPeriod,
} from "@tend/shared";
import type { Campaign, CampaignDeposit, CampaignType } from "@tend/shared";
import {
  buildProvisionPrepare,
  persistProvisionCommit,
} from "./squads-orchestrator.js";
import {
  SystemProgram,
  Transaction,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import bs58 from "bs58";
import {
  ADMIN_MIN_RESERVE_LAMPORTS,
  resolveAgentKey,
} from "./payout-executor.js";
import { Scheduler } from "./scheduler.js";
import { withStateLock } from "./state-lock.js";
import { verifyDepositTx } from "./deposit-verifier.js";
import { log, logError } from "./logger.js";
import { getTreasuryHealth } from "./treasury-health.js";
import { alert } from "./alerter.js";
import type { IncomingMessage } from "node:http";

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
    if (chunks.reduce((s, c) => s + c.length, 0) > 32_768) {
      throw new Error("Request body too large");
    }
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON body");
  }
}

interface MutationBody {
  type?: string;
  message?: string;
  signature?: string;
  publicKey?: string;
}

interface MutationResult {
  status: number;
  body: Record<string, unknown>;
}

async function handleCampaignMutation(
  mint: string,
  action: "pause" | "resume",
  raw: unknown
): Promise<MutationResult> {
  const body = raw as MutationBody;
  const { type, message, signature, publicKey } = body;

  if (!type || !message || !signature || !publicKey) {
    return {
      status: 400,
      body: { error: "Missing fields: type, message, signature, publicKey" },
    };
  }

  const parsed = parseAuthMessage(message);
  if (!parsed) {
    return { status: 400, body: { error: "Malformed auth message" } };
  }
  if (parsed.action !== action) {
    return { status: 400, body: { error: "Action mismatch with message" } };
  }
  if (parsed.mint !== mint) {
    return { status: 400, body: { error: "Mint mismatch with message" } };
  }
  if (parsed.type !== type) {
    return { status: 400, body: { error: "Type mismatch with message" } };
  }
  if (!isTimestampFresh(parsed.timestampMs)) {
    return { status: 401, body: { error: "Auth message expired" } };
  }
  if (!verifyWalletSignature(message, signature, publicKey)) {
    return { status: 401, body: { error: "Invalid signature" } };
  }

  type Outcome =
    | { ok: true; status: string }
    | { ok: false; httpStatus: number; error: string };
  const outcomeRef: { current: Outcome } = {
    current: { ok: false, httpStatus: 500, error: "unknown" },
  };

  await withStateLock((s) => {
    const c = (s.campaigns ?? []).find(
      (x) => x.tokenMint === mint && x.type === type
    );
    if (!c) {
      outcomeRef.current = { ok: false, httpStatus: 404, error: "Campaign not found" };
      return;
    }
    if (c.creatorWallet !== publicKey) {
      outcomeRef.current = {
        ok: false,
        httpStatus: 403,
        error: "Signer is not the campaign creator",
      };
      return;
    }

    if (action === "pause") {
      if (c.status === "paused") {
        outcomeRef.current = { ok: true, status: c.status };
        return;
      }
      c.status = "paused";
    } else {
      if (c.status === "live") {
        outcomeRef.current = { ok: true, status: c.status };
        return;
      }
      const remaining =
        BigInt(c.poolCapLamports) - BigInt(c.poolSpentLamports);
      c.status = remaining >= 100_000n ? "live" : "depleted";
    }
    outcomeRef.current = { ok: true, status: c.status };
  });

  const outcome = outcomeRef.current;
  if (!outcome.ok) {
    return { status: outcome.httpStatus, body: { error: outcome.error } };
  }
  log(
    `[http] ${action} ${type}:${mint.slice(0, 8)} by ${publicKey.slice(0, 8)} → ${outcome.status}`
  );
  return { status: 200, body: { ok: true, status: outcome.status } };
}

interface TopupBody {
  type?: string;
  message?: string;
  signature?: string;
  publicKey?: string;
  txSig?: string;
}

async function handleCampaignTopup(
  bags: BagsClient,
  adminWallet: string,
  mint: string,
  raw: unknown
): Promise<MutationResult> {
  const body = raw as TopupBody;
  const { type, message, signature, publicKey, txSig } = body;

  if (!type || !message || !signature || !publicKey || !txSig) {
    return {
      status: 400,
      body: { error: "Missing fields: type, message, signature, publicKey, txSig" },
    };
  }

  const parsed = parseAuthMessage(message);
  if (!parsed || parsed.action !== "topup") {
    return { status: 400, body: { error: "Malformed auth message or wrong action" } };
  }
  if (parsed.mint !== mint || parsed.type !== type) {
    return { status: 400, body: { error: "Message mint/type mismatch" } };
  }
  if (!isTimestampFresh(parsed.timestampMs)) {
    return { status: 401, body: { error: "Auth message expired" } };
  }
  if (!verifyWalletSignature(message, signature, publicKey)) {
    return { status: 401, body: { error: "Invalid signature" } };
  }

  // Anti-replay — reject any txSig already recorded
  // (checked again inside the write-lock to close the race)
  const { loadState } = await import("./state-reader.js");
  const current = await loadState();
  const existingDeposit = (current?.campaignDeposits ?? []).find(
    (d) => d.txSig === txSig
  );
  if (existingDeposit) {
    return { status: 409, body: { error: "This transaction was already applied" } };
  }

  // Verify on-chain deposit
  const check = await verifyDepositTx(bags, txSig, publicKey, adminWallet, 1n);
  if (!check.ok) {
    return { status: 400, body: { error: check.error } };
  }
  const amountLamports = check.amountLamports;

  type Outcome =
    | { ok: true; status: string; addedLamports: string }
    | { ok: false; httpStatus: number; error: string };
  const ref: { current: Outcome } = {
    current: { ok: false, httpStatus: 500, error: "unknown" },
  };

  await withStateLock((s) => {
    if (!s.campaignDeposits) s.campaignDeposits = [];
    if (s.campaignDeposits.some((d) => d.txSig === txSig)) {
      ref.current = { ok: false, httpStatus: 409, error: "Already applied (race)" };
      return;
    }
    const c = (s.campaigns ?? []).find(
      (x) => x.tokenMint === mint && x.type === type
    );
    if (!c) {
      ref.current = { ok: false, httpStatus: 404, error: "Campaign not found" };
      return;
    }
    if (c.creatorWallet !== publicKey) {
      ref.current = {
        ok: false,
        httpStatus: 403,
        error: "Signer is not the campaign creator",
      };
      return;
    }

    c.poolCapLamports = (BigInt(c.poolCapLamports) + amountLamports).toString();
    if (c.status !== "paused") {
      if (BigInt(c.poolCapLamports) - BigInt(c.poolSpentLamports) >= 100_000n) {
        c.status = "live";
      }
    }

    s.campaignDeposits.push({
      txSig,
      tokenMint: mint,
      campaignType: type as CampaignDeposit["campaignType"],
      fromWallet: publicKey,
      amountLamports: amountLamports.toString(),
      kind: "topup",
      createdAt: Date.now(),
    });

    ref.current = {
      ok: true,
      status: c.status,
      addedLamports: amountLamports.toString(),
    };
  });

  const outcome = ref.current;
  if (!outcome.ok) {
    return { status: outcome.httpStatus, body: { error: outcome.error } };
  }
  log(
    `[http] topup ${type}:${mint.slice(0, 8)} +${outcome.addedLamports} lamports (tx ${txSig.slice(0, 8)}…) → ${outcome.status}`
  );

  // Squads custody: move the topped-up SOL from admin → vault so payouts
  // can draw from the SpendingLimit. Without this, the vault stays empty
  // and payouts silently fail after the next SpendingLimit period.
  // A failed sweep is non-fatal — the topup itself landed, state reflects
  // the bump, and the creator can manually run /squads-sweep to recover.
  let sweepTxSig: string | null = null;
  const toppedUp = BigInt(outcome.addedLamports);
  try {
    const { loadState } = await import("./state-reader.js");
    const refreshed = await loadState();
    const c = (refreshed?.campaigns ?? []).find(
      (x) => x.tokenMint === mint && x.type === type
    );
    const vaultB58 = c?.squadsVaultPda;
    if (vaultB58 && toppedUp > 0n) {
      const admin = bags.keypair;
      const adminBalance = BigInt(
        await bags.connection.getBalance(admin.publicKey)
      );
      if (adminBalance < toppedUp + ADMIN_MIN_RESERVE_LAMPORTS) {
        logError(
          `[topup][auto-sweep] skipping — admin balance ${adminBalance} below ${toppedUp} + reserve`
        );
      } else {
        const tx = new Transaction();
        tx.add(
          ComputeBudgetProgram.setComputeUnitLimit({ units: 20_000 }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
          SystemProgram.transfer({
            fromPubkey: admin.publicKey,
            toPubkey: new PublicKey(vaultB58),
            lamports: Number(toppedUp),
          })
        );
        const { blockhash, lastValidBlockHeight } =
          await bags.connection.getLatestBlockhash("confirmed");
        tx.recentBlockhash = blockhash;
        tx.feePayer = admin.publicKey;
        tx.sign(admin);
        const serialized = tx.serialize();
        const sigBytes = tx.signatures[0]?.signature;
        if (!sigBytes) throw new Error("tx unsigned after sign()");
        sweepTxSig = bs58.encode(sigBytes);
        await bags.connection.sendRawTransaction(serialized, {
          skipPreflight: false,
          maxRetries: 3,
        });
        await bags.connection.confirmTransaction(
          { signature: sweepTxSig, blockhash, lastValidBlockHeight },
          "confirmed"
        );
        log(
          `[topup][auto-sweep] ${type}:${mint.slice(0, 8)} → vault ${vaultB58.slice(0, 8)} ${toppedUp} lamports (tx ${sweepTxSig.slice(0, 10)})`
        );
      }
    }
  } catch (err) {
    logError("[topup][auto-sweep] failed (topup itself landed):", err);
    sweepTxSig = null;
  }

  return {
    status: 200,
    body: {
      ok: true,
      status: outcome.status,
      addedLamports: outcome.addedLamports,
      sweepTxSig,
    },
  };
}

interface SweepBody {
  type?: "cashback" | "holder" | "sprint";
  message?: string;
  signature?: string;
  publicKey?: string;
}

const MIN_SWEEP_LAMPORTS = 100_000n; // 0.0001 SOL — dust floor for moving pool to vault

/**
 * Move the remaining unspent pool balance from the admin (hot) wallet into the
 * campaign's Squads vault PDA. Only callable after provision-squads has
 * attached the multisig + SpendingLimit; without the vault PDA, this is a
 * no-op / error.
 *
 * Purpose: close the custody loop. After provision-squads, the vault exists
 * but is empty; the pool still sits in admin custody. This endpoint sweeps it
 * in, so subsequent payouts actually have SOL in the vault to draw against
 * via SpendingLimit.
 *
 * Admin-signed (no user signature on the transfer). Creator auth-signs the
 * request so we know the caller owns the campaign.
 */
async function handleSquadsSweep(
  bags: BagsClient,
  mint: string,
  raw: unknown
): Promise<MutationResult> {
  const body = raw as SweepBody;
  const { type, message, signature, publicKey } = body;

  if (!type || !message || !signature || !publicKey) {
    return {
      status: 400,
      body: { error: "Missing fields: type, message, signature, publicKey" },
    };
  }

  const parsed = parseAuthMessage(message);
  if (!parsed || parsed.action !== "squads-sweep") {
    return { status: 400, body: { error: "Malformed auth message or wrong action" } };
  }
  if (parsed.mint !== mint || parsed.type !== type) {
    return { status: 400, body: { error: "Message mint/type mismatch" } };
  }
  if (!isTimestampFresh(parsed.timestampMs)) {
    return { status: 401, body: { error: "Auth message expired" } };
  }
  if (!verifyWalletSignature(message, signature, publicKey)) {
    return { status: 401, body: { error: "Invalid signature" } };
  }

  const { loadState } = await import("./state-reader.js");
  const current = await loadState();
  const campaign = (current?.campaigns ?? []).find(
    (c) => c.tokenMint === mint && c.type === type
  );
  if (!campaign) {
    return { status: 404, body: { error: "Campaign not found" } };
  }
  if (campaign.creatorWallet !== publicKey) {
    return { status: 403, body: { error: "Signer is not the campaign creator" } };
  }
  if (!campaign.squadsVaultPda || !campaign.squadsSpendingLimitPda) {
    return {
      status: 400,
      body: {
        error:
          "Campaign has no Squads vault — provision Squads custody before sweep",
      },
    };
  }

  // Amount to sweep: the unspent pool. poolSpent already accounts for accrued
  // payouts (the accrual trigger bumps it), so this is the honest remainder
  // that should physically live under custody.
  const unspent =
    BigInt(campaign.poolCapLamports) - BigInt(campaign.poolSpentLamports);
  if (unspent < MIN_SWEEP_LAMPORTS) {
    return {
      status: 400,
      body: {
        error: `Unspent pool ${unspent} lamports below minimum ${MIN_SWEEP_LAMPORTS}`,
      },
    };
  }

  // Treasury solvency — admin wallet must still cover other pending payouts
  // after this sweep lands. Prevents accidentally draining into a vault and
  // leaving legacy campaigns' accrued obligations unpayable.
  const admin = bags.keypair;
  let balance: bigint;
  try {
    balance = BigInt(await bags.connection.getBalance(admin.publicKey));
  } catch (err) {
    logError("[squads-sweep] getBalance failed:", err);
    return { status: 502, body: { error: "Could not read admin balance" } };
  }
  // Sum accrued/submitted payouts NOT tied to this campaign — those are the
  // other obligations the admin must still honour after sweep. Payouts that
  // reference this campaign will be paid from the Squads vault going forward.
  const otherObligations = (current?.rewardPayouts ?? [])
    .filter(
      (p) =>
        (p.status === "accrued" || p.status === "submitted") &&
        !(p.tokenMint === mint && p.campaignType === type)
    )
    .reduce((sum, p) => sum + BigInt(p.rewardLamports), 0n);
  const surplusAfter =
    balance - unspent - otherObligations - ADMIN_MIN_RESERVE_LAMPORTS;
  if (surplusAfter < 0n) {
    return {
      status: 409,
      body: {
        error: `Admin wallet would be underfunded after sweep (shortfall ${-surplusAfter} lamports)`,
      },
    };
  }

  const vaultPda = new PublicKey(campaign.squadsVaultPda);
  let txSig: string;
  try {
    const tx = new Transaction();
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 20_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
      SystemProgram.transfer({
        fromPubkey: admin.publicKey,
        toPubkey: vaultPda,
        lamports: Number(unspent),
      })
    );
    const { blockhash, lastValidBlockHeight } =
      await bags.connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = admin.publicKey;
    tx.sign(admin);

    const serialized = tx.serialize();
    const sigBytes = tx.signatures[0]?.signature;
    if (!sigBytes) throw new Error("tx unsigned after sign()");
    txSig = bs58.encode(sigBytes);

    await bags.connection.sendRawTransaction(serialized, {
      skipPreflight: false,
      maxRetries: 3,
    });
    await bags.connection.confirmTransaction(
      { signature: txSig, blockhash, lastValidBlockHeight },
      "confirmed"
    );
  } catch (err) {
    logError("[squads-sweep] transfer failed:", err);
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 500, body: { error: `Sweep transfer failed: ${msg.slice(0, 200)}` } };
  }

  log(
    `[http] squads-sweep ${type}:${mint.slice(0, 8)} → vault ${vaultPda.toBase58().slice(0, 8)} ${unspent} lamports (tx ${txSig.slice(0, 10)})`
  );
  return {
    status: 200,
    body: {
      ok: true,
      txSig,
      amountLamports: unspent.toString(),
      vaultPda: vaultPda.toBase58(),
    },
  };
}

interface CreateBody {
  tokenMint?: string;
  type?: "cashback" | "holder" | "sprint";
  message?: string;
  signature?: string;
  publicKey?: string;
  txSig?: string;
  config?: Record<string, unknown>;
}

function buildCampaignFromBody(
  body: Required<Pick<CreateBody, "tokenMint" | "type" | "publicKey">> &
    Pick<CreateBody, "config">,
  poolCapLamports: string
): Campaign | { error: string } {
  const base = {
    tokenMint: body.tokenMint,
    creatorWallet: body.publicKey,
    poolCapLamports,
    poolSpentLamports: "0",
    status: "live" as const,
    createdAt: Date.now(),
  };
  const config = body.config ?? {};

  switch (body.type) {
    case "cashback": {
      const cashbackBps = Number(config.cashbackBps);
      if (!Number.isFinite(cashbackBps) || cashbackBps < 1 || cashbackBps > 2000) {
        return { error: "cashbackBps must be between 1 and 2000 (0.01%–20%)" };
      }
      return { ...base, type: "cashback", config: { cashbackBps } };
    }
    case "holder": {
      const rewardBps = Number(config.rewardBps);
      const minHoldHours = Number(config.minHoldHours);
      const snapshotCronHours = Number(config.snapshotCronHours);
      if (!Number.isFinite(rewardBps) || rewardBps < 1 || rewardBps > 2000) {
        return { error: "rewardBps must be between 1 and 2000" };
      }
      if (!Number.isFinite(minHoldHours) || minHoldHours < 0) {
        return { error: "minHoldHours must be ≥ 0" };
      }
      if (!Number.isFinite(snapshotCronHours) || snapshotCronHours < 1) {
        return { error: "snapshotCronHours must be ≥ 1" };
      }
      return {
        ...base,
        type: "holder",
        config: { rewardBps, minHoldHours, snapshotCronHours },
      };
    }
    case "sprint": {
      const minBuyLamports = String(config.minBuyLamports ?? "");
      const maxWinners = Number(config.maxWinners);
      const bonusLamports = String(config.bonusLamports ?? "");
      if (!minBuyLamports || !bonusLamports) {
        return { error: "minBuyLamports and bonusLamports required" };
      }
      if (!Number.isFinite(maxWinners) || maxWinners < 1) {
        return { error: "maxWinners must be ≥ 1" };
      }
      return {
        ...base,
        type: "sprint",
        config: { minBuyLamports, maxWinners, bonusLamports },
      };
    }
    default:
      return { error: "Unknown campaign type" };
  }
}

async function handleCampaignCreate(
  bags: BagsClient,
  adminWallet: string,
  raw: unknown
): Promise<MutationResult> {
  const body = raw as CreateBody;
  const { tokenMint, type, message, signature, publicKey, txSig, config } = body;

  if (!tokenMint || !type || !message || !signature || !publicKey || !txSig) {
    return {
      status: 400,
      body: {
        error:
          "Missing fields: tokenMint, type, message, signature, publicKey, txSig",
      },
    };
  }
  if (!["cashback", "holder", "sprint"].includes(type)) {
    return { status: 400, body: { error: "Invalid campaign type" } };
  }

  const parsed = parseAuthMessage(message);
  if (!parsed || parsed.action !== "create") {
    return { status: 400, body: { error: "Malformed auth message or wrong action" } };
  }
  if (parsed.mint !== tokenMint || parsed.type !== type) {
    return { status: 400, body: { error: "Message mint/type mismatch" } };
  }
  if (!isTimestampFresh(parsed.timestampMs)) {
    return { status: 401, body: { error: "Auth message expired" } };
  }
  if (!verifyWalletSignature(message, signature, publicKey)) {
    return { status: 401, body: { error: "Invalid signature" } };
  }

  // Verify the signer is actually a creator/admin of this token on Bags.
  // Without this, anyone could squat any mint and lock the (mint,type) slot.
  // Fail-closed on API error so a Bags outage cannot bypass the check.
  try {
    const creators = await bags.getTokenCreators(tokenMint);
    const ok = creators.some(
      (c) => c.wallet === publicKey && (c.isCreator || c.isAdmin)
    );
    if (!ok) {
      return {
        status: 403,
        body: { error: "Signer is not a creator/admin of this token on Bags" },
      };
    }
  } catch (err) {
    logError("[create] getTokenCreators failed:", err);
    return {
      status: 502,
      body: { error: "Could not verify token creators with Bags — try again" },
    };
  }

  // Best-effort Metaplex metadata fetch so the UI shows $SYMBOL instead of
  // the mint prefix. Non-fatal: a missing metadata account just falls back
  // to the truncated-mint display.
  const tokenMetadata = await bags.getTokenMetadata(tokenMint).catch((err) => {
    logError("[create] getTokenMetadata failed (non-fatal):", err);
    return null;
  });

  // Verify on-chain deposit — at least 0.001 SOL so new campaigns can pay
  // at least one reward out of the gate.
  const check = await verifyDepositTx(bags, txSig, publicKey, adminWallet, 1_000_000n);
  if (!check.ok) {
    return { status: 400, body: { error: check.error } };
  }
  const amountLamports = check.amountLamports;

  type Outcome =
    | { ok: true; campaign: Campaign }
    | { ok: false; httpStatus: number; error: string };
  const ref: { current: Outcome } = {
    current: { ok: false, httpStatus: 500, error: "unknown" },
  };

  await withStateLock((s) => {
    if (!s.campaignDeposits) s.campaignDeposits = [];
    if (!s.campaigns) s.campaigns = [];

    if (s.campaignDeposits.some((d) => d.txSig === txSig)) {
      ref.current = { ok: false, httpStatus: 409, error: "This transaction was already applied" };
      return;
    }
    const conflicting = s.campaigns.find(
      (c) =>
        c.tokenMint === tokenMint &&
        c.type === type &&
        (c.status === "live" || c.status === "paused")
    );
    if (conflicting) {
      ref.current = {
        ok: false,
        httpStatus: 409,
        error: `A ${type} campaign on ${tokenMint.slice(0, 8)}… is already ${conflicting.status}`,
      };
      return;
    }

    const built = buildCampaignFromBody(
      { tokenMint, type, publicKey, config },
      amountLamports.toString()
    );
    if ("error" in built) {
      ref.current = { ok: false, httpStatus: 400, error: built.error };
      return;
    }
    if (tokenMetadata?.name || tokenMetadata?.symbol) {
      built.tokenInfo = {
        name: tokenMetadata.name || tokenMetadata.symbol,
        symbol: tokenMetadata.symbol || tokenMetadata.name,
      };
    }

    s.campaigns.push(built);
    s.campaignDeposits.push({
      txSig,
      tokenMint,
      campaignType: type,
      fromWallet: publicKey,
      amountLamports: amountLamports.toString(),
      kind: "create",
      createdAt: Date.now(),
    });

    ref.current = { ok: true, campaign: built };
  });

  const outcome = ref.current;
  if (!outcome.ok) {
    return { status: outcome.httpStatus, body: { error: outcome.error } };
  }
  log(
    `[http] create ${type}:${tokenMint.slice(0, 8)} by ${publicKey.slice(0, 8)} +${amountLamports} lamports (tx ${txSig.slice(0, 8)}…)`
  );
  return { status: 200, body: { ok: true, campaign: outcome.campaign } };
}

interface FeeShareBody {
  tokenMint?: string;
  message?: string;
  signature?: string;
  publicKey?: string;
  tendBps?: number;
}

const DEFAULT_TEND_BPS = 1000; // 10% — sensible default if creator doesn't specify
const MAX_TEND_BPS = 5000; // hard cap: never request more than 50%

/**
 * Prepare REPLACE-semantics fee-share update transactions that route a slice
 * of the creator's Bags fee-share to the Tend admin wallet, while preserving
 * existing claimers (their bps reduced prorata so the total stays at 10000).
 *
 * Returns base64 transactions for the creator's wallet to sign. We never sign
 * here — the agent only assembles the proposal.
 */
async function handleFeeSharePrepare(
  bags: BagsClient,
  adminWallet: string,
  raw: unknown
): Promise<MutationResult> {
  const body = raw as FeeShareBody;
  const { tokenMint, message, signature, publicKey } = body;
  const requestedTendBps = body.tendBps ?? DEFAULT_TEND_BPS;

  if (!tokenMint || !message || !signature || !publicKey) {
    return {
      status: 400,
      body: { error: "Missing fields: tokenMint, message, signature, publicKey" },
    };
  }
  if (
    !Number.isFinite(requestedTendBps) ||
    requestedTendBps < 1 ||
    requestedTendBps > MAX_TEND_BPS
  ) {
    return {
      status: 400,
      body: { error: `tendBps must be between 1 and ${MAX_TEND_BPS}` },
    };
  }

  const parsed = parseAuthMessage(message);
  if (!parsed || parsed.action !== "route-fees") {
    return { status: 400, body: { error: "Malformed auth message or wrong action" } };
  }
  if (parsed.mint !== tokenMint) {
    return { status: 400, body: { error: "Message mint mismatch" } };
  }
  if (!isTimestampFresh(parsed.timestampMs)) {
    return { status: 401, body: { error: "Auth message expired" } };
  }
  if (!verifyWalletSignature(message, signature, publicKey)) {
    return { status: 401, body: { error: "Invalid signature" } };
  }

  // Read existing claimers — fail-closed on Bags API error so we never
  // assemble a config that wipes someone else's fee share.
  let creators;
  try {
    creators = await bags.getTokenCreators(tokenMint);
  } catch (err) {
    logError("[fee-share] getTokenCreators failed:", err);
    return {
      status: 502,
      body: { error: "Could not read existing fee-share — try again" },
    };
  }

  // Only an admin can update the fee-share config on Bags.
  const signerEntry = creators.find((c) => c.wallet === publicKey);
  if (!signerEntry || !signerEntry.isAdmin) {
    return {
      status: 403,
      body: { error: "Signer is not an admin of this token's fee-share config" },
    };
  }

  // Build the new claimers list:
  // 1. Allocate `requestedTendBps` to the Tend admin wallet
  // 2. Distribute the remaining (10000 - requestedTendBps) across existing
  //    claimers prorata to their current royaltyBps
  // 3. Drop the Tend wallet from the "others" bucket if it was already there
  //    (avoids double counting).
  const others = creators.filter((c) => c.wallet !== adminWallet);
  const otherTotal = others.reduce((sum, c) => sum + (c.royaltyBps ?? 0), 0);
  if (otherTotal <= 0) {
    return {
      status: 400,
      body: { error: "Existing fee-share is empty — cannot rebalance" },
    };
  }

  const remaining = 10_000 - requestedTendBps;
  const rebalanced: Array<{ wallet: string; bps: number }> = [];
  let allocated = 0;
  for (let i = 0; i < others.length; i++) {
    const c = others[i];
    let bps: number;
    if (i === others.length - 1) {
      // Last entry absorbs rounding so the total lands on exactly 10000
      bps = remaining - allocated;
    } else {
      bps = Math.floor(((c.royaltyBps ?? 0) * remaining) / otherTotal);
      allocated += bps;
    }
    if (bps > 0) {
      rebalanced.push({ wallet: c.wallet, bps });
    }
  }
  rebalanced.push({ wallet: adminWallet, bps: requestedTendBps });

  // Sanity check: total must equal exactly 10000 — Bags rejects otherwise.
  const sum = rebalanced.reduce((s, c) => s + c.bps, 0);
  if (sum !== 10_000) {
    return {
      status: 500,
      body: { error: `Internal: rebalanced total is ${sum}, expected 10000` },
    };
  }

  let txs;
  try {
    txs = await bags.prepareUpdateFeeShareConfig(
      tokenMint,
      rebalanced,
      new PublicKey(publicKey)
    );
  } catch (err) {
    logError("[fee-share] prepareUpdateFeeShareConfig failed:", err);
    return {
      status: 502,
      body: { error: "Could not prepare fee-share update — try again" },
    };
  }

  log(
    `[http] route-fees ${tokenMint.slice(0, 8)} tend=${requestedTendBps}bps others=${rebalanced.length - 1} txs=${txs.length}`
  );
  return {
    status: 200,
    body: {
      ok: true,
      transactions: txs,
      claimers: rebalanced,
      tendBps: requestedTendBps,
    },
  };
}

// ── Squads provisioning (wallet-sign flow) ────────────────────────────────

interface SquadsPrepareBody {
  tokenMint?: string;
  type?: CampaignType;
  message?: string;
  signature?: string;
  publicKey?: string;
  amountLamports?: string;
  period?: SpendingPeriod;
  initialFundingLamports?: string;
}

async function handleSquadsProvisionPrepare(
  connection: Connection,
  agentMember: PublicKey,
  raw: unknown
): Promise<MutationResult> {
  const body = raw as SquadsPrepareBody;
  const {
    tokenMint,
    type,
    message,
    signature,
    publicKey,
    amountLamports,
    period,
  } = body;

  if (
    !tokenMint ||
    !type ||
    !message ||
    !signature ||
    !publicKey ||
    !amountLamports ||
    !period
  ) {
    return {
      status: 400,
      body: {
        error:
          "Missing fields: tokenMint, type, message, signature, publicKey, amountLamports, period",
      },
    };
  }

  const parsed = parseAuthMessage(message);
  if (!parsed || parsed.action !== "provision-squads") {
    return { status: 400, body: { error: "Malformed auth message or wrong action" } };
  }
  if (parsed.mint !== tokenMint) {
    return { status: 400, body: { error: "Message mint mismatch" } };
  }
  if (parsed.type !== type) {
    return { status: 400, body: { error: "Message type mismatch" } };
  }
  if (!isTimestampFresh(parsed.timestampMs)) {
    return { status: 401, body: { error: "Auth message expired" } };
  }
  if (!verifyWalletSignature(message, signature, publicKey)) {
    return { status: 401, body: { error: "Invalid signature" } };
  }

  let amount: bigint;
  try {
    amount = BigInt(amountLamports);
  } catch {
    return { status: 400, body: { error: "amountLamports not parseable as BigInt" } };
  }
  if (amount <= 0n) {
    return { status: 400, body: { error: "amountLamports must be > 0" } };
  }
  if (!["oneTime", "day", "week", "month"].includes(period)) {
    return { status: 400, body: { error: "period must be oneTime|day|week|month" } };
  }
  let funding: bigint | undefined;
  if (body.initialFundingLamports) {
    try {
      funding = BigInt(body.initialFundingLamports);
      if (funding <= 0n) funding = undefined;
    } catch {
      return {
        status: 400,
        body: { error: "initialFundingLamports not parseable as BigInt" },
      };
    }
  }

  try {
    const payload = await buildProvisionPrepare(connection, {
      creator: new PublicKey(publicKey),
      agentMember,
      tokenMint,
      type,
      amountLamports: amount,
      period,
      initialFundingLamports: funding,
    });
    log(
      `[http] squads-prepare ${tokenMint.slice(0, 8)}/${type} amount=${amount} period=${period} fund=${funding ?? 0} newMs=${payload.multisigCreateTx ? "yes" : "no"}`
    );
    return { status: 200, body: { ok: true, ...payload } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError("[http] squads-prepare failed:", msg);
    return { status: 400, body: { error: msg } };
  }
}

interface SquadsConfirmBody {
  tokenMint?: string;
  type?: CampaignType;
  message?: string;
  signature?: string;
  publicKey?: string;
  multisigCreateKey?: string | null;
  multisigCreateTxSig?: string | null;
  vaultIndex?: number;
  spendingLimitCreateKey?: string;
  attachTxSig?: string;
  amountLamports?: string;
  period?: SpendingPeriod;
}

async function handleSquadsProvisionConfirm(
  connection: Connection,
  network: "devnet" | "mainnet-beta",
  raw: unknown
): Promise<MutationResult> {
  const body = raw as SquadsConfirmBody;
  const {
    tokenMint,
    type,
    message,
    signature,
    publicKey,
    vaultIndex,
    spendingLimitCreateKey,
    attachTxSig,
    amountLamports,
    period,
  } = body;

  if (
    !tokenMint ||
    !type ||
    !message ||
    !signature ||
    !publicKey ||
    vaultIndex == null ||
    !spendingLimitCreateKey ||
    !attachTxSig ||
    !amountLamports ||
    !period
  ) {
    return {
      status: 400,
      body: {
        error:
          "Missing fields: tokenMint, type, message, signature, publicKey, vaultIndex, spendingLimitCreateKey, attachTxSig, amountLamports, period",
      },
    };
  }

  const parsed = parseAuthMessage(message);
  if (!parsed || parsed.action !== "provision-squads") {
    return { status: 400, body: { error: "Malformed auth message or wrong action" } };
  }
  if (parsed.mint !== tokenMint) {
    return { status: 400, body: { error: "Message mint mismatch" } };
  }
  if (parsed.type !== type) {
    return { status: 400, body: { error: "Message type mismatch" } };
  }
  // Confirm window is wider — the client may have spent 30-90s waiting for
  // tx confirmation before posting here. Still cap at AUTH_WINDOW_MS.
  if (!isTimestampFresh(parsed.timestampMs)) {
    return { status: 401, body: { error: "Auth message expired" } };
  }
  if (!verifyWalletSignature(message, signature, publicKey)) {
    return { status: 401, body: { error: "Invalid signature" } };
  }

  let amount: bigint;
  try {
    amount = BigInt(amountLamports);
  } catch {
    return { status: 400, body: { error: "amountLamports not parseable as BigInt" } };
  }

  try {
    const result = await persistProvisionCommit(connection, {
      creatorWallet: publicKey,
      tokenMint,
      type,
      multisigCreateKey: body.multisigCreateKey ?? null,
      multisigCreateTxSig: body.multisigCreateTxSig ?? null,
      vaultIndex,
      spendingLimitCreateKey,
      attachTxSig,
      amountLamports: amount,
      period,
      network,
    });
    log(
      `[http] squads-confirm ${tokenMint.slice(0, 8)}/${type} vault[${vaultIndex}] SL ${result.spendingLimitPda.slice(0, 10)}`
    );
    return { status: 200, body: { ok: true, ...result } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logError("[http] squads-confirm failed:", msg);
    return { status: 400, body: { error: msg } };
  }
}

async function main() {
  const apiKey = process.env.BAGS_API_KEY;
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const privateKey = process.env.TEND_PRIVATE_KEY;

  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey || !rpcUrl || !privateKey || !anthropicKey) {
    logError(
      "Missing required env vars: BAGS_API_KEY, SOLANA_RPC_URL, TEND_PRIVATE_KEY, ANTHROPIC_API_KEY"
    );
    process.exit(1);
  }

  const network: "devnet" | "mainnet-beta" =
    process.env.TEND_NETWORK === "devnet" ? "devnet" : "mainnet-beta";

  // Seed state from snapshot if missing (Render ephemeral disk)
  const stateDir = join(homedir(), TEND_STATE_DIR);
  const statePath = join(stateDir, TEND_STATE_FILE);
  if (!existsSync(statePath)) {
    const snapshotPath = join(
      process.cwd(),
      "packages",
      "frontend",
      "public",
      "state-snapshot.json"
    );
    if (existsSync(snapshotPath)) {
      mkdirSync(stateDir, { recursive: true });
      copyFileSync(snapshotPath, statePath);
      log(`Seeded state from snapshot`);
    }
  }

  const keypair = loadKeypair(privateKey);
  log(`Agent wallet: ${keypair.publicKey.toBase58()}`);

  const bags = new BagsClient({
    apiKey,
    rpcUrl,
    privateKey: keypair,
  });

  const scheduler = new Scheduler(bags);
  scheduler.start();

  // HTTP server — health + state API for Vercel frontend
  const port = parseInt(process.env.PORT || "3001", 10);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    // CORS for Vercel frontend
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      try {
        const treasury = await getTreasuryHealth(bags);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            uptime: process.uptime(),
            treasury,
          })
        );
      } catch (err) {
        // Health endpoint must always respond — degrade gracefully if RPC fails.
        logError("[health] treasury check failed:", err);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            uptime: process.uptime(),
            treasury: { status: "unknown", error: "rpc unreachable" },
          })
        );
      }
      return;
    }

    if (req.method === "GET" && url.pathname === "/state") {
      try {
        const { loadState } = await import("./state-reader.js");
        const state = await loadState();
        if (!state) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({}));
          return;
        }
        // Strip wallet secrets before sending; expose admin (fee destination)
        // pubkey so the frontend can build transfer txs for create/topup.
        const safe = {
          ...state,
          walletPool: state.walletPool?.map((w) => ({
            publicKey: w.publicKey,
            assignedTo: w.assignedTo,
          })),
          adminWallet: keypair.publicKey.toBase58(),
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(safe));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to read state" }));
      }
      return;
    }

    // POST /campaigns/:mint/(pause|resume) — wallet-signed status flip
    const mutateMatch = url.pathname.match(
      /^\/campaigns\/([^/]+)\/(pause|resume)$/
    );
    if (req.method === "POST" && mutateMatch) {
      const [, mintParam, action] = mutateMatch;
      try {
        const body = await readJsonBody(req);
        const result = await handleCampaignMutation(
          mintParam,
          action as "pause" | "resume",
          body
        );
        res.writeHead(result.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result.body));
      } catch (err) {
        logError("[http] mutation error:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal error" }));
      }
      return;
    }

    // POST /campaigns/:mint/topup — SOL-funded pool bump
    const topupMatch = url.pathname.match(/^\/campaigns\/([^/]+)\/topup$/);
    if (req.method === "POST" && topupMatch) {
      const [, mintParam] = topupMatch;
      try {
        const body = await readJsonBody(req);
        const result = await handleCampaignTopup(
          bags,
          keypair.publicKey.toBase58(),
          mintParam,
          body
        );
        res.writeHead(result.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result.body));
      } catch (err) {
        logError("[http] topup error:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal error" }));
      }
      return;
    }

    // POST /campaigns/provision-squads/prepare — build the multisigCreate +
    // attachSpendingLimit txs for the creator's wallet to sign. Agent derives
    // from the creator pubkey + campaign params, pre-signs multisigCreate's
    // createKey half, returns base64.
    if (
      req.method === "POST" &&
      url.pathname === "/campaigns/provision-squads/prepare"
    ) {
      try {
        const body = await readJsonBody(req);
        const agentMember = resolveAgentKey(keypair).publicKey;
        const result = await handleSquadsProvisionPrepare(
          bags.connection,
          agentMember,
          body
        );
        res.writeHead(result.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result.body));
      } catch (err) {
        logError("[http] squads prepare error:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal error" }));
      }
      return;
    }

    // POST /campaigns/:mint/squads-sweep — move the unspent pool from admin
    // (hot wallet) to the campaign's Squads vault so SpendingLimit payouts
    // can actually draw against SOL. Admin-signed; creator auth-signs request.
    {
      const match = url.pathname.match(
        /^\/campaigns\/([^/]+)\/squads-sweep$/
      );
      if (req.method === "POST" && match) {
        const mintParam = match[1];
        try {
          const body = await readJsonBody(req);
          const result = await handleSquadsSweep(bags, mintParam, body);
          res.writeHead(result.status, { "Content-Type": "application/json" });
          res.end(JSON.stringify(result.body));
        } catch (err) {
          logError("[http] squads-sweep error:", err);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal error" }));
        }
        return;
      }
    }

    // POST /campaigns/provision-squads/confirm — after the creator's wallet
    // has sent + confirmed the txs, persist squads* columns on the campaign
    // row and upsert the multisig registry row.
    if (
      req.method === "POST" &&
      url.pathname === "/campaigns/provision-squads/confirm"
    ) {
      try {
        const body = await readJsonBody(req);
        const result = await handleSquadsProvisionConfirm(
          bags.connection,
          network,
          body
        );
        res.writeHead(result.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result.body));
      } catch (err) {
        logError("[http] squads confirm error:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal error" }));
      }
      return;
    }

    // POST /campaigns/fee-share/prepare — build REPLACE-semantics tx that
    // routes a slice of the creator's Bags fee-share to the Tend admin.
    // Returns base64 txs for the creator's wallet to sign.
    if (
      req.method === "POST" &&
      url.pathname === "/campaigns/fee-share/prepare"
    ) {
      try {
        const body = await readJsonBody(req);
        const result = await handleFeeSharePrepare(
          bags,
          keypair.publicKey.toBase58(),
          body
        );
        res.writeHead(result.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result.body));
      } catch (err) {
        logError("[http] fee-share prepare error:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal error" }));
      }
      return;
    }

    // POST /campaigns — SOL-funded campaign creation
    if (req.method === "POST" && url.pathname === "/campaigns") {
      try {
        const body = await readJsonBody(req);
        const result = await handleCampaignCreate(
          bags,
          keypair.publicKey.toBase58(),
          body
        );
        res.writeHead(result.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result.body));
      } catch (err) {
        logError("[http] create error:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal error" }));
      }
      return;
    }

    // Default: health
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
  });
  server.listen(port, () => log(`HTTP server on :${port}`));

  // Graceful shutdown
  const shutdown = () => {
    log("Shutting down...");
    scheduler.stop();
    server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  log("Tend Agent running. Press Ctrl+C to stop.");
}

// Crash alerting — uncaught errors should always page the operator before
// the process dies. Best-effort: don't block exit on the webhook.
process.on("uncaughtException", (err) => {
  logError("[crash] uncaughtException:", err);
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  void alert("agent-crash", "critical", `uncaughtException — ${msg.slice(0, 300)}`)
    .finally(() => process.exit(1));
});

process.on("unhandledRejection", (reason) => {
  logError("[crash] unhandledRejection:", reason);
  const msg =
    reason instanceof Error
      ? `${reason.name}: ${reason.message}`
      : String(reason);
  void alert(
    "agent-crash",
    "critical",
    `unhandledRejection — ${msg.slice(0, 300)}`
  );
});

main().catch((err) => {
  logError("Fatal:", err);
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  void alert("agent-crash", "critical", `Fatal startup error — ${msg.slice(0, 300)}`)
    .finally(() => process.exit(1));
});
