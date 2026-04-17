import { NextResponse } from "next/server";
import { loadTendState } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = await loadTendState();
  const campaigns = state.campaigns ?? [];
  const payouts = state.rewardPayouts ?? [];

  const liveCampaigns = campaigns.filter((c) => c.status === "live").length;
  const totalCampaigns = campaigns.length;

  const paid = payouts.filter((p) => p.status === "paid");
  const totalPaidLamports = paid.reduce(
    (sum, p) => sum + BigInt(p.rewardLamports),
    0n
  );
  const totalVolumeLamports = payouts.reduce(
    (sum, p) => sum + BigInt(p.swapVolumeLamports),
    0n
  );
  const uniqueEarners = new Set(payouts.map((p) => p.traderWallet)).size;

  const totalFeesClaimedLamports = campaigns.reduce(
    (sum, c) => sum + BigInt(c.feesClaimedLamports ?? "0"),
    0n
  );

  return NextResponse.json({
    liveCampaigns,
    totalCampaigns,
    totalPayouts: payouts.length,
    totalPaidLamports: totalPaidLamports.toString(),
    totalVolumeLamports: totalVolumeLamports.toString(),
    uniqueEarners,
    totalFeesClaimedLamports: totalFeesClaimedLamports.toString(),
  });
}
