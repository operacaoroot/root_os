import { Injectable, Logger, OnModuleInit, Optional, ServiceUnavailableException } from '@nestjs/common';
import { PRAZO_DA_CHAMADA_DE_SONDA_MS, RegistroDeConectores } from '../integrations/conectores.registry';
import {
  type ConectorDoContrato,
  type ResultadoDeAutorizacao,
  type ResultadoDeRevogacao,
  type ResultadoDeSincronizacao,
  type SaudeDeConector,
  conectado,
  erroDeConector,
  naoConfigurado,
} from '../integrations/contrato-de-conector';
import type { PautaPerfilPlataforma } from '@mktos/shared';
import { postsPedidos } from './perfil-da-pauta';

// Conector Apify — só sob demanda (onda 1). Credencial PRÓPRIA do root
// (APIFY_TOKEN, já declarado no .env.example). Roda o actor de forma síncrona e
// devolve o dataset + o custo, que o chamador grava na captura: sem registrar
// custo por run, um perfil vigiado queima crédito em silêncio.

// Actors por plataforma. O do Instagram é o mesmo já usado no acervo do vault
// (dataset_instagram-scraper_*.json em "8 - Referência de Conteúdo"). Trocar um
// id é trocar o formato do item: `postDoItem` (perfil-da-pauta.ts) lê o de cada um.
const ACTORS: Record<string, string> = {
  instagram: 'apify~instagram-scraper',
  tiktok: 'clockworks~tiktok-scraper',
  // Creators (MC4): os últimos posts de um @ no X e os últimos vídeos de um canal.
  x: 'apidojo~tweet-scraper',
  youtube: 'streamers~youtube-scraper',
  web: 'apify~website-content-crawler',
  // Busca do Google (MC3): um run = uma página de resultados de uma consulta.
  busca: 'apify~google-search-scraper',
};

/** O endereço público do perfil: é o que os actors de Instagram e YouTube recebem. */
export function urlDoPerfil(plataforma: PautaPerfilPlataforma, handle: string): string {
  switch (plataforma) {
    case 'instagram':
      return `https://www.instagram.com/${handle}/`;
    case 'tiktok':
      return `https://www.tiktok.com/@${handle}`;
    case 'x':
      return `https://x.com/${handle}`;
    case 'youtube':
      return /^UC[A-Za-z0-9_-]{22}$/.test(handle)
        ? `https://www.youtube.com/channel/${handle}/videos`
        : `https://www.youtube.com/@${handle}/videos`;
  }
}

/**
 * O input do actor de cada plataforma para os últimos `limite` posts do perfil.
 * Só post do próprio perfil: nada de comentário, short, live ou vídeo baixado,
 * que o Apify cobraria à parte.
 */
export function inputDoPerfil(
  plataforma: PautaPerfilPlataforma,
  handle: string,
  limite: number | undefined,
): Record<string, unknown> {
  const n = postsPedidos(limite);
  switch (plataforma) {
    case 'instagram':
      return { directUrls: [urlDoPerfil('instagram', handle)], resultsType: 'posts', resultsLimit: n, addParentData: false };
    case 'tiktok':
      return { profiles: [handle], resultsPerPage: n, shouldDownloadVideos: false, shouldDownloadCovers: false };
    case 'x':
      return { twitterHandles: [handle], maxItems: n, sort: 'Latest' };
    case 'youtube':
      return { startUrls: [{ url: urlDoPerfil('youtube', handle) }], maxResults: n, maxResultsShorts: 0, maxResultStreams: 0 };
  }
}

/** Recorte da busca do Google: país, idioma e janela de dias (`quickDateRange` do actor, `d<N>`). */
export interface OpcoesDaBusca {
  resultados: number;
  dias: number;
}

export interface ApifyRun {
  runId: string | null;
  items: Array<Record<string, unknown>>;
  custoUsd: number | null;
}

/** O uso do mês na conta do Apify (o ciclo de cobrança dele), para a trava e para a tela. */
export interface UsoDoApify {
  usadoUsd: number;
  tetoUsd: number;
  /** Fim do ciclo do mês (ISO), quando os créditos voltam. */
  voltaEm: string | null;
}

/*
 * TRAVA DE CRÉDITO (27/10/2026, pedido do Lucas: "não quero pagar, atente-se ao uso dos
 * créditos que eles mesmo disponibilizam"). Antes de cada run, o uso do mês é lido em
 * /users/me/limits (guardado por alguns minutos). Com 90% ou mais do teto do mês, não roda.
 * Sem conseguir ler o uso, também não roda: na dúvida, não gasta. Cada run vai com teto de
 * itens e de custo (maxItems, maxTotalChargeUsd) e prazo curto.
 */
const PARAR_EM = Number(process.env.APIFY_PARAR_EM ?? 0.9);
const TETO_DO_MES_SEM_LEITURA = Number(process.env.APIFY_TETO_MES_USD ?? 5);
const TETO_POR_RUN_USD = Number(process.env.APIFY_TETO_RUN_USD ?? 0.05);
const TETO_POR_RUN_DE_PERFIL_USD = Number(process.env.APIFY_TETO_RUN_PERFIL_USD ?? 0.15);
const POSTS_POR_PERFIL = Number(process.env.APIFY_POSTS_POR_PERFIL ?? 6);
const GUARDA_O_USO_MS = 5 * 60_000;

export class CreditoDoApifyEsgotadoError extends ServiceUnavailableException {}

const diaDaVolta = (iso: string | null) => {
  if (!iso) return 'no começo do próximo ciclo';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'no começo do próximo ciclo' : `dia ${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const usd = (n: number) => n.toFixed(2).replace('.', ',');

@Injectable()
export class ApifyService implements OnModuleInit {
  private readonly log = new Logger('ApifyService');
  private readonly token = process.env.APIFY_TOKEN ?? '';
  private readonly base = 'https://api.apify.com/v2';
  // Um run síncrono do Apify pode demorar; o teto evita segurar a requisição HTTP
  // do painel indefinidamente quando o actor trava.
  private readonly timeoutSec = Number(process.env.APIFY_TIMEOUT_SEC ?? 120);
  private usoGuardado: { lidoEm: number; uso: UsoDoApify } | null = null;

  constructor(
    /** Rodada dos agentes (A6): o Apify implementa o contrato único de conector. */
    @Optional() private readonly contrato?: RegistroDeConectores,
  ) {}

  onModuleInit(): void {
    this.contrato?.registrar(this.descritorDoContrato(), 'ApifyService');
  }

  get configured(): boolean {
    return this.token.length > 0;
  }

  /**
   * O CONTRATO ÚNICO (rodada dos agentes, A6). O token do Apify é do PROCESSO e
   * cada run é cobrado, então a sonda NÃO roda actor: ela pergunta quem é o dono
   * do token (`GET /users/me`), que não gasta crédito. Desligado, o registro nem
   * chama.
   */
  private descritorDoContrato(): ConectorDoContrato {
    return {
      chave: 'apify',
      rotulo: 'Apify (coleta de perfis e busca)',
      escopoDaCredencial: 'processo',
      autorizar: async (): Promise<ResultadoDeAutorizacao> => ({
        tipo: 'manual',
        instrucao: 'O Apify não tem OAuth: o token da conta (Settings › Integrations) vai em APIFY_TOKEN no ambiente da API.',
      }),
      sincronizar: async (): Promise<ResultadoDeSincronizacao> => ({
        tipo: 'nao_se_aplica',
        motivo: 'Cada run é pago e sai da coleta da Pauta (Radar ou a rodada), com o teto de runs por fonte; não há espelho para trazer.',
      }),
      saude: async (): Promise<SaudeDeConector> => {
        if (!this.configured) return naoConfigurado('APIFY_TOKEN ausente no ambiente da API: links do Instagram e do TikTok, perfis e buscas não são coletados.');
        const comecou = Date.now();
        try {
          const res = await fetch(`${this.base}/users/me?token=${encodeURIComponent(this.token)}`, {
            signal: AbortSignal.timeout(PRAZO_DA_CHAMADA_DE_SONDA_MS),
          });
          if (!res.ok) return erroDeConector(`O Apify recusou o token (HTTP ${res.status}).`, Date.now() - comecou);
          return conectado(Date.now() - comecou);
        } catch (e) {
          return erroDeConector(`O Apify não respondeu: ${(e as Error).message}`, Date.now() - comecou);
        }
      },
      revogar: async (): Promise<ResultadoDeRevogacao> => ({
        tipo: 'nao_se_aplica',
        motivo: 'O token do Apify é do processo: para queimar, gere outro no painel do Apify e troque APIFY_TOKEN no ambiente da API.',
      }),
    };
  }

  /** Descobre a plataforma pela URL — define o actor e o formato do input. */
  static plataformaDaUrl(url: string): string {
    try {
      const h = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
      if (h === 'instagram.com' || h.endsWith('.instagram.com')) return 'instagram';
      if (h === 'tiktok.com' || h.endsWith('.tiktok.com')) return 'tiktok';
      if (h === 'x.com' || h === 'twitter.com' || h.endsWith('.twitter.com')) return 'x';
      if (h === 'youtu.be' || h === 'youtube.com' || h.endsWith('.youtube.com')) return 'youtube';
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

  /** Roda o actor da plataforma para UMA url e devolve os itens do dataset. Só Instagram e TikTok têm actor de post avulso. */
  async scrapeUrl(url: string): Promise<ApifyRun> {
    const plataforma = ApifyService.plataformaDaUrl(url);
    const actor = plataforma === 'instagram' || plataforma === 'tiktok' ? ACTORS[plataforma] : ACTORS.web;
    return this.run(actor, this.input(plataforma, url), { maxItems: 1, maxUsd: TETO_POR_RUN_USD, timeoutSec: Math.min(this.timeoutSec, 90) });
  }

  /**
   * Últimos posts de um perfil (aba Radar e coleta da rodada). O handle chega
   * já lido por `lerHandleDoPerfil`; o input de cada actor mora em `inputDoPerfil`.
   */
  async scrapePerfil(handle: string, limite = 12, plataforma: PautaPerfilPlataforma = 'instagram'): Promise<ApifyRun> {
    const n = Math.min(limite, POSTS_POR_PERFIL);
    return this.run(ACTORS[plataforma], inputDoPerfil(plataforma, handle.replace(/^@/, '').trim(), n), { maxItems: n, maxUsd: TETO_POR_RUN_DE_PERFIL_USD });
  }

  /**
   * Resultados de UMA consulta no Google do Brasil, em português, só dos últimos
   * `dias`. Uma página só (`maxPagesPerQuery: 1`): cada página a mais é cobrada,
   * e o teto de runs da fonte conta runs, não páginas. A consulta chega sem
   * quebra de linha — no actor, cada linha de `queries` é outra busca paga.
   */
  async buscarNoGoogle(consulta: string, opcoes: OpcoesDaBusca): Promise<ApifyRun> {
    return this.run(ACTORS.busca, {
      queries: consulta.replace(/\s+/g, ' ').trim(),
      resultsPerPage: Math.min(Math.max(Math.trunc(opcoes.resultados), 1), 100),
      maxPagesPerQuery: 1,
      countryCode: 'br',
      languageCode: 'pt-BR',
      quickDateRange: `d${Math.max(Math.trunc(opcoes.dias), 1)}`,
      mobileResults: false,
    });
  }

  /** O uso do mês na conta do Apify, guardado por 5 minutos. Nulo quando não deu para ler. */
  async usoDoMes(forcar = false): Promise<UsoDoApify | null> {
    if (!this.configured) return null;
    if (!forcar && this.usoGuardado && Date.now() - this.usoGuardado.lidoEm < GUARDA_O_USO_MS) return this.usoGuardado.uso;
    try {
      const r = await fetch(`${this.base}/users/me/limits`, {
        headers: { Authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as {
        data?: { monthlyUsageCycle?: { endAt?: string }; limits?: { maxMonthlyUsageUsd?: number }; current?: { monthlyUsageUsd?: number } };
      };
      const teto = Number(j.data?.limits?.maxMonthlyUsageUsd) > 0 ? Number(j.data!.limits!.maxMonthlyUsageUsd) : TETO_DO_MES_SEM_LEITURA;
      const uso: UsoDoApify = { usadoUsd: Number(j.data?.current?.monthlyUsageUsd ?? 0), tetoUsd: teto, voltaEm: j.data?.monthlyUsageCycle?.endAt ?? null };
      this.usoGuardado = { lidoEm: Date.now(), uso };
      return uso;
    } catch (e) {
      this.log.warn(`uso do Apify ilegível: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  /** A trava: lança quando o mês passou de 90% do teto, ou quando não dá para saber. */
  private async exigirCredito(): Promise<void> {
    const uso = await this.usoDoMes();
    if (!uso) {
      throw new CreditoDoApifyEsgotadoError('Não consegui ler o uso do Apify agora. Para não gastar sem saber, a coleta não rodou. Tente de novo em alguns minutos.');
    }
    if (uso.usadoUsd >= uso.tetoUsd * PARAR_EM) {
      throw new CreditoDoApifyEsgotadoError(
        `Os créditos grátis do Apify deste mês acabaram (US$ ${usd(uso.usadoUsd)} de ${usd(uso.tetoUsd)}). Volta ${diaDaVolta(uso.voltaEm)}.`,
      );
    }
  }

  private async run(
    actor: string,
    input: Record<string, unknown>,
    opcoes: { maxItems?: number; maxUsd?: number; timeoutSec?: number } = {},
  ): Promise<ApifyRun> {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'APIFY_TOKEN ausente. Defina no .env (ver .env.example) e reinicie a API.',
      );
    }
    await this.exigirCredito();

    // run-sync-get-dataset-items: dispara e já devolve os itens numa chamada só,
    // com teto de itens e de custo por run (o actor para quando bate o teto).
    const prazo = opcoes.timeoutSec ?? this.timeoutSec;
    const url =
      `${this.base}/acts/${actor}/run-sync-get-dataset-items` +
      `?token=${encodeURIComponent(this.token)}&timeout=${prazo}` +
      (opcoes.maxItems ? `&maxItems=${opcoes.maxItems}` : '') +
      `&maxTotalChargeUsd=${opcoes.maxUsd ?? TETO_POR_RUN_USD}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout((prazo + 15) * 1000),
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

    // O run gastou: a próxima leitura do uso do mês vai ao Apify de novo.
    this.usoGuardado = null;
    return { runId, items: Array.isArray(items) ? items : [], custoUsd };
  }
}
