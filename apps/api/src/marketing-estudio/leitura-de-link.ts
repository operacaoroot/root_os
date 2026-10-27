import { buscarPaginaPublica, lerCorpoComTeto } from '../pauta/pagina-publica';

/*
 * Leitura pública de um link (título, descrição, imagem, autor), portada do
 * `fetchMeta` do Estúdio V1. Usa a busca do OS que confere o destino a cada
 * salto (nada de endereço interno). Nunca lança: o que não der para ler fica vazio.
 */

export interface MetaDoLink {
  url: string;
  titulo: string;
  descricao: string;
  imagem: string | null;
  autor: string | null;
}

const limpo = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const RESERVADOS = new Set(['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'watch', 'shorts', 'channel', 'c', 'user', 'video']);

/** As entidades nomeadas que os feeds RSS em português mais usam. */
const NOMEADAS: Record<string, string> = {
  nbsp: ' ', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', hellip: '…', ndash: '-', mdash: ',', laquo: '«', raquo: '»',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', acirc: 'â', ecirc: 'ê', ocirc: 'ô', atilde: 'ã', otilde: 'õ',
  agrave: 'à', ccedil: 'ç', uuml: 'ü',
};

/** Texto de feed ou página: tira as tags HTML e decodifica as entidades. */
export const textoLimpo = (s: string): string => entidades(String(s ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

export function entidades(s: string): string {
  return s
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, nome: string) => NOMEADAS[nome.toLowerCase()] ?? m);
}

function meta(html: string, nome: string): string {
  const rx = new RegExp(`<meta[^>]+(?:property|name)=["']${nome.replace(':', '\\:')}["'][^>]*>`, 'i');
  const tag = rx.exec(html)?.[0];
  if (!tag) return '';
  return entidades(/content=["']([^"']*)["']/i.exec(tag)?.[1] ?? '');
}

/** @ do criador no Instagram a partir da URL (/<perfil>/p/…) ou do og:title/og:description. */
export function autorDoInstagram(url: string, ogTitulo = '', ogDescricao = ''): string | null {
  let primeiro = '';
  try {
    primeiro = new URL(url).pathname.split('/').filter(Boolean)[0] ?? '';
  } catch {
    primeiro = '';
  }
  if (primeiro && !RESERVADOS.has(primeiro.toLowerCase()) && /^[\w.]{1,30}$/.test(primeiro)) return '@' + primeiro;
  const m = /[-–]\s*@?([\w.]{2,30})\s+(?:on|em|no)\s/i.exec(ogDescricao) || /\(@([\w.]{2,30})\)/.exec(ogTitulo) || /@([\w.]{2,30})/.exec(`${ogTitulo} ${ogDescricao}`);
  return m ? '@' + m[1] : null;
}

export async function lerMetaDoLink(url: string): Promise<MetaDoLink> {
  const m: MetaDoLink = { url, titulo: '', descricao: '', imagem: null, autor: null };
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return m;
  }
  // Só a página pública que a pessoa colou (og:title, og:image, autor). O oEmbed do YouTube e
  // do TikTok, que o Estúdio usava, é endpoint de fornecedor: pela regra do OS ele mora no
  // conector, e a página já traz o que a nota precisa.
  const youtube = /(^|\.)youtube\.com$|^youtu\.be$/.test(host);
  try {
    const r = await buscarPaginaPublica(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; RootOS/1.0)', ...(youtube ? { cookie: 'CONSENT=YES+1; SOCS=CAI' } : {}) },
      signal: AbortSignal.timeout(12_000),
    });
    if (r.ok) {
      const html = await lerCorpoComTeto(r);
      const titulo = meta(html, 'og:title') || meta(html, 'twitter:title') || entidades(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? '');
      m.titulo ||= limpo(titulo, 300);
      m.descricao = limpo(meta(html, 'og:description') || meta(html, 'twitter:description') || meta(html, 'description'), 1500);
      const img = meta(html, 'og:image') || meta(html, 'twitter:image');
      if (!m.imagem && img) {
        try {
          m.imagem = new URL(img, url).href;
        } catch {
          /* imagem com endereço quebrado */
        }
      }
      if (!m.autor) {
        if (/(^|\.)instagram\.com$/.test(host)) m.autor = autorDoInstagram(url, meta(html, 'og:title'), meta(html, 'og:description'));
        else m.autor = limpo(meta(html, 'author') || meta(html, 'article:author') || meta(html, 'twitter:creator') || meta(html, 'og:site_name'), 120) || null;
      }
    }
  } catch {
    /* página bloqueada ou fora do ar: segue com o que tem */
  }
  if (!m.autor && /(^|\.)instagram\.com$/.test(host)) m.autor = autorDoInstagram(url);
  if (!m.titulo) m.titulo = m.descricao.slice(0, 140) || `${host}`;
  return m;
}

/** Baixa um arquivo público (o vídeo que o Apify devolveu) até `teto` bytes. Passou do teto = null. */
export async function baixarAte(url: string, teto: number): Promise<{ dados: Buffer; tipo: string } | null> {
  const r = await buscarPaginaPublica(url, { signal: AbortSignal.timeout(120_000), headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!r.ok || !r.body) throw new Error(`O vídeo não pôde ser baixado (${r.status}).`);
  const tamanho = Number(r.headers.get('content-length') ?? 0);
  if (tamanho && tamanho > teto) {
    await r.body.cancel().catch(() => undefined);
    return null;
  }
  const partes: Buffer[] = [];
  let total = 0;
  const leitor = r.body.getReader();
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.length;
    if (total > teto) {
      await leitor.cancel().catch(() => undefined);
      return null;
    }
    partes.push(Buffer.from(value));
  }
  return { dados: Buffer.concat(partes), tipo: (r.headers.get('content-type') ?? 'video/mp4').split(';')[0].trim() };
}

/** Lê o primeiro objeto JSON de uma resposta da IA (com ou sem cerca ```json). */
export function jsonDaIa<T = Record<string, unknown>>(texto: string): T {
  const semCerca = texto.replace(/```(?:json)?/gi, '');
  const ini = semCerca.indexOf('{');
  const fim = semCerca.lastIndexOf('}');
  if (ini < 0 || fim <= ini) throw new Error('A IA não devolveu JSON.');
  return JSON.parse(semCerca.slice(ini, fim + 1)) as T;
}
