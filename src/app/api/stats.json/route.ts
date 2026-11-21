/**
 * GET /api/stats.json
 *
 * Public JSON endpoint that proxies the indexer's /stats response.
 * Suitable for aggregators (DeFiLlama, etc.) and embeddable widgets.
 * Returns the MOCK_STATS fixture when the backend is unreachable so the
 * route is always available.
 */

import { NextResponse } from "next/server";
import { MOCK_STATS } from "../../../lib/api/stats";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";

// Cache policy (public, non-user data only):
// - Success: CDN caches for 60 s (s-maxage) and serves stale for up to 120 s while revalidating,
//   so embeds stay fresh within a minute while most hits never reach the origin.
// - Fallback (upstream down, mock data): not cached, so a CDN never pins mock data.
export async function GET() {
  try {
    const res = await fetch(`${API_BASE}/stats`, {
      next: { revalidate: 60 }, // ISR-style revalidation — refresh at most every 60 s
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const data = await res.json();
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
        // Allow aggregators to fetch this endpoint from any origin
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch {
    // Fallback to mock data — always returns 200 so aggregators don't break
    return NextResponse.json(MOCK_STATS, {
      headers: {
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "X-Data-Source": "mock",
      },
    });
  }
}
