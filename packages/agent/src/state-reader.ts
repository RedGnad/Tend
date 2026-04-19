import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { TendState, WalletEntry } from "@tend/shared";
import {
  TEND_STATE_DIR,
  TEND_STATE_FILE,
  decryptSecret,
  isEncrypted,
  migrateCampaign,
} from "@tend/shared";

const TEND_DIR = join(homedir(), TEND_STATE_DIR);
const STATE_PATH = join(TEND_DIR, TEND_STATE_FILE);

/**
 * Backend dispatcher. Default is `file` so existing deploys keep using
 * ~/.tend/state.json. Flip `TEND_STATE_BACKEND=db` to read from Postgres.
 * Dynamic import keeps the `@tend/shared/db` module (and its Neon/ws deps)
 * out of cold-start when the file backend is active.
 */
function backend(): "file" | "db" {
  return process.env.TEND_STATE_BACKEND === "db" ? "db" : "file";
}

async function loadStateFromFile(): Promise<TendState | null> {
  if (!existsSync(STATE_PATH)) return null;
  try {
    const raw = await readFile(STATE_PATH, "utf-8");
    const state = JSON.parse(raw) as TendState;
    if (state.campaigns) {
      state.campaigns = state.campaigns.map(migrateCampaign);
    }
    return state;
  } catch {
    return null;
  }
}

export async function loadState(): Promise<TendState | null> {
  if (backend() === "db") {
    const { loadStateFromDb } = await import("@tend/shared/db");
    return loadStateFromDb();
  }
  return loadStateFromFile();
}

export async function getServiceWallet(
  serviceId: string,
  tokenMint: string
): Promise<WalletEntry | undefined> {
  const state = await loadState();
  if (!state) return undefined;

  const entry = (state.walletPool ?? []).find(
    (w) => w.assignedTo === `${serviceId}:${tokenMint}`
  );
  // File backend returns encrypted secrets; DB backend already decrypts on read.
  if (entry && isEncrypted(entry.secretKey)) {
    entry.secretKey = decryptSecret(entry.secretKey);
  }
  return entry;
}
