#!/usr/bin/env node
/**
 * Devnet integration test for `squads-client` wrappers.
 *
 * Reproduces the Phase 0 spike flow using the monorepo wrappers (not raw SDK).
 * Confirms that `buildCreateMultisigIx`, `buildAttachSpendingLimitIx`,
 * `buildPayoutIx`, `buildFundVaultIx`, `parseSquadsError` work end-to-end.
 *
 * Usage:
 *   TEND_SQUADS_TEST_CREATOR=<base58 secret>  (creator funded w/ ≥ 0.1 SOL devnet)
 *   TEND_SQUADS_TEST_AGENT=<base58 secret>    (optional — agent signer)
 *   RPC_URL=https://api.devnet.solana.com     (default)
 *   npx tsx packages/shared/src/scripts/test-squads-flow.ts
 */

import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import {
  buildAttachSpendingLimitIx,
  buildCreateMultisigIx,
  buildFundVaultIx,
  buildPayoutIx,
  buildRemoveSpendingLimitIx,
  executePayout,
  fetchProgramConfigTreasury,
  isSpendingLimitExceeded,
  parseSquadsError,
  sendIxs,
  SQUADS_ERRORS,
} from "../squads-client.js";

const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";

function loadKp(env: string | undefined, label: string): Keypair {
  if (!env) {
    const kp = Keypair.generate();
    console.log(`[${label}] no env, generated fresh: ${kp.publicKey.toBase58()}`);
    return kp;
  }
  return Keypair.fromSecretKey(bs58.decode(env));
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");

  const creator = loadKp(process.env.TEND_SQUADS_TEST_CREATOR, "creator");
  const agent = loadKp(process.env.TEND_SQUADS_TEST_AGENT, "agent");
  const destination = Keypair.generate();
  const multisigCreateKey = Keypair.generate();
  const spendingLimitCreateKey = Keypair.generate();

  console.log("\n=== squads-client devnet integration test ===");
  console.log(`RPC: ${RPC_URL}`);
  console.log(`creator: ${creator.publicKey.toBase58()}`);
  console.log(`agent: ${agent.publicKey.toBase58()}`);
  console.log(`destination: ${destination.publicKey.toBase58()}`);

  const creatorBalance = await connection.getBalance(creator.publicKey);
  console.log(`creator balance: ${creatorBalance / LAMPORTS_PER_SOL} SOL`);
  if (creatorBalance < 0.1 * LAMPORTS_PER_SOL) {
    throw new Error(
      `Creator needs ≥ 0.1 SOL devnet. Fund ${creator.publicKey.toBase58()} via faucet.solana.com`
    );
  }

  // ── 1. Create multisig ───────────────────────────────────────────────────
  console.log("\n[1] Creating multisig via buildCreateMultisigIx…");
  const treasury = await fetchProgramConfigTreasury(connection);
  const { ix: createIx, multisigPda, vaultPda } = buildCreateMultisigIx({
    creator: creator.publicKey,
    multisigCreateKey: multisigCreateKey.publicKey,
    programConfigTreasury: treasury,
  });
  const createSig = await sendIxs(
    connection,
    [createIx],
    [creator, multisigCreateKey]
  );
  console.log(`    multisigPda: ${multisigPda.toBase58()}`);
  console.log(`    vaultPda:    ${vaultPda.toBase58()}`);
  console.log(`    tx:          ${createSig}`);

  // ── 2. Fund agent (tx fees) + vault (payout source) ──────────────────────
  console.log("\n[2] Funding agent + vault…");
  const agentBal = await connection.getBalance(agent.publicKey);
  if (agentBal < 0.01 * LAMPORTS_PER_SOL) {
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: creator.publicKey,
        toPubkey: agent.publicKey,
        lamports: 0.02 * LAMPORTS_PER_SOL,
      })
    );
    const sig = await sendAndConfirmTransaction(connection, tx, [creator]);
    console.log(`    agent funded (+0.02 SOL) — tx: ${sig}`);
  }
  const fundIx = buildFundVaultIx({
    payer: creator.publicKey,
    vaultPda,
    lamports: 0.05 * LAMPORTS_PER_SOL,
  });
  const fundSig = await sendIxs(connection, [fundIx], [creator]);
  console.log(`    vault funded (+0.05 SOL) — tx: ${fundSig}`);

  // ── 3. Attach SpendingLimit ──────────────────────────────────────────────
  console.log("\n[3] Attaching SpendingLimit via buildAttachSpendingLimitIx…");
  const { ix: attachIx, spendingLimitPda } = buildAttachSpendingLimitIx({
    creator: creator.publicKey,
    multisigPda,
    spendingLimitCreateKey: spendingLimitCreateKey.publicKey,
    vaultIndex: 0,
    agentMember: agent.publicKey,
    amountLamports: BigInt(0.01 * LAMPORTS_PER_SOL),
    period: "day",
    destinations: [],
  });
  const attachSig = await sendIxs(connection, [attachIx], [creator]);
  console.log(`    spendingLimitPda: ${spendingLimitPda.toBase58()}`);
  console.log(`    tx:               ${attachSig}`);

  // ── 4. Execute 3 payouts within cap (agent path) ─────────────────────────
  console.log("\n[4] Executing 3× payouts via executePayout…");
  const payoutAmount = Math.floor(0.003 * LAMPORTS_PER_SOL);
  for (let i = 0; i < 3; i++) {
    const sig = await executePayout(connection, agent, {
      multisigPda,
      spendingLimitPda,
      vaultIndex: 0,
      amountLamports: payoutAmount,
      destination: destination.publicKey,
      memo: `test-payout-${i + 1}`,
    });
    console.log(`    payout ${i + 1} (0.003 SOL) — tx: ${sig}`);
  }
  const destBal = await connection.getBalance(destination.publicKey);
  console.log(
    `    destination balance: ${destBal / LAMPORTS_PER_SOL} SOL (expected ≥ 0.009)`
  );
  if (destBal < 0.009 * LAMPORTS_PER_SOL) {
    throw new Error(`Destination under-received: ${destBal} lamports`);
  }

  // ── 5. Attempt 4th over-cap payout — expect SpendingLimitExceeded ───────
  console.log("\n[5] Attempting 4th over-cap payout (should be rejected)…");
  let caught: unknown = null;
  try {
    await executePayout(connection, agent, {
      multisigPda,
      spendingLimitPda,
      vaultIndex: 0,
      amountLamports: Math.floor(0.002 * LAMPORTS_PER_SOL),
      destination: destination.publicKey,
    });
    throw new Error("UNEXPECTED SUCCESS — over-cap payout should have been rejected");
  } catch (err) {
    caught = err;
  }
  const parsed = parseSquadsError(caught);
  console.log(`    parsed: code=${parsed.code} name=${parsed.name}`);
  if (parsed.code !== SQUADS_ERRORS.SpendingLimitExceeded) {
    throw new Error(
      `Expected SpendingLimitExceeded (${SQUADS_ERRORS.SpendingLimitExceeded}), got code=${parsed.code}`
    );
  }
  if (!isSpendingLimitExceeded(caught)) {
    throw new Error("isSpendingLimitExceeded returned false for SpendingLimitExceeded error");
  }
  console.log("    ✓ error parser correctly identified SpendingLimitExceeded");

  // ── 6. Remove SpendingLimit (cleanup) ────────────────────────────────────
  console.log("\n[6] Removing SpendingLimit via buildRemoveSpendingLimitIx…");
  const removeIx = buildRemoveSpendingLimitIx({
    creator: creator.publicKey,
    multisigPda,
    spendingLimitPda,
  });
  const removeSig = await sendIxs(connection, [removeIx], [creator]);
  console.log(`    tx: ${removeSig}`);

  console.log("\n=== ✓ ALL ASSERTIONS PASSED ===");
  console.log("Artifacts (devnet, Solscan-inspectable):");
  console.log(`  multisig:       ${multisigPda.toBase58()}`);
  console.log(`  vault:          ${vaultPda.toBase58()}`);
  console.log(`  spendingLimit:  ${spendingLimitPda.toBase58()} (removed)`);
}

main().catch((err) => {
  console.error("\n[test] FAILED:", err);
  process.exit(1);
});
