#!/usr/bin/env node
/**
 * End-to-end devnet validation for the Squads payout dispatcher.
 *
 * Self-contained: seeds a fake cashback campaign + a fake accrued payout
 * into state, provisions Squads custody on it, runs `payoutAccrued`, asserts
 * the payout flipped to "paid" via the Squads path, then cleans up.
 *
 * Safe to run repeatedly — uses a unique `SQUADSTEST_*` tokenMint per run
 * and always removes its test rows in a `finally` block.
 *
 * Dedicated env vars (NOT the prod ones — prevents using a mainnet RPC or
 * mainnet-admin key by accident).
 *
 * Creator keypair — ONE of these (checked in order):
 *   TEND_SQUADS_TEST_CREATOR_FILE  path to a JSON file with a "creator" field
 *                                  holding the secret key as a byte array
 *                                  (same format as the Phase 0 spike's
 *                                  squads-spike/keys.json)
 *   TEND_SQUADS_TEST_CREATOR       bs58 secret (matches test-squads-flow.ts)
 *
 * Other:
 *   TEND_SQUADS_TEST_RPC   defaults to https://api.devnet.solana.com, must
 *                          contain "devnet" for safety
 *   TEND_SQUADS_TEST_AGENT bs58 secret for a distinct agent key (optional —
 *                          else an ephemeral keypair is generated each run)
 *
 * Run:
 *   npm run build -w packages/agent && \
 *   node --env-file=.env.local packages/agent/build/test-squads-dispatch.js
 */

import { readFileSync } from "node:fs";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import {
  BagsClient,
  loadKeypair,
  type CashbackCampaign,
  type RewardPayout,
} from "@tend/shared";
import { withStateLock } from "./state-lock.js";
import { loadState } from "./state-reader.js";
import {
  ensureCreatorMultisig,
  provisionCampaignSquads,
} from "./squads-orchestrator.js";
import { payoutAccrued } from "./payout-executor.js";

function die(msg: string): never {
  // Throw instead of process.exit so the `main()` try/finally cleanup runs.
  // The top-level catch logs and exits with code 1.
  throw new Error(msg);
}

/**
 * Resolve the creator keypair from:
 *   1. TEND_SQUADS_TEST_CREATOR_FILE — JSON file path, e.g. the Phase 0 spike's
 *      squads-spike/keys.json. Expects `{ "creator": [<byte>, ...] }`.
 *   2. TEND_SQUADS_TEST_CREATOR     — bs58 secret string.
 *
 * The spike generated the creator keypair itself and persisted the secret
 * bytes to keys.json — user only ever saw the public key (to fund via
 * faucet), so the byte-array file path is the common case.
 */
function loadCreatorKeypair(): Keypair {
  const filePath = process.env.TEND_SQUADS_TEST_CREATOR_FILE;
  if (filePath) {
    let raw: string;
    try {
      raw = readFileSync(filePath, "utf-8");
    } catch (err) {
      die(
        `cannot read TEND_SQUADS_TEST_CREATOR_FILE="${filePath}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      die(
        `TEND_SQUADS_TEST_CREATOR_FILE="${filePath}" is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
      );
    }
    const creatorField =
      parsed && typeof parsed === "object" && "creator" in parsed
        ? (parsed as { creator: unknown }).creator
        : parsed;
    if (!Array.isArray(creatorField) || creatorField.length !== 64) {
      die(
        `TEND_SQUADS_TEST_CREATOR_FILE="${filePath}" missing a "creator" field with 64 secret-key bytes (got ${Array.isArray(creatorField) ? `array length ${creatorField.length}` : typeof creatorField})`
      );
    }
    return Keypair.fromSecretKey(Uint8Array.from(creatorField as number[]));
  }
  const bs58Secret = process.env.TEND_SQUADS_TEST_CREATOR;
  if (!bs58Secret) {
    die(
      "missing creator key — set TEND_SQUADS_TEST_CREATOR_FILE (path to keys.json) or TEND_SQUADS_TEST_CREATOR (bs58 secret)"
    );
  }
  return loadKeypair(bs58Secret);
}

async function main() {
  // Force file backend to keep this test OUT of any production Postgres DB.
  // state-lock/state-reader read TEND_STATE_BACKEND at call time, so setting
  // it here before the first withStateLock() call is sufficient.
  const originalBackend = process.env.TEND_STATE_BACKEND;
  process.env.TEND_STATE_BACKEND = "file";
  if (originalBackend === "db") {
    console.warn(
      "[test] TEND_STATE_BACKEND=db was set — overridden to `file` for this test to avoid polluting prod DB"
    );
  }

  const rpcUrl =
    process.env.TEND_SQUADS_TEST_RPC ?? "https://api.devnet.solana.com";
  if (!rpcUrl.includes("devnet")) {
    die(
      `refusing to run: TEND_SQUADS_TEST_RPC="${rpcUrl}" does not look like devnet. Provisioning a multisig on mainnet by accident would cost real SOL.`
    );
  }
  const network = "devnet" as const;

  const creator = loadCreatorKeypair();
  const connection = new Connection(rpcUrl, "confirmed");
  // BagsClient is only used by payoutAccrued → connection.getBalance / send*.
  // The Bags SDK is not exercised here so a dummy apiKey is fine.
  const bags = new BagsClient({
    apiKey: "dummy-not-used-by-this-test",
    rpcUrl,
    privateKey: creator,
  });

  const agent = process.env.TEND_SQUADS_TEST_AGENT
    ? Keypair.fromSecretKey(bs58.decode(process.env.TEND_SQUADS_TEST_AGENT))
    : Keypair.generate();
  // Bridge to the dispatcher's agent resolver, which reads TEND_AGENT_KEY at
  // call time. Scoped to this process — not persisted.
  process.env.TEND_AGENT_KEY = bs58.encode(agent.secretKey);
  if (!process.env.TEND_SQUADS_TEST_AGENT) {
    console.log(
      `[test] generated ephemeral agent key: ${agent.publicKey.toBase58()}`
    );
  }

  // Unique tokenMint per run — NOT a real mint, just an identifier in state.
  // The dispatcher never touches the mint on-chain (SOL payouts only), so a
  // synthetic string is safe here.
  const tokenMint = `SQUADSTEST${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const trader = Keypair.generate();
  const payoutId = `${tokenMint}-test`;
  const rewardLamports = BigInt(0.001 * LAMPORTS_PER_SOL);

  console.log("\n=== Squads dispatcher E2E (devnet) ===");
  console.log(`rpc:       ${rpcUrl}`);
  console.log(`network:   ${network}`);
  console.log(`creator:   ${creator.publicKey.toBase58()}`);
  console.log(`agent:     ${agent.publicKey.toBase58()}`);
  console.log(`trader:    ${trader.publicKey.toBase58()}`);
  console.log(`tokenMint: ${tokenMint}`);

  // Preflight solvency — Squads create + attach + vault fund + agent fund
  // ≈ 0.08 SOL. Reserve 0.02 for creator tx fees. Demand 0.1 minimum.
  const creatorBal = await connection.getBalance(creator.publicKey);
  console.log(`creator balance: ${creatorBal / LAMPORTS_PER_SOL} SOL`);
  if (creatorBal < 0.1 * LAMPORTS_PER_SOL) {
    die(
      `creator needs ≥ 0.1 SOL on devnet. Faucet ${creator.publicKey.toBase58()} via https://faucet.solana.com`
    );
  }

  // Defensive cleanup: prior runs that crashed (or had their finally skipped
  // by process.exit) can leave SQUADSTEST_* campaigns + accrued payouts in
  // state.json. payoutAccrued() would then pick them up with agent keys that
  // no longer match any SpendingLimit member → Unauthorized noise. Purge them
  // before seeding this run's rows.
  console.log("\n[0] purge stale SQUADSTEST_* rows…");
  let purged = { camps: 0, payouts: 0 };
  await withStateLock(async (s) => {
    const campsBefore = s.campaigns?.length ?? 0;
    const payoutsBefore = s.rewardPayouts?.length ?? 0;
    s.campaigns = (s.campaigns ?? []).filter(
      (c) => !c.tokenMint.startsWith("SQUADSTEST")
    );
    s.rewardPayouts = (s.rewardPayouts ?? []).filter(
      (p) => !p.tokenMint.startsWith("SQUADSTEST")
    );
    purged = {
      camps: campsBefore - s.campaigns.length,
      payouts: payoutsBefore - s.rewardPayouts.length,
    };
  });
  console.log(
    `    ✓ purged ${purged.camps} stale campaigns, ${purged.payouts} stale payouts`
  );

  let cleanupNeeded = false;
  try {
    // 1. Seed campaign.
    console.log("\n[1] seed fake cashback campaign in state…");
    await withStateLock(async (s) => {
      if (!s.campaigns) s.campaigns = [];
      const camp: CashbackCampaign = {
        tokenMint,
        type: "cashback",
        creatorWallet: creator.publicKey.toBase58(),
        poolCapLamports: String(0.05 * LAMPORTS_PER_SOL),
        poolSpentLamports: "0",
        status: "live",
        createdAt: Date.now(),
        config: { cashbackBps: 500 },
      };
      s.campaigns.push(camp);
    });
    cleanupNeeded = true;
    console.log("    ✓ campaign seeded");

    // 2. Provision Squads custody.
    console.log("\n[2] provision Squads custody (ensure + attach + fund)…");
    const ms = await ensureCreatorMultisig(connection, creator, network);
    console.log(`    multisigPda: ${ms.multisigPda}`);
    const result = await provisionCampaignSquads(
      connection,
      creator,
      agent.publicKey,
      network,
      {
        tokenMint,
        type: "cashback",
        amountLamports: BigInt(0.01 * LAMPORTS_PER_SOL),
        period: "day",
        initialFundingLamports: BigInt(0.02 * LAMPORTS_PER_SOL),
      }
    );
    console.log(`    vaultPda:         ${result.vaultPda}`);
    console.log(`    spendingLimitPda: ${result.spendingLimitPda}`);
    console.log(`    attachTx:         ${result.attachTxSig}`);

    // 3. Fund agent for tx fees.
    const agentBal = await connection.getBalance(agent.publicKey);
    if (agentBal < 0.005 * LAMPORTS_PER_SOL) {
      console.log("\n[3] fund agent (+0.01 SOL)…");
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: creator.publicKey,
          toPubkey: agent.publicKey,
          lamports: 0.01 * LAMPORTS_PER_SOL,
        })
      );
      const sig = await sendAndConfirmTransaction(connection, tx, [creator]);
      console.log(`    ✓ funded (${sig.slice(0, 12)})`);
    }

    // 4. Seed accrued payout.
    console.log("\n[4] seed accrued payout…");
    await withStateLock(async (s) => {
      if (!s.rewardPayouts) s.rewardPayouts = [];
      const p: RewardPayout = {
        id: payoutId,
        tokenMint,
        traderWallet: trader.publicKey.toBase58(),
        swapTxSig: "TEST_SWAP_SIG",
        swapVolumeLamports: String(0.02 * LAMPORTS_PER_SOL),
        rewardLamports: String(rewardLamports),
        payoutTxSig: null,
        status: "accrued",
        createdAt: Date.now(),
        campaignType: "cashback",
      };
      s.rewardPayouts.push(p);
    });
    console.log("    ✓ payout seeded (0.001 SOL, accrued)");

    // 5. Run the executor — the dispatcher MUST route this through Squads.
    // Note: state.json may contain unrelated accrued payouts from prior runs;
    // those get paid too (via the legacy admin path if not Squads-provisioned).
    // We assert on OUR payout specifically in step 6, not on the total count.
    console.log("\n[5] run payoutAccrued()…");
    const paid = await payoutAccrued(bags);
    console.log(`    paidCount: ${paid} (expected ≥ 1)`);
    if (paid < 1) {
      die(`expected paid ≥ 1, got paid=${paid}`);
    }

    // 6. Assertions.
    console.log("\n[6] assertions…");
    const stateAfter = await loadState();
    const payoutRow = (stateAfter?.rewardPayouts ?? []).find(
      (x) => x.id === payoutId
    );
    if (!payoutRow) die("payout row missing post-dispatch");
    if (payoutRow.status !== "paid")
      die(`expected status="paid", got "${payoutRow.status}"`);
    if (!payoutRow.payoutTxSig || payoutRow.payoutTxSig === "DRY_RUN")
      die(`expected real payoutTxSig, got "${payoutRow.payoutTxSig}"`);
    console.log(`    ✓ payout status=paid tx=${payoutRow.payoutTxSig}`);

    const traderBal = await connection.getBalance(trader.publicKey);
    if (BigInt(traderBal) < rewardLamports) {
      die(
        `trader received ${traderBal} lamports, expected ≥ ${rewardLamports}`
      );
    }
    console.log(
      `    ✓ trader received ${traderBal / LAMPORTS_PER_SOL} SOL (from vault)`
    );

    // Verify the campaign row got the Squads columns written.
    const campAfter = (stateAfter?.campaigns ?? []).find(
      (c) => c.tokenMint === tokenMint && c.type === "cashback"
    );
    if (!campAfter?.squadsSpendingLimitPda)
      die("campaign row missing squadsSpendingLimitPda after provision");
    if (campAfter.squadsSpendingLimitPda !== result.spendingLimitPda)
      die(
        `campaign.squadsSpendingLimitPda (${campAfter.squadsSpendingLimitPda}) != provision result (${result.spendingLimitPda})`
      );
    console.log(
      `    ✓ campaign row persisted squads*: vault[${campAfter.squadsVaultIndex}]`
    );

    // Verify squadsMultisigs registry has the creator entry.
    const msRow = (stateAfter?.squadsMultisigs ?? []).find(
      (m) => m.creatorWallet === creator.publicKey.toBase58()
    );
    if (!msRow) die("squadsMultisigs row missing for creator");
    if (msRow.nextVaultIndex <= (campAfter.squadsVaultIndex ?? 0))
      die(
        `nextVaultIndex (${msRow.nextVaultIndex}) not advanced past consumed vaultIndex (${campAfter.squadsVaultIndex})`
      );
    console.log(
      `    ✓ squadsMultisigs.nextVaultIndex advanced to ${msRow.nextVaultIndex}`
    );

    console.log("\n=== ✓ ALL ASSERTIONS PASSED ===");
    console.log("Inspect on Solscan (devnet):");
    console.log(`  multisig:       ${ms.multisigPda}`);
    console.log(`  vault:          ${result.vaultPda}`);
    console.log(`  spendingLimit:  ${result.spendingLimitPda}`);
    console.log(`  payout tx:      ${payoutRow.payoutTxSig}`);
  } finally {
    if (cleanupNeeded) {
      console.log("\n[cleanup] removing test campaign + payout rows…");
      await withStateLock(async (s) => {
        s.campaigns = (s.campaigns ?? []).filter(
          (c) => c.tokenMint !== tokenMint
        );
        s.rewardPayouts = (s.rewardPayouts ?? []).filter(
          (p) => p.tokenMint !== tokenMint
        );
      });
      console.log("    ✓ state cleaned");
      console.log(
        "    note: squadsMultisigs row for creator is KEPT (reusable for subsequent campaigns)"
      );
    }
  }
}

main().catch((err) => {
  console.error("\n[test-squads-dispatch] UNCAUGHT:", err);
  process.exit(1);
});
