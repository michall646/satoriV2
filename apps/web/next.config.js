/** @type {import('next').NextConfig} */
// Dev defaults to the local API. Production defaults to same-origin `/api`
// (set NEXT_PUBLIC_API only when the API is on another origin).
const DEFAULT_API = process.env.NODE_ENV === 'development' ? 'http://localhost:3001' : '';
const API = process.env.NEXT_PUBLIC_API || DEFAULT_API;

const nextConfig = {
  async rewrites() {
    if (!API) return [];
    return [{ source: '/api/:path*', destination: `${API}/api/:path*` }];
  },
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
        // Report-only first: a nonce-based enforced CSP needs a Next middleware pass.
        { key: 'Content-Security-Policy-Report-Only', value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' http: https: ws: wss:; frame-ancestors 'none'" },
      ],
    }];
  },
};
module.exports = nextConfig;
