import {
  pgTable,
  text,
  integer,
  bigint,
  jsonb,
  primaryKey,
  index,
  serial,
} from "drizzle-orm/pg-core";

// All lamport/SOL amounts are kept as text to preserve bigint precision safely
// across the JSON boundary — matches the current file-based state shape.
// Millisecond timestamps fit in Number safely, so bigint columns use mode:"number".

export const walletPool = pgTable("wallet_pool", {
  publicKey: text("public_key").primaryKey(),
  secretKey: text("secret_key").notNull(), // AES-256-GCM ciphertext
  assignedTo: text("assigned_to"), // "serviceId:tokenMint" or null
});

export const campaigns = pgTable(
  "campaigns",
  {
    tokenMint: text("token_mint").notNull(),
    type: text("type").notNull(), // "cashback" | "holder" | "sprint"
    creatorWallet: text("creator_wallet").notNull(),
    poolCapLamports: text("pool_cap_lamports").notNull(),
    poolSpentLamports: text("pool_spent_lamports").notNull(),
    feesClaimedLamports: text("fees_claimed_lamports"),
    feeClaimCount: integer("fee_claim_count"),
    lastFeeClaimAt: bigint("last_fee_claim_at", { mode: "number" }),
    status: text("status").notNull(), // "live" | "paused" | "depleted"
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    tokenInfo: jsonb("token_info"), // { name, symbol, image? }
    config: jsonb("config").notNull(), // polymorphic per campaign type
    // Squads v4 custody — nullable: campaign may predate Squads rollout OR provisioning may be pending.
    squadsMultisigPda: text("squads_multisig_pda"), // logical FK to squads_multisigs.multisig_pda
    squadsVaultIndex: integer("squads_vault_index"),
    squadsVaultPda: text("squads_vault_pda"),
    squadsSpendingLimitPda: text("squads_spending_limit_pda"),
    squadsSpendingLimitCreateKey: text("squads_spending_limit_create_key"), // base58 Pubkey seed
    squadsSpendingLimitAmountLamports: text("squads_spending_limit_amount_lamports"),
    squadsSpendingLimitPeriod: text("squads_spending_limit_period"), // "oneTime"|"day"|"week"|"month"
    squadsAttachTxSig: text("squads_attach_tx_sig"),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tokenMint, t.type] }),
  })
);

// One Squads multisig per creator wallet. All campaigns from that creator reuse it via
// distinct vault_index. Created lazily on first campaign using Squads custody.
export const squadsMultisigs = pgTable("squads_multisigs", {
  creatorWallet: text("creator_wallet").primaryKey(),
  multisigPda: text("multisig_pda").notNull(),
  // base58 Pubkey of the multisigCreateKey — seed only, no secret stored.
  // (secret was a single-use signing key, discarded post-creation)
  multisigCreateKey: text("multisig_create_key").notNull(),
  // Monotonic counter; index 0 reserved for potential creator-owned treasury vault,
  // campaigns consume 1, 2, 3… sequentially.
  nextVaultIndex: integer("next_vault_index").notNull().default(1),
  network: text("network").notNull(), // 'devnet' | 'mainnet-beta'
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  createdTxSig: text("created_tx_sig").notNull(),
});

export const rewardPayouts = pgTable(
  "reward_payouts",
  {
    id: text("id").primaryKey(),
    tokenMint: text("token_mint").notNull(),
    traderWallet: text("trader_wallet").notNull(),
    swapTxSig: text("swap_tx_sig").notNull(),
    swapVolumeLamports: text("swap_volume_lamports").notNull(),
    rewardLamports: text("reward_lamports").notNull(),
    payoutTxSig: text("payout_tx_sig"),
    status: text("status").notNull(), // accrued|submitted|paid|failed
    submittedAt: bigint("submitted_at", { mode: "number" }),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    paidAt: bigint("paid_at", { mode: "number" }),
    failedAttempts: integer("failed_attempts"),
    lastError: text("last_error"),
    campaignType: text("campaign_type"), // cashback|holder|sprint
  },
  (t) => ({
    tokenMintIdx: index("reward_payouts_token_mint_idx").on(t.tokenMint),
    statusIdx: index("reward_payouts_status_idx").on(t.status),
  })
);

export const fraudDecisions = pgTable(
  "fraud_decisions",
  {
    id: text("id").primaryKey(),
    tokenMint: text("token_mint").notNull(),
    campaignType: text("campaign_type"), // "cashback"|"holder"|"sprint" — null for rows written before 2026-04-21
    traderWallet: text("trader_wallet").notNull(),
    swapTxSig: text("swap_tx_sig").notNull(),
    swapVolumeLamports: text("swap_volume_lamports").notNull(),
    decision: text("decision").notNull(), // allow|reject|hold
    reasoning: text("reasoning").notNull(),
    flags: jsonb("flags").notNull(), // string[]
    model: text("model").notNull(),
    checkedAt: bigint("checked_at", { mode: "number" }).notNull(),
    walletContext: jsonb("wallet_context").notNull(),
  },
  (t) => ({
    tokenMintIdx: index("fraud_decisions_token_mint_idx").on(t.tokenMint),
  })
);

export const campaignDeposits = pgTable(
  "campaign_deposits",
  {
    txSig: text("tx_sig").primaryKey(),
    tokenMint: text("token_mint").notNull(),
    campaignType: text("campaign_type").notNull(),
    fromWallet: text("from_wallet").notNull(),
    amountLamports: text("amount_lamports").notNull(),
    kind: text("kind").notNull(), // create|topup
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => ({
    tokenMintIdx: index("campaign_deposits_token_mint_idx").on(t.tokenMint),
  })
);

export const campaignWithdrawals = pgTable(
  "campaign_withdrawals",
  {
    txSig: text("tx_sig").primaryKey(),
    tokenMint: text("token_mint").notNull(),
    campaignType: text("campaign_type").notNull(),
    toWallet: text("to_wallet").notNull(),
    amountLamports: text("amount_lamports").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => ({
    tokenMintIdx: index("campaign_withdrawals_token_mint_idx").on(t.tokenMint),
  })
);

export const feeClaimEvents = pgTable(
  "fee_claim_events",
  {
    id: serial("id").primaryKey(),
    tokenMint: text("token_mint").notNull(),
    claimedLamports: text("claimed_lamports").notNull(),
    signatures: jsonb("signatures").notNull(), // string[]
    source: text("source").notNull(), // admin|service-wallet
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => ({
    tokenMintIdx: index("fee_claim_events_token_mint_idx").on(t.tokenMint),
  })
);

export const swapCursors = pgTable("swap_cursors", {
  tokenMint: text("token_mint").primaryKey(),
  value: bigint("value", { mode: "number" }).notNull(),
});

export const holderSnapshotCursors = pgTable("holder_snapshot_cursors", {
  tokenMint: text("token_mint").primaryKey(),
  value: bigint("value", { mode: "number" }).notNull(),
});

// Singleton rows for agent-global scalars: heartbeat, future counters, etc.
export const agentMeta = pgTable("agent_meta", {
  key: text("key").primaryKey(),
  valueNumber: bigint("value_number", { mode: "number" }),
  valueText: text("value_text"),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

// ── Inferred row types ────────────────────────────────────────────────────

export type WalletPoolRow = typeof walletPool.$inferSelect;
export type WalletPoolInsert = typeof walletPool.$inferInsert;
export type CampaignRow = typeof campaigns.$inferSelect;
export type CampaignInsert = typeof campaigns.$inferInsert;
export type RewardPayoutRow = typeof rewardPayouts.$inferSelect;
export type RewardPayoutInsert = typeof rewardPayouts.$inferInsert;
export type FraudDecisionRow = typeof fraudDecisions.$inferSelect;
export type FraudDecisionInsert = typeof fraudDecisions.$inferInsert;
export type CampaignDepositRow = typeof campaignDeposits.$inferSelect;
export type CampaignDepositInsert = typeof campaignDeposits.$inferInsert;
export type CampaignWithdrawalRow = typeof campaignWithdrawals.$inferSelect;
export type CampaignWithdrawalInsert = typeof campaignWithdrawals.$inferInsert;
export type FeeClaimEventRow = typeof feeClaimEvents.$inferSelect;
export type FeeClaimEventInsert = typeof feeClaimEvents.$inferInsert;
export type SquadsMultisigRow = typeof squadsMultisigs.$inferSelect;
export type SquadsMultisigInsert = typeof squadsMultisigs.$inferInsert;
