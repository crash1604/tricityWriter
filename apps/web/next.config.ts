import path from 'node:path';
import type { NextConfig } from 'next';

const api = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (see Dockerfile, target "web").
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  // In production Caddy routes these paths to apps/api directly; the rewrites cover local
  // development and direct access to the dashboard container. Session cookies stay first-party.
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${api}/api/:path*` },
      { source: '/mcp', destination: `${api}/mcp` },
      {
        source: '/.well-known/oauth-protected-resource/:path*',
        destination: `${api}/.well-known/oauth-protected-resource/:path*`,
      },
      {
        source: '/.well-known/oauth-authorization-server/:path*',
        destination: `${api}/.well-known/oauth-authorization-server/:path*`,
      },
      {
        source: '/.well-known/openid-configuration/:path*',
        destination: `${api}/.well-known/openid-configuration/:path*`,
      },
    ];
  },
};

export default nextConfig;
