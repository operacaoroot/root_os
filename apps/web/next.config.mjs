/** @type {import('next').NextConfig} */
const API_TARGET = process.env.API_PROXY_TARGET ?? 'http://localhost:4001';

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@mktos/shared'],
  // Proxy da API pelo próprio Next → o browser fala sempre com a MESMA origem
  // (funciona em localhost, LAN e túnel; sem CORS e sem URL fixa no build).
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_TARGET}/api/:path*` }];
  },
};

export default nextConfig;
