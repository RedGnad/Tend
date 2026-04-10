import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { TendState, WalletEntry } from "@tend/shared";
import { TEND_STATE_DIR, TEND_STATE_FILE } from "@tend/shared";

const TEND_DIR = join(homedir(), TEND_STATE_DIR);
const STATE_PATH = join(TEND_DIR, TEND_STATE_FILE);

export async function loadState(): Promise<TendState | null> {
  if (!existsSync(STATE_PATH)) return null;
  try {
    const raw = await readFile(STATE_PATH, "utf-8");
    return JSON.parse(raw);
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

  // Single source: walletPool in state.json
  return state.walletPool.find(
    (w) => w.assignedTo === `${serviceId}:${tokenMint}`
  );
}
