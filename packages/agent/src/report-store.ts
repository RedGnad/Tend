import type { AnalyticsReport, AllocationRecommendation } from "@tend/shared";
import { withStateLock } from "./state-lock.js";
import { log, logError } from "./logger.js";

export async function saveReport(report: AnalyticsReport): Promise<void> {
  try {
    await withStateLock((state) => {
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
    await withStateLock((state) => {
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
