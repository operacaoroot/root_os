/** @type {import('next').NextConfig} */
const API_TARGET = process.env.API_PROXY_TARGET ?? 'http://localhost:4001';

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@mktos/shared'],
  // Proxy da API pelo próprio Next → o browser fala sempre com a MESMA origem
  // (funciona em localhost, LAN e túnel; sem CORS e sem URL fixa no build).
  async rewrites() {
    return [
      { source: '/api/:path*', destination: `${API_TARGET}/api/:path*` },
      // A raiz de os.operacaoroot.com serve o ROOT OS — HTML estático, público,
      // entregue ANTES do React, então não passa pelo AppShell nem exige login.
      // O painel autenticado que ficava aqui mudou para /painel.
      { source: '/', destination: '/root-os.html' },
    ];
  },
};

export default nextConfig;
