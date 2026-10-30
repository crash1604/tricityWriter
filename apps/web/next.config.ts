import type { NextConfig } from 'next';

const api = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';

const nextConfig: NextConfig = {
  // The browser only talks to this origin; /api/* (auth and v1) is proxied to apps/api so session
  // cookies stay first-party.
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${api}/api/:path*` },
      // MCP clients can use the dashboard's address too.
      { source: '/mcp', destination: `${api}/mcp` },
    ];
  },
};

export default nextConfig;
