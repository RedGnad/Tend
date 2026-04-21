import { VersionedTransaction, type Connection } from "@solana/web3.js";
import bs58 from "bs58";

export type ProvisionStep =
  | "signing"
  | "preparing"
  | "sending"
  | "confirming"
  | "submitting";

export type SpendingPeriod = "oneTime" | "day" | "week" | "month";

export interface ProvisionResult {
  multisigPda: string;
  vaultPda: string;
  spendingLimitPda: string;
  signatures: string[];
}

// Kept in sync with buildAuthMessage in @tend/shared/wallet-auth — inlined
// client-side so the shared barrel's node:crypto dep doesn't leak into the
// browser bundle.
function buildAuthMessage(p: {
  action: string;
  mint: string;
  type: string;
  timestampMs: number;
}): string {
  return `tend:${p.action}:${p.mint}:${p.type}:${p.timestampMs}`;
}

/**
 * Wallet-sign flow for creating a campaign with Squads custody, compressed
 * into two popups:
 *   1. `signMessage` — unified auth (create + provision).
 *   2. `sendTransaction` — single merged versioned tx that calls
 *      `multisigCreateV2` (when needed) + `addSpendingLimit` + fundVault.
 *
 * The agent persists the campaign row only after the tx is confirmed on-chain,
 * so a cancelled or failed signature leaves no orphan state.
 */
export async function provisionSquadsCustody(args: {
  tokenMint: string;
  type: string;
  publicKeyB58: string;
  capLamports: bigint;
  period: SpendingPeriod;
  fundLamports?: bigint;
  /** Type-specific config — e.g. { cashbackBps, minSwapLamports? }. */
  campaignConfig: Record<string, unknown>;
  connection: Connection;
  signMessage: (msg: Uint8Array) => Promise<Uint8Array>;
  sendTransaction: (
    tx: VersionedTransaction,
    connection: Connection
  ) => Promise<string>;
  onStep?: (step: ProvisionStep) => void;
  onSig?: (sig: string) => void;
}): Promise<ProvisionResult> {
  const {
    tokenMint,
    type,
    publicKeyB58,
    capLamports,
    period,
    fundLamports,
    campaignConfig,
    connection,
    signMessage,
    sendTransaction,
    onStep,
    onSig,
  } = args;

  onStep?.("signing");
  const timestampMs = Date.now();
  const message = buildAuthMessage({
    action: "provision-squads",
    mint: tokenMint,
    type,
    timestampMs,
  });
  const sigBytes = await signMessage(new TextEncoder().encode(message));
  const signatureB58 = bs58.encode(sigBytes);

  onStep?.("preparing");
  const prepRes = await fetch("/api/campaigns/provision-squads/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tokenMint,
      type,
      message,
      signature: signatureB58,
      publicKey: publicKeyB58,
      amountLamports: capLamports.toString(),
      period,
      campaignConfig,
      ...(fundLamports ? { initialFundingLamports: fundLamports.toString() } : {}),
    }),
  });
  const prep = await prepRes.json().catch(() => ({}));
  if (!prepRes.ok) {
    throw new Error(prep.error || `Prepare failed (${prepRes.status})`);
  }
  const { mergedTx, multisigCreateKey, vaultIndex, spendingLimitCreateKey } =
    prep as {
      mergedTx: { transaction: string; blockhash: string };
      multisigCreateKey: string | null;
      vaultIndex: number;
      spendingLimitCreateKey: string;
    };
  if (!mergedTx?.transaction || vaultIndex == null || !spendingLimitCreateKey) {
    throw new Error("Agent returned an incomplete prepare payload");
  }

  onStep?.("sending");
  const tx = VersionedTransaction.deserialize(
    Buffer.from(mergedTx.transaction, "base64")
  );
  const sig = await sendTransaction(tx, connection);
  onStep?.("confirming");
  const latest = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction(
    {
      signature: sig,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    "confirmed"
  );
  onSig?.(sig);

  onStep?.("submitting");
  const confRes = await fetch("/api/campaigns/provision-squads/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tokenMint,
      type,
      message,
      signature: signatureB58,
      publicKey: publicKeyB58,
      multisigCreateKey,
      vaultIndex,
      spendingLimitCreateKey,
      mergedTxSig: sig,
      amountLamports: capLamports.toString(),
      period,
      campaignConfig,
    }),
  });
  const conf = await confRes.json().catch(() => ({}));
  if (!confRes.ok) {
    throw new Error(conf.error || `Confirm failed (${confRes.status})`);
  }

  return {
    multisigPda: conf.multisigPda,
    vaultPda: conf.vaultPda,
    spendingLimitPda: conf.spendingLimitPda,
    signatures: [sig],
  };
}
