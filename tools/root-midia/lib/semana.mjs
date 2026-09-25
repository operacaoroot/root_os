// @ts-check
/*
 * A semana de posts (MC15): as peças por matéria que o OS gera — carrossel,
 * story e corte vertical — renderizadas no Mac. Puro: o processo (ffmpeg,
 * Chrome, o render da máquina de carrossel) roda em root-midia.mjs.
 *
 *  - carrossel: o export do OS vira o `slides.json` da máquina de carrossel
 *    (plugin do Claude Code, `render/render.mjs <pasta>`, 1080×1350), com o
 *    brand pack da marca root;
 *  - story: o template `story.html` (1080×1920) com um frame do episódio, como
 *    o `thumb.html` do MC11;
 *  - corte: o trecho do vídeo final em 1080×1920, a TELA em cima e o ROSTO (o
 *    PiP da cena "2 · Tela + Câmera" do OBS) embaixo, num filtro do ffmpeg.
 */

import { escaparHtml, dimensoesDoPng } from './thumbs.mjs';

/** O corte vertical e o story: 1080×1920. O slide do carrossel: 1080×1350. */
export const LARGURA_VERTICAL = 1080;
export const ALTURA_VERTICAL = 1920;
export const LARGURA_DO_SLIDE = 1080;
export const ALTURA_DO_SLIDE = 1350;
/** O teto do PNG que a API aceita por imagem da peça (PAUTA_PNG_DA_PECA_MAX_BYTES). */
export const TETO_DO_PNG_DA_PECA = 5 * 1024 * 1024;
/** O corte tem menos de 3 min (PAUTA_CORTE_MAXIMO_SEG). */
export const CORTE_MAXIMO_SEG = 180;

/** O canvas da gravação no OBS (perfil "Sem nome": BaseCX/BaseCY). */
export const CANVAS_PADRAO = { largura: 1920, altura: 1080 };

/**
 * A câmera na cena "2 · Tela + Câmera" da coleção "Gravação", lida do JSON do
 * OBS em 24/09/2026: item "Câmera (PiP)" em (1533, 737), caixa 336×299 com
 * "escalar para dentro" centralizada, fonte da C920 em 1280×720 com recorte de
 * 296 à esquerda e 201 à direita — a imagem cai em x 1538,4–1863,6, y 737–1036.
 * Arredondada para dentro em número par (o yuv420 pede): é o padrão quando o
 * JSON do OBS não está à mão. `--pip` ou ROOT_MIDIA_PIP trocam.
 */
export const REGIAO_DO_PIP_PADRAO = { x: 1540, y: 738, largura: 322, altura: 298 };
/** A tela: o canvas inteiro (com o PiP no canto — o rosto aparece grande embaixo). */
export const REGIAO_DA_TELA_PADRAO = { x: 0, y: 0, largura: 1920, altura: 1080 };

/**
 * A tela e o PiP padrão num canvas que não é o 1920×1080: a tela é o canvas
 * inteiro e o PiP medido escala junto (a cena do OBS escala com o canvas).
 * @param {{ largura: number, altura: number }} canvas
 * @returns {{ tela: Regiao, pip: Regiao }}
 */
export function regioesPadraoNoCanvas(canvas) {
  const tela = { x: 0, y: 0, largura: canvas.largura, altura: canvas.altura };
  if (canvas.largura === CANVAS_PADRAO.largura && canvas.altura === CANVAS_PADRAO.altura) return { tela, pip: { ...REGIAO_DO_PIP_PADRAO } };
  const fx = canvas.largura / CANVAS_PADRAO.largura;
  const fy = canvas.altura / CANVAS_PADRAO.altura;
  const p = REGIAO_DO_PIP_PADRAO;
  const pip = paraDentro({ x0: p.x * fx, y0: p.y * fy, x1: (p.x + p.largura) * fx, y1: (p.y + p.altura) * fy }, canvas);
  return { tela, pip };
}

export const CENA_PADRAO = '2 · Tela + Câmera';
export const FONTE_DO_PIP_PADRAO = 'Câmera (PiP)';

/** A cor de fundo da marca (DB do brand pack) nas faixas que sobram da tela. */
export const FUNDO_DA_MARCA = '0x070A08';

/** @typedef {{ x: number, y: number, largura: number, altura: number }} Regiao */

const par = (/** @type {number} */ n) => 2 * Math.round(n / 2);
const parParaCima = (/** @type {number} */ n) => 2 * Math.ceil(n / 2 - 1e-9);
const parParaBaixo = (/** @type {number} */ n) => 2 * Math.floor(n / 2 + 1e-9);

/**
 * `x,y,largura,altura` (ou `x:y:l:a`) → a região, em pixels inteiros.
 * @param {string} texto
 * @returns {Regiao}
 */
export function lerRegiao(texto) {
  const partes = String(texto ?? '').trim().split(/[,:x\s]+/).filter(Boolean).map(Number);
  if (partes.length !== 4 || partes.some((n) => !Number.isInteger(n) || n < 0)) {
    throw new Error(`Região inválida: "${texto}". Use x,y,largura,altura em pixels (ex.: 1540,738,322,298).`);
  }
  const [x, y, largura, altura] = partes;
  if (largura < 16 || altura < 16) throw new Error(`Região pequena demais: ${largura}×${altura}.`);
  return { x, y, largura, altura };
}

/**
 * A região arredondada PARA DENTRO em números pares, cabendo no canvas.
 * @param {{ x0: number, y0: number, x1: number, y1: number }} r
 * @param {{ largura: number, altura: number }} canvas
 * @returns {Regiao}
 */
function paraDentro(r, canvas) {
  const x0 = Math.max(0, parParaCima(r.x0));
  const y0 = Math.max(0, parParaCima(r.y0));
  const x1 = Math.min(parParaBaixo(canvas.largura), parParaBaixo(r.x1));
  const y1 = Math.min(parParaBaixo(canvas.altura), parParaBaixo(r.y1));
  if (x1 - x0 < 16 || y1 - y0 < 16) throw new Error('A região calculada ficou fora do canvas ou pequena demais.');
  return { x: x0, y: y0, largura: x1 - x0, altura: y1 - y0 };
}

/** `AVCaptureSessionPreset1280x720` → 1280×720. @param {unknown} preset */
export function resolucaoDoPreset(preset) {
  const m = /(\d{3,5})x(\d{3,5})/.exec(String(preset ?? ''));
  return m ? { largura: Number(m[1]), altura: Number(m[2]) } : null;
}

const ALINHA = { ESQUERDA: 1, DIREITA: 2, TOPO: 4, BASE: 8 };

/** Onde a caixa começa, dado o ponto de ancoragem do OBS. @param {number} pos @param {number} tamanho @param {number} alinhamento @param {number} menor @param {number} maior */
function inicioPeloAlinhamento(pos, tamanho, alinhamento, menor, maior) {
  if (alinhamento & menor) return pos;
  if (alinhamento & maior) return pos - tamanho;
  return pos - tamanho / 2;
}

/**
 * Onde a câmera aparece no canvas, lida da coleção de cenas do OBS (o JSON de
 * `~/Library/Application Support/obs-studio/basic/scenes/`). Considera o
 * recorte da fonte, a escala, a caixa (`bounds`) e os dois alinhamentos. Tipos
 * de caixa: 0 sem caixa, 1 esticar, 2 escalar para dentro, 4 só largura,
 * 5 só altura, 6 no máximo o tamanho. Só leitura: o arquivo não é tocado.
 * @param {unknown} colecao o JSON da coleção, já lido
 * @param {{ cena?: string, fonte?: string, canvas?: { largura: number, altura: number }, resolucaoDaFonte?: { largura: number, altura: number } | null }} [o]
 * @returns {Regiao}
 */
export function regiaoDoPip(colecao, o = {}) {
  const cena = o.cena ?? CENA_PADRAO;
  const fonte = o.fonte ?? FONTE_DO_PIP_PADRAO;
  const canvas = o.canvas ?? CANVAS_PADRAO;
  const fontes = /** @type {Array<Record<string, any>>} */ ((/** @type {any} */ (colecao))?.sources ?? []);
  const daCena = fontes.find((s) => s?.id === 'scene' && s?.name === cena);
  if (!daCena) throw new Error(`A coleção do OBS não tem a cena "${cena}".`);
  const item = (daCena.settings?.items ?? []).find((/** @type {any} */ i) => i?.name === fonte);
  if (!item) throw new Error(`A cena "${cena}" não tem a fonte "${fonte}".`);
  const origem = fontes.find((s) => s?.name === fonte && s?.id !== 'scene');
  const nativa = o.resolucaoDaFonte ?? resolucaoDoPreset(origem?.settings?.preset);
  if (!nativa) throw new Error(`Não sei a resolução da fonte "${fonte}" (sem preset no OBS): passe --pip x,y,largura,altura.`);

  const cw = nativa.largura - (item.crop_left ?? 0) - (item.crop_right ?? 0);
  const ch = nativa.altura - (item.crop_top ?? 0) - (item.crop_bottom ?? 0);
  if (cw <= 0 || ch <= 0) throw new Error('O recorte da câmera no OBS come a imagem inteira.');
  const pos = { x: Number(item.pos?.x ?? 0), y: Number(item.pos?.y ?? 0) };
  const escala = { x: Number(item.scale?.x ?? 1), y: Number(item.scale?.y ?? 1) };
  const caixa = { l: Number(item.bounds?.x ?? 0), a: Number(item.bounds?.y ?? 0) };
  const tipo = Number(item.bounds_type ?? 0);
  const alinha = Number(item.align ?? ALINHA.ESQUERDA | ALINHA.TOPO);
  const alinhaNaCaixa = Number(item.bounds_align ?? 0);

  let l;
  let a;
  if (tipo === 0) {
    l = cw * Math.abs(escala.x);
    a = ch * Math.abs(escala.y);
    const x0 = inicioPeloAlinhamento(pos.x, l, alinha, ALINHA.ESQUERDA, ALINHA.DIREITA);
    const y0 = inicioPeloAlinhamento(pos.y, a, alinha, ALINHA.TOPO, ALINHA.BASE);
    return paraDentro({ x0, y0, x1: x0 + l, y1: y0 + a }, canvas);
  }
  if (tipo === 1) {
    l = caixa.l;
    a = caixa.a;
  } else if (tipo === 2 || tipo === 6) {
    let s = Math.min(caixa.l / cw, caixa.a / ch);
    if (tipo === 6) s = Math.min(s, 1);
    l = cw * s;
    a = ch * s;
  } else if (tipo === 4) {
    l = caixa.l;
    a = ch * (caixa.l / cw);
  } else if (tipo === 5) {
    a = caixa.a;
    l = cw * (caixa.a / ch);
  } else {
    throw new Error(`Tipo de caixa do OBS que a ferramenta não sabe ler (${tipo}): passe --pip x,y,largura,altura.`);
  }
  const bx = inicioPeloAlinhamento(pos.x, caixa.l, alinha, ALINHA.ESQUERDA, ALINHA.DIREITA);
  const by = inicioPeloAlinhamento(pos.y, caixa.a, alinha, ALINHA.TOPO, ALINHA.BASE);
  const x0 = bx + (alinhaNaCaixa & ALINHA.ESQUERDA ? 0 : alinhaNaCaixa & ALINHA.DIREITA ? caixa.l - l : (caixa.l - l) / 2);
  const y0 = by + (alinhaNaCaixa & ALINHA.TOPO ? 0 : alinhaNaCaixa & ALINHA.BASE ? caixa.a - a : (caixa.a - a) / 2);
  return paraDentro({ x0, y0, x1: x0 + l, y1: y0 + a }, canvas);
}

/**
 * A região do canvas no vídeo que de fato saiu (o OBS pode gravar em outra
 * resolução que o canvas, ou a edição reescalar).
 * @param {Regiao} regiao
 * @param {{ largura: number, altura: number }} canvas
 * @param {{ largura: number, altura: number }} video
 * @returns {Regiao}
 */
export function regiaoNoVideo(regiao, canvas, video) {
  if (regiao.x + regiao.largura > canvas.largura || regiao.y + regiao.altura > canvas.altura) {
    throw new Error(
      `A região ${regiao.x},${regiao.y},${regiao.largura},${regiao.altura} passa do canvas ${canvas.largura}×${canvas.altura} ` +
        '(confira --pip/--tela e --canvas).',
    );
  }
  if (canvas.largura === video.largura && canvas.altura === video.altura) {
    return paraDentro({ x0: regiao.x, y0: regiao.y, x1: regiao.x + regiao.largura, y1: regiao.y + regiao.altura }, video);
  }
  const fx = video.largura / canvas.largura;
  const fy = video.altura / canvas.altura;
  return paraDentro(
    { x0: regiao.x * fx, y0: regiao.y * fy, x1: (regiao.x + regiao.largura) * fx, y1: (regiao.y + regiao.altura) * fy },
    video,
  );
}

/**
 * Quanto do quadro vertical fica com o rosto e quanto com a tela. O rosto
 * ocupa a largura inteira na proporção da região da câmera (a C920 recortada
 * dá ~1000 px de altura); fica entre 640 e 1100 para a tela nunca sumir.
 * @param {Regiao} rosto
 */
export function layoutDoCorte(rosto) {
  const alturaDoRosto = Math.min(1100, Math.max(640, par((LARGURA_VERTICAL * rosto.altura) / rosto.largura)));
  return { alturaDoRosto, alturaDaTela: ALTURA_VERTICAL - alturaDoRosto };
}

/**
 * O filtro do corte vertical: a tela recortada e encaixada na faixa de cima
 * (sem deformar, com as sobras na cor da marca) e o rosto recortado cobrindo a
 * faixa de baixo; as duas empilhadas em 1080×1920.
 * @param {{ tela: Regiao, rosto: Regiao, fundo?: string }} o
 */
export function filtroDoCorteVertical({ tela, rosto, fundo = FUNDO_DA_MARCA }) {
  const { alturaDoRosto, alturaDaTela } = layoutDoCorte(rosto);
  const W = LARGURA_VERTICAL;
  return [
    '[0:v]split=2[t0][r0]',
    `[t0]crop=${tela.largura}:${tela.altura}:${tela.x}:${tela.y},` +
      `scale=${W}:${alturaDaTela}:force_original_aspect_ratio=decrease:force_divisible_by=2,` +
      `pad=${W}:${alturaDaTela}:(ow-iw)/2:(oh-ih)/2:color=${fundo},setsar=1[tela]`,
    `[r0]crop=${rosto.largura}:${rosto.altura}:${rosto.x}:${rosto.y},` +
      `scale=${W}:${alturaDoRosto}:force_original_aspect_ratio=increase,` +
      `crop=${W}:${alturaDoRosto},setsar=1[rosto]`,
    '[tela][rosto]vstack=inputs=2,format=yuv420p[v]',
  ].join(';');
}

/**
 * Os argumentos do ffmpeg para o corte: busca antes do `-i` (rápida e, com
 * reencode, exata), o trecho pela duração, o filtro, o áudio se houver.
 * @param {{ video: string, saida: string, inicio: number, fim: number, filtro: string, audio: boolean, codec: string[], sobrescrever?: boolean }} o
 */
export function argsDoCorteVertical(o) {
  const duracao = o.fim - o.inicio;
  if (!(Number.isFinite(o.inicio) && Number.isFinite(o.fim)) || o.inicio < 0 || duracao <= 0) {
    throw new Error(`Trecho inválido: ${o.inicio}–${o.fim}.`);
  }
  if (duracao >= CORTE_MAXIMO_SEG) throw new Error(`O corte tem ${duracao.toFixed(1)} s; precisa ter menos de 3 minutos.`);
  return [
    '-hide_banner', '-loglevel', 'error', o.sobrescrever ? '-y' : '-n',
    '-ss', o.inicio.toFixed(3), '-t', duracao.toFixed(3), '-i', o.video,
    '-filter_complex', o.filtro, '-map', '[v]',
    // MD4: 48 kHz fixo — a Graph aceita AAC até 48 kHz, e o microfone pode gravar a 96.
    ...(o.audio ? ['-map', '0:a:0', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000'] : ['-an']),
    ...o.codec,
    '-r', '30', '-movflags', '+faststart', o.saida,
  ];
}

/**
 * O frame do story: um quadro no tempo pedido, na largura do story (16:9 →
 * 1080×608), para o template emoldurar.
 * @param {string} video @param {number} tempoSeg @param {string} saida
 */
export function argsDoFrameDoStory(video, tempoSeg, saida) {
  const t = Math.max(0, Number.isFinite(tempoSeg) ? tempoSeg : 0);
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', t.toFixed(3), '-i', video, '-frames:v', '1',
    '-vf', `scale=${LARGURA_VERTICAL}:-2`,
    '-q:v', '3', saida,
  ];
}

const MARCADORES_DO_STORY = ['TEXTO', 'CHAMADA', 'APELIDO', 'FRAME'];

/**
 * O template do story preenchido, todo valor escapado. O frame é o nome de um
 * arquivo na mesma pasta (sem barra, sem `..`).
 * @param {string} template
 * @param {{ texto: string, chamada: string, apelido: string, frame: string }} v
 */
export function preencherStory(template, v) {
  for (const m of MARCADORES_DO_STORY) {
    if (!template.includes(`{{${m}}}`)) throw new Error(`O template do story perdeu o marcador {{${m}}}.`);
  }
  if (!/^[\w.-]+$/.test(v.frame) || v.frame.includes('..')) throw new Error(`Nome de frame inválido: ${v.frame}`);
  const valores = /** @type {Record<string, string>} */ ({
    TEXTO: escaparHtml(v.texto),
    CHAMADA: escaparHtml(v.chamada),
    APELIDO: escaparHtml(v.apelido),
    FRAME: escaparHtml(v.frame),
  });
  return template.replace(/\{\{([A-Z]+)\}\}/g, (inteiro, nome) => (nome in valores ? valores[nome] : inteiro));
}

/**
 * O Chrome sem janela no tamanho pedido (o story é 1080×1920). Perfil próprio
 * numa pasta temporária, como nas thumbs.
 * @param {{ html: string, png: string, perfil: string, largura: number, altura: number }} o
 */
export function argsDoChromeNoTamanho({ html, png, perfil, largura, altura }) {
  return [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
    `--user-data-dir=${perfil}`,
    '--force-device-scale-factor=1',
    `--window-size=${largura},${altura}`,
    '--virtual-time-budget=6000',
    `--screenshot=${png}`,
    `file://${html}`,
  ];
}

/**
 * O PNG saiu no tamanho e abaixo do teto? Nulo = sim; senão, o porquê.
 * @param {Uint8Array} b @param {number} largura @param {number} altura @param {number} [teto]
 */
export function conferirPngNoTamanho(b, largura, altura, teto = TETO_DO_PNG_DA_PECA) {
  const d = dimensoesDoPng(b);
  if (!d) return 'O render não saiu PNG.';
  if (d.largura !== largura || d.altura !== altura) return `O render saiu ${d.largura}×${d.altura}; a peça é ${largura}×${altura}.`;
  if (b.length > teto) return `O PNG tem ${Math.round(b.length / 1024)} kB; o teto é ${Math.round(teto / 1024 / 1024)} MB.`;
  return null;
}

/**
 * O `slides.json` da máquina de carrossel a partir da peça do OS: o slide 1 é
 * a capa, o último é o fechamento com o CTA da palavra-chave, os do meio são
 * conteúdo alternando claro e escuro. O render da máquina põe o texto no HTML
 * CRU (aceita `<strong>`/`<em>`), então tudo aqui entra escapado.
 * @param {{ titulo: string, slides: Array<{ titulo: string, texto: string }>, cta?: { instrucao: string, palavra: string, beneficio: string } | null, palavraChave?: string | null }} peca
 * @param {{ handle: string, marcaRef: string, apelido: string, marca?: string }} o
 */
export function slidesParaAMaquina(peca, o) {
  const slides = Array.isArray(peca.slides) ? peca.slides : [];
  if (slides.length < 4) throw new Error(`O carrossel tem ${slides.length} slide(s); a máquina pede pelo menos 4.`);
  if (slides.length > 10) throw new Error(`O carrossel tem ${slides.length} slides; a máquina aceita até 10.`);
  const palavra = peca.cta?.palavra || peca.palavraChave || '';
  if (!palavra) throw new Error('O carrossel não tem a palavra-chave do CTA: gere a semana de novo no OS.');
  const n = slides.length;
  return {
    meta: {
      handle: o.handle,
      marca: o.marca ?? 'root',
      tipo_badge: escaparHtml(o.apelido.toUpperCase()),
      framework: 'raio-x',
      // O render põe o tema cru no preview.html da pasta, que a pessoa abre no navegador.
      tema: escaparHtml(peca.titulo ?? ''),
    },
    brand_pack_ref: o.marcaRef,
    slides: slides.map((s, i) => {
      const ordem = i + 1;
      if (i === 0) {
        return { ordem, bg: 'dark', papel: 'capa', tipo: 'capa', headline: escaparHtml(s.titulo || s.texto) };
      }
      if (i === n - 1) {
        return {
          ordem,
          bg: 'gradient',
          papel: 'cta',
          tipo: 'fechamento',
          tag: 'PALAVRA-CHAVE',
          cta: {
            instrucao: escaparHtml(peca.cta?.instrucao ?? 'Comentário com a palavra'),
            palavra: escaparHtml(palavra),
            beneficio: escaparHtml(peca.cta?.beneficio ?? 'O link da matéria e o episódio completo chegam no direct.'),
          },
        };
      }
      return {
        ordem,
        bg: i % 2 === 1 ? 'light' : 'dark',
        papel: 'conteudo',
        tipo: 'conteudo',
        ...(s.titulo ? { headline: escaparHtml(s.titulo) } : {}),
        ...(s.texto ? { blocos: [escaparHtml(s.texto)] } : {}),
      };
    }),
  };
}

/**
 * Os slides em que o texto estourou a caixa, lidos do `report.json` que o
 * render da máquina de carrossel grava na pasta: ele sai com código 0 mesmo
 * assim, e o PNG leva o texto cortado.
 * @param {unknown} report
 * @returns {Array<{ n: number, excessoPx: number }>}
 */
export function slidesEstourados(report) {
  const r = report && typeof report === 'object' ? /** @type {Record<string, unknown>} */ (report) : {};
  const lista = Array.isArray(r.overflow) ? r.overflow : [];
  const saida = [];
  for (const o of lista) {
    /** @type {Record<string, unknown>} */
    const item = o && typeof o === 'object' ? /** @type {Record<string, unknown>} */ (o) : { id: o };
    const n = Number(/(\d+)$/.exec(String(item.id ?? ''))?.[1]);
    if (Number.isInteger(n) && n > 0) saida.push({ n, excessoPx: Number(item.excesso_px) || 0 });
  }
  if (!saida.length && r.ok === false) saida.push({ n: 0, excessoPx: 0 });
  return saida.sort((a, b) => a.n - b.n);
}

/**
 * Onde está o render da máquina de carrossel: o apontado em
 * ROOT_MIDIA_CARROSSEL_RENDER, senão o do plugin instalado — só vale o que tem
 * o `node_modules/playwright` ao lado (o `setup` do plugin instala).
 * @param {Record<string, string | undefined>} env
 * @param {string} home
 * @param {string[]} versoesNoCache as pastas de versão em `~/.claude/plugins/cache/maquina-carrossel-marketplace/maquina-carrossel/`
 */
export function candidatosDoRender(env, home, versoesNoCache = []) {
  const plugins = `${home}/.claude/plugins`;
  return [
    (env.ROOT_MIDIA_CARROSSEL_RENDER ?? '').trim(),
    `${plugins}/marketplaces/maquina-carrossel-marketplace/plugins/maquina-carrossel/render/render.mjs`,
    ...[...versoesNoCache]
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map((v) => `${plugins}/cache/maquina-carrossel-marketplace/maquina-carrossel/${v}/render/render.mjs`),
  ].filter(Boolean);
}

/** O brand pack da marca root da máquina de carrossel. @param {Record<string, string | undefined>} env @param {string} home */
export function marcaDoCarrossel(env, home) {
  return (env.ROOT_MIDIA_MARCA ?? '').trim() || `${home}/.maquina-carrossel/marcas/root/brand.json`;
}

/** @param {string} apelido @param {number} n */
export const nomeDoCorte = (apelido, n) => `${apelido}-m${n}-corte.mp4`;
/** @param {string} apelido @param {number} n */
export const nomeDoStory = (apelido, n) => `${apelido}-m${n}-story.png`;
/** @param {string} apelido @param {number} n */
export const pastaDoCarrossel = (apelido, n) => `${apelido}-m${n}-carrossel`;

/**
 * MD13: qual dos candidatos ao corte a peça usa, para o log do render: vazio
 * sem candidatos, ou com o trecho editado à mão (nenhum em uso).
 * @param {{ candidatos?: Array<{ n: number, nota: number | null, atual: boolean }> }} p
 */
export function rotuloDoCandidato(p) {
  const lista = Array.isArray(p.candidatos) ? p.candidatos : [];
  const atual = lista.find((c) => c.atual);
  if (!atual || lista.length < 2) return '';
  const nota = typeof atual.nota === 'number' ? `, nota ${String(atual.nota).replace('.', ',')}` : '';
  return ` (candidato ${atual.n} de ${lista.length}${nota})`;
}

/**
 * A peça ainda aceita render? Aprovada aceita (o render é o que falta para
 * postar); publicada e descartada, não. A que foi gerada de outra transcrição
 * também não: o trecho e o frame dela são tempos do vídeo anterior, e cortar
 * o final novo nesses tempos sai outra fala sem erro nenhum.
 * @param {{ status: string, transcricaoMudou?: boolean }} p
 */
export function aceitaRender(p) {
  return (p.status === 'rascunho' || p.status === 'aprovada') && p.transcricaoMudou !== true;
}

/**
 * MD6: onde a publicação pelo OS está, com as mesmas palavras da aba Semana.
 * @type {Record<string, string>}
 */
const ROTULO_DA_PUBLICACAO = {
  pendente: 'esperando a confirmação de outra pessoa em /atendimento',
  container_criado: 'enviada à Meta',
  processando: 'a Meta está processando',
  publicada: 'publicada pelo OS',
  erro: 'a publicação falhou',
  recusada: 'de volta ao manual',
};

/**
 * O calendário da semana (MC16) em linhas para o terminal: um dia por bloco,
 * cada slot com o horário, o formato, a peça e onde está a mídia para postar à
 * mão — o PNG no OS (baixar pela tela) ou o mp4 que ficou no Mac, pelo caminho;
 * o carrossel que subiu pela metade diz quantos PNG faltam. O slot só proposto
 * pelo encadeamento (MD1) diz que falta aprovar; a publicação pelo OS (MD6), onde
 * ela está; o lote da semana (MD8), se está assinado ou na fila; e quantos
 * comentários esperam a DM à mão (MD9), sem dizer quem. Só lê: postar, publicar,
 * aprovar a semana, marcar como postada e responder são da tela.
 * @param {any} agenda o `GET /pauta/agenda`
 * @returns {string[]}
 */
export function linhasDaAgenda(agenda) {
  const linhas = [];
  const data = (/** @type {string} */ d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  for (const d of agenda?.dias ?? []) {
    linhas.push(`${d.diaDaSemana} ${data(d.dia)}${d.feriado ? ` · ${d.feriado} (sem slot)` : ''}`);
    if (!d.linhas?.length) {
      linhas.push('  —');
      continue;
    }
    for (const l of d.linhas) {
      const p = l.peca;
      if (!p) {
        linhas.push(`  ${l.hora}  ${l.formato.padEnd(9)}  (vago)`);
        continue;
      }
      // MD1: o slot só PROPOSTO pelo encadeamento não é agenda — não se posta.
      const proposta = !p.postada && !p.agendadaPara && !!p.slotProposto;
      const estado = p.postada
        ? `postada${p.postada.url ? ` ${p.postada.url}` : ''}`
        : proposta
          ? `proposto, falta ${p.status === 'aprovada' ? 'distribuir' : 'aprovar'}`
          : p.status;
      const midia =
        p.midia?.onde === 'video'
          ? `mp4 no OS (${Math.round((p.midia.bytes ?? 0) / 1024 / 1024)} MB; baixe na aba Semana)${p.midia.arquivo ? ` e no Mac: ${p.midia.arquivo}` : ''}`
          : p.midia?.onde === 'mac'
          ? `mp4 no Mac: ${p.midia.arquivo}`
          : p.midia?.onde === 'storage'
            ? `${p.midia.imagens.length} PNG no OS`
            : p.midia?.onde === 'parcial'
              ? `${p.midia.imagens.length} de ${p.midia.esperadas} PNG no OS (falta: ${p.midia.faltam.join(', ')}) — não poste ainda; ${p.midia.comando}`
              : `sem mídia — ${p.midia?.comando ?? 'rode a /root-midia'}`;
      linhas.push(`  ${l.hora}  ${l.formato.padEnd(9)}  ${p.apelido} m${p.itemN}  ${estado}${l.daGrade ? '' : ' (fora da grade)'}  ${p.titulo}`);
      linhas.push(`         ${midia}`);
      // MD6: a publicação pelo OS, quando alguém pediu e a peça ainda não foi ao ar.
      const pub = p.publicacao;
      if (pub && !p.postada) {
        linhas.push(`         Instagram pelo OS: ${ROTULO_DA_PUBLICACAO[pub.estado] ?? pub.estado}${pub.erro ? ` — ${pub.erro}` : ''}`);
      }
      // MD8: o item da peça no lote da semana — assinado, sai sozinho no horário; na fila, espera a titular.
      const lote = p.lote;
      if (lote && lote.estadoDoItem === 'ativo' && !p.postada && !pub) {
        linhas.push(
          lote.estadoDoLote === 'ativo'
            ? `         semana assinada: sai pelo OS no horário${agenda?.publicacaoAutomatica === false ? ' — mas a publicação automática está DESLIGADA' : ''}`
            : '         semana na fila: esperando a assinatura de outra pessoa em /atendimento',
        );
      }
    }
  }
  const pendentes = agenda?.paraDistribuir ?? [];
  for (const e of pendentes) linhas.push(`${e.apelido}: ${e.aprovadasSemData} aprovada(s) sem data — "Distribuir" na aba Semana.`);
  // MD9: a fila da DM à mão. Só o número: o @ de quem comentou não sai da tela.
  const dm = agenda?.comentariosPendentes ?? 0;
  if (dm > 0) linhas.push(`${dm} comentário(s) com a palavra-chave esperando a DM à mão — "Quem comentou e o que responder" na aba Semana.`);
  return linhas;
}


/*
 * MD4: a mídia sobe ao OS. O mp4 do corte vai inteiro ao storage da VPS (a Meta
 * baixa de lá por URL assinada) e cada PNG ganha um JPEG ao lado, que é o que a
 * Graph aceita. Nada no Mac é apagado.
 */

/** O teto do JPEG que a API aceita (PAUTA_JPEG_DA_PECA_MAX_BYTES). */
export const TETO_DO_JPEG_DA_PECA = 8 * 1024 * 1024;
/** O teto do mp4 do corte que a API aceita por padrão (PAUTA_VIDEO_MAX_BYTES). */
export const TETO_DO_MP4_DO_CORTE = 300 * 1024 * 1024;

/**
 * O `sips` do macOS converte o PNG em JPEG com qualidade 90 — nativo, sem
 * dependência. A saída é um arquivo novo ao lado; o PNG fica.
 * @param {string} png @param {string} jpg
 */
export function argsDoSips(png, jpg) {
  if (!/\.png$/i.test(png) || !/\.jpe?g$/i.test(jpg)) throw new Error('O sips converte .png em .jpg.');
  return ['-s', 'format', 'jpeg', '-s', 'formatOptions', '90', png, '--out', jpg];
}

/** O nome do JPEG ao lado do PNG. @param {string} png */
export const jpegDoPng = (png) => png.replace(/\.png$/i, '.jpg');

/**
 * Largura e altura do JPEG pelo marcador SOF (a mesma leitura da API, em
 * `apps/api/src/pauta/imagem-jpeg.ts`), ou nulo se não for JPEG.
 * @param {Uint8Array} b
 */
export function dimensoesDoJpeg(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[2] !== 0xff) return null;
  const u16 = (/** @type {number} */ i) => (b[i] << 8) | b[i + 1];
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null;
    while (i < b.length && b[i] === 0xff) i++;
    const m = b[i++];
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd9)) continue;
    const comprimento = u16(i);
    if (comprimento < 2) return null;
    if (m === 0xc0 || m === 0xc1 || m === 0xc2) return { largura: u16(i + 5), altura: u16(i + 3) };
    if (m === 0xda) return null;
    i += comprimento;
  }
  return null;
}

/**
 * O JPEG saiu na proporção da peça, na faixa de largura da Meta e abaixo do
 * teto? Nulo = sim; senão, o porquê.
 * @param {Uint8Array} b @param {number} largura @param {number} altura
 */
export function conferirJpegNoTamanho(b, largura, altura) {
  const d = dimensoesDoJpeg(b);
  if (!d) return 'A conversão não saiu JPEG.';
  if (d.largura !== largura || d.altura !== altura) return `O JPEG saiu ${d.largura}×${d.altura}; a peça é ${largura}×${altura}.`;
  if (b.length > TETO_DO_JPEG_DA_PECA) return `O JPEG tem ${Math.round(b.length / 1024)} kB; o teto é 8 MB.`;
  return null;
}

/**
 * As caixas de topo do mp4, lidas só pelos cabeçalhos (16 bytes por caixa),
 * sem carregar o arquivo. `ler(offset, n)` devolve os bytes daquele trecho.
 * @param {(offset: number, n: number) => Uint8Array} ler
 * @param {number} tamanho o tamanho do arquivo
 * @returns {Array<{ tipo: string, inicio: number, tamanho: number }>}
 */
export function caixasDeTopo(ler, tamanho) {
  const caixas = [];
  let i = 0;
  while (i + 8 <= tamanho && caixas.length < 1000) {
    const cab = ler(i, 16);
    const v = new DataView(cab.buffer, cab.byteOffset, cab.byteLength);
    let t = v.getUint32(0);
    const tipo = String.fromCharCode(cab[4], cab[5], cab[6], cab[7]);
    if (t === 1) t = Number(v.getBigUint64(8));
    else if (t === 0) t = tamanho - i;
    if (t < 8 || i + t > tamanho) throw new Error(`A caixa "${tipo}" do mp4 passa do fim do arquivo: o mp4 está truncado.`);
    caixas.push({ tipo, inicio: i, tamanho: t });
    i += t;
  }
  return caixas;
}

/**
 * O que a Graph pede das caixas de topo: `ftyp` primeiro e `moov` antes do
 * `mdat` (o `+faststart` do ffmpeg). Nulo = ok.
 * @param {Array<{ tipo: string }>} caixas
 */
export function motivoSemFaststart(caixas) {
  const tipos = caixas.map((c) => c.tipo);
  if (tipos[0] !== 'ftyp') return 'O arquivo não é mp4 (a primeira caixa não é ftyp).';
  const moov = tipos.indexOf('moov');
  const mdat = tipos.indexOf('mdat');
  if (moov < 0 || mdat < 0) return 'O mp4 não tem moov e mdat.';
  if (moov > mdat) return 'O mp4 não tem faststart (o moov vem depois do mdat): renderize de novo, o ffmpeg põe -movflags +faststart.';
  return null;
}

/**
 * O mp4 do corte já está no OS com este conteúdo? Reenviar é idempotente pelo
 * sha256: o mesmo arquivo não sobe de novo.
 * @param {{ video?: { sha256?: string | null } | null }} peca @param {string} sha256
 */
export const videoJaNoOs = (peca, sha256) => !!peca.video?.sha256 && peca.video.sha256 === sha256;

/**
 * MD4: o corte vai ao OS — o registro do caminho no Mac (MC15) e o próprio mp4.
 * A falha do envio fica neste corte: volta `subiu: false` com o motivo, e o laço
 * segue para o próximo. Sem caminho para o mp4 (o proxy do web), nem tenta; e,
 * se a peça já tem um mp4 no OS, também não registra de novo, porque o registro
 * apaga a referência a ele.
 *
 * Desde a MD13 os dois levam o trecho que foi renderizado (o `inicio`/`fim`
 * da peça lida antes do render): se a pessoa trocou de candidato enquanto o
 * ffmpeg rodava, o OS responde 409, e o corte fica para a próxima passagem.
 * @param {{ videoDoCorte: (id: string, corpo: unknown) => Promise<unknown>, enviarVideoDoCorte: (id: string, a: { abrir: () => AsyncIterable<Uint8Array>, bytes: number, sha256: string, trecho?: { inicio: number, fim: number } }) => Promise<unknown>, motivoParaNaoEnviar: (bytes: number) => string | null }} os
 * @param {{ id: string, inicio?: number, fim?: number, video?: { sha256?: string | null } | null }} peca
 * @param {{ bytes: number }} corpo o que o PUT registra
 * @param {{ sha256: string, abrir: () => AsyncIterable<Uint8Array> }} arquivo
 * @returns {Promise<{ sha256: string, subiu: boolean, motivo?: string }>}
 */
export async function subirCorteAoOs(os, peca, corpo, arquivo) {
  const { sha256 } = arquivo;
  if (videoJaNoOs(peca, sha256)) return { sha256, subiu: false };
  const barrado = os.motivoParaNaoEnviar(corpo.bytes);
  if (barrado && peca.video?.sha256) return { sha256, subiu: false, motivo: barrado };
  const trecho = typeof peca.inicio === 'number' && typeof peca.fim === 'number' ? { inicio: peca.inicio, fim: peca.fim } : undefined;
  try {
    await os.videoDoCorte(peca.id, { ...corpo, ...trecho });
  } catch (e) {
    const motivo = /** @type {Error} */ (e)?.message ?? String(e);
    if (/HTTP 409\b/.test(motivo)) return { sha256, subiu: false, motivo };
    throw e;
  }
  if (barrado) return { sha256, subiu: false, motivo: barrado };
  try {
    await os.enviarVideoDoCorte(peca.id, { abrir: arquivo.abrir, bytes: corpo.bytes, sha256, ...(trecho ? { trecho } : {}) });
  } catch (e) {
    return { sha256, subiu: false, motivo: /** @type {Error} */ (e)?.message ?? String(e) };
  }
  return { sha256, subiu: true };
}

/**
 * O JPEG n da peça já está no OS com este conteúdo?
 * @param {{ jpegs?: Array<{ n: number, sha256?: string }> }} peca @param {number} n @param {string} sha256
 */
export const jpegJaNoOs = (peca, n, sha256) => (peca.jpegs ?? []).some((j) => j.n === n && j.sha256 === sha256);
