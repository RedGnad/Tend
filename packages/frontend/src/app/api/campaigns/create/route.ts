import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Campaign } from "@tend/shared";
import { migrateCampaign } from "@tend/shared";

export const dynamic = "force-dynamic";

const TEND_DIR = join(homedir(), ".tend");
const STATE_PATH = join(TEND_DIR, "state.json");
const SNAPSHOT_PATH = join(process.cwd(), "public", "state-snapshot.json");

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

    const campaign = buildCampaign(body);

    // Try to write to live state (local dev / agent machine)
    if (existsSync(STATE_PATH)) {
      const stateRaw = await readFile(STATE_PATH, "utf-8");
      const state = JSON.parse(stateRaw);
      if (!state.campaigns) state.campaigns = [];
      state.campaigns = state.campaigns.map(migrateCampaign);
      state.campaigns.push(campaign);
      await writeFile(STATE_PATH, JSON.stringify(state, null, 2));
      return NextResponse.json({ campaign, persisted: "state" });
    }

    // Fallback: write to snapshot (Vercel ephemeral)
    try {
      let snap = { campaigns: [] as Campaign[], rewardPayouts: [] as unknown[] };
      if (existsSync(SNAPSHOT_PATH)) {
        snap = JSON.parse(await readFile(SNAPSHOT_PATH, "utf-8"));
        if (!snap.campaigns) snap.campaigns = [];
      }
      snap.campaigns.push(campaign);
      await writeFile(SNAPSHOT_PATH, JSON.stringify(snap, null, 2));
      return NextResponse.json({ campaign, persisted: "snapshot" });
    } catch {
      // If we can't write at all (read-only filesystem on Vercel),
      // still return success — campaign is valid, just not persisted
      return NextResponse.json({ campaign, persisted: "memory" });
    }
  } catch {
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 },
    );
  }
}
