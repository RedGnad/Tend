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
  const campaigns = (state.campaigns ?? []).filter(
    (c) => c.creatorWallet === wallet
  );
  const payouts = state.rewardPayouts ?? [];

  const enriched = campaigns
    .map((c) => {
      const campaignPayouts = payouts.filter(
        (p) => p.tokenMint === c.tokenMint && p.campaignType === c.type
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
          feesClaimedLamports: c.feesClaimedLamports ?? "0",
          feeClaimCount: c.feeClaimCount ?? 0,
          lastFeeClaimAt: c.lastFeeClaimAt ?? null,
        },
      };
    })
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  return NextResponse.json({ wallet, campaigns: enriched });
}
