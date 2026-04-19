#!/usr/bin/env node
/**
 * CLI to provision a Squads SpendingLimit on an existing campaign.
 *
 * The campaign row must already exist in state (via the normal MCP/API
 * create_campaign flow). This script:
 *   1. Ensures the creator's Squads multisig exists (creates on first run).
 *   2. Attaches a SpendingLimit bound to a fresh vaultIndex for the campaign.
 *   3. Optionally seeds the vault with SOL from the creator.
 *   4. Optionally executes one test payout to verify the agent key works.
 *
 * Once provisioned, the payout executor dispatches this campaign's accrued
 * payouts through the Squads path automatically.
 *
 * Usage:
 *   node --env-file=.env.local packages/agent/build/provision-squads.js \
 *     <tokenMint> <cashback|holder|sprint> <amountSol> <period> \
 *     [--fund <sol>] [--test-payout]
 *
 * Required env:
 *   TEND_PRIVATE_KEY  creator/admin keypair (bs58). Must equal campaign.creatorWallet.
 *   SOLANA_RPC_URL    RPC endpoint.
 *
 * Optional env:
 *   TEND_AGENT_KEY    separate member keypair (bs58). Defaults to admin key
 *                     — acceptable for dev, but the whole custody story
 *                     requires a distinct agent key in prod.
 *   TEND_NETWORK      "devnet" (default) | "mainnet-beta".
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
  loadKeypair,
  executePayout,
  isSpendingLimitExceeded,
  parseSquadsError,
  type SpendingPeriod,
} from "@tend/shared";
import {
  ensureCreatorMultisig,
  provisionCampaignSquads,
} from "./squads-orchestrator.js";
import { loadState } from "./state-reader.js";

type CampaignType = "cashback" | "holder" | "sprint";

interface Args {
  tokenMint: string;
  type: CampaignType;
  amountLamports: bigint;
  period: SpendingPeriod;
  fundLamports: bigint;
  testPayout: boolean;
}

function die(msg: string): never {
  console.error(`[provision-squads] ${msg}`);
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const flags = argv.filter((a) => a.startsWith("--"));

  if (positional.length < 4) {
    die(
      "usage: provision-squads <tokenMint> <cashback|holder|sprint> <amountSol> <oneTime|day|week|month> [--fund <sol>] [--test-payout]"
    );
  }

  const [tokenMint, typeRaw, amountRaw, periodRaw] = positional;
  if (!["cashback", "holder", "sprint"].includes(typeRaw)) {
    die(`bad type "${typeRaw}" — expected cashback|holder|sprint`);
  }
  if (!["oneTime", "day", "week", "month"].includes(periodRaw)) {
    die(`bad period "${periodRaw}" — expected oneTime|day|week|month`);
  }
  const amountSol = Number(amountRaw);
  if (!Number.isFinite(amountSol) || amountSol <= 0) {
    die(`bad amountSol "${amountRaw}" — expected positive number`);
  }

  let fundLamports = 0n;
  const fundIdx = flags.indexOf("--fund");
  // `--fund <sol>` uses the value AFTER the flag in the raw argv, not in
  // `flags` (which only contains `--…` tokens). Re-scan argv for the value.
  if (fundIdx !== -1) {
    const rawFund = argv[argv.indexOf("--fund") + 1];
    const n = Number(rawFund);
    if (!Number.isFinite(n) || n <= 0)
      die(`bad --fund value "${rawFund}" — expected positive SOL amount`);
    fundLamports = BigInt(Math.floor(n * LAMPORTS_PER_SOL));
  }

  return {
    tokenMint,
    type: typeRaw as CampaignType,
    amountLamports: BigInt(Math.floor(amountSol * LAMPORTS_PER_SOL)),
    period: periodRaw as SpendingPeriod,
    fundLamports,
    testPayout: flags.includes("--test-payout"),
  };
}

async function main() {
  const privateKey = process.env.TEND_PRIVATE_KEY;
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!privateKey || !rpcUrl) {
    die("missing env: TEND_PRIVATE_KEY, SOLANA_RPC_URL");
  }
  const network =
    process.env.TEND_NETWORK === "mainnet-beta" ? "mainnet-beta" : "devnet";

  const args = parseArgs(process.argv.slice(2));
  const creator = loadKeypair(privateKey);
  const connection = new Connection(rpcUrl, "confirmed");

  let agent: Keypair;
  if (process.env.TEND_AGENT_KEY) {
    agent = Keypair.fromSecretKey(bs58.decode(process.env.TEND_AGENT_KEY));
  } else {
    console.warn(
      "[provision-squads] TEND_AGENT_KEY unset — using creator key as agent (custody separation disabled)"
    );
    agent = creator;
  }

  console.log("\n=== Squads provisioning ===");
  console.log(`network:      ${network}`);
  console.log(`rpc:          ${rpcUrl}`);
  console.log(`creator:      ${creator.publicKey.toBase58()}`);
  console.log(`agent:        ${agent.publicKey.toBase58()}`);
  console.log(`tokenMint:    ${args.tokenMint}`);
  console.log(`type:         ${args.type}`);
  console.log(`cap:          ${Number(args.amountLamports) / LAMPORTS_PER_SOL} SOL / ${args.period}`);
  console.log(
    `fund vault:   ${args.fundLamports > 0n ? `${Number(args.fundLamports) / LAMPORTS_PER_SOL} SOL` : "no (skip)"}`
  );
  console.log(`test payout:  ${args.testPayout ? "yes" : "no"}`);

  // Preflight: campaign must exist.
  const state = await loadState();
  const camp = (state?.campaigns ?? []).find(
    (c) => c.tokenMint === args.tokenMint && c.type === args.type
  );
  if (!camp) {
    die(
      `campaign not found in state: ${args.tokenMint}/${args.type}. Create it first via MCP create_campaign or /api/campaigns/create.`
    );
  }
  if (camp.creatorWallet !== creator.publicKey.toBase58()) {
    die(
      `creator mismatch: campaign.creatorWallet=${camp.creatorWallet} signer=${creator.publicKey.toBase58()}`
    );
  }
  if (camp.squadsSpendingLimitPda) {
    die(
      `campaign already provisioned with SpendingLimit ${camp.squadsSpendingLimitPda}`
    );
  }

  // 1. Ensure multisig.
  console.log("\n[1] ensureCreatorMultisig…");
  const ms = await ensureCreatorMultisig(connection, creator, network);
  console.log(`    multisigPda:     ${ms.multisigPda}`);
  console.log(`    createTx:        ${ms.createdTxSig}`);
  console.log(`    nextVaultIndex:  ${ms.nextVaultIndex}`);

  // 2. Provision campaign (attach SpendingLimit + optional fund).
  console.log("\n[2] provisionCampaignSquads…");
  const result = await provisionCampaignSquads(
    connection,
    creator,
    agent.publicKey,
    network,
    {
      tokenMint: args.tokenMint,
      type: args.type,
      amountLamports: args.amountLamports,
      period: args.period,
      initialFundingLamports:
        args.fundLamports > 0n ? args.fundLamports : undefined,
    }
  );
  console.log(`    vaultIndex:       ${result.vaultIndex}`);
  console.log(`    vaultPda:         ${result.vaultPda}`);
  console.log(`    spendingLimitPda: ${result.spendingLimitPda}`);
  console.log(`    attachTx:         ${result.attachTxSig}`);

  // 3. Optional test payout — fund agent if needed, send 0.001 SOL back to
  // creator to verify the agent member key works.
  if (args.testPayout) {
    console.log("\n[3] test payout…");
    const testAmount = BigInt(0.001 * LAMPORTS_PER_SOL);
    if (testAmount > args.amountLamports) {
      die(
        `test amount (${testAmount}) exceeds SpendingLimit cap (${args.amountLamports})`
      );
    }
    if (args.fundLamports < testAmount) {
      die(
        `vault funding (${args.fundLamports}) < test amount (${testAmount}) — pass --fund ≥ 0.001`
      );
    }

    // Fund agent if low on SOL for tx fees.
    if (agent.publicKey.toBase58() !== creator.publicKey.toBase58()) {
      const agentBal = await connection.getBalance(agent.publicKey);
      if (agentBal < 0.005 * LAMPORTS_PER_SOL) {
        console.log(
          `    funding agent (+0.01 SOL) — current balance ${agentBal / LAMPORTS_PER_SOL} SOL`
        );
        const fundTx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: creator.publicKey,
            toPubkey: agent.publicKey,
            lamports: 0.01 * LAMPORTS_PER_SOL,
          })
        );
        const fsig = await sendAndConfirmTransaction(connection, fundTx, [
          creator,
        ]);
        console.log(`    agent funded — tx ${fsig}`);
      }
    }

    try {
      const sig = await executePayout(connection, agent, {
        multisigPda: new PublicKey(result.multisigPda),
        spendingLimitPda: new PublicKey(result.spendingLimitPda),
        vaultIndex: result.vaultIndex,
        amountLamports: Number(testAmount),
        destination: creator.publicKey,
        memo: "provision-squads-test",
      });
      console.log(`    test payout sent (0.001 SOL → creator) — tx ${sig}`);
    } catch (err) {
      if (isSpendingLimitExceeded(err)) {
        const p = parseSquadsError(err);
        die(
          `test payout rejected by SpendingLimit (code ${p.code}) — unexpected on first use`
        );
      }
      throw err;
    }
  }

  console.log("\n=== done ===");
  console.log(
    "Accrued payouts for this campaign will now dispatch through the Squads path automatically."
  );
}

main().catch((err) => {
  console.error("\n[provision-squads] FAILED:", err);
  process.exit(1);
});
