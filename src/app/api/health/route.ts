import { NextResponse } from "next/server";
import { env } from "../../../env";

export const dynamic = "force-dynamic";

/** Upper bound so a hung backend cannot hang the health route itself. */
const BACKEND_TIMEOUT_MS = 3_000;

type DependencyStatus = "ok" | "down";

async function checkBackend(): Promise<DependencyStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
  try {
    const res = await fetch(`${env.NEXT_PUBLIC_API_URL}/health`, {
      cache: "no-store",
      signal: controller.signal,
    });
    return res.ok ? "ok" : "down";
  } catch {
    return "down";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET /api/health
 *
 * Used by Docker HEALTHCHECK and load balancers. Returns 200 when the backend
 * responds, otherwise 503 naming the failing dependency.
 */
export async function GET() {
  const backend = await checkBackend();
  const healthy = backend === "ok";
  return NextResponse.json(
    { status: healthy ? "ok" : "down", dependencies: { backend } },
    { status: healthy ? 200 : 503 },
  );
}
