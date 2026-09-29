import { NextResponse } from "next/server";

/**
 * AcceptSentry event payloads and immediately acknowledge them while keeping the
 * tunnel endpoint available for browser-side reporting. This avoids depending on
 * the SDK-specific tunnel export path, which varies by package version.
 */
export async function GET() {
  return new NextResponse("ok", { status: 200, headers: { "Content-Type": "text/plain" } });
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    await request.json().catch(() => undefined);
  } else {
    await request.text().catch(() => undefined);
  }

  return new NextResponse(null, { status: 204 });
}
