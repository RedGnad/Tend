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

// Tend state persisted to disk
export interface TendState {
  managedTokens: Record<string, ManagedToken>;
  walletPool: WalletEntry[];
  snapshots: FeeSnapshot[];
  decisions: AgentDecision[];
  reports: AnalyticsReport[];
  allocations: AllocationRecommendation[];
  serviceWallets?: Record<string, string>; // DEPRECATED — migrated into walletPool. Kept for migration only.
}
