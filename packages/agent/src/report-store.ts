import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { AnalyticsReport, AllocationRecommendation, TendState } from "@tend/shared";
import { TEND_STATE_DIR, TEND_STATE_FILE } from "@tend/shared";
import { log, logError } from "./logger.js";

const TEND_DIR = join(homedir(), TEND_STATE_DIR);
const STATE_PATH = join(TEND_DIR, TEND_STATE_FILE);

async function loadAndUpdate(fn: (state: TendState) => void): Promise<void> {
  if (!existsSync(TEND_DIR)) {
    await mkdir(TEND_DIR, { recursive: true });
  }

  let state: TendState = {
    managedTokens: {},
    walletPool: [],
    snapshots: [],
    decisions: [],
    reports: [],
    allocations: [],
  };

  if (existsSync(STATE_PATH)) {
    const raw = await readFile(STATE_PATH, "utf-8");
    state = JSON.parse(raw);
  }

  if (!state.reports) state.reports = [];
  if (!state.allocations) state.allocations = [];

  fn(state);

  await writeFile(STATE_PATH, JSON.stringify(state, null, 2));
}

export async function saveReport(report: AnalyticsReport): Promise<void> {
  try {
    await loadAndUpdate((state) => {
      state.reports.push(report);
      if (state.reports.length > 50) {
        state.reports = state.reports.slice(-50);
      }
    });
    log(`[report-store] Saved analytics report for ${report.tokenMint.slice(0, 8)}...`);
  } catch (err) {
    logError(`[report-store] Failed to save report:`, err);
  }
}

export async function saveAllocation(rec: AllocationRecommendation): Promise<void> {
  try {
    await loadAndUpdate((state) => {
      state.allocations.push(rec);
      if (state.allocations.length > 20) {
        state.allocations = state.allocations.slice(-20);
      }
    });
    log(`[report-store] Saved allocation recommendation for ${rec.tokenMint.slice(0, 8)}...`);
  } catch (err) {
    logError(`[report-store] Failed to save allocation:`, err);
  }
}
