import type { Metadata } from "next";
import "./globals.css";
import { SolanaProvider } from "@/components/wallet-provider";
import { Sidebar } from "@/components/sidebar";

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
      <body className="min-h-screen antialiased">
        <SolanaProvider>
          <div className="flex min-h-screen">
            <Sidebar />
            <main className="flex-1 p-8 overflow-auto">{children}</main>
          </div>
        </SolanaProvider>
      </body>
    </html>
  );
}
