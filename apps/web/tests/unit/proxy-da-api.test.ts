import { describe, expect, it } from 'vitest';
import nextConfig, { PRAZO_DO_PROXY_DA_API_MS } from '../../next.config.mjs';

// O `/api` do navegador passa pelo rewrite do Next, e o proxy dele corta em 30 s
// se ninguém disser outro prazo — menos que uma geração da pauta ou um run do Apify.
describe('o proxy da API no Next', () => {
  it('tem prazo acima do run síncrono do Apify e das gerações longas, não os 30 s do padrão', () => {
    const cfg = nextConfig as { experimental?: { proxyTimeout?: number } };
    expect(cfg.experimental?.proxyTimeout).toBe(PRAZO_DO_PROXY_DA_API_MS);
    expect(PRAZO_DO_PROXY_DA_API_MS).toBeGreaterThan(120_000 + 60_000);
    expect(PRAZO_DO_PROXY_DA_API_MS).toBeGreaterThanOrEqual(5 * 60_000);
  });

  it('o /api continua indo para a API pelo rewrite', async () => {
    const regras = await (nextConfig as { rewrites: () => Promise<Array<{ source: string; destination: string }>> }).rewrites();
    expect(regras.find((r) => r.source === '/api/:path*')?.destination).toMatch(/\/api\/:path\*$/);
  });
});
