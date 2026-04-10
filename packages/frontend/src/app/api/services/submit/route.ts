import { NextResponse } from "next/server";
import { getBagsClient } from "@/lib/bags-server";
import { isAgentRunning, withStateLock } from "@/lib/state";
import { VersionedTransaction } from "@solana/web3.js";
import type { ActiveService, ManagedToken } from "@tend/shared";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAgentRunning()) {
    return NextResponse.json(
      { error: "Agent not running locally. Start the Tend agent to manage services." },
      { status: 503 }
    );
  }
  try {
    const {
      signedTransactions,
      tokenMint,
      serviceId,
      bps,
      serviceWallet,
      payerWallet,
    } = await request.json();

    if (!signedTransactions?.length || !tokenMint || !serviceId) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const bags = getBagsClient();

    // Send signed transactions on-chain FIRST — before persisting state
    const signatures: string[] = [];
    for (const txBase64 of signedTransactions) {
      const txBytes = Buffer.from(txBase64, "base64");
      const tx = VersionedTransaction.deserialize(txBytes);

      const sig = await bags.connection.sendTransaction(tx, {
        skipPreflight: false,
        maxRetries: 3,
      });
      await Promise.race([
        bags.connection.confirmTransaction(sig, "confirmed"),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Transaction confirmation timeout")), 30_000)
        ),
      ]);
      signatures.push(sig);
    }

    // On-chain success confirmed — now persist state under lock
    let service: ActiveService | undefined;
    let token: ManagedToken | undefined;

    await withStateLock(async (state) => {
      token = state.managedTokens[tokenMint] ?? {
        tokenMint,
        adminWallet: payerWallet,
        services: [],
        creatorBps: 10_000,
        totalServiceBps: 0,
        lifetimeFees: "0",
        createdAt: Date.now(),
      };

      // Verify the wallet exists in pool (was stored during /prepare)
      const walletInPool = state.walletPool.find(
        (w) => w.publicKey === serviceWallet
      );
      if (!walletInPool) {
        throw new Error("Service wallet not found in pool — was /prepare called first?");
      }

      service = {
        serviceId,
        tokenMint,
        bps,
        activatedAt: Date.now(),
        config: {},
        status: "active",
        claimerWallet: serviceWallet,
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
    });

    return NextResponse.json({
      success: true,
      signatures,
      service,
      token,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to submit transaction" },
      { status: 500 }
    );
  }
}
