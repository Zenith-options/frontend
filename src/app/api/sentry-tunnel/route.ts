// Sentry envelope tunnel (#533).
//
// Ad-blockers that target sentry.io would silently drop all error reports if
// the SDK posted directly to Sentry's ingest. This endpoint receives the
// envelope from the browser SDK and forwards it to the correct Sentry project.
//
// Security:
//   - Only DSNs whose host ends with `.sentry.io` are allowed, so an attacker
//     cannot use this endpoint as an open proxy.
//   - The envelope body is never logged (it may contain PII / stack traces /
//     request data). Only the HTTP status and a correlation id are logged on
//     failure.
//
// Error handling:
//   - 502 is returned when the upstream ingest call fails or returns non-2xx,
//     so the Sentry SDK can retry the envelope.
//   - 200 is returned only when Sentry acknowledges the envelope.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ENVELOPE_BYTES = 1024 * 1024; // 1 MiB — Sentry's own ingest limit

/** Extract the DSN from the envelope header line (first line of the body). */
function dsnFromEnvelope(header: string): URL | null {
  try {
    const parsed = JSON.parse(header) as Record<string, unknown>;
    if (typeof parsed.dsn !== "string") return null;
    const url = new URL(parsed.dsn);
    // Only forward to Sentry-owned ingest hosts.
    if (!url.hostname.endsWith(".sentry.io")) return null;
    return url;
  } catch {
    return null;
  }
}

/** Build the Sentry envelope ingest URL from a parsed DSN. */
function ingestUrl(dsn: URL): string {
  const projectId = dsn.pathname.replace(/^\//, "");
  return `https://${dsn.hostname}/api/${projectId}/envelope/`;
}

export async function POST(req: Request): Promise<Response> {
  const correlationId = crypto.randomUUID();

  const contentLength = Number(req.headers.get("content-length") ?? 0);
  if (contentLength > MAX_ENVELOPE_BYTES) {
    return new Response("Envelope too large", { status: 413 });
  }

  let body: string;
  try {
    body = await req.text();
  } catch {
    return new Response("Failed to read envelope", { status: 400 });
  }

  if (body.length > MAX_ENVELOPE_BYTES) {
    return new Response("Envelope too large", { status: 413 });
  }

  // The envelope header is the first line; subsequent lines are item headers
  // and payloads. We only need the first line to extract the DSN.
  const headerLine = body.slice(0, body.indexOf("\n"));
  const dsn = dsnFromEnvelope(headerLine);
  if (!dsn) {
    return new Response("Invalid or disallowed DSN in envelope header", { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(ingestUrl(dsn), {
      method: "POST",
      // Forward the content-type so Sentry's ingest parses the envelope correctly.
      headers: { "content-type": req.headers.get("content-type") ?? "application/x-sentry-envelope" },
      body,
    });
  } catch (err) {
    // Network-level failure (DNS, TCP, timeout). Do not log `err` — it may
    // contain URL fragments with the DSN key. Log only the correlation id.
    console.error(`[sentry-tunnel] upstream unreachable correlationId=${correlationId}`);
    return new Response("Sentry ingest unreachable", { status: 502 });
  }

  if (!upstream.ok) {
    console.error(
      `[sentry-tunnel] upstream returned ${upstream.status} correlationId=${correlationId}`
    );
    return new Response("Sentry ingest error", { status: 502 });
  }

  return new Response(null, { status: 200 });
}
