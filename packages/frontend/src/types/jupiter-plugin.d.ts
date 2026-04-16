declare global {
  interface Window {
    Jupiter?: {
      init: (props: {
        displayMode?: "modal" | "integrated" | "widget";
        integratedTargetId?: string;
        enableWalletPassthrough?: boolean;
        passthroughWalletContextState?: unknown;
        formProps?: {
          initialInputMint?: string;
          initialOutputMint?: string;
          initialAmount?: string;
          fixedMint?: string;
          fixedAmount?: boolean;
          swapMode?: "ExactIn" | "ExactOut" | "ExactInOrOut";
        };
        containerStyles?: React.CSSProperties;
        containerClassName?: string;
        onSuccess?: (txid: string, swapResult: unknown, quoteResponseMeta: unknown) => void;
        onSwapError?: (error: unknown, quoteResponseMeta: unknown) => void;
      }) => void;
      syncProps: (props: { passthroughWalletContextState: unknown }) => void;
      close: () => void;
      resume: () => void;
    };
  }
}

export {};
