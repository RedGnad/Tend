#!/usr/bin/env node
/**
 * Devnet spike: can we land multisigCreateV2 + addSpendingLimit + fundVault in
 * a SINGLE versioned transaction?
 *
 * This validates the assumption that `addSpendingLimit` can read the
 * freshly-created multisig account in the same tx — Anchor's standard
 * `Account<'info, T>` deserialization happens at ix entry (after the prior
 * ix's writes committed), so it SHOULD work. But Squads v4 is external code;
 * we verify empirically before committing this pattern to the mainnet UX.
 *
 * Usage:
 *   TEND_SQUADS_TEST_CREATOR=<base58 secret>  (creator funded w/ ≥ 0.1 SOL devnet)
 *   RPC_URL=https://api.devnet.solana.com     (default)
 *   npx tsx packages/shared/src/scripts/spike-merged-provision.ts
 *
 * Exits 0 on success (Plan A viable), non-zero with error detail on failure.
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import {
  buildAttachSpendingLimitIx,
  buildCreateMultisigIx,
  buildFundVaultIx,
  deriveVaultPda,
  executePayout,
  fetchProgramConfigTreasury,
} from "../squads-client.js";

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const VAULT_INDEX = 1; // matches buildProvisionPrepare convention (vault[0] reserved)

function loadKp(env: string | undefined, label: string): Keypair {
  if (!env) {
    const kp = Keypair.generate();
    console.log(
      `[${label}] no env, generated fresh: ${kp.publicKey.toBase58()}`
    );
    return kp;
  }
  return Keypair.fromSecretKey(bs58.decode(env));
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");

  const creator = loadKp(process.env.TEND_SQUADS_TEST_CREATOR, "creator");
  const agent = loadKp(process.env.TEND_SQUADS_TEST_AGENT, "agent");
  const multisigCreateKey = Keypair.generate();
  const spendingLimitCreateKey = Keypair.generate();
  const destination = Keypair.generate();

  console.log("\n=== merged-provision spike (devnet) ===");
  console.log(`RPC: ${RPC_URL}`);
  console.log(`creator: ${creator.publicKey.toBase58()}`);
  console.log(`agent:   ${agent.publicKey.toBase58()}`);

  const creatorBal = await connection.getBalance(creator.publicKey);
  console.log(`creator balance: ${creatorBal / LAMPORTS_PER_SOL} SOL`);
  if (creatorBal < 0.1 * LAMPORTS_PER_SOL) {
    throw new Error(
      `Creator needs ≥ 0.1 SOL devnet. Fund ${creator.publicKey.toBase58()} via faucet.solana.com`
    );
  }

  // ── Build all three ixs ─────────────────────────────────────────────────
  const treasury = await fetchProgramConfigTreasury(connection);
  const { ix: createIx, multisigPda } = buildCreateMultisigIx({
    creator: creator.publicKey,
    multisigCreateKey: multisigCreateKey.publicKey,
    programConfigTreasury: treasury,
  });
  const vaultPda = deriveVaultPda(multisigPda, VAULT_INDEX);
  const { ix: attachIx, spendingLimitPda } = buildAttachSpendingLimitIx({
    creator: creator.publicKey,
    multisigPda,
    spendingLimitCreateKey: spendingLimitCreateKey.publicKey,
    vaultIndex: VAULT_INDEX,
    agentMember: agent.publicKey,
    amountLamports: BigInt(0.005 * LAMPORTS_PER_SOL),
    period: "day",
    destinations: [],
  });
  const fundIx = buildFundVaultIx({
    payer: creator.publicKey,
    vaultPda,
    lamports: Math.floor(0.02 * LAMPORTS_PER_SOL),
  });

  // ── Assemble into ONE versioned tx ──────────────────────────────────────
  console.log(`\n[build] multisigPda:      ${multisigPda.toBase58()}`);
  console.log(`[build] vaultPda[${VAULT_INDEX}]:     ${vaultPda.toBase58()}`);
  console.log(`[build] spendingLimitPda: ${spendingLimitPda.toBase58()}`);

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(
    "confirmed"
  );
  const msg = new TransactionMessage({
    payerKey: creator.publicKey,
    recentBlockhash: blockhash,
    instructions: [createIx, attachIx, fundIx],
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([creator, multisigCreateKey]);

  const serialized = tx.serialize();
  console.log(`[build] tx size: ${serialized.length} bytes (limit 1232)`);
  if (serialized.length > 1232) {
    throw new Error(`tx exceeds size limit: ${serialized.length} > 1232`);
  }

  // ── Send + confirm ──────────────────────────────────────────────────────
  console.log("\n[send] submitting merged tx…");
  const sig = await connection.sendRawTransaction(serialized, {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  console.log(`[send] tx: ${sig}`);
  await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed"
  );

  // ── Verify on-chain state ───────────────────────────────────────────────
  const msAcc = await connection.getAccountInfo(multisigPda, "confirmed");
  if (!msAcc) throw new Error("multisig account not found post-tx");
  console.log(`[verify] multisig owner:   ${msAcc.owner.toBase58()}`);

  const slAcc = await connection.getAccountInfo(spendingLimitPda, "confirmed");
  if (!slAcc) throw new Error("spendingLimit account not found post-tx");
  console.log(`[verify] spendingLimit owner: ${slAcc.owner.toBase58()}`);

  const vaultBal = await connection.getBalance(vaultPda, "confirmed");
  console.log(
    `[verify] vault balance: ${vaultBal / LAMPORTS_PER_SOL} SOL (expected ≥ 0.02)`
  );
  if (vaultBal < Math.floor(0.02 * LAMPORTS_PER_SOL)) {
    throw new Error(`vault underfunded: ${vaultBal}`);
  }

  // ── Smoke-test: agent uses SpendingLimit to send payout ─────────────────
  console.log("\n[payout] funding agent + executing test payout…");
  const agentBal = await connection.getBalance(agent.publicKey);
  if (agentBal < 0.01 * LAMPORTS_PER_SOL) {
    console.log(
      `    agent balance too low (${agentBal / LAMPORTS_PER_SOL} SOL) — funding`
    );
    const { blockhash: bh, lastValidBlockHeight: lvbh } =
      await connection.getLatestBlockhash("confirmed");
    const fundAgentMsg = new TransactionMessage({
      payerKey: creator.publicKey,
      recentBlockhash: bh,
      instructions: [
        buildFundVaultIx({
          payer: creator.publicKey,
          vaultPda: agent.publicKey,
          lamports: Math.floor(0.02 * LAMPORTS_PER_SOL),
        }),
      ],
    }).compileToV0Message();
    const fundAgentTx = new VersionedTransaction(fundAgentMsg);
    fundAgentTx.sign([creator]);
    const fsig = await connection.sendRawTransaction(fundAgentTx.serialize());
    await connection.confirmTransaction(
      { signature: fsig, blockhash: bh, lastValidBlockHeight: lvbh },
      "confirmed"
    );
  }

  const paySig = await executePayout(connection, agent, {
    multisigPda,
    spendingLimitPda,
    vaultIndex: VAULT_INDEX,
    amountLamports: Math.floor(0.002 * LAMPORTS_PER_SOL),
    destination: destination.publicKey,
    memo: "spike-merged-provision",
  });
  console.log(`[payout] tx: ${paySig}`);
  const destBal = await connection.getBalance(destination.publicKey, "confirmed");
  console.log(
    `[payout] destination received: ${destBal / LAMPORTS_PER_SOL} SOL`
  );
  if (destBal < Math.floor(0.002 * LAMPORTS_PER_SOL)) {
    throw new Error("payout did not credit destination");
  }

  console.log("\n=== ✓ PLAN A IS VIABLE — merged tx works on devnet ===");
  console.log("Artifacts:");
  console.log(`  multisig:      ${multisigPda.toBase58()}`);
  console.log(`  vault[${VAULT_INDEX}]:      ${vaultPda.toBase58()}`);
  console.log(`  spendingLimit: ${spendingLimitPda.toBase58()}`);
  console.log(`  mergedTx:      ${sig}`);
  console.log(`  payoutTx:      ${paySig}`);
}

main().catch((err) => {
  console.error("\n[spike] FAILED:", err);
  if (err?.logs) console.error("[spike] logs:", err.logs);
  process.exit(1);
});
