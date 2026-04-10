import { NextResponse } from "next/server";
import { loadTendState } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const mint = searchParams.get("mint");

    const state = await loadTendState();
    const all = state.decisions ?? [];

    const filtered = mint
      ? all.filter((d) => d.tokenMint === mint)
      : all;

    // Return last 20, newest first
    const decisions = filtered.slice(-20).reverse();

    return NextResponse.json({
      decisions,
      message: decisions.length === 0
        ? "Run the Tend agent locally to see AI-powered buyback decisions."
        : undefined,
    });
  } catch {
    return NextResponse.json({
      decisions: [],
      message: "Run agent locally to see activity",
    });
  }
}
