import { NextResponse } from "next/server";
import { loadTendState } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mint: string }> }
) {
  const { mint } = await params;
  const state = await loadTendState();

  const forMint = (state.campaigns ?? []).filter((c) => c.tokenMint === mint);

  // If ?type= is specified, return that exact campaign type
  const url = new URL(request.url);
  const requestedType = url.searchParams.get("type");

  let campaign = null as (typeof forMint)[number] | null;
  if (requestedType) {
    campaign = forMint.find((c) => c.type === requestedType) ?? null;
  } else {
    // Fallback: highest-priority status
    const priority = ["live", "paused", "depleted"] as const;
    for (const status of priority) {
      const hit = forMint.find((c) => c.status === status);
      if (hit) {
        campaign = hit;
        break;
      }
    }
    if (!campaign) campaign = forMint[0] ?? null;
  }
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const payouts = (state.rewardPayouts ?? [])
    .filter((p) => p.tokenMint === mint)
    .sort((a, b) => b.createdAt - a.createdAt);

  const uniqueTraders = new Set(payouts.map((p) => p.traderWallet)).size;
  const totalPaidLamports = payouts
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + BigInt(p.rewardLamports), 0n);
  const totalVolumeLamports = payouts.reduce(
    (sum, p) => sum + BigInt(p.swapVolumeLamports),
    0n
  );

  const fraudDecisions = (state.fraudDecisions ?? [])
    .filter((d) => d.tokenMint === mint)
    .sort((a, b) => b.checkedAt - a.checkedAt)
    .slice(0, 20);

  return NextResponse.json({
    campaign,
    stats: {
      uniqueTraders,
      totalPayouts: payouts.length,
      totalPaidLamports: totalPaidLamports.toString(),
      totalVolumeLamports: totalVolumeLamports.toString(),
    },
    recentPayouts: payouts.slice(0, 20),
    fraudDecisions,
  });
}
