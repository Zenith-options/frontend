const { withSentryConfig } = require("@sentry/nextjs");

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081",
  },
};

module.exports = withSentryConfig(nextConfig, {
  // Sentry organisation + project (set in CI env / .env.local)
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Upload source maps in CI and suppress them from the public bundle.
  // Source maps are uploaded once during `next build` and then deleted
  // from the build artefacts before the image is pushed (see Dockerfile).
  silent: true,
  hideSourceMaps: true,

  // Disable the Sentry SDK size check warning — we load integrations
  // lazily, so the per-page overhead is minimal.
  disableLogger: true,

  // Tunnel Sentry requests through /api/sentry-tunnel to work around
  // ad-blockers that block sentry.io.
  tunnelRoute: "/api/sentry-tunnel",

  // Don't wrap every API route automatically — we instrument key spans
  // manually in src/lib/monitoring.ts.
  autoInstrumentServerFunctions: false,
  autoInstrumentMiddleware: false,
});
