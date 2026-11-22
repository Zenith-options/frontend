import { NextResponse } from "next/server";

// Mirrors DEFAULT_CONFIG in src/lib/runtimeConfig.ts; keep the two in sync.
// No upstream fetch exists here, so there is nothing to time out.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081",
    rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "https://soroban-testnet.stellar.org",
    network: process.env.NEXT_PUBLIC_NETWORK ?? "testnet",
    contractId: process.env.NEXT_PUBLIC_CONTRACT_ID ?? "",
  });
}
