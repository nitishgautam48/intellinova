// No service worker. An offline cache of pages and scripts mixed old and new builds after updates
// (blank "Application error" pages, unstyled screens). public/sw.js is a one-time cleanup worker that
// removes the cache from browsers that installed it before. The web manifest still makes the app installable.

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  // In production Caddy sends /api to FastAPI. For `npm run dev` without Caddy, proxy it here.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${process.env.API_INTERNAL_URL || "http://localhost:8000"}/api/:path*` }];
  },
};

export default nextConfig;
