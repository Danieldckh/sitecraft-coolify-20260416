import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  experimental: { serverActions: { bodySizeLimit: '10mb' } },
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] },
};

export default config;
