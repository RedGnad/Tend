import { NextResponse } from "next/server";
import { getBagsClient } from "@/lib/bags-server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const bags = getBagsClient();
    const topTokens = await bags.getTopTokensByLifetimeFees();

    const tokens = topTokens.slice(0, 20).map((t) => ({
      mint: t.token,
      name: t.tokenInfo?.name ?? "Unknown",
      symbol: t.tokenInfo?.symbol ?? "???",
      lifetimeFees: t.lifetimeFees,
      mcap: t.tokenInfo?.mcap ?? 0,
      priceUSD: t.tokenLatestPrice?.priceUSD ?? 0,
      holderCount: t.tokenInfo?.holderCount ?? 0,
      image: t.tokenInfo?.icon ?? null,
    }));

    return NextResponse.json({ tokens });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch leaderboard" },
      { status: 500 }
    );
  }
}
