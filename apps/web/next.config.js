/** @type {import('next').NextConfig} */
const API = process.env.NEXT_PUBLIC_API || 'http://localhost:3001';
const nextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API}/api/:path*` }];
  },
};
module.exports = nextConfig;
