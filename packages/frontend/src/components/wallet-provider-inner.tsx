"use client";

import { type ReactNode } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import "@solana/wallet-adapter-react-ui/styles.css";

const RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
  "https://api.mainnet-beta.solana.com";

export function WalletProviderInner({ children }: { children: ReactNode }) {
  // Phantom, Solflare and Backpack auto-register via the Wallet Standard
  // protocol — passing explicit adapters would double-register them and
  // make autoConnect non-deterministic on page refresh.
  return (
    <ConnectionProvider endpoint={RPC_URL}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
