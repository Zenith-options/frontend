import { NextResponse } from "next/server";

/**
 * GET /api/runtime-config
 *
 * Serves environment variables that must be configurable at *container
 * start time* without rebuilding the image.  The client calls this once
 * on boot (see src/lib/runtimeConfig.ts) and caches the result for the
 * lifetime of the page.
 *
 * Values are read from process.env at request time, so Docker / K8s
 * secrets, `docker run -e`, or Compose env_file changes are reflected
 * immediately after a container restart.
 *
 * Cache-Control: the response is private and revalidated on every request
 * (no-cache) so a freshly started container with new env vars is picked up
 * by the next page load, while still allowing the browser to use a cached
 * copy within the same navigation session (no-store would prevent that).
 */

const BACKEND_URL = process.env.RUNTIME_CONFIG_BACKEND_URL;

export async function GET() {
  if (BACKEND_URL) {
    try {
      const res = await fetch(BACKEND_URL, { next: { revalidate: 0 } });
      if (!res.ok) {
        return NextResponse.json(
          { error: `Backend returned ${res.status}` },
          { status: 502 },
        );
      }
      const data = await res.json();
      return NextResponse.json(data, {
        headers: { "Cache-Control": "no-cache, private" },
      });
    } catch (err) {
      console.error("[runtime-config] backend fetch failed:", err);
      return NextResponse.json(
        { error: "Backend unreachable" },
        { status: 503 },
      );
    }
  }

  // No backend configured — serve values baked into the container env.
  const config = {
    apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081",
    rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "https://soroban-testnet.stellar.org",
    network: process.env.NEXT_PUBLIC_NETWORK ?? "testnet",
    contractId: process.env.NEXT_PUBLIC_CONTRACT_ID ?? "",
  };

  return NextResponse.json(config, {
    headers: { "Cache-Control": "no-cache, private" },
  });
}
