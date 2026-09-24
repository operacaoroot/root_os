import { createHash } from 'node:crypto';
import {
  PAUTA_CORTE_MAXIMO_SEG,
  PAUTA_CORTE_MINIMO_SEG,
  PAUTA_FORMATOS_DA_SEMANA,
  PAUTA_SLIDES_MAXIMO,
  PAUTA_SLIDES_MINIMO,
  PAUTA_TETO_DA_CHAMADA_DO_STORY,
  PAUTA_TETO_DA_LEGENDA,
  PAUTA_TETO_DO_TEXTO_DO_SLIDE,
  PAUTA_TETO_DO_TEXTO_DO_STORY,
  PAUTA_TETO_DO_TITULO_DA_PECA,
  PAUTA_TETO_DO_TITULO_DO_SLIDE,
  conferirTrechoDoCorte,
  semEmoji,
  tempoDoCapitulo,
  type PautaCtaDoCarrossel,
  type PautaFormatoDaSemana,
  type PautaItemCurado,
  type PautaPecaStatus,
  type PautaSlideDaSemana,
} from '@mktos/shared';
import { parseJsonDaIa } from './parse-json';
import { semLinksDeCaixaDeEntrada } from './link-publico';
import type { Segmento } from './pacote-do-episodio';

/*
 * ============================================================================
 * A SEMANA DE POSTS (MC15) — a derivação por notícia, a parte pura
 * ============================================================================
 *
 * Cada matéria mantida do episódio vira três peças: um carrossel, um story e o
 * roteiro de um corte vertical. Uma chamada ao modelo POR MATÉRIA (não uma por
 * rodada, como a derivação antiga): o modelo recebe a matéria, sem link, e a
 * transcrição numerada por segmento, e devolve o texto das três. Como no
 * roteiro, no pacote e na newsletter, o que não fica com a IA:
 *
 *  - o TRECHO do corte: o modelo escolhe os segmentos (de/até, pelo número), e
 *    o tempo sai dos segmentos reais, conferido aqui (`trechoDoCorte`: dentro da
 *    duração, na ordem, menos de 3 min e pelo menos 10 s);
 *  - o CTA do último slide e a PALAVRA-CHAVE única no episódio (o DM do MC18
 *    casa a palavra com a matéria);
 *  - o LINK: o prompt não leva URL nenhuma, e todo endereço que o modelo
 *    escrever sai do texto. O link da matéria vai na meta pela regra única
 *    (`link-publico.ts`) e é nulo para a newsletter.
 */

const SYSTEM_DERIVACAO_BASE = `Você transforma UMA matéria do episódio semanal em vídeo da ROOT, uma comunidade brasileira sobre
IA aplicada a negócios, em três peças para o Instagram e o TikTok. Quem lê toca uma pequena ou média
empresa e lê no celular.

Recebe a matéria e a TRANSCRIÇÃO do vídeo final, um segmento por linha, numerado, com o tempo.

Responda SOMENTE com um objeto JSON válido, sem cercas de código:
{
  "carrossel": {
    "titulo": string,          // até 90 caracteres, o nome interno da peça
    "palavraChave": string,    // UMA palavra, sem acento, que quem comentar recebe o link (ex.: AGENTES)
    "slides": [                // de 4 a 8 slides; o 1 é a capa. NÃO escreva o slide de CTA: ele entra sozinho
      { "titulo": string,      // até 90 caracteres
        "texto": string }      // até 240 caracteres; na capa pode ficar vazio
    ],
    "legenda": string          // até 1.500 caracteres, sem hashtag de enfeite
  },
  "story": {
    "texto": string,           // até 180 caracteres, o que muda em uma frase
    "chamada": string          // até 90 caracteres, chamando para o episódio completo
  },
  "corte": {
    "titulo": string,          // até 100 caracteres, o gancho que aparece na tela
    "legenda": string,         // até 600 caracteres
    "de": number,              // o NÚMERO do segmento onde o corte começa
    "ate": number              // o NÚMERO do segmento onde o corte termina
  }
}

Regras:
- Use SOMENTE a matéria e a transcrição. Nunca invente notícia, número, nome ou URL.
- Não escreva URL nem link em lugar nenhum: o link da matéria vai por outro caminho.
- O corte é o trecho do vídeo em que ESTA matéria é falada, de uma frase inteira até outra: comece
  num segmento que abre o assunto e termine num que fecha a ideia. Tem entre ${PAUTA_CORTE_MINIMO_SEG} segundos e menos
  de ${PAUTA_CORTE_MAXIMO_SEG / 60} minutos.
- Sem emoji. Frases curtas, para ler no celular.`;

/** O prompt da derivação com o bloco de voz da empresa (MC10). */
export function systemDaDerivacao(voz: string): string {
  return `${SYSTEM_DERIVACAO_BASE}\n\n${voz.trim()}`;
}

function umaLinha(v: unknown, teto: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, teto) : '';
}

/** Teto da transcrição numerada no prompt: cada matéria é uma chamada, e todas levam o vídeo inteiro. */
export const TETO_DOS_SEGMENTOS_NO_PROMPT = 40_000;

/**
 * Os segmentos numerados, `#n [mm:ss–mm:ss] texto`. Longa demais, a fala de
 * cada segmento é encurtada — o número e o tempo nunca: é deles que o corte sai,
 * e a matéria falada no fim do vídeo precisa dos últimos segmentos. O espaço da
 * fala é o que sobra do teto depois do prefixo REAL de cada linha; se nem o
 * prefixo couber, a fala sai inteira da lista e ficam só `#n [t–t]` (o teto
 * cede, a lista não).
 */
export function segmentosParaOPrompt(
  segmentos: readonly Segmento[],
  teto = TETO_DOS_SEGMENTOS_NO_PROMPT,
): { texto: string; encurtado: boolean } {
  const comHoras = segmentos.some((s) => s.fim >= 3600);
  const prefixos = segmentos.map((s, i) => `#${i + 1} [${tempoDoCapitulo(s.inicio, comHoras)}–${tempoDoCapitulo(s.fim, comHoras)}]`);
  const juntar = (tetoDaFala: number) =>
    segmentos
      .map((s, i) => {
        const fala = tetoDaFala > 0 ? umaLinha(s.texto, tetoDaFala).trim() : '';
        return fala ? `${prefixos[i]} ${fala}` : prefixos[i];
      })
      .join('\n');
  const inteiro = juntar(2_000);
  if (inteiro.length <= teto) return { texto: inteiro, encurtado: false };
  // Cada linha: o prefixo, um espaço, a fala e a quebra de linha.
  const fixo = prefixos.reduce((t, p) => t + p.length + 2, 0);
  const porLinha = Math.floor((teto - fixo) / Math.max(1, segmentos.length));
  return { texto: juntar(porLinha >= 8 ? porLinha : 0), encurtado: true };
}

/** O pedido de UMA matéria: o que ela é (sem link) e a transcrição numerada. */
export function entradaDaDerivacao(e: {
  apelido: string;
  titulo: string;
  item: PautaItemCurado;
  n: number;
  total: number;
  segmentos: readonly Segmento[];
  duracaoSeg: number;
}): string {
  const partes = [`Matéria ${e.n} de ${e.total}: ${umaLinha(semLinksDaIa(e.item.titulo ?? ''), 300)}`];
  const resumo = umaLinha(e.item.resumo || e.item.porque, 500);
  if (resumo) partes.push(`Resumo: ${semLinksDaIa(resumo)}`);
  const gancho = umaLinha(e.item.ganchoBr, 300);
  if (gancho) partes.push(`Para o Brasil: ${semLinksDaIa(gancho)}`);
  const fonte = umaLinha(e.item.fonte, 120);
  if (fonte) partes.push(`Fonte: ${semLinksDaIa(fonte)}`);
  const t = segmentosParaOPrompt(e.segmentos);
  return [
    `Episódio: ${e.apelido} · ${umaLinha(semLinksDaIa(e.titulo ?? ''), 160)}`,
    '',
    ...partes,
    '',
    `Transcrição do vídeo final (${e.segmentos.length} segmentos, ${tempoDoCapitulo(e.duracaoSeg, e.duracaoSeg >= 3600)} de vídeo)` +
      (t.encurtado ? ' — a fala de cada segmento vem encurtada:' : ':'),
    '',
    t.texto,
  ].join('\n');
}

/** A IA não devolveu nada utilizável para a matéria: nada dela é gravado. */
export class DerivacaoInvalidaError extends Error {
  constructor(motivo: string) {
    super(`A IA não devolveu peças utilizáveis (${motivo}).`);
    this.name = 'DerivacaoInvalidaError';
  }
}

// O `https` colado em letra também sai ("vejahttps://…"); o `www.` só no começo de palavra.
const URL_NO_TEXTO = /<?(?:https?:\/\/|\bwww\.)[^\s>)]+>?/gi;
const LINK_DE_MARKDOWN = /!?\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g;
const MARCADOR = /\{\{[^}]*\}\}/g;

/** Sem link de markdown (fica o rótulo), sem URL solta e sem marcador. */
function semLinksDaIa(s: string): string {
  return s.replace(LINK_DE_MARKDOWN, '$1').replace(URL_NO_TEXTO, ' ').replace(MARCADOR, ' ');
}

/** Um texto de uma linha que veio do modelo: sem link, sem emoji, sem o `#` do markdown. */
export function linhaDaIa(v: unknown, teto: number): string {
  if (typeof v !== 'string') return '';
  return semEmoji(umaLinha(semLinksDaIa(v), 10_000)).replace(/^#+\s*/, '').slice(0, teto).trim();
}

/** Um texto de parágrafos que veio do modelo: sem link e sem emoji, com as quebras de parágrafo. */
export function textoDaIa(v: unknown, teto: number): string {
  if (typeof v !== 'string') return '';
  return semLinksDaIa(v.replace(/\r\n?/g, '\n'))
    .split(/\n\s*\n/)
    .map((p) => semEmoji(p.replace(/\s+/g, ' ')).trim())
    .filter(Boolean)
    .join('\n\n')
    .slice(0, teto)
    .trim();
}

// ---------------------------------------------------------------------------
// A palavra-chave e o CTA
// ---------------------------------------------------------------------------

const PALAVRAS_VAZIAS = new Set(['PARA', 'COMO', 'QUE', 'COM', 'UMA', 'DOS', 'DAS', 'NOS', 'NAS', 'MAIS', 'SOBRE', 'ENTRE', 'ESTA', 'ESSE', 'ESSA', 'ISSO']);

function normalizarPalavra(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * A palavra do CTA: a do modelo normalizada (maiúscula, sem acento, 3 a 20
 * letras); sem ela, a primeira palavra forte do título da matéria; sem essa,
 * LINK.
 */
export function palavraChaveDe(v: unknown, tituloDaMateria: string): string {
  const doModelo = typeof v === 'string' ? normalizarPalavra(v.trim().split(/\s+/)[0] ?? '') : '';
  if (doModelo.length >= 3 && doModelo.length <= 20) return doModelo;
  for (const p of String(tituloDaMateria ?? '').split(/\s+/)) {
    const w = normalizarPalavra(p);
    if (w.length >= 4 && w.length <= 20 && !PALAVRAS_VAZIAS.has(w) && !/^\d+$/.test(w)) return w;
  }
  return 'LINK';
}

/**
 * A palavra que nenhuma outra matéria do episódio usa: repetida, ganha o número
 * da matéria no fim (AGENTES → AGENTES2), cabendo nos 20.
 */
export function palavraUnica(palavra: string, usadas: Iterable<string>, n: number): string {
  const ocupadas = new Set([...usadas].map((u) => u.toUpperCase()));
  if (!ocupadas.has(palavra)) return palavra;
  for (let k = n; k < n + 1000; k++) {
    const sufixo = String(k);
    const candidata = `${palavra.slice(0, 20 - sufixo.length)}${sufixo}`;
    if (!ocupadas.has(candidata)) return candidata;
  }
  return palavra;
}

/**
 * O fechamento da máquina de carrossel (`cta: {instrucao, palavra, beneficio}`).
 * Sem segunda pessoa, como a voz da marca pede.
 */
export function ctaDoCarrossel(palavra: string): PautaCtaDoCarrossel {
  return {
    instrucao: 'Comentário com a palavra',
    palavra,
    beneficio: 'O link da matéria e o episódio completo chegam no direct.',
  };
}

/** O slide do CTA no formato que o export do carrossel já produz (`{titulo, texto}`). */
export function slideDoCta(palavra: string): PautaSlideDaSemana {
  return {
    titulo: `Palavra-chave: ${palavra}`,
    texto: `Comentário com ${palavra} → o link da matéria e o episódio completo chegam no direct.`,
  };
}

/** A linha do CTA que fecha a legenda. */
export function linhaDoCtaNaLegenda(palavra: string): string {
  return `Comentário com ${palavra} → o link da matéria e o episódio completo no direct.`;
}

const VERBO_DE_COMENTAR = /\bCOMENT(?:E|A|AR|EM|ARIO|ARIOS)\b/;

/**
 * O slide que o modelo escreveu como CTA apesar do pedido: fala em comentar
 * (a palavra inteira, não um pedaço) E traz a palavra-chave inteira. Só um dos
 * dois não basta — a palavra costuma ser o assunto da matéria, e o último
 * slide de conteúdo fala dela.
 */
function ehSlideDeCta(s: PautaSlideDaSemana, palavra: string): boolean {
  const t = ` ${normalizarComEspacos(`${s.titulo} ${s.texto}`)} `;
  return VERBO_DE_COMENTAR.test(t) && palavra.length >= 3 && t.includes(` ${palavra} `);
}

/** Maiúscula, sem acento, e o que não é letra nem número vira UM espaço. */
function normalizarComEspacos(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/** Os slides de conteúdo do modelo: limpos, sem o CTA dele (no máximo o último), cortados no máximo. */
export function slidesDoModelo(v: unknown, palavra: string): PautaSlideDaSemana[] {
  if (!Array.isArray(v)) return [];
  const limpos = v
    .map((s) => (s && typeof s === 'object' ? (s as Record<string, unknown>) : {}))
    .map((s) => ({ titulo: linhaDaIa(s.titulo, PAUTA_TETO_DO_TITULO_DO_SLIDE), texto: linhaDaIa(s.texto, PAUTA_TETO_DO_TEXTO_DO_SLIDE) }))
    .filter((s) => s.titulo || s.texto);
  if (limpos.length > 1 && ehSlideDeCta(limpos[limpos.length - 1], palavra)) limpos.pop();
  return limpos.slice(0, PAUTA_SLIDES_MAXIMO - 1);
}

export interface CarrosselMontado {
  titulo: string;
  /** A legenda. */
  corpo: string;
  /** Os slides de conteúdo + o do CTA no fim. */
  slides: PautaSlideDaSemana[];
  cta: PautaCtaDoCarrossel;
  palavraChave: string;
}

/**
 * A legenda (do carrossel ou do corte) fechada pela linha do CTA, uma vez só:
 * a linha antiga, de qualquer palavra, sai antes. Cabe no teto da legenda.
 */
export function legendaComCta(legenda: string, palavra: string): string {
  const linha = linhaDoCtaNaLegenda(palavra);
  const semCta = legenda
    .split('\n')
    .filter((l) => !/^Comentário com [A-Z0-9]{3,20} →/.test(l.trim()))
    .join('\n')
    .trim();
  const cabe = semCta.slice(0, Math.max(0, PAUTA_TETO_DA_LEGENDA - linha.length - 2)).trim();
  return cabe ? `${cabe}\n\n${linha}` : linha;
}

/** Os slides de conteúdo e a legenda com a palavra de verdade: o CTA no último slide e no fim da legenda. */
export function carrosselComPalavra(
  base: { titulo: string; legenda: string; slides: readonly PautaSlideDaSemana[] },
  palavra: string,
): CarrosselMontado {
  return {
    titulo: base.titulo,
    corpo: legendaComCta(base.legenda, palavra),
    slides: [...base.slides, slideDoCta(palavra)],
    cta: ctaDoCarrossel(palavra),
    palavraChave: palavra,
  };
}

// ---------------------------------------------------------------------------
// O trecho do corte
// ---------------------------------------------------------------------------

export interface TrechoDoCorte {
  inicio: number;
  fim: number;
  /** Os segmentos, contados de 1. */
  de: number;
  ate: number;
  trecho: string;
  avisos: string[];
}

const arred = (x: number) => Math.round(x * 1000) / 1000;

/** O que é dito entre dois tempos: os segmentos que caem no trecho, sem link de caixa de entrada. */
export function falaDoTrecho(segmentos: readonly Segmento[], inicio: number, fim: number, teto = 1_200): string {
  return semLinksDeCaixaDeEntrada(
    segmentos
      .filter((s) => s.fim > inicio + 0.01 && s.inicio < fim - 0.01)
      .map((s) => s.texto.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' '),
  ).slice(0, teto);
}

/**
 * Os números (contados de 1) do primeiro e do último segmento que caem num
 * trecho em segundos — o `de`/`até` de um corte editado à mão. Nenhum = vazio.
 */
export function numerosDoTrecho(segmentos: readonly Segmento[], inicio: number, fim: number): { de?: number; ate?: number } {
  let de: number | undefined;
  let ate: number | undefined;
  segmentos.forEach((s, i) => {
    if (s.fim > inicio + 0.01 && s.inicio < fim - 0.01) {
      de ??= i + 1;
      ate = i + 1;
    }
  });
  return { de, ate };
}

/**
 * O trecho que a IA escolheu, conferido: `de` e `ate` são números de segmento
 * que existem, na ordem; o tempo sai dos segmentos reais e fica dentro do
 * vídeo. Passou de 3 min, encurta pelo fim (segmento a segmento); abaixo de
 * 10 s, cresce para frente e depois para trás. O que não fecha nem assim é
 * recusado com o porquê — e o corte da matéria não é gravado.
 */
export function trechoDoCorte(
  escolha: { de?: unknown; ate?: unknown },
  segmentos: readonly Segmento[],
  duracaoSeg: number,
): { ok: true; corte: TrechoDoCorte } | { ok: false; motivo: string } {
  const total = segmentos.length;
  if (!total) return { ok: false, motivo: 'o episódio não tem transcrição' };
  const de = Number(escolha.de);
  const ate = Number(escolha.ate);
  if (!Number.isInteger(de) || !Number.isInteger(ate)) {
    return { ok: false, motivo: 'o corte não veio com os números dos segmentos (de/até)' };
  }
  if (de < 1 || ate < 1 || de > total || ate > total) {
    return { ok: false, motivo: `o corte aponta segmento que não existe (de ${de} até ${ate}; são ${total})` };
  }
  if (ate < de) return { ok: false, motivo: `o corte está fora de ordem (de ${de} até ${ate})` };

  const fimDoVideo = Number.isFinite(duracaoSeg) && duracaoSeg > 0 ? duracaoSeg : segmentos[total - 1].fim;
  const inicioDe = (i: number) => segmentos[i - 1].inicio;
  const fimDe = (i: number) => Math.min(segmentos[i - 1].fim, fimDoVideo);
  const avisos: string[] = [];
  let a = de;
  let b = ate;
  if (inicioDe(a) >= fimDoVideo) return { ok: false, motivo: 'o corte começa depois do fim do vídeo' };

  if (fimDe(b) - inicioDe(a) >= PAUTA_CORTE_MAXIMO_SEG) {
    while (b > a && fimDe(b) - inicioDe(a) >= PAUTA_CORTE_MAXIMO_SEG) b--;
    if (fimDe(b) - inicioDe(a) >= PAUTA_CORTE_MAXIMO_SEG) {
      return { ok: false, motivo: `o segmento ${a} sozinho passa de ${PAUTA_CORTE_MAXIMO_SEG / 60} minutos` };
    }
    avisos.push(`O corte escolhido passava de ${PAUTA_CORTE_MAXIMO_SEG / 60} minutos: terminou no segmento ${b} em vez do ${ate}.`);
  }
  if (fimDe(b) - inicioDe(a) < PAUTA_CORTE_MINIMO_SEG) {
    while (b < total && fimDe(b) - inicioDe(a) < PAUTA_CORTE_MINIMO_SEG && fimDe(b + 1) - inicioDe(a) < PAUTA_CORTE_MAXIMO_SEG) b++;
    while (a > 1 && fimDe(b) - inicioDe(a) < PAUTA_CORTE_MINIMO_SEG && fimDe(b) - inicioDe(a - 1) < PAUTA_CORTE_MAXIMO_SEG) a--;
    if (fimDe(b) - inicioDe(a) < PAUTA_CORTE_MINIMO_SEG) {
      return { ok: false, motivo: `o vídeo não tem ${PAUTA_CORTE_MINIMO_SEG} s de fala em volta do trecho escolhido` };
    }
    avisos.push(`O corte escolhido tinha menos de ${PAUTA_CORTE_MINIMO_SEG} s: cresceu para os segmentos ${a} a ${b}.`);
  }

  const inicio = arred(inicioDe(a));
  const fim = arred(fimDe(b));
  const erro = conferirTrechoDoCorte(inicio, fim, fimDoVideo);
  if (erro) return { ok: false, motivo: erro };
  return { ok: true, corte: { inicio, fim, de: a, ate: b, trecho: falaDoTrecho(segmentos, inicio, fim), avisos } };
}

// ---------------------------------------------------------------------------
// A resposta do modelo, montada
// ---------------------------------------------------------------------------

export interface StoryMontado {
  titulo: string;
  /** O texto do story. */
  corpo: string;
  chamada: string;
  tempoSeg: number | null;
}

export interface CorteMontado extends TrechoDoCorte {
  titulo: string;
  /** A legenda. */
  corpo: string;
}

export interface DerivacaoMontada {
  /**
   * A palavra da matéria (a do modelo; sem ela, a do título), ainda não
   * conferida contra as outras matérias: isso é na gravação. Fecha o carrossel
   * e a legenda do corte.
   */
  palavraChave: string;
  /** O carrossel ainda sem a palavra final. */
  carrossel: { titulo: string; legenda: string; slides: PautaSlideDaSemana[]; palavraChave: string } | null;
  story: StoryMontado | null;
  corte: CorteMontado | null;
  /** O que não saiu, e o que o sistema ajustou. */
  avisos: string[];
}

/** A chamada que o sistema põe quando o modelo não deu uma. */
export const CHAMADA_PADRAO_DO_STORY = 'O episódio completo está no link da bio.';

function objeto(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * Lê a resposta de UMA matéria. Cada formato vale sozinho: carrossel com poucos
 * slides, story sem texto ou corte sem trecho de pé saem nulos com o porquê, e
 * os outros seguem. Nenhum dos três utilizável = `DerivacaoInvalidaError`.
 */
export function montarDerivacao(
  saida: string,
  ctx: { item: PautaItemCurado; segmentos: readonly Segmento[]; duracaoSeg: number },
): DerivacaoMontada {
  let bruto: unknown;
  try {
    bruto = parseJsonDaIa<unknown>(saida);
  } catch {
    throw new DerivacaoInvalidaError('não veio JSON');
  }
  const r = objeto(bruto);
  if (!r) throw new DerivacaoInvalidaError('o JSON não é um objeto');
  const avisos: string[] = [];
  const tituloDaMateria = linhaDaIa(ctx.item.titulo, PAUTA_TETO_DO_TITULO_DA_PECA) || 'Matéria do episódio';

  const c = objeto(r.carrossel);
  const palavraChave = palavraChaveDe(c?.palavraChave, ctx.item.titulo);
  let carrossel: DerivacaoMontada['carrossel'] = null;
  if (c) {
    const slides = slidesDoModelo(c.slides, palavraChave);
    if (slides.length < PAUTA_SLIDES_MINIMO - 1) {
      avisos.push(`Carrossel: o modelo devolveu ${slides.length} slide(s) de conteúdo; são pelo menos ${PAUTA_SLIDES_MINIMO - 1} antes do CTA.`);
    } else {
      carrossel = {
        titulo: linhaDaIa(c.titulo, PAUTA_TETO_DO_TITULO_DA_PECA) || tituloDaMateria,
        legenda: textoDaIa(c.legenda, PAUTA_TETO_DA_LEGENDA),
        slides,
        palavraChave,
      };
    }
  } else avisos.push('Carrossel: não veio no JSON.');

  let corte: CorteMontado | null = null;
  const k = objeto(r.corte);
  if (k) {
    const t = trechoDoCorte({ de: k.de, ate: k.ate }, ctx.segmentos, ctx.duracaoSeg);
    if (t.ok) {
      corte = {
        ...t.corte,
        titulo: linhaDaIa(k.titulo, PAUTA_TETO_DO_TITULO_DA_PECA) || tituloDaMateria,
        corpo: textoDaIa(k.legenda, 600),
      };
      avisos.push(...t.corte.avisos.map((a) => `Corte: ${a}`));
    } else avisos.push(`Corte: ${t.motivo}.`);
  } else avisos.push('Corte: não veio no JSON.');

  let story: StoryMontado | null = null;
  const s = objeto(r.story);
  const textoDoStory = s ? linhaDaIa(s.texto, PAUTA_TETO_DO_TEXTO_DO_STORY) : '';
  if (textoDoStory) {
    story = {
      titulo: tituloDaMateria,
      corpo: textoDoStory,
      chamada: linhaDaIa(s?.chamada, PAUTA_TETO_DA_CHAMADA_DO_STORY) || CHAMADA_PADRAO_DO_STORY,
      // O frame do story sai do começo do corte da matéria; sem corte, o Mac usa o meio do vídeo.
      tempoSeg: corte ? corte.inicio : null,
    };
  } else avisos.push('Story: não veio texto.');

  if (!carrossel && !story && !corte) throw new DerivacaoInvalidaError(avisos.join(' '));
  return { palavraChave, carrossel, story, corte, avisos };
}

// ---------------------------------------------------------------------------
// A peça no banco: a chave da matéria, a meta e o que fazer com cada uma
// ---------------------------------------------------------------------------

/**
 * A chave estável da matéria dentro do episódio: o id da captura (rodada da
 * curadoria, MC6) ou, na rodada antiga, um resumo do título e do link.
 */
export function chaveDoItem(item: Pick<PautaItemCurado, 'id' | 'titulo' | 'url'>): string {
  const id = typeof item.id === 'string' ? item.id.trim() : '';
  if (id && id.length <= 100) return id;
  return `h-${createHash('sha256').update(`${item.titulo ?? ''}|${item.url ?? ''}`).digest('hex').slice(0, 16)}`;
}

export interface MetaDaSemana {
  episodioId: string;
  itemId: string;
  itemN: number;
  formato: PautaFormatoDaSemana;
  transcricaoSha: string;
  linkDaMateria: string | null;
  avisos: string[];
  imagens: Array<{ n: number; chave: string; sha: string; largura: number; altura: number; bytes: number; enviadaEm: string }>;
  // carrossel
  slides?: PautaSlideDaSemana[];
  cta?: PautaCtaDoCarrossel;
  palavraChave?: string;
  // story
  chamada?: string;
  tempoSeg?: number | null;
  // corte
  inicio?: number;
  fim?: number;
  de?: number;
  ate?: number;
  trecho?: string;
  video?: { arquivo: string; duracaoSeg: number; largura: number; altura: number; bytes: number; registradoEm: string } | null;
  provider?: string;
  model?: string;
}

/** Esta peça é da semana de posts (deste episódio, quando dito). A derivação antiga não tem `episodioId`. */
export function ehPecaDaSemana(meta: unknown, episodioId?: string): boolean {
  const m = objeto(meta);
  if (!m || typeof m.episodioId !== 'string' || typeof m.itemId !== 'string') return false;
  if (!(PAUTA_FORMATOS_DA_SEMANA as readonly unknown[]).includes(m.formato)) return false;
  return episodioId === undefined || m.episodioId === episodioId;
}

/** A meta gravada, com o que faltar preenchido. */
export function lerMetaDaSemana(meta: unknown): MetaDaSemana {
  const m = objeto(meta) ?? {};
  const imagens = Array.isArray(m.imagens)
    ? (m.imagens as unknown[]).filter((i): i is MetaDaSemana['imagens'][number] => {
        const o = objeto(i);
        return !!o && Number.isInteger(o.n) && typeof o.chave === 'string';
      })
    : [];
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  return {
    ...(m as Partial<MetaDaSemana>),
    episodioId: String(m.episodioId ?? ''),
    itemId: String(m.itemId ?? ''),
    itemN: Number(m.itemN ?? 0),
    formato: m.formato as PautaFormatoDaSemana,
    transcricaoSha: String(m.transcricaoSha ?? ''),
    linkDaMateria: typeof m.linkDaMateria === 'string' ? m.linkDaMateria : null,
    avisos: Array.isArray(m.avisos) ? (m.avisos as unknown[]).filter((a): a is string => typeof a === 'string') : [],
    imagens,
    slides: Array.isArray(m.slides)
      ? (m.slides as unknown[]).map((s) => objeto(s) ?? {}).map((s) => ({ titulo: String(s.titulo ?? ''), texto: String(s.texto ?? '') }))
      : undefined,
    tempoSeg: m.tempoSeg === null ? null : num(m.tempoSeg),
    inicio: num(m.inicio),
    fim: num(m.fim),
    video: objeto(m.video) ? (m.video as MetaDaSemana['video']) : null,
  };
}

export type AcaoDaPeca =
  | { tipo: 'criar' }
  | { tipo: 'substituir'; id: string; status: PautaPecaStatus }
  | { tipo: 'manter'; id: string; status: PautaPecaStatus };

export interface PecaExistente {
  id: string;
  status: PautaPecaStatus;
  formato: string;
  criadaEm: Date;
}

/**
 * O que fazer com cada formato de UMA matéria, a partir das peças que ela já
 * tem. Aprovada ou publicada fica; rascunho e descartada são substituídas NO
 * LUGAR (o mesmo registro) — gerar de novo nunca duplica. Havendo mais de uma
 * (duas gerações antigas em corrida), vale a aprovada/publicada, senão a mais nova.
 */
export function planoDaMateria(existentes: readonly PecaExistente[]): Record<PautaFormatoDaSemana, AcaoDaPeca> {
  const plano = {} as Record<PautaFormatoDaSemana, AcaoDaPeca>;
  for (const formato of PAUTA_FORMATOS_DA_SEMANA) {
    const doFormato = existentes
      .filter((p) => p.formato === formato)
      .sort((a, b) => b.criadaEm.getTime() - a.criadaEm.getTime());
    const firme = doFormato.find((p) => p.status === 'aprovada' || p.status === 'publicada');
    if (firme) plano[formato] = { tipo: 'manter', id: firme.id, status: firme.status };
    else if (doFormato[0]) plano[formato] = { tipo: 'substituir', id: doFormato[0].id, status: doFormato[0].status };
    else plano[formato] = { tipo: 'criar' };
  }
  return plano;
}

/** A peça que a tela mostra de cada formato: a firme; senão a que vale; senão a descartada mais nova. */
export function pecaQueVale<T extends PecaExistente>(pecas: readonly T[], formato: PautaFormatoDaSemana): T | null {
  const doFormato = pecas.filter((p) => p.formato === formato).sort((a, b) => b.criadaEm.getTime() - a.criadaEm.getTime());
  return (
    doFormato.find((p) => p.status === 'aprovada' || p.status === 'publicada') ??
    doFormato.find((p) => p.status === 'rascunho') ??
    doFormato[0] ??
    null
  );
}

/**
 * A versão do que o render desenha (título, texto, slides, CTA, chamada, frame,
 * trecho): o PNG que chega depois de uma edição é do texto velho. A lista de
 * imagens, o mp4 e os avisos ficam de fora — mudam sem mudar o texto.
 */
export function versaoDoTexto(p: { titulo: string; corpo: string; meta: unknown }): string {
  const m = lerMetaDaSemana(p.meta);
  const desenho = [p.titulo, p.corpo, m.slides ?? null, m.cta ?? null, m.palavraChave ?? null, m.chamada ?? null, m.tempoSeg ?? null, m.inicio ?? null, m.fim ?? null];
  return createHash('sha256').update(JSON.stringify(desenho)).digest('hex').slice(0, 16);
}

/** Chave da imagem no storage: o hash no nome, trocar grava outra. */
export function chaveDaImagemDaPeca(pecaId: string, n: number, sha: string): string {
  return `pauta/peca/${pecaId}-${n}-${sha.slice(0, 12)}.png`;
}

const ASSINATURA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * O PNG que o Mac renderizou para a peça: assinatura de PNG, até 5 MB e o
 * tamanho exato do formato (carrossel 1080×1350, story 1080×1920).
 */
export function conferirPngDaPeca(
  arquivo: { buffer: Buffer; mimetype: string; size?: number } | undefined,
  esperado: { largura: number; altura: number },
  tetoBytes: number,
): { ok: true; largura: number; altura: number } | { ok: false; motivo: string } {
  if (!arquivo) return { ok: false, motivo: 'Envie o PNG no campo "file".' };
  if (arquivo.mimetype !== 'image/png') return { ok: false, motivo: `A imagem da peça é PNG (veio ${arquivo.mimetype || 'sem tipo'}).` };
  const tamanho = Math.max(arquivo.size ?? 0, arquivo.buffer.length);
  if (tamanho > tetoBytes) return { ok: false, motivo: `A imagem passa de ${Math.round(tetoBytes / 1024 / 1024)} MB.` };
  const b = arquivo.buffer;
  if (b.length < 24 || ASSINATURA_PNG.some((x, i) => b[i] !== x) || b.toString('latin1', 12, 16) !== 'IHDR') {
    return { ok: false, motivo: 'O arquivo não é um PNG (a assinatura não bate).' };
  }
  const largura = b.readUInt32BE(16);
  const altura = b.readUInt32BE(20);
  if (largura !== esperado.largura || altura !== esperado.altura) {
    return { ok: false, motivo: `A imagem tem ${largura}×${altura}; este formato é ${esperado.largura}×${esperado.altura}.` };
  }
  return { ok: true, largura, altura };
}
