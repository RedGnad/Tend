#!/usr/bin/env node
/**
 * One-off script: replace the buyback-bot's lost wallet with a new one.
 * 1. Generate new keypair
 * 2. Update on-chain fee-share config (with retry logic)
 * 3. Update state.json
 */
import {
  Connection,
  PublicKey,
  type Commitment,
} from "@solana/web3.js";
import { BagsClient, loadKeypair, generateKeypair } from "@tend/shared";
import { withStateLock } from "./state-lock.js";
import { log, logError } from "./logger.js";

const TEND_MINT = "6qa9oCypYpnWZyZNQ8v36eLbmWmcgHRv4MuU7BXQBAGS";
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 3000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendWithRetry(
  bags: BagsClient,
  tokenMint: string,
  claimers: Array<{ wallet: string; bps: number }>,
  connection: Connection,
  keypair: ReturnType<typeof loadKeypair>
): Promise<string[]> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    log(`Attempt ${attempt}/${MAX_RETRIES}...`);

    try {
      // Get fresh transactions from Bags API each attempt (fresh blockhash)
      const feeClaimers = claimers.map((c) => ({
        user: new PublicKey(c.wallet),
        userBps: c.bps,
      }));

      const txResults =
        await bags.sdk.feeShareAdmin.getUpdateConfigTransactions({
          feeClaimers,
          payer: keypair.publicKey,
          baseMint: new PublicKey(tokenMint),
        });

      log(`Got ${txResults.length} transaction(s) from API`);

      const signatures: string[] = [];

      for (let i = 0; i < txResults.length; i++) {
        const { transaction, blockhash } = txResults[i];

        // Sign
        transaction.sign([keypair]);

        // Send with retries at the RPC level
        const sig = await connection.sendTransaction(transaction, {
          skipPreflight: true,
          maxRetries: 3,
        });

        log(`Tx ${i + 1} sent: ${sig}`);

        // Confirm with the blockhash from the API
        const confirmation = await connection.confirmTransaction(
          {
            blockhash: blockhash.blockhash,
            lastValidBlockHeight: blockhash.lastValidBlockHeight,
            signature: sig,
          },
          "confirmed" as Commitment
        );

        if (confirmation.value.err) {
          throw new Error(`Tx ${i + 1} failed: ${JSON.stringify(confirmation.value.err)}`);
        }

        log(`Tx ${i + 1} confirmed: ${sig}`);
        signatures.push(sig);
      }

      return signatures;
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (msg.includes("expired") || msg.includes("block height")) {
        logError(`Attempt ${attempt} expired, retrying in ${RETRY_DELAY_MS}ms...`);
        if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS);
        continue;
      }
      throw err;
    }
  }

  throw new Error(`Failed after ${MAX_RETRIES} attempts`);
}

async function main() {
  const apiKey = process.env.BAGS_API_KEY;
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const privateKey = process.env.TEND_PRIVATE_KEY;

  if (!apiKey || !rpcUrl || !privateKey) {
    logError("Missing env vars: BAGS_API_KEY, SOLANA_RPC_URL, TEND_PRIVATE_KEY");
    process.exit(1);
  }

  const keypair = loadKeypair(privateKey);
  const connection = new Connection(rpcUrl, "confirmed");
  const bags = new BagsClient({ apiKey, rpcUrl, privateKey: keypair });

  log("=== FIX BUYBACK WALLET ===");
  log(`Admin wallet: ${keypair.publicKey.toBase58()}`);

  // Generate new wallet for buyback-bot
  const newWallet = generateKeypair();
  log(`New buyback wallet: ${newWallet.publicKey}`);

  // Step 1: Read state to build claimers (no mutation yet)
  let claimers: Array<{ wallet: string; bps: number }> = [];

  await withStateLock(async (state) => {
    const token = state.managedTokens[TEND_MINT];
    if (!token) throw new Error("Token not managed");

    const bbService = token.services.find((s) => s.serviceId === "buyback-bot");
    if (!bbService) throw new Error("buyback-bot service not found");

    log(`Old buyback wallet: ${bbService.claimerWallet}`);
    log(`BPS: ${bbService.bps}`);

    claimers = [
      { wallet: token.adminWallet, bps: token.creatorBps },
      ...token.services
        .filter((s) => s.status === "active")
        .map((s) => ({
          wallet: s.serviceId === "buyback-bot" ? newWallet.publicKey : s.claimerWallet,
          bps: s.bps,
        })),
    ];

    log(`Claimers: ${JSON.stringify(claimers.map(c => ({ wallet: c.wallet.slice(0, 8), bps: c.bps })))}`);
  });

  // Step 2: On-chain FIRST — with retry logic
  log("Sending on-chain fee-share update...");
  const sigs = await sendWithRetry(bags, TEND_MINT, claimers, connection, keypair);
  log(`On-chain update successful! Signatures: ${sigs.join(", ")}`);

  // Step 3: Persist state AFTER on-chain success
  await withStateLock(async (state) => {
    const token = state.managedTokens[TEND_MINT];
    if (!token) return;

    const bbService = token.services.find((s) => s.serviceId === "buyback-bot");
    if (bbService) {
      bbService.claimerWallet = newWallet.publicKey;
    }

    state.walletPool.push({
      publicKey: newWallet.publicKey,
      secretKey: newWallet.secretKey,
      assignedTo: `buyback-bot:${TEND_MINT}`,
    });
  });

  log("=== DONE ===");
  log(`Buyback bot now uses wallet: ${newWallet.publicKey}`);
  log("Restart the agent to pick up the new wallet.");
}

main().catch((err) => {
  logError("Fatal:", err);
  process.exit(1);
});
