import type { Metadata } from "next";
import "./globals.css";
import { SolanaProvider } from "@/components/wallet-provider";
import { LayoutShell } from "@/components/layout-shell";

export const metadata: Metadata = {
  title: "Tend — Fee-sharing as a service",
  description:
    "Transform Bags.fm fee-sharing into a payment rail for autonomous AI services. Plug-and-play buyback bots, analytics, and growth agents for your token.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="anonymous" />
        <link
          href="https://api.fontshare.com/v2/css?f[]=clash-display@400,500,600,700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://api.fontshare.com/v2/css?f[]=satoshi@300,400,500,700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen antialiased">
        <SolanaProvider>
          <LayoutShell>{children}</LayoutShell>
        </SolanaProvider>
      </body>
    </html>
  );
}
