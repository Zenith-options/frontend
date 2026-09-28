/** @type {import('next').NextConfig} */
const nextConfig = {
  // Next.js 15: fetch is no longer cached by default (changed from force-cache
  // to no-store). The app uses the client-side fetch wrapper in
  // src/lib/api/client.ts which always runs in the browser, so this doesn't
  // affect existing behaviour — but new server components should opt-in to
  // caching explicitly rather than relying on defaults.
  //
  // Reference: https://nextjs.org/docs/app/building-your-application/caching

  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081",
  },
};

module.exports = nextConfig;
