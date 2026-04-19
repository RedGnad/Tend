import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  type Commitment,
  type TransactionInstruction,
} from "@solana/web3.js";
import * as multisig from "@sqds/multisig";

// ──── Constants ────────────────────────────────────────────────────────────

export const SQUADS_PROGRAM_ID = new PublicKey(multisig.PROGRAM_ADDRESS);

// Squads v4 convention: SOL-denominated SpendingLimits use Pubkey::default() as mint.
export const SQUADS_SOL_MINT = PublicKey.default;

export const SOL_DECIMALS = 9;

// Well-known Squads error codes surfaced by our flows. Extend as needed.
export const SQUADS_ERRORS = {
  TimeLockNotReleased: 6015,
  SpendingLimitExceeded: 6026,
  InvalidDestination: 6027,
} as const;

// ──── Period mapping ───────────────────────────────────────────────────────

export type SpendingPeriod = "oneTime" | "day" | "week" | "month";

function toSquadsPeriod(p: SpendingPeriod): multisig.generated.Period {
  switch (p) {
    case "oneTime":
      return multisig.generated.Period.OneTime;
    case "day":
      return multisig.generated.Period.Day;
    case "week":
      return multisig.generated.Period.Week;
    case "month":
      return multisig.generated.Period.Month;
  }
}

// ──── PDA derivation ───────────────────────────────────────────────────────

export function deriveMultisigPda(multisigCreateKey: PublicKey): PublicKey {
  const [pda] = multisig.getMultisigPda({ createKey: multisigCreateKey });
  return pda;
}

export function deriveVaultPda(
  multisigPda: PublicKey,
  index: number
): PublicKey {
  const [pda] = multisig.getVaultPda({ multisigPda, index });
  return pda;
}

export function deriveSpendingLimitPda(
  multisigPda: PublicKey,
  spendingLimitCreateKey: PublicKey
): PublicKey {
  const [pda] = multisig.getSpendingLimitPda({
    multisigPda,
    createKey: spendingLimitCreateKey,
  });
  return pda;
}

export interface CampaignPdas {
  multisigPda: PublicKey;
  vaultPda: PublicKey;
  spendingLimitPda: PublicKey;
}

export function deriveCampaignPdas(params: {
  multisigCreateKey: PublicKey;
  spendingLimitCreateKey: PublicKey;
  vaultIndex: number;
}): CampaignPdas {
  const multisigPda = deriveMultisigPda(params.multisigCreateKey);
  const vaultPda = deriveVaultPda(multisigPda, params.vaultIndex);
  const spendingLimitPda = deriveSpendingLimitPda(
    multisigPda,
    params.spendingLimitCreateKey
  );
  return { multisigPda, vaultPda, spendingLimitPda };
}

// ──── ProgramConfig (needed for multisig create) ───────────────────────────

export async function fetchProgramConfigTreasury(
  connection: Connection
): Promise<PublicKey> {
  const [pcPda] = multisig.getProgramConfigPda({});
  const pc = await multisig.accounts.ProgramConfig.fromAccountAddress(
    connection,
    pcPda
  );
  return pc.treasury;
}

// ──── Instruction builders (pure, no signing) ──────────────────────────────

export interface BuildCreateMultisigParams {
  creator: PublicKey;
  multisigCreateKey: PublicKey;
  programConfigTreasury: PublicKey;
}

export interface BuildCreateMultisigResult {
  ix: TransactionInstruction;
  multisigPda: PublicKey;
  vaultPda: PublicKey;
}

/**
 * Builds the `multisigCreateV2` ix for a 1-of-1 multisig with the creator as
 * sole Member + configAuthority. Note: `multisigCreateKey` MUST sign the tx.
 */
export function buildCreateMultisigIx(
  params: BuildCreateMultisigParams
): BuildCreateMultisigResult {
  const multisigPda = deriveMultisigPda(params.multisigCreateKey);
  const vaultPda = deriveVaultPda(multisigPda, 0);
  const ix = multisig.instructions.multisigCreateV2({
    treasury: params.programConfigTreasury,
    creator: params.creator,
    multisigPda,
    configAuthority: params.creator,
    threshold: 1,
    members: [
      {
        key: params.creator,
        permissions: multisig.types.Permissions.all(),
      },
    ],
    timeLock: 0,
    createKey: params.multisigCreateKey,
    rentCollector: null,
  });
  return { ix, multisigPda, vaultPda };
}

export interface BuildAttachSpendingLimitParams {
  creator: PublicKey; // must equal multisig configAuthority
  multisigPda: PublicKey;
  spendingLimitCreateKey: PublicKey; // seed only, NOT a signer
  vaultIndex: number;
  agentMember: PublicKey;
  amountLamports: bigint;
  period: SpendingPeriod;
  destinations?: PublicKey[]; // [] = any
}

export interface BuildAttachSpendingLimitResult {
  ix: TransactionInstruction;
  spendingLimitPda: PublicKey;
}

/**
 * Builds `multisigAddSpendingLimit` — direct call by configAuthority (no proposal flow).
 * Only `creator` needs to sign the resulting tx; `spendingLimitCreateKey` is a seed.
 */
export function buildAttachSpendingLimitIx(
  params: BuildAttachSpendingLimitParams
): BuildAttachSpendingLimitResult {
  const spendingLimitPda = deriveSpendingLimitPda(
    params.multisigPda,
    params.spendingLimitCreateKey
  );
  const ix = multisig.instructions.multisigAddSpendingLimit({
    multisigPda: params.multisigPda,
    spendingLimit: spendingLimitPda,
    configAuthority: params.creator,
    rentPayer: params.creator,
    createKey: params.spendingLimitCreateKey,
    vaultIndex: params.vaultIndex,
    mint: SQUADS_SOL_MINT,
    amount: params.amountLamports,
    period: toSquadsPeriod(params.period),
    members: [params.agentMember],
    destinations: params.destinations ?? [],
  });
  return { ix, spendingLimitPda };
}

export interface BuildRemoveSpendingLimitParams {
  creator: PublicKey; // multisig configAuthority
  multisigPda: PublicKey;
  spendingLimitPda: PublicKey;
  rentCollector?: PublicKey;
}

export function buildRemoveSpendingLimitIx(
  params: BuildRemoveSpendingLimitParams
): TransactionInstruction {
  return multisig.instructions.multisigRemoveSpendingLimit({
    multisigPda: params.multisigPda,
    spendingLimit: params.spendingLimitPda,
    configAuthority: params.creator,
    rentCollector: params.rentCollector ?? params.creator,
  });
}

export interface BuildPayoutParams {
  multisigPda: PublicKey;
  spendingLimitPda: PublicKey;
  agentMember: PublicKey; // must match SpendingLimit.members[i]
  vaultIndex: number;
  amountLamports: number; // SDK takes number for this arg
  destination: PublicKey;
  memo?: string;
}

/**
 * Builds `spending_limit_use` for a SOL payout. Agent signs the resulting tx.
 */
export function buildPayoutIx(params: BuildPayoutParams): TransactionInstruction {
  return multisig.instructions.spendingLimitUse({
    multisigPda: params.multisigPda,
    member: params.agentMember,
    spendingLimit: params.spendingLimitPda,
    vaultIndex: params.vaultIndex,
    amount: params.amountLamports,
    decimals: SOL_DECIMALS,
    destination: params.destination,
    // mint omitted = SOL
    memo: params.memo,
  });
}

export function buildFundVaultIx(params: {
  payer: PublicKey;
  vaultPda: PublicKey;
  lamports: number;
}): TransactionInstruction {
  return SystemProgram.transfer({
    fromPubkey: params.payer,
    toPubkey: params.vaultPda,
    lamports: params.lamports,
  });
}

// ──── Server-side send helpers (agent path) ────────────────────────────────

export async function sendIxs(
  connection: Connection,
  ixs: TransactionInstruction[],
  signers: Keypair[],
  commitment: Commitment = "confirmed"
): Promise<string> {
  const tx = new Transaction().add(...ixs);
  return sendAndConfirmTransaction(connection, tx, signers, { commitment });
}

/** Agent-side helper: sign + send `spending_limit_use`. Returns tx signature. */
export async function executePayout(
  connection: Connection,
  agent: Keypair,
  params: Omit<BuildPayoutParams, "agentMember">,
  commitment: Commitment = "confirmed"
): Promise<string> {
  const ix = buildPayoutIx({ ...params, agentMember: agent.publicKey });
  return sendIxs(connection, [ix], [agent], commitment);
}

// ──── Error parsing ────────────────────────────────────────────────────────

export interface ParsedSquadsError {
  code: number | null;
  name: string | null;
  raw: string;
}

export function parseSquadsError(err: unknown): ParsedSquadsError {
  const raw = err instanceof Error ? err.message : String(err);
  const match = raw.match(/Error Number: (\d+)/);
  const code = match ? parseInt(match[1], 10) : null;
  const name =
    code !== null
      ? (Object.entries(SQUADS_ERRORS).find(([, v]) => v === code)?.[0] ?? null)
      : null;
  return { code, name, raw };
}

export function isSpendingLimitExceeded(err: unknown): boolean {
  return parseSquadsError(err).code === SQUADS_ERRORS.SpendingLimitExceeded;
}
