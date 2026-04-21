import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import type {
  BagsClient,
  Campaign,
  FraudDecision,
  RewardPayout,
} from "@tend/shared";
import type { AgentClient } from "../agent-client.js";

const LAMPORTS_PER_SOL = 1_000_000_000;

function solToLamports(sol: number): bigint {
  return BigInt(Math.floor(sol * LAMPORTS_PER_SOL));
}

function lamportsToSol(lamports: string | bigint): string {
  const n = typeof lamports === "string" ? BigInt(lamports) : lamports;
  return (Number(n) / LAMPORTS_PER_SOL).toFixed(6);
}

function isValidMint(mint: string): boolean {
  try {
    new PublicKey(mint);
    return true;
  } catch {
    return false;
  }
}

interface CampaignStats {
  payoutsAllowed: number;
  payoutsPaid: number;
  payoutsFailed: number;
  totalPaidLamports: string;
  uniqueEarners: number;
  fraudAllowed: number;
  fraudRejected: number;
  fraudHeld: number;
}

function computeStats(
  tokenMint: string,
  payouts: RewardPayout[],
  fraud: FraudDecision[]
): CampaignStats {
  const mine = payouts.filter((p) => p.tokenMint === tokenMint);
  const mineFraud = fraud.filter((d) => d.tokenMint === tokenMint);
  const paid = mine.filter((p) => p.status === "paid");
  const failed = mine.filter((p) => p.status === "failed");
  const totalPaid = paid.reduce((sum, p) => sum + BigInt(p.rewardLamports), 0n);
  const earners = new Set(paid.map((p) => p.traderWallet)).size;
  return {
    payoutsAllowed: mine.length,
    payoutsPaid: paid.length,
    payoutsFailed: failed.length,
    totalPaidLamports: totalPaid.toString(),
    uniqueEarners: earners,
    fraudAllowed: mineFraud.filter((d) => d.decision === "allow").length,
    fraudRejected: mineFraud.filter((d) => d.decision === "reject").length,
    fraudHeld: mineFraud.filter((d) => d.decision === "hold").length,
  };
}

function findLiveCampaign(
  campaigns: Campaign[],
  tokenMint: string
): Campaign | null {
  return (
    campaigns.find((c) => c.tokenMint === tokenMint && c.status === "live") ??
    null
  );
}

function findCampaignByType(
  campaigns: Campaign[],
  tokenMint: string,
  type: Campaign["type"]
): Campaign | null {
  return (
    campaigns.find((c) => c.tokenMint === tokenMint && c.type === type) ?? null
  );
}

/**
 * Minimal creator console — 7 tools.
 *
 *   create_campaign          — cashback pool (pay % per buy)
 *   create_holder_campaign   — holder dividends (pro-rata snapshots)
 *   create_sprint_campaign   — launch sprint (first N buyers flat bonus)
 *   pause_campaign           — freeze payouts without losing the pool
 *   topup_pool               — add SOL to the pool, auto-swept into the Squads vault
 *   view_campaign_stats      — payouts, fraud decisions, utilization
 *   enable_auto_replenish    — route Bags fee-share into Tend so claims auto-grow the pool
 *
 * Every mutating tool routes through the Tend agent HTTP API (same entry
 * points as the web app): the agent is the single source of truth for state
 * writes, Squads vault provisioning, and treasury solvency. The MCP server
 * holds the creator's private key and signs the auth messages + merged
 * Squads transaction locally — never re-implements orchestration logic.
 */
export function registerCampaignTools(
  server: McpServer,
  bags: BagsClient,
  creatorWallet: string,
  agent: AgentClient
) {
  server.tool(
    "create_campaign",
    "Launch a live cashback campaign for a Bags token. Provisions a dedicated Squads v4 vault + SpendingLimit on-chain (agent member, creator is configAuthority), seeds it with the requested pool, and flips the campaign live. The agent pays traders a cashback % on every qualifying buy after the AI fraud gate clears it.",
    {
      tokenMint: z
        .string()
        .describe("Token mint (base58) — must be a valid Solana pubkey"),
      cashbackBps: z
        .number()
        .int()
        .min(1)
        .max(1000)
        .describe(
          "Cashback rate in basis points. 100 = 1%, 500 = 5%, max 1000 (10%)"
        ),
      poolSol: z
        .number()
        .positive()
        .describe("Pool cap in SOL — the maximum the agent will ever pay out for this campaign"),
    },
    async ({ tokenMint, cashbackBps, poolSol }) => {
      if (!isValidMint(tokenMint)) {
        return {
          content: [{ type: "text", text: `❌ Invalid mint address: ${tokenMint}` }],
        };
      }

      const state = await agent.fetchState();
      const live = findLiveCampaign(state.campaigns, tokenMint);
      if (live) {
        return {
          content: [
            {
              type: "text",
              text: `⚠️  A live ${live.type} campaign already exists for ${tokenMint.slice(0, 8)}… Pause it first or use topup_pool to extend.`,
            },
          ],
        };
      }

      const amount = solToLamports(poolSol);
      try {
        const result = await agent.createCampaign({
          tokenMint,
          type: "cashback",
          amountLamports: amount,
          period: "day",
          initialFundingLamports: amount,
          campaignConfig: { cashbackBps },
        });
        return {
          content: [
            {
              type: "text",
              text: [
                `✅ Cashback campaign live on ${tokenMint.slice(0, 8)}…`,
                `   cashback       ${(cashbackBps / 100).toFixed(2)}%`,
                `   pool cap       ${poolSol} SOL`,
                `   squads vault   ${result.vaultPda}`,
                `   spending limit ${result.spendingLimitPda}`,
                `   tx             https://solscan.io/tx/${result.mergedTxSig}`,
                ``,
                `Agent will detect new buys, run the AI fraud gate, and pay cashback to allowed traders.`,
              ].join("\n"),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Agent create failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "create_holder_campaign",
    "Launch a live holder-dividends campaign for a Bags token. Provisions a Squads vault + SpendingLimit on-chain and seeds the pool. On a cron cadence the agent snapshots holders, filters by minimum hold duration, runs each through the AI fraud gate, and pays a pro-rata share of a per-snapshot budget (poolCap × rewardBps / 10000).",
    {
      tokenMint: z
        .string()
        .describe("Token mint (base58) — must be a valid Solana pubkey"),
      rewardBps: z
        .number()
        .int()
        .min(1)
        .max(2000)
        .describe(
          "Per-snapshot budget as basis points of the pool cap. 100 = 1%, max 2000 (20%). Over time the pool depletes deterministically."
        ),
      minHoldHours: z
        .number()
        .int()
        .min(1)
        .max(720)
        .describe(
          "Minimum hours a wallet must have held the token to qualify for a snapshot. 24 = anti-snipe baseline."
        ),
      snapshotCronHours: z
        .number()
        .int()
        .min(1)
        .max(168)
        .describe(
          "Cadence between snapshots, in hours. 24 = daily, 168 = weekly."
        ),
      poolSol: z
        .number()
        .positive()
        .describe(
          "Pool cap in SOL — the maximum the agent will ever pay out for this campaign"
        ),
    },
    async ({
      tokenMint,
      rewardBps,
      minHoldHours,
      snapshotCronHours,
      poolSol,
    }) => {
      if (!isValidMint(tokenMint)) {
        return {
          content: [
            { type: "text", text: `❌ Invalid mint address: ${tokenMint}` },
          ],
        };
      }

      const state = await agent.fetchState();
      const live = findLiveCampaign(state.campaigns, tokenMint);
      if (live) {
        return {
          content: [
            {
              type: "text",
              text: `⚠️  A live ${live.type} campaign already exists for ${tokenMint.slice(0, 8)}… Pause it first or use topup_pool to extend.`,
            },
          ],
        };
      }

      const amount = solToLamports(poolSol);
      try {
        const result = await agent.createCampaign({
          tokenMint,
          type: "holder",
          amountLamports: amount,
          period: "day",
          initialFundingLamports: amount,
          campaignConfig: { rewardBps, minHoldHours, snapshotCronHours },
        });
        const perSnapshot = (poolSol * rewardBps) / 10_000;
        return {
          content: [
            {
              type: "text",
              text: [
                `✅ Holder campaign live on ${tokenMint.slice(0, 8)}…`,
                `   reward rate    ${(rewardBps / 100).toFixed(2)}% of pool per snapshot`,
                `   min hold       ${minHoldHours}h`,
                `   cadence        every ${snapshotCronHours}h`,
                `   pool cap       ${poolSol} SOL`,
                `   per snapshot   ~${perSnapshot.toFixed(6)} SOL distributed pro-rata`,
                `   squads vault   ${result.vaultPda}`,
                `   spending limit ${result.spendingLimitPda}`,
                `   tx             https://solscan.io/tx/${result.mergedTxSig}`,
              ].join("\n"),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Agent create failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "create_sprint_campaign",
    "Launch a live sprint campaign for a Bags token. Provisions a Squads vault + SpendingLimit on-chain and seeds the pool. Pays a flat SOL bonus to the first N wallets that buy at least minBuySol. Each wallet wins at most once. The AI fraud gate rejects snipe bots and fresh-wallet farms before a slot is used. Auto-completes when winners == maxWinners.",
    {
      tokenMint: z
        .string()
        .describe("Token mint (base58) — must be a valid Solana pubkey"),
      minBuySol: z
        .number()
        .positive()
        .describe(
          "Minimum SOL a buy must hit to qualify for the sprint (e.g. 0.25)"
        ),
      maxWinners: z
        .number()
        .int()
        .min(1)
        .max(200)
        .describe(
          "How many wallets can win before the sprint auto-completes. 50 is a typical launch-week sprint."
        ),
      bonusSol: z
        .number()
        .positive()
        .describe(
          "Flat SOL bonus each winner receives. poolSol must be >= bonusSol * maxWinners."
        ),
      poolSol: z
        .number()
        .positive()
        .describe(
          "Pool cap in SOL — should be >= bonusSol * maxWinners so every winner gets the full bonus."
        ),
    },
    async ({ tokenMint, minBuySol, maxWinners, bonusSol, poolSol }) => {
      if (!isValidMint(tokenMint)) {
        return {
          content: [
            { type: "text", text: `❌ Invalid mint address: ${tokenMint}` },
          ],
        };
      }

      if (poolSol < bonusSol * maxWinners) {
        return {
          content: [
            {
              type: "text",
              text: `⚠️  poolSol (${poolSol}) must cover bonusSol × maxWinners (${(bonusSol * maxWinners).toFixed(6)}). Raise poolSol or lower the bonus/winners.`,
            },
          ],
        };
      }

      const state = await agent.fetchState();
      const live = findLiveCampaign(state.campaigns, tokenMint);
      if (live) {
        return {
          content: [
            {
              type: "text",
              text: `⚠️  A live ${live.type} campaign already exists for ${tokenMint.slice(0, 8)}… Pause it first or use topup_pool to extend.`,
            },
          ],
        };
      }

      const amount = solToLamports(poolSol);
      try {
        const result = await agent.createCampaign({
          tokenMint,
          type: "sprint",
          amountLamports: amount,
          period: "day",
          initialFundingLamports: amount,
          campaignConfig: {
            minBuyLamports: solToLamports(minBuySol).toString(),
            maxWinners,
            bonusLamports: solToLamports(bonusSol).toString(),
          },
        });
        return {
          content: [
            {
              type: "text",
              text: [
                `✅ Sprint campaign live on ${tokenMint.slice(0, 8)}…`,
                `   min buy        ${minBuySol} SOL`,
                `   winners        up to ${maxWinners}`,
                `   bonus          ${bonusSol} SOL flat per winner`,
                `   pool cap       ${poolSol} SOL`,
                `   squads vault   ${result.vaultPda}`,
                `   spending limit ${result.spendingLimitPda}`,
                `   tx             https://solscan.io/tx/${result.mergedTxSig}`,
                ``,
                `Agent will pay each of the first ${maxWinners} qualifying buyers (after AI fraud gate) a flat ${bonusSol} SOL bonus. Auto-completes when full.`,
              ].join("\n"),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Agent create failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "pause_campaign",
    "Pause a live campaign. Stops new payouts immediately. The pool and Squads vault are preserved; resume from the dashboard or a future MCP tool.",
    {
      tokenMint: z.string().describe("Token mint (base58)"),
      type: z
        .enum(["cashback", "holder", "sprint"])
        .describe("Campaign type — required because a mint can host multiple types over time"),
    },
    async ({ tokenMint, type }) => {
      try {
        const result = await agent.pauseCampaign({ tokenMint, type });
        return {
          content: [
            {
              type: "text",
              text: `⏸️  Campaign ${type}:${tokenMint.slice(0, 8)}… → ${result.status}`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Pause failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "topup_pool",
    "Add more SOL to a campaign's pool. The MCP signs a SystemTransfer from the creator to the Tend admin wallet, then the agent verifies the deposit on-chain and auto-sweeps it into the Squads vault so payouts can draw from the SpendingLimit.",
    {
      tokenMint: z.string().describe("Token mint (base58)"),
      type: z
        .enum(["cashback", "holder", "sprint"])
        .describe("Campaign type — required because a mint can host multiple types over time"),
      addSol: z
        .number()
        .positive()
        .describe("Amount of SOL to add to the pool"),
    },
    async ({ tokenMint, type, addSol }) => {
      try {
        const result = await agent.topupPool({
          tokenMint,
          type,
          addLamports: solToLamports(addSol),
        });
        return {
          content: [
            {
              type: "text",
              text: [
                `💰 Pool topped up for ${type}:${tokenMint.slice(0, 8)}…`,
                `   added      ${lamportsToSol(result.addedLamports)} SOL`,
                `   status     ${result.status}`,
                `   deposit    https://solscan.io/tx/${result.depositTxSig}`,
                result.sweepTxSig
                  ? `   sweep      https://solscan.io/tx/${result.sweepTxSig}`
                  : `   sweep      skipped (manual /squads-sweep may be needed)`,
              ].join("\n"),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Topup failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }
    }
  );

  server.tool(
    "view_campaign_stats",
    "Show live stats for a campaign from the agent: pool utilization, payouts (accrued/paid/failed), unique earners, fraud gate breakdown. Reads from the agent (Postgres-backed) — the authoritative source of truth.",
    {
      tokenMint: z
        .string()
        .optional()
        .describe("Token mint. Omit to list all campaigns with summary stats."),
    },
    async ({ tokenMint }) => {
      const state = await agent.fetchState();

      if (!tokenMint) {
        const all = state.campaigns;
        if (all.length === 0) {
          return { content: [{ type: "text", text: "No campaigns yet." }] };
        }
        const lines = all.map((c) => {
          const stats = computeStats(
            c.tokenMint,
            state.rewardPayouts,
            state.fraudDecisions
          );
          const symbol = c.tokenInfo?.symbol ?? c.tokenMint.slice(0, 4);
          const spent = lamportsToSol(c.poolSpentLamports);
          const cap = lamportsToSol(c.poolCapLamports);
          const pct =
            Number(c.poolCapLamports) > 0
              ? (
                  (Number(c.poolSpentLamports) / Number(c.poolCapLamports)) *
                  100
                ).toFixed(0)
              : "0";
          return `  $${symbol} [${c.type.toUpperCase()}]  ${c.status.padEnd(8)}  pool ${spent}/${cap} SOL (${pct}%)  earners ${stats.uniqueEarners}  paid ${stats.payoutsPaid}`;
        });
        return {
          content: [
            {
              type: "text",
              text: [`📊 ${all.length} campaign(s):`, ...lines].join("\n"),
            },
          ],
        };
      }

      const forMint = state.campaigns.filter((c) => c.tokenMint === tokenMint);
      if (forMint.length === 0) {
        return {
          content: [
            { type: "text", text: `❌ No campaign for ${tokenMint.slice(0, 8)}…` },
          ],
        };
      }
      const priority: Campaign["status"][] = ["live", "paused", "depleted"];
      const campaign =
        priority
          .map((s) => forMint.find((c) => c.status === s))
          .find((c): c is Campaign => !!c) ?? forMint[0];

      const stats = computeStats(
        tokenMint,
        state.rewardPayouts,
        state.fraudDecisions
      );
      const symbol = campaign.tokenInfo?.symbol ?? tokenMint.slice(0, 4);
      const cap = BigInt(campaign.poolCapLamports);
      const spent = BigInt(campaign.poolSpentLamports);
      const remaining = cap - spent;
      const pct = cap > 0n ? Number((spent * 100n) / cap) : 0;

      let rateLine: string;
      switch (campaign.type) {
        case "cashback":
          rateLine = `   cashback    ${(campaign.config.cashbackBps / 100).toFixed(2)}%`;
          break;
        case "holder":
          rateLine = `   holder      ${(campaign.config.rewardBps / 100).toFixed(2)}%/snapshot · min ${campaign.config.minHoldHours}h · every ${campaign.config.snapshotCronHours}h`;
          break;
        case "sprint":
          rateLine = `   sprint      ${lamportsToSol(campaign.config.bonusLamports)} SOL bonus · up to ${campaign.config.maxWinners} winners · min buy ${lamportsToSol(campaign.config.minBuyLamports)} SOL`;
          break;
      }

      const squadsLine = campaign.squadsVaultPda
        ? `   squads      vault ${campaign.squadsVaultPda.slice(0, 10)}… · SL ${campaign.squadsSpendingLimitPda?.slice(0, 10) ?? "?"}…`
        : `   squads      (not provisioned)`;

      return {
        content: [
          {
            type: "text",
            text: [
              `📊 Campaign $${symbol} — ${campaign.status.toUpperCase()}`,
              `   mint        ${tokenMint}`,
              rateLine,
              squadsLine,
              ``,
              `Pool`,
              `   cap         ${lamportsToSol(cap)} SOL`,
              `   spent       ${lamportsToSol(spent)} SOL (${pct}%)`,
              `   remaining   ${lamportsToSol(remaining)} SOL`,
              ``,
              `Payouts`,
              `   accrued     ${stats.payoutsAllowed}`,
              `   paid        ${stats.payoutsPaid}  (${lamportsToSol(stats.totalPaidLamports)} SOL)`,
              `   failed      ${stats.payoutsFailed}`,
              `   earners     ${stats.uniqueEarners} unique wallet(s)`,
              ``,
              `Fraud gate`,
              `   allowed     ${stats.fraudAllowed}`,
              `   rejected    ${stats.fraudRejected}`,
              `   held        ${stats.fraudHeld}`,
            ].join("\n"),
          },
        ],
      };
    }
  );

  // ──── 7th tool: enable auto-replenish for the local creator ────
  // Routes a slice of the local wallet's Bags fee-share into Tend so
  // every Bags fee claim auto-grows the campaign pool. This is a pure
  // on-chain action (no Tend state write, no Squads interaction) —
  // signed and sent directly by the local BagsClient.
  const DEFAULT_TEND_BPS = 1000;
  const MAX_TEND_BPS = 5000;

  server.tool(
    "enable_auto_replenish",
    "Insert the Tend admin wallet into your Bags fee-share config so every fee claim auto-grows the campaign pool. Existing claimers are kept (their bps reduced prorata so the total still equals 10000). Self-hosted MCP only — the local TEND_PRIVATE_KEY signs and sends.",
    {
      tokenMint: z
        .string()
        .describe("Token mint (base58) — must be a valid Solana pubkey, must be one you admin"),
      tendBps: z
        .number()
        .int()
        .min(1)
        .max(MAX_TEND_BPS)
        .optional()
        .describe(
          `Basis points routed to Tend. Default ${DEFAULT_TEND_BPS} (10%), max ${MAX_TEND_BPS} (50%).`
        ),
    },
    async ({ tokenMint, tendBps }) => {
      if (!isValidMint(tokenMint)) {
        return {
          content: [{ type: "text", text: `❌ Invalid mint address: ${tokenMint}` }],
        };
      }
      const requestedBps = tendBps ?? DEFAULT_TEND_BPS;
      // The Tend admin wallet lives on the agent — route fees there, not to
      // the local creator key.
      const state = await agent.fetchState();
      const tendAdminWallet = state.adminWallet;
      if (!tendAdminWallet) {
        return {
          content: [
            { type: "text", text: `❌ Agent /state did not expose adminWallet — cannot route fees.` },
          ],
        };
      }

      let creators;
      try {
        creators = await bags.getTokenCreators(tokenMint);
      } catch (err) {
        return {
          content: [
            { type: "text", text: `❌ Could not read fee-share from Bags: ${err instanceof Error ? err.message : String(err)}` },
          ],
        };
      }

      // Only an admin of the token can update the config. The local creator
      // key signs the update tx — must be the one Bags recognizes.
      const signerEntry = creators.find((c) => c.wallet === creatorWallet);
      if (!signerEntry || !signerEntry.isAdmin) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Wallet ${creatorWallet.slice(0, 8)}… is not an admin of this token's fee-share config — cannot update.`,
            },
          ],
        };
      }

      const currentEntry = creators.find((c) => c.wallet === tendAdminWallet);
      if (currentEntry && currentEntry.royaltyBps === requestedBps) {
        return {
          content: [
            {
              type: "text",
              text: `✅ Already routed: ${requestedBps}bps to Tend on ${tokenMint.slice(0, 8)}… No change needed.`,
            },
          ],
        };
      }

      // Rebalance: keep all non-Tend claimers, prorata-reduce them so they
      // share (10000 - requestedBps), then append Tend at requestedBps.
      const others = creators.filter((c) => c.wallet !== tendAdminWallet);
      const otherTotal = others.reduce((sum, c) => sum + (c.royaltyBps ?? 0), 0);
      if (otherTotal <= 0) {
        return {
          content: [
            { type: "text", text: `❌ Existing fee-share is empty — cannot rebalance.` },
          ],
        };
      }

      const remaining = 10_000 - requestedBps;
      const rebalanced: Array<{ wallet: string; bps: number }> = [];
      let allocated = 0;
      for (let i = 0; i < others.length; i++) {
        const c = others[i];
        const bps =
          i === others.length - 1
            ? remaining - allocated
            : Math.floor(((c.royaltyBps ?? 0) * remaining) / otherTotal);
        if (i < others.length - 1) allocated += bps;
        if (bps > 0) {
          rebalanced.push({ wallet: c.wallet, bps });
        }
      }
      rebalanced.push({ wallet: tendAdminWallet, bps: requestedBps });

      const sum = rebalanced.reduce((s, c) => s + c.bps, 0);
      if (sum !== 10_000) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Internal error: rebalanced total is ${sum}, expected 10000. Aborting.`,
            },
          ],
        };
      }

      let signatures: string[];
      try {
        signatures = await bags.updateFeeShareConfig(tokenMint, rebalanced);
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `❌ Update failed: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        };
      }

      const others_lines = rebalanced
        .filter((c) => c.wallet !== tendAdminWallet)
        .map((c) => `   ${c.wallet.slice(0, 8)}…  ${c.bps}bps (${(c.bps / 100).toFixed(2)}%)`);

      return {
        content: [
          {
            type: "text",
            text: [
              `✅ Auto-replenish enabled on ${tokenMint.slice(0, 8)}…`,
              `   Tend     ${tendAdminWallet.slice(0, 8)}…  ${requestedBps}bps (${(requestedBps / 100).toFixed(2)}%)`,
              ...others_lines,
              ``,
              `Signed and sent ${signatures.length} tx(s):`,
              ...signatures.map((s) => `   https://solscan.io/tx/${s}`),
              ``,
              `Every Bags fee claim will now auto-grow your campaign pool.`,
            ].join("\n"),
          },
        ],
      };
    }
  );
}
