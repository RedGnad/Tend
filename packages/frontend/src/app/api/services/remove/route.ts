import { NextResponse } from "next/server";
import { getBagsClient } from "@/lib/bags-server";
import { loadTendState, isAgentRunning } from "@/lib/state";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const STATE_PATH = join(homedir(), ".tend", "state.json");

export async function POST(request: Request) {
  if (!isAgentRunning()) {
    return NextResponse.json(
      { error: "Agent not running locally. Start the Tend agent to manage services." },
      { status: 503 }
    );
  }
  try {
    const body = await request.json();
    const { tokenMint, serviceId } = body as {
      tokenMint: string;
      serviceId: string;
    };

    if (!tokenMint || !serviceId) {
      return NextResponse.json(
        { error: "Missing tokenMint or serviceId" },
        { status: 400 }
      );
    }

    const bags = getBagsClient();
    const state = await loadTendState();
    const token = state.managedTokens[tokenMint];

    if (!token) {
      return NextResponse.json(
        { error: "Token not managed" },
        { status: 404 }
      );
    }

    const idx = token.services.findIndex((s) => s.serviceId === serviceId);
    if (idx === -1) {
      return NextResponse.json(
        { error: `Service "${serviceId}" not found on this token` },
        { status: 404 }
      );
    }

    const [removed] = token.services.splice(idx, 1);
    token.totalServiceBps = token.services.reduce((sum, s) => sum + s.bps, 0);
    token.creatorBps = 10_000 - token.totalServiceBps;

    // Update on-chain
    const claimers = [
      { wallet: token.adminWallet, bps: token.creatorBps },
      ...token.services
        .filter((s) => s.status === "active")
        .map((s) => ({ wallet: s.claimerWallet, bps: s.bps })),
    ];

    const signatures = await bags.updateFeeShareConfig(tokenMint, claimers);

    // Persist
    await mkdir(join(homedir(), ".tend"), { recursive: true });
    await writeFile(STATE_PATH, JSON.stringify(state, null, 2));

    return NextResponse.json({
      success: true,
      removed,
      signatures,
      token,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to remove service" },
      { status: 500 }
    );
  }
}
