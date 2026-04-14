#!/usr/bin/env node
/**
 * Standalone test for swap-detector. READ-ONLY — no state mutations,
 * no on-chain writes. Run with:
 *   node --env-file=.env.local packages/agent/build/test-detector.js [mint]
 */

import { BagsClient, loadKeypair } from "@tend/shared";
import { detectNewBuys } from "./swap-detector.js";

const DEFAULT_MINT = "6qa9oCypYpnWZyZNQ8v36eLbmWmcgHRv4MuU7BXQBAGS"; // $TEND

function fmtSol(lamports: bigint): string {
  const sol = Number(lamports) / 1_000_000_000;
  return sol.toFixed(6);
}

async function main() {
  const mint = process.argv[2] ?? DEFAULT_MINT;

  const apiKey = process.env.BAGS_API_KEY;
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const privateKey = process.env.TEND_PRIVATE_KEY;

  if (!apiKey || !rpcUrl || !privateKey) {
    console.error(
      "Missing env: BAGS_API_KEY, SOLANA_RPC_URL, TEND_PRIVATE_KEY"
    );
    process.exit(1);
  }

  const keypair = loadKeypair(privateKey);
  const bags = new BagsClient({ apiKey, rpcUrl, privateKey: keypair });

  console.log(`\n=== swap-detector test ===`);
  console.log(`mint:    ${mint}`);
  console.log(`rpc:     ${rpcUrl.slice(0, 40)}...`);
  console.log(`admin:   ${keypair.publicKey.toBase58()}`);
  console.log(`since:   0 (full recent history, capped at 50 sigs)`);
  console.log("");

  const excludeWallets = new Set<string>([keypair.publicKey.toBase58()]);

  const t0 = Date.now();
  const { buys, maxFreshBlockTime } = await detectNewBuys(
    bags,
    mint,
    0,
    excludeWallets
  );
  const elapsed = Date.now() - t0;

  console.log(
    `Detected ${buys.length} buy(s) in ${(elapsed / 1000).toFixed(1)}s  (cursor→ ${maxFreshBlockTime})\n`
  );

  if (buys.length === 0) {
    console.log("⚠️  No buys detected. Possible causes:");
    console.log("   • No recent swaps on this mint");
    console.log("   • Parsing logic missed them (check pre/postTokenBalances)");
    console.log("   • All swaps came from excluded wallets");
    console.log("");
    console.log(
      "   Try another active mint, or inspect Solscan for recent swaps."
    );
    return;
  }

  // Sort oldest first for readability
  buys.sort((a, b) => a.blockTime - b.blockTime);

  for (const buy of buys) {
    const when = new Date(buy.blockTime * 1000).toISOString();
    console.log(`${when}  ${buy.signature.slice(0, 16)}...`);
    console.log(`  trader:  ${buy.traderWallet}`);
    console.log(`  sol in:  ${fmtSol(buy.solSpentLamports)} SOL`);
    console.log(`  tokens:  ${buy.tokensReceived} (raw)`);
    console.log(`  solscan: https://solscan.io/tx/${buy.signature}`);
    console.log("");
  }

  console.log(`=== done ===\n`);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
