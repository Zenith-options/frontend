/**
 * Root middleware.
 *
 * #116: next-intl locale routing for pages. It detects the locale from the
 * NEXT_LOCALE cookie, then Accept-Language, and redirects or rewrites to the
 * `[locale]` segment. It also emits hreflang `Link` headers. API routes skip it.
 *
 * #117: for each request, generates a CSP nonce, builds the policy from
 * validated config, and sets the security headers. The nonce and policy
 * are also forwarded as *request* headers. Next.js reads the nonce from the
 * incoming `Content-Security-Policy` (or `-Report-Only`) header and adds it
 * to its own inline and framework scripts. `x-nonce` exposes it to the
 * layout. The forwarding merges with next-intl's own request-header
 * overrides.
 */

import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing, locales } from "./i18n/routing";
import { generateNonce } from "./lib/security/csp";
import { applySecurity } from "./lib/security/middleware";

const intl = createIntlMiddleware(routing);

export function middleware(request: NextRequest) {
  const nonce = generateNonce();
  const isApi = request.nextUrl.pathname.startsWith("/api/");

  // If the first path segment looks like a locale but is not in the supported
  // set, return a 404 instead of silently rewriting to the default locale.
  // This prevents a typo in a shared link (e.g. /xx/options) from rendering
  // the English page under a wrong URL.
  if (!isApi) {
    const firstSegment = request.nextUrl.pathname.split("/")[1];
    const looksLikeLocale = /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(firstSegment ?? "");
    const isKnownLocale = (locales as readonly string[]).includes(firstSegment ?? "");
    if (looksLikeLocale && !isKnownLocale) {
      return applySecurity(request, new NextResponse(null, { status: 404 }), nonce);
    }
  }

  const response = isApi ? NextResponse.next() : intl(request);
  return applySecurity(request, response, nonce);
}

export const config = {
  matcher: [
    // Every document and API route. Hashed static assets and images are
    // skipped: they're immutable, cacheable, and carry no scripts.
    // Prefetches are skipped too, so their nonce never mismatches the page.
    {
      source: "/((?!_next/static|_next/image|favicon.ico|icon|icon.svg|icon-maskable.svg|manifest.webmanifest|sw.js).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
