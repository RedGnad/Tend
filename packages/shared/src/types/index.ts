// Wallet entry in pool
export interface WalletEntry {
  publicKey: string;
  secretKey: string; // base58 encoded
  assignedTo?: string; // "serviceId:tokenMint"
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
  // ── Squads v4 custody (optional — campaign may predate rollout or be pending) ──
  squadsMultisigPda?: string;
  squadsVaultIndex?: number;
  squadsVaultPda?: string;
  squadsSpendingLimitPda?: string;
  squadsSpendingLimitCreateKey?: string;
  squadsSpendingLimitAmountLamports?: string;
  squadsSpendingLimitPeriod?: "oneTime" | "day" | "week" | "month";
  squadsAttachTxSig?: string;
}

/**
 * One Squads multisig per creator wallet. All campaigns from that creator
 * reuse it via distinct vault_index. Created lazily on first provision.
 */
export interface SquadsMultisigRecord {
  creatorWallet: string;
  multisigPda: string;
  /** base58 Pubkey of the multisigCreateKey — seed only, no secret stored */
  multisigCreateKey: string;
  /** Monotonic counter; index 0 reserved, campaigns consume 1, 2, 3… */
  nextVaultIndex: number;
  network: "devnet" | "mainnet-beta";
  createdAt: number;
  createdTxSig: string;
}

export interface CashbackCampaign extends BaseCampaign {
  type: "cashback";
  config: {
    cashbackBps: number;
    /** Minimum swap volume (lamports) for a buy to qualify for cashback. Below
     *  this, the swap is ignored. Optional for backwards compat — legacy rows
     *  without the field fall back to the reward floor as the only gate. */
    minSwapLamports?: string;
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
  // "submitted" = signed + payoutTxSig persisted, on-chain send in flight.
  // Used to crash-safely detect in-flight payouts on agent restart and avoid
  // double-sending if the executor died between sendRawTransaction and the
  // post-confirm state write.
  status: "accrued" | "submitted" | "paid" | "failed";
  submittedAt?: number;
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
  /** Required since 2026-04-21 — dashboard scopes decisions to the exact
   * campaign they protected, so the same mint running both a sprint and a
   * holder campaign doesn't cross-surface entries. Optional on the type to
   * stay backward-compatible with rows written before this field existed;
   * those legacy rows are filtered out of the UI on purpose. */
  campaignType?: "cashback" | "holder" | "sprint";
  /** snapshot of what the model saw, useful for audit + dashboard */
  walletContext: {
    walletAgeHours: number | null;
    txCount: number | null;
    priorTendPayouts: number;
  };
}

// Tend state persisted to disk
export interface TendState {
  walletPool: WalletEntry[];
  campaigns?: Campaign[];
  rewardPayouts?: RewardPayout[];
  swapCursors?: Record<string, number>;
  holderSnapshotCursors?: Record<string, number>;
  fraudDecisions?: FraudDecision[];
  campaignDeposits?: CampaignDeposit[];
  campaignWithdrawals?: CampaignWithdrawal[];
  feeClaimEvents?: FeeClaimEvent[];
  /** Per-creator Squads multisig registry (lazy-provisioned on first Squads campaign) */
  squadsMultisigs?: SquadsMultisigRecord[];
  agentHeartbeat?: number; // timestamp of last agent tick
}

// Creator-initiated withdrawal of unused pool seed. Admin wallet refunds SOL
// back to the creatorWallet. Audit trail for treasury reconciliation.
export interface CampaignWithdrawal {
  txSig: string;
  tokenMint: string;
  campaignType: "cashback" | "holder" | "sprint";
  toWallet: string;
  amountLamports: string;
  createdAt: number;
}

// Individual Bags fee-claim event. Recorded per tick by the fee claimer so the
// creator can audit exactly which on-chain claims replenished their pool.
export interface FeeClaimEvent {
  tokenMint: string;
  claimedLamports: string;
  signatures: string[];
  source: "admin" | "service-wallet";
  createdAt: number;
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
