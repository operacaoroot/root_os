import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * Trava de crédito do Apify (27/10/2026, pedido do Lucas: "não quero pagar, atente-se ao
 * uso dos créditos que eles mesmo disponibilizam"). Tudo com o Apify falso: nenhum run de verdade.
 */

type Chamada = { url: string; init?: RequestInit };

function apifyFalso(uso: { usado: number; teto?: number; fim?: string } | 'quebrado') {
  const chamadas: Chamada[] = [];
  const fetchFalso = vi.fn(async (url: string, init?: RequestInit) => {
    chamadas.push({ url, init });
    if (url.includes('/users/me/limits')) {
      if (uso === 'quebrado') return new Response('erro', { status: 500 });
      return Response.json({ data: { monthlyUsageCycle: { endAt: uso.fim ?? '2026-11-14T00:00:00.000Z' }, limits: { maxMonthlyUsageUsd: uso.teto ?? 5 }, current: { monthlyUsageUsd: uso.usado } } });
    }
    if (url.includes('run-sync-get-dataset-items')) return new Response(JSON.stringify([{ videoUrl: 'https://cdn.exemplo/v.mp4' }]), { status: 200, headers: { 'x-apify-run-id': 'run1' } });
    if (url.includes('/actor-runs/')) return Response.json({ data: { usageTotalUsd: 0.004 } });
    return new Response('?', { status: 404 });
  });
  return { chamadas, fetchFalso };
}

async function servico() {
  const { ApifyService } = await import('../src/pauta/apify.service');
  return new ApifyService();
}

describe('Apify: só os créditos grátis do mês', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.APIFY_TOKEN = 'token-de-teste';
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.APIFY_TOKEN;
  });

  it('com uso baixo, roda o post avulso com 1 item, teto de custo e prazo curto', async () => {
    const f = apifyFalso({ usado: 0.12 });
    vi.stubGlobal('fetch', f.fetchFalso);
    const a = await servico();
    const r = await a.scrapeUrl('https://www.instagram.com/reel/abc/');
    expect(r.items).toHaveLength(1);
    const run = f.chamadas.find((c) => c.url.includes('run-sync-get-dataset-items'))!;
    expect(run.url).toContain('apify~instagram-scraper');
    expect(run.url).toContain('maxItems=1');
    expect(run.url).toContain('maxTotalChargeUsd=0.05');
    expect(run.url).toContain('timeout=90');
    expect(JSON.parse(String(run.init?.body))).toMatchObject({ resultsLimit: 1 });
  });

  it('com 90% ou mais do mês usados, não roda e diz quando volta', async () => {
    const f = apifyFalso({ usado: 4.6, teto: 5, fim: '2026-11-14T00:00:00.000Z' });
    vi.stubGlobal('fetch', f.fetchFalso);
    const a = await servico();
    await expect(a.scrapeUrl('https://www.instagram.com/reel/abc/')).rejects.toThrow(/créditos grátis do Apify deste mês acabaram \(US\$ 4,60 de 5,00\)\. Volta dia 14\/11/);
    expect(f.chamadas.some((c) => c.url.includes('run-sync'))).toBe(false);
  });

  it('sem conseguir ler o uso, não roda (na dúvida, não gasta)', async () => {
    const f = apifyFalso('quebrado');
    vi.stubGlobal('fetch', f.fetchFalso);
    const a = await servico();
    await expect(a.scrapePerfil('perfil', 12)).rejects.toThrow(/Não consegui ler o uso do Apify/);
    expect(f.chamadas.some((c) => c.url.includes('run-sync'))).toBe(false);
  });

  it('guarda a leitura do uso por alguns minutos, e lê de novo depois de um run', async () => {
    const f = apifyFalso({ usado: 1 });
    vi.stubGlobal('fetch', f.fetchFalso);
    const a = await servico();
    await a.usoDoMes();
    await a.usoDoMes();
    expect(f.chamadas.filter((c) => c.url.includes('/users/me/limits'))).toHaveLength(1);
    await a.scrapeUrl('https://www.instagram.com/reel/abc/');
    await a.usoDoMes();
    expect(f.chamadas.filter((c) => c.url.includes('/users/me/limits'))).toHaveLength(2);
  });

  it('perfil: no máximo 6 posts por coleta e teto de custo próprio', async () => {
    const f = apifyFalso({ usado: 0 });
    vi.stubGlobal('fetch', f.fetchFalso);
    const a = await servico();
    await a.scrapePerfil('perfil', 12, 'instagram');
    const run = f.chamadas.find((c) => c.url.includes('run-sync-get-dataset-items'))!;
    expect(run.url).toContain('maxItems=6');
    expect(run.url).toContain('maxTotalChargeUsd=0.15');
    expect(JSON.parse(String(run.init?.body))).toMatchObject({ resultsLimit: 6 });
  });
});
