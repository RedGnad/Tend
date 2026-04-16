#!/usr/bin/env node

import { createServer } from "node:http";
import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { BagsClient, loadKeypair, TEND_STATE_DIR, TEND_STATE_FILE } from "@tend/shared";
import type { MarketSnapshot } from "@tend/shared";
import { Scheduler } from "./scheduler.js";
import { getAdvisorDecision } from "./ai-advisor.js";
import { saveDecision } from "./decision-store.js";
import { log, logError } from "./logger.js";

async function dryRun() {
  log("=== DRY RUN — testing AI advisor with simulated snapshot ===");

  const snapshot: MarketSnapshot = {
    price_sol: 0.000002,
    volume_24h_sol: 0,
    lifetime_fees_sol: 0.019,
    claimable_sol: 0.005,
    wallet_balance_sol: 0.01,
    holders: 4,
    fee_velocity: "low",
  };

  log(`Snapshot: ${JSON.stringify(snapshot)}`);

  const decision = await getAdvisorDecision(snapshot, "TEND");
  log(`Decision: ${JSON.stringify(decision)}`);

  await saveDecision({
    timestamp: Date.now(),
    tokenMint: "6qa9oCypYpnWZyZNQ8v36eLbmWmcgHRv4MuU7BXQBAGS",
    serviceId: "buyback-bot",
    inputs: snapshot,
    decision,
    execution: { executed: false, error: "dry-run mode" },
  });

  log("Decision saved to ~/.tend/state.json");
  log("=== DRY RUN COMPLETE ===");
}

async function main() {
  const apiKey = process.env.BAGS_API_KEY;
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const privateKey = process.env.TEND_PRIVATE_KEY;

  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey || !rpcUrl || !privateKey || !anthropicKey) {
    logError(
      "Missing required env vars: BAGS_API_KEY, SOLANA_RPC_URL, TEND_PRIVATE_KEY, ANTHROPIC_API_KEY"
    );
    process.exit(1);
  }

  // --dry-run: test AI advisor once with simulated data, then exit
  if (process.argv.includes("--dry-run")) {
    await dryRun();
    process.exit(0);
  }

  // Seed state from snapshot if missing (Render ephemeral disk)
  const stateDir = join(homedir(), TEND_STATE_DIR);
  const statePath = join(stateDir, TEND_STATE_FILE);
  if (!existsSync(statePath)) {
    const snapshotPath = join(
      process.cwd(),
      "packages",
      "frontend",
      "public",
      "state-snapshot.json"
    );
    if (existsSync(snapshotPath)) {
      mkdirSync(stateDir, { recursive: true });
      copyFileSync(snapshotPath, statePath);
      log(`Seeded state from snapshot`);
    }
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

  // Health server for Render free tier keep-alive
  const port = parseInt(process.env.PORT || "3001", 10);
  const server = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(port, () => log(`Health server on :${port}`));

  // Graceful shutdown
  const shutdown = () => {
    log("Shutting down...");
    scheduler.stop();
    server.close();
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
