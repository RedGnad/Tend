import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import type {
  BagsClient,
  CashbackCampaign,
  HolderCampaign,
} from "@tend/shared";
import {
  getCampaign,
  listCampaigns,
  upsertCampaign,
  updateCampaign,
  getCampaignStats,
} from "../state/campaign-store.js";

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

/**
 * Minimal creator console — 5 tools.
 *
 *   create_campaign          — cashback pool (pay % per buy)
 *   create_holder_campaign   — holder dividends (pro-rata snapshots)
 *   pause_campaign           — freeze payouts without losing the pool
 *   topup_pool               — raise the cap (or revive from depleted)
 *   view_campaign_stats      — payouts, fraud decisions, utilization
 *
 * Every write uses the shared file lock in campaign-store so MCP + agent + web
 * all see the same state.
 */
export function registerCampaignTools(
  server: McpServer,
  bags: BagsClient,
  creatorWallet: string
) {
  server.tool(
    "create_campaign",
    "Launch a live reward campaign for a Bags token. The creator pre-funds a pool cap (in SOL); the agent pays traders a cashback % on every qualifying buy, after the AI fraud gate clears it.",
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

      const existing = await getCampaign(tokenMint);
      if (existing && existing.status === "live") {
        return {
          content: [
            {
              type: "text",
              text: `⚠️  A live campaign already exists for ${tokenMint.slice(0, 8)}… Pause it first or use topup_pool to extend.`,
            },
          ],
        };
      }

      // Best-effort token metadata
      let tokenInfo: CashbackCampaign["tokenInfo"] | undefined;
      try {
        const meta = await bags.getTokenMetadata(tokenMint);
        if (meta) tokenInfo = { name: meta.name, symbol: meta.symbol };
      } catch {
        /* metadata optional */
      }

      const campaign: CashbackCampaign = {
        tokenMint,
        creatorWallet,
        type: "cashback",
        config: { cashbackBps },
        poolCapLamports: solToLamports(poolSol).toString(),
        poolSpentLamports: existing?.poolSpentLamports ?? "0",
        status: "live",
        createdAt: existing?.createdAt ?? Date.now(),
        tokenInfo,
      };
      await upsertCampaign(campaign);

      const symbol = tokenInfo?.symbol ?? tokenMint.slice(0, 4);
      return {
        content: [
          {
            type: "text",
            text: [
              `✅ Campaign live: $${symbol}`,
              `   mint       ${tokenMint}`,
              `   cashback   ${(cashbackBps / 100).toFixed(2)}%`,
              `   pool cap   ${poolSol} SOL (${campaign.poolCapLamports} lamports)`,
              `   status     ${campaign.status}`,
              ``,
              `Agent will detect new buys, run the AI fraud gate, and pay cashback to allowed traders.`,
            ].join("\n"),
          },
        ],
      };
    }
  );

  server.tool(
    "create_holder_campaign",
    "Launch a live holder-dividends campaign for a Bags token. The creator pre-funds a pool cap (in SOL); on a cron cadence the agent snapshots holders, filters by minimum hold duration, runs each through the AI fraud gate, and pays a pro-rata share of a per-snapshot budget (poolCap × rewardBps / 10000).",
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

      const existing = await getCampaign(tokenMint);
      if (existing && existing.status === "live") {
        return {
          content: [
            {
              type: "text",
              text: `⚠️  A live campaign already exists for ${tokenMint.slice(0, 8)}… Pause it first or use topup_pool to extend.`,
            },
          ],
        };
      }

      let tokenInfo: HolderCampaign["tokenInfo"] | undefined;
      try {
        const meta = await bags.getTokenMetadata(tokenMint);
        if (meta) tokenInfo = { name: meta.name, symbol: meta.symbol };
      } catch {
        /* metadata optional */
      }

      const campaign: HolderCampaign = {
        tokenMint,
        creatorWallet,
        type: "holder",
        config: { rewardBps, minHoldHours, snapshotCronHours },
        poolCapLamports: solToLamports(poolSol).toString(),
        poolSpentLamports: existing?.poolSpentLamports ?? "0",
        status: "live",
        createdAt: existing?.createdAt ?? Date.now(),
        tokenInfo,
      };
      await upsertCampaign(campaign);

      const symbol = tokenInfo?.symbol ?? tokenMint.slice(0, 4);
      const perSnapshot = (poolSol * rewardBps) / 10_000;
      return {
        content: [
          {
            type: "text",
            text: [
              `✅ Holder campaign live: $${symbol}`,
              `   mint            ${tokenMint}`,
              `   reward rate     ${(rewardBps / 100).toFixed(2)}% of pool per snapshot`,
              `   min hold        ${minHoldHours}h`,
              `   cadence         every ${snapshotCronHours}h`,
              `   pool cap        ${poolSol} SOL`,
              `   per snapshot    ~${perSnapshot.toFixed(6)} SOL distributed pro-rata`,
              `   status          ${campaign.status}`,
              ``,
              `Agent will snapshot holders, run the AI fraud gate on each eligible wallet, and pay pro-rata dividends.`,
            ].join("\n"),
          },
        ],
      };
    }
  );

  server.tool(
    "pause_campaign",
    "Pause a live campaign. Stops new payouts immediately. The pool is preserved; resume later with create_campaign or topup_pool.",
    {
      tokenMint: z.string().describe("Token mint (base58)"),
    },
    async ({ tokenMint }) => {
      const campaign = await updateCampaign(tokenMint, (c) => {
        if (c.status === "live") c.status = "paused";
      });
      if (!campaign) {
        return {
          content: [
            { type: "text", text: `❌ No campaign found for ${tokenMint.slice(0, 8)}…` },
          ],
        };
      }
      if (campaign.status !== "paused") {
        return {
          content: [
            {
              type: "text",
              text: `ℹ️  Campaign ${tokenMint.slice(0, 8)}… is ${campaign.status} — cannot pause.`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `⏸️  Campaign ${tokenMint.slice(0, 8)}… paused. No further payouts until resumed.`,
          },
        ],
      };
    }
  );

  server.tool(
    "topup_pool",
    "Add more SOL to a campaign's pool cap. Revives a depleted or paused campaign back to live if headroom exists.",
    {
      tokenMint: z.string().describe("Token mint (base58)"),
      addSol: z
        .number()
        .positive()
        .describe("Amount of SOL to add to the pool cap"),
    },
    async ({ tokenMint, addSol }) => {
      const add = solToLamports(addSol);
      const campaign = await updateCampaign(tokenMint, (c) => {
        const newCap = BigInt(c.poolCapLamports) + add;
        c.poolCapLamports = newCap.toString();
        if (BigInt(c.poolSpentLamports) < newCap && c.status !== "live") {
          c.status = "live";
        }
      });
      if (!campaign) {
        return {
          content: [
            { type: "text", text: `❌ No campaign found for ${tokenMint.slice(0, 8)}…` },
          ],
        };
      }
      const remaining =
        BigInt(campaign.poolCapLamports) - BigInt(campaign.poolSpentLamports);
      return {
        content: [
          {
            type: "text",
            text: [
              `💰 Pool topped up for ${tokenMint.slice(0, 8)}…`,
              `   added      ${addSol} SOL`,
              `   new cap    ${lamportsToSol(campaign.poolCapLamports)} SOL`,
              `   remaining  ${lamportsToSol(remaining)} SOL`,
              `   status     ${campaign.status}`,
            ].join("\n"),
          },
        ],
      };
    }
  );

  server.tool(
    "view_campaign_stats",
    "Show live stats for a campaign: pool utilization, payouts (accrued/paid/failed), unique earners, fraud gate breakdown.",
    {
      tokenMint: z
        .string()
        .optional()
        .describe("Token mint. Omit to list all campaigns with summary stats."),
    },
    async ({ tokenMint }) => {
      if (!tokenMint) {
        const all = await listCampaigns();
        if (all.length === 0) {
          return { content: [{ type: "text", text: "No campaigns yet." }] };
        }
        const lines = await Promise.all(
          all.map(async (c) => {
            const stats = await getCampaignStats(c.tokenMint);
            const symbol = c.tokenInfo?.symbol ?? c.tokenMint.slice(0, 4);
            const spent = lamportsToSol(c.poolSpentLamports);
            const cap = lamportsToSol(c.poolCapLamports);
            const pct =
              Number(c.poolCapLamports) > 0
                ? ((Number(c.poolSpentLamports) / Number(c.poolCapLamports)) * 100).toFixed(0)
                : "0";
            return `  $${symbol}  ${c.status.padEnd(8)}  pool ${spent}/${cap} SOL (${pct}%)  earners ${stats.uniqueEarners}  paid ${stats.payoutsPaid}`;
          })
        );
        return {
          content: [
            {
              type: "text",
              text: [`📊 ${all.length} campaign(s):`, ...lines].join("\n"),
            },
          ],
        };
      }

      const campaign = await getCampaign(tokenMint);
      if (!campaign) {
        return {
          content: [
            { type: "text", text: `❌ No campaign for ${tokenMint.slice(0, 8)}…` },
          ],
        };
      }
      const stats = await getCampaignStats(tokenMint);
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
        default:
          rateLine = `   type        ${campaign.type}`;
      }

      return {
        content: [
          {
            type: "text",
            text: [
              `📊 Campaign $${symbol} — ${campaign.status.toUpperCase()}`,
              `   mint        ${tokenMint}`,
              rateLine,
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
}
