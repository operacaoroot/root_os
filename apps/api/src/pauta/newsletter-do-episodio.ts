import { createHash } from 'node:crypto';
import {
  PAUTA_MARCADOR_DA_PAGINA_DE_LINKS,
  PAUTA_MARCADOR_DO_VIDEO,
  PAUTA_PALAVRAS_POR_PARAGRAFO,
  PAUTA_REGRA_ANTI_SLOP_ROTULO,
  checagemAntiSlop,
  semEmoji,
  type PautaChecagemAntiSlop,
  type PautaItemCurado,
} from '@mktos/shared';
import { parseJsonDaIa } from './parse-json';
import { linkDoPacote, transcricaoParaOPrompt, type Segmento } from './pacote-do-episodio';

/*
 * ============================================================================
 * A NEWSLETTER DO EPISÓDIO (MC13) — a parte pura
 * ============================================================================
 *
 * A newsletter sai do que foi DITO no vídeo: o modelo recebe a transcrição e
 * as matérias numeradas e devolve JSON com o título, a abertura, uma seção por
 * matéria falada e o fechamento; o markdown é montado aqui. Como no roteiro e
 * no pacote, três coisas não ficam com a IA:
 *
 *  - o LINK de cada seção sai do item pelo número (a newsletter de origem L,
 *    cujo "link" é o permalink da caixa de entrada, nunca entra);
 *  - a CHAMADA final para a página de links e para o vídeo é do sistema, com
 *    marcadores que viram endereço quando a página estiver no ar e o vídeo
 *    tiver link;
 *  - a CHECAGEM anti-slop (`checagemAntiSlop`, shared) decide se refaz.
 *
 * Emoji e palavra proibida NÃO são limpos do que o modelo escreveu: a checagem
 * tem de vê-los para pedir a reescrita, e o que sobrar fica apontado na tela.
 * A checagem, por sua vez, só olha o que o modelo escreveu (`checagemDaNewsletter`):
 * a linha da fonte e as chamadas finais são do sistema, e o título do item que
 * entra nelas perde o emoji na montagem.
 */

const SYSTEM_NEWSLETTER_BASE = `Você transforma o episódio semanal em vídeo da ROOT, uma comunidade brasileira sobre IA
aplicada a negócios, na newsletter da semana. Quem lê toca uma pequena ou média empresa e lê no celular.

A newsletter é o que FOI DITO no vídeo, por escrito — não um texto novo. Recebe as matérias do
episódio, numeradas, e a TRANSCRIÇÃO do vídeo final, com o tempo de cada trecho entre colchetes.

Responda SOMENTE com um objeto JSON válido, sem cercas de código:
{
  "titulo": string,        // até 90 caracteres, o que a edição entrega
  "abertura": string,      // 2 a 3 frases tiradas da abertura do vídeo
  "secoes": [              // uma por matéria FALADA no vídeo, na ordem em que aparece na fala
    {
      "n": number,         // o número da matéria na lista
      "titulo": string,    // até 70 caracteres
      "texto": string      // 1 a 3 parágrafos curtos, separados por linha em branco
    }
  ],
  "fechamento": string     // 1 a 2 frases tiradas do fechamento do vídeo
}

Regras:
- Use as FRASES DITAS: copie os trechos da transcrição quase como foram falados, tirando só vício
  de fala ("né", "tipo", "então"), repetição e frase interrompida. Não troque por palavras suas.
- Use SOMENTE o que está na transcrição e nas matérias. Nunca invente notícia, número, nome ou URL.
- Matéria que não aparece na fala não ganha seção.
- Não escreva URL nem link: o link de cada matéria e a chamada para a página de links e para o
  vídeo entram sozinhos.
- Cada parágrafo tem no máximo ${PAUTA_PALAVRAS_POR_PARAGRAFO - 15} palavras: é lido no celular.
- Sem emoji, sem subtítulo dentro do texto, sem lista, sem negrito.
- Não abra com "Neste artigo", "Vamos explorar", "Em um mundo cada vez mais" nem nada que soe a
  texto de IA: comece pelo que aconteceu.`;

/** O prompt da newsletter com o bloco de voz da empresa (MC10). */
/** A marca (MK1) antes da voz (MC10), como no roteiro. Marca vazia não muda nada. */
export function systemDaNewsletter(voz: string, marca = ''): string {
  return [SYSTEM_NEWSLETTER_BASE, marca.trim(), voz.trim()].filter(Boolean).join('\n\n');
}

function umaLinha(v: unknown, teto: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, teto) : '';
}

/** O pedido ao modelo: as matérias numeradas (sem link) e a transcrição com os tempos. */
export function entradaDaNewsletter(e: {
  apelido: string;
  titulo: string;
  itens: readonly PautaItemCurado[];
  segmentos: readonly Segmento[];
}): string {
  const materias = e.itens.map((i, idx) => {
    const partes = [`[${idx + 1}] ${umaLinha(i.titulo, 300)}`];
    const resumo = umaLinha(i.resumo || i.porque, 400);
    if (resumo) partes.push(`    resumo: ${resumo}`);
    return partes.join('\n');
  });
  const t = transcricaoParaOPrompt(e.segmentos);
  return [
    `Episódio: ${e.apelido} · ${umaLinha(e.titulo, 160)}`,
    '',
    `Matérias do episódio (${e.itens.length}):`,
    '',
    materias.join('\n') || '(nenhuma)',
    '',
    `Transcrição do vídeo final (${t.blocos} trechos):`,
    '',
    t.texto,
  ].join('\n');
}

/** O pedido de reescrita, com o que a checagem apontou na primeira versão. */
export function pedidoDeReescrita(checagem: PautaChecagemAntiSlop): string {
  const linhas = checagem.apontamentos.map((a) => `- ${PAUTA_REGRA_ANTI_SLOP_ROTULO[a.regra]}: "${a.trecho}" (${a.onde})`);
  return [
    '',
    'A versão anterior foi REPROVADA na checagem da casa:',
    ...linhas,
    'Escreva de novo corrigindo cada ponto, com as mesmas frases ditas e o mesmo JSON.',
  ].join('\n');
}

/** A IA não devolveu nada utilizável: nada é gravado. */
export class NewsletterInvalidaError extends Error {
  constructor(motivo: string) {
    super(`A IA não devolveu uma newsletter utilizável (${motivo}) — nada foi gravado. Tente de novo.`);
    this.name = 'NewsletterInvalidaError';
  }
}

const URL_NO_TEXTO = /<?\b(?:https?:\/\/|www\.)[^\s>)]+>?/gi;
/** Link de markdown de qualquer esquema (`//host`, `mailto:`…) e imagem: fica só o rótulo. */
const LINK_DE_MARKDOWN = /!?\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g;
const MARCADOR = /\{\{[^}]*\}\}/g;
const TEM_MARCADOR = /\{\{[^}]*\}\}/;

function semLinkNemMarcador(s: string): string {
  return s.replace(LINK_DE_MARKDOWN, '$1').replace(URL_NO_TEXTO, ' ').replace(MARCADOR, ' ');
}

/** Um título que veio do modelo: uma linha, sem link, URL, marcador nem o `#` do markdown. */
export function tituloDaNewsletter(v: unknown, teto: number): string {
  if (typeof v !== 'string') return '';
  return umaLinha(semLinkNemMarcador(v), 10_000).replace(/^#+\s*/, '').slice(0, teto).trim();
}

/**
 * Texto de parágrafos que veio do modelo: sem URL (o link sai do item), sem
 * marcador (só o sistema põe), sem subtítulo nem lista (a estrutura é do
 * sistema), com os parágrafos preservados.
 */
export function textoDaNewsletter(v: unknown, teto: number): string {
  if (typeof v !== 'string') return '';
  return semLinkNemMarcador(v.replace(/\r\n?/g, '\n'))
    .split(/\n\s*\n/)
    .map((p) =>
      p
        .split('\n')
        .map((l) => l.replace(/^\s*(?:#{1,6}|[-*+]|\d+[.)])\s+/, '').replace(/[ \t]+/g, ' ').trim())
        .filter(Boolean)
        .join(' '),
    )
    .filter(Boolean)
    .join('\n\n')
    .slice(0, teto)
    .trim();
}

/** O texto de um link de markdown: sem colchete, que fecharia o link antes da hora, e sem emoji. */
function rotuloDoLink(s: string): string {
  return semEmoji(umaLinha(s, 160)).replace(/\[/g, '(').replace(/\]/g, ')');
}

/** O título que o sistema põe quando o modelo não deu um: do item ou do episódio, sem emoji. */
function tituloDeReserva(s: string, teto: number): string {
  return semEmoji(tituloDaNewsletter(s, teto));
}

/** A URL dentro de `(...)`: parêntese e espaço escapados. */
function destinoDoLink(url: string): string {
  return url.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
}

export const CHAMADA_DA_PAGINA = `Todos os links do episódio, numa página só: ${PAUTA_MARCADOR_DA_PAGINA_DE_LINKS}`;
export const CHAMADA_DO_VIDEO = `O episódio inteiro, em vídeo: ${PAUTA_MARCADOR_DO_VIDEO}`;

export interface NewsletterMontada {
  titulo: string;
  markdown: string;
  secoes: number;
  links: number;
  /** O que a tela deve saber: matéria sem seção, seção sem fala do vídeo. */
  avisos: string[];
}

/** Lê a resposta do modelo e monta o markdown; erro de formato é `NewsletterInvalidaError`. */
export function montarNewsletter(
  saida: string,
  ctx: { tituloDoEpisodio: string; itens: readonly PautaItemCurado[]; segmentos: readonly Segmento[] },
): NewsletterMontada {
  let bruto: unknown;
  try {
    bruto = parseJsonDaIa<unknown>(saida);
  } catch {
    throw new NewsletterInvalidaError('não veio JSON');
  }
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) throw new NewsletterInvalidaError('não veio um objeto');
  const o = bruto as Record<string, unknown>;

  const vistos = new Set<number>();
  const secoes: Array<{ n: number; titulo: string; texto: string }> = [];
  for (const s of Array.isArray(o.secoes) ? o.secoes : []) {
    if (!s || typeof s !== 'object') continue;
    const r = s as Record<string, unknown>;
    const n = Number(r.n);
    if (!Number.isInteger(n) || n < 1 || n > ctx.itens.length || vistos.has(n)) continue;
    const texto = textoDaNewsletter(r.texto, 2_500);
    if (!texto) continue;
    vistos.add(n);
    const item = ctx.itens[n - 1];
    secoes.push({ n, titulo: tituloDaNewsletter(r.titulo, 70) || tituloDeReserva(item.titulo, 70), texto });
  }
  if (!secoes.length) throw new NewsletterInvalidaError('nenhuma seção de matéria');

  const avisos: string[] = [];
  ctx.itens.forEach((i, idx) => {
    if (!vistos.has(idx + 1)) avisos.push(`A matéria ${idx + 1} (“${umaLinha(i.titulo, 80)}”) ficou sem seção: não apareceu na fala?`);
  });

  const titulo = tituloDaNewsletter(o.titulo, 90) || tituloDeReserva(ctx.tituloDoEpisodio, 90);
  const partes: string[] = [`# ${titulo}`];
  const abertura = textoDaNewsletter(o.abertura, 1_200);
  if (abertura) partes.push(abertura);
  let links = 0;
  for (const s of secoes) {
    partes.push(`## ${s.titulo}`, s.texto);
    const item = ctx.itens[s.n - 1];
    const url = linkDoPacote(item);
    if (url) {
      links++;
      partes.push(`Fonte: [${rotuloDoLink(item.titulo) || url}](${destinoDoLink(url)})`);
    }
    if (frasesDitas(s.texto, ctx.segmentos).ditas === 0) {
      avisos.push(`A seção “${s.titulo}” não usa nenhuma frase dita no vídeo.`);
    }
  }
  const fechamento = textoDaNewsletter(o.fechamento, 800);
  if (fechamento) partes.push(fechamento);
  partes.push(CHAMADA_DA_PAGINA, CHAMADA_DO_VIDEO);
  return { titulo, markdown: partes.join('\n\n'), secoes: secoes.length, links, avisos };
}

const LINHA_DA_FONTE = /^Fonte: \[[^\]]*\]\(https?:\/\/[^\s)]+\)$/;

/**
 * O bloco é do sistema, não do modelo: a linha da fonte (o texto do modelo
 * nunca tem URL, então não chega a casar) e as duas chamadas finais.
 */
export function ehBlocoDoSistema(bloco: string): boolean {
  const b = bloco.trim();
  return b === CHAMADA_DA_PAGINA || b === CHAMADA_DO_VIDEO || LINHA_DA_FONTE.test(b);
}

/** A checagem anti-slop só do que o modelo escreveu: na geração e no painel. */
export function checagemDaNewsletter(markdown: string): PautaChecagemAntiSlop {
  return checagemAntiSlop(markdown, { ignorarBloco: ehBlocoDoSistema });
}

// ---------------------------------------------------------------------------
// As frases ditas: quanto do texto saiu da fala
// ---------------------------------------------------------------------------

/** Tamanho do pedaço comparado: 4 palavras seguidas iguais às da fala. */
const PALAVRAS_DO_PEDACO = 4;
/** Frase mais curta que isso não conta (nem para o total). */
const PALAVRAS_DA_FRASE = 5;

function palavrasNormalizadas(s: string): string[] {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean);
}

function pedacos(palavras: readonly string[]): string[] {
  const saida: string[] = [];
  for (let i = 0; i + PALAVRAS_DO_PEDACO <= palavras.length; i++) saida.push(palavras.slice(i, i + PALAVRAS_DO_PEDACO).join(' '));
  return saida;
}

/**
 * Das frases do texto (5 palavras ou mais), quantas repetem 4 palavras seguidas
 * da fala. Título, linha de link e as chamadas finais não contam: não são fala.
 */
export function frasesDitas(texto: string, segmentos: readonly Segmento[]): { total: number; ditas: number } {
  const daFala = new Set(pedacos(palavrasNormalizadas(segmentos.map((s) => s.texto).join(' '))));
  const linhas = String(texto ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^#/.test(l) && !/^Fonte:/.test(l) && !TEM_MARCADOR.test(l) && !/https?:\/\//i.test(l));
  let total = 0;
  let ditas = 0;
  for (const frase of linhas.join(' ').split(/(?<=[.!?…])\s+/)) {
    const palavras = palavrasNormalizadas(frase);
    if (palavras.length < PALAVRAS_DA_FRASE) continue;
    total++;
    if (pedacos(palavras).some((p) => daFala.has(p))) ditas++;
  }
  return { total, ditas };
}

// ---------------------------------------------------------------------------
// A peça guardada, os marcadores e o HTML
// ---------------------------------------------------------------------------

export const ORIGEM_DA_NEWSLETTER = 'transcricao';

export interface MetaDaNewsletter {
  episodioId: string;
  origem: typeof ORIGEM_DA_NEWSLETTER;
  tentativas: number;
  secoes: number;
  links: number;
  avisos: string[];
  urlDoVideo: string | null;
  /** O hash da transcrição de onde saiu: mídia refeita = newsletter velha. */
  transcricaoSha: string;
}

/** A peça é a newsletter tirada da transcrição (MC13)? Com o id, do episódio certo. */
export function ehNewsletterDaTranscricao(meta: unknown, episodioId?: string): boolean {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return false;
  const m = meta as Record<string, unknown>;
  return m.origem === ORIGEM_DA_NEWSLETTER && typeof m.episodioId === 'string' && (episodioId === undefined || m.episodioId === episodioId);
}

export function lerMetaDaNewsletter(meta: unknown): MetaDaNewsletter {
  const m = (meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  return {
    episodioId: typeof m.episodioId === 'string' ? m.episodioId : '',
    origem: ORIGEM_DA_NEWSLETTER,
    tentativas: num(m.tentativas),
    secoes: num(m.secoes),
    links: num(m.links),
    avisos: Array.isArray(m.avisos) ? m.avisos.filter((a): a is string => typeof a === 'string') : [],
    urlDoVideo: typeof m.urlDoVideo === 'string' && m.urlDoVideo ? m.urlDoVideo : null,
    transcricaoSha: typeof m.transcricaoSha === 'string' ? m.transcricaoSha : '',
  };
}

/** Os 16 primeiros do sha256 dos segmentos: basta para saber se a transcrição mudou. */
export function shaDaTranscricao(segmentos: readonly Segmento[]): string {
  return createHash('sha256').update(JSON.stringify(segmentos)).digest('hex').slice(0, 16);
}

/**
 * Troca os marcadores pelo que já existe: a página só no ar (rascunho responde
 * 404) e o vídeo quando alguém deu o link. O que falta fica com o marcador e
 * volta em `pendentes`, para a tela dizer o que trocar à mão.
 */
export function comOsMarcadores(
  markdown: string,
  o: { paginaNoAr: string | null; urlDoVideo: string | null },
): { markdown: string; pendentes: string[] } {
  let texto = markdown;
  const pendentes: string[] = [];
  if (texto.includes(PAUTA_MARCADOR_DA_PAGINA_DE_LINKS)) {
    if (o.paginaNoAr) texto = texto.split(PAUTA_MARCADOR_DA_PAGINA_DE_LINKS).join(o.paginaNoAr);
    else pendentes.push(`A página de links ainda não está no ar: o marcador ${PAUTA_MARCADOR_DA_PAGINA_DE_LINKS} fica até lá.`);
  }
  if (texto.includes(PAUTA_MARCADOR_DO_VIDEO)) {
    if (o.urlDoVideo) texto = texto.split(PAUTA_MARCADOR_DO_VIDEO).join(o.urlDoVideo);
    else pendentes.push(`Falta o link do vídeo no YouTube: o marcador ${PAUTA_MARCADOR_DO_VIDEO} fica até ele ser informado.`);
  }
  return { markdown: texto, pendentes };
}

function escapar(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const LINK_OU_URL = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(https?:\/\/[^\s<>"'`]+)/g;

/** Uma linha de markdown em HTML: tudo escapado; só link http(s) vira `<a>`. */
function linhaEmHtml(linha: string): string {
  let saida = '';
  let desde = 0;
  for (const m of linha.matchAll(LINK_OU_URL)) {
    const i = m.index ?? 0;
    let url = m[2] ?? m[3];
    let resto = '';
    if (m[3]) {
      const fim = /[.,;:!?]+$/.exec(url);
      if (fim) {
        resto = fim[0];
        url = url.slice(0, -resto.length);
      }
    }
    saida += negrito(escapar(linha.slice(desde, i)));
    saida += `<a href="${escapar(url)}">${escapar(m[1] ?? url)}</a>${escapar(resto)}`;
    desde = i + m[0].length;
  }
  return saida + negrito(escapar(linha.slice(desde)));
}

function negrito(escapado: string): string {
  return escapado.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

/**
 * O HTML simples para colar numa ferramenta de e-mail: título, subtítulos,
 * parágrafos e links, com estilo em linha (e-mail ignora folha de estilo) e
 * largura de celular. Nada do texto passa sem escapar.
 */
export function newsletterEmHtml(markdown: string, titulo: string): string {
  const blocos = markdown
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b) => {
      const h = /^(#{1,3})\s+(.*)$/s.exec(b);
      if (h) {
        const nivel = h[1].length;
        const tamanho = nivel === 1 ? '24px' : nivel === 2 ? '19px' : '17px';
        return `<h${nivel} style="font-size:${tamanho};line-height:1.3;margin:24px 0 8px">${linhaEmHtml(h[2].replace(/\s+/g, ' '))}</h${nivel}>`;
      }
      if (/^-{3,}$/.test(b)) return '<hr style="border:0;border-top:1px solid #ddd;margin:24px 0">';
      const linhas = b.split('\n');
      if (linhas.every((l) => /^[-*]\s+/.test(l))) {
        return `<ul style="padding-left:20px;margin:0 0 16px">${linhas.map((l) => `<li>${linhaEmHtml(l.replace(/^[-*]\s+/, ''))}</li>`).join('')}</ul>`;
      }
      return `<p style="margin:0 0 16px">${linhas.map(linhaEmHtml).join('<br>')}</p>`;
    });
  return [
    '<!doctype html>',
    '<html lang="pt-BR">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapar(titulo)}</title>`,
    '</head>',
    '<body style="margin:0;padding:16px;background:#ffffff;color:#111111">',
    '<div style="max-width:600px;margin:0 auto;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6">',
    ...blocos,
    '</div>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}
