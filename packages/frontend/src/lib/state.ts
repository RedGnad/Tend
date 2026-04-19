import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { existsSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { TendState } from "@tend/shared";
import {
  encryptSecret,
  decryptSecret,
  isEncrypted,
  migrateCampaign,
} from "@tend/shared";

const TEND_DIR = join(homedir(), ".tend");
const STATE_PATH = join(TEND_DIR, "state.json");
const LOCK_PATH = join(TEND_DIR, "state.lock");
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_RETRY_MS = 50;

// Fallback snapshot committed to the repo — used on serverless (Vercel)
// where ~/.tend/state.json does not exist. The snapshot is generated
// locally via `npm run snapshot:state` and stripped of wallet secrets.
const SNAPSHOT_PATH = join(process.cwd(), "public", "state-snapshot.json");

const DEFAULT_STATE: TendState = {
  walletPool: [],
  campaigns: [],
  rewardPayouts: [],
  swapCursors: {},
  holderSnapshotCursors: {},
  fraudDecisions: [],
  campaignDeposits: [],
};

const AGENT_HEARTBEAT_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

export function isAgentRunning(): boolean {
  if (!existsSync(STATE_PATH)) return false;
  try {
    const raw = readFileSync(STATE_PATH, "utf-8");
    const state = JSON.parse(raw);
    if (!state.agentHeartbeat) return false;
    return Date.now() - state.agentHeartbeat < AGENT_HEARTBEAT_MAX_AGE_MS;
  } catch {
    return false;
  }
}

const AGENT_URL = process.env.TEND_AGENT_URL; // e.g. https://tend-agent.onrender.com

function backend(): "file" | "db" {
  return process.env.TEND_STATE_BACKEND === "db" ? "db" : "file";
}

export async function loadTendState(): Promise<TendState> {
  if (backend() === "db") {
    const { loadStateFromDb } = await import("@tend/shared/db");
    return loadStateFromDb();
  }
  // Prefer the live local file (agent machine / dev)
  if (existsSync(STATE_PATH)) {
    const raw = await readFile(STATE_PATH, "utf-8");
    const state = JSON.parse(raw) as TendState;
    if (state.campaigns) {
      state.campaigns = state.campaigns.map(migrateCampaign);
    }
    return state;
  }
  // Serverless (Vercel) — fetch live state from the agent
  if (AGENT_URL) {
    try {
      const res = await fetch(`${AGENT_URL}/state`, {
        next: { revalidate: 30 },
      } as RequestInit);
      if (res.ok) {
        const state = { ...DEFAULT_STATE, ...(await res.json()) as TendState };
        if (state.campaigns) {
          state.campaigns = state.campaigns.map(migrateCampaign);
        }
        return state;
      }
    } catch { /* fall through to snapshot */ }
  }
  // Last resort: committed snapshot
  if (existsSync(SNAPSHOT_PATH)) {
    const raw = await readFile(SNAPSHOT_PATH, "utf-8");
    const state = { ...DEFAULT_STATE, ...(JSON.parse(raw) as TendState) };
    if (state.campaigns) {
      state.campaigns = state.campaigns.map(migrateCampaign);
    }
    return state;
  }
  return { ...DEFAULT_STATE };
}

// ── File lock — same protocol as packages/agent/src/state-lock.ts ──

async function acquireLock(): Promise<void> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await writeFile(LOCK_PATH, String(process.pid), { flag: "wx" });
      return;
    } catch {
      try {
        const { mtimeMs } = statSync(LOCK_PATH);
        if (Date.now() - mtimeMs > LOCK_TIMEOUT_MS) {
          await unlink(LOCK_PATH).catch(() => {});
          continue;
        }
      } catch { /* lock disappeared, retry */ }
      await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
    }
  }
  await unlink(LOCK_PATH).catch(() => {});
  await writeFile(LOCK_PATH, String(process.pid), { flag: "wx" }).catch(() => {});
}

async function releaseLock(): Promise<void> {
  await unlink(LOCK_PATH).catch(() => {});
}

/**
 * Atomically read-modify-write state with a lock boundary.
 * File backend: shared ~/.tend/state.lock (cross-process with agent + MCP).
 * DB backend:   SERIALIZABLE Postgres transaction via @tend/shared/db.
 */
export async function withStateLock(
  fn: (state: TendState) => void | Promise<void>
): Promise<TendState> {
  if (backend() === "db") {
    const { withStateLockDb } = await import("@tend/shared/db");
    return withStateLockDb(fn);
  }
  return withStateLockFile(fn);
}

async function withStateLockFile(
  fn: (state: TendState) => void | Promise<void>
): Promise<TendState> {
  await acquireLock();
  try {
    if (!existsSync(TEND_DIR)) {
      await mkdir(TEND_DIR, { recursive: true });
    }

    let state: TendState = { ...DEFAULT_STATE };
    if (existsSync(STATE_PATH)) {
      const raw = await readFile(STATE_PATH, "utf-8");
      state = JSON.parse(raw);
    }

    if (!state.walletPool) state.walletPool = [];
    if (!state.campaigns) state.campaigns = [];
    if (!state.rewardPayouts) state.rewardPayouts = [];
    if (!state.swapCursors) state.swapCursors = {};
    if (!state.holderSnapshotCursors) state.holderSnapshotCursors = {};
    if (!state.fraudDecisions) state.fraudDecisions = [];
    if (!state.campaignDeposits) state.campaignDeposits = [];

    // Migrate legacy campaign shapes on read (Plan E discriminated union).
    state.campaigns = state.campaigns.map(migrateCampaign);

    // Decrypt wallet secrets for in-memory use
    for (const w of state.walletPool) {
      if (isEncrypted(w.secretKey)) {
        w.secretKey = decryptSecret(w.secretKey);
      }
    }

    await fn(state);

    // Encrypt wallet secrets before persisting
    const stateToWrite = {
      ...state,
      walletPool: state.walletPool.map((w) => ({
        ...w,
        secretKey: isEncrypted(w.secretKey) ? w.secretKey : encryptSecret(w.secretKey),
      })),
    };

    await writeFile(STATE_PATH, JSON.stringify(stateToWrite, null, 2));
    return state;
  } finally {
    await releaseLock();
  }
}
