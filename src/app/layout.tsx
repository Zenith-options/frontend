import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zenith | On-chain Options on Stellar",
  description:
    "Buy and write European put and call options on XLM, BTC, ETH, and SOL. The first decentralized options protocol on Stellar Soroban.",
  keywords: ["options", "calls", "puts", "derivatives", "stellar", "soroban", "defi", "black-scholes"],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
