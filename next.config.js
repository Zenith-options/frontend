/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",

  // Expose a small set of build-time defaults that can be overridden at
  // runtime via /api/runtime-config.  Any NEXT_PUBLIC_* var baked in here
  // is just a fallback; the client SDK always fetches the live values first.
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081",
  },
};

module.exports = nextConfig;
