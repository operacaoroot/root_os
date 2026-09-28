import { PAUTA_PERFIL_PLATAFORMAS, type PautaPerfilPlataforma } from '@mktos/shared';
import { cortarSemPartirCaractere, semSubstitutoSolto } from '../common/texto';

/*
 * ============================================================================
 * CREATORS NO INSTAGRAM, TIKTOK, X E YOUTUBE (MC4) — a parte pura
 * ============================================================================
 *
 * A fonte `perfil` guarda o @ do creator em `handle` e a plataforma em
 * `plataforma` (sem plataforma é Instagram, a única antes do MC4). A coleta
 * roda o actor da plataforma no Apify e cada post vira uma `PautaCaptura`.
 *
 * CADA ACTOR DEVOLVE O POST NUM FORMATO: o Instagram escreve `caption` e
 * `timestamp`, o TikTok `text` e `createTimeISO`, o X `text` e `createdAt` no
 * formato do Twitter, o YouTube `title`, `text` e `date`. Aqui tudo vira
 * `{url, titulo, texto, publicadoEm}` — o que a captura, a fila e a curadoria
 * da rodada leem —, e o item cru segue inteiro no `bruto`.
 */

export const LIMITE_PADRAO_DO_PERFIL = 12;
export const TETO_DE_POSTS_POR_COLETA = 50;
const TETO_DO_TITULO = 120;
/** O mesmo teto do resumo que a curadoria da rodada manda ao prompt. */
const TETO_DO_RESUMO = 500;
/** O mesmo teto do texto que o processamento manda para a IA. */
const TETO_DO_TEXTO = 12000;

/** Perfil sem plataforma é Instagram; `twitter` é o X. O que não for uma das quatro é `null`. */
export function plataformaDoPerfil(bruta: string | null | undefined): PautaPerfilPlataforma | null {
  const p = String(bruta ?? '').trim().toLowerCase();
  if (!p) return 'instagram';
  if (p === 'twitter') return 'x';
  return (PAUTA_PERFIL_PLATAFORMAS as readonly string[]).includes(p) ? (p as PautaPerfilPlataforma) : null;
}

// O @ que cada plataforma aceita. O do YouTube também pode ser o id do canal (UC + 22).
const HANDLE: Record<PautaPerfilPlataforma, RegExp> = {
  instagram: /^[A-Za-z0-9._]{1,30}$/,
  tiktok: /^[A-Za-z0-9._]{2,24}$/,
  x: /^[A-Za-z0-9_]{1,15}$/,
  youtube: /^(?:[A-Za-z0-9._-]{3,30}|UC[A-Za-z0-9_-]{22})$/,
};

export type HandleLido = { handle: string } | { erro: string };

// O host de cada rede, sem `www.`/`m.`. O X ainda responde em twitter.com.
const HOSTS: Record<PautaPerfilPlataforma, readonly string[]> = {
  instagram: ['instagram.com'],
  tiktok: ['tiktok.com'],
  x: ['x.com', 'twitter.com'],
  youtube: ['youtube.com'],
};

// Primeiro trecho do caminho que é página da rede, e não um perfil: colar o
// link de um post ou de um vídeo daria o @ errado e um run gasto no creator errado.
const RESERVADOS: Record<PautaPerfilPlataforma, readonly string[]> = {
  instagram: ['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'direct'],
  tiktok: ['video', 'tag', 'music', 'discover', 'search', 'explore', 'foryou', 'live'],
  x: ['i', 'home', 'search', 'explore', 'hashtag', 'notifications', 'messages', 'settings', 'intent', 'share'],
  youtube: ['watch', 'shorts', 'playlist', 'results', 'feed', 'embed', 'live', 'hashtag'],
};

/** O @ no caminho do perfil: `/@canal`, `/channel/UC…`, `/usuario`. */
function handleDaUrl(plataforma: PautaPerfilPlataforma, url: URL): HandleLido {
  const nome = nomeDaPlataforma(plataforma);
  const host = url.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
  if (!HOSTS[plataforma].includes(host)) {
    return { erro: `O endereço colado é de ${host}, não do ${nome}. Cole o @ ou o endereço do perfil no ${nome}.` };
  }
  const partes = url.pathname.split('/').filter(Boolean);
  const primeiro = (partes[0] ?? '').toLowerCase();
  if (plataforma === 'youtube' && primeiro === 'channel') {
    return partes[1] ? { handle: partes[1] } : { erro: `O endereço colado não traz o canal do ${nome}.` };
  }
  // O nome antigo de `/user/` e `/c/` não é o @ do canal, e o actor lê por @ ou por id.
  if (plataforma === 'youtube' && (primeiro === 'user' || primeiro === 'c')) {
    return { erro: 'Endereço antigo do YouTube (/user/ ou /c/): cole o @ do canal ou o endereço /channel/UC….' };
  }
  if (RESERVADOS[plataforma].includes(primeiro.replace(/^@/, ''))) {
    return {
      erro: `O endereço colado é de um post ou de uma página do ${nome}, não de um perfil. Cole o @ ou o endereço do perfil.`,
    };
  }
  return { handle: partes[0] ?? '' };
}

/**
 * O handle como o actor espera: sem `@`, sem espaço, e tirado da URL quando
 * alguém cola o endereço do perfil em vez do @.
 */
export function lerHandleDoPerfil(plataforma: PautaPerfilPlataforma, bruto: string | null | undefined): HandleLido {
  let handle = String(bruto ?? '').trim();
  if (/^(https?:\/\/|www\.)/i.test(handle)) {
    let url: URL | null;
    try {
      url = new URL(/^www\./i.test(handle) ? `https://${handle}` : handle);
    } catch {
      url = null;
    }
    if (!url) return { erro: `"${handle.slice(0, 80)}" não é um endereço válido.` };
    const daUrl = handleDaUrl(plataforma, url);
    if ('erro' in daUrl) return daUrl;
    handle = daUrl.handle;
  }
  handle = handle.replace(/^@/, '');
  if (!handle) return { erro: 'Fonte perfil exige o @ do creator.' };
  if (!HANDLE[plataforma].test(handle)) {
    return { erro: `"${handle.slice(0, 60)}" não é um @ válido no ${nomeDaPlataforma(plataforma)}.` };
  }
  return { handle };
}

export function nomeDaPlataforma(p: PautaPerfilPlataforma): string {
  return { instagram: 'Instagram', tiktok: 'TikTok', x: 'X', youtube: 'YouTube' }[p];
}

export function postsPedidos(limite: number | undefined): number {
  const n = Number.isFinite(limite) ? Math.trunc(limite as number) : LIMITE_PADRAO_DO_PERFIL;
  return Math.min(Math.max(n, 1), TETO_DE_POSTS_POR_COLETA);
}

// ---------------------------------------------------------------------------
// O item do actor vira post
// ---------------------------------------------------------------------------

export interface PostDoPerfil {
  url: string;
  titulo: string;
  texto: string;
  publicadoEm: Date | null;
}

const texto = (v: unknown): string => (typeof v === 'string' ? semSubstitutoSolto(v).trim() : '');

function primeiroTexto(item: Record<string, unknown>, chaves: string[]): string {
  for (const k of chaves) {
    const t = texto(item[k]);
    if (t) return t;
  }
  return '';
}

/** ISO, o `createdAt` do Twitter ("Tue Sep 22 14:03:11 +0000 2026") ou epoch em segundos/milissegundos. */
export function lerDataDoPost(v: unknown): Date | null {
  let d: Date | null = null;
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) d = new Date(v < 1e12 ? v * 1000 : v);
  else if (typeof v === 'string' && v.trim()) d = new Date(v.trim());
  return d && !Number.isNaN(d.getTime()) ? d : null;
}

function urlPublica(v: unknown): string | null {
  try {
    const u = new URL(texto(v));
    return /^https?:$/.test(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** A primeira linha que tem texto, cortada sem partir emoji. */
function tituloDe(t: string): string {
  const linha = t.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return cortarSemPartirCaractere(linha.replace(/\s+/g, ' '), TETO_DO_TITULO);
}

/**
 * Um item do dataset como post. `null` quando não é post: sem URL pública, ou
 * o marcador que o actor do X devolve quando o perfil não tem nada
 * (`noResults`).
 */
export function postDoItem(plataforma: PautaPerfilPlataforma, item: Record<string, unknown>): PostDoPerfil | null {
  if (!item || typeof item !== 'object' || item.noResults === true) return null;

  let url: string | null;
  let corpo: string;
  let titulo: string;
  let publicadoEm: Date | null;
  switch (plataforma) {
    case 'instagram':
      url = urlPublica(item.url);
      corpo = texto(item.caption);
      titulo = tituloDe(corpo);
      publicadoEm = lerDataDoPost(item.timestamp);
      break;
    case 'tiktok':
      url = urlPublica(item.webVideoUrl) ?? urlPublica(item.url);
      corpo = texto(item.text);
      titulo = tituloDe(corpo);
      publicadoEm = lerDataDoPost(item.createTimeISO) ?? lerDataDoPost(item.createTime);
      break;
    case 'x':
      url = urlPublica(item.url) ?? urlPublica(item.twitterUrl);
      corpo = primeiroTexto(item, ['fullText', 'text']);
      titulo = tituloDe(corpo);
      publicadoEm = lerDataDoPost(item.createdAt);
      break;
    case 'youtube':
      url = urlPublica(item.url);
      corpo = primeiroTexto(item, ['text', 'description']);
      titulo = cortarSemPartirCaractere(texto(item.title).replace(/\s+/g, ' '), TETO_DO_TITULO) || tituloDe(corpo);
      publicadoEm = lerDataDoPost(item.date) ?? lerDataDoPost(item.uploadDate);
      break;
  }
  if (!url) return null;
  return {
    url,
    titulo: titulo || `Post de ${nomeDaPlataforma(plataforma)}`,
    texto: cortarSemPartirCaractere(corpo, TETO_DO_TEXTO),
    publicadoEm,
  };
}

/** O dataset inteiro, sem o que não é post e sem a mesma URL duas vezes no run. */
export function postsDoPerfil(
  plataforma: PautaPerfilPlataforma,
  itens: ReadonlyArray<Record<string, unknown>>,
): Array<{ post: PostDoPerfil; item: Record<string, unknown> }> {
  const vistos = new Set<string>();
  const saida: Array<{ post: PostDoPerfil; item: Record<string, unknown> }> = [];
  for (const item of itens) {
    const post = postDoItem(plataforma, item);
    if (!post || vistos.has(post.url)) continue;
    vistos.add(post.url);
    saida.push({ post, item });
  }
  return saida;
}

export interface ProcedenciaDoPerfil {
  plataforma: PautaPerfilPlataforma;
  handle: string;
  texto: string;
}

/**
 * O `bruto` da captura de um post: o item cru do actor (o processamento lê as
 * métricas dele) mais `resumo` e `publicadoEm` — os mesmos campos do RSS e da
 * busca, que a curadoria da rodada lê — e a procedência em `perfil`.
 */
export function brutoDoPost(
  post: PostDoPerfil,
  item: Record<string, unknown>,
  plataforma: PautaPerfilPlataforma,
  handle: string,
): Record<string, unknown> {
  return {
    ...item,
    resumo: post.texto ? cortarSemPartirCaractere(post.texto, TETO_DO_RESUMO) : null,
    publicadoEm: post.publicadoEm?.toISOString() ?? null,
    perfil: { plataforma, handle, texto: post.texto } satisfies ProcedenciaDoPerfil,
  };
}

export function procedenciaDoPerfil(bruto: unknown): ProcedenciaDoPerfil | null {
  const p = bruto && typeof bruto === 'object' ? (bruto as { perfil?: unknown }).perfil : null;
  if (!p || typeof p !== 'object') return null;
  const { plataforma, handle, texto: t } = p as Record<string, unknown>;
  const plat = typeof plataforma === 'string' ? plataformaDoPerfil(plataforma) : null;
  if (!plat || typeof handle !== 'string') return null;
  return { plataforma: plat, handle, texto: typeof t === 'string' ? t : '' };
}

/**
 * O texto que o processamento manda para a IA quando a captura veio de um
 * perfil do X ou do YouTube: o post já foi lido na coleta, e abrir o link de
 * novo daria a tela de login do X ou o HTML inteiro do YouTube.
 */
export function textoDoPost(bruto: unknown): string {
  const p = procedenciaDoPerfil(bruto);
  if (!p) return '';
  const b = bruto as Record<string, unknown>;
  const cabecalho = [`Autor: @${p.handle} (${nomeDaPlataforma(p.plataforma)})`];
  if (typeof b.publicadoEm === 'string') cabecalho.push(`Publicado em: ${b.publicadoEm}`);
  if (typeof b.title === 'string' && b.title.trim()) cabecalho.push(`Título: ${b.title.trim()}`);
  return p.texto ? `${cabecalho.join('\n')}\n\n${p.texto}` : cabecalho.join('\n');
}

/**
 * Processar troca o `bruto` pela leitura do link (Instagram e TikTok rodam o
 * actor de novo). O que a coleta do perfil gravou atravessa, porque a rodada
 * também lê captura que já virou ficha.
 */
export function comProcedenciaDoPerfil(anterior: unknown, novo: unknown): unknown {
  if (!procedenciaDoPerfil(anterior)) return novo;
  const antes = anterior as Record<string, unknown>;
  const depois = novo && typeof novo === 'object' ? (novo as Record<string, unknown>) : {};
  return { ...depois, resumo: antes.resumo ?? null, publicadoEm: antes.publicadoEm ?? null, perfil: antes.perfil };
}
