import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const AGENT_URL = process.env.TEND_AGENT_URL;

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!AGENT_URL) {
    return NextResponse.json(
      { error: "Agent URL not configured (TEND_AGENT_URL)" },
      { status: 503 }
    );
  }
  try {
    const res = await fetch(`${AGENT_URL}/campaigns/fee-share/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json(
      { error: "Failed to reach agent" },
      { status: 502 }
    );
  }
}
