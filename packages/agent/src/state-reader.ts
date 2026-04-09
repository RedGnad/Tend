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
  try {
    const raw = await readFile(STATE_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function loadWallets(): Promise<WalletEntry[]> {
  if (!existsSync(WALLETS_PATH)) return [];
  try {
    const raw = await readFile(WALLETS_PATH, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function getServiceWallet(
  serviceId: string,
  tokenMint: string
): Promise<WalletEntry | undefined> {
  // Check wallets.json first (legacy format)
  const wallets = await loadWallets();
  const fromWallets = wallets.find((w) => w.assignedTo === `${serviceId}:${tokenMint}`);
  if (fromWallets) return fromWallets;

  // Fall back to state.json serviceWallets (dashboard-created services)
  const state = await loadState();
  if (!state) return undefined;

  const token = state.managedTokens[tokenMint];
  if (!token) return undefined;

  const service = token.services.find((s) => s.serviceId === serviceId);
  if (!service) return undefined;

  const secret = state.serviceWallets?.[service.claimerWallet];
  if (!secret) return undefined;

  return {
    publicKey: service.claimerWallet,
    secretKey: secret,
    assignedTo: `${serviceId}:${tokenMint}`,
  };
}
