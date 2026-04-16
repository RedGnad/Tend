import { PublicKey } from "@solana/web3.js";
import type { BagsClient } from "@tend/shared";
import { log } from "./logger.js";

/**
 * Holder snapshot — enumerates all current holders of a token mint + computes
 * each wallet's earliest-known hold timestamp.
 *
 * Uses plain Solana RPC (getProgramAccounts against the SPL Token Program with
 * a mint filter + signatures-for-address for hold duration). No Helius / no
 * extra API key. Cost-bounded by MAX_HOLDERS_SCANNED.
 */

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);
const TOKEN_ACCOUNT_SIZE = 165;
const MAX_HOLDERS_SCANNED = 200; // cap cost: top-N by balance
const MIN_TOKEN_BALANCE = 1n; // skip zero/dust accounts

export interface HolderSnapshotEntry {
  ownerWallet: string;
  /** SPL token account pubkey (not the owner). Used to fetch first-seen. */
  tokenAccount: string;
  /** Raw token amount (no decimals applied). */
  balanceRaw: bigint;
  /** Unix seconds of the earliest on-chain signature touching this token account. */
  firstSeenBlockTime: number | null;
}

export interface HolderSnapshotResult {
  tokenMint: string;
  snapshotAt: number;
  totalHoldersScanned: number;
  entries: HolderSnapshotEntry[];
}

/**
 * Snapshot all token holders for a mint, sorted by balance desc and capped.
 * Excludes zero-balance accounts and any wallet in excludeWallets (creator,
 * admin payer, LP vaults, etc.).
 */
export async function snapshotHolders(
  bags: BagsClient,
  tokenMint: string,
  excludeWallets: Set<string>
): Promise<HolderSnapshotResult> {
  const snapshotAt = Math.floor(Date.now() / 1000);
  const mintPubkey = new PublicKey(tokenMint);

  let accounts: Awaited<
    ReturnType<typeof bags.connection.getParsedProgramAccounts>
  >;
  try {
    accounts = await bags.connection.getParsedProgramAccounts(
      TOKEN_PROGRAM_ID,
      {
        commitment: "confirmed",
        filters: [
          { dataSize: TOKEN_ACCOUNT_SIZE },
          { memcmp: { offset: 0, bytes: mintPubkey.toBase58() } },
        ],
      }
    );
  } catch (err) {
    log(
      `[holder-snapshot] getParsedProgramAccounts failed for ${tokenMint.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`
    );
    return {
      tokenMint,
      snapshotAt,
      totalHoldersScanned: 0,
      entries: [],
    };
  }

  const parsed: Array<{
    ownerWallet: string;
    tokenAccount: string;
    balanceRaw: bigint;
  }> = [];

  for (const acc of accounts) {
    const data = acc.account.data;
    if (!data || typeof data !== "object" || !("parsed" in data)) continue;
    const info = (data as { parsed?: { info?: unknown } }).parsed?.info as
      | {
          owner?: string;
          tokenAmount?: { amount?: string };
        }
      | undefined;
    if (!info?.owner || !info.tokenAmount?.amount) continue;

    const owner = info.owner;
    if (excludeWallets.has(owner)) continue;

    const balanceRaw = BigInt(info.tokenAmount.amount);
    if (balanceRaw < MIN_TOKEN_BALANCE) continue;

    parsed.push({
      ownerWallet: owner,
      tokenAccount: acc.pubkey.toBase58(),
      balanceRaw,
    });
  }

  // Dedup on owner (a wallet may have multiple token accounts — sum).
  const merged = new Map<
    string,
    { ownerWallet: string; tokenAccount: string; balanceRaw: bigint }
  >();
  for (const p of parsed) {
    const prev = merged.get(p.ownerWallet);
    if (prev) {
      prev.balanceRaw += p.balanceRaw;
    } else {
      merged.set(p.ownerWallet, { ...p });
    }
  }

  // Filter out bonding-curve / LP vaults: any wallet holding >50% of total
  // supply among scanned accounts is not a real user.
  const totalSupply = [...merged.values()].reduce(
    (sum, h) => sum + h.balanceRaw,
    0n
  );
  const filtered = [...merged.values()].filter((h) => {
    if (totalSupply === 0n) return true;
    const pct = (h.balanceRaw * 10_000n) / totalSupply;
    if (pct > 5_000n) {
      log(
        `[holder-snapshot] excluding vault ${h.ownerWallet.slice(0, 8)} (${Number(pct) / 100}% of supply)`
      );
      return false;
    }
    return true;
  });

  // Sort by balance desc and cap.
  const sorted = filtered.sort((a, b) =>
    a.balanceRaw < b.balanceRaw ? 1 : a.balanceRaw > b.balanceRaw ? -1 : 0
  );
  const top = sorted.slice(0, MAX_HOLDERS_SCANNED);

  // Fetch first-seen timestamp per token account — this approximates hold duration.
  // Serial to stay under RPC rate limits.
  const entries: HolderSnapshotEntry[] = [];
  for (const h of top) {
    let firstSeenBlockTime: number | null = null;
    try {
      const sigs = await bags.connection.getSignaturesForAddress(
        new PublicKey(h.tokenAccount),
        { limit: 1000 },
        "confirmed"
      );
      if (sigs.length > 0) {
        const oldest = sigs[sigs.length - 1];
        firstSeenBlockTime = oldest.blockTime ?? null;
      }
    } catch (err) {
      log(
        `[holder-snapshot] first-seen fetch failed for ${h.tokenAccount.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    entries.push({
      ownerWallet: h.ownerWallet,
      tokenAccount: h.tokenAccount,
      balanceRaw: h.balanceRaw,
      firstSeenBlockTime,
    });
  }

  return {
    tokenMint,
    snapshotAt,
    totalHoldersScanned: sorted.length,
    entries,
  };
}
