import { ROTAS_ANTIGAS } from './rotas-antigas.mjs';

/** @type {import('next').NextConfig} */
const API_TARGET = process.env.API_PROXY_TARGET ?? 'http://localhost:4001';

/**
 * O rewrite de `/api` é um proxy com prazo próprio, 30 s por padrão. As
 * gerações da pauta (semana, roteiro, pacote, newsletter, voz, curadoria) e a
 * coleta com o Apify (`APIFY_TIMEOUT_SEC`, 120 s) passam disso: o proxy
 * devolvia 500 com o handler da API ainda rodando, e o segundo clique pagava
 * de novo. Dez minutos cobrem a semana de um episódio longo, uma chamada ao
 * modelo por matéria. Mudar exige refazer a imagem do `web`.
 */
export const PRAZO_DO_PROXY_DA_API_MS = 600_000;

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@mktos/shared'],
  experimental: { proxyTimeout: PRAZO_DO_PROXY_DA_API_MS },
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
  // Nenhum link antigo quebra: a reorganização renomeou telas, e cada nome
  // velho continua respondendo. 308 (permanente) porque a mudança é definitiva
  // — 307 faria o browser voltar a bater na rota antiga para sempre.
  async redirects() {
    return ROTAS_ANTIGAS.map(({ de, para }) => ({
      source: de,
      destination: para,
      permanent: true,
    }));
  },
};

export default nextConfig;
