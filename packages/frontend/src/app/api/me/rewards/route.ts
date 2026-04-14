import { NextResponse } from "next/server";
import { loadTendState } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get("wallet");
  if (!wallet) {
    return NextResponse.json({ error: "wallet param required" }, { status: 400 });
  }

  const state = await loadTendState();
  const campaigns = state.campaigns ?? [];
  const payouts = (state.rewardPayouts ?? [])
    .filter((p) => p.traderWallet === wallet)
    .sort((a, b) => b.createdAt - a.createdAt);

  const accruedLamports = payouts
    .filter((p) => p.status === "accrued")
    .reduce((sum, p) => sum + BigInt(p.rewardLamports), 0n);
  const paidLamports = payouts
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + BigInt(p.rewardLamports), 0n);

  // Attach campaign tokenInfo for display
  const enriched = payouts.map((p) => {
    const campaign = campaigns.find((c) => c.tokenMint === p.tokenMint);
    return {
      ...p,
      tokenInfo: campaign?.tokenInfo,
    };
  });

  return NextResponse.json({
    wallet,
    totals: {
      accruedLamports: accruedLamports.toString(),
      paidLamports: paidLamports.toString(),
      totalPayouts: payouts.length,
    },
    payouts: enriched,
  });
}
