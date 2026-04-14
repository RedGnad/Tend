#!/usr/bin/env node
/**
 * Standalone test for fraud-detector.
 * Runs checkFraud on the 3 known $TEND buys from the detector diag output.
 *
 *   node --env-file=.env.local packages/agent/build/test-fraud-gate.js
 *
 * Read-mostly — it WILL persist FraudDecision entries in state.json (so the
 * dashboard can surface them). Re-runs are idempotent (id dedup).
 */

import { BagsClient, loadKeypair, type Campaign } from "@tend/shared";
import { checkFraud } from "./fraud-detector.js";

const MINT = "6qa9oCypYpnWZyZNQ8v36eLbmWmcgHRv4MuU7BXQBAGS";

// The 3 organic buys surfaced by the diag on $TEND mainnet history
const KNOWN_BUYS = [
  {
    signature:
      "5G93JsEvzoq2QNt83AMzmTwFTSmnV4erPeJ2HBCkiJ1abxVa1DhdmPDeFMcBANdnDcz4YYvCAMerDzXSh1D69JMC",
    traderWallet: "M5q9egYvpRaxsPDJyDkrZZHL2STNneU6X3nUeBLoF73",
    solSpentLamports: 1_217_519n,
  },
  {
    signature:
      "5oLjTJfjEWmJkc7rJp8sxdS9g5DyQX1sCRWoto7AbttY5iPv8GFqpaaCPWo26iX8ot3McBqwLt8cMiS96am4wA4z",
    traderWallet: "2ZEgCyxUfnT7GZY9S8ZcjAaoqM8XpP98ZJ2rVjAX3nYK",
    solSpentLamports: 4_123n,
  },
  {
    signature:
      "2nL1QR6HmpXq12jvF2k96sXNKpH6oXNgHaTwowaihPEWGKBjsgPBZSFnWEdBUu8TVvvuvpkr8DYaAQSrwZfKBMSQ",
    traderWallet: "2ZEgCyxUfnT7GZY9S8ZcjAaoqM8XpP98ZJ2rVjAX3nYK",
    solSpentLamports: 1_834n,
  },
];

async function main() {
  const apiKey = process.env.BAGS_API_KEY!;
  const rpcUrl = process.env.SOLANA_RPC_URL!;
  const privateKey = process.env.TEND_PRIVATE_KEY!;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!anthropicKey) {
    console.error("ANTHROPIC_API_KEY missing — gate will return HOLD for all");
  }

  const keypair = loadKeypair(privateKey);
  const bags = new BagsClient({ apiKey, rpcUrl, privateKey: keypair });

  const campaign: Campaign = {
    tokenMint: MINT,
    creatorWallet: keypair.publicKey.toBase58(),
    cashbackBps: 500, // 5%
    poolCapLamports: "10000000",
    poolSpentLamports: "0",
    status: "live",
    createdAt: Date.now() - 3600_000,
    tokenInfo: { symbol: "TEND", name: "Tend" },
  };

  console.log("\n=== fraud-gate test ===");
  console.log(`mint: ${MINT.slice(0, 8)}  |  ${KNOWN_BUYS.length} buys\n`);

  for (const buy of KNOWN_BUYS) {
    console.log(`→ swap ${buy.signature.slice(0, 12)}  trader ${buy.traderWallet.slice(0, 8)}`);
    const t0 = Date.now();
    const decision = await checkFraud(bags, campaign, {
      signature: buy.signature,
      traderWallet: buy.traderWallet,
      solSpentLamports: buy.solSpentLamports,
    });
    const elapsed = Date.now() - t0;

    const tag =
      decision.decision === "allow"
        ? "✅ ALLOW "
        : decision.decision === "reject"
          ? "🛑 REJECT"
          : "⏸️  HOLD  ";
    console.log(`  ${tag}  (${elapsed}ms)`);
    console.log(`  reasoning: ${decision.reasoning}`);
    console.log(
      `  flags: [${decision.flags.join(", ")}]  |  wallet age: ${decision.walletContext.walletAgeHours}h  txs: ${decision.walletContext.txCount}  priors: ${decision.walletContext.priorTendPayouts}`
    );
    console.log("");
  }

  console.log("=== done ===\n");
}

main().catch((err) => {
  console.error("test failed:", err);
  process.exit(1);
});
