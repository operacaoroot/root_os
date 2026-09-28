import {
  PAUTA_CAPITULO_MINIMO_SEG,
  PAUTA_MARCADOR_DA_PAGINA_DE_LINKS,
  PAUTA_PALAVRAS_DA_THUMB,
  PAUTA_RESERVA_DA_PAGINA_DE_LINKS,
  PAUTA_TETO_DA_DESCRICAO_DO_YOUTUBE,
  PAUTA_TETO_DO_TITULO_DO_YOUTUBE,
  PAUTA_THUMB_MAX_BYTES,
  PAUTA_THUMBS_DO_PACOTE,
  PAUTA_TITULOS_DO_PACOTE,
  conferirCapitulos,
  linhasDosCapitulos,
  palavrasProibidasEm,
  tempoDoCapitulo,
  thumbsDoPacote,
  type PautaCapitulo,
  type PautaImagemDaThumb,
  type PautaItemCurado,
  type PautaThumbDoPacote,
  type PautaTituloDoPacote,
} from '@mktos/shared';
import { parseJsonDaIa } from './parse-json';
import { linkPublicoDoItem } from './link-publico';

/*
 * ============================================================================
 * O PACOTE DO YOUTUBE (MC11) — a parte pura
 * ============================================================================
 *
 * Da transcrição do vídeo final saem 3 títulos, a descrição e 3 briefs de
 * thumb. A IA escreve; o sistema monta e confere. Três coisas não ficam com ela:
 *
 *  - os TEMPOS dos capítulos: o modelo escolhe entre os tempos que aparecem na
 *    transcrição, o sistema encosta cada um no começo de fala mais próximo e
 *    confere as regras do YouTube (00:00, pelo menos 3, 10 s cada, em ordem).
 *    O que dá para consertar é consertado e dito; o que não dá tira os
 *    capítulos da descrição com o motivo — vídeo de 25 s nunca terá 3;
 *  - os LINKS: saem dos itens mantidos da rodada, nunca do texto do modelo, e o
 *    item de newsletter (origem L) não entra — o link dele é o permalink da
 *    caixa de entrada;
 *  - a PÁGINA DE LINKS do episódio: entra como marcador, que o MC12 troca pela
 *    URL da página.
 */

const SYSTEM_PACOTE_BASE = `Você prepara o pacote de publicação no YouTube do episódio semanal da ROOT, uma comunidade
brasileira sobre IA aplicada a negócios. Quem assiste toca uma pequena ou média empresa.

Recebe as matérias que o episódio cobriu, numeradas, e a TRANSCRIÇÃO do vídeo final, com o tempo
de cada trecho entre colchetes ([mm:ss] ou [hh:mm:ss]).

Responda SOMENTE com um objeto JSON válido, sem cercas de código:
{
  "titulos": [              // EXATAMENTE 3, cada um com um ângulo diferente
    { "texto": string,      // até 100 caracteres; o que o episódio entrega, sem clickbait vazio
      "angulo": string }    // o ângulo em uma ou duas palavras (curiosidade, resultado, lista, alerta…)
  ],
  "abertura": string,       // 2 a 3 frases para o topo da descrição: do que o episódio trata
  "capitulos": [            // de 4 a 10, na ordem do vídeo
    { "tempo": string,      // COPIADO de um dos colchetes da transcrição, o primeiro "00:00"
      "titulo": string }    // até 60 caracteres, o assunto daquele trecho
  ],
  "hashtags": [string],     // até 3, sem espaço
  "thumbs": [               // EXATAMENTE 3 ideias de capa, diferentes entre si
    { "texto": string,      // ATÉ 4 PALAVRAS, para ler de relance no celular
      "destaque": string,   // UMA palavra do "texto", a que vai na cor de destaque
      "tempo": string }     // o momento do vídeo para o frame de fundo, copiado de um colchete
  ]
}

Regras:
- Use SOMENTE o que está na transcrição e nas matérias. Nunca invente notícia, número, nome ou URL.
- Não escreva URL nem link: os links entram sozinhos na descrição, pelas matérias.
- Capítulo começa onde o assunto começa na transcrição; cada um dura pelo menos 10 segundos.
- Título e thumb falam do que muda para quem toca o negócio. Sem emoji, sem caixa alta inteira,
  sem os sinais < e > (o YouTube recusa).
- Sem segunda pessoa nos títulos ("você", "seu"): a marca fala do que acontece, não para quem lê.`;

/** O prompt do pacote com o bloco de voz da empresa (MC10). */
/** A marca (MK1) antes da voz (MC10), como no roteiro. Marca vazia não muda nada. */
export function systemDoPacote(voz: string, marca = ''): string {
  return [SYSTEM_PACOTE_BASE, marca.trim(), voz.trim()].filter(Boolean).join('\n\n');
}

export type Segmento = { inicio: number; fim: number; texto: string };

/** Teto da transcrição no prompt: ~1h de fala em blocos de 1 min cabe; o resto é agrupado. */
export const TETO_DA_TRANSCRICAO_NO_PROMPT = 45_000;
/** Os tamanhos de bloco tentados em ordem: do segmento cru até 4 min. */
const GRAOS_SEG = [0, 15, 30, 60, 120, 240];

function umaLinha(v: unknown, teto: number): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, teto) : '';
}

/**
 * A transcrição como vai ao modelo: `[mm:ss] texto` por linha. Longa demais,
 * os segmentos são agrupados em blocos maiores — o tempo de cada bloco continua
 * sendo o começo real de uma fala, que é de onde os capítulos saem.
 */
export function transcricaoParaOPrompt(
  segmentos: readonly Segmento[],
  teto = TETO_DA_TRANSCRICAO_NO_PROMPT,
): { texto: string; blocos: number; graoSeg: number } {
  const comHoras = segmentos.some((s) => s.fim >= 3600);
  const montar = (grao: number, tetoDoBloco = Infinity) => {
    const blocos: Array<{ inicio: number; textos: string[]; fim: number }> = [];
    for (const s of segmentos) {
      const atual = blocos[blocos.length - 1];
      if (atual && s.inicio - atual.inicio < grao) {
        atual.textos.push(s.texto);
        atual.fim = s.fim;
      } else blocos.push({ inicio: s.inicio, textos: [s.texto], fim: s.fim });
    }
    const linhas = blocos.map((b) => `[${tempoDoCapitulo(b.inicio, comHoras)}] ${umaLinha(b.textos.join(' '), tetoDoBloco)}`);
    return { texto: linhas.join('\n'), blocos: blocos.length };
  };
  for (const grao of GRAOS_SEG) {
    const r = montar(grao);
    if (r.texto.length <= teto) return { ...r, graoSeg: grao };
  }
  const grao = GRAOS_SEG[GRAOS_SEG.length - 1];
  const quantos = montar(grao).blocos || 1;
  const r = montar(grao, Math.max(80, Math.floor(teto / quantos) - 12));
  return { texto: r.texto.slice(0, teto), blocos: r.blocos, graoSeg: grao };
}

/**
 * O link que o pacote pode publicar, ou nulo — a regra única de
 * `link-publico.ts` (marca, origem L e host de caixa de entrada).
 */
export function linkDoPacote(item: Pick<PautaItemCurado, 'url' | 'semLinkPublico' | 'origem' | 'origens'>): string | null {
  return linkPublicoDoItem(item);
}

/** O pedido ao modelo: as matérias numeradas e a transcrição com os tempos. */
export function entradaDoPacote(e: {
  apelido: string;
  titulo: string;
  itens: readonly PautaItemCurado[];
  segmentos: readonly Segmento[];
  duracaoSeg: number;
}): string {
  const materias = e.itens.map((i, idx) => {
    const partes = [`[${idx + 1}] ${umaLinha(i.titulo, 300)}`];
    const resumo = umaLinha(i.resumo || i.porque, 400);
    if (resumo) partes.push(`    resumo: ${resumo}`);
    if (!linkDoPacote(i)) partes.push(`    (sem link público${i.fonte ? `; fonte: ${umaLinha(i.fonte, 120)}` : ''})`);
    return partes.join('\n');
  });
  const t = transcricaoParaOPrompt(e.segmentos);
  return [
    `Episódio: ${e.apelido} · ${umaLinha(e.titulo, 160)}`,
    `Duração do vídeo final: ${tempoDoCapitulo(e.duracaoSeg, e.duracaoSeg >= 3600)}`,
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

/** A IA não devolveu nada utilizável: o episódio fica como estava. */
export class PacoteInvalidoError extends Error {
  constructor(motivo: string) {
    super(`A IA não devolveu um pacote utilizável (${motivo}) — nada foi gravado. Tente de novo.`);
    this.name = 'PacoteInvalidoError';
  }
}

/** Os capítulos não fecham as regras do YouTube nem depois de consertados. */
export class CapitulosRecusadosError extends Error {
  constructor(readonly motivos: string[]) {
    super(`Sem capítulos na descrição: ${motivos.join(' ')}`);
    this.name = 'CapitulosRecusadosError';
  }
}

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;
const URL_NO_TEXTO = /<?\b(?:https?:\/\/|www\.)[^\s>)]+>?/gi;

/**
 * Texto que veio do modelo e vai ao YouTube: sem URL (o link sai do item), sem
 * emoji (regra da marca), sem `<` e `>` (o YouTube recusa a descrição inteira)
 * e sem o marcador da página de links, que só a montagem da descrição põe.
 */
export function textoParaOYoutube(v: unknown, teto: number): string {
  if (typeof v !== 'string') return '';
  const semMarcador = v.split(PAUTA_MARCADOR_DA_PAGINA_DE_LINKS).join(' ');
  return umaLinha(semMarcador.replace(URL_NO_TEXTO, ' ').replace(EMOJI, '').replace(/[<>]/g, ''), teto);
}

/** Corta no teto sem partir palavra (o título do YouTube para em 100). */
function cortarNaPalavra(s: string, teto: number): string {
  if (s.length <= teto) return s;
  const corte = s.slice(0, teto + 1);
  const i = corte.lastIndexOf(' ');
  return (i > teto * 0.6 ? corte.slice(0, i) : s.slice(0, teto)).replace(/[\s,;:.–—-]+$/, '');
}

/** `12:34`, `1:02:03`, `00:05` ou um número de segundos → segundos; o resto é NaN. */
export function segundosDoTempo(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? v : NaN;
  if (typeof v !== 'string') return NaN;
  const t = v.trim().replace(/^\[|\]$/g, '');
  if (/^\d+(?:[.,]\d+)?$/.test(t)) return Number(t.replace(',', '.'));
  const m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/.exec(t);
  if (!m || Number(m[3]) > 59) return NaN;
  return Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** O prompt pede de 4 a 10; o que passar disso é juntado, para a descrição caber no teto. */
export const MAXIMO_DE_CAPITULOS = 10;

export interface ConsertoDosCapitulos {
  capitulos: PautaCapitulo[];
  /** O que foi consertado, em português, para o RASTRO e a tela. */
  correcoes: string[];
}

/**
 * Os capítulos do modelo, encostados nos tempos reais da transcrição e dentro
 * das regras do YouTube. Conserta o que dá (tempo fora da fala, fora de ordem,
 * repetido, primeiro depois de 00:00, curto demais) e diz o que fez; se mesmo
 * assim não sobram 3 válidos, recusa com o motivo.
 */
export function consertarCapitulos(
  brutos: unknown,
  opts: { duracaoSeg: number; inicios: readonly number[] },
): ConsertoDosCapitulos {
  const correcoes: string[] = [];
  const duracao = opts.duracaoSeg;
  const inicios = [...opts.inicios].filter(Number.isFinite).sort((a, b) => a - b);
  const lista = Array.isArray(brutos) ? brutos : [];

  let caps: PautaCapitulo[] = [];
  let descartados = 0;
  for (const b of lista) {
    if (!b || typeof b !== 'object') {
      descartados++;
      continue;
    }
    const r = b as Record<string, unknown>;
    const seg = segundosDoTempo(r.tempo ?? r.inicio ?? r.inicioSeg);
    const titulo = textoParaOYoutube(r.titulo, 70).replace(/^(?:\d{1,2}:)?\d{1,2}:\d{2}\s*[-–—:]?\s*/, '');
    if (!Number.isFinite(seg) || !titulo || seg >= duracao) {
      descartados++;
      continue;
    }
    caps.push({ inicioSeg: seg, titulo });
  }
  if (descartados) correcoes.push(`${descartados} capítulo(s) sem tempo válido, sem título ou depois do fim do vídeo saíram.`);

  if (inicios.length) {
    let movidos = 0;
    caps = caps.map((c) => {
      const perto = inicios.reduce((m, s) => (Math.abs(s - c.inicioSeg) < Math.abs(m - c.inicioSeg) ? s : m), inicios[0]);
      if (Math.abs(perto - c.inicioSeg) >= 1) movidos++;
      return { ...c, inicioSeg: Math.floor(perto) };
    });
    if (movidos) correcoes.push(`${movidos} tempo(s) encostado(s) no começo da fala mais próxima.`);
  } else caps = caps.map((c) => ({ ...c, inicioSeg: Math.floor(c.inicioSeg) }));

  const emOrdem = caps.every((c, i) => i === 0 || c.inicioSeg >= caps[i - 1].inicioSeg);
  if (!emOrdem) {
    caps.sort((a, b) => a.inicioSeg - b.inicioSeg);
    correcoes.push('Os capítulos foram postos em ordem crescente.');
  }
  const unicos = caps.filter((c, i) => i === 0 || c.inicioSeg !== caps[i - 1].inicioSeg);
  if (unicos.length < caps.length) correcoes.push(`${caps.length - unicos.length} capítulo(s) no mesmo tempo de outro saíram.`);
  caps = unicos;

  if (caps.length && caps[0].inicioSeg > 0) {
    if (caps[0].inicioSeg < PAUTA_CAPITULO_MINIMO_SEG) {
      correcoes.push(`O primeiro capítulo foi de ${tempoDoCapitulo(caps[0].inicioSeg)} para 00:00.`);
      caps[0] = { ...caps[0], inicioSeg: 0 };
    } else {
      correcoes.push('Entrou um capítulo "Abertura" em 00:00.');
      caps.unshift({ inicioSeg: 0, titulo: 'Abertura' });
    }
  }

  const longos: PautaCapitulo[] = [];
  let curtos = 0;
  for (const c of caps) {
    const anterior = longos[longos.length - 1];
    if (anterior && c.inicioSeg - anterior.inicioSeg < PAUTA_CAPITULO_MINIMO_SEG) curtos++;
    else longos.push(c);
  }
  while (longos.length > 1 && duracao - longos[longos.length - 1].inicioSeg < PAUTA_CAPITULO_MINIMO_SEG) {
    longos.pop();
    curtos++;
  }
  if (curtos) correcoes.push(`${curtos} capítulo(s) com menos de ${PAUTA_CAPITULO_MINIMO_SEG} s foram juntados ao anterior.`);

  // Juntar ao anterior o mais curto mantém as regras: o 00:00 fica e cada um só cresce.
  const demais = longos.length - MAXIMO_DE_CAPITULOS;
  while (longos.length > MAXIMO_DE_CAPITULOS) {
    let alvo = 1;
    let menor = Infinity;
    for (let i = 1; i < longos.length; i++) {
      const fim = i + 1 < longos.length ? longos[i + 1].inicioSeg : duracao;
      if (fim - longos[i].inicioSeg < menor) {
        menor = fim - longos[i].inicioSeg;
        alvo = i;
      }
    }
    longos.splice(alvo, 1);
  }
  if (demais > 0) correcoes.push(`${demais} capítulo(s) além de ${MAXIMO_DE_CAPITULOS} foram juntados ao anterior (os mais curtos).`);

  const erros = conferirCapitulos(longos, duracao);
  if (erros.length) throw new CapitulosRecusadosError(erros);
  return { capitulos: longos, correcoes };
}

/** Até 3 hashtags, sem espaço nem pontuação, sem repetir e sem palavra que a marca proíbe. */
export function hashtagsDoPacote(v: unknown): string[] {
  const lista = Array.isArray(v) ? v : [];
  const vistas = new Set<string>();
  const saida: string[] = [];
  for (const h of lista) {
    if (typeof h !== 'string') continue;
    const palavras = h.normalize('NFC').replace(/^#+/, '').trim().split(/\s+/);
    // "pequenas empresas" vira #PequenasEmpresas; uma palavra só fica como veio.
    const limpa = (palavras.length > 1 ? palavras.map((p) => p.charAt(0).toUpperCase() + p.slice(1)) : palavras)
      .join('')
      .replace(/[^\p{L}\p{N}_]/gu, '')
      .slice(0, 30);
    const chave = limpa.toLowerCase();
    if (limpa.length < 2 || /^\d+$/.test(limpa) || vistas.has(chave) || palavrasProibidasEm(limpa).length) continue;
    vistas.add(chave);
    saida.push(`#${limpa}`);
    if (saida.length === 3) break;
  }
  return saida;
}

/** Os 3 títulos: dentro de 100, sem repetir, sem palavra proibida. Menos de 3 é pacote inválido. */
export function titulosDaIa(v: unknown): PautaTituloDoPacote[] {
  const lista = Array.isArray(v) ? v : [];
  const vistos = new Set<string>();
  const saida: PautaTituloDoPacote[] = [];
  for (const t of lista) {
    const r = typeof t === 'string' ? { texto: t } : t && typeof t === 'object' ? (t as Record<string, unknown>) : null;
    if (!r) continue;
    const texto = cortarNaPalavra(textoParaOYoutube(r.texto, 400), PAUTA_TETO_DO_TITULO_DO_YOUTUBE);
    const chave = texto.toLowerCase();
    if (texto.length < 8 || vistos.has(chave) || palavrasProibidasEm(texto).length) continue;
    vistos.add(chave);
    saida.push({ texto, angulo: textoParaOYoutube(r.angulo, 40), escolhido: false });
    if (saida.length === PAUTA_TITULOS_DO_PACOTE) break;
  }
  if (saida.length < PAUTA_TITULOS_DO_PACOTE) {
    throw new PacoteInvalidoError(`${saida.length} título(s) utilizável(is) de ${PAUTA_TITULOS_DO_PACOTE}`);
  }
  return saida;
}

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** "O preço da IA" e "O preço da IA:" são a mesma thumb. */
const chaveDoTexto = (s: string) => semAcento(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** O aviso de ângulo repetido (ou em branco) nos títulos; nulo = três ângulos diferentes. */
export function angulosRepetidos(titulos: readonly PautaTituloDoPacote[]): string | null {
  const angulos = titulos.map((t) => chaveDoTexto(t.angulo));
  if (new Set(angulos.filter(Boolean)).size === titulos.length) return null;
  return `Os títulos vieram sem três ângulos diferentes (${titulos.map((t) => t.angulo || 'sem ângulo').join(', ')}) — confira se não dizem a mesma coisa.`;
}

/**
 * Os textos que completam as thumbs que faltam, na ordem: o começo de cada
 * título, depois os trechos seguintes de 4 palavras (o último encostado no fim,
 * para não sobrar palavra solta) e por fim o ângulo.
 */
function textosDosTitulos(titulos: readonly PautaTituloDoPacote[]): string[] {
  const n = PAUTA_PALAVRAS_DA_THUMB;
  const saida = titulos.map((t) => t.texto);
  for (const t of titulos) {
    const p = t.texto.split(' ').filter(Boolean);
    for (let i = n; i < p.length; i += n) {
      const ini = Math.min(i, p.length - n);
      saida.push(p.slice(ini, ini + n).join(' '));
    }
  }
  for (const t of titulos) if (t.angulo) saida.push(t.angulo);
  return saida;
}

/**
 * Os briefs das thumbs: até 4 palavras, o destaque é uma palavra do texto (a
 * mais longa, se o modelo apontar outra), o tempo dentro do vídeo. Faltando
 * brief, completa com trechos dos títulos; se nem assim chegar a 3, diz em
 * `avisos`.
 */
export function thumbsDaIa(
  v: unknown,
  opts: { duracaoSeg: number; titulos: readonly PautaTituloDoPacote[] },
): { thumbs: PautaThumbDoPacote[]; correcoes: string[]; avisos: string[] } {
  const correcoes: string[] = [];
  const avisos: string[] = [];
  const duracao = Math.max(0, opts.duracaoSeg);
  const tempoPadrao = (i: number) => Math.floor((duracao * (i + 1)) / (PAUTA_THUMBS_DO_PACOTE + 1));
  const ultimoFrame = Math.max(0, Math.floor(duracao - 1));
  const lista = Array.isArray(v) ? v : [];
  const saida: PautaThumbDoPacote[] = [];
  const vistos = new Set<string>();
  let cortadas = 0;

  const brief = (textoBruto: unknown, destaqueBruto: unknown, tempoBruto: unknown, daIa: boolean): boolean => {
    const palavras = textoParaOYoutube(textoBruto, 200).split(' ').filter(Boolean);
    if (!palavras.length) return false;
    if (daIa && palavras.length > PAUTA_PALAVRAS_DA_THUMB) cortadas++;
    const texto = palavras.slice(0, PAUTA_PALAVRAS_DA_THUMB).join(' ').slice(0, 40);
    const chave = chaveDoTexto(texto);
    if (!chave || vistos.has(chave) || palavrasProibidasEm(texto).length) return false;
    const usadas = texto.split(' ');
    const pedido = semAcento(textoParaOYoutube(destaqueBruto, 40)).replace(/[^\p{L}\p{N}]/gu, '');
    const destaque =
      usadas.find((p) => pedido && semAcento(p).replace(/[^\p{L}\p{N}]/gu, '') === pedido) ??
      usadas.reduce((m, p) => (p.replace(/[^\p{L}\p{N}]/gu, '').length > m.replace(/[^\p{L}\p{N}]/gu, '').length ? p : m), usadas[0]);
    const i = saida.length;
    const seg = segundosDoTempo(tempoBruto);
    const tempoSeg = Number.isFinite(seg) ? Math.min(Math.floor(seg), ultimoFrame) : tempoPadrao(i);
    vistos.add(chave);
    saida.push({ n: i + 1, texto, destaque, tempoSeg, imagem: null });
    return true;
  };

  for (const t of lista) {
    if (saida.length === PAUTA_THUMBS_DO_PACOTE) break;
    if (!t || typeof t !== 'object') continue;
    const r = t as Record<string, unknown>;
    brief(r.texto, r.destaque, r.tempo ?? r.tempoSeg, true);
  }
  if (cortadas) correcoes.push(`${cortadas} texto(s) de thumb cortado(s) em ${PAUTA_PALAVRAS_DA_THUMB} palavras.`);
  let completadas = 0;
  for (const texto of textosDosTitulos(opts.titulos)) {
    if (saida.length === PAUTA_THUMBS_DO_PACOTE) break;
    if (brief(texto, '', undefined, false)) completadas++;
  }
  if (completadas) correcoes.push(`${completadas} thumb(s) completada(s) a partir dos títulos.`);
  if (saida.length < PAUTA_THUMBS_DO_PACOTE) {
    avisos.push(`Saíram ${saida.length} thumb(s) de ${PAUTA_THUMBS_DO_PACOTE}: a IA e os títulos não deram textos diferentes o bastante — gere o pacote de novo.`);
  }
  return { thumbs: saida, correcoes, avisos };
}

export interface LinkDaDescricao {
  titulo: string;
  url: string;
}

/** Os links citados: os itens mantidos com link público, na ordem da rodada, sem repetir. */
export function linksDaDescricao(itens: readonly PautaItemCurado[]): LinkDaDescricao[] {
  const vistos = new Set<string>();
  const saida: LinkDaDescricao[] = [];
  for (const i of itens) {
    const url = linkDoPacote(i);
    if (!url || vistos.has(url)) continue;
    vistos.add(url);
    saida.push({ titulo: textoParaOYoutube(i.titulo, 120) || url, url });
  }
  return saida;
}

const bytes = (s: string) => new TextEncoder().encode(s).length;

/** O teto medido com o marcador: sobra a folga para a URL que entra no lugar dele. */
export const TETO_DA_DESCRICAO_COM_O_MARCADOR =
  PAUTA_TETO_DA_DESCRICAO_DO_YOUTUBE - (PAUTA_RESERVA_DA_PAGINA_DE_LINKS - bytes(PAUTA_MARCADOR_DA_PAGINA_DE_LINKS));

/**
 * A descrição do YouTube: abertura, capítulos, links citados, a chamada para a
 * página de links do episódio (o marcador que o MC12 preenche) e as hashtags.
 * Passando do teto (5.000 bytes menos a folga da URL da página), saem primeiro
 * os links do fim (a página tem todos), depois o fim da abertura. Com no
 * máximo 10 capítulos, isso basta para caber.
 */
export function montarDescricao(d: {
  abertura: string;
  capitulos: readonly PautaCapitulo[] | null;
  duracaoSeg: number;
  links: readonly LinkDaDescricao[];
  hashtags: readonly string[];
}): string {
  const montar = (abertura: string, links: readonly LinkDaDescricao[], sobra: number) => {
    const partes: string[] = [];
    if (abertura) partes.push(abertura);
    if (d.capitulos?.length) partes.push(['Capítulos', ...linhasDosCapitulos(d.capitulos, d.duracaoSeg)].join('\n'));
    if (links.length || sobra) {
      const linhas = links.map((l) => `• ${l.titulo}: ${l.url}`);
      if (sobra) linhas.push(`• e mais ${sobra} na página do episódio`);
      partes.push(['Links citados no episódio', ...linhas].join('\n'));
    }
    partes.push(`Os links deste episódio, numa página só: ${PAUTA_MARCADOR_DA_PAGINA_DE_LINKS}`);
    if (d.hashtags.length) partes.push(d.hashtags.join(' '));
    return partes.join('\n\n');
  };
  let links = [...d.links];
  let abertura = d.abertura;
  let texto = montar(abertura, links, 0);
  while (bytes(texto) > TETO_DA_DESCRICAO_COM_O_MARCADOR && links.length) {
    links = links.slice(0, -1);
    texto = montar(abertura, links, d.links.length - links.length);
  }
  while (bytes(texto) > TETO_DA_DESCRICAO_COM_O_MARCADOR && abertura) {
    abertura = cortarNaPalavra(abertura, Math.floor(abertura.length * 0.8));
    texto = montar(abertura, links, d.links.length - links.length);
  }
  return texto;
}

export interface PacoteMontado {
  titulos: PautaTituloDoPacote[];
  descricao: string;
  thumbs: PautaThumbDoPacote[];
  capitulos: PautaCapitulo[];
  links: number;
  /** O que a tela deve mostrar (capítulos recusados, thumbs a menos, ângulos repetidos). */
  avisos: string[];
  /** O que o sistema consertou no que a IA devolveu. */
  correcoes: string[];
}

/** Lê a resposta do modelo e monta o pacote inteiro; erro de formato é `PacoteInvalidoError`. */
export function montarPacote(
  saida: string,
  ctx: { itens: readonly PautaItemCurado[]; segmentos: readonly Segmento[]; duracaoSeg: number },
): PacoteMontado {
  let bruto: unknown;
  try {
    bruto = parseJsonDaIa<unknown>(saida);
  } catch {
    throw new PacoteInvalidoError('não veio JSON');
  }
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) throw new PacoteInvalidoError('não veio um objeto');
  const o = bruto as Record<string, unknown>;

  const titulos = titulosDaIa(o.titulos);
  const avisos: string[] = [];
  const correcoes: string[] = [];
  const angulos = angulosRepetidos(titulos);
  if (angulos) avisos.push(angulos);

  let capitulos: PautaCapitulo[] = [];
  try {
    const c = consertarCapitulos(o.capitulos, { duracaoSeg: ctx.duracaoSeg, inicios: ctx.segmentos.map((s) => s.inicio) });
    capitulos = c.capitulos;
    correcoes.push(...c.correcoes);
  } catch (e) {
    if (!(e instanceof CapitulosRecusadosError)) throw e;
    avisos.push(e.message);
  }

  const t = thumbsDaIa(o.thumbs, { duracaoSeg: ctx.duracaoSeg, titulos });
  correcoes.push(...t.correcoes);
  avisos.push(...t.avisos);
  const links = linksDaDescricao(ctx.itens);
  const descricao = montarDescricao({
    abertura: textoParaOYoutube(o.abertura, 700),
    capitulos: capitulos.length ? capitulos : null,
    duracaoSeg: ctx.duracaoSeg,
    links,
    hashtags: hashtagsDoPacote(o.hashtags),
  });
  return { titulos, descricao, thumbs: t.thumbs, capitulos, links: links.length, avisos, correcoes };
}

// ---------------------------------------------------------------------------
// A thumb renderizada no Mac
// ---------------------------------------------------------------------------

const ASSINATURA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Confere o arquivo que o Mac subiu: PNG de verdade (pela assinatura, não só
 * pelo tipo declarado), até 2 MB, 16:9 e com pelo menos 640 de largura — o
 * mínimo do YouTube. Devolve as dimensões ou o motivo da recusa.
 */
export function conferirPngDaThumb(
  arquivo: { buffer: Buffer; mimetype: string; size?: number } | undefined,
): { ok: true; largura: number; altura: number } | { ok: false; motivo: string } {
  if (!arquivo) return { ok: false, motivo: 'Envie o PNG no campo "file".' };
  if (arquivo.mimetype !== 'image/png') return { ok: false, motivo: `A thumb é PNG (veio ${arquivo.mimetype || 'sem tipo'}).` };
  const tamanho = Math.max(arquivo.size ?? 0, arquivo.buffer.length);
  if (tamanho > PAUTA_THUMB_MAX_BYTES) return { ok: false, motivo: 'A thumb passa de 2 MB — o YouTube não aceita.' };
  const b = arquivo.buffer;
  if (b.length < 24 || ASSINATURA_PNG.some((x, i) => b[i] !== x) || b.toString('latin1', 12, 16) !== 'IHDR') {
    return { ok: false, motivo: 'O arquivo não é um PNG (a assinatura não bate).' };
  }
  const largura = b.readUInt32BE(16);
  const altura = b.readUInt32BE(20);
  if (largura < 640 || largura > 3840 || largura * 9 !== altura * 16) {
    return { ok: false, motivo: `A thumb tem ${largura}×${altura}; o YouTube pede 16:9 com pelo menos 640 de largura (o template sai 1280×720).` };
  }
  return { ok: true, largura, altura };
}

export type ImagemGuardada = PautaImagemDaThumb & { chave: string; sha: string };
export type ThumbGuardada = Omit<PautaThumbDoPacote, 'imagem'> & { imagem: ImagemGuardada | null };

/** Os briefs como estão no banco, com a chave do storage (que não sai para a tela). */
export function thumbsGuardadas(valor: unknown): ThumbGuardada[] {
  const cru = Array.isArray(valor) ? valor : [];
  return thumbsDoPacote(valor).map((t) => {
    const r = cru.find((x) => x && typeof x === 'object' && Number((x as { n?: unknown }).n) === t.n) as
      | { imagem?: { chave?: unknown; sha?: unknown } }
      | undefined;
    const chave = typeof r?.imagem?.chave === 'string' ? r.imagem.chave : '';
    return {
      ...t,
      imagem: t.imagem && chave ? { ...t.imagem, chave, sha: typeof r?.imagem?.sha === 'string' ? r.imagem.sha : '' } : null,
    };
  });
}

/** A chave no storage: o id do episódio, o número e o hash do conteúdo (trocar a imagem não sobrescreve). */
export function chaveDaThumb(episodioId: string, n: number, sha: string): string {
  return `pauta/thumb/${episodioId}-${n}-${sha.slice(0, 12)}.png`;
}
