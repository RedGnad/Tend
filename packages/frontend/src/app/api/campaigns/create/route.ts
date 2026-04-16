import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Campaign } from "@tend/shared";
import { withStateLock, isAgentRunning } from "@/lib/state";

export const dynamic = "force-dynamic";

const TEND_DIR = join(homedir(), ".tend");
const STATE_PATH = join(TEND_DIR, "state.json");

interface CreateBody {
  tokenMint: string;
  creatorWallet: string;
  type: "cashback" | "holder" | "sprint";
  poolCapSol: number;
  config: Record<string, number | string>;
}

function validateBody(body: unknown): CreateBody | null {
  const b = body as CreateBody;
  if (!b?.tokenMint || !b?.creatorWallet || !b?.type || !b?.poolCapSol)
    return null;
  if (!["cashback", "holder", "sprint"].includes(b.type)) return null;
  if (b.poolCapSol <= 0 || b.poolCapSol > 10) return null;
  return b;
}

function buildCampaign(body: CreateBody): Campaign {
  const poolCapLamports = String(Math.round(body.poolCapSol * 1_000_000_000));
  const base = {
    tokenMint: body.tokenMint,
    creatorWallet: body.creatorWallet,
    poolCapLamports,
    poolSpentLamports: "0",
    status: "live" as const,
    createdAt: Date.now(),
  };

  switch (body.type) {
    case "cashback":
      return {
        ...base,
        type: "cashback",
        config: {
          cashbackBps: Number(body.config.cashbackBps) || 500,
        },
      };
    case "holder":
      return {
        ...base,
        type: "holder",
        config: {
          rewardBps: Number(body.config.rewardBps) || 100,
          minHoldHours: Number(body.config.minHoldHours) || 1,
          snapshotCronHours: Number(body.config.snapshotCronHours) || 2,
        },
      };
    case "sprint":
      return {
        ...base,
        type: "sprint",
        config: {
          minBuyLamports: String(
            Math.round((Number(body.config.minBuySol) || 0.01) * 1_000_000_000),
          ),
          maxWinners: Number(body.config.maxWinners) || 5,
          bonusLamports: String(
            Math.round(
              (Number(body.config.bonusSol) || 0.005) * 1_000_000_000,
            ),
          ),
        },
      };
  }
}

export async function POST(req: Request) {
  try {
    const raw = await req.json();
    const body = validateBody(raw);
    if (!body) {
      return NextResponse.json({ error: "Invalid parameters" }, { status: 400 });
    }

    // Serverless (Vercel) — no local state, creation is not supported
    if (!existsSync(STATE_PATH)) {
      return NextResponse.json(
        {
          error:
            "Campaign creation requires the Tend agent running locally. This instance is read-only.",
        },
        { status: 503 },
      );
    }

    const campaign = buildCampaign(body);

    // Write with file lock — safe even if agent is writing concurrently
    await withStateLock((state) => {
      if (!state.campaigns) state.campaigns = [];
      state.campaigns.push(campaign);
    });

    const agentRunning = isAgentRunning();

    return NextResponse.json({
      campaign,
      persisted: "state",
      agentRunning,
      warning: agentRunning
        ? undefined
        : "Campaign saved but the Tend agent is not running. Start the agent for payouts to be processed.",
    });
  } catch {
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 },
    );
  }
}
