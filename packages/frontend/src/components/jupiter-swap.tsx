"use client";

import { useEffect, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

const SOL_MINT = "So11111111111111111111111111111111111111112";

export function JupiterSwap({ outputMint }: { outputMint: string }) {
  const walletState = useWallet();
  const initialized = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || !window.Jupiter || initialized.current)
      return;

    initialized.current = true;
    window.Jupiter.init({
      displayMode: "integrated",
      integratedTargetId: "jupiter-terminal",
      enableWalletPassthrough: true,
      passthroughWalletContextState: walletState,
      formProps: {
        initialInputMint: SOL_MINT,
        initialOutputMint: outputMint,
        fixedMint: outputMint,
      },
    });
  }, [outputMint, walletState]);

  // Sync wallet state changes
  useEffect(() => {
    if (typeof window === "undefined" || !window.Jupiter?.syncProps) return;
    window.Jupiter.syncProps({
      passthroughWalletContextState: walletState,
    });
  }, [walletState.connected, walletState.publicKey]);

  return (
    <div
      id="jupiter-terminal"
      className="rounded-xl overflow-hidden"
    />
  );
}
