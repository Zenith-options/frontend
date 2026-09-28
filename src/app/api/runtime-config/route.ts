import { NextResponse } from "next/server";
import { parseEnv } from "../../../env-schema.cjs";
import { stellarNetworkConfig } from "../../../env";

export const dynamic = "force-dynamic";

export async function GET() {
  const parsed = parseEnv(process.env);
  const network = parsed.NEXT_PUBLIC_STELLAR_NETWORK ?? "testnet";
  const contractId = network === "mainnet"
    ? parsed.NEXT_PUBLIC_STELLAR_MAINNET_CONTRACT_ID
    : parsed.NEXT_PUBLIC_STELLAR_TESTNET_CONTRACT_ID;

  return NextResponse.json({
    apiUrl: parsed.NEXT_PUBLIC_API_URL ?? "http://localhost:8081",
    network,
    rpcUrl: stellarNetworkConfig[network].rpcUrl,
    passphrase: stellarNetworkConfig[network].passphrase,
    contractId: contractId ?? null,
  }, { headers: { "Cache-Control": "no-store" } });
}