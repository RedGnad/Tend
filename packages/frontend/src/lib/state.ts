import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { TendState, ManagedToken } from "@tend/shared";

const TEND_DIR = join(homedir(), ".tend");
const STATE_PATH = join(TEND_DIR, "state.json");
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
};

export function isAgentRunning(): boolean {
  return existsSync(STATE_PATH);
}

export async function loadTendState(): Promise<TendState> {
  if (!existsSync(STATE_PATH)) {
    return { ...DEFAULT_STATE };
  }
  const raw = await readFile(STATE_PATH, "utf-8");
  return JSON.parse(raw);
}

export async function getManagedTokens(): Promise<ManagedToken[]> {
  const state = await loadTendState();
  return Object.values(state.managedTokens);
}

export async function getManagedToken(
  mint: string
): Promise<ManagedToken | null> {
  const state = await loadTendState();
  return state.managedTokens[mint] ?? null;
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
 * Atomically read-modify-write state.json with file-level locking.
 * Uses the same lock file as the agent runtime — safe cross-process.
 */
export async function withStateLock(
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

    if (!state.decisions) state.decisions = [];
    if (!state.reports) state.reports = [];
    if (!state.allocations) state.allocations = [];
    if (!state.walletPool) state.walletPool = [];

    await fn(state);

    await writeFile(STATE_PATH, JSON.stringify(state, null, 2));
    return state;
  } finally {
    await releaseLock();
  }
}
