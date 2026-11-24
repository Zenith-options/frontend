import { NextResponse } from "next/server";

// Read process.env at request time, not at build time (see docs/self-hosting.md).
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

function envConfig() {
  return {
    apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081",
    rpcUrl: process.env.NEXT_PUBLIC_RPC_URL ?? "https://soroban-testnet.stellar.org",
    network: process.env.NEXT_PUBLIC_NETWORK ?? "testnet",
    contractId: process.env.NEXT_PUBLIC_CONTRACT_ID ?? "",
  };
}

/** A structured 502. The upstream body is never sent to the client; it is only logged server-side. */
function badGateway(error: string, upstreamStatus?: number) {
  return NextResponse.json({ error, upstreamStatus }, { status: 502, headers: NO_STORE });
}

/**
 * Runtime configuration for the client (see `src/lib/runtimeConfig.ts`).
 *
 * By default this is just the `NEXT_PUBLIC_*` environment of the running
 * container. When `RUNTIME_CONFIG_UPSTREAM_URL` is set, the values are fetched
 * from that URL and layered over the environment; the upstream must answer
 * with JSON. An HTML error page from a proxy (or any other non-JSON body)
 * becomes a clear 502 `upstream_invalid_response` carrying the upstream status
 * code, instead of an opaque `SyntaxError` in the logs.
 */
export async function GET() {
  const upstream = process.env.RUNTIME_CONFIG_UPSTREAM_URL;
  if (!upstream) return NextResponse.json(envConfig(), { headers: NO_STORE });

  let response: Response;
  try {
    response = await fetch(upstream, { headers: { accept: "application/json" }, cache: "no-store" });
  } catch (err) {
    console.error("[runtime-config] upstream request failed:", err);
    return badGateway("upstream_unreachable");
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!/\bjson\b/i.test(contentType)) {
    const text = await response.text().catch(() => "");
    console.error("[runtime-config] upstream returned a non-JSON body", {
      status: response.status,
      contentType,
      body: text.slice(0, 500),
    });
    return badGateway("upstream_invalid_response", response.status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    console.error("[runtime-config] upstream JSON could not be parsed:", err);
    return badGateway("upstream_invalid_response", response.status);
  }

  if (!response.ok || typeof body !== "object" || body === null || Array.isArray(body)) {
    console.error("[runtime-config] upstream returned an unusable response", { status: response.status });
    return badGateway("upstream_error", response.status);
  }

  return NextResponse.json({ ...envConfig(), ...(body as Record<string, unknown>) }, { headers: NO_STORE });
}
