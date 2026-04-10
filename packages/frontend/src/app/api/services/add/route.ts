import { NextResponse } from "next/server";
import { getBagsClient } from "@/lib/bags-server";
import { isAgentRunning, withStateLock } from "@/lib/state";
import { generateKeypair } from "@tend/shared";
import type { ActiveService, ManagedToken } from "@tend/shared";

export async function POST(request: Request) {
  if (!isAgentRunning()) {
    return NextResponse.json(
      { error: "Agent not running locally. Start the Tend agent to manage services." },
      { status: 503 }
    );
  }
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

    // Generate service wallet before lock (no I/O dependency on state)
    const serviceWallet = generateKeypair();

    let service: ActiveService | undefined;
    let signatures: string[] = [];
    let token: ManagedToken | undefined;

    const finalState = await withStateLock(async (state) => {
      // Get or create managed token
      token = state.managedTokens[tokenMint] ?? {
        tokenMint,
        adminWallet: bags.keypair.publicKey.toBase58(),
        services: [],
        creatorBps: 10_000,
        totalServiceBps: 0,
        lifetimeFees: "0",
        createdAt: Date.now(),
      };

      // Validate
      if (token.services.some((s) => s.serviceId === serviceId)) {
        throw new Error(`Service "${serviceId}" already active on this token`);
      }
      if (token.totalServiceBps + bps > 10_000) {
        throw new Error(
          `Cannot allocate ${bps} BPS. Only ${10_000 - token.totalServiceBps} available.`
        );
      }

      // Store wallet in unified pool
      state.walletPool.push({
        publicKey: serviceWallet.publicKey,
        secretKey: serviceWallet.secretKey,
        assignedTo: `${serviceId}:${tokenMint}`,
      });

      service = {
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

      token.services.push(service);
      token.totalServiceBps = token.services.reduce((sum, s) => sum + s.bps, 0);
      token.creatorBps = 10_000 - token.totalServiceBps;
      state.managedTokens[tokenMint] = token;

      // Build claimers and update on-chain
      const claimers = [
        { wallet: token.adminWallet, bps: token.creatorBps },
        ...token.services
          .filter((s) => s.status === "active")
          .map((s) => ({ wallet: s.claimerWallet, bps: s.bps })),
      ];

      signatures = await bags.updateFeeShareConfig(tokenMint, claimers);
    });

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
