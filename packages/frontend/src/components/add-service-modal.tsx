"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { ServiceIcon } from "./service-icons";

const SERVICES = [
  {
    id: "buyback-bot",
    name: "Buyback Bot",
    description: "Claims fees and buys back the token, creating buy pressure.",
    defaultBps: 1500,
    minBps: 500,
    maxBps: 4000,
    color: "#10b981",
  },
];

interface Props {
  tokenMint: string;
  existingServiceIds: string[];
  availableBps: number;
  onClose: () => void;
  onAdded: () => void;
}

type Step = "select" | "configure" | "signing" | "confirming";

export function AddServiceModal({
  tokenMint,
  existingServiceIds,
  availableBps,
  onClose,
  onAdded,
}: Props) {
  const { publicKey, signTransaction } = useWallet();
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [bps, setBps] = useState(1500);
  const [step, setStep] = useState<Step>("select");
  const [error, setError] = useState<string | null>(null);

  const service = SERVICES.find((s) => s.id === selectedService);

  const handleAdd = async () => {
    if (!selectedService || !publicKey || !signTransaction) return;

    setError(null);
    setStep("signing");

    try {
      // Step 1: Backend builds unsigned transactions
      const prepRes = await fetch("/api/services/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenMint,
          serviceId: selectedService,
          bps,
          payerWallet: publicKey.toBase58(),
        }),
      });

      const prepData = await prepRes.json();
      if (!prepRes.ok) throw new Error(prepData.error);
      if (!prepData.transactions?.length) throw new Error("No transactions returned");

      // Step 2: Sign each transaction with wallet
      const { VersionedTransaction } = await import("@solana/web3.js");
      const signedTransactions: string[] = [];
      for (const { transaction: txBase64 } of prepData.transactions) {
        const txBytes = Uint8Array.from(atob(txBase64), (c) => c.charCodeAt(0));
        const tx = VersionedTransaction.deserialize(txBytes);
        const signed = await signTransaction(tx);
        const serialized = signed.serialize();
        signedTransactions.push(btoa(String.fromCharCode(...serialized)));
      }

      setStep("confirming");

      // Step 3: Backend submits signed transactions on-chain
      const submitRes = await fetch("/api/services/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signedTransactions,
          tokenMint,
          serviceId: selectedService,
          bps,
          serviceWallet: prepData.serviceWallet,
          payerWallet: publicKey.toBase58(),
        }),
      });

      const submitData = await submitRes.json();
      if (!submitRes.ok) throw new Error(submitData.error);

      onAdded();
      onClose();
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
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl max-w-lg w-full max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-[var(--border)]">
          <h2 className="text-lg font-bold">Add Service</h2>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-white text-xl"
          >
            ×
          </button>
        </div>

        <div className="p-6">
          {step === "select" && !selectedService ? (
            <div className="space-y-3">
              <p className="text-xs text-[var(--text-muted)] mb-4">
                Available BPS: {availableBps} ({(availableBps / 100).toFixed(1)}
                %)
              </p>
              {SERVICES.map((s) => {
                const isExisting = existingServiceIds.includes(s.id);
                const tooExpensive = s.minBps > availableBps;
                const disabled = isExisting || tooExpensive;

                return (
                  <button
                    key={s.id}
                    onClick={() => {
                      if (!disabled) {
                        setSelectedService(s.id);
                        setBps(Math.min(s.defaultBps, availableBps));
                        setStep("configure");
                      }
                    }}
                    disabled={disabled}
                    className={`w-full text-left p-4 rounded-xl border transition-colors ${
                      disabled
                        ? "border-[var(--border)] opacity-40 cursor-not-allowed"
                        : "border-[var(--border)] hover:border-[var(--border-hover)] cursor-pointer"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: s.color + "1a", color: s.color }}
                      >
                        <ServiceIcon serviceId={s.id} size={18} />
                      </span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-sm">{s.name}</h3>
                          {isExisting && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent)]/20 text-[var(--accent)]">
                              ACTIVE
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5">
                          {s.description}
                        </p>
                        <p className="text-xs font-mono mt-1">
                          {s.defaultBps} BPS (
                          {(s.defaultBps / 100).toFixed(1)}%)
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : step === "signing" ? (
            <div className="text-center py-12">
              <div className="w-12 h-12 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="font-semibold">Sign in your wallet</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Approve the transaction in Phantom
              </p>
            </div>
          ) : step === "confirming" ? (
            <div className="text-center py-12">
              <div className="w-12 h-12 border-2 border-[var(--accent)] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="font-semibold">Confirming on-chain</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Waiting for Solana confirmation...
              </p>
            </div>
          ) : (
            /* BPS configuration */
            <div className="space-y-6">
              <button
                onClick={() => {
                  setSelectedService(null);
                  setStep("select");
                }}
                className="text-xs text-[var(--text-muted)] hover:text-white"
              >
                ← Back to services
              </button>

              <div className="flex items-center gap-3">
                <span
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ backgroundColor: service!.color + "1a", color: service!.color }}
                >
                  <ServiceIcon serviceId={service!.id} size={18} />
                </span>
                <div>
                  <h3 className="font-bold">{service!.name}</h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    {service!.description}
                  </p>
                </div>
              </div>

              <div>
                <label className="text-xs text-[var(--text-muted)] block mb-2">
                  Fee allocation (BPS)
                </label>
                <input
                  type="range"
                  min={service!.minBps}
                  max={Math.min(service!.maxBps, availableBps)}
                  step={100}
                  value={bps}
                  onChange={(e) => setBps(Number(e.target.value))}
                  className="w-full accent-[var(--accent)]"
                />
                <div className="flex justify-between text-xs mt-1">
                  <span className="text-[var(--text-muted)]">
                    {service!.minBps} BPS
                  </span>
                  <span className="font-mono font-bold text-[var(--accent)]">
                    {bps} BPS ({(bps / 100).toFixed(1)}%)
                  </span>
                  <span className="text-[var(--text-muted)]">
                    {Math.min(service!.maxBps, availableBps)} BPS
                  </span>
                </div>
              </div>

              {/* Preview */}
              <div className="card !bg-[var(--bg)] text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Service</span>
                  <span>{service!.name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">Allocation</span>
                  <span className="font-mono">
                    {bps} BPS ({(bps / 100).toFixed(1)}%)
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--text-muted)]">
                    Creator remaining
                  </span>
                  <span className="font-mono">
                    {availableBps - bps} BPS (
                    {((availableBps - bps) / 100).toFixed(1)}%)
                  </span>
                </div>
              </div>

              {error && (
                <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
                  {error}
                </div>
              )}

              {!publicKey ? (
                <p className="text-xs text-[var(--text-muted)] text-center">
                  Connect your wallet to add a service
                </p>
              ) : (
                <button
                  onClick={handleAdd}
                  disabled={step !== "configure"}
                  className="w-full py-3 rounded-xl font-semibold text-sm gradient-btn disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Sign & Add Service
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
