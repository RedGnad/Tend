import {
  Connection,
  Keypair,
  PublicKey,
  type TransactionInstruction,
} from "@solana/web3.js";
import type {
  Campaign,
  CampaignType,
  RewardPayout,
  SquadsMultisigRecord,
} from "@tend/shared";
import {
  buildAttachSpendingLimitIx,
  buildCreateMultisigIx,
  buildFundVaultIx,
  deriveVaultPda,
  executePayout,
  fetchProgramConfigTreasury,
  isSpendingLimitExceeded,
  parseSquadsError,
  sendIxs,
  type SpendingPeriod,
} from "@tend/shared";
import { withStateLock } from "./state-lock.js";
import { loadState } from "./state-reader.js";
import { log, logError } from "./logger.js";

/**
 * Squads v4 orchestrator — agent-side wiring for the SpendingLimit custody
 * pattern validated in the Phase 0 spike and Phase 1 wrappers.
 *
 * Responsibilities:
 *   - `ensureCreatorMultisig`: idempotent one-off multisig creation per creator.
 *   - `provisionCampaignSquads`: attach a SpendingLimit + fund the vault for
 *     a campaign, consuming a fresh vaultIndex from the creator's multisig.
 *   - `executeSquadsPayout`: route a single RewardPayout through
 *     `spending_limit_use` using the agent member key.
 *
 * Network I/O is deliberately kept OUTSIDE `withStateLock` so we never hold
 * the serialisation boundary over multi-second RPC calls. The tradeoff is
 * that a crash between "tx landed" and "state persisted" leaves an orphan
 * multisig / funded vault. Orphans are recoverable manually (admin inspects
 * Solscan) and never cause double-spend, since campaign rows without
 * `squadsSpendingLimitPda` are routed through the legacy admin-transfer path
 * by the dispatcher.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface ProvisionParams {
  tokenMint: string;
  type: CampaignType;
  /** SpendingLimit cap per period */
  amountLamports: bigint;
  /** Reset cadence — "oneTime" means single use, no auto-reset */
  period: SpendingPeriod;
  /** Optional initial transfer from creator → vault to seed the pool */
  initialFundingLamports?: bigint;
  /** Optional whitelist of destinations; empty = any destination allowed */
  destinations?: PublicKey[];
}

export interface ProvisionResult {
  multisigPda: string;
  vaultIndex: number;
  vaultPda: string;
  spendingLimitPda: string;
  spendingLimitCreateKey: string;
  attachTxSig: string;
}

// ── ensureCreatorMultisig ──────────────────────────────────────────────────

async function findExistingMultisig(
  creatorWallet: string
): Promise<SquadsMultisigRecord | null> {
  const state = await loadState();
  return (
    state?.squadsMultisigs?.find((m) => m.creatorWallet === creatorWallet) ??
    null
  );
}

/**
 * Lazily provision a 1-of-1 multisig for `creator`, reusable across all
 * campaigns owned by that wallet. Idempotent — returns the existing record
 * when already persisted.
 *
 * `creator` signs + funds rent. `multisigCreateKey` is generated here and
 * persisted as a base58 pubkey seed (the secret is single-use and discarded
 * post-send, matching Squads convention).
 */
export async function ensureCreatorMultisig(
  connection: Connection,
  creator: Keypair,
  network: "devnet" | "mainnet-beta"
): Promise<SquadsMultisigRecord> {
  const creatorWallet = creator.publicKey.toBase58();
  const existing = await findExistingMultisig(creatorWallet);
  if (existing) {
    log(
      `[squads-orch] reuse multisig ${existing.multisigPda.slice(0, 10)}… for ${creatorWallet.slice(0, 8)}`
    );
    return existing;
  }

  const createKey = Keypair.generate();
  const treasury = await fetchProgramConfigTreasury(connection);
  const { ix, multisigPda } = buildCreateMultisigIx({
    creator: creator.publicKey,
    multisigCreateKey: createKey.publicKey,
    programConfigTreasury: treasury,
  });
  const sig = await sendIxs(connection, [ix], [creator, createKey]);
  log(
    `[squads-orch] created multisig ${multisigPda.toBase58()} for ${creatorWallet.slice(0, 8)} — tx ${sig.slice(0, 10)}`
  );

  const record: SquadsMultisigRecord = {
    creatorWallet,
    multisigPda: multisigPda.toBase58(),
    multisigCreateKey: createKey.publicKey.toBase58(),
    nextVaultIndex: 1,
    network,
    createdAt: Date.now(),
    createdTxSig: sig,
  };

  let raceLost = false;
  await withStateLock(async (s) => {
    if (!s.squadsMultisigs) s.squadsMultisigs = [];
    const already = s.squadsMultisigs.find(
      (m) => m.creatorWallet === creatorWallet
    );
    if (already) {
      // Concurrent writer beat us. Our on-chain multisig is orphaned — rent
      // (~0.002 SOL) is locked to the orphan PDA. Surface loudly so ops can
      // recover via Squads UI if needed.
      logError(
        `[squads-orch] RACE — orphan multisig ${record.multisigPda} for ${creatorWallet.slice(0, 8)}; using existing ${already.multisigPda}`
      );
      raceLost = true;
      return;
    }
    s.squadsMultisigs.push(record);
  });

  if (raceLost) {
    const existing2 = await findExistingMultisig(creatorWallet);
    if (!existing2)
      throw new Error(
        `[squads-orch] race-lost but existing record vanished for ${creatorWallet}`
      );
    return existing2;
  }
  return record;
}

// ── provisionCampaignSquads ────────────────────────────────────────────────

/**
 * Attach a SpendingLimit to the creator's multisig for a specific campaign,
 * consuming a fresh vaultIndex and optionally seeding the vault with SOL.
 *
 * MUST be called BEFORE the campaign starts accruing payouts — the dispatcher
 * decides which path to use based on `campaign.squadsSpendingLimitPda` being
 * set.
 *
 * Throws if the campaign row is missing, or if it already has Squads custody
 * attached (no re-provisioning — campaign can only be bound to one vault).
 */
export async function provisionCampaignSquads(
  connection: Connection,
  creator: Keypair,
  agentMember: PublicKey,
  network: "devnet" | "mainnet-beta",
  params: ProvisionParams
): Promise<ProvisionResult> {
  const creatorWallet = creator.publicKey.toBase58();

  // Preflight: the campaign must exist and belong to `creator`. Doing this
  // before any on-chain work avoids paying rent for a SpendingLimit whose
  // campaign row we can't write back to.
  const pre = await loadState();
  const camp = (pre?.campaigns ?? []).find(
    (c) => c.tokenMint === params.tokenMint && c.type === params.type
  );
  if (!camp) {
    throw new Error(
      `[squads-orch] campaign not found: ${params.tokenMint}/${params.type}`
    );
  }
  if (camp.creatorWallet !== creatorWallet) {
    throw new Error(
      `[squads-orch] creator mismatch: campaign owner ${camp.creatorWallet} != signer ${creatorWallet}`
    );
  }
  if (camp.squadsSpendingLimitPda) {
    throw new Error(
      `[squads-orch] campaign already has Squads custody: ${camp.squadsSpendingLimitPda}`
    );
  }

  // 1. Ensure multisig exists for this creator.
  const ms = await ensureCreatorMultisig(connection, creator, network);
  const multisigPda = new PublicKey(ms.multisigPda);
  const vaultIndex = ms.nextVaultIndex;
  const vaultPda = deriveVaultPda(multisigPda, vaultIndex);

  // 2. Build attach + optional fund-vault ixs. Spike validated both in one tx.
  const spendingLimitCreateKey = Keypair.generate();
  const { ix: attachIx, spendingLimitPda } = buildAttachSpendingLimitIx({
    creator: creator.publicKey,
    multisigPda,
    spendingLimitCreateKey: spendingLimitCreateKey.publicKey,
    vaultIndex,
    agentMember,
    amountLamports: params.amountLamports,
    period: params.period,
    destinations: params.destinations ?? [],
  });

  const ixs: TransactionInstruction[] = [attachIx];
  if (params.initialFundingLamports && params.initialFundingLamports > 0n) {
    ixs.push(
      buildFundVaultIx({
        payer: creator.publicKey,
        vaultPda,
        lamports: Number(params.initialFundingLamports),
      })
    );
  }

  const attachTxSig = await sendIxs(connection, ixs, [creator]);
  log(
    `[squads-orch] attached SpendingLimit ${spendingLimitPda.toBase58()} on vault[${vaultIndex}] ${vaultPda.toBase58().slice(0, 10)}… (cap ${params.amountLamports}/${params.period}) — tx ${attachTxSig.slice(0, 10)}`
  );

  // 3. Persist: consume vaultIndex + write campaign squads columns. If the
  // campaign vanished between preflight and here (unlikely), we log + throw;
  // the on-chain SpendingLimit is recoverable (creator can call
  // buildRemoveSpendingLimitIx to reclaim rent).
  const result: ProvisionResult = {
    multisigPda: ms.multisigPda,
    vaultIndex,
    vaultPda: vaultPda.toBase58(),
    spendingLimitPda: spendingLimitPda.toBase58(),
    spendingLimitCreateKey: spendingLimitCreateKey.publicKey.toBase58(),
    attachTxSig,
  };

  await withStateLock(async (s) => {
    const m = (s.squadsMultisigs ?? []).find(
      (x) => x.creatorWallet === creatorWallet
    );
    if (!m) {
      throw new Error(
        `[squads-orch] multisig record vanished post-attach for ${creatorWallet}`
      );
    }
    // Advance index so the next provisioning for this creator uses a fresh vault.
    // If another provisioning concurrently bumped the index past `vaultIndex`,
    // keep the max — we already burned `vaultIndex` on-chain anyway.
    m.nextVaultIndex = Math.max(m.nextVaultIndex, vaultIndex + 1);

    const c = (s.campaigns ?? []).find(
      (x) => x.tokenMint === params.tokenMint && x.type === params.type
    );
    if (!c) {
      throw new Error(
        `[squads-orch] campaign row vanished post-attach: ${params.tokenMint}/${params.type} — orphan SpendingLimit ${spendingLimitPda.toBase58()}`
      );
    }
    c.squadsMultisigPda = ms.multisigPda;
    c.squadsVaultIndex = vaultIndex;
    c.squadsVaultPda = vaultPda.toBase58();
    c.squadsSpendingLimitPda = spendingLimitPda.toBase58();
    c.squadsSpendingLimitCreateKey = spendingLimitCreateKey.publicKey.toBase58();
    c.squadsSpendingLimitAmountLamports = params.amountLamports.toString();
    c.squadsSpendingLimitPeriod = params.period;
    c.squadsAttachTxSig = attachTxSig;
  });

  return result;
}

// ── executeSquadsPayout ────────────────────────────────────────────────────

/**
 * Subset of fields the payout dispatcher needs from a Campaign. Defined
 * narrowly so the orchestrator doesn't leak the full discriminated union
 * into the executor.
 */
export interface CampaignSquadsRef {
  tokenMint: string;
  type: CampaignType;
  squadsMultisigPda: string;
  squadsVaultIndex: number;
  squadsSpendingLimitPda: string;
}

/**
 * Type-narrowing helper: returns the Squads ref if the campaign has been
 * provisioned, else null. Use this before calling `executeSquadsPayout` to
 * decide between Squads path and legacy admin transfer.
 */
export function getSquadsRef(campaign: Campaign): CampaignSquadsRef | null {
  if (
    !campaign.squadsMultisigPda ||
    campaign.squadsVaultIndex == null ||
    !campaign.squadsSpendingLimitPda
  ) {
    return null;
  }
  return {
    tokenMint: campaign.tokenMint,
    type: campaign.type,
    squadsMultisigPda: campaign.squadsMultisigPda,
    squadsVaultIndex: campaign.squadsVaultIndex,
    squadsSpendingLimitPda: campaign.squadsSpendingLimitPda,
  };
}

export interface SquadsPayoutResult {
  /** on-chain signature; null when `exceeded` is true */
  txSig: string | null;
  /** true when Squads rejected with SpendingLimitExceeded — caller should
   *  leave the payout in "accrued" for the next period reset */
  exceeded: boolean;
}

/**
 * Execute a single payout through the Squads SpendingLimit. Agent member key
 * must match the SpendingLimit's allowed member list.
 *
 * Returns `{ exceeded: true }` on SpendingLimitExceeded — this is expected
 * flow control (cap reached for the current period), not an error. The
 * caller should NOT increment failedAttempts on that case; the payout stays
 * "accrued" and retries on the next tick once the period window rolls over.
 *
 * Any other failure throws — caller bumps failedAttempts as usual.
 */
export async function executeSquadsPayout(
  connection: Connection,
  agent: Keypair,
  ref: CampaignSquadsRef,
  payout: RewardPayout
): Promise<SquadsPayoutResult> {
  try {
    const txSig = await executePayout(connection, agent, {
      multisigPda: new PublicKey(ref.squadsMultisigPda),
      spendingLimitPda: new PublicKey(ref.squadsSpendingLimitPda),
      vaultIndex: ref.squadsVaultIndex,
      amountLamports: Number(BigInt(payout.rewardLamports)),
      destination: new PublicKey(payout.traderWallet),
      memo: `tend-payout-${payout.id}`,
    });
    return { txSig, exceeded: false };
  } catch (err) {
    if (isSpendingLimitExceeded(err)) {
      const parsed = parseSquadsError(err);
      log(
        `[squads-orch] payout ${payout.id} hit SpendingLimitExceeded (code ${parsed.code}) — deferring to next period`
      );
      return { txSig: null, exceeded: true };
    }
    throw err;
  }
}
