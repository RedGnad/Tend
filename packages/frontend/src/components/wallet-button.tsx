"use client";

import { useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";

export function WalletButton() {
  const { publicKey, connected, connecting, disconnect, connect, wallet } =
    useWallet();
  const { setVisible } = useWalletModal();
  const prevWallet = useRef(wallet);

  // When a wallet is selected from the modal, trigger connect
  useEffect(() => {
    if (wallet && wallet !== prevWallet.current && !connected && !connecting) {
      connect().catch(() => {
        // User rejected or wallet error — silent, they can retry
      });
    }
    prevWallet.current = wallet;
  }, [wallet, connected, connecting, connect]);

  if (connected && publicKey) {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]">
          {wallet?.adapter.icon && (
            <img
              src={wallet.adapter.icon}
              alt=""
              className="w-4 h-4 rounded"
            />
          )}
          <span className="text-sm font-mono flex-1 truncate">
            {publicKey.toBase58().slice(0, 4)}...
            {publicKey.toBase58().slice(-4)}
          </span>
          <div className="w-2 h-2 rounded-full bg-[var(--accent)]" />
        </div>
        <button
          onClick={() => disconnect()}
          className="w-full text-xs text-[var(--text-muted)] hover:text-red-400 transition-colors py-1"
        >
          Disconnect
        </button>
      </div>
    );
  }

  if (connecting) {
    return (
      <button
        disabled
        className="w-full py-2.5 px-4 rounded-lg text-sm font-medium bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)]"
      >
        Connecting...
      </button>
    );
  }

  return (
    <button
      onClick={() => setVisible(true)}
      className="w-full gradient-btn py-2.5 px-4 rounded-lg text-sm font-medium"
    >
      Connect Wallet
    </button>
  );
}
