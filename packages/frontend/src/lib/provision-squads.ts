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
  const confirmBody = JSON.stringify({
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
  });

  // The tx is already confirmed on-chain at this point. The backend /confirm
  // call only persists the DB row — it's idempotent and safe to lose the
  // response. Chrome surfaces transient fetch failures as ERR_NETWORK_CHANGED
  // / "Failed to fetch" even when the proxy → agent hop succeeded; we've seen
  // this in prod on fresh-launch tokens where /confirm took long enough to
  // get its response truncated. Recovery: poll the canonical campaigns
  // endpoint and match on `squadsAttachTxSig === sig` (unique per attempt).
  let conf: {
    multisigPda?: string;
    vaultPda?: string;
    spendingLimitPda?: string;
  } = {};
  try {
    const confRes = await fetch("/api/campaigns/provision-squads/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: confirmBody,
    });
    const body = await confRes.json().catch(() => ({}));
    if (!confRes.ok) {
      throw new Error(body.error || `Confirm failed (${confRes.status})`);
    }
    conf = body;
  } catch (confirmErr) {
    const recovered = await pollForProvisionedCampaign({
      wallet: publicKeyB58,
      txSig: sig,
      timeoutMs: 30_000,
    });
    if (!recovered) throw confirmErr;
    conf = recovered;
  }

  if (!conf.multisigPda || !conf.vaultPda || !conf.spendingLimitPda) {
    throw new Error("Confirm returned incomplete payload");
  }

  return {
    multisigPda: conf.multisigPda,
    vaultPda: conf.vaultPda,
    spendingLimitPda: conf.spendingLimitPda,
    signatures: [sig],
  };
}

async function pollForProvisionedCampaign(args: {
  wallet: string;
  txSig: string;
  timeoutMs: number;
}): Promise<{
  multisigPda: string;
  vaultPda: string;
  spendingLimitPda: string;
} | null> {
  const deadline = Date.now() + args.timeoutMs;
  let delay = 1000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(
        `/api/me/campaigns?wallet=${encodeURIComponent(args.wallet)}`,
        { cache: "no-store" }
      );
      if (res.ok) {
        const data = (await res.json()) as {
          campaigns?: Array<{
            squadsAttachTxSig?: string;
            squadsMultisigPda?: string;
            squadsVaultPda?: string;
            squadsSpendingLimitPda?: string;
          }>;
        };
        const hit = (data.campaigns ?? []).find(
          (c) => c.squadsAttachTxSig === args.txSig
        );
        if (
          hit?.squadsMultisigPda &&
          hit.squadsVaultPda &&
          hit.squadsSpendingLimitPda
        ) {
          return {
            multisigPda: hit.squadsMultisigPda,
            vaultPda: hit.squadsVaultPda,
            spendingLimitPda: hit.squadsSpendingLimitPda,
          };
        }
      }
    } catch {
      // swallow and retry until deadline
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(Math.floor(delay * 1.5), 3000);
  }
  return null;
}
