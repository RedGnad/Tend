CREATE TABLE "agent_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value_number" bigint,
	"value_text" text,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_deposits" (
	"tx_sig" text PRIMARY KEY NOT NULL,
	"token_mint" text NOT NULL,
	"campaign_type" text NOT NULL,
	"from_wallet" text NOT NULL,
	"amount_lamports" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_withdrawals" (
	"tx_sig" text PRIMARY KEY NOT NULL,
	"token_mint" text NOT NULL,
	"campaign_type" text NOT NULL,
	"to_wallet" text NOT NULL,
	"amount_lamports" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"token_mint" text NOT NULL,
	"type" text NOT NULL,
	"creator_wallet" text NOT NULL,
	"pool_cap_lamports" text NOT NULL,
	"pool_spent_lamports" text NOT NULL,
	"fees_claimed_lamports" text,
	"fee_claim_count" integer,
	"last_fee_claim_at" bigint,
	"status" text NOT NULL,
	"created_at" bigint NOT NULL,
	"token_info" jsonb,
	"config" jsonb NOT NULL,
	CONSTRAINT "campaigns_token_mint_type_pk" PRIMARY KEY("token_mint","type")
);
--> statement-breakpoint
CREATE TABLE "fee_claim_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"token_mint" text NOT NULL,
	"claimed_lamports" text NOT NULL,
	"signatures" jsonb NOT NULL,
	"source" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fraud_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"token_mint" text NOT NULL,
	"trader_wallet" text NOT NULL,
	"swap_tx_sig" text NOT NULL,
	"swap_volume_lamports" text NOT NULL,
	"decision" text NOT NULL,
	"reasoning" text NOT NULL,
	"flags" jsonb NOT NULL,
	"model" text NOT NULL,
	"checked_at" bigint NOT NULL,
	"wallet_context" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holder_snapshot_cursors" (
	"token_mint" text PRIMARY KEY NOT NULL,
	"value" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward_payouts" (
	"id" text PRIMARY KEY NOT NULL,
	"token_mint" text NOT NULL,
	"trader_wallet" text NOT NULL,
	"swap_tx_sig" text NOT NULL,
	"swap_volume_lamports" text NOT NULL,
	"reward_lamports" text NOT NULL,
	"payout_tx_sig" text,
	"status" text NOT NULL,
	"submitted_at" bigint,
	"created_at" bigint NOT NULL,
	"paid_at" bigint,
	"failed_attempts" integer,
	"last_error" text,
	"campaign_type" text
);
--> statement-breakpoint
CREATE TABLE "swap_cursors" (
	"token_mint" text PRIMARY KEY NOT NULL,
	"value" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_pool" (
	"public_key" text PRIMARY KEY NOT NULL,
	"secret_key" text NOT NULL,
	"assigned_to" text
);
--> statement-breakpoint
CREATE INDEX "campaign_deposits_token_mint_idx" ON "campaign_deposits" USING btree ("token_mint");--> statement-breakpoint
CREATE INDEX "campaign_withdrawals_token_mint_idx" ON "campaign_withdrawals" USING btree ("token_mint");--> statement-breakpoint
CREATE INDEX "fee_claim_events_token_mint_idx" ON "fee_claim_events" USING btree ("token_mint");--> statement-breakpoint
CREATE INDEX "fraud_decisions_token_mint_idx" ON "fraud_decisions" USING btree ("token_mint");--> statement-breakpoint
CREATE INDEX "reward_payouts_token_mint_idx" ON "reward_payouts" USING btree ("token_mint");--> statement-breakpoint
CREATE INDEX "reward_payouts_status_idx" ON "reward_payouts" USING btree ("status");