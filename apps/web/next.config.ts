import path from 'node:path';
import type { NextConfig } from 'next';
import { PHASE_DEVELOPMENT_SERVER } from 'next/constants';

const api = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';

export default function config(phase: string): NextConfig {
  return {
    // Self-contained server bundle for the Docker image (see Dockerfile, target "web").
    output: 'standalone',
    outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
    // The dev server only serves its scripts to localhost, and auth cookies and origin checks are tied
    // to WEB_ORIGIN (http://localhost:3000), so 127.0.0.1 would hang on the loading screen.
    async redirects() {
      if (phase !== PHASE_DEVELOPMENT_SERVER) return [];
      return [
        {
          source: '/:path*',
          has: [{ type: 'host', value: '127.0.0.1' }],
          destination: 'http://localhost:3000/:path*',
          permanent: false,
        },
      ];
    },
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
}
