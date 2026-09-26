/** @type {import('next').NextConfig} */

// The browser talks to ONE origin (this Next server). /api and /ws are proxied to the FastAPI backend, so a single
// tunnel (ngrok / cloudflared) exposes the customer side, the team console, the API, the WebSockets and the phone bridge.
const BACKEND = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    // Hosted on Vercel there is no backend next door: the browser calls the backend's own (ngrok) address directly, see lib/api.ts.
    if (process.env.VERCEL && !process.env.BACKEND_URL) return [];
    return [
      { source: "/api/:path*", destination: `${BACKEND}/api/:path*` },
      { source: "/ws/:path*", destination: `${BACKEND}/ws/:path*` },
      { source: "/health", destination: `${BACKEND}/health` },
    ];
  },
};

export default nextConfig;
