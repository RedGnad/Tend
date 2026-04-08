import { NextResponse } from "next/server";
import { getManagedTokens } from "@/lib/state";
import { getBagsClient } from "@/lib/bags-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const wallet = searchParams.get("wallet");

  // Get managed tokens from state
  const managed = await getManagedTokens();

  // If wallet provided, also fetch admin tokens from Bags
  let adminMints: string[] = [];
  if (wallet) {
    try {
      const bags = getBagsClient();
      adminMints = await bags.getAdminTokenMints();
    } catch {
      // Bags API may fail — continue with state data
    }
  }

  // Enrich managed tokens with live data
  const enriched = await Promise.all(
    managed.map(async (token) => {
      try {
        const bags = getBagsClient();
        const lifetimeFees = await bags.getTokenLifetimeFees(token.tokenMint);
        return { ...token, lifetimeFees: String(lifetimeFees) };
      } catch {
        return token;
      }
    })
  );

  return NextResponse.json({
    tokens: enriched,
    adminMints,
  });
}
