import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
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

    // Each call independent — one failure shouldn't block the whole page
    const [lifetimeFees, creators, claimEvents, metadata] =
      await Promise.all([
        bags.getTokenLifetimeFees(mint).catch(() => 0),
        bags.getTokenCreators(mint).catch(() => []),
        bags.getTokenClaimEvents(mint, { limit: 100 }).catch(() => []),
        bags.getTokenMetadata(mint).catch(() => null),
      ]);

    const managed = await getManagedToken(mint);

    // Get actual claimable amounts for accurate unclaimed figure
    let totalUnclaimed = 0;
    for (const c of creators) {
      if (c.wallet && c.royaltyBps > 0) {
        try {
          const positions = await bags.getClaimablePositions(
            new PublicKey(c.wallet)
          );
          const tokenPositions = positions.filter(
            (p: { baseMint: string }) => p.baseMint === mint
          );
          totalUnclaimed += tokenPositions.reduce(
            (s: number, p: { totalClaimableLamportsUserShare: number }) =>
              s + p.totalClaimableLamportsUserShare,
            0
          );
        } catch {
          // Skip if position check fails
        }
      }
    }
    const totalClaimed = lifetimeFees - totalUnclaimed;

    return NextResponse.json({
      tokenMint: mint,
      tokenName: metadata?.name ?? null,
      tokenSymbol: metadata?.symbol ?? null,
      lifetimeFees,
      totalClaimed,
      unclaimedEstimate: totalUnclaimed,
      creators,
      recentClaims: claimEvents.slice(0, 20),
      managed,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch token health" },
      { status: 500 }
    );
  }
}
