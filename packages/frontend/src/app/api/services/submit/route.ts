import { NextResponse } from "next/server";
import { getBagsClient } from "@/lib/bags-server";
import { loadTendState, isAgentRunning } from "@/lib/state";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { VersionedTransaction } from "@solana/web3.js";
import type { ActiveService, ManagedToken } from "@tend/shared";

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

    // Send signed transactions on-chain
    const signatures: string[] = [];
    for (const txBase64 of signedTransactions) {
      const txBytes = Buffer.from(txBase64, "base64");
      const tx = VersionedTransaction.deserialize(txBytes);

      const sig = await bags.connection.sendTransaction(tx, {
        skipPreflight: false,
        maxRetries: 3,
      });
      // Timeout after 30s to avoid hanging requests
      const confirmation = await Promise.race([
        bags.connection.confirmTransaction(sig, "confirmed"),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Transaction confirmation timeout")), 30_000)
        ),
      ]);
      signatures.push(sig);
    }

    // Update local state
    const state = await loadTendState();

    let token: ManagedToken = state.managedTokens[tokenMint] ?? {
      tokenMint,
      adminWallet: payerWallet,
      services: [],
      creatorBps: 10_000,
      totalServiceBps: 0,
      lifetimeFees: "0",
      createdAt: Date.now(),
    };

    const service: ActiveService = {
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

    // Service wallet secret already stored server-side during /prepare

    await mkdir(join(homedir(), ".tend"), { recursive: true });
    await writeFile(STATE_PATH, JSON.stringify(state, null, 2));

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
