import { NextResponse } from "next/server";
import { getManagedTokens } from "@/lib/state";

export const dynamic = "force-dynamic";

export async function GET() {
  const tokens = await getManagedTokens();
  return NextResponse.json({ tokens });
}
