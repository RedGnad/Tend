import { BagsClient } from "@tend/shared";
import { loadKeypair } from "@tend/shared";

let _client: BagsClient | null = null;

export function getBagsClient(): BagsClient {
  if (_client) return _client;

  const apiKey = process.env.BAGS_API_KEY;
  const rpcUrl =
    process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
  const privateKey = process.env.TEND_PRIVATE_KEY;

  if (!apiKey || !privateKey) {
    throw new Error("Missing BAGS_API_KEY or TEND_PRIVATE_KEY env vars");
  }

  _client = new BagsClient({
    apiKey,
    rpcUrl,
    privateKey: loadKeypair(privateKey),
  });

  return _client;
}
