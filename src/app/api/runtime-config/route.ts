// Runtime configuration endpoint. Returns the small set of NEXT_PUBLIC_* vars
// that must be overridable at container start time without a rebuild.
// See docs/self-hosting.md for the full list and usage pattern.
//
// When RUNTIME_CONFIG_URL is set the values come from that upstream source
// (e.g. a secrets manager sidecar or a configuration service).  On fetch
// failure the route returns 502 so the client can distinguish a missing config
// from a valid empty one.  Without the env var the values are read directly
// from process.env, which is always available server-side.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RUNTIME_CONFIG_URL = process.env.RUNTIME_CONFIG_URL ?? null;

export async function GET(): Promise<Response> {
  if (RUNTIME_CONFIG_URL) {
    let res: Response;
    try {
      res = await fetch(RUNTIME_CONFIG_URL, { cache: "no-store" });
    } catch (err) {
      console.error("[runtime-config] upstream fetch failed:", err);
      return Response.json(
        { error: "upstream_unavailable", message: "Could not reach the configuration backend" },
        { status: 502 }
      );
    }

    if (!res.ok) {
      console.error(`[runtime-config] upstream returned ${res.status}`);
      return Response.json(
        { error: "upstream_error", message: `Configuration backend returned ${res.status}` },
        { status: 502 }
      );
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch (err) {
      console.error("[runtime-config] upstream response was not valid JSON:", err);
      return Response.json(
        { error: "upstream_invalid", message: "Configuration backend returned non-JSON" },
        { status: 502 }
      );
    }

    return Response.json(data, {
      headers: { "cache-control": "no-store" },
    });
  }

  // No upstream — read directly from process.env.
  return Response.json(
    {
      apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081",
      rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "https://soroban-testnet.stellar.org",
      network: process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? process.env.NEXT_PUBLIC_NETWORK ?? "testnet",
      contractId: process.env.NEXT_PUBLIC_CONTRACT_ID ?? "",
    },
    { headers: { "cache-control": "no-store" } }
  );
}
