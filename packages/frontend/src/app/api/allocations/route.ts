import { NextResponse } from "next/server";
import { loadTendState } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mint = searchParams.get("mint");

    const state = await loadTendState();
    const all = state.allocations ?? [];

    const filtered = mint
      ? all.filter((a) => a.tokenMint === mint)
      : all;

    // Return last 5, newest first
    const allocations = filtered.slice(-5).reverse();

    return NextResponse.json({ allocations });
  } catch {
    return NextResponse.json({ allocations: [] });
  }
}
