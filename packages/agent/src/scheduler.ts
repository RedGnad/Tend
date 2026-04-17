import type { BagsClient } from "@tend/shared";
import { withStateLock } from "./state-lock.js";
import { runRewardsDistributor } from "./rewards-distributor.js";
import { claimFeesForCampaigns } from "./campaign-fee-claimer.js";
import { log, logError } from "./logger.js";

const FEE_CLAIM_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const REWARDS_INTERVAL_MS = 2 * 60 * 1000; // 2 minutes
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const HEARTBEAT_INTERVAL_MS = 60 * 1000; // 1 minute
const PREPARE_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes — stale prepares

export class Scheduler {
  private feeClaimTimer?: ReturnType<typeof setInterval>;
  private rewardsTimer?: ReturnType<typeof setInterval>;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
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
    this.cleanupTimer = setInterval(
      () => this.tickCleanup(),
      CLEANUP_INTERVAL_MS
    );
    this.heartbeatTimer = setInterval(
      () => this.writeHeartbeat(),
      HEARTBEAT_INTERVAL_MS
    );
  }

  stop() {
    if (!this.running) return;
    this.running = false;

    if (this.feeClaimTimer) clearInterval(this.feeClaimTimer);
    if (this.rewardsTimer) clearInterval(this.rewardsTimer);
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    log("Scheduler stopped");
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

  /** Expire stale pending prepares */
  private async tickCleanup() {
    try {
      await withStateLock(async (state) => {
        // Expire stale pending prepares (older than 15 min)
        if (state.pendingPrepares && state.pendingPrepares.length > 0) {
          const now = Date.now();
          const before = state.pendingPrepares.length;
          state.pendingPrepares = state.pendingPrepares.filter(
            (p) => now - p.createdAt < PREPARE_EXPIRY_MS
          );
          const expired = before - state.pendingPrepares.length;
          if (expired > 0) {
            log(`[cleanup] Removed ${expired} expired prepare intent(s)`);
          }
        }
      });
    } catch (err) {
      logError("[cleanup] Error:", err);
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
