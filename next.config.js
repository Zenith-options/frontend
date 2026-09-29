/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Lint and type-checking run as dedicated CI jobs (lint + typecheck in
  // ci.yml) so we disable them during `next build` to avoid double-running
  // them — and to prevent ESLint from blocking the build artifact from being
  // produced when lint errors exist (the lint job is the gate, not the build).
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

module.exports = nextConfig;
