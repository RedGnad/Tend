"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Bot, Gift, Landmark, X } from "lucide-react";
import type { ComponentType } from "react";
import type { LucideProps } from "lucide-react";

interface Mode {
  id: string;
  serviceId: string;
  name: string;
  desc: string;
  Icon: ComponentType<LucideProps>;
  color: string;
  defaultBps: number;
  minBps: number;
  maxBps: number;
  available: boolean;
}

const MODES: Mode[] = [
  {
    id: "buyback",
    serviceId: "buyback-bot",
    name: "Buyback",
    desc: "Auto-buy your token with claimed fees. Creates sustained buy pressure.",
    Icon: Bot,
    color: "#10b981",
    defaultBps: 1500,
    minBps: 500,
    maxBps: 4000,
    available: true,
  },
  {
    id: "rewards",
    serviceId: "rewards",
    name: "Rewards",
    desc: "Distribute a share of fees to top holders as loyalty rewards.",
    Icon: Gift,
    color: "#8b5cf6",
    defaultBps: 1000,
    minBps: 300,
    maxBps: 3000,
    available: false,
  },
  {
    id: "treasury",
    serviceId: "treasury",
    name: "Treasury",
    desc: "Accumulate fees in a managed wallet for strategic use.",
    Icon: Landmark,
    color: "#f59e0b",
    defaultBps: 1000,
    minBps: 300,
    maxBps: 3000,
    available: false,
  },
];

interface Props {
  tokenMint: string;
  existingServiceIds: string[];
  availableBps: number;
  onClose: () => void;
  onActivated: () => void;
}

type Step = "choose" | "configure" | "signing" | "confirming";

export function ActivateModal({
  tokenMint,
  existingServiceIds,
  availableBps,
  onClose,
  onActivated,
}: Props) {
  const { publicKey, signTransaction } = useWallet();
  const [selectedMode, setSelectedMode] = useState<Mode | null>(null);
  const [bps, setBps] = useState(1500);
  const [step, setStep] = useState<Step>("choose");
  const [error, setError] = useState<string | null>(null);

  const handleActivate = async () => {
    if (!selectedMode || !publicKey || !signTransaction) return;

    setError(null);
    setStep("signing");

    try {
      const prepRes = await fetch("/api/services/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenMint,
          serviceId: selectedMode.serviceId,
          bps,
          payerWallet: publicKey.toBase58(),
        }),
      });

      const prepData = await prepRes.json();
      if (!prepRes.ok) throw new Error(prepData.error);
      if (!prepData.transactions?.length)
        throw new Error("No transactions returned");

      const { VersionedTransaction } = await import("@solana/web3.js");
      const signedTransactions: string[] = [];
      for (const { transaction: txBase64 } of prepData.transactions) {
        const txBytes = Uint8Array.from(atob(txBase64), (c) =>
          c.charCodeAt(0)
        );
        const tx = VersionedTransaction.deserialize(txBytes);
        const signed = await signTransaction(tx);
        const serialized = signed.serialize();
        signedTransactions.push(btoa(String.fromCharCode(...serialized)));
      }

      setStep("confirming");

      const submitRes = await fetch("/api/services/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signedTransactions,
          tokenMint,
          serviceId: selectedMode.serviceId,
          bps,
          serviceWallet: prepData.serviceWallet,
          payerWallet: publicKey.toBase58(),
        }),
      });

      const submitData = await submitRes.json();
      if (!submitRes.ok) throw new Error(submitData.error);

      onActivated();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Transaction failed";
      if (msg.includes("User rejected")) {
        setStep("configure");
      } else {
        setError(msg);
        setStep("configure");
      }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl max-w-md w-full">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <h2 className="text-lg font-bold font-display">
            {step === "choose"
              ? "Activate Tend"
              : step === "signing"
                ? "Sign Transaction"
                : step === "confirming"
                  ? "Confirming..."
                  : selectedMode?.name ?? "Configure"}
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6">
          {/* Step 1: Choose mode */}
          {step === "choose" && (
            <div className="space-y-3">
              <p className="text-[13px] text-[var(--text-muted)] mb-4">
                Choose how Tend uses your trading fees.
              </p>

              {MODES.map((mode) => {
                const isExisting = existingServiceIds.includes(
                  mode.serviceId
                );
                const disabled = !mode.available || isExisting;

                return (
                  <button
                    key={mode.id}
                    onClick={() => {
                      if (!disabled) {
                        setSelectedMode(mode);
                        setBps(Math.min(mode.defaultBps, availableBps));
                        setStep("configure");
                      }
                    }}
                    disabled={disabled}
                    className={`w-full text-left p-4 rounded-xl border transition-all ${
                      disabled
                        ? "border-[var(--border)] opacity-40 cursor-not-allowed"
                        : "border-[var(--border)] hover:border-[var(--border-hover)] cursor-pointer hover:bg-[var(--bg-card-hover)]"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{
                          backgroundColor: mode.color + "18",
                          color: mode.color,
                        }}
                      >
                        <mode.Icon size={18} />
                      </span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-sm">
                            {mode.name}
                          </h3>
                          {isExisting && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--accent-dim)] text-[var(--accent)] font-semibold">
                              ACTIVE
                            </span>
                          )}
                          {!mode.available && !isExisting && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-[rgba(255,255,255,0.04)] text-[var(--text-muted)] font-semibold border border-[var(--border)]">
                              SOON
                            </span>
                          )}
                        </div>
                        <p className="text-[12px] text-[var(--text-muted)] mt-0.5">
                          {mode.desc}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Step 2: Configure BPS */}
          {step === "configure" && selectedMode && (
            <div className="space-y-5">
              <button
                onClick={() => {
                  setSelectedMode(null);
                  setStep("choose");
                  setError(null);
                }}
                className="text-xs text-[var(--text-muted)] hover:text-white transition-colors"
              >
                ← Back
              </button>

              <div className="flex items-center gap-3">
                <span
                  className="w-10 h-10 rounded-xl flex items-center justify-center"
                  style={{
                    backgroundColor: selectedMode.color + "18",
                    color: selectedMode.color,
                  }}
                >
                  <selectedMode.Icon size={18} />
                </span>
                <div>
                  <h3 className="font-semibold">{selectedMode.name}</h3>
                  <p className="text-[12px] text-[var(--text-muted)]">
                    {selectedMode.desc}
                  </p>
                </div>
              </div>

              <div>
                <label className="text-xs text-[var(--text-muted)] block mb-2.5">
                  Fee allocation
                </label>

                <div className="flex gap-2 mb-3">
                  {[5, 10, 15, 20].map((pct) => {
                    const val = pct * 100;
                    const isSelected = bps === val;
                    const disabled = val > availableBps;
                    return (
                      <button
                        key={pct}
                        onClick={() => !disabled && setBps(val)}
                        disabled={disabled}
                        className={`flex-1 py-2 rounded-lg text-sm font-mono font-semibold transition-colors ${
                          isSelected
                            ? "bg-[var(--accent)] text-[#060606]"
                            : disabled
                              ? "bg-[var(--bg)] text-[var(--text-muted)] opacity-30 cursor-not-allowed"
                              : "bg-[var(--bg)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
                        }`}
                      >
                        {pct}%
                      </button>
                    );
                  })}
                </div>

                <input
                  type="range"
                  min={selectedMode.minBps}
                  max={Math.min(selectedMode.maxBps, availableBps)}
                  step={100}
                  value={bps}
                  onChange={(e) => setBps(Number(e.target.value))}
                  className="w-full accent-[var(--accent)]"
                />
                <div className="flex justify-between text-[11px] mt-1 text-[var(--text-muted)]">
                  <span>{(selectedMode.minBps / 100).toFixed(0)}%</span>
                  <span className="font-mono font-semibold text-[var(--accent)]">
                    {(bps / 100).toFixed(0)}% of trading fees
                  </span>
                  <span>
                    {(
                      Math.min(selectedMode.maxBps, availableBps) / 100
                    ).toFixed(0)}
                    %
                  </span>
                </div>
              </div>

              <div className="bg-[var(--bg)] rounded-xl p-3 text-[12px] space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Mode</span>
                  <span>{selectedMode.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Allocation</span>
                  <span className="font-mono font-semibold">
                    {(bps / 100).toFixed(0)}%
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">You keep</span>
                  <span className="font-mono">
                    {((availableBps - bps) / 100).toFixed(0)}%
                  </span>
                </div>
                <div className="flex justify-between text-[var(--text-muted)]">
                  <span>Revocable</span>
                  <span>Anytime</span>
                </div>
              </div>

              {error && (
                <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
                  {error}
                </div>
              )}

              <button
                onClick={handleActivate}
                className="w-full py-3 rounded-xl font-semibold text-sm gradient-btn"
              >
                Activate {selectedMode.name}
              </button>
            </div>
          )}

          {/* Signing */}
          {step === "signing" && (
            <div className="text-center py-10">
              <div className="w-12 h-12 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="font-semibold">Sign in your wallet</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Approve the transaction to configure fee-sharing
              </p>
            </div>
          )}

          {/* Confirming */}
          {step === "confirming" && (
            <div className="text-center py-10">
              <div className="w-12 h-12 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="font-semibold">Confirming on-chain</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Waiting for Solana confirmation...
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
