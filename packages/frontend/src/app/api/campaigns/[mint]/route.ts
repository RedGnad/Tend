import { NextResponse } from "next/server";
import { loadTendState } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ mint: string }> }
) {
  const { mint } = await params;
  const state = await loadTendState();

  const campaign = (state.campaigns ?? []).find(
    (c) => c.tokenMint === mint
  );
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

  return NextResponse.json({
    campaign,
    stats: {
      uniqueTraders,
      totalPayouts: payouts.length,
      totalPaidLamports: totalPaidLamports.toString(),
      totalVolumeLamports: totalVolumeLamports.toString(),
    },
    recentPayouts: payouts.slice(0, 20),
  });
}
