"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useEffect, useState } from "react";

export function WalletButton() {
  const { publicKey, connected, connect, disconnect, select, wallets } =
    useWallet();
  const [showDropdown, setShowDropdown] = useState(false);

  const handleConnect = useCallback(async () => {
    if (connected) {
      await disconnect();
      return;
    }

    // Auto-select first available wallet or show dropdown
    const installed = wallets.filter(
      (w) => w.readyState === "Installed"
    );

    if (installed.length === 1) {
      select(installed[0].adapter.name);
      await connect();
    } else if (installed.length > 1) {
      setShowDropdown(true);
    } else {
      // Try standard connect (triggers browser wallet)
      try {
        select(wallets[0]?.adapter.name);
        await connect();
      } catch {
        // No wallet available
      }
    }
  }, [connected, connect, disconnect, select, wallets]);

  const handleSelectWallet = useCallback(
    async (walletName: string) => {
      const wallet = wallets.find((w) => w.adapter.name === walletName);
      if (wallet) {
        select(wallet.adapter.name);
        setShowDropdown(false);
        await connect();
      }
    },
    [wallets, select, connect]
  );

  return (
    <div className="relative">
      <button
        onClick={handleConnect}
        className={`w-full py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${
          connected
            ? "bg-[var(--bg-card)] border border-[var(--border)] text-white hover:border-[var(--border-hover)]"
            : "gradient-btn"
        }`}
      >
        {connected && publicKey
          ? `${publicKey.toBase58().slice(0, 4)}...${publicKey.toBase58().slice(-4)}`
          : "Connect Wallet"}
      </button>

      {showDropdown && (
        <div className="absolute bottom-full left-0 right-0 mb-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg overflow-hidden z-50">
          {wallets
            .filter((w) => w.readyState === "Installed")
            .map((w) => (
              <button
                key={w.adapter.name}
                onClick={() => handleSelectWallet(w.adapter.name)}
                className="w-full px-4 py-2.5 text-left text-sm hover:bg-[var(--bg-card-hover)] flex items-center gap-2"
              >
                {w.adapter.icon && (
                  <img
                    src={w.adapter.icon}
                    alt=""
                    className="w-5 h-5 rounded"
                  />
                )}
                {w.adapter.name}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
