import { NextResponse } from "next/server";
import { loadTendState } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mint = searchParams.get("mint");

    const state = await loadTendState();
    const all = state.reports ?? [];

    const filtered = mint
      ? all.filter((r) => r.tokenMint === mint)
      : all;

    // Return last 10, newest first
    const reports = filtered.slice(-10).reverse();

    return NextResponse.json({ reports });
  } catch {
    return NextResponse.json({ reports: [] });
  }
}
