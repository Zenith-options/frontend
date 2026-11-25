/**
 * GET /api/flags
 *
 * Proxies the remote flags config through Next.js so the client doesn't
 * need CORS access to the upstream URL, and benefits from Next.js ISR
 * caching (revalidate: 60 s).
 *
 * Returns the RemoteFlagConfig JSON, or an empty flags object if the
 * upstream is unreachable.
 */

import { NextResponse } from "next/server";
import { fetchRemoteConfig } from "../../../lib/flags/fetchRemoteConfig";

export const revalidate = 60;

export async function GET() {
  try {
    const config = await fetchRemoteConfig();

    // Always return a valid shape — empty flags = all flags use defaults
    const body = config ?? { flags: {} };

    return NextResponse.json(body, {
      headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" },
    });
  } catch (err) {
    // fetchRemoteConfig throws when the body is not valid JSON
    return NextResponse.json(
      { error: "upstream returned non-JSON body" },
      { status: 502 }
    );
  }
}
