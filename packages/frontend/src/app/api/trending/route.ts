import { NextResponse } from "next/server";
import { getBagsClient } from "@/lib/bags-server";

export const dynamic = "force-dynamic";
export const revalidate = 300;

export async function GET() {
  try {
    const bags = getBagsClient();
    const top = await bags.getTopTokensByLifetimeFees();

    const tokens = top.slice(0, 9).map((t) => ({
      tokenMint: t.token,
      name: t.tokenInfo?.name ?? "",
      symbol: t.tokenInfo?.symbol ?? "",
      lifetimeFees: Number(t.lifetimeFees) || 0,
    }));

    return NextResponse.json({ tokens });
  } catch {
    return NextResponse.json({ tokens: [] });
  }
}
