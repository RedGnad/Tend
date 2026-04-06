import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { TendState, WalletEntry } from "@tend/shared";
import { TEND_STATE_DIR, TEND_STATE_FILE, TEND_WALLETS_FILE } from "@tend/shared";

const TEND_DIR = join(homedir(), TEND_STATE_DIR);
const STATE_PATH = join(TEND_DIR, TEND_STATE_FILE);
const WALLETS_PATH = join(TEND_DIR, TEND_WALLETS_FILE);

export async function loadState(): Promise<TendState | null> {
  if (!existsSync(STATE_PATH)) return null;
  const raw = await readFile(STATE_PATH, "utf-8");
  return JSON.parse(raw);
}

export async function loadWallets(): Promise<WalletEntry[]> {
  if (!existsSync(WALLETS_PATH)) return [];
  const raw = await readFile(WALLETS_PATH, "utf-8");
  return JSON.parse(raw);
}

export async function getServiceWallet(
  serviceId: string,
  tokenMint: string
): Promise<WalletEntry | undefined> {
  const wallets = await loadWallets();
  return wallets.find((w) => w.assignedTo === `${serviceId}:${tokenMint}`);
}
