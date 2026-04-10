import type { BagsClient } from "@tend/shared";
import type { TendState } from "@tend/shared";
import { loadState } from "./state-reader.js";
import { runBuyback, type BuybackResult } from "./buyback-bot.js";
import { runFeeClaim, type ClaimResult } from "./fee-claimer.js";
import { runAnalytics } from "./analytics-engine.js";
import { runAllocationAdvisor } from "./allocation-advisor.js";
import { log, logError } from "./logger.js";

const BUYBACK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const CLAIM_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const ANALYTICS_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours
const ALLOCATION_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export class Scheduler {
  private buybackTimer?: ReturnType<typeof setInterval>;
  private claimTimer?: ReturnType<typeof setInterval>;
  private analyticsTimer?: ReturnType<typeof setInterval>;
  private allocationTimer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(private bags: BagsClient) {}

  start() {
    if (this.running) return;
    this.running = true;

    log("Scheduler started");
    log(`  Buyback interval: ${BUYBACK_INTERVAL_MS / 1000}s`);
    log(`  Claim interval: ${CLAIM_INTERVAL_MS / 1000}s`);
    log(`  Analytics interval: ${ANALYTICS_INTERVAL_MS / 1000}s`);
    log(`  Allocation interval: ${ALLOCATION_INTERVAL_MS / 1000}s`);

    // Run immediately, then on interval
    this.tickBuybacks();
    this.tickClaims();
    this.tickAnalytics();
    this.tickAllocations();

    this.buybackTimer = setInterval(
      () => this.tickBuybacks(),
      BUYBACK_INTERVAL_MS
    );
    this.claimTimer = setInterval(
      () => this.tickClaims(),
      CLAIM_INTERVAL_MS
    );
    this.analyticsTimer = setInterval(
      () => this.tickAnalytics(),
      ANALYTICS_INTERVAL_MS
    );
    this.allocationTimer = setInterval(
      () => this.tickAllocations(),
      ALLOCATION_INTERVAL_MS
    );
  }

  stop() {
    if (!this.running) return;
    this.running = false;

    if (this.buybackTimer) clearInterval(this.buybackTimer);
    if (this.claimTimer) clearInterval(this.claimTimer);
    if (this.analyticsTimer) clearInterval(this.analyticsTimer);
    if (this.allocationTimer) clearInterval(this.allocationTimer);

    log("Scheduler stopped");
  }

  private async tickBuybacks() {
    const state = await loadState();
    if (!state) return;

    const tokens = Object.values(state.managedTokens);
    if (tokens.length === 0) return;

    log(`[tick:buyback] Processing ${tokens.length} token(s)`);

    const results: BuybackResult[] = [];

    for (const token of tokens) {
      const buybackService = token.services.find(
        (s) => s.serviceId === "buyback-bot" && s.status === "active"
      );
      if (!buybackService) continue;

      const result = await runBuyback(
        this.bags,
        token.tokenMint,
        buybackService
      );
      results.push(result);
    }

    const successful = results.filter((r) => r.swapped);
    if (successful.length > 0) {
      log(
        `[tick:buyback] ${successful.length} buyback(s) executed`
      );
    }
  }

  private async tickClaims() {
    const state = await loadState();
    if (!state) return;

    const tokens = Object.values(state.managedTokens);
    if (tokens.length === 0) return;

    log(`[tick:claim] Processing ${tokens.length} token(s)`);

    const results: ClaimResult[] = [];

    for (const token of tokens) {
      for (const service of token.services) {
        if (service.status !== "active") continue;
        // Skip buyback-bot — it handles its own claims
        if (service.serviceId === "buyback-bot") continue;

        const result = await runFeeClaim(
          this.bags,
          token.tokenMint,
          service
        );
        results.push(result);
      }
    }

    const claimed = results.filter((r) => r.claimed);
    if (claimed.length > 0) {
      log(`[tick:claim] ${claimed.length} claim(s) processed`);
    }
  }

  private async tickAnalytics() {
    const state = await loadState();
    if (!state) return;

    const tokens = Object.values(state.managedTokens);
    if (tokens.length === 0) return;

    log(`[tick:analytics] Processing ${tokens.length} token(s)`);

    for (const token of tokens) {
      // Analytics runs for all managed tokens, regardless of service config
      await runAnalytics(this.bags, token.tokenMint);
    }
  }

  private async tickAllocations() {
    const state = await loadState();
    if (!state) return;

    const tokens = Object.values(state.managedTokens);
    if (tokens.length === 0) return;

    log(`[tick:allocation] Processing ${tokens.length} token(s)`);

    for (const token of tokens) {
      if (token.services.length === 0) continue;
      await runAllocationAdvisor(token.tokenMint);
    }
  }
}
