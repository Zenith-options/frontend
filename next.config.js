// next-intl (#116): points the plugin at the per-request i18n config.
const createNextIntlPlugin = require("next-intl/plugin");
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",

  // Don't advertise the framework.
  poweredByHeader: false,

  // Next.js 15: fetch is no longer cached by default (changed from force-cache
  // to no-store). The app uses the client-side fetch wrapper in
  // src/lib/api/client.ts which always runs in the browser, so this doesn't
  // affect existing behaviour — but new server components should opt-in to
  // caching explicitly rather than relying on defaults.
  //
  // Reference: https://nextjs.org/docs/app/building-your-application/caching

  // Expose a small set of build-time defaults that can be overridden at
  // runtime via /api/runtime-config.  Any NEXT_PUBLIC_* var baked in here
  // is just a fallback; the client SDK always fetches the live values first.
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081",
  },

  // Tell webpack/Next to tree-shake named exports instead of pulling in
  // the whole package barrel for these dependencies.
  experimental: {
    optimizePackageImports: ["@stellar/freighter-api"],
  },

  // CSP and the per-request security headers are set in src/middleware.ts
  // (#117). Hashed static assets skip the middleware, so they get the
  // static subset here.
  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
        ],
      },
    ];
  },

  webpack: (config, { isServer }) => {
    // @stellar/stellar-sdk pulls in sodium-native (a Node.js native addon)
    // for Ed25519 signing in server environments. It's not needed in the
    // browser — the SDK falls back to WebCrypto/TweetNaCl automatically.
    if (isServer) {
      config.externals = [...(config.externals ?? []), "sodium-native"];
    } else {
      config.resolve = config.resolve ?? {};
      config.resolve.fallback = {
        ...(config.resolve.fallback ?? {}),
        "sodium-native": false,
      };
    }
    return config;
  },
};

// Sentry is optional: wrap only when the SDK is installed.
let exported = withNextIntl(nextConfig);
try {
  const { withSentryConfig } = require("@sentry/nextjs");
  exported = withSentryConfig(exported, {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    silent: true,
    hideSourceMaps: true,
    disableLogger: true,
    // Same-origin tunnel keeps Sentry inside connect-src 'self'.
    tunnelRoute: "/api/sentry-tunnel",
    autoInstrumentServerFunctions: false,
    autoInstrumentMiddleware: false,
  });
} catch {
  // @sentry/nextjs not installed.
}

module.exports = exported;
