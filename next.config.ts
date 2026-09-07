import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The worker/queue packages are server-only and must never be bundled for the browser.
  serverExternalPackages: ['bullmq', 'ioredis'],
  typescript: { ignoreBuildErrors: false },
};

export default nextConfig;
