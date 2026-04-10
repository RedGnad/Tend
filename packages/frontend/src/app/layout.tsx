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
  title: "Tend — Fee-sharing as a service",
  description:
    "Transform Bags.fm fee-sharing into a payment rail for autonomous AI services. Plug-and-play buyback bots, analytics, and growth agents for your token.",
  openGraph: {
    title: "Tend — Fee-sharing as a service",
    description:
      "Autonomous AI services paid through on-chain fee-sharing. No subscriptions, no upfront cost.",
    type: "website",
    siteName: "Tend",
  },
  twitter: {
    card: "summary_large_image",
    title: "Tend — Fee-sharing as a service",
    description:
      "Autonomous AI services paid through on-chain fee-sharing on Bags.fm.",
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
