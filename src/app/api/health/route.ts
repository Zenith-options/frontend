import { NextResponse } from "next/server";

const BACKEND_HEALTH_URL =
  (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081") + "/api/health";

const TIMEOUT_MS = 2_000;

/**
 * GET /api/health
 *
 * Checks the backend health endpoint and reflects the result to the caller.
 * Returns 200 when the backend is reachable and healthy, 503 otherwise.
 * The response body always includes `backend_status` and, on failure,
 * `error`. Load balancers and Docker HEALTHCHECK use the HTTP status code.
 *
 * Contract: docs/on-call.md — the `/api/health` response is consumed by
 * on-call runbooks; keep the shape stable.
 */
export async function GET() {
  let backendStatus: string | null = null;
  let errorMessage: string | null = null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(BACKEND_HEALTH_URL, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
        // Bypass Next.js fetch cache — health checks must always be live.
        cache: "no-store",
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) {
      backendStatus = "ok";
      return NextResponse.json({ status: "ok", backend_status: backendStatus }, { status: 200 });
    }

    backendStatus = "error";
    errorMessage = `Backend responded with HTTP ${response.status}`;
  } catch (err: unknown) {
    backendStatus = "unreachable";
    if (err instanceof Error) {
      errorMessage = err.name === "AbortError"
        ? `Backend health check timed out after ${TIMEOUT_MS} ms`
        : err.message;
    } else {
      errorMessage = "Unknown error reaching backend";
    }
  }

  return NextResponse.json(
    { status: "error", backend_status: backendStatus, error: errorMessage },
    { status: 503 },
  );
}
