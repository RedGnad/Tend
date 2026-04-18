import { NextResponse } from "next/server";
import { forwardCampaignMutation } from "@/lib/agent-proxy";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ mint: string }> }
) {
  const { mint } = await params;
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  return forwardCampaignMutation(mint, "resume", body);
}
