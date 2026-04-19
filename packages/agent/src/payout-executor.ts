import {
  SystemProgram,
  Transaction,
  PublicKey,
  ComputeBudgetProgram,
  Keypair,
} from "@solana/web3.js";
import type { BagsClient, Campaign } from "@tend/shared";
import {
  buildPayoutIx,
  isSpendingLimitExceeded,
  parseSquadsError,
} from "@tend/shared";
import bs58 from "bs58";
import { getSquadsRef, type CampaignSquadsRef } from "./squads-orchestrator.js";
import { withStateLock } from "./state-lock.js";
import { loadState } from "./state-reader.js";
import { log, logError } from "./logger.js";

/**
 * Shared payout executor — type-agnostic.
 *
 * Each campaign trigger (cashback, holder, sprint) accrues RewardPayout rows
 * into state.rewardPayouts. This module owns the on-chain leg: for every row
 * in "accrued" status, send SOL from the admin wallet and flip to "paid".
 *
 * Bounded by MAX_PAYOUTS_PER_TICK and ADMIN_MIN_RESERVE_LAMPORTS so a surge
 * can't drain the creator wallet in a single tick.
 */

export const MAX_PAYOUTS_PER_TICK = 10;
export const ADMIN_MIN_RESERVE_LAMPORTS = 5_000_000n; // keep 0.005 SOL for fees
const MAX_PAYOUT_ATTEMPTS = 3;
// Spike measured Squads `spending_limit_use` at ~15,360 CU. 30k gives headroom
// for SDK-side ix variations without paying meaningful extra priority fee.
const SQUADS_PAYOUT_CU_LIMIT = 30_000;
const AGENT_MIN_RESERVE_LAMPORTS = 5_000_000n; // Squads path: agent pays tx fees, vault pays SOL

const DRY_RUN_PAYOUTS = process.env.DRY_RUN_PAYOUTS === "1";

/**
 * Resolve the agent member keypair from env. If `TEND_AGENT_KEY` is unset we
 * fall back to the admin keypair — this unblocks dev/single-key deploys but
 * loses the whole point of the Squads custody (agent compromise = vault
 * compromise). Log loudly on fallback so ops can tell.
 */
let cachedAgentKey: Keypair | null = null;
function resolveAgentKey(admin: Keypair): Keypair {
  if (cachedAgentKey) return cachedAgentKey;
  const raw = process.env.TEND_AGENT_KEY;
  if (!raw) {
    logError(
      `[payout] TEND_AGENT_KEY unset — falling back to admin key for Squads payouts (custody separation disabled)`
    );
    cachedAgentKey = admin;
    return admin;
  }
  try {
    cachedAgentKey = Keypair.fromSecretKey(bs58.decode(raw));
    log(`[payout] Squads agent member: ${cachedAgentKey.publicKey.toBase58()}`);
    return cachedAgentKey;
  } catch (err) {
    logError(
      `[payout] TEND_AGENT_KEY malformed (${err instanceof Error ? err.message : String(err)}) — falling back to admin`
    );
    cachedAgentKey = admin;
    return admin;
  }
}

/**
 * Reconcile payouts left in "submitted" status (e.g. agent crashed between
 * sendRawTransaction and the post-confirm state write). For each, query the
 * RPC for the persisted signature: if it's confirmed/finalized on-chain, flip
 * to "paid"; if it never landed, reset to "accrued" so the normal loop retries
 * with a fresh blockhash. Without this, restart could double-send SOL.
 */
async function reconcileSubmitted(bags: BagsClient): Promise<void> {
  const state = await loadState();
  if (!state) return;
  const submitted = (state.rewardPayouts ?? []).filter(
    (p) => p.status === "submitted" && p.payoutTxSig
  );
  if (submitted.length === 0) return;

  const sigs = submitted.map((p) => p.payoutTxSig as string);
  let statuses: Awaited<
    ReturnType<typeof bags.connection.getSignatureStatuses>
  >["value"] = [];
  try {
    const res = await bags.connection.getSignatureStatuses(sigs, {
      searchTransactionHistory: true,
    });
    statuses = res.value;
  } catch (err) {
    logError("[payout][reconcile] getSignatureStatuses failed:", err);
    return;
  }

  await withStateLock(async (s) => {
    for (let i = 0; i < submitted.length; i++) {
      const row = (s.rewardPayouts ?? []).find((x) => x.id === submitted[i].id);
      if (!row) continue;
      const st = statuses[i];
      if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") && !st.err) {
        row.status = "paid";
        row.paidAt = Date.now();
        log(`[payout][reconcile] ${row.id} confirmed on-chain (${(row.payoutTxSig ?? "").slice(0, 10)}) — flipped to paid`);
      } else if (st && st.err) {
        row.status = "accrued";
        row.payoutTxSig = null;
        row.failedAttempts = (row.failedAttempts ?? 0) + 1;
        row.lastError = `submitted tx errored: ${JSON.stringify(st.err).slice(0, 200)}`;
        log(`[payout][reconcile] ${row.id} on-chain error — reset to accrued`);
      } else if (!st) {
        // Tx not found on-chain (dropped from mempool). Safe to retry.
        row.status = "accrued";
        row.payoutTxSig = null;
        log(`[payout][reconcile] ${row.id} tx ${(submitted[i].payoutTxSig ?? "").slice(0, 10)} not found — reset to accrued`);
      }
      // Otherwise (processed but not yet confirmed): leave as submitted, next tick will retry reconcile.
    }
  });
}

export async function payoutAccrued(bags: BagsClient): Promise<number> {
  // Crash recovery first — never enter the main loop with stale "submitted" rows.
  // Works for both admin-transfer and Squads payouts since `getSignatureStatuses`
  // is signature-based, independent of the ix that produced the tx.
  await reconcileSubmitted(bags);

  const state = await loadState();
  if (!state) return 0;

  const accrued = (state.rewardPayouts ?? [])
    .filter(
      (p) =>
        p.status === "accrued" &&
        (p.failedAttempts ?? 0) < MAX_PAYOUT_ATTEMPTS
    )
    .slice(0, MAX_PAYOUTS_PER_TICK);
  if (accrued.length === 0) return 0;

  // Build a lookup: for each (tokenMint, type) resolve the Squads ref if
  // the campaign has been provisioned. Payouts without a matching campaign
  // fall through to the admin path (defensive — shouldn't happen in normal
  // flow but avoids stranding payouts if campaign got deleted).
  const squadsRefByKey = new Map<string, CampaignSquadsRef>();
  for (const c of state.campaigns ?? []) {
    const ref = getSquadsRef(c as Campaign);
    if (ref) squadsRefByKey.set(`${c.tokenMint}|${c.type}`, ref);
  }

  let paidCount = 0;
  const admin = bags.keypair;
  const agent = resolveAgentKey(admin);

  for (const payout of accrued) {
    try {
      const amount = BigInt(payout.rewardLamports);

      // Dispatcher: Squads path if the campaign has been provisioned, else
      // legacy admin transfer. `campaignType` on the payout row narrows the
      // campaign lookup so multi-type mints (cashback + holder on same mint)
      // route to the correct SpendingLimit.
      const squadsRef = payout.campaignType
        ? squadsRefByKey.get(`${payout.tokenMint}|${payout.campaignType}`)
        : undefined;

      if (DRY_RUN_PAYOUTS) {
        log(
          `[payout][dry-run] would pay ${payout.rewardLamports} → ${payout.traderWallet.slice(0, 8)} (swap ${payout.swapTxSig.slice(0, 10)}) via ${squadsRef ? "squads" : "admin"}`
        );
        await withStateLock(async (s) => {
          const p = (s.rewardPayouts ?? []).find((x) => x.id === payout.id);
          if (p) {
            p.status = "paid";
            p.payoutTxSig = "DRY_RUN";
            p.paidAt = Date.now();
          }
        });
        paidCount += 1;
        continue;
      }

      // ── Squads path ─────────────────────────────────────────────────────
      // Vault holds SOL; agent key has SpendingLimit-bounded authority. Agent
      // only needs SOL for tx fees. On-chain cap enforcement means a
      // compromised agent key can only drain up to the period cap, not the
      // whole vault — which is the whole point of this flow.
      if (squadsRef) {
        const agentBalance = BigInt(
          await bags.connection.getBalance(agent.publicKey)
        );
        if (agentBalance < AGENT_MIN_RESERVE_LAMPORTS) {
          log(
            `[payout] Agent balance ${agentBalance} below fee reserve — stopping Squads payouts (fund ${agent.publicKey.toBase58()})`
          );
          break;
        }

        const payoutIx = buildPayoutIx({
          multisigPda: new PublicKey(squadsRef.squadsMultisigPda),
          spendingLimitPda: new PublicKey(squadsRef.squadsSpendingLimitPda),
          agentMember: agent.publicKey,
          vaultIndex: squadsRef.squadsVaultIndex,
          amountLamports: Number(amount),
          destination: new PublicKey(payout.traderWallet),
          memo: `tend-payout-${payout.id}`,
        });

        const squadsTx = new Transaction();
        squadsTx.add(
          ComputeBudgetProgram.setComputeUnitLimit({
            units: SQUADS_PAYOUT_CU_LIMIT,
          }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
          payoutIx
        );
        const { blockhash, lastValidBlockHeight } =
          await bags.connection.getLatestBlockhash("confirmed");
        squadsTx.recentBlockhash = blockhash;
        squadsTx.feePayer = agent.publicKey;
        squadsTx.sign(agent);

        const serializedSquads = squadsTx.serialize();
        const squadsSigBytes = squadsTx.signatures[0]?.signature;
        if (!squadsSigBytes)
          throw new Error("squads tx unsigned after sign() — refusing to send");
        const squadsTxSig = bs58.encode(squadsSigBytes);

        await withStateLock(async (s) => {
          const p = (s.rewardPayouts ?? []).find((x) => x.id === payout.id);
          if (p) {
            p.status = "submitted";
            p.payoutTxSig = squadsTxSig;
            p.submittedAt = Date.now();
          }
        });

        try {
          await bags.connection.sendRawTransaction(serializedSquads, {
            skipPreflight: false,
            maxRetries: 3,
          });
          await bags.connection.confirmTransaction(
            { signature: squadsTxSig, blockhash, lastValidBlockHeight },
            "confirmed"
          );
        } catch (sendErr) {
          // SpendingLimitExceeded is expected flow control (cap reached for
          // the period). Reset to accrued WITHOUT bumping failedAttempts so
          // the payout retries after the next period rollover.
          if (isSpendingLimitExceeded(sendErr)) {
            const parsed = parseSquadsError(sendErr);
            log(
              `[payout] ${payout.id} SpendingLimitExceeded (code ${parsed.code}) — resetting to accrued for next period`
            );
            await withStateLock(async (s) => {
              const p = (s.rewardPayouts ?? []).find(
                (x) => x.id === payout.id
              );
              if (p) {
                p.status = "accrued";
                p.payoutTxSig = null;
                p.submittedAt = undefined;
              }
            });
            continue;
          }
          throw sendErr;
        }

        await withStateLock(async (s) => {
          const p = (s.rewardPayouts ?? []).find((x) => x.id === payout.id);
          if (p) {
            p.status = "paid";
            p.paidAt = Date.now();
          }
        });

        log(
          `[payout][squads] Paid ${payout.rewardLamports} lamports → ${payout.traderWallet.slice(0, 8)} via vault[${squadsRef.squadsVaultIndex}] (${squadsTxSig.slice(0, 10)})`
        );
        paidCount += 1;
        continue;
      }

      // ── Legacy admin-transfer path ──────────────────────────────────────
      const balance = BigInt(
        await bags.connection.getBalance(admin.publicKey)
      );

      if (balance < amount + ADMIN_MIN_RESERVE_LAMPORTS) {
        log(
          `[payout] Admin balance ${balance} below reserve — stopping payouts`
        );
        break;
      }

      const tx = new Transaction();
      tx.add(
        ComputeBudgetProgram.setComputeUnitLimit({ units: 20_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }),
        SystemProgram.transfer({
          fromPubkey: admin.publicKey,
          toPubkey: new PublicKey(payout.traderWallet),
          lamports: Number(amount),
        })
      );

      const { blockhash, lastValidBlockHeight } =
        await bags.connection.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.feePayer = admin.publicKey;
      tx.sign(admin);

      // Capture the signature BEFORE broadcasting and persist it as
      // "submitted". If the agent crashes between send and confirm,
      // reconcileSubmitted() looks up this sig on next tick and either flips
      // to "paid" (if the tx landed) or back to "accrued" (if it didn't),
      // preventing double-sends.
      const serialized = tx.serialize();
      const sigBytes = tx.signatures[0]?.signature;
      if (!sigBytes) throw new Error("tx unsigned after sign() — refusing to send");
      const txSig = bs58.encode(sigBytes);

      await withStateLock(async (s) => {
        const p = (s.rewardPayouts ?? []).find((x) => x.id === payout.id);
        if (p) {
          p.status = "submitted";
          p.payoutTxSig = txSig;
          p.submittedAt = Date.now();
        }
      });

      await bags.connection.sendRawTransaction(serialized, {
        skipPreflight: false,
        maxRetries: 3,
      });
      await bags.connection.confirmTransaction(
        { signature: txSig, blockhash, lastValidBlockHeight },
        "confirmed"
      );

      await withStateLock(async (s) => {
        const p = (s.rewardPayouts ?? []).find((x) => x.id === payout.id);
        if (p) {
          p.status = "paid";
          p.paidAt = Date.now();
        }
      });

      log(
        `[payout] Paid ${payout.rewardLamports} lamports → ${payout.traderWallet.slice(0, 8)} (${txSig.slice(0, 10)})`
      );
      paidCount += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logError(`[payout] ${payout.id} failed:`, err);
      await withStateLock(async (s) => {
        const p = (s.rewardPayouts ?? []).find((x) => x.id === payout.id);
        if (!p) return;
        p.failedAttempts = (p.failedAttempts ?? 0) + 1;
        p.lastError = msg.slice(0, 240);
        // If we already broadcast (status="submitted"), don't escalate to
        // "failed" — reconcileSubmitted() will check on-chain next tick.
        if (p.status !== "submitted" && p.failedAttempts >= MAX_PAYOUT_ATTEMPTS) {
          p.status = "failed";
          log(
            `[payout] ${payout.id} marked failed after ${p.failedAttempts} attempt(s)`
          );
        }
      });
    }
  }

  return paidCount;
}
