#!/usr/bin/env node

/**
 * Launch $TEND token on Bags.fm
 *
 * Usage:
 *   npx tsx --env-file=.env packages/shared/src/scripts/launch-tend.ts
 *
 * Requires env vars: BAGS_API_KEY, SOLANA_RPC_URL, TEND_PRIVATE_KEY
 *
 * Steps:
 *   1. Create token info + metadata (name, symbol, image, socials)
 *   2. Create fee-share config (creator 40%, buyback 20%, community 20%, dev 20%)
 *   3. Launch token on bonding curve with initial buy
 */

import "dotenv/config";
import { PublicKey, Keypair } from "@solana/web3.js";
import { BagsClient } from "../bags-client.js";
import { loadKeypair, generateKeypair } from "../solana.js";
import { WSOL_MINT } from "../constants.js";

async function main() {
  const apiKey = process.env.BAGS_API_KEY;
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const privateKey = process.env.TEND_PRIVATE_KEY;

  if (!apiKey || !rpcUrl || !privateKey) {
    console.error(
      "Missing env vars: BAGS_API_KEY, SOLANA_RPC_URL, TEND_PRIVATE_KEY"
    );
    process.exit(1);
  }

  const keypair = loadKeypair(privateKey);
  console.log(`Launcher wallet: ${keypair.publicKey.toBase58()}`);

  const bags = new BagsClient({
    apiKey,
    rpcUrl,
    privateKey: keypair,
  });

  // Check balance
  const balance = await bags.connection.getBalance(keypair.publicKey);
  console.log(`Balance: ${(balance / 1e9).toFixed(4)} SOL`);

  if (balance < 0.05 * 1e9) {
    console.error("Need at least 0.05 SOL for launch + initial buy");
    process.exit(1);
  }

  // ── Step 1: Create token info ──
  console.log("\n1. Creating $TEND token info...");

  const tokenInfo = await bags.createTokenInfo({
    name: "Tend",
    symbol: "TEND",
    description:
      "Fee-sharing as a service. Tend transforms Bags.fm fee-sharing into a payment rail for autonomous AI services. Holders govern which services are available and their default allocations.",
    imageUrl:
      "https://raw.githubusercontent.com/RedGnad/Tend/main/assets/tend-logo.png",
    twitter: "https://x.com/TendProtocol",
    website: "https://github.com/RedGnad/Tend",
  });

  console.log(`   Token mint: ${tokenInfo.tokenMint}`);
  console.log(`   Metadata: ${tokenInfo.tokenMetadata}`);

  // ── Step 2: Create fee-share config ──
  console.log("\n2. Creating fee-share config...");

  // Generate service wallets for $TEND itself
  const buybackWallet = Keypair.generate();
  const communityWallet = Keypair.generate();
  const devWallet = Keypair.generate();

  console.log(`   Creator (40%):   ${keypair.publicKey.toBase58()}`);
  console.log(`   Buyback (20%):   ${buybackWallet.publicKey.toBase58()}`);
  console.log(`   Community (20%): ${communityWallet.publicKey.toBase58()}`);
  console.log(`   Dev (20%):       ${devWallet.publicKey.toBase58()}`);

  const configResult = await bags.createFeeShareConfig(
    tokenInfo.tokenMint,
    [
      { wallet: keypair.publicKey.toBase58(), bps: 4000 }, // Creator 40%
      { wallet: buybackWallet.publicKey.toBase58(), bps: 2000 }, // Buyback 20%
      { wallet: communityWallet.publicKey.toBase58(), bps: 2000 }, // Community 20%
      { wallet: devWallet.publicKey.toBase58(), bps: 2000 }, // Dev 20%
    ],
    keypair.publicKey.toBase58()
  );

  console.log(`   Config key: ${configResult.configKey}`);
  console.log(`   Signatures: ${configResult.signatures.length} tx(s)`);

  // ── Step 3: Launch token ──
  console.log("\n3. Launching $TEND on bonding curve...");

  const initialBuyLamports = 10_000_000; // 0.01 SOL initial buy

  const launchSig = await bags.launchToken({
    metadataUrl: tokenInfo.tokenMetadata,
    tokenMint: new PublicKey(tokenInfo.tokenMint),
    initialBuyLamports,
    configKey: new PublicKey(configResult.configKey),
  });

  console.log(`   Launch signature: ${launchSig}`);

  // ── Done ──
  console.log("\n✓ $TEND token launched successfully!");
  console.log(`\nToken mint: ${tokenInfo.tokenMint}`);
  console.log(`View on Bags: https://bags.fm/token/${tokenInfo.tokenMint}`);
  console.log(`View on Solscan: https://solscan.io/token/${tokenInfo.tokenMint}`);

  console.log("\n── Service Wallet Keys (SAVE THESE) ──");
  console.log(
    `Buyback:   ${Buffer.from(buybackWallet.secretKey).toString("base64")}`
  );
  console.log(
    `Community: ${Buffer.from(communityWallet.secretKey).toString("base64")}`
  );
  console.log(
    `Dev:       ${Buffer.from(devWallet.secretKey).toString("base64")}`
  );
}

main().catch((err) => {
  console.error("Launch failed:", err);
  process.exit(1);
});
