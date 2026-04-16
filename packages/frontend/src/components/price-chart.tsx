"use client";

export function PriceChart({ mint }: { mint: string }) {
  return (
    <iframe
      src={`https://birdeye.so/tv-widget/${mint}?chain=solana&viewMode=pair&chartInterval=15&chartType=CANDLE&chartTimezone=Europe%2FParis&colorTheme=dark`}
      className="w-full rounded-xl"
      style={{ height: 320 }}
      frameBorder="0"
      allowFullScreen
    />
  );
}
