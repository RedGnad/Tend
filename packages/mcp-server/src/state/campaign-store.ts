import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { TendState, Campaign, RewardPayout, FraudDecision } from "@tend/shared";
import { TEND_STATE_DIR, TEND_STATE_FILE, migrateCampaign } from "@tend/shared";

const TEND_DIR = join(homedir(), TEND_STATE_DIR);
const STATE_PATH = join(TEND_DIR, TEND_STATE_FILE);
const LOCK_PATH = join(TEND_DIR, "state.lock");
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_RETRY_MS = 50;

/**
 * Minimal read-modify-write helper for campaigns — shares the same lock file
 * as packages/agent/src/state-lock.ts and packages/frontend/src/lib/state.ts
 * so MCP + agent + frontend never clobber each other.
 *
 * Intentionally does NOT touch walletPool encryption — campaign tools never
 * read or write wallet secrets.
 */

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
      } catch {
        /* lock disappeared, retry */
      }
      await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
    }
  }
  await unlink(LOCK_PATH).catch(() => {});
  await writeFile(LOCK_PATH, String(process.pid), { flag: "wx" }).catch(() => {});
}

async function releaseLock(): Promise<void> {
  await unlink(LOCK_PATH).catch(() => {});
}

async function readStateRaw(): Promise<TendState> {
  if (!existsSync(STATE_PATH)) {
    return {
      managedTokens: {},
      walletPool: [],
      snapshots: [],
      decisions: [],
      reports: [],
      allocations: [],
      campaigns: [],
      rewardPayouts: [],
      fraudDecisions: [],
    };
  }
  const raw = await readFile(STATE_PATH, "utf-8");
  const state = JSON.parse(raw) as TendState;
  // Coerce legacy campaign shapes into the Plan E discriminated union.
  if (state.campaigns) {
    state.campaigns = state.campaigns.map(migrateCampaign);
  }
  return state;
}

async function mutate(fn: (state: TendState) => void | Promise<void>): Promise<void> {
  await acquireLock();
  try {
    if (!existsSync(TEND_DIR)) await mkdir(TEND_DIR, { recursive: true });
    const state = await readStateRaw();
    if (!state.campaigns) state.campaigns = [];
    if (!state.rewardPayouts) state.rewardPayouts = [];
    if (!state.fraudDecisions) state.fraudDecisions = [];
    await fn(state);
    await writeFile(STATE_PATH, JSON.stringify(state, null, 2));
  } finally {
    await releaseLock();
  }
}

export async function listCampaigns(): Promise<Campaign[]> {
  const state = await readStateRaw();
  return state.campaigns ?? [];
}

export async function getCampaign(tokenMint: string): Promise<Campaign | null> {
  const campaigns = await listCampaigns();
  return campaigns.find((c) => c.tokenMint === tokenMint) ?? null;
}

export async function upsertCampaign(campaign: Campaign): Promise<void> {
  await mutate(async (state) => {
    const idx = state.campaigns!.findIndex((c) => c.tokenMint === campaign.tokenMint);
    if (idx === -1) {
      state.campaigns!.push(campaign);
    } else {
      state.campaigns![idx] = campaign;
    }
  });
}

export async function updateCampaign(
  tokenMint: string,
  patch: (c: Campaign) => void
): Promise<Campaign | null> {
  let updated: Campaign | null = null;
  await mutate(async (state) => {
    const c = state.campaigns!.find((x) => x.tokenMint === tokenMint);
    if (!c) return;
    patch(c);
    updated = c;
  });
  return updated;
}

export interface CampaignStats {
  payoutsAllowed: number;
  payoutsPaid: number;
  payoutsFailed: number;
  totalPaidLamports: string;
  uniqueEarners: number;
  fraudAllowed: number;
  fraudRejected: number;
  fraudHeld: number;
}

export async function getCampaignStats(tokenMint: string): Promise<CampaignStats> {
  const state = await readStateRaw();
  const payouts: RewardPayout[] = (state.rewardPayouts ?? []).filter(
    (p) => p.tokenMint === tokenMint
  );
  const fraud: FraudDecision[] = (state.fraudDecisions ?? []).filter(
    (d) => d.tokenMint === tokenMint
  );

  const paid = payouts.filter((p) => p.status === "paid");
  const failed = payouts.filter((p) => p.status === "failed");
  const totalPaid = paid.reduce((sum, p) => sum + BigInt(p.rewardLamports), 0n);
  const earners = new Set(paid.map((p) => p.traderWallet)).size;

  return {
    payoutsAllowed: payouts.length,
    payoutsPaid: paid.length,
    payoutsFailed: failed.length,
    totalPaidLamports: totalPaid.toString(),
    uniqueEarners: earners,
    fraudAllowed: fraud.filter((d) => d.decision === "allow").length,
    fraudRejected: fraud.filter((d) => d.decision === "reject").length,
    fraudHeld: fraud.filter((d) => d.decision === "hold").length,
  };
}
