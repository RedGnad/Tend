import { NextResponse } from "next/server";
import { getManagedTokens } from "@/lib/state";
import { getBagsClient } from "@/lib/bags-server";
import { PublicKey } from "@solana/web3.js";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get("wallet");

  const managed = await getManagedTokens();

  // Fetch tokens where this wallet is fee-share admin
  let adminMints: string[] = [];
  if (wallet) {
    try {
      const bags = getBagsClient();
      adminMints = await bags.getAdminTokenMints(new PublicKey(wallet));
    } catch {
      // Bags API may fail — continue with state data
    }
  }

  // For admin tokens, fetch claim stats to show current fee config
  const bags = getBagsClient();
  const adminTokens = await Promise.all(
    adminMints.map(async (mint) => {
      const existing = managed.find((t) => t.tokenMint === mint);

      // Fetch on-chain data — each call independent
      const [claimStats, lifetimeFees, creators] = await Promise.all([
        bags.getTokenClaimStats(mint).catch(() => []),
        bags.getTokenLifetimeFees(mint).catch(() => 0),
        bags.getTokenCreators(mint).catch(() => []),
      ]);

      // Build claimers from claimStats, or fall back to creators
      let claimers: Array<{ wallet: string; username: string; bps: number; totalClaimed: string }>;
      if (claimStats.length > 0) {
        claimers = claimStats.map((c: { wallet: string; username: string; royaltyBps: number; totalClaimed: string }) => ({
          wallet: c.wallet,
          username: c.username,
          bps: c.royaltyBps,
          totalClaimed: c.totalClaimed,
        }));
      } else if (creators.length > 0) {
        claimers = creators.map((c: { wallet: string; username: string; royaltyBps: number }) => ({
          wallet: c.wallet,
          username: c.username,
          bps: c.royaltyBps,
          totalClaimed: "0",
        }));
      } else {
        claimers = [];
      }

      return {
        tokenMint: mint,
        lifetimeFees: String(lifetimeFees),
        claimers,
        managed: existing ?? null,
      };
    })
  );

  return NextResponse.json({
    adminTokens,
    managedTokens: managed,
  });
}
