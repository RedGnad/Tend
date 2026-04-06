import { PublicKey } from "@solana/web3.js";

export const WSOL_MINT = new PublicKey(
  "So11111111111111111111111111111111111111112"
);
export const WSOL_MINT_STR = "So11111111111111111111111111111111111111112";

export const BAGS_API_BASE = "https://public-api-v2.bags.fm/api/v1";

export const TOTAL_BPS = 10_000;
export const MAX_CLAIMERS = 100;
export const MIN_SERVICE_BPS = 100; // 1%
export const MAX_CLAIMERS_NON_LUT = 7; // from SDK: BAGS_FEE_SHARE_ADMIN_MAX_CLAIMERS_NON_LUT

export const LAMPORTS_PER_SOL = 1_000_000_000;

export const TEND_STATE_DIR = ".tend";
export const TEND_STATE_FILE = "state.json";
export const TEND_WALLETS_FILE = "wallets.json";
