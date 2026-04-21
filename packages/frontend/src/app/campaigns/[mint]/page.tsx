"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ArrowLeft,
  ExternalLink,
  Users,
  TrendingUp,
  Shield,
  ShieldAlert,
  Repeat,
  Lock,
  Pause as PauseIcon,
  Play as PlayIcon,
} from "lucide-react";
import type { Campaign, RewardPayout, FraudDecision } from "@tend/shared";

type SpendingPeriod = "oneTime" | "day" | "week" | "month";
import bs58 from "bs58";

// Inlined to keep the client bundle free of node:crypto (the shared barrel pulls it in).
// Keep in sync with buildAuthMessage in packages/shared/src/wallet-auth.ts.
function buildAuthMessage(p: {
  action: string;
  mint: string;
  type: string;
  timestampMs: number;
}): string {
  return `tend:${p.action}:${p.mint}:${p.type}:${p.timestampMs}`;
}
import { JupiterSwap } from "@/components/jupiter-swap";
import { PriceChart } from "@/components/price-chart";
import { calculateSustainability } from "@/lib/sustainability";
import { provisionSquadsCustody, type ProvisionStep } from "@/lib/provision-squads";

interface CampaignDeposit {
  txSig: string;
  fromWallet: string;
  amountLamports: string;
  kind: "create" | "topup";
  createdAt: number;
}

interface CampaignWithdrawal {
  txSig: string;
  toWallet: string;
  amountLamports: string;
  createdAt: number;
}

interface FeeClaimEvent {
  claimedLamports: string;
  signatures: string[];
  source: "admin" | "service-wallet";
  createdAt: number;
}

interface CampaignDetail {
  campaign: Campaign;
  adminWallet?: string | null;
  stats: {
    uniqueTraders: number;
    totalPayouts: number;
    totalPaidLamports: string;
    totalVolumeLamports: string;
    seededLamports?: string;
    feesClaimedLamports?: string;
    feeClaimCount?: number;
    lastFeeClaimAt?: number | null;
  };
  recentPayouts: RewardPayout[];
  fraudDecisions?: FraudDecision[];
  deposits?: CampaignDeposit[];
  withdrawals?: CampaignWithdrawal[];
  feeClaims?: FeeClaimEvent[];
}

function formatSol(lamports: number | string | bigint): string {
  const sol = Number(lamports) / 1_000_000_000;
  if (sol >= 1000) return (sol / 1000).toFixed(1) + "K";
  if (sol >= 1) return sol.toFixed(3);
  if (sol > 0) return sol.toFixed(5);
  return "0";
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function CampaignDetailPage() {
  const params = useParams<{ mint: string }>();
  const searchParams = useSearchParams();
  const mint = params.mint;
  const campaignType = searchParams.get("type");
  const { publicKey, connected, signMessage, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [showTopupModal, setShowTopupModal] = useState(false);
  const [topupSol, setTopupSol] = useState("0.05");
  const [topupStep, setTopupStep] = useState<"idle" | "sending" | "confirming" | "signing" | "submitting">("idle");

  // Fee-share auto-replenish — owner-only, opens its own modal
  const [showRouteModal, setShowRouteModal] = useState(false);
  const [routeBps, setRouteBps] = useState("10"); // % of fee-share to Tend
  const [routing, setRouting] = useState(false);
  const [routeStep, setRouteStep] = useState<
    "idle" | "signing" | "preparing" | "sending" | "confirming"
  >("idle");
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeDone, setRouteDone] = useState(false);
  const [routeSigs, setRouteSigs] = useState<string[]>([]);

  // Squads custody provisioning — owner-only, attaches a SpendingLimit
  const [showProvisionModal, setShowProvisionModal] = useState(false);
  const [provisionAmountSol, setProvisionAmountSol] = useState("0.1");
  const [provisionPeriod, setProvisionPeriod] = useState<SpendingPeriod>("day");
  const [provisionFundingSol, setProvisionFundingSol] = useState("0");
  const [provisioning, setProvisioning] = useState(false);
  const [provisionStep, setProvisionStep] = useState<ProvisionStep | "idle">(
    "idle"
  );
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [provisionDone, setProvisionDone] = useState<{
    multisigPda: string;
    vaultPda: string;
    spendingLimitPda: string;
  } | null>(null);
  const [provisionSigs, setProvisionSigs] = useState<string[]>([]);

  // Track IDs we've already rendered so new ones arriving via polling can be
  // highlighted briefly. Seeded on first successful load so nothing pulses
  // on the initial render.
  const seenDecisionIds = useRef<Set<string>>(new Set());
  const seenPayoutIds = useRef<Set<string>>(new Set());
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());

  const refreshDetail = useCallback(
    async (isInitial = false) => {
      if (!mint) return;
      const qs = campaignType ? `?type=${campaignType}` : "";
      try {
        // Initial fetch right after /creator redirect can race the DB write
        // on Render (Postgres). Retry a few times before giving up so the
        // user doesn't see "Campaign not found" for a freshly-created one.
        const maxAttempts = isInitial ? 6 : 1;
        let r: Response | null = null;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          r = await fetch(`/api/campaigns/${mint}${qs}`);
          if (r.status !== 404) break;
          if (attempt < maxAttempts - 1) {
            await new Promise((res) => setTimeout(res, 800));
          }
        }
        if (!r) return;
        if (r.status === 404) {
          if (isInitial) setNotFound(true);
          return;
        }
        if (!r.ok) return;
        const d = (await r.json()) as CampaignDetail;

        if (isInitial) {
          seenDecisionIds.current = new Set((d.fraudDecisions ?? []).map((x) => x.id));
          seenPayoutIds.current = new Set((d.recentPayouts ?? []).map((x) => x.id));
        } else {
          const newDecisions = (d.fraudDecisions ?? [])
            .filter((x) => !seenDecisionIds.current.has(x.id))
            .map((x) => x.id);
          const newPayouts = (d.recentPayouts ?? [])
            .filter((x) => !seenPayoutIds.current.has(x.id))
            .map((x) => x.id);
          newDecisions.forEach((id) => seenDecisionIds.current.add(id));
          newPayouts.forEach((id) => seenPayoutIds.current.add(id));
          const newIds = [...newDecisions, ...newPayouts];
          if (newIds.length) {
            setFreshIds((prev) => new Set([...prev, ...newIds]));
            setTimeout(() => {
              setFreshIds((prev) => {
                const next = new Set(prev);
                for (const id of newIds) next.delete(id);
                return next;
              });
            }, 6000);
          }
        }
        setDetail(d);
      } catch {
        if (isInitial) setNotFound(true);
      }
    },
    [mint, campaignType]
  );

  useEffect(() => {
    refreshDetail(true);
  }, [refreshDetail]);

  // Live polling. Pauses when the tab is hidden so we don't hammer the agent
  // from idle background tabs.
  useEffect(() => {
    if (!mint) return;
    const POLL_MS = 15_000;
    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (timer) return;
      timer = setInterval(() => {
        if (document.visibilityState === "visible") refreshDetail(false);
      }, POLL_MS);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    start();
    const onVis = () => {
      if (document.visibilityState === "visible") {
        refreshDetail(false);
        start();
      } else {
        stop();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [mint, refreshDetail]);

  async function handleTopup() {
    if (!detail || !publicKey || !signMessage || !sendTransaction) return;
    const adminWallet = detail.adminWallet;
    if (!adminWallet) {
      setMutationError("Admin wallet unavailable — agent not configured");
      return;
    }
    const amountSol = parseFloat(topupSol);
    if (!Number.isFinite(amountSol) || amountSol <= 0) {
      setMutationError("Enter a positive SOL amount");
      return;
    }
    const lamports = Math.round(amountSol * 1_000_000_000);
    if (lamports < 1_000_000) {
      setMutationError("Minimum topup is 0.001 SOL");
      return;
    }

    setMutating(true);
    setMutationError(null);

    try {
      // 1. Build + send SOL transfer tx
      setTopupStep("sending");
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash("confirmed");
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey(adminWallet),
          lamports,
        })
      );
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;
      const txSig = await sendTransaction(tx, connection);

      // 2. Wait for confirmation
      setTopupStep("confirming");
      await connection.confirmTransaction(
        { signature: txSig, blockhash, lastValidBlockHeight },
        "confirmed"
      );

      // 3. Sign auth message
      setTopupStep("signing");
      const timestampMs = Date.now();
      const message = buildAuthMessage({
        action: "topup",
        mint: detail.campaign.tokenMint,
        type: detail.campaign.type,
        timestampMs,
      });
      const sigBytes = await signMessage(new TextEncoder().encode(message));

      // 4. POST to agent
      setTopupStep("submitting");
      const res = await fetch(
        `/api/campaigns/${detail.campaign.tokenMint}/topup`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: detail.campaign.type,
            message,
            signature: bs58.encode(sigBytes),
            publicKey: publicKey.toBase58(),
            txSig,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMutationError(data.error || `Failed (${res.status})`);
        return;
      }

      const added = BigInt(data.addedLamports ?? lamports.toString());
      setDetail({
        ...detail,
        campaign: {
          ...detail.campaign,
          poolCapLamports: (
            BigInt(detail.campaign.poolCapLamports) + added
          ).toString(),
          status: data.status ?? detail.campaign.status,
        } as typeof detail.campaign,
      });
      setShowTopupModal(false);
    } catch (err) {
      setMutationError(
        err instanceof Error ? err.message : "Topup failed"
      );
    } finally {
      setTopupStep("idle");
      setMutating(false);
    }
  }

  async function flipStatus(action: "pause" | "resume") {
    if (!detail || !publicKey || !signMessage) return;
    setMutating(true);
    setMutationError(null);
    try {
      const timestampMs = Date.now();
      const message = buildAuthMessage({
        action,
        mint: detail.campaign.tokenMint,
        type: detail.campaign.type,
        timestampMs,
      });
      const sigBytes = await signMessage(new TextEncoder().encode(message));
      const res = await fetch(
        `/api/campaigns/${detail.campaign.tokenMint}/${action}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: detail.campaign.type,
            message,
            signature: bs58.encode(sigBytes),
            publicKey: publicKey.toBase58(),
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMutationError(data.error || `Failed (${res.status})`);
        return;
      }
      setDetail({
        ...detail,
        campaign: {
          ...detail.campaign,
          status: data.status ?? detail.campaign.status,
        } as typeof detail.campaign,
      });
    } catch (err) {
      setMutationError(
        err instanceof Error ? err.message : "Signature or network error"
      );
    } finally {
      setMutating(false);
    }
  }


  async function handleRouteFees() {
    if (!detail || !publicKey || !signMessage || !sendTransaction) return;
    const pct = parseFloat(routeBps);
    if (!Number.isFinite(pct) || pct < 0.01 || pct > 50) {
      setRouteError("Route % must be between 0.01 and 50");
      return;
    }
    const tendBps = Math.round(pct * 100);

    setRouting(true);
    setRouteError(null);
    try {
      // 1. Sign auth message (action: route-fees)
      setRouteStep("signing");
      const timestampMs = Date.now();
      const message = buildAuthMessage({
        action: "route-fees",
        mint: detail.campaign.tokenMint,
        type: "_", // unused for fee-share routing, kept for message-format parity
        timestampMs,
      });
      const sigBytes = await signMessage(new TextEncoder().encode(message));

      // 2. Ask agent to assemble REPLACE-semantics txs
      setRouteStep("preparing");
      const prepRes = await fetch("/api/campaigns/fee-share/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenMint: detail.campaign.tokenMint,
          message,
          signature: bs58.encode(sigBytes),
          publicKey: publicKey.toBase58(),
          tendBps,
        }),
      });
      const prepData = await prepRes.json().catch(() => ({}));
      if (!prepRes.ok) {
        throw new Error(
          prepData.error || `Failed to prepare (${prepRes.status})`
        );
      }
      const txs: Array<{ transaction: string; blockhash: string }> = Array.isArray(
        prepData.transactions
      )
        ? prepData.transactions
        : [];
      if (txs.length === 0) {
        throw new Error("Agent returned no transactions");
      }

      // 3. Sign + send each tx with the connected wallet (creator pays fees)
      const sigs: string[] = [];
      for (const { transaction } of txs) {
        setRouteStep("sending");
        const tx = VersionedTransaction.deserialize(
          Buffer.from(transaction, "base64")
        );
        const sig = await sendTransaction(tx, connection);
        setRouteStep("confirming");
        const latest = await connection.getLatestBlockhash("confirmed");
        await connection.confirmTransaction(
          {
            signature: sig,
            blockhash: latest.blockhash,
            lastValidBlockHeight: latest.lastValidBlockHeight,
          },
          "confirmed"
        );
        sigs.push(sig);
      }
      setRouteSigs(sigs);
      setRouteDone(true);
    } catch (err) {
      setRouteError(
        err instanceof Error ? err.message : "Something went wrong"
      );
    } finally {
      setRouteStep("idle");
      setRouting(false);
    }
  }

  async function handleProvisionSquads() {
    if (!detail || !publicKey || !signMessage || !sendTransaction) return;
    const cap = parseFloat(provisionAmountSol);
    if (!Number.isFinite(cap) || cap <= 0) {
      setProvisionError("Cap must be > 0 SOL");
      return;
    }
    const capLamports = BigInt(Math.round(cap * 1_000_000_000));
    const fund = parseFloat(provisionFundingSol);
    let fundLamports: bigint | undefined;
    if (Number.isFinite(fund) && fund > 0) {
      fundLamports = BigInt(Math.round(fund * 1_000_000_000));
    }

    setProvisioning(true);
    setProvisionError(null);
    setProvisionSigs([]);
    try {
      const result = await provisionSquadsCustody({
        tokenMint: detail.campaign.tokenMint,
        type: detail.campaign.type,
        publicKeyB58: publicKey.toBase58(),
        capLamports,
        period: provisionPeriod,
        fundLamports,
        campaignConfig: detail.campaign.config as Record<string, unknown>,
        connection,
        signMessage,
        sendTransaction,
        onStep: (s) => setProvisionStep(s),
        onSig: (s) => setProvisionSigs((prev) => [...prev, s]),
      });
      setProvisionDone({
        multisigPda: result.multisigPda,
        vaultPda: result.vaultPda,
        spendingLimitPda: result.spendingLimitPda,
      });
      refreshDetail(false);
    } catch (err) {
      setProvisionError(
        err instanceof Error ? err.message : "Provision failed"
      );
    } finally {
      setProvisionStep("idle");
      setProvisioning(false);
    }
  }

  if (notFound) {
    return (
      <div className="max-w-[900px] mx-auto px-6 py-20 text-center">
        <p className="text-[var(--text-secondary)] mb-3">Campaign not found.</p>
        <Link
          href="/campaigns"
          className="text-[var(--accent)] hover:underline inline-flex items-center gap-1"
        >
          <ArrowLeft size={13} /> Back to campaigns
        </Link>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="max-w-[1280px] mx-auto px-6 py-10">
        <div className="h-16 bg-[var(--bg-card)] rounded-2xl shimmer mb-4" />
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
          <div className="h-[420px] bg-[var(--bg-card)] rounded-2xl shimmer" />
          <div className="h-[420px] bg-[var(--bg-card)] rounded-2xl shimmer" />
        </div>
      </div>
    );
  }

  const {
    campaign,
    stats,
    recentPayouts,
    fraudDecisions = [],
    deposits = [],
    withdrawals = [],
    feeClaims = [],
  } = detail;
  const isOwner =
    connected && publicKey?.toBase58() === campaign.creatorWallet;
  const symbol =
    campaign.tokenInfo?.symbol ?? campaign.tokenMint.slice(0, 4).toUpperCase();
  const name = campaign.tokenInfo?.name ?? symbol;
  const remaining =
    BigInt(campaign.poolCapLamports) - BigInt(campaign.poolSpentLamports);
  const forecast = calculateSustainability(
    remaining,
    detail.recentPayouts ?? [],
    detail.feeClaims ?? []
  );
  const progress = Math.min(
    100,
    (Number(campaign.poolSpentLamports) / Number(campaign.poolCapLamports)) *
      100
  );
  const isLive = campaign.status === "live";

  const myPayouts = connected
    ? recentPayouts.filter((p) => p.traderWallet === publicKey?.toBase58())
    : [];
  const myEarnedLamports = myPayouts.reduce(
    (sum, p) => sum + BigInt(p.rewardLamports),
    0n
  );

  return (
    <div className="max-w-[1280px] mx-auto px-6 py-6">
      {/* Top bar: back + token identity + stats inline */}
      <div className="flex items-center gap-4 mb-4">
        <Link
          href="/campaigns"
          className="text-[var(--text-muted)] hover:text-[var(--accent)] flex-shrink-0"
        >
          <ArrowLeft size={16} />
        </Link>

        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-[var(--accent-dim)] flex items-center justify-center text-lg font-bold font-display gradient-text flex-shrink-0">
            {symbol.charAt(0)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-bold font-display">${symbol}</h1>
              {name !== symbol && (
                <span className="text-[13px] text-[var(--text-muted)] truncate">
                  {name}
                </span>
              )}
              {/* Type badge — colour-coded so creators & traders instantly see
                  whether this is a trader-facing cashback pool, a holder
                  snapshot airdrop, or a time-boxed sprint. */}
              <span
                className={`inline-flex items-center text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
                  campaign.type === "holder"
                    ? "bg-[rgba(168,85,247,0.14)] text-[#c084fc]"
                    : campaign.type === "cashback"
                      ? "bg-[rgba(6,182,212,0.14)] text-[#22d3ee]"
                      : "bg-[rgba(249,115,22,0.14)] text-[#fb923c]"
                }`}
              >
                {campaign.type}
              </span>
              <span
                className={`inline-flex items-center gap-1 text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider ${
                  isLive
                    ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                    : "bg-[rgba(113,113,122,0.12)] text-[#a1a1aa]"
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isLive
                      ? "bg-[var(--accent)] shadow-[0_0_4px_var(--accent)]"
                      : "bg-[#a1a1aa]"
                  }`}
                />
                {campaign.status}
              </span>
            </div>
            <a
              href={`https://solscan.io/token/${campaign.tokenMint}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-[var(--text-muted)] font-mono hover:text-[var(--accent)] inline-flex items-center gap-1"
            >
              {campaign.tokenMint.slice(0, 6)}...
              {campaign.tokenMint.slice(-4)}
              <ExternalLink size={9} />
            </a>
          </div>
        </div>

        {/* Inline stats */}
        <div className="hidden md:flex items-center gap-6 flex-shrink-0">
          <div className="text-right">
            <p className="text-lg font-semibold font-mono gradient-text leading-tight">
              {campaign.type === "cashback"
                ? `${(campaign.config.cashbackBps / 100).toFixed(1)}%`
                : campaign.type === "holder"
                  ? `${(campaign.config.rewardBps / 100).toFixed(1)}%`
                  : `${formatSol(campaign.config.bonusLamports)} SOL`}
            </p>
            <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">
              {campaign.type === "cashback"
                ? "Cashback"
                : campaign.type === "holder"
                  ? "Per snapshot"
                  : "Bonus"}
            </p>
          </div>
          <div className="w-px h-8 bg-[var(--border)]" />
          <div className="text-right">
            <p className="text-lg font-semibold font-mono leading-tight text-[var(--accent)]">
              {formatSol(remaining)}
            </p>
            <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">
              SOL left
            </p>
          </div>
          <div className="w-px h-8 bg-[var(--border)]" />
          <div className="text-right">
            <p className="text-lg font-semibold font-mono leading-tight">
              {stats.uniqueTraders}
            </p>
            <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">
              Traders
            </p>
          </div>
        </div>
      </div>

      {/* Creator controls — visible only when connected wallet owns the campaign.
          Layout: left = ownership + custody state chip (static truth),
                  right = action cluster (what the creator can do).
          Action hierarchy (right→left by frequency): Pause, Auto-refuel, Top up.
          Primary CTA (Top up) sits rightmost so it anchors the eye. */}
      {connected &&
        publicKey?.toBase58() === campaign.creatorWallet && (
          <div className="mb-4 flex items-center justify-between gap-4 pl-3 pr-2 py-2 rounded-xl bg-[var(--bg-card)] border border-[rgba(0,255,178,0.15)]">
            {/* Left: ownership + custody state */}
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex items-center gap-1.5 text-[11px] text-[var(--text-secondary)] whitespace-nowrap">
                <Shield size={12} className="text-[var(--accent)]" />
                <span className="font-semibold text-[var(--text-primary)]">
                  You own this campaign
                </span>
              </span>
              <span className="hidden sm:block w-px h-4 bg-[var(--border)]" />
              {campaign.squadsSpendingLimitPda ? (
                <span
                  className="hidden sm:inline-flex items-center gap-1.5 text-[10px] font-mono tracking-wider px-2 py-1 rounded-md bg-[var(--accent-dim)] text-[var(--accent)]"
                  title="Funds held in an audited Squads vault. The agent can only spend up to this cap per period — no unbounded withdrawals."
                >
                  <Lock size={10} />
                  <span>
                    Vault ·{" "}
                    {campaign.squadsSpendingLimitAmountLamports
                      ? formatSol(campaign.squadsSpendingLimitAmountLamports)
                      : "—"}{" "}
                    SOL /{" "}
                    {campaign.squadsSpendingLimitPeriod === "oneTime"
                      ? "total"
                      : campaign.squadsSpendingLimitPeriod ?? "period"}{" "}
                    cap
                  </span>
                </span>
              ) : (
                <button
                  onClick={() => {
                    setProvisionError(null);
                    setProvisionDone(null);
                    setProvisionSigs([]);
                    setShowProvisionModal(true);
                  }}
                  disabled={mutating || routing || provisioning}
                  className="hidden sm:inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded-md bg-[rgba(234,179,8,0.08)] text-[#eab308] hover:bg-[rgba(234,179,8,0.14)] disabled:opacity-50 transition"
                  title="Vault setup didn't finish — click to resume (payouts are blocked until this lands)"
                >
                  <ShieldAlert size={10} />
                  Finish vault setup
                </button>
              )}
              {mutationError && (
                <span className="text-[11px] text-[#ef4444] truncate">
                  {mutationError}
                </span>
              )}
            </div>

            {/* Right: actions */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={() => {
                  setRouteError(null);
                  setRouteDone(false);
                  setRouteSigs([]);
                  setShowRouteModal(true);
                }}
                disabled={mutating || routing}
                className="text-[11px] px-2.5 py-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--accent)] hover:bg-[var(--bg)] disabled:opacity-50 transition inline-flex items-center gap-1.5"
                title="Route a slice of your Bags fee-share to keep this pool funded automatically"
              >
                <Repeat size={11} />
                Auto-refuel
              </button>
              {campaign.status !== "paused" ? (
                <button
                  onClick={() => flipStatus("pause")}
                  disabled={mutating}
                  aria-label="Pause campaign"
                  className="w-7 h-7 rounded-lg text-[var(--text-muted)] hover:text-[#eab308] hover:bg-[rgba(234,179,8,0.08)] disabled:opacity-50 transition inline-flex items-center justify-center"
                  title="Pause payouts"
                >
                  {mutating ? (
                    <span className="text-[10px]">…</span>
                  ) : (
                    <PauseIcon size={13} />
                  )}
                </button>
              ) : (
                <button
                  onClick={() => flipStatus("resume")}
                  disabled={mutating}
                  className="text-[11px] px-3 py-1.5 rounded-lg bg-[var(--accent-dim)] text-[var(--accent)] hover:brightness-110 disabled:opacity-50 transition font-semibold inline-flex items-center gap-1.5"
                >
                  <PlayIcon size={11} />
                  {mutating ? "…" : "Resume"}
                </button>
              )}
              <button
                onClick={() => {
                  setMutationError(null);
                  setShowTopupModal(true);
                }}
                disabled={mutating}
                className="gradient-btn text-[11px] px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50 transition"
              >
                Top up
              </button>
            </div>
          </div>
        )}

      {/* Pool progress — thin, full width */}
      <div className="mb-4">
        <div className="h-1 w-full bg-[var(--bg-card)] rounded-full overflow-hidden">
          <div
            className="h-full bg-[var(--accent)] transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] mt-1.5">
          <span className="text-[var(--text-secondary)]">
            <span className="font-mono font-semibold text-[var(--text-primary)]">
              {progress.toFixed(1)}%
            </span>{" "}
            distributed
          </span>
          <span className="text-[var(--text-secondary)]">
            <span className="font-mono font-semibold text-[var(--accent)]">
              {formatSol(remaining)} SOL
            </span>{" "}
            remaining
          </span>
        </div>

        {/* Fee-sharing breakdown — proof the flywheel is live */}
        {(Number(stats.feesClaimedLamports ?? "0") > 0 ||
          Number(stats.seededLamports ?? "0") > 0) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-[var(--text-secondary)]">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm bg-[var(--text-secondary)]" />
              <span className="font-mono font-semibold">{formatSol(stats.seededLamports ?? "0")} SOL</span>
              <span className="text-[var(--text-muted)]">seeded by creator</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-sm bg-[var(--accent)]" />
              <span className="font-mono font-semibold text-[var(--accent)]">+{formatSol(stats.feesClaimedLamports ?? "0")} SOL</span>
              <span className="text-[var(--text-muted)]">
                auto-claimed from trading fees
                {(stats.feeClaimCount ?? 0) > 0 && ` (${stats.feeClaimCount} claim${stats.feeClaimCount === 1 ? "" : "s"})`}
              </span>
            </span>
            {forecast.kind === "self-sustaining" && (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm bg-[var(--accent)]" />
                <span className="font-mono font-semibold text-[var(--accent)]">
                  Self-sustaining
                </span>
                <span className="text-[var(--text-muted)]">
                  fees cover payouts (+{formatSol(forecast.netLamportsPerDay)} SOL/day)
                </span>
              </span>
            )}
            {forecast.kind === "depleting" && (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-sm bg-[var(--text-secondary)]" />
                <span className="font-mono font-semibold text-[var(--text-primary)]">
                  ~{forecast.daysRemaining < 1
                    ? `${(forecast.daysRemaining * 24).toFixed(1)}h`
                    : `${forecast.daysRemaining.toFixed(1)}d`}
                </span>
                <span className="text-[var(--text-muted)]">
                  pool runway at current rate
                </span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Main: chart (large) + swap (sidebar) */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-4 mb-4">
        {/* Chart — takes most of the width */}
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-4 min-h-[420px]">
          <PriceChart mint={campaign.tokenMint} />
        </div>

        {/* Swap panel */}
        <div className="space-y-3">
          {/* Earn banner — the hook */}
          <div className="rounded-2xl p-4 border border-[rgba(0,255,178,0.2)] bg-[rgba(0,255,178,0.04)]">
            <div className="flex items-center gap-3 mb-1.5">
              <span className="text-3xl font-bold font-mono gradient-text leading-none">
                {campaign.type === "cashback"
                  ? `${(campaign.config.cashbackBps / 100).toFixed(0)}%`
                  : campaign.type === "holder"
                    ? `${(campaign.config.rewardBps / 100).toFixed(0)}%`
                    : `${formatSol(campaign.config.bonusLamports)} SOL`}
              </span>
              <span className="text-[13px] text-[var(--text-secondary)] font-semibold leading-tight">
                {campaign.type === "cashback"
                  ? "cashback on every buy"
                  : campaign.type === "holder"
                    ? "rewards per snapshot"
                    : "bonus per winner"}
              </span>
            </div>
            <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
              {campaign.type === "cashback"
                ? `Buy $${symbol} below → get SOL back in your wallet within minutes. AI fraud gate protects every payout.`
                : campaign.type === "holder"
                  ? `Hold $${symbol} for ${campaign.config.minHoldHours}h+ to qualify. Snapshots every ${campaign.config.snapshotCronHours}h. AI fraud gate protects every payout.`
                  : `${campaign.config.maxWinners} spots left. Buy ≥ ${formatSol(campaign.config.minBuyLamports)} SOL below to qualify. AI fraud gate protects every payout.`}
            </p>
            <div className="flex items-center gap-3 mt-2.5 text-[11px]">
              <span className="font-mono font-semibold text-[var(--accent)]">
                {formatSol(remaining)} SOL
              </span>
              <span className="text-[var(--text-muted)]">left in pool</span>
              <span className="text-[var(--border)]">·</span>
              <span className="font-mono font-semibold text-[var(--text-primary)]">
                {stats.uniqueTraders}
              </span>
              <span className="text-[var(--text-muted)]">traders</span>
              <span className="text-[var(--border)]">·</span>
              <span className="text-[var(--text-muted)]">processed every ~2 min</span>
            </div>
          </div>

          {/* My rewards (if connected) */}
          {connected && myPayouts.length > 0 && (
            <div className="flex items-center justify-between rounded-xl p-3 bg-[var(--bg-card)] border border-[var(--border)]">
              <p className="text-[11px] text-[var(--text-muted)]">
                Your rewards
              </p>
              <p className="font-mono text-[var(--accent)] font-semibold text-[14px]">
                +{formatSol(myEarnedLamports)} SOL
              </p>
            </div>
          )}

          {/* Swap */}
          {isLive && (
            <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-4">
              <JupiterSwap outputMint={campaign.tokenMint} />
            </div>
          )}
        </div>
      </div>

      {/* Bottom row: fraud gate + recent payouts side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* AI Fraud Gate — compact table */}
        {fraudDecisions.length > 0 && (() => {
          const blocked = fraudDecisions.filter((d) => d.decision !== "allow");
          const allowed = fraudDecisions.filter((d) => d.decision === "allow");
          const blockRate = (blocked.length / fraudDecisions.length) * 100;
          const blockedVolume = blocked.reduce(
            (sum, d) => sum + BigInt(d.swapVolumeLamports),
            0n
          );
          return (
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Shield size={12} className="text-[var(--accent)]" />
                <p className="text-[10px] text-[var(--accent)] uppercase tracking-[0.15em] font-mono font-semibold">
                  AI fraud gate
                </p>
                <span className="flex items-center gap-1 text-[9px] text-[var(--text-muted)] font-mono uppercase">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
                  live
                </span>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] font-mono">
                {allowed.length} allowed · {blocked.length} blocked
              </p>
            </div>

            {blocked.length > 0 && (
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div className="rounded-lg bg-[var(--bg)] border border-[var(--border)] px-3 py-2">
                  <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider font-mono mb-0.5">
                    Block rate
                  </p>
                  <p className="font-mono text-[15px] font-semibold text-[var(--text-primary)]">
                    {blockRate.toFixed(blockRate < 10 ? 1 : 0)}%
                  </p>
                </div>
                <div className="rounded-lg bg-[var(--bg)] border border-[var(--border)] px-3 py-2">
                  <p className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider font-mono mb-0.5">
                    Volume filtered
                  </p>
                  <p className="font-mono text-[15px] font-semibold text-[var(--accent)]">
                    {formatSol(blockedVolume)} SOL
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1">
              {fraudDecisions.map((d) => (
                <div
                  key={d.id}
                  className={`py-1.5 px-2 rounded-lg bg-[var(--bg)] text-[12px] transition-all ${
                    freshIds.has(d.id)
                      ? "ring-1 ring-[var(--accent)]"
                      : ""
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase flex-shrink-0 ${
                        d.decision === "allow"
                          ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                          : d.decision === "reject"
                            ? "bg-[rgba(239,68,68,0.12)] text-[#ef4444]"
                            : "bg-[rgba(234,179,8,0.12)] text-[#eab308]"
                      }`}
                    >
                      {d.decision}
                    </span>
                    <span className="font-mono text-[var(--text-secondary)] flex-shrink-0">
                      {d.traderWallet.slice(0, 4)}...{d.traderWallet.slice(-4)}
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)] font-mono flex-shrink-0 ml-auto">
                      {timeAgo(d.checkedAt)}
                    </span>
                  </div>
                  <p className="text-[var(--text-muted)] text-[11px] italic mt-1 break-words leading-snug">
                    {d.reasoning}
                  </p>
                </div>
              ))}
            </div>

          </div>
          );
        })()}

        {/* Recent payouts — compact */}
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TrendingUp size={12} className="text-[var(--accent)]" />
              <p className="text-[10px] text-[var(--accent)] uppercase tracking-[0.15em] font-mono font-semibold">
                Recent payouts
              </p>
              <span className="flex items-center gap-1 text-[9px] text-[var(--text-muted)] font-mono uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
                live
              </span>
            </div>
            <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
              <Users size={10} />
              <span className="font-mono">
                {stats.uniqueTraders} traders ·{" "}
                {formatSol(stats.totalPaidLamports)} SOL
              </span>
            </div>
          </div>

          {recentPayouts.length === 0 ? (
            <p className="text-[12px] text-[var(--text-muted)] py-4 text-center">
              No payouts yet. Be the first.
            </p>
          ) : (
            <div className="space-y-1.5">
              {recentPayouts.slice(0, 8).map((p) => (
                <div
                  key={p.id}
                  className={`flex items-center gap-2 py-1.5 px-2 rounded-lg bg-[var(--bg)] text-[12px] transition-all ${
                    freshIds.has(p.id)
                      ? "ring-1 ring-[var(--accent)]"
                      : ""
                  }`}
                >
                  <span
                    className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase flex-shrink-0 ${
                      p.status === "paid"
                        ? "bg-[var(--accent-dim)] text-[var(--accent)]"
                        : "bg-[rgba(234,179,8,0.12)] text-[#eab308]"
                    }`}
                  >
                    {p.status}
                  </span>
                  <span className="font-mono text-[var(--text-secondary)] flex-shrink-0">
                    {p.traderWallet.slice(0, 4)}...{p.traderWallet.slice(-4)}
                  </span>
                  <span className="text-[var(--text-muted)] flex-1 text-[11px] font-mono">
                    {campaign.type === "holder"
                      ? "snapshot"
                      : `${formatSol(p.swapVolumeLamports)} SOL`}
                  </span>
                  <span className="font-mono text-[var(--accent)] font-semibold flex-shrink-0">
                    +{formatSol(p.rewardLamports)}
                  </span>
                  {p.payoutTxSig && p.payoutTxSig !== "DRY_RUN" ? (
                    <a
                      href={`https://solscan.io/tx/${p.payoutTxSig}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-[var(--text-muted)] hover:text-[var(--accent)] flex-shrink-0"
                    >
                      <ExternalLink size={10} />
                    </a>
                  ) : (
                    <span className="w-[10px] flex-shrink-0" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Owner audit — fee-claim events with on-chain links */}
        {isOwner && feeClaims.length > 0 && (
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Repeat size={12} className="text-[var(--accent)]" />
              <p className="text-[10px] text-[var(--accent)] uppercase tracking-[0.15em] font-mono font-semibold">
                Fee-claim events
              </p>
            </div>
            {/* Capped server-side at 20, but a busy pool still stacks ~640px.
                Keep the section height stable so siblings don't shift. */}
            <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1">
              {feeClaims.map((e) => (
                <div
                  key={e.createdAt + (e.signatures[0] ?? "")}
                  className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-[var(--bg)] text-[12px]"
                >
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase flex-shrink-0 bg-[var(--accent-dim)] text-[var(--accent)]">
                    {e.source === "admin" ? "claim" : "sweep"}
                  </span>
                  <span className="font-mono text-[var(--text-muted)] text-[11px] flex-shrink-0">
                    {timeAgo(e.createdAt)}
                  </span>
                  <span className="flex-1" />
                  <span className="font-mono text-[var(--accent)] font-semibold flex-shrink-0">
                    +{formatSol(e.claimedLamports)} SOL
                  </span>
                  {e.signatures[0] && (
                    <a
                      href={`https://solscan.io/tx/${e.signatures[0]}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-[var(--text-muted)] hover:text-[var(--accent)] flex-shrink-0"
                    >
                      <ExternalLink size={10} />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Owner audit — deposits + withdrawals with on-chain links */}
        {isOwner && (deposits.length > 0 || withdrawals.length > 0) && (
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-3">
              <Shield size={12} className="text-[var(--accent)]" />
              <p className="text-[10px] text-[var(--accent)] uppercase tracking-[0.15em] font-mono font-semibold">
                Funding history
              </p>
            </div>
            <div className="space-y-1.5 max-h-[280px] overflow-y-auto pr-1">
              {deposits.map((d) => (
                <div
                  key={d.txSig}
                  className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-[var(--bg)] text-[12px]"
                >
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase flex-shrink-0 bg-[var(--accent-dim)] text-[var(--accent)]">
                    {d.kind}
                  </span>
                  <span className="font-mono text-[var(--text-muted)] text-[11px] flex-shrink-0">
                    {timeAgo(d.createdAt)}
                  </span>
                  <span className="flex-1" />
                  <span className="font-mono text-[var(--accent)] font-semibold flex-shrink-0">
                    +{formatSol(d.amountLamports)} SOL
                  </span>
                  <a
                    href={`https://solscan.io/tx/${d.txSig}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-[var(--text-muted)] hover:text-[var(--accent)] flex-shrink-0"
                  >
                    <ExternalLink size={10} />
                  </a>
                </div>
              ))}
              {withdrawals.map((w) => (
                <div
                  key={w.txSig}
                  className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-[var(--bg)] text-[12px]"
                >
                  <span className="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase flex-shrink-0 bg-[rgba(239,68,68,0.15)] text-[#ef4444]">
                    withdraw
                  </span>
                  <span className="font-mono text-[var(--text-muted)] text-[11px] flex-shrink-0">
                    {timeAgo(w.createdAt)}
                  </span>
                  <span className="flex-1" />
                  <span className="font-mono text-[#ef4444] font-semibold flex-shrink-0">
                    −{formatSol(w.amountLamports)} SOL
                  </span>
                  <a
                    href={`https://solscan.io/tx/${w.txSig}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-[var(--text-muted)] hover:text-[var(--accent)] flex-shrink-0"
                  >
                    <ExternalLink size={10} />
                  </a>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Auto-replenish modal — owner-only, routes a slice of Bags fee-share to Tend */}
      {showRouteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => !routing && setShowRouteModal(false)}
        >
          <div
            className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-6 max-w-sm w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-1">
              <Repeat size={14} className="text-[var(--accent)]" />
              <h3 className="text-lg font-bold font-display">
                Auto-replenish from fees
              </h3>
            </div>
            <p className="text-[12px] text-[var(--text-muted)] mb-4 leading-relaxed">
              Route a slice of your Bags fee-share to the Tend admin wallet.
              Existing claimers stay — their share is reduced prorata so the
              total still equals 100%. Each fee claim auto-grows the pool.
            </p>

            {routeDone ? (
              <div className="rounded-lg p-3 mb-4 bg-[var(--bg)] border border-[rgba(0,255,178,0.25)]">
                <p className="text-[12px] text-[var(--accent)] font-semibold mb-2">
                  Fee-share routed
                </p>
                <p className="text-[11px] text-[var(--text-muted)] mb-2">
                  {routeBps}% of future Bags fees will flow into this pool.
                  Bags will reflect the change after the next claim.
                </p>
                {routeSigs.length > 0 && (
                  <div className="space-y-1">
                    {routeSigs.map((s) => (
                      <a
                        key={s}
                        href={`https://solscan.io/tx/${s}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-[10px] font-mono text-[var(--accent)] hover:underline truncate"
                      >
                        {s}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                <label className="block text-[11px] text-[var(--text-muted)] uppercase tracking-wider mb-1">
                  Route to Tend (% of fee-share)
                </label>
                <input
                  type="number"
                  step="0.5"
                  min="0.01"
                  max="50"
                  value={routeBps}
                  disabled={routing}
                  onChange={(e) => {
                    setRouteBps(e.target.value);
                    setRouteError(null);
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] font-mono text-[14px] focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
                />
                <p className="text-[10px] text-[var(--text-muted)] mt-1">
                  Default 10%. Capped at 50%. Only the token&apos;s fee-share
                  admin can run this.
                </p>
                {routeError && (
                  <p className="text-[11px] text-[#ef4444] mt-2">{routeError}</p>
                )}
                {routeStep !== "idle" && (
                  <p className="text-[11px] text-[var(--text-muted)] mt-2">
                    {routeStep === "signing" && "Sign the authorization message…"}
                    {routeStep === "preparing" && "Asking agent to prepare the update…"}
                    {routeStep === "sending" && "Sign the on-chain update…"}
                    {routeStep === "confirming" && "Confirming on-chain…"}
                  </p>
                )}
              </>
            )}

            <div className="flex items-center gap-2 mt-4">
              <button
                onClick={() => setShowRouteModal(false)}
                disabled={routing}
                className="flex-1 py-2 rounded-lg text-[12px] border border-[var(--border)] hover:bg-[var(--bg)] disabled:opacity-50"
              >
                {routeDone ? "Close" : "Cancel"}
              </button>
              {!routeDone && (
                <button
                  onClick={handleRouteFees}
                  disabled={routing}
                  className="flex-1 py-2 rounded-lg text-[12px] bg-[var(--accent-dim)] text-[var(--accent)] hover:brightness-110 font-semibold disabled:opacity-50"
                >
                  {routing ? "Processing…" : "Enable"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Squads custody modal — owner-only, attaches a SpendingLimit */}
      {showProvisionModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => !provisioning && setShowProvisionModal(false)}
        >
          <div
            className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-6 max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-1">
              <Lock size={14} className="text-[var(--accent)]" />
              <h3 className="text-lg font-bold font-display">
                Secure your pool
              </h3>
            </div>
            <p className="text-[12px] text-[var(--text-muted)] mb-4 leading-relaxed">
              Moves your pool into an on-chain vault you own. Pick how much
              Tend can pay out per day — the agent can never exceed it. You
              keep the keys and can close the vault anytime.
            </p>

            {provisionDone ? (
              <div className="rounded-lg p-3 mb-4 bg-[var(--bg)] border border-[rgba(0,255,178,0.25)]">
                <p className="text-[12px] text-[var(--accent)] font-semibold mb-2">
                  Custody attached
                </p>
                <div className="space-y-1 text-[11px] font-mono text-[var(--text-secondary)]">
                  <div>
                    <span className="text-[var(--text-muted)]">Vault </span>
                    <a
                      href={`https://solscan.io/account/${provisionDone.vaultPda}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--accent)] hover:underline"
                    >
                      {provisionDone.vaultPda.slice(0, 10)}…
                    </a>
                  </div>
                  <div>
                    <span className="text-[var(--text-muted)]">Spend cap </span>
                    <a
                      href={`https://solscan.io/account/${provisionDone.spendingLimitPda}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--accent)] hover:underline"
                    >
                      {provisionDone.spendingLimitPda.slice(0, 10)}…
                    </a>
                  </div>
                </div>
                {provisionSigs.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {provisionSigs.map((s) => (
                      <a
                        key={s}
                        href={`https://solscan.io/tx/${s}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-[10px] font-mono text-[var(--text-muted)] hover:text-[var(--accent)] truncate"
                      >
                        tx {s}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                <label className="block text-[11px] text-[var(--text-muted)] uppercase tracking-wider mb-1">
                  Max Tend can pay out (SOL)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.001"
                  value={provisionAmountSol}
                  disabled={provisioning}
                  onChange={(e) => {
                    setProvisionAmountSol(e.target.value);
                    setProvisionError(null);
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] font-mono text-[14px] focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
                />
                <p className="text-[10px] text-[var(--text-muted)] mt-1">
                  Hard ceiling per period. The agent can&apos;t exceed it, even
                  if the pool has more SOL.
                </p>

                <label className="block text-[11px] text-[var(--text-muted)] uppercase tracking-wider mb-1 mt-3">
                  Per
                </label>
                <select
                  value={provisionPeriod}
                  disabled={provisioning}
                  onChange={(e) =>
                    setProvisionPeriod(e.target.value as SpendingPeriod)
                  }
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] font-mono text-[14px] focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
                >
                  <option value="oneTime">One-time (no reset)</option>
                  <option value="day">Daily</option>
                  <option value="week">Weekly</option>
                  <option value="month">Monthly</option>
                </select>

                <label className="block text-[11px] text-[var(--text-muted)] uppercase tracking-wider mb-1 mt-3">
                  Fund vault now (SOL, optional)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={provisionFundingSol}
                  disabled={provisioning}
                  onChange={(e) => {
                    setProvisionFundingSol(e.target.value);
                    setProvisionError(null);
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] font-mono text-[14px] focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
                />
                <p className="text-[10px] text-[var(--text-muted)] mt-1">
                  Sent from your wallet to the vault in the same tx. Leave 0
                  to fund later.
                </p>

                {provisionError && (
                  <p className="text-[11px] text-[#ef4444] mt-2">
                    {provisionError}
                  </p>
                )}
                {provisionStep !== "idle" && (
                  <p className="text-[11px] text-[var(--text-muted)] mt-2">
                    {provisionStep === "signing" && "Sign to authorize…"}
                    {provisionStep === "preparing" && "Preparing the vault…"}
                    {provisionStep === "sending" && "Approve in your wallet…"}
                    {provisionStep === "confirming" && "Confirming on-chain…"}
                    {provisionStep === "submitting" && "Finalizing…"}
                  </p>
                )}
              </>
            )}

            <div className="flex items-center gap-2 mt-4">
              <button
                onClick={() => setShowProvisionModal(false)}
                disabled={provisioning}
                className="flex-1 py-2 rounded-lg text-[12px] border border-[var(--border)] hover:bg-[var(--bg)] disabled:opacity-50"
              >
                {provisionDone ? "Close" : "Cancel"}
              </button>
              {!provisionDone && (
                <button
                  onClick={handleProvisionSquads}
                  disabled={provisioning}
                  className="flex-1 py-2 rounded-lg text-[12px] bg-[var(--accent-dim)] text-[var(--accent)] hover:brightness-110 font-semibold disabled:opacity-50"
                >
                  {provisioning ? "Processing…" : "Secure pool"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Topup modal — owner-only */}
      {showTopupModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => !mutating && setShowTopupModal(false)}
        >
          <div
            className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl p-6 max-w-sm w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold font-display mb-1">Top up pool</h3>
            <p className="text-[12px] text-[var(--text-muted)] mb-4">
              Sends SOL from your wallet to the agent and grows the pool cap.
              Verified on-chain before crediting.
            </p>
            <label className="block text-[11px] text-[var(--text-muted)] uppercase tracking-wider mb-1">
              Amount (SOL)
            </label>
            <input
              type="number"
              step="0.001"
              min="0.001"
              value={topupSol}
              disabled={mutating}
              onChange={(e) => setTopupSol(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] font-mono text-[14px] focus:outline-none focus:border-[var(--accent)] disabled:opacity-50"
            />
            {mutationError && (
              <p className="text-[11px] text-[#ef4444] mt-2">{mutationError}</p>
            )}
            {topupStep !== "idle" && (
              <p className="text-[11px] text-[var(--text-muted)] mt-2">
                {topupStep === "sending" && "Awaiting wallet signature for transfer…"}
                {topupStep === "confirming" && "Confirming transaction on-chain…"}
                {topupStep === "signing" && "Sign the authorization message…"}
                {topupStep === "submitting" && "Submitting to agent…"}
              </p>
            )}
            <div className="flex items-center gap-2 mt-4">
              <button
                onClick={() => setShowTopupModal(false)}
                disabled={mutating}
                className="flex-1 py-2 rounded-lg text-[12px] border border-[var(--border)] hover:bg-[var(--bg)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleTopup}
                disabled={mutating}
                className="flex-1 py-2 rounded-lg text-[12px] bg-[var(--accent-dim)] text-[var(--accent)] hover:brightness-110 font-semibold disabled:opacity-50"
              >
                {mutating ? "Processing…" : "Top up"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
