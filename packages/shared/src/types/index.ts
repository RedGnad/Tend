import type { PublicKey } from "@solana/web3.js";

// Service definition in the registry
export interface ServiceDefinition {
  id: string;
  name: string;
  description: string;
  defaultBps: number;
  minBps: number;
  maxBps: number;
  category: "growth" | "market-making" | "analytics" | "community";
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

// Tend state persisted to disk
export interface TendState {
  managedTokens: Record<string, ManagedToken>;
  walletPool: WalletEntry[];
  snapshots: FeeSnapshot[];
}
