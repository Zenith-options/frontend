/**
 * Root middleware.
 *
 * #117: for each request, generates a CSP nonce, builds the policy from
 * validated config, and sets the security headers. The nonce and policy
 * are also forwarded as *request* headers. Next.js reads the nonce from the
 * incoming `Content-Security-Policy` (or `-Report-Only`) header and adds it
 * to its own inline and framework scripts. `x-nonce` exposes it to the
 * layout.
 */

import { NextResponse, type NextRequest } from "next/server";
import { generateNonce } from "./lib/security/csp";
import { applySecurity } from "./lib/security/middleware";

export function middleware(request: NextRequest) {
  const nonce = generateNonce();
  return applySecurity(request, NextResponse.next(), nonce);
}

export const config = {
  matcher: [
    // Every document and API route. Hashed static assets and images are
    // skipped: they're immutable, cacheable, and carry no scripts.
    // Prefetches are skipped too, so their nonce never mismatches the page.
    {
      source: "/((?!_next/static|_next/image|favicon.ico|icon.svg|icon-maskable.svg|manifest.webmanifest|sw.js).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
