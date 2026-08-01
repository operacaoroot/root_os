import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

// Conector Apify — só sob demanda (onda 1). Credencial PRÓPRIA do root
// (APIFY_TOKEN, já declarado no .env.example). Roda o actor de forma síncrona e
// devolve o dataset + o custo, que o chamador grava na captura: sem registrar
// custo por run, um perfil vigiado queima crédito em silêncio.

// Actors por plataforma. O do Instagram é o mesmo já usado no acervo do vault
// (dataset_instagram-scraper_*.json em "8 - Referência de Conteúdo").
const ACTORS: Record<string, string> = {
  instagram: 'apify~instagram-scraper',
  tiktok: 'clockworks~tiktok-scraper',
  web: 'apify~website-content-crawler',
};

export interface ApifyRun {
  runId: string | null;
  items: Array<Record<string, unknown>>;
  custoUsd: number | null;
}

@Injectable()
export class ApifyService {
  private readonly log = new Logger('ApifyService');
  private readonly token = process.env.APIFY_TOKEN ?? '';
  private readonly base = 'https://api.apify.com/v2';
  // Um run síncrono do Apify pode demorar; o teto evita segurar a requisição HTTP
  // do painel indefinidamente quando o actor trava.
  private readonly timeoutSec = Number(process.env.APIFY_TIMEOUT_SEC ?? 120);

  get configured(): boolean {
    return this.token.length > 0;
  }

  /** Descobre a plataforma pela URL — define o actor e o formato do input. */
  static plataformaDaUrl(url: string): string {
    try {
      const h = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
      if (h.endsWith('instagram.com')) return 'instagram';
      if (h.endsWith('tiktok.com')) return 'tiktok';
      if (h === 'x.com' || h.endsWith('twitter.com')) return 'x';
      return 'web';
    } catch {
      return 'web';
    }
  }

  private input(plataforma: string, url: string): Record<string, unknown> {
    switch (plataforma) {
      case 'instagram':
        return { directUrls: [url], resultsType: 'posts', resultsLimit: 1, addParentData: false };
      case 'tiktok':
        return { postURLs: [url], resultsPerPage: 1, shouldDownloadVideos: false };
      default:
        return { startUrls: [{ url }], maxCrawlPages: 1, crawlerType: 'cheerio' };
    }
  }

  /** Roda o actor da plataforma para UMA url e devolve os itens do dataset. */
  async scrapeUrl(url: string): Promise<ApifyRun> {
    const plataforma = ApifyService.plataformaDaUrl(url);
    const actor = ACTORS[plataforma] ?? ACTORS.web;
    return this.run(actor, this.input(plataforma, url));
  }

  /** Últimos posts de um perfil (aba Radar; também serve p/ importar um acervo). */
  async scrapePerfil(handle: string, limite = 12): Promise<ApifyRun> {
    const user = handle.replace(/^@/, '').trim();
    return this.run(ACTORS.instagram, {
      directUrls: [`https://www.instagram.com/${user}/`],
      resultsType: 'posts',
      resultsLimit: Math.min(Math.max(limite, 1), 50),
      addParentData: false,
    });
  }

  private async run(actor: string, input: Record<string, unknown>): Promise<ApifyRun> {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'APIFY_TOKEN ausente. Defina no .env (ver .env.example) e reinicie a API.',
      );
    }

    // run-sync-get-dataset-items: dispara e já devolve os itens numa chamada só.
    const url =
      `${this.base}/acts/${actor}/run-sync-get-dataset-items` +
      `?token=${encodeURIComponent(this.token)}&timeout=${this.timeoutSec}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout((this.timeoutSec + 15) * 1000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.log.error(`Apify ${actor} HTTP ${res.status}: ${body.slice(0, 300)}`);
      throw new ServiceUnavailableException(`Apify respondeu HTTP ${res.status} ao rodar ${actor}.`);
    }

    const items = (await res.json()) as Array<Record<string, unknown>>;
    // O id do run vem no header; o custo exige uma segunda chamada (barata).
    const runId = res.headers.get('x-apify-run-id');
    let custoUsd: number | null = null;
    if (runId) {
      try {
        const r = await fetch(`${this.base}/actor-runs/${runId}?token=${encodeURIComponent(this.token)}`);
        if (r.ok) {
          const j = (await r.json()) as { data?: { usageTotalUsd?: number } };
          custoUsd = j.data?.usageTotalUsd ?? null;
        }
      } catch {
        // custo é telemetria: falhar aqui não invalida o run
      }
    }

    return { runId, items: Array.isArray(items) ? items : [], custoUsd };
  }
}
