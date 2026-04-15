# Fraud Gate — Real HOLD Example

On 2026-04-15, during the `$TEND` launch sprint campaign, a fresh wallet
bought 0.00805 SOL worth of $TEND. The Claude Haiku fraud gate, which runs
inline before any reward payout, **flagged the buy as `hold`** — blocking
the sprint slot from being consumed until the wallet matures.

This is the AI in the critical money path: not a dashboard summary, not an
after-the-fact insight. A live decision that gates real SOL.

## The decision

Persisted as `fraudDecisions[]` entry in `~/.tend/state.json`:

```json
{
  "id": "4uSsFZbZPJjyDkC1-zCu1hXVf",
  "tokenMint": "6qa9oCypYpnWZyZNQ8v36eLbmWmcgHRv4MuU7BXQBAGS",
  "traderWallet": "zCu1hXVfBF2uqpBeTR71smPUyStNJQ3YJLnPdBbkfPc",
  "swapTxSig": "4uSsFZbZPJjyDkC1ingT9RzocxrZ3ksQrFdEnAeDdCjdUpYrZfat2UWHFijf72QKFpwkrMyBVqJSANH5srDWgnvF",
  "swapVolumeLamports": "8049547",
  "decision": "hold",
  "reasoning": "Wallet is 6 days old with only 6 total transactions, just below the 7-day organic threshold. Launch sprint campaigns are high-risk for sniping, and while the wallet shows some activity, the minimal transaction history combined with young age warrants human review to confirm legitimacy before payout.",
  "flags": [
    "new_wallet_6days",
    "low_tx_count",
    "launch_sprint_campaign"
  ],
  "model": "claude-haiku-4-5-20251001",
  "checkedAt": 1776284853734,
  "walletContext": {
    "walletAgeHours": 165,
    "txCount": 6,
    "priorTendPayouts": 0
  }
}
```

## What the agent did with it

1. The sprint trigger detected a qualifying buy (≥ `minBuyLamports`).
2. Before accruing the payout, it called `checkFraud()` with the swap
   context plus a `walletContext` enrichment (age, tx count, prior Tend
   payouts for that wallet).
3. Claude Haiku returned `hold` — the sprint slot stayed open, no
   `RewardPayout` was accrued, the pool was not debited.
4. The decision was persisted so the same swap signature is never
   re-evaluated (idempotent: a HOLD is terminal for that swap).

## Why this matters

Launch sprints are the highest-risk campaign type — the first N wallets
win a flat bonus, so a coordinated bot swarm can drain the pool in
minutes. The fraud gate is the only thing standing between a sprint pool
and a sybil farm. And it's a real LLM call, not a regex.

Verification on-chain: [view swap on Solscan](https://solscan.io/tx/4uSsFZbZPJjyDkC1ingT9RzocxrZ3ksQrFdEnAeDdCjdUpYrZfat2UWHFijf72QKFpwkrMyBVqJSANH5srDWgnvF)
