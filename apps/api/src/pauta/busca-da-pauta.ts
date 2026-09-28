import { cortarSemPartirCaractere, semSubstitutoSolto } from '../common/texto';
import { hashDaCaptura, normalizarUrlDaCaptura } from './url-da-captura';

/*
 * ============================================================================
 * BUSCA WEB DAS NOTÍCIAS DO NICHO (MC3) — a parte pura
 * ============================================================================
 *
 * A fonte `busca` guarda a CONSULTA em `handle` (a mesma coluna do @perfil e da
 * etiqueta do Gmail). A coleta roda o actor de busca do Google no Apify com o
 * recorte fixo da pauta — Brasil, pt-BR, última semana — e cada resultado
 * orgânico vira uma `PautaCaptura`: título, link e a descrição do Google na nota.
 *
 * A CHAVE É A MESMA DA TELA E DO GRUPO DE LINKS (`normalizarUrlDaCaptura`): a
 * matéria que a busca achou e alguém também colou no grupo é uma captura só.
 *
 * O RECORTE DE DATA É DOBRADO DE PROPÓSITO. O actor recebe `quickDateRange`
 * (o `qdr` do Google), e o que vier com data mais velha que a janela ainda é
 * descartado aqui: o Google às vezes devolve a página antiga que foi "atualizada",
 * e a pauta é de notícia da semana. Resultado sem data nenhuma passa — quem
 * filtrou primeiro foi o Google.
 */

export const DIAS_DA_JANELA_DA_BUSCA = 7;
/** Uma página do Google. O "Coletar agora" do Radar pede 12; a rodada usa o padrão. */
export const RESULTADOS_POR_BUSCA = 10;
export const TETO_DE_RESULTADOS_POR_BUSCA = 30;
export const TETO_DA_CONSULTA = 200;
/** O Google ignora o que passa da 32ª palavra — melhor recusar do que buscar outra coisa calado. */
export const TETO_DE_PALAVRAS_DA_CONSULTA = 32;
const TETO_DO_TITULO = 300;
export const TETO_DA_NOTA_DA_BUSCA = 1500;

const DIA_MS = 86_400_000;

export type ConsultaLida = { consulta: string } | { erro: string };

/**
 * A consulta em uma linha só. No actor, cada linha de `queries` é OUTRA busca
 * — e outra cobrança dentro do mesmo run, que o teto de runs não enxerga.
 */
export function lerConsulta(bruta: string | null | undefined): ConsultaLida {
  const consulta = String(bruta ?? '').replace(/\s+/g, ' ').trim();
  if (!consulta) {
    return { erro: 'Fonte de busca exige a consulta (ex.: inteligência artificial pequenas empresas).' };
  }
  if (consulta.length > TETO_DA_CONSULTA) {
    return { erro: `A consulta da busca tem no máximo ${TETO_DA_CONSULTA} caracteres.` };
  }
  if (/^(https?:\/\/|www\.)/i.test(consulta)) {
    return {
      erro: 'Cole os termos da busca, não um endereço: a URL do Google passaria por cima do ' +
        'recorte de país, idioma e semana.',
    };
  }
  if (consulta.split(' ').length > TETO_DE_PALAVRAS_DA_CONSULTA) {
    return { erro: `O Google considera só as primeiras ${TETO_DE_PALAVRAS_DA_CONSULTA} palavras da consulta.` };
  }
  return { consulta };
}

export function resultadosPedidos(limite: number | undefined): number {
  const n = Number.isFinite(limite) ? Math.trunc(limite as number) : RESULTADOS_POR_BUSCA;
  return Math.min(Math.max(n, 1), TETO_DE_RESULTADOS_POR_BUSCA);
}

// ---------------------------------------------------------------------------
// A data do resultado
// ---------------------------------------------------------------------------

const MESES: Record<string, number> = {
  jan: 0, fev: 1, feb: 1, mar: 2, abr: 3, apr: 3, mai: 4, may: 4, jun: 5, jul: 6,
  ago: 7, aug: 7, set: 8, sep: 8, out: 9, oct: 9, nov: 10, dez: 11, dec: 11,
};

const UNIDADES: Record<string, number> = {
  minuto: 60_000, minute: 60_000, min: 60_000,
  hora: 3_600_000, hour: 3_600_000,
  dia: DIA_MS, day: DIA_MS,
  semana: 7 * DIA_MS, week: 7 * DIA_MS,
  mes: 30 * DIA_MS, month: 30 * DIA_MS,
  ano: 365 * DIA_MS, year: 365 * DIA_MS,
};

/**
 * Lê as formas que o Google usa na data do resultado: ISO (quando o actor já
 * normalizou), "há 3 dias", "3 days ago", "ontem", "22 de set. de 2026" e
 * "Sep 22, 2026". O que não for nenhuma delas é `null` — não é data.
 */
export function lerDataDoGoogle(texto: string, agora: Date): Date | null {
  const t = texto.trim().toLowerCase();
  if (!t) return null;

  if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
    const d = new Date(texto.trim());
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (/^(hoje|today)$/.test(t)) return agora;
  if (/^(ontem|yesterday)$/.test(t)) return new Date(agora.getTime() - DIA_MS);

  const relativa =
    t.match(/^há\s+(\d+)\s+([a-zêç]+?)s?$/) ?? t.match(/^(\d+)\s+([a-z]+?)s?\s+ago$/);
  if (relativa) {
    // O `s?` da regex come o "s" final: "meses" chega como "mese" e "mês", como "mê".
    const unidade = UNIDADES[relativa[2] === 'mese' || relativa[2] === 'mê' ? 'mes' : relativa[2]];
    return unidade ? new Date(agora.getTime() - Number(relativa[1]) * unidade) : null;
  }

  const pt = t.match(/^(\d{1,2})\s+de\s+([a-zç]{3})[a-zç]*\.?\s+de\s+(\d{4})$/);
  if (pt && MESES[pt[2]] !== undefined) return new Date(Date.UTC(Number(pt[3]), MESES[pt[2]], Number(pt[1])));

  const en = t.match(/^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),\s+(\d{4})$/);
  if (en && MESES[en[1]] !== undefined) return new Date(Date.UTC(Number(en[3]), MESES[en[1]], Number(en[2])));

  return null;
}

/** O Google põe a data na frente da descrição: "há 2 dias — O texto…". */
function separarDataDaDescricao(descricao: string, agora: Date): { data: Date | null; resto: string } {
  const m = descricao.match(/^(.{1,40}?)\s+[—–-]\s+([\s\S]*)$/);
  if (m) {
    const data = lerDataDoGoogle(m[1], agora);
    if (data) return { data, resto: m[2] };
  }
  return { data: null, resto: descricao };
}

// ---------------------------------------------------------------------------
// O resultado que vira captura
// ---------------------------------------------------------------------------

export interface ResultadoDaBusca {
  titulo: string;
  url: string;
  descricao: string;
  publicadoEm: Date | null;
  posicao: number | null;
}

export interface ResultadosDaBusca {
  resultados: ResultadoDaBusca[];
  /** Tinham data, e a data era mais velha que a janela. */
  foraDaJanela: number;
}

const texto = (v: unknown): string => (typeof v === 'string' ? semSubstitutoSolto(v).replace(/\s+/g, ' ').trim() : '');

function ehDoProprioGoogle(url: URL): boolean {
  return /(^|\.)google\.[a-z.]+$/i.test(url.hostname) && /^\/(search|url|webcache|imgres)/.test(url.pathname);
}

/**
 * Achata o dataset do actor (um item por página do Google, com `organicResults`)
 * nos resultados que viram captura: só orgânicos, só http(s), sem os endereços
 * internos do Google, sem repetir a mesma URL no mesmo run, e sem o que tem data
 * velha. Anúncio, "as pessoas também perguntam" e busca relacionada ficam de fora.
 */
export function resultadosDaBusca(
  itens: ReadonlyArray<Record<string, unknown>>,
  agora: Date,
  dias = DIAS_DA_JANELA_DA_BUSCA,
): ResultadosDaBusca {
  // Um dia de folga: a data do Google é do dia, sem hora.
  const limite = agora.getTime() - (dias + 1) * DIA_MS;
  const vistos = new Set<string>();
  const resultados: ResultadoDaBusca[] = [];
  let foraDaJanela = 0;

  for (const item of itens) {
    const organicos = Array.isArray(item?.organicResults) ? (item.organicResults as unknown[]) : [];
    for (const bruto of organicos) {
      if (!bruto || typeof bruto !== 'object') continue;
      const r = bruto as Record<string, unknown>;

      let url: URL;
      try {
        url = new URL(texto(r.url));
      } catch {
        continue;
      }
      if (!/^https?:$/.test(url.protocol) || ehDoProprioGoogle(url)) continue;

      const chave = hashDaCaptura(normalizarUrlDaCaptura(url.toString()));
      if (vistos.has(chave)) continue;
      vistos.add(chave);

      const { data: dataDaDescricao, resto } = separarDataDaDescricao(texto(r.description), agora);
      const publicadoEm = (texto(r.date) && lerDataDoGoogle(texto(r.date), agora)) || dataDaDescricao;
      if (publicadoEm && publicadoEm.getTime() < limite) {
        foraDaJanela++;
        continue;
      }

      resultados.push({
        titulo: cortarSemPartirCaractere(texto(r.title) || url.hostname.replace(/^www\./, ''), TETO_DO_TITULO),
        url: url.toString(),
        descricao: resto,
        publicadoEm,
        posicao: typeof r.position === 'number' ? r.position : null,
      });
    }
  }
  return { resultados, foraDaJanela };
}

export interface CapturaDaBusca {
  url: string;
  urlHash: string;
  titulo: string;
  nota: string | null;
  bruto: {
    resumo: string | null;
    publicadoEm: string | null;
    busca: { consulta: string; posicao: number | null };
  };
}

/**
 * `resumo` e `publicadoEm` no bruto são os mesmos campos que o item do RSS
 * grava: é o que a curadoria da rodada lê para montar a lista do prompt.
 */
export function capturaDoResultado(r: ResultadoDaBusca, consulta: string): CapturaDaBusca {
  const resumo = r.descricao ? cortarSemPartirCaractere(r.descricao, TETO_DA_NOTA_DA_BUSCA) : null;
  return {
    // A URL que o Google devolveu é a que vai para a rodada e dali para o link
    // publicado; a normalizada serve só à chave (há site que não abre sem `www.`).
    url: r.url,
    urlHash: hashDaCaptura(normalizarUrlDaCaptura(r.url)),
    titulo: r.titulo,
    nota: resumo,
    bruto: {
      resumo,
      publicadoEm: r.publicadoEm?.toISOString() ?? null,
      busca: { consulta, posicao: r.posicao },
    },
  };
}

/**
 * O custo do run dividido pelas capturas que ele gerou, em 4 casas: somar a
 * coluna dá o gasto APROXIMADO (o arredondamento sobra ou falta). O total exato
 * do run é o do RASTRO `pauta.coleta_busca`.
 */
export function custoPorCaptura(custoDoRunUsd: number | null, novas: number): number | null {
  if (custoDoRunUsd == null || !Number.isFinite(custoDoRunUsd) || novas <= 0) return null;
  return Math.round((custoDoRunUsd / novas) * 10_000) / 10_000;
}

/**
 * Processar a captura troca o `bruto` pelo da leitura do link. O que a busca
 * gravou (consulta, resumo, data) é o que a curadoria da rodada lê — e a rodada
 * também lê captura que já virou ficha —, então atravessa o processamento.
 */
export function comProcedenciaDaBusca(anterior: unknown, novo: unknown): unknown {
  const antes = anterior && typeof anterior === 'object' ? (anterior as Record<string, unknown>) : null;
  if (!antes?.busca || typeof antes.busca !== 'object') return novo;
  const depois = novo && typeof novo === 'object' ? (novo as Record<string, unknown>) : {};
  return { ...depois, resumo: antes.resumo ?? null, publicadoEm: antes.publicadoEm ?? null, busca: antes.busca };
}
