import { eq, inArray, and } from "drizzle-orm";
import type {
  TendState,
  WalletEntry,
  Campaign,
  RewardPayout,
  FraudDecision,
  CampaignDeposit,
  CampaignWithdrawal,
  FeeClaimEvent,
} from "../types/index.js";
import { migrateCampaign } from "../types/index.js";
import {
  encryptSecret,
  decryptSecret,
  isEncrypted,
} from "../crypto-utils.js";
import { getDb } from "./client.js";
import {
  walletPool,
  campaigns,
  rewardPayouts,
  fraudDecisions,
  campaignDeposits,
  campaignWithdrawals,
  feeClaimEvents,
  swapCursors,
  holderSnapshotCursors,
  agentMeta,
  type CampaignRow,
  type WalletPoolRow,
  type RewardPayoutRow,
  type FraudDecisionRow,
  type CampaignDepositRow,
  type CampaignWithdrawalRow,
  type FeeClaimEventRow,
} from "./schema.js";

// ── Row ⇄ domain conversions ──────────────────────────────────────────────

function rowToWallet(r: WalletPoolRow): WalletEntry {
  return {
    publicKey: r.publicKey,
    secretKey: r.secretKey,
    ...(r.assignedTo ? { assignedTo: r.assignedTo } : {}),
  };
}

function rowToCampaign(r: CampaignRow): Campaign {
  const base = {
    tokenMint: r.tokenMint,
    creatorWallet: r.creatorWallet,
    poolCapLamports: r.poolCapLamports,
    poolSpentLamports: r.poolSpentLamports,
    feesClaimedLamports: r.feesClaimedLamports ?? undefined,
    feeClaimCount: r.feeClaimCount ?? undefined,
    lastFeeClaimAt: r.lastFeeClaimAt ?? undefined,
    status: r.status as "live" | "paused" | "depleted",
    createdAt: r.createdAt,
    tokenInfo: (r.tokenInfo as Campaign["tokenInfo"]) ?? undefined,
  };
  // `config` is jsonb — the discriminated union is reconstituted by type
  if (r.type === "cashback") {
    return { ...base, type: "cashback", config: r.config as { cashbackBps: number } };
  }
  if (r.type === "holder") {
    return {
      ...base,
      type: "holder",
      config: r.config as {
        rewardBps: number;
        minHoldHours: number;
        snapshotCronHours: number;
      },
    };
  }
  return {
    ...base,
    type: "sprint",
    config: r.config as {
      minBuyLamports: string;
      maxWinners: number;
      bonusLamports: string;
    },
  };
}

function rowToRewardPayout(r: RewardPayoutRow): RewardPayout {
  return {
    id: r.id,
    tokenMint: r.tokenMint,
    traderWallet: r.traderWallet,
    swapTxSig: r.swapTxSig,
    swapVolumeLamports: r.swapVolumeLamports,
    rewardLamports: r.rewardLamports,
    payoutTxSig: r.payoutTxSig,
    status: r.status as RewardPayout["status"],
    ...(r.submittedAt != null ? { submittedAt: r.submittedAt } : {}),
    createdAt: r.createdAt,
    ...(r.paidAt != null ? { paidAt: r.paidAt } : {}),
    ...(r.failedAttempts != null ? { failedAttempts: r.failedAttempts } : {}),
    ...(r.lastError ? { lastError: r.lastError } : {}),
    ...(r.campaignType
      ? { campaignType: r.campaignType as RewardPayout["campaignType"] }
      : {}),
  };
}

function rowToFraudDecision(r: FraudDecisionRow): FraudDecision {
  return {
    id: r.id,
    tokenMint: r.tokenMint,
    traderWallet: r.traderWallet,
    swapTxSig: r.swapTxSig,
    swapVolumeLamports: r.swapVolumeLamports,
    decision: r.decision as FraudDecision["decision"],
    reasoning: r.reasoning,
    flags: r.flags as string[],
    model: r.model,
    checkedAt: r.checkedAt,
    walletContext: r.walletContext as FraudDecision["walletContext"],
  };
}

function rowToCampaignDeposit(r: CampaignDepositRow): CampaignDeposit {
  return {
    txSig: r.txSig,
    tokenMint: r.tokenMint,
    campaignType: r.campaignType as CampaignDeposit["campaignType"],
    fromWallet: r.fromWallet,
    amountLamports: r.amountLamports,
    kind: r.kind as CampaignDeposit["kind"],
    createdAt: r.createdAt,
  };
}

function rowToCampaignWithdrawal(r: CampaignWithdrawalRow): CampaignWithdrawal {
  return {
    txSig: r.txSig,
    tokenMint: r.tokenMint,
    campaignType: r.campaignType as CampaignWithdrawal["campaignType"],
    toWallet: r.toWallet,
    amountLamports: r.amountLamports,
    createdAt: r.createdAt,
  };
}

function rowToFeeClaimEvent(r: FeeClaimEventRow): FeeClaimEvent {
  return {
    tokenMint: r.tokenMint,
    claimedLamports: r.claimedLamports,
    signatures: r.signatures as string[],
    source: r.source as FeeClaimEvent["source"],
    createdAt: r.createdAt,
  };
}

// ── Readers ──────────────────────────────────────────────────────────────

/**
 * Load the full TendState from Postgres. Wallet secrets are decrypted here
 * to match the file-based `loadState` contract — callers receive plaintext
 * bytes and must not persist them directly.
 */
export async function loadStateFromDb(): Promise<TendState> {
  const db = getDb();
  const [
    wallets,
    camps,
    payouts,
    frauds,
    deposits,
    withdrawals,
    feeEvents,
    swapCur,
    holderCur,
    heartRows,
  ] = await Promise.all([
    db.select().from(walletPool),
    db.select().from(campaigns),
    db.select().from(rewardPayouts),
    db.select().from(fraudDecisions),
    db.select().from(campaignDeposits),
    db.select().from(campaignWithdrawals),
    db.select().from(feeClaimEvents),
    db.select().from(swapCursors),
    db.select().from(holderSnapshotCursors),
    db.select().from(agentMeta).where(eq(agentMeta.key, "heartbeat")),
  ]);

  const state: TendState = {
    walletPool: wallets.map(rowToWallet).map((w) => ({
      ...w,
      secretKey: isEncrypted(w.secretKey) ? decryptSecret(w.secretKey) : w.secretKey,
    })),
    campaigns: camps.map(rowToCampaign).map(migrateCampaign),
    rewardPayouts: payouts.map(rowToRewardPayout),
    fraudDecisions: frauds.map(rowToFraudDecision),
    campaignDeposits: deposits.map(rowToCampaignDeposit),
    campaignWithdrawals: withdrawals.map(rowToCampaignWithdrawal),
    feeClaimEvents: feeEvents.map(rowToFeeClaimEvent),
    swapCursors: Object.fromEntries(swapCur.map((r) => [r.tokenMint, r.value])),
    holderSnapshotCursors: Object.fromEntries(
      holderCur.map((r) => [r.tokenMint, r.value])
    ),
  };
  const heart = heartRows[0]?.valueNumber;
  if (heart != null) state.agentHeartbeat = heart;
  return state;
}

// ── withStateLock over a SERIALIZABLE transaction ────────────────────────

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

function keyFeeEvent(e: FeeClaimEvent): string {
  return `${e.tokenMint}|${e.createdAt}|${e.signatures[0] ?? ""}`;
}

async function diffAndPersist(
  tx: Tx,
  before: TendState,
  after: TendState
): Promise<void> {
  // Wallet pool — upsert by publicKey, delete missing
  const beforeWallets = new Map((before.walletPool ?? []).map((w) => [w.publicKey, w]));
  const afterWallets = new Map((after.walletPool ?? []).map((w) => [w.publicKey, w]));
  const walletDeletes = [...beforeWallets.keys()].filter((k) => !afterWallets.has(k));
  if (walletDeletes.length) {
    await tx.delete(walletPool).where(inArray(walletPool.publicKey, walletDeletes));
  }
  for (const w of afterWallets.values()) {
    const prev = beforeWallets.get(w.publicKey);
    const secretKeyEnc = isEncrypted(w.secretKey) ? w.secretKey : encryptSecret(w.secretKey);
    if (!prev) {
      await tx.insert(walletPool).values({
        publicKey: w.publicKey,
        secretKey: secretKeyEnc,
        assignedTo: w.assignedTo ?? null,
      });
    } else if (prev.assignedTo !== w.assignedTo || JSON.stringify(prev) !== JSON.stringify(w)) {
      await tx
        .update(walletPool)
        .set({ secretKey: secretKeyEnc, assignedTo: w.assignedTo ?? null })
        .where(eq(walletPool.publicKey, w.publicKey));
    }
  }

  // Campaigns — composite PK (tokenMint, type)
  const campKey = (c: Campaign) => `${c.tokenMint}|${c.type}`;
  const beforeCampaigns = new Map((before.campaigns ?? []).map((c) => [campKey(c), c]));
  const afterCampaigns = new Map((after.campaigns ?? []).map((c) => [campKey(c), c]));
  for (const [k, c] of afterCampaigns) {
    const prev = beforeCampaigns.get(k);
    const row = {
      tokenMint: c.tokenMint,
      type: c.type,
      creatorWallet: c.creatorWallet,
      poolCapLamports: c.poolCapLamports,
      poolSpentLamports: c.poolSpentLamports,
      feesClaimedLamports: c.feesClaimedLamports ?? null,
      feeClaimCount: c.feeClaimCount ?? null,
      lastFeeClaimAt: c.lastFeeClaimAt ?? null,
      status: c.status,
      createdAt: c.createdAt,
      tokenInfo: c.tokenInfo ?? null,
      config: c.config,
    };
    if (!prev) {
      await tx.insert(campaigns).values(row);
    } else if (JSON.stringify(prev) !== JSON.stringify(c)) {
      await tx
        .update(campaigns)
        .set(row)
        .where(and(eq(campaigns.tokenMint, c.tokenMint), eq(campaigns.type, c.type)));
    }
  }
  for (const [k, c] of beforeCampaigns) {
    if (!afterCampaigns.has(k)) {
      await tx
        .delete(campaigns)
        .where(and(eq(campaigns.tokenMint, c.tokenMint), eq(campaigns.type, c.type)));
    }
  }

  // Reward payouts — PK id, mutable (status transitions)
  const beforePayouts = new Map((before.rewardPayouts ?? []).map((p) => [p.id, p]));
  const afterPayouts = new Map((after.rewardPayouts ?? []).map((p) => [p.id, p]));
  const payoutDeletes = [...beforePayouts.keys()].filter((k) => !afterPayouts.has(k));
  if (payoutDeletes.length) {
    await tx.delete(rewardPayouts).where(inArray(rewardPayouts.id, payoutDeletes));
  }
  for (const p of afterPayouts.values()) {
    const prev = beforePayouts.get(p.id);
    const row = {
      id: p.id,
      tokenMint: p.tokenMint,
      traderWallet: p.traderWallet,
      swapTxSig: p.swapTxSig,
      swapVolumeLamports: p.swapVolumeLamports,
      rewardLamports: p.rewardLamports,
      payoutTxSig: p.payoutTxSig,
      status: p.status,
      submittedAt: p.submittedAt ?? null,
      createdAt: p.createdAt,
      paidAt: p.paidAt ?? null,
      failedAttempts: p.failedAttempts ?? null,
      lastError: p.lastError ?? null,
      campaignType: p.campaignType ?? null,
    };
    if (!prev) {
      await tx.insert(rewardPayouts).values(row);
    } else if (JSON.stringify(prev) !== JSON.stringify(p)) {
      await tx.update(rewardPayouts).set(row).where(eq(rewardPayouts.id, p.id));
    }
  }

  // Append-only tables — insert items in after whose PK isn't in before.
  // These are never mutated or deleted by the callbacks.
  const beforeFraudIds = new Set((before.fraudDecisions ?? []).map((f) => f.id));
  const newFrauds = (after.fraudDecisions ?? []).filter((f) => !beforeFraudIds.has(f.id));
  if (newFrauds.length) {
    await tx.insert(fraudDecisions).values(
      newFrauds.map((f) => ({
        id: f.id,
        tokenMint: f.tokenMint,
        traderWallet: f.traderWallet,
        swapTxSig: f.swapTxSig,
        swapVolumeLamports: f.swapVolumeLamports,
        decision: f.decision,
        reasoning: f.reasoning,
        flags: f.flags,
        model: f.model,
        checkedAt: f.checkedAt,
        walletContext: f.walletContext,
      }))
    );
  }

  const beforeDepositSigs = new Set((before.campaignDeposits ?? []).map((d) => d.txSig));
  const newDeposits = (after.campaignDeposits ?? []).filter(
    (d) => !beforeDepositSigs.has(d.txSig)
  );
  if (newDeposits.length) {
    await tx.insert(campaignDeposits).values(newDeposits);
  }

  const beforeWithdrawalSigs = new Set(
    (before.campaignWithdrawals ?? []).map((w) => w.txSig)
  );
  const newWithdrawals = (after.campaignWithdrawals ?? []).filter(
    (w) => !beforeWithdrawalSigs.has(w.txSig)
  );
  if (newWithdrawals.length) {
    await tx.insert(campaignWithdrawals).values(newWithdrawals);
  }

  // Fee claim events — append-only, natural key = (tokenMint, createdAt, firstSig)
  const beforeFeeKeys = new Set((before.feeClaimEvents ?? []).map(keyFeeEvent));
  const newFeeEvents = (after.feeClaimEvents ?? []).filter(
    (e) => !beforeFeeKeys.has(keyFeeEvent(e))
  );
  if (newFeeEvents.length) {
    await tx.insert(feeClaimEvents).values(
      newFeeEvents.map((e) => ({
        tokenMint: e.tokenMint,
        claimedLamports: e.claimedLamports,
        signatures: e.signatures,
        source: e.source,
        createdAt: e.createdAt,
      }))
    );
  }

  // Swap cursors — Record<mint, number>
  const beforeSwap = before.swapCursors ?? {};
  const afterSwap = after.swapCursors ?? {};
  const swapDeletes = Object.keys(beforeSwap).filter((k) => !(k in afterSwap));
  if (swapDeletes.length) {
    await tx.delete(swapCursors).where(inArray(swapCursors.tokenMint, swapDeletes));
  }
  for (const [mint, value] of Object.entries(afterSwap)) {
    if (beforeSwap[mint] !== value) {
      await tx
        .insert(swapCursors)
        .values({ tokenMint: mint, value })
        .onConflictDoUpdate({
          target: swapCursors.tokenMint,
          set: { value },
        });
    }
  }

  // Holder snapshot cursors
  const beforeHolder = before.holderSnapshotCursors ?? {};
  const afterHolder = after.holderSnapshotCursors ?? {};
  const holderDeletes = Object.keys(beforeHolder).filter((k) => !(k in afterHolder));
  if (holderDeletes.length) {
    await tx
      .delete(holderSnapshotCursors)
      .where(inArray(holderSnapshotCursors.tokenMint, holderDeletes));
  }
  for (const [mint, value] of Object.entries(afterHolder)) {
    if (beforeHolder[mint] !== value) {
      await tx
        .insert(holderSnapshotCursors)
        .values({ tokenMint: mint, value })
        .onConflictDoUpdate({
          target: holderSnapshotCursors.tokenMint,
          set: { value },
        });
    }
  }

  // Agent heartbeat — singleton row
  if (before.agentHeartbeat !== after.agentHeartbeat && after.agentHeartbeat != null) {
    await tx
      .insert(agentMeta)
      .values({
        key: "heartbeat",
        valueNumber: after.agentHeartbeat,
        valueText: null,
        updatedAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: agentMeta.key,
        set: { valueNumber: after.agentHeartbeat, updatedAt: Date.now() },
      });
  }
}

/**
 * Atomic read-modify-write over a SERIALIZABLE Postgres transaction.
 * API mirrors the file-based `withStateLock` so call sites stay unchanged.
 *
 * On serialization failure (40001), Postgres aborts the tx and we let the
 * caller retry — just like the file-lock stale-lock break path.
 */
// Postgres raises SQLSTATE 40001 (serialization_failure) when a SERIALIZABLE
// transaction detects a cycle with a concurrent committer. Retrying is the
// standard remedy — each retry re-reads state under fresh locks.
const SERIALIZATION_FAILURE = "40001";
const MAX_RETRIES = 3;

async function retryOnSerializationFailure<T>(
  fn: () => Promise<T>
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code !== SERIALIZATION_FAILURE) throw err;
      lastErr = err;
      // Exponential backoff with jitter — keeps hot-path contention from
      // synchronising across parallel retriers.
      const delay = Math.min(50 * 2 ** attempt, 500) + Math.random() * 50;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export async function withStateLockDb(
  fn: (state: TendState) => void | Promise<void>
): Promise<TendState> {
  const db = getDb();
  return retryOnSerializationFailure(async () => {
    let out: TendState | undefined;
    await db.transaction(
      async (tx) => {
        const before = await loadStateFromTx(tx);
        // Deep clone so the callback's in-place mutations don't corrupt `before`.
        const after: TendState = structuredClone(before);
        await fn(after);
        await diffAndPersist(tx, before, after);
        out = after;
      },
      { isolationLevel: "serializable" }
    );
    return out!;
  });
}

async function loadStateFromTx(tx: Tx): Promise<TendState> {
  const [
    wallets,
    camps,
    payouts,
    frauds,
    deposits,
    withdrawals,
    feeEvents,
    swapCur,
    holderCur,
    heartRows,
  ] = await Promise.all([
    tx.select().from(walletPool),
    tx.select().from(campaigns),
    tx.select().from(rewardPayouts),
    tx.select().from(fraudDecisions),
    tx.select().from(campaignDeposits),
    tx.select().from(campaignWithdrawals),
    tx.select().from(feeClaimEvents),
    tx.select().from(swapCursors),
    tx.select().from(holderSnapshotCursors),
    tx.select().from(agentMeta).where(eq(agentMeta.key, "heartbeat")),
  ]);

  const state: TendState = {
    walletPool: wallets.map(rowToWallet).map((w) => ({
      ...w,
      secretKey: isEncrypted(w.secretKey) ? decryptSecret(w.secretKey) : w.secretKey,
    })),
    campaigns: camps.map(rowToCampaign).map(migrateCampaign),
    rewardPayouts: payouts.map(rowToRewardPayout),
    fraudDecisions: frauds.map(rowToFraudDecision),
    campaignDeposits: deposits.map(rowToCampaignDeposit),
    campaignWithdrawals: withdrawals.map(rowToCampaignWithdrawal),
    feeClaimEvents: feeEvents.map(rowToFeeClaimEvent),
    swapCursors: Object.fromEntries(swapCur.map((r) => [r.tokenMint, r.value])),
    holderSnapshotCursors: Object.fromEntries(
      holderCur.map((r) => [r.tokenMint, r.value])
    ),
  };
  const heart = heartRows[0]?.valueNumber;
  if (heart != null) state.agentHeartbeat = heart;
  return state;
}
