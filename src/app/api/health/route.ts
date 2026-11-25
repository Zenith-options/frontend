import { NextResponse } from "next/server";
import { env } from "../../../env";

/**
 * GET /api/health
 *
 * Health-check endpoint used by Docker HEALTHCHECK and load balancers.
 * Performs a lightweight probe of the backend and returns 503 if unreachable.
 * Times out after 800ms to keep the endpoint fast.
 */
export async function GET() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 800);

    const res = await fetch(`${env.NEXT_PUBLIC_API_URL}/api/v1/vaults`, {
      method: "HEAD",
      signal: controller.signal,
      credentials: "same-origin",
    });

    clearTimeout(timeoutId);

    // Backend is reachable
    return NextResponse.json({ status: "ok" }, { status: 200 });
  } catch {
    // Backend unreachable, timeout, or other network error
    return NextResponse.json(
      { status: "degraded", backend: "unreachable" },
      { status: 503 }
    );
  }
}
