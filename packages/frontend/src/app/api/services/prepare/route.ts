import { NextResponse } from "next/server";
import { getBagsClient } from "@/lib/bags-server";
import { isAgentRunning, withStateLock } from "@/lib/state";
import { generateKeypair } from "@tend/shared";
import { PublicKey } from "@solana/web3.js";
import { randomUUID } from "node:crypto";

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
    const serviceWallet = generateKeypair();
    const prepareId = randomUUID();

    let claimers: Array<{ wallet: string; bps: number }> = [];

    // Store wallet + pending prepare intent under lock
    await withStateLock(async (state) => {
      const token = state.managedTokens[tokenMint] ?? {
        tokenMint,
        adminWallet: payerWallet,
        services: [],
        creatorBps: 10_000,
        totalServiceBps: 0,
        lifetimeFees: "0",
        createdAt: Date.now(),
      };

      if (token.services.some((s) => s.serviceId === serviceId)) {
        throw new Error(`Service "${serviceId}" already active`);
      }
      if (token.totalServiceBps + bps > 10_000) {
        throw new Error(
          `Cannot allocate ${bps} BPS. Only ${10_000 - token.totalServiceBps} available.`
        );
      }

      state.walletPool.push({
        publicKey: serviceWallet.publicKey,
        secretKey: serviceWallet.secretKey,
        assignedTo: `${serviceId}:${tokenMint}`,
      });

      // Store prepare intent for submit verification
      if (!state.pendingPrepares) state.pendingPrepares = [];
      state.pendingPrepares.push({
        prepareId,
        tokenMint,
        serviceId,
        bps,
        serviceWallet: serviceWallet.publicKey,
        payerWallet,
        createdAt: Date.now(),
      });

      claimers = [
        { wallet: payerWallet, bps: token.creatorBps - bps },
        ...token.services
          .filter((s) => s.status === "active")
          .map((s) => ({ wallet: s.claimerWallet, bps: s.bps })),
        { wallet: serviceWallet.publicKey, bps },
      ];
    });

    // Prepare unsigned transactions from Bags SDK
    const transactions = await bags.prepareUpdateFeeShareConfig(
      tokenMint,
      claimers,
      payer
    );

    return NextResponse.json({
      prepareId,
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
