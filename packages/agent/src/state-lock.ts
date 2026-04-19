import { readFile, writeFile, mkdir, unlink, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { TendState } from "@tend/shared";
import {
  TEND_STATE_DIR,
  TEND_STATE_FILE,
  encryptSecret,
  decryptSecret,
  isEncrypted,
  migrateCampaign,
} from "@tend/shared";

const TEND_DIR = join(homedir(), TEND_STATE_DIR);
const STATE_PATH = join(TEND_DIR, TEND_STATE_FILE);
const STATE_TMP = `${STATE_PATH}.tmp`;
const STATE_BAK = `${STATE_PATH}.corrupt`;
const SNAPSHOT_PATH = join(
  process.cwd(),
  "packages",
  "frontend",
  "public",
  "state-snapshot.json"
);
const LOCK_PATH = join(TEND_DIR, "state.lock");

async function loadStateOrFallback(): Promise<TendState> {
  if (!existsSync(STATE_PATH)) return { ...DEFAULT_STATE };
  const raw = await readFile(STATE_PATH, "utf-8");
  try {
    return JSON.parse(raw) as TendState;
  } catch (parseErr) {
    // state.json is corrupt. Quarantine it for forensics, then try the
    // snapshot bundled in frontend/public. If that's unreadable too, fall
    // back to DEFAULT_STATE so the agent keeps serving — better than a
    // restart loop that drops every payout in the queue.
    const errMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    console.error(`[tend-agent][state-lock] CORRUPT state.json — ${errMsg}`);
    try {
      await rename(STATE_PATH, STATE_BAK);
      console.error(`[tend-agent][state-lock] quarantined corrupt state at ${STATE_BAK}`);
    } catch { /* best effort */ }
    if (existsSync(SNAPSHOT_PATH)) {
      try {
        const snapRaw = await readFile(SNAPSHOT_PATH, "utf-8");
        const parsed = JSON.parse(snapRaw) as TendState;
        console.error(`[tend-agent][state-lock] recovered from snapshot ${SNAPSHOT_PATH}`);
        return parsed;
      } catch (snapErr) {
        const m = snapErr instanceof Error ? snapErr.message : String(snapErr);
        console.error(`[tend-agent][state-lock] snapshot also unreadable — ${m}`);
      }
    }
    console.error(`[tend-agent][state-lock] falling back to DEFAULT_STATE — campaigns/payouts will need to be replayed`);
    return { ...DEFAULT_STATE };
  }
}
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_RETRY_MS = 50;

const DEFAULT_STATE: TendState = {
  walletPool: [],
  campaigns: [],
  rewardPayouts: [],
  swapCursors: {},
  holderSnapshotCursors: {},
  fraudDecisions: [],
  campaignDeposits: [],
  squadsMultisigs: [],
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

function backend(): "file" | "db" {
  return process.env.TEND_STATE_BACKEND === "db" ? "db" : "file";
}

/**
 * Atomically read-modify-write state with a lock boundary.
 *
 * - `file` backend: flock-style lock on ~/.tend/state.json + atomic tmp+rename.
 * - `db` backend: SERIALIZABLE Postgres transaction via `@tend/shared/db`.
 *
 * Both backends expose the same mutation semantics to callers: the callback
 * receives a mutable TendState snapshot and diffs are persisted atomically
 * when it returns. Flip `TEND_STATE_BACKEND=db` on the agent to switch.
 */
export async function withStateLock(
  fn: (state: TendState) => void | Promise<void>
): Promise<void> {
  if (backend() === "db") {
    const { withStateLockDb } = await import("@tend/shared/db");
    await withStateLockDb(fn);
    return;
  }
  return withStateLockFile(fn);
}

async function withStateLockFile(
  fn: (state: TendState) => void | Promise<void>
): Promise<void> {
  await acquireLock();
  try {
    if (!existsSync(TEND_DIR)) {
      await mkdir(TEND_DIR, { recursive: true });
    }

    const state: TendState = await loadStateOrFallback();

    // Ensure arrays exist
    if (!state.walletPool) state.walletPool = [];
    if (!state.campaigns) state.campaigns = [];
    if (!state.rewardPayouts) state.rewardPayouts = [];
    if (!state.swapCursors) state.swapCursors = {};
    if (!state.holderSnapshotCursors) state.holderSnapshotCursors = {};
    if (!state.fraudDecisions) state.fraudDecisions = [];
    if (!state.campaignDeposits) state.campaignDeposits = [];
    if (!state.squadsMultisigs) state.squadsMultisigs = [];

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

    // Atomic write: tmp + rename. If the agent crashes mid-write, state.json
    // remains the previous valid file rather than a half-flushed partial
    // (which would parse-fail on next read and trigger the corrupt fallback).
    await writeFile(STATE_TMP, JSON.stringify(stateToWrite, null, 2));
    await rename(STATE_TMP, STATE_PATH);
  } finally {
    await releaseLock();
  }
}
