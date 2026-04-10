import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { TendState, ManagedToken } from "@tend/shared";

const STATE_PATH = join(homedir(), ".tend", "state.json");

export async function loadTendState(): Promise<TendState> {
  if (!existsSync(STATE_PATH)) {
    return { managedTokens: {}, walletPool: [], snapshots: [], decisions: [] };
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
