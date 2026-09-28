// @ts-check
/*
 * As thumbs do episódio (MC11, D-MC4): o brief que o OS devolve vira PNG num
 * template HTML da marca (`thumb.html`), com o frame do vídeo final de fundo,
 * renderizado por um Chrome sem janela. Puro: o processo roda em root-midia.mjs.
 */

/** A thumb do YouTube: 1280×720, até 2 MB (o mesmo teto da API). */
export const LARGURA = 1280;
export const ALTURA = 720;
export const TETO_DO_PNG = 2 * 1024 * 1024;

/** O apoio padrão sob o título, na fonte de texto da marca. */
export const APOIO_PADRAO = 'IA aplicada ao negócio';

/** @param {unknown} s */
export function escaparHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** @param {string} s */
function chave(s) {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * O texto com a palavra de destaque embrulhada (só a primeira ocorrência), já
 * escapado. Destaque que não está no texto não destaca nada.
 * @param {string} texto @param {string} destaque
 */
export function textoComDestaque(texto, destaque) {
  const alvo = chave(String(destaque ?? ''));
  let feito = false;
  return String(texto ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => {
      if (!feito && alvo && chave(p) === alvo) {
        feito = true;
        return `<span class="destaque">${escaparHtml(p)}</span>`;
      }
      return escaparHtml(p);
    })
    .join(' ');
}

const MARCADORES = ['TEXTO', 'APOIO', 'APELIDO', 'FRAME'];

/**
 * O template preenchido. Todo valor entra escapado; o frame é o nome de um
 * arquivo na mesma pasta do HTML (sem barra, sem `..`).
 * @param {string} template
 * @param {{ texto: string, destaque: string, apoio?: string, apelido: string, frame: string }} v
 */
export function preencherThumb(template, v) {
  for (const m of MARCADORES) {
    if (!template.includes(`{{${m}}}`)) throw new Error(`O template da thumb perdeu o marcador {{${m}}}.`);
  }
  if (!/^[\w.-]+$/.test(v.frame) || v.frame.includes('..')) throw new Error(`Nome de frame inválido: ${v.frame}`);
  const valores = /** @type {Record<string, string>} */ ({
    TEXTO: textoComDestaque(v.texto, v.destaque),
    APOIO: escaparHtml(v.apoio || APOIO_PADRAO),
    APELIDO: escaparHtml(v.apelido),
    FRAME: escaparHtml(v.frame),
  });
  return template.replace(/\{\{([A-Z]+)\}\}/g, (inteiro, nome) => (nome in valores ? valores[nome] : inteiro));
}

/**
 * O frame do fundo: um quadro no tempo sugerido, cobrindo 1280×720.
 * @param {string} video @param {number} tempoSeg @param {string} saida
 */
export function argsDoFrame(video, tempoSeg, saida) {
  const t = Math.max(0, Number.isFinite(tempoSeg) ? tempoSeg : 0);
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', t.toFixed(3), '-i', video, '-frames:v', '1',
    '-vf', `scale=${LARGURA}:${ALTURA}:force_original_aspect_ratio=increase,crop=${LARGURA}:${ALTURA}`,
    '-q:v', '3', saida,
  ];
}

/**
 * Os argumentos do Chrome sem janela. Perfil próprio numa pasta temporária: o
 * Chrome do Pedro aberto não pode receber o pedido (nem emprestar o perfil).
 * @param {{ html: string, png: string, perfil: string }} o
 */
export function argsDoChrome({ html, png, perfil }) {
  return [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
    `--user-data-dir=${perfil}`,
    '--force-device-scale-factor=1',
    `--window-size=${LARGURA},${ALTURA}`,
    '--virtual-time-budget=6000',
    `--screenshot=${png}`,
    `file://${html}`,
  ];
}

/**
 * Onde procurar o Chrome, na ordem: o que o Pedro apontou, o Chrome e o
 * Chromium instalados, e o Chrome for Testing que o agent-browser já baixou.
 * @param {Record<string, string | undefined>} env
 * @param {string[]} [pastasDoAgentBrowser] as pastas `chrome-*` de ~/.agent-browser/browsers
 */
export function candidatosDoChrome(env, pastasDoAgentBrowser = []) {
  const lista = [
    (env.ROOT_MIDIA_CHROME ?? '').trim(),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ...[...pastasDoAgentBrowser]
      .sort()
      .reverse()
      .map((p) => `${p}/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`),
  ];
  return lista.filter(Boolean);
}

/**
 * Largura e altura pelo cabeçalho IHDR; nulo quando não é PNG.
 * @param {Uint8Array} b
 */
export function dimensoesDoPng(b) {
  const assinatura = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!b || b.length < 24 || assinatura.some((x, i) => b[i] !== x)) return null;
  if (String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') return null;
  const u32 = (/** @type {number} */ i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  return { largura: u32(16), altura: u32(20) };
}

/**
 * O PNG renderizado está no ponto de subir? Nulo = sim; senão, o porquê.
 * @param {Uint8Array} b
 */
export function conferirPng(b) {
  const d = dimensoesDoPng(b);
  if (!d) return 'O render não saiu PNG.';
  if (d.largura !== LARGURA || d.altura !== ALTURA) return `O render saiu ${d.largura}×${d.altura}; a thumb é ${LARGURA}×${ALTURA}.`;
  if (b.length > TETO_DO_PNG) return `O PNG tem ${Math.round(b.length / 1024)} kB; o teto do YouTube é 2 MB.`;
  return null;
}

/** @param {string} apelido @param {number} n */
export function nomeDaThumb(apelido, n) {
  return `${apelido}-thumb-${n}.png`;
}
