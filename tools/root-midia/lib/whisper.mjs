// @ts-check
/*
 * O JSON do whisper.cpp (`whisper-cli -oj`) virando os segmentos `{inicio, fim,
 * texto}` em segundos que o OS guarda. Puro: o processo roda em root-midia.mjs.
 */

/** @typedef {{ inicio: number, fim: number, texto: string }} Segmento */

/** Teto de caracteres por segmento no OS (PAUTA_TETO_DO_SEGMENTO). */
export const TETO_DO_SEGMENTO = 2000;

/**
 * `00:01:02,500` (ou com ponto) → 62,5 s.
 * @param {unknown} t
 */
export function tempoDoWhisper(t) {
  const m = /^(\d+):(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(String(t ?? '').trim());
  if (!m) return NaN;
  const ms = m[4] ? Number(m[4].padEnd(3, '0')) : 0;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + ms / 1000;
}

/**
 * Anotação que não é fala: `[BLANK_AUDIO]`, `(música)`, `[Risos]`.
 * @param {string} texto
 */
export function ehAnotacao(texto) {
  return /^\s*(?:[[(*♪][^\])*♪]*[\])*♪]\s*)+$/.test(texto);
}

/** @param {number} n */
function arred(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Os segmentos, em ordem e sem sobreposição. Prefere `offsets` (ms, exatos) e
 * cai nos `timestamps` em texto. Fica de fora o segmento vazio ou só anotação.
 * @param {unknown} json
 * @returns {Segmento[]}
 */
export function segmentosDoWhisper(json) {
  const bruto = /** @type {{ transcription?: unknown }} */ (json ?? {}).transcription;
  if (!Array.isArray(bruto)) throw new Error('O JSON não parece do whisper.cpp: falta a lista `transcription`.');
  /** @type {Segmento[]} */
  const lista = [];
  for (const s of bruto) {
    const texto = String(s?.text ?? '').replace(/\s+/g, ' ').trim();
    if (!texto || ehAnotacao(texto)) continue;
    let inicio = Number(s?.offsets?.from) / 1000;
    let fim = Number(s?.offsets?.to) / 1000;
    if (!Number.isFinite(inicio) || !Number.isFinite(fim)) {
      inicio = tempoDoWhisper(s?.timestamps?.from);
      fim = tempoDoWhisper(s?.timestamps?.to);
    }
    if (!Number.isFinite(inicio) || !Number.isFinite(fim)) continue;
    lista.push({ inicio: Math.max(0, inicio), fim: Math.max(0, fim), texto: texto.slice(0, TETO_DO_SEGMENTO) });
  }
  lista.sort((a, b) => a.inicio - b.inicio);
  let fimAnterior = 0;
  return lista.map((s) => {
    const inicio = arred(Math.max(s.inicio, fimAnterior));
    const fim = arred(Math.max(s.fim, inicio));
    fimAnterior = fim;
    return { inicio, fim, texto: s.texto };
  });
}

/**
 * Os segmentos de qualquer forma que um arquivo de transcrição chega: o que
 * `root-midia transcrever` grava (`{segmentos}`), uma lista crua, ou a saída
 * bruta do `whisper-cli -oj` (`{transcription}`). Nenhum segmento reconhecido é
 * erro — seguir sem eles perderia a palavra de corte em silêncio.
 * @param {unknown} valor
 * @returns {Segmento[]}
 */
export function segmentosDaTranscricao(valor) {
  const v = /** @type {{ segmentos?: unknown, transcription?: unknown }} */ (valor ?? {});
  const lista = Array.isArray(valor)
    ? valor
    : Array.isArray(v.segmentos)
      ? v.segmentos
      : Array.isArray(v.transcription)
        ? segmentosDoWhisper(valor)
        : null;
  if (!lista?.length) {
    throw new Error('A transcrição não traz segmentos (`segmentos`, uma lista, ou o `transcription` do whisper-cli).');
  }
  return lista.map((/** @type {{ inicio?: unknown, fim?: unknown, texto?: unknown }} */ s) => ({
    inicio: Number(s?.inicio),
    fim: Number(s?.fim),
    texto: String(s?.texto ?? '').trim(),
  }));
}

/** @param {number} seg */
function tempoDoSrt(seg) {
  const ms = Math.max(0, Math.round(seg * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const p = (/** @type {number} */ n, /** @type {number} */ d) => String(n).padStart(d, '0');
  return `${p(h, 2)}:${p(m, 2)}:${p(s, 2)},${p(ms % 1000, 3)}`;
}

/**
 * A legenda .srt dos segmentos — a do vídeo final é a que sobe no YouTube (D-MC6).
 * @param {Segmento[]} segmentos
 */
export function srtDosSegmentos(segmentos) {
  return segmentos
    .filter((s) => s.texto.trim())
    .map((s, i) => `${i + 1}\n${tempoDoSrt(s.inicio)} --> ${tempoDoSrt(s.fim)}\n${s.texto.trim()}\n`)
    .join('\n');
}
