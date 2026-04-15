import { NextResponse } from "next/server";
import { loadTendState } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = await loadTendState();
  const campaigns = (state.campaigns ?? []).filter(
    (c) =>
      c.status === "live" ||
      c.status === "paused" ||
      c.status === "depleted"
  );

  const payouts = state.rewardPayouts ?? [];

  const enriched = campaigns.map((c) => {
    const campaignPayouts = payouts.filter(
      (p) => p.tokenMint === c.tokenMint
    );
    const uniqueTraders = new Set(
      campaignPayouts.map((p) => p.traderWallet)
    ).size;
    const totalPaidLamports = campaignPayouts
      .filter((p) => p.status === "paid")
      .reduce((sum, p) => sum + BigInt(p.rewardLamports), 0n);

    return {
      ...c,
      stats: {
        uniqueTraders,
        totalPayouts: campaignPayouts.length,
        totalPaidLamports: totalPaidLamports.toString(),
      },
    };
  });

  return NextResponse.json({ campaigns: enriched });
}
