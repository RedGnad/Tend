import { NextResponse } from "next/server";
import { getBagsClient } from "@/lib/bags-server";
import { loadTendState } from "@/lib/state";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { generateKeypair } from "@tend/shared";
import type { ActiveService, ManagedToken, TendState } from "@tend/shared";

const STATE_PATH = join(homedir(), ".tend", "state.json");

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { tokenMint, serviceId, bps } = body as {
      tokenMint: string;
      serviceId: string;
      bps: number;
    };

    if (!tokenMint || !serviceId || !bps) {
      return NextResponse.json(
        { error: "Missing tokenMint, serviceId, or bps" },
        { status: 400 }
      );
    }

    const bags = getBagsClient();
    const state = await loadTendState();

    // Get or create managed token
    let token: ManagedToken = state.managedTokens[tokenMint] ?? {
      tokenMint,
      adminWallet: bags.keypair.publicKey.toBase58(),
      services: [],
      creatorBps: 10_000,
      totalServiceBps: 0,
      lifetimeFees: "0",
      createdAt: Date.now(),
    };

    // Check duplicate
    if (token.services.some((s) => s.serviceId === serviceId)) {
      return NextResponse.json(
        { error: `Service "${serviceId}" already active on this token` },
        { status: 400 }
      );
    }

    // Check capacity
    if (token.totalServiceBps + bps > 10_000) {
      return NextResponse.json(
        {
          error: `Cannot allocate ${bps} BPS. Only ${10_000 - token.totalServiceBps} available.`,
        },
        { status: 400 }
      );
    }

    // Generate a service wallet
    const serviceWallet = generateKeypair();

    const service: ActiveService = {
      serviceId,
      tokenMint,
      bps,
      activatedAt: Date.now(),
      config: {},
      status: "active",
      claimerWallet: serviceWallet.publicKey,
      stats: {
        totalFeesEarned: "0",
        totalFeesClaimed: "0",
        actionsPerformed: 0,
      },
    };

    // Update state
    token.services.push(service);
    token.totalServiceBps = token.services.reduce((sum, s) => sum + s.bps, 0);
    token.creatorBps = 10_000 - token.totalServiceBps;
    state.managedTokens[tokenMint] = token;

    // Build claimers array
    const claimers = [
      { wallet: token.adminWallet, bps: token.creatorBps },
      ...token.services
        .filter((s) => s.status === "active")
        .map((s) => ({ wallet: s.claimerWallet, bps: s.bps })),
    ];

    // Update on-chain
    const signatures = await bags.updateFeeShareConfig(tokenMint, claimers);

    // Persist state
    await writeFile(STATE_PATH, JSON.stringify(state, null, 2));

    return NextResponse.json({
      success: true,
      service,
      signatures,
      token,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to add service" },
      { status: 500 }
    );
  }
}
