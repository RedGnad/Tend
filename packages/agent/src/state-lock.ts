import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { TendState } from "@tend/shared";
import { TEND_STATE_DIR, TEND_STATE_FILE, encryptSecret, decryptSecret, isEncrypted } from "@tend/shared";

const TEND_DIR = join(homedir(), TEND_STATE_DIR);
const STATE_PATH = join(TEND_DIR, TEND_STATE_FILE);
const LOCK_PATH = join(TEND_DIR, "state.lock");
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_RETRY_MS = 50;

const DEFAULT_STATE: TendState = {
  managedTokens: {},
  walletPool: [],
  snapshots: [],
  decisions: [],
  reports: [],
  allocations: [],
  campaigns: [],
  rewardPayouts: [],
  swapCursors: {},
  fraudDecisions: [],
};

async function acquireLock(): Promise<void> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      // O_EXCL semantics — fails if file exists
      await writeFile(LOCK_PATH, String(process.pid), { flag: "wx" });
      return;
    } catch {
      // Check for stale lock (older than timeout)
      try {
        const { mtimeMs } = await import("node:fs").then((fs) =>
          fs.statSync(LOCK_PATH)
        );
        if (Date.now() - mtimeMs > LOCK_TIMEOUT_MS) {
          await unlink(LOCK_PATH).catch(() => {});
          continue;
        }
      } catch { /* lock disappeared, retry */ }
      await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
    }
  }
  // Timeout — force break stale lock and proceed
  await unlink(LOCK_PATH).catch(() => {});
  await writeFile(LOCK_PATH, String(process.pid), { flag: "wx" }).catch(() => {});
}

async function releaseLock(): Promise<void> {
  await unlink(LOCK_PATH).catch(() => {});
}

/**
 * Atomically read-modify-write state.json with file-level locking.
 * Safe across multiple processes (agent, MCP server, frontend).
 */
export async function withStateLock(
  fn: (state: TendState) => void | Promise<void>
): Promise<void> {
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

    // Ensure arrays exist
    if (!state.decisions) state.decisions = [];
    if (!state.reports) state.reports = [];
    if (!state.allocations) state.allocations = [];
    if (!state.pendingPrepares) state.pendingPrepares = [];
    if (!state.campaigns) state.campaigns = [];
    if (!state.rewardPayouts) state.rewardPayouts = [];
    if (!state.swapCursors) state.swapCursors = {};
    if (!state.fraudDecisions) state.fraudDecisions = [];

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
  } finally {
    await releaseLock();
  }
}
