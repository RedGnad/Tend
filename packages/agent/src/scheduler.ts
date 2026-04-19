import type { BagsClient } from "@tend/shared";
import { withStateLock } from "./state-lock.js";
import { runRewardsDistributor } from "./rewards-distributor.js";
import { claimFeesForCampaigns } from "./campaign-fee-claimer.js";
import { getTreasuryHealth } from "./treasury-health.js";
import { alert, clearAlert } from "./alerter.js";
import { log, logError } from "./logger.js";

const FEE_CLAIM_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const REWARDS_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const HEARTBEAT_INTERVAL_MS = 60 * 1000; // 1 minute
const TREASURY_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export class Scheduler {
  private feeClaimTimer?: ReturnType<typeof setInterval>;
  private rewardsTimer?: ReturnType<typeof setInterval>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private treasuryTimer?: ReturnType<typeof setInterval>;
  private running = false;

  // Re-entrance guards — prevent overlapping ticks
  private feeClaimRunning = false;
  private rewardsRunning = false;

  constructor(private bags: BagsClient) {}

  start() {
    if (this.running) return;
    this.running = true;

    log("Scheduler started");
    log(`  Fee claim interval: ${FEE_CLAIM_INTERVAL_MS / 1000}s`);
    log(`  Rewards interval: ${REWARDS_INTERVAL_MS / 1000}s`);

    // Write initial heartbeat
    this.writeHeartbeat();

    // Run immediately, then on interval
    this.tickCampaignFeeClaims();
    this.tickRewards();

    this.feeClaimTimer = setInterval(
      () => this.tickCampaignFeeClaims(),
      FEE_CLAIM_INTERVAL_MS
    );
    this.rewardsTimer = setInterval(
      () => this.tickRewards(),
      REWARDS_INTERVAL_MS
    );
    this.heartbeatTimer = setInterval(
      () => this.writeHeartbeat(),
      HEARTBEAT_INTERVAL_MS
    );
    this.checkTreasury();
    this.treasuryTimer = setInterval(
      () => this.checkTreasury(),
      TREASURY_CHECK_INTERVAL_MS
    );
  }

  stop() {
    if (!this.running) return;
    this.running = false;

    if (this.feeClaimTimer) clearInterval(this.feeClaimTimer);
    if (this.rewardsTimer) clearInterval(this.rewardsTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.treasuryTimer) clearInterval(this.treasuryTimer);

    log("Scheduler stopped");
  }

  /**
   * Periodic treasury solvency probe — alerts when surplus turns critical
   * (next payout will be skipped). Auto-clears the cooldown when surplus
   * recovers, so the next regression alerts immediately rather than waiting
   * out the 15-min window.
   */
  private async checkTreasury() {
    try {
      const h = await getTreasuryHealth(this.bags);
      if (h.status === "critical") {
        await alert(
          "treasury-critical",
          "critical",
          `Treasury surplus is ${h.surplusLamports} lamports — payouts will be blocked. balance=${h.balanceLamports} obligations=${h.obligationsLamports}`
        );
      } else {
        clearAlert("treasury-critical");
        if (h.status === "low") {
          await alert(
            "treasury-low",
            "warn",
            `Treasury surplus ${h.surplusLamports} lamports — top up before payouts stall.`
          );
        } else {
          clearAlert("treasury-low");
        }
      }
    } catch (err) {
      logError("[treasury-check] Error:", err);
    }
  }

  /** Claim Bags trading fees for all campaign tokens → grow pools */
  private async tickCampaignFeeClaims() {
    if (this.feeClaimRunning) {
      log("[tick:fee-claim] Previous tick still running, skipping");
      return;
    }
    this.feeClaimRunning = true;
    try {
      const { results, totalClaimedLamports } =
        await claimFeesForCampaigns(this.bags);
      if (results.length > 0) {
        log(
          `[tick:fee-claim] ${results.length} token(s), ${totalClaimedLamports} lamports total`
        );
      }
    } catch (err) {
      logError("[tick:fee-claim] Error:", err);
    } finally {
      this.feeClaimRunning = false;
    }
  }

  private async tickRewards() {
    if (this.rewardsRunning) {
      log("[tick:rewards] Previous tick still running, skipping");
      return;
    }
    this.rewardsRunning = true;
    try {
      const result = await runRewardsDistributor(this.bags);
      if (
        result.campaignsProcessed > 0 ||
        result.payoutsPaid > 0 ||
        result.swapsDetected > 0
      ) {
        log(
          `[tick:rewards] campaigns=${result.campaignsProcessed} swaps=${result.swapsDetected} fraud(allow/reject/hold)=${result.fraudAllowed}/${result.fraudRejected}/${result.fraudHeld} accrued=${result.payoutsAccrued} paid=${result.payoutsPaid}`
        );
      }
    } catch (err) {
      logError("[tick:rewards] Error:", err);
    } finally {
      this.rewardsRunning = false;
    }
  }

  /** Write heartbeat timestamp so frontend can detect agent liveness */
  private async writeHeartbeat() {
    try {
      await withStateLock(async (state) => {
        state.agentHeartbeat = Date.now();
      });
    } catch (err) {
      logError("[heartbeat] Error:", err);
    }
  }
}
