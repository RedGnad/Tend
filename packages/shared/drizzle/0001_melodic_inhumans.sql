CREATE TABLE "squads_multisigs" (
	"creator_wallet" text PRIMARY KEY NOT NULL,
	"multisig_pda" text NOT NULL,
	"multisig_create_key" text NOT NULL,
	"next_vault_index" integer DEFAULT 1 NOT NULL,
	"network" text NOT NULL,
	"created_at" bigint NOT NULL,
	"created_tx_sig" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "squads_multisig_pda" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "squads_vault_index" integer;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "squads_vault_pda" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "squads_spending_limit_pda" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "squads_spending_limit_create_key" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "squads_spending_limit_amount_lamports" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "squads_spending_limit_period" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "squads_attach_tx_sig" text;