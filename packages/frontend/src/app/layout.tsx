import type { Metadata } from "next";
import localFont from "next/font/local";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SolanaProvider } from "@/components/wallet-provider";
import { LayoutShell } from "@/components/layout-shell";

const clashDisplay = localFont({
  src: [
    { path: "../../public/fonts/clash-display-400.woff2", weight: "400" },
    { path: "../../public/fonts/clash-display-500.woff2", weight: "500" },
    { path: "../../public/fonts/clash-display-600.woff2", weight: "600" },
    { path: "../../public/fonts/clash-display-700.woff2", weight: "700" },
  ],
  variable: "--font-clash",
  display: "swap",
});

const satoshi = localFont({
  src: [
    { path: "../../public/fonts/satoshi-300.woff2", weight: "300" },
    { path: "../../public/fonts/satoshi-400.woff2", weight: "400" },
    { path: "../../public/fonts/satoshi-500.woff2", weight: "500" },
    { path: "../../public/fonts/satoshi-700.woff2", weight: "700" },
  ],
  variable: "--font-satoshi",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Tend — Earn SOL from live Bags token campaigns",
  description:
    "Trade Bags tokens and earn real SOL cashback from live campaigns powered by creator fees. Every payout logged on-chain.",
  openGraph: {
    title: "Tend — Earn SOL from live Bags token campaigns",
    description:
      "Trade participating Bags tokens, get SOL cashback from live campaigns financed by creator fees. Fully on-chain.",
    type: "website",
    siteName: "Tend",
  },
  twitter: {
    card: "summary_large_image",
    title: "Tend — Earn SOL from live Bags token campaigns",
    description:
      "Trade Bags tokens, earn real SOL cashback from creator-funded campaigns.",
  },
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`dark ${clashDisplay.variable} ${satoshi.variable} ${jetbrainsMono.variable}`}
    >
      <body className="min-h-screen antialiased">
        <SolanaProvider>
          <LayoutShell>{children}</LayoutShell>
        </SolanaProvider>
      </body>
    </html>
  );
}
