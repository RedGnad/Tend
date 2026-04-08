import { NextResponse } from "next/server";
import { getBagsClient } from "@/lib/bags-server";
import { getManagedToken } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ mint: string }> }
) {
  const { mint } = await params;

  try {
    const bags = getBagsClient();
    const [lifetimeFees, creators, claimStats, recentClaims] =
      await Promise.all([
        bags.getTokenLifetimeFees(mint),
        bags.getTokenCreators(mint),
        bags.getTokenClaimStats(mint),
        bags.getTokenClaimEvents(mint, { limit: 20 }),
      ]);

    const managed = await getManagedToken(mint);
    const totalClaimed = claimStats.reduce(
      (sum, c) => sum + Number(c.totalClaimed),
      0
    );

    return NextResponse.json({
      tokenMint: mint,
      lifetimeFees,
      totalClaimed,
      unclaimedEstimate: lifetimeFees - totalClaimed,
      creators,
      claimStats,
      recentClaims,
      managed,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch token health" },
      { status: 500 }
    );
  }
}
