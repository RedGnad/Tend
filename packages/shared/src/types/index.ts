import type { PublicKey } from "@solana/web3.js";

// Service definition in the registry
export interface ServiceDefinition {
  id: string;
  name: string;
  description: string;
  defaultBps: number;
  minBps: number;
  maxBps: number;
  category: "growth" | "market-making" | "analytics" | "community" | "advisory";
  status: "available" | "coming-soon";
}

// An active service attached to a token
export interface ActiveService {
  serviceId: string;
  tokenMint: string;
  bps: number;
  activatedAt: number;
  config: Record<string, unknown>;
  status: "active" | "paused" | "error";
  claimerWallet: string;
  stats: ServiceStats;
}

export interface ServiceStats {
  totalFeesEarned: string; // lamports
  totalFeesClaimed: string;
  lastClaimAt?: number;
  actionsPerformed: number;
}

// Token with Tend services attached
export interface ManagedToken {
  tokenMint: string;
  adminWallet: string;
  services: ActiveService[];
  creatorBps: number;
  totalServiceBps: number;
  lifetimeFees: string;
  createdAt: number;
}

// For before/after comparison
export interface FeeSnapshot {
  tokenMint: string;
  timestamp: number;
  totalFees24h: string;
  serviceAllocations: Array<{
    serviceId: string;
    bps: number;
    earned: string;
  }>;
}

// Wallet entry in pool
export interface WalletEntry {
  publicKey: string;
  secretKey: string; // base58 encoded
  assignedTo?: string; // "serviceId:tokenMint"
}

// Agent decision log entry
export interface AgentDecision {
  timestamp: number;
  tokenMint: string;
  serviceId: string;
  inputs: MarketSnapshot;
  decision: {
    action: "buy" | "hold" | "partial_buy";
    amount_pct: number; // 0-100
    reasoning: string;
  };
  execution: {
    executed: boolean;
    tx_signature?: string;
    amount_lamports?: number;
    tokens_bought?: number;
    error?: string;
  };
}

export interface MarketSnapshot {
  price_sol: number;
  price_delta_pct?: number; // % change vs previous snapshot
  volume_24h_sol: number;
  lifetime_fees_sol: number;
  claimable_sol: number;
  wallet_balance_sol: number;
  holders: number;
  fee_velocity: string; // "high" | "medium" | "low" | "none"
}

// Analytics report from the intelligence service
export interface AnalyticsReport {
  timestamp: number;
  tokenMint: string;
  health_score: number; // 1-10
  trend: "growing" | "stable" | "declining";
  key_insights: string[];
  risks: string[];
  opportunities: string[];
  data: {
    lifetime_fees_sol: number;
    fee_velocity: string;
    holders: number;
    price_sol: number;
    buyback_count: number;
    buyback_success_rate: number;
  };
}

// Fee allocation recommendation from the advisor
export interface AllocationRecommendation {
  timestamp: number;
  tokenMint: string;
  recommendations: Array<{
    serviceId: string;
    currentBps: number;
    suggestedBps: number;
    reasoning: string;
  }>;
  overall_assessment: string;
}

// ── Live growth campaigns (Plan E — discriminated union, 2026-04-15) ──

export type CampaignType = "cashback" | "holder" | "sprint";

export interface BaseCampaign {
  tokenMint: string;
  creatorWallet: string;
  poolCapLamports: string;
  poolSpentLamports: string;
  /** SOL auto-claimed from Bags trading fees (grows the pool automatically) */
  feesClaimedLamports?: string;
  /** How many fee claims have been executed */
  feeClaimCount?: number;
  /** Timestamp of last successful fee claim */
  lastFeeClaimAt?: number;
  status: "live" | "paused" | "depleted";
  createdAt: number;
  tokenInfo?: {
    name: string;
    symbol: string;
    image?: string;
  };
}

export interface CashbackCampaign extends BaseCampaign {
  type: "cashback";
  config: {
    cashbackBps: number;
  };
}

export interface HolderCampaign extends BaseCampaign {
  type: "holder";
  config: {
    rewardBps: number;
    minHoldHours: number;
    snapshotCronHours: number;
  };
}

export interface SprintCampaign extends BaseCampaign {
  type: "sprint";
  config: {
    minBuyLamports: string;
    maxWinners: number;
    bonusLamports: string;
  };
}

export type Campaign =
  | CashbackCampaign
  | HolderCampaign
  | SprintCampaign;

/**
 * Migrate a raw campaign shape into the current Plan E discriminated union.
 * Idempotent: new-format campaigns pass through. Legacy cashback-only shape
 * (pre-2026-04-15) had cashbackBps at the top level — coerced into
 * { type: "cashback", config: { cashbackBps } }.
 */
export function migrateCampaign(raw: unknown): Campaign {
  if (raw === null || typeof raw !== "object") {
    throw new Error(`migrateCampaign: non-object input ${JSON.stringify(raw)}`);
  }
  const r = raw as Record<string, unknown>;
  if ("type" in r && "config" in r) {
    return r as unknown as Campaign;
  }
  if (typeof r.cashbackBps === "number") {
    const { cashbackBps, ...rest } = r as { cashbackBps: number } & Record<string, unknown>;
    return {
      ...(rest as unknown as BaseCampaign),
      type: "cashback",
      config: { cashbackBps },
    };
  }
  throw new Error(
    `migrateCampaign: cannot recognize campaign shape — missing type/config and cashbackBps`
  );
}

export function migrateCampaigns(list: unknown[] | undefined): Campaign[] {
  if (!list) return [];
  return list.map(migrateCampaign);
}

export interface RewardPayout {
  id: string;
  tokenMint: string;
  traderWallet: string;
  swapTxSig: string;
  swapVolumeLamports: string;
  rewardLamports: string;
  payoutTxSig: string | null;
  status: "accrued" | "paid" | "failed";
  createdAt: number;
  paidAt?: number;
  failedAttempts?: number;
  lastError?: string;
  // Optional — populated by the triggers so sprint slot accounting and
  // detail-page grouping don't cross-contaminate when multiple campaign
  // types have run on the same mint over time.
  campaignType?: "cashback" | "holder" | "sprint";
}

/**
 * Decision made by the fraud/sybil gate before a payout is accrued.
 * One entry per (swapTxSig, traderWallet) — persisted for audit even when allowed.
 */
export interface FraudDecision {
  id: string; // same shape as RewardPayout.id: `${swapSig.slice(0,16)}-${trader.slice(0,8)}`
  tokenMint: string;
  traderWallet: string;
  swapTxSig: string;
  swapVolumeLamports: string;
  decision: "allow" | "reject" | "hold";
  reasoning: string;
  flags: string[];
  model: string;
  checkedAt: number;
  /** snapshot of what the model saw, useful for audit + dashboard */
  walletContext: {
    walletAgeHours: number | null;
    txCount: number | null;
    priorTendPayouts: number;
  };
}

// Pending prepare intent — links prepare→submit to prevent replay
export interface PendingPrepare {
  prepareId: string;
  tokenMint: string;
  serviceId: string;
  bps: number;
  serviceWallet: string;
  payerWallet: string;
  createdAt: number;
}

// Tend state persisted to disk
export interface TendState {
  managedTokens: Record<string, ManagedToken>;
  walletPool: WalletEntry[];
  snapshots: FeeSnapshot[];
  decisions: AgentDecision[];
  reports: AnalyticsReport[];
  allocations: AllocationRecommendation[];
  pendingPrepares?: PendingPrepare[];
  campaigns?: Campaign[];
  rewardPayouts?: RewardPayout[];
  swapCursors?: Record<string, number>;
  holderSnapshotCursors?: Record<string, number>;
  fraudDecisions?: FraudDecision[];
  campaignDeposits?: CampaignDeposit[];
  agentHeartbeat?: number; // timestamp of last agent tick
  serviceWallets?: Record<string, string>; // DEPRECATED — migrated into walletPool. Kept for migration only.
}

// Creator-funded deposits into a campaign pool (create + topup).
// Used for anti-replay (txSig uniqueness) and to surface a funding history.
export interface CampaignDeposit {
  txSig: string;
  tokenMint: string;
  campaignType: "cashback" | "holder" | "sprint";
  fromWallet: string;
  amountLamports: string;
  kind: "create" | "topup";
  createdAt: number;
}
