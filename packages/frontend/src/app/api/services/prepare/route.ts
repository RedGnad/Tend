import { NextResponse } from "next/server";
import { getBagsClient } from "@/lib/bags-server";
import { loadTendState, isAgentRunning } from "@/lib/state";
import { generateKeypair } from "@tend/shared";
import { PublicKey } from "@solana/web3.js";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const STATE_PATH = join(homedir(), ".tend", "state.json");

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAgentRunning()) {
    return NextResponse.json(
      { error: "Agent not running locally. Start the Tend agent to manage services." },
      { status: 503 }
    );
  }
  try {
    const { tokenMint, serviceId, bps, payerWallet } = await request.json();

    if (!tokenMint || !serviceId || !bps || !payerWallet) {
      return NextResponse.json(
        { error: "Missing tokenMint, serviceId, bps, or payerWallet" },
        { status: 400 }
      );
    }

    // Validate Solana addresses
    let payer: PublicKey;
    try {
      new PublicKey(tokenMint);
      payer = new PublicKey(payerWallet);
    } catch {
      return NextResponse.json(
        { error: "Invalid token mint or wallet address" },
        { status: 400 }
      );
    }

    const bags = getBagsClient();
    const state = await loadTendState();

    // Get existing token state or create new
    const token = state.managedTokens[tokenMint] ?? {
      tokenMint,
      adminWallet: payerWallet,
      services: [],
      creatorBps: 10_000,
      totalServiceBps: 0,
      lifetimeFees: "0",
      createdAt: Date.now(),
    };

    // Validate
    if (token.services.some((s) => s.serviceId === serviceId)) {
      return NextResponse.json(
        { error: `Service "${serviceId}" already active` },
        { status: 400 }
      );
    }

    if (token.totalServiceBps + bps > 10_000) {
      return NextResponse.json(
        { error: `Cannot allocate ${bps} BPS. Only ${10_000 - token.totalServiceBps} available.` },
        { status: 400 }
      );
    }

    // Generate service wallet
    const serviceWallet = generateKeypair();

    // Store wallet in unified walletPool — never send secret to frontend
    if (!state.walletPool) state.walletPool = [];
    state.walletPool.push({
      publicKey: serviceWallet.publicKey,
      secretKey: serviceWallet.secretKey,
      assignedTo: `${serviceId}:${tokenMint}`,
    });
    await mkdir(join(homedir(), ".tend"), { recursive: true });
    await writeFile(STATE_PATH, JSON.stringify(state, null, 2));

    // Build claimers array with the new service
    const claimers = [
      { wallet: payerWallet, bps: token.creatorBps - bps },
      ...token.services
        .filter((s) => s.status === "active")
        .map((s) => ({ wallet: s.claimerWallet, bps: s.bps })),
      { wallet: serviceWallet.publicKey, bps },
    ];

    // Get unsigned transactions from Bags SDK
    const transactions = await bags.prepareUpdateFeeShareConfig(
      tokenMint,
      claimers,
      payer
    );

    // Only return public key — secret stays server-side
    return NextResponse.json({
      transactions,
      serviceWallet: serviceWallet.publicKey,
      serviceId,
      bps,
      claimers,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to prepare transaction" },
      { status: 500 }
    );
  }
}
