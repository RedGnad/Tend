#!/usr/bin/env node

import { createServer } from "node:http";
import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { BagsClient, loadKeypair, TEND_STATE_DIR, TEND_STATE_FILE } from "@tend/shared";
import { Scheduler } from "./scheduler.js";
import { log, logError } from "./logger.js";

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

  // HTTP server — health + state API for Vercel frontend
  const port = parseInt(process.env.PORT || "3001", 10);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    // CORS for Vercel frontend
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
      return;
    }

    if (url.pathname === "/state") {
      try {
        const { loadState } = await import("./state-reader.js");
        const state = await loadState();
        if (!state) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({}));
          return;
        }
        // Strip wallet secrets before sending
        const safe = {
          ...state,
          walletPool: state.walletPool?.map((w) => ({
            publicKey: w.publicKey,
            assignedTo: w.assignedTo,
          })),
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(safe));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to read state" }));
      }
      return;
    }

    // Default: health
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
  });
  server.listen(port, () => log(`HTTP server on :${port}`));

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
