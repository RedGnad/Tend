#!/usr/bin/env node

import { createServer } from "node:http";
import { existsSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  BagsClient,
  loadKeypair,
  TEND_STATE_DIR,
  TEND_STATE_FILE,
  verifyWalletSignature,
  parseAuthMessage,
  isTimestampFresh,
} from "@tend/shared";
import type { Campaign, CampaignDeposit } from "@tend/shared";
import { Scheduler } from "./scheduler.js";
import { withStateLock } from "./state-lock.js";
import { verifyDepositTx } from "./deposit-verifier.js";
import { log, logError } from "./logger.js";
import type { IncomingMessage } from "node:http";

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
    if (chunks.reduce((s, c) => s + c.length, 0) > 32_768) {
      throw new Error("Request body too large");
    }
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON body");
  }
}

interface MutationBody {
  type?: string;
  message?: string;
  signature?: string;
  publicKey?: string;
}

interface MutationResult {
  status: number;
  body: Record<string, unknown>;
}

async function handleCampaignMutation(
  mint: string,
  action: "pause" | "resume",
  raw: unknown
): Promise<MutationResult> {
  const body = raw as MutationBody;
  const { type, message, signature, publicKey } = body;

  if (!type || !message || !signature || !publicKey) {
    return {
      status: 400,
      body: { error: "Missing fields: type, message, signature, publicKey" },
    };
  }

  const parsed = parseAuthMessage(message);
  if (!parsed) {
    return { status: 400, body: { error: "Malformed auth message" } };
  }
  if (parsed.action !== action) {
    return { status: 400, body: { error: "Action mismatch with message" } };
  }
  if (parsed.mint !== mint) {
    return { status: 400, body: { error: "Mint mismatch with message" } };
  }
  if (parsed.type !== type) {
    return { status: 400, body: { error: "Type mismatch with message" } };
  }
  if (!isTimestampFresh(parsed.timestampMs)) {
    return { status: 401, body: { error: "Auth message expired" } };
  }
  if (!verifyWalletSignature(message, signature, publicKey)) {
    return { status: 401, body: { error: "Invalid signature" } };
  }

  type Outcome =
    | { ok: true; status: string }
    | { ok: false; httpStatus: number; error: string };
  const outcomeRef: { current: Outcome } = {
    current: { ok: false, httpStatus: 500, error: "unknown" },
  };

  await withStateLock((s) => {
    const c = (s.campaigns ?? []).find(
      (x) => x.tokenMint === mint && x.type === type
    );
    if (!c) {
      outcomeRef.current = { ok: false, httpStatus: 404, error: "Campaign not found" };
      return;
    }
    if (c.creatorWallet !== publicKey) {
      outcomeRef.current = {
        ok: false,
        httpStatus: 403,
        error: "Signer is not the campaign creator",
      };
      return;
    }

    if (action === "pause") {
      if (c.status === "paused") {
        outcomeRef.current = { ok: true, status: c.status };
        return;
      }
      c.status = "paused";
    } else {
      if (c.status === "live") {
        outcomeRef.current = { ok: true, status: c.status };
        return;
      }
      const remaining =
        BigInt(c.poolCapLamports) - BigInt(c.poolSpentLamports);
      c.status = remaining >= 100_000n ? "live" : "depleted";
    }
    outcomeRef.current = { ok: true, status: c.status };
  });

  const outcome = outcomeRef.current;
  if (!outcome.ok) {
    return { status: outcome.httpStatus, body: { error: outcome.error } };
  }
  log(
    `[http] ${action} ${type}:${mint.slice(0, 8)} by ${publicKey.slice(0, 8)} → ${outcome.status}`
  );
  return { status: 200, body: { ok: true, status: outcome.status } };
}

interface TopupBody {
  type?: string;
  message?: string;
  signature?: string;
  publicKey?: string;
  txSig?: string;
}

async function handleCampaignTopup(
  bags: BagsClient,
  adminWallet: string,
  mint: string,
  raw: unknown
): Promise<MutationResult> {
  const body = raw as TopupBody;
  const { type, message, signature, publicKey, txSig } = body;

  if (!type || !message || !signature || !publicKey || !txSig) {
    return {
      status: 400,
      body: { error: "Missing fields: type, message, signature, publicKey, txSig" },
    };
  }

  const parsed = parseAuthMessage(message);
  if (!parsed || parsed.action !== "topup") {
    return { status: 400, body: { error: "Malformed auth message or wrong action" } };
  }
  if (parsed.mint !== mint || parsed.type !== type) {
    return { status: 400, body: { error: "Message mint/type mismatch" } };
  }
  if (!isTimestampFresh(parsed.timestampMs)) {
    return { status: 401, body: { error: "Auth message expired" } };
  }
  if (!verifyWalletSignature(message, signature, publicKey)) {
    return { status: 401, body: { error: "Invalid signature" } };
  }

  // Anti-replay — reject any txSig already recorded
  // (checked again inside the write-lock to close the race)
  const { loadState } = await import("./state-reader.js");
  const current = await loadState();
  const existingDeposit = (current?.campaignDeposits ?? []).find(
    (d) => d.txSig === txSig
  );
  if (existingDeposit) {
    return { status: 409, body: { error: "This transaction was already applied" } };
  }

  // Verify on-chain deposit
  const check = await verifyDepositTx(bags, txSig, publicKey, adminWallet, 1n);
  if (!check.ok) {
    return { status: 400, body: { error: check.error } };
  }
  const amountLamports = check.amountLamports;

  type Outcome =
    | { ok: true; status: string; addedLamports: string }
    | { ok: false; httpStatus: number; error: string };
  const ref: { current: Outcome } = {
    current: { ok: false, httpStatus: 500, error: "unknown" },
  };

  await withStateLock((s) => {
    if (!s.campaignDeposits) s.campaignDeposits = [];
    if (s.campaignDeposits.some((d) => d.txSig === txSig)) {
      ref.current = { ok: false, httpStatus: 409, error: "Already applied (race)" };
      return;
    }
    const c = (s.campaigns ?? []).find(
      (x) => x.tokenMint === mint && x.type === type
    );
    if (!c) {
      ref.current = { ok: false, httpStatus: 404, error: "Campaign not found" };
      return;
    }
    if (c.creatorWallet !== publicKey) {
      ref.current = {
        ok: false,
        httpStatus: 403,
        error: "Signer is not the campaign creator",
      };
      return;
    }

    c.poolCapLamports = (BigInt(c.poolCapLamports) + amountLamports).toString();
    if (c.status !== "paused") {
      if (BigInt(c.poolCapLamports) - BigInt(c.poolSpentLamports) >= 100_000n) {
        c.status = "live";
      }
    }

    s.campaignDeposits.push({
      txSig,
      tokenMint: mint,
      campaignType: type as CampaignDeposit["campaignType"],
      fromWallet: publicKey,
      amountLamports: amountLamports.toString(),
      kind: "topup",
      createdAt: Date.now(),
    });

    ref.current = {
      ok: true,
      status: c.status,
      addedLamports: amountLamports.toString(),
    };
  });

  const outcome = ref.current;
  if (!outcome.ok) {
    return { status: outcome.httpStatus, body: { error: outcome.error } };
  }
  log(
    `[http] topup ${type}:${mint.slice(0, 8)} +${outcome.addedLamports} lamports (tx ${txSig.slice(0, 8)}…) → ${outcome.status}`
  );
  return {
    status: 200,
    body: {
      ok: true,
      status: outcome.status,
      addedLamports: outcome.addedLamports,
    },
  };
}

interface CreateBody {
  tokenMint?: string;
  type?: "cashback" | "holder" | "sprint";
  message?: string;
  signature?: string;
  publicKey?: string;
  txSig?: string;
  config?: Record<string, unknown>;
}

function buildCampaignFromBody(
  body: Required<Pick<CreateBody, "tokenMint" | "type" | "publicKey">> &
    Pick<CreateBody, "config">,
  poolCapLamports: string
): Campaign | { error: string } {
  const base = {
    tokenMint: body.tokenMint,
    creatorWallet: body.publicKey,
    poolCapLamports,
    poolSpentLamports: "0",
    status: "live" as const,
    createdAt: Date.now(),
  };
  const config = body.config ?? {};

  switch (body.type) {
    case "cashback": {
      const cashbackBps = Number(config.cashbackBps);
      if (!Number.isFinite(cashbackBps) || cashbackBps < 1 || cashbackBps > 2000) {
        return { error: "cashbackBps must be between 1 and 2000 (0.01%–20%)" };
      }
      return { ...base, type: "cashback", config: { cashbackBps } };
    }
    case "holder": {
      const rewardBps = Number(config.rewardBps);
      const minHoldHours = Number(config.minHoldHours);
      const snapshotCronHours = Number(config.snapshotCronHours);
      if (!Number.isFinite(rewardBps) || rewardBps < 1 || rewardBps > 2000) {
        return { error: "rewardBps must be between 1 and 2000" };
      }
      if (!Number.isFinite(minHoldHours) || minHoldHours < 0) {
        return { error: "minHoldHours must be ≥ 0" };
      }
      if (!Number.isFinite(snapshotCronHours) || snapshotCronHours < 1) {
        return { error: "snapshotCronHours must be ≥ 1" };
      }
      return {
        ...base,
        type: "holder",
        config: { rewardBps, minHoldHours, snapshotCronHours },
      };
    }
    case "sprint": {
      const minBuyLamports = String(config.minBuyLamports ?? "");
      const maxWinners = Number(config.maxWinners);
      const bonusLamports = String(config.bonusLamports ?? "");
      if (!minBuyLamports || !bonusLamports) {
        return { error: "minBuyLamports and bonusLamports required" };
      }
      if (!Number.isFinite(maxWinners) || maxWinners < 1) {
        return { error: "maxWinners must be ≥ 1" };
      }
      return {
        ...base,
        type: "sprint",
        config: { minBuyLamports, maxWinners, bonusLamports },
      };
    }
    default:
      return { error: "Unknown campaign type" };
  }
}

async function handleCampaignCreate(
  bags: BagsClient,
  adminWallet: string,
  raw: unknown
): Promise<MutationResult> {
  const body = raw as CreateBody;
  const { tokenMint, type, message, signature, publicKey, txSig, config } = body;

  if (!tokenMint || !type || !message || !signature || !publicKey || !txSig) {
    return {
      status: 400,
      body: {
        error:
          "Missing fields: tokenMint, type, message, signature, publicKey, txSig",
      },
    };
  }
  if (!["cashback", "holder", "sprint"].includes(type)) {
    return { status: 400, body: { error: "Invalid campaign type" } };
  }

  const parsed = parseAuthMessage(message);
  if (!parsed || parsed.action !== "create") {
    return { status: 400, body: { error: "Malformed auth message or wrong action" } };
  }
  if (parsed.mint !== tokenMint || parsed.type !== type) {
    return { status: 400, body: { error: "Message mint/type mismatch" } };
  }
  if (!isTimestampFresh(parsed.timestampMs)) {
    return { status: 401, body: { error: "Auth message expired" } };
  }
  if (!verifyWalletSignature(message, signature, publicKey)) {
    return { status: 401, body: { error: "Invalid signature" } };
  }

  // Verify on-chain deposit — at least 0.001 SOL so new campaigns can pay
  // at least one reward out of the gate.
  const check = await verifyDepositTx(bags, txSig, publicKey, adminWallet, 1_000_000n);
  if (!check.ok) {
    return { status: 400, body: { error: check.error } };
  }
  const amountLamports = check.amountLamports;

  type Outcome =
    | { ok: true; campaign: Campaign }
    | { ok: false; httpStatus: number; error: string };
  const ref: { current: Outcome } = {
    current: { ok: false, httpStatus: 500, error: "unknown" },
  };

  await withStateLock((s) => {
    if (!s.campaignDeposits) s.campaignDeposits = [];
    if (!s.campaigns) s.campaigns = [];

    if (s.campaignDeposits.some((d) => d.txSig === txSig)) {
      ref.current = { ok: false, httpStatus: 409, error: "This transaction was already applied" };
      return;
    }
    const conflicting = s.campaigns.find(
      (c) =>
        c.tokenMint === tokenMint &&
        c.type === type &&
        (c.status === "live" || c.status === "paused")
    );
    if (conflicting) {
      ref.current = {
        ok: false,
        httpStatus: 409,
        error: `A ${type} campaign on ${tokenMint.slice(0, 8)}… is already ${conflicting.status}`,
      };
      return;
    }

    const built = buildCampaignFromBody(
      { tokenMint, type, publicKey, config },
      amountLamports.toString()
    );
    if ("error" in built) {
      ref.current = { ok: false, httpStatus: 400, error: built.error };
      return;
    }

    s.campaigns.push(built);
    s.campaignDeposits.push({
      txSig,
      tokenMint,
      campaignType: type,
      fromWallet: publicKey,
      amountLamports: amountLamports.toString(),
      kind: "create",
      createdAt: Date.now(),
    });

    ref.current = { ok: true, campaign: built };
  });

  const outcome = ref.current;
  if (!outcome.ok) {
    return { status: outcome.httpStatus, body: { error: outcome.error } };
  }
  log(
    `[http] create ${type}:${tokenMint.slice(0, 8)} by ${publicKey.slice(0, 8)} +${amountLamports} lamports (tx ${txSig.slice(0, 8)}…)`
  );
  return { status: 200, body: { ok: true, campaign: outcome.campaign } };
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
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/state") {
      try {
        const { loadState } = await import("./state-reader.js");
        const state = await loadState();
        if (!state) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({}));
          return;
        }
        // Strip wallet secrets before sending; expose admin (fee destination)
        // pubkey so the frontend can build transfer txs for create/topup.
        const safe = {
          ...state,
          walletPool: state.walletPool?.map((w) => ({
            publicKey: w.publicKey,
            assignedTo: w.assignedTo,
          })),
          adminWallet: keypair.publicKey.toBase58(),
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(safe));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Failed to read state" }));
      }
      return;
    }

    // POST /campaigns/:mint/(pause|resume) — wallet-signed status flip
    const mutateMatch = url.pathname.match(
      /^\/campaigns\/([^/]+)\/(pause|resume)$/
    );
    if (req.method === "POST" && mutateMatch) {
      const [, mintParam, action] = mutateMatch;
      try {
        const body = await readJsonBody(req);
        const result = await handleCampaignMutation(
          mintParam,
          action as "pause" | "resume",
          body
        );
        res.writeHead(result.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result.body));
      } catch (err) {
        logError("[http] mutation error:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal error" }));
      }
      return;
    }

    // POST /campaigns/:mint/topup — SOL-funded pool bump
    const topupMatch = url.pathname.match(/^\/campaigns\/([^/]+)\/topup$/);
    if (req.method === "POST" && topupMatch) {
      const [, mintParam] = topupMatch;
      try {
        const body = await readJsonBody(req);
        const result = await handleCampaignTopup(
          bags,
          keypair.publicKey.toBase58(),
          mintParam,
          body
        );
        res.writeHead(result.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result.body));
      } catch (err) {
        logError("[http] topup error:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal error" }));
      }
      return;
    }

    // POST /campaigns — SOL-funded campaign creation
    if (req.method === "POST" && url.pathname === "/campaigns") {
      try {
        const body = await readJsonBody(req);
        const result = await handleCampaignCreate(
          bags,
          keypair.publicKey.toBase58(),
          body
        );
        res.writeHead(result.status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result.body));
      } catch (err) {
        logError("[http] create error:", err);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal error" }));
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
