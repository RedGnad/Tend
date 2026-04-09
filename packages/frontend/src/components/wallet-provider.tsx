"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

// Load wallet providers client-side only (they access window/document).
// Root layout doesn't remount on navigation, so this is stable.
const WalletProviderInner = dynamic(
  () => import("./wallet-provider-inner").then((m) => m.WalletProviderInner),
  { ssr: false }
);

export function SolanaProvider({ children }: { children: ReactNode }) {
  return <WalletProviderInner>{children}</WalletProviderInner>;
}
