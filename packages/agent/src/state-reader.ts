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

export async function loadState(): Promise<TendState | null> {
  if (!existsSync(STATE_PATH)) return null;
  try {
    const raw = await readFile(STATE_PATH, "utf-8");
    const state = JSON.parse(raw) as TendState;
    // Coerce any legacy campaign shapes into the Plan E discriminated union.
    if (state.campaigns) {
      state.campaigns = state.campaigns.map(migrateCampaign);
    }
    return state;
  } catch {
    return null;
  }
}

export async function getServiceWallet(
  serviceId: string,
  tokenMint: string
): Promise<WalletEntry | undefined> {
  const state = await loadState();
  if (!state) return undefined;

  const entry = state.walletPool.find(
    (w) => w.assignedTo === `${serviceId}:${tokenMint}`
  );
  if (entry && isEncrypted(entry.secretKey)) {
    entry.secretKey = decryptSecret(entry.secretKey);
  }
  return entry;
}
