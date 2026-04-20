import { VersionedTransaction, type Connection } from "@solana/web3.js";
import bs58 from "bs58";

export type ProvisionStep =
  | "signing"
  | "preparing"
  | "sending-multisig"
  | "confirming-multisig"
  | "sending-attach"
  | "confirming-attach"
  | "submitting"
  | "signing-sweep"
  | "sweeping";

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
 * Run the full Squads custody provisioning flow: multisig create (if needed),
 * SpendingLimit attach (+ optional wallet-funded seed), agent-side confirm,
 * and admin→vault sweep of the unspent pool.
 *
 * Requires the campaign to already exist in state (agent-side).
 *
 * Throws on any step's failure — the caller is responsible for surfacing
 * state (the campaign will be missing squads fields until confirm lands; after
 * confirm, missing sweep manifests as an empty vault that the admin must
 * complete later).
 */
export async function provisionSquadsCustody(args: {
  tokenMint: string;
  type: string;
  publicKeyB58: string;
  capLamports: bigint;
  period: SpendingPeriod;
  fundLamports?: bigint;
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
      ...(fundLamports ? { initialFundingLamports: fundLamports.toString() } : {}),
    }),
  });
  const prep = await prepRes.json().catch(() => ({}));
  if (!prepRes.ok) {
    throw new Error(prep.error || `Prepare failed (${prepRes.status})`);
  }
  const {
    multisigCreateTx,
    multisigCreateKey,
    attachTx,
    vaultIndex,
    spendingLimitCreateKey,
  } = prep as {
    multisigCreateTx: { transaction: string; blockhash: string } | null;
    multisigCreateKey: string | null;
    attachTx: { transaction: string; blockhash: string };
    vaultIndex: number;
    spendingLimitCreateKey: string;
  };
  if (!attachTx?.transaction || vaultIndex == null || !spendingLimitCreateKey) {
    throw new Error("Agent returned an incomplete prepare payload");
  }

  const signatures: string[] = [];
  let multisigCreateTxSig: string | null = null;

  if (multisigCreateTx) {
    onStep?.("sending-multisig");
    const tx1 = VersionedTransaction.deserialize(
      Buffer.from(multisigCreateTx.transaction, "base64")
    );
    const sig1 = await sendTransaction(tx1, connection);
    onStep?.("confirming-multisig");
    const latest1 = await connection.getLatestBlockhash("confirmed");
    await connection.confirmTransaction(
      {
        signature: sig1,
        blockhash: latest1.blockhash,
        lastValidBlockHeight: latest1.lastValidBlockHeight,
      },
      "confirmed"
    );
    multisigCreateTxSig = sig1;
    signatures.push(sig1);
    onSig?.(sig1);
  }

  onStep?.("sending-attach");
  const tx2 = VersionedTransaction.deserialize(
    Buffer.from(attachTx.transaction, "base64")
  );
  const sig2 = await sendTransaction(tx2, connection);
  onStep?.("confirming-attach");
  const latest2 = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction(
    {
      signature: sig2,
      blockhash: latest2.blockhash,
      lastValidBlockHeight: latest2.lastValidBlockHeight,
    },
    "confirmed"
  );
  signatures.push(sig2);
  onSig?.(sig2);

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
      multisigCreateTxSig,
      vaultIndex,
      spendingLimitCreateKey,
      attachTxSig: sig2,
      amountLamports: capLamports.toString(),
      period,
    }),
  });
  const conf = await confRes.json().catch(() => ({}));
  if (!confRes.ok) {
    throw new Error(conf.error || `Confirm failed (${confRes.status})`);
  }

  onStep?.("signing-sweep");
  const sweepTimestampMs = Date.now();
  const sweepMessage = buildAuthMessage({
    action: "squads-sweep",
    mint: tokenMint,
    type,
    timestampMs: sweepTimestampMs,
  });
  const sweepSigBytes = await signMessage(
    new TextEncoder().encode(sweepMessage)
  );
  const sweepSignatureB58 = bs58.encode(sweepSigBytes);

  onStep?.("sweeping");
  const sweepRes = await fetch(
    `/api/campaigns/${tokenMint}/squads-sweep`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        message: sweepMessage,
        signature: sweepSignatureB58,
        publicKey: publicKeyB58,
      }),
    }
  );
  const sweep = await sweepRes.json().catch(() => ({}));
  if (!sweepRes.ok) {
    throw new Error(sweep.error || `Sweep failed (${sweepRes.status})`);
  }
  if (sweep.txSig) {
    signatures.push(sweep.txSig);
    onSig?.(sweep.txSig);
  }

  return {
    multisigPda: conf.multisigPda,
    vaultPda: conf.vaultPda,
    spendingLimitPda: conf.spendingLimitPda,
    signatures,
  };
}
