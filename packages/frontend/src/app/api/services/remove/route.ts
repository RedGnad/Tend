import { NextResponse } from "next/server";
import { getBagsClient } from "@/lib/bags-server";
import { isAgentRunning, withStateLock } from "@/lib/state";
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
    let removed: ActiveService | undefined;
    let signatures: string[] = [];
    let token: ManagedToken | undefined;

    await withStateLock(async (state) => {
      token = state.managedTokens[tokenMint];
      if (!token) throw new Error("Token not managed");

      const idx = token.services.findIndex((s) => s.serviceId === serviceId);
      if (idx === -1) throw new Error(`Service "${serviceId}" not found on this token`);

      [removed] = token.services.splice(idx, 1);
      token.totalServiceBps = token.services.reduce((sum, s) => sum + s.bps, 0);
      token.creatorBps = 10_000 - token.totalServiceBps;

      // Free the wallet
      const walletEntry = state.walletPool.find(
        (w) => w.publicKey === removed!.claimerWallet
      );
      if (walletEntry) {
        walletEntry.assignedTo = undefined;
      }

      // Update on-chain
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
