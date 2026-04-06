#!/usr/bin/env node

import { BagsClient, loadKeypair } from "@tend/shared";
import { Scheduler } from "./scheduler.js";
import { log, logError } from "./logger.js";

async function main() {
  const apiKey = process.env.BAGS_API_KEY;
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const privateKey = process.env.TEND_PRIVATE_KEY;

  if (!apiKey || !rpcUrl || !privateKey) {
    logError(
      "Missing required env vars: BAGS_API_KEY, SOLANA_RPC_URL, TEND_PRIVATE_KEY"
    );
    process.exit(1);
  }

  const keypair = loadKeypair(privateKey);
  log(`Agent wallet: ${keypair.publicKey.toBase58()}`);

  const bags = new BagsClient({
    apiKey,
    rpcUrl,
    privateKey: keypair,
  });

  const scheduler = new Scheduler(bags);
  scheduler.start();

  // Graceful shutdown
  const shutdown = () => {
    log("Shutting down...");
    scheduler.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  log("Tend Agent running. Press Ctrl+C to stop.");
}

main().catch((err) => {
  logError("Fatal:", err);
  process.exit(1);
});
