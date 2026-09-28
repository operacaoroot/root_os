// @ts-check
/*
 * A EDIÇÃO, em funções puras: ler o silencedetect do ffmpeg, achar a palavra de
 * corte na transcrição do bruto, e chegar à lista do que MANTER. Sem processo,
 * sem arquivo — é o que `apps/api/test/root-midia.test.ts` testa.
 *
 * A HEURÍSTICA DA PALAVRA DE CORTE (D-MC2). Quem grava erra, diz a palavra
 * ("root, corta"), respira e repete a frase inteira. Ao achar a palavra num
 * segmento da transcrição, cortam-se ESSE segmento e o ANTERIOR — o anterior é
 * a tomada errada — e a respiração até a retomada, deixando a margem antes do
 * segmento seguinte (senão sobra o fim da palavra entre dois cortes). Limites
 * conhecidos, escritos para ninguém confiar mais do que deve:
 *   - o whisper decide onde um segmento começa; se a tomada errada ocupou dois
 *     segmentos, sobra o primeiro deles (a revisão do corte pega);
 *   - se a palavra caiu no MEIO de um segmento junto com a repetição, a
 *     repetição some junto (o segmento inteiro sai);
 *   - a palavra é comparada sem acento, caixa ou pontuação ("Root, corta." =
 *     "root corta"), mas uma transcrição torta ("rute corta") não casa.
 */

/** @typedef {{ inicio: number, fim: number }} Intervalo */
/** @typedef {{ inicio: number, fim: number, texto: string }} Segmento */
/** @typedef {'silencio' | 'palavra-de-corte' | 'manual'} Motivo */
/** @typedef {{ inicio: number, fim: number, motivo: Motivo }} Corte */

export const PALAVRA_PADRAO = 'root, corta';

/** Os padrões do corte de silêncio: o que o ouvido não sente falta. */
export const PADROES = Object.freeze({
  /** Abaixo disto é silêncio (dB). -35 pega respiração leve como silêncio sem comer fala baixa. */
  ruidoDb: -35,
  /** Silêncio mais curto que isto fica: é a pausa natural da fala. */
  minimoSeg: 0.8,
  /** Quanto de silêncio fica de cada lado da fala, para a palavra não sair cortada. */
  margemSeg: 0.2,
  /** Pedaço mantido mais curto que isto vira corte: é um estalo entre dois silêncios. */
  mantidoMinimoSeg: 0.15,
});

/** @param {number} n */
function arred(n) {
  return Math.round(n * 1000) / 1000;
}

/**
 * Lê a saída de `ffmpeg -af silencedetect` (stderr). Silêncio aberto no fim do
 * arquivo (começou e o arquivo acabou) fecha em `duracao`; sem ela, fica fora.
 * @param {string} texto
 * @param {number} [duracao]
 * @returns {Intervalo[]}
 */
export function lerSilencedetect(texto, duracao) {
  /** @type {Intervalo[]} */
  const saida = [];
  /** @type {number | null} */
  let aberto = null;
  for (const linha of String(texto ?? '').split(/\r?\n/)) {
    const ini = /silence_start:\s*(-?[\d.]+(?:e-?\d+)?)/.exec(linha);
    if (ini) {
      aberto = Math.max(0, Number(ini[1]));
      continue;
    }
    const fim = /silence_end:\s*(-?[\d.]+(?:e-?\d+)?)/.exec(linha);
    if (fim && aberto !== null) {
      const f = Number(fim[1]);
      if (Number.isFinite(f) && f > aberto) saida.push({ inicio: arred(aberto), fim: arred(f) });
      aberto = null;
    }
  }
  if (aberto !== null && typeof duracao === 'number' && duracao > aberto) {
    saida.push({ inicio: arred(aberto), fim: arred(duracao) });
  }
  return saida;
}

/**
 * Ordena e junta o que se sobrepõe ou encosta.
 * @template {Intervalo} T
 * @param {T[]} lista
 * @returns {Intervalo[]}
 */
export function unirIntervalos(lista) {
  const ordenada = lista
    .filter((i) => Number.isFinite(i.inicio) && Number.isFinite(i.fim) && i.fim > i.inicio)
    .map((i) => ({ inicio: i.inicio, fim: i.fim }))
    .sort((a, b) => a.inicio - b.inicio);
  /** @type {Intervalo[]} */
  const saida = [];
  for (const i of ordenada) {
    const ultimo = saida[saida.length - 1];
    if (ultimo && i.inicio <= ultimo.fim + 0.001) ultimo.fim = Math.max(ultimo.fim, i.fim);
    else saida.push({ ...i });
  }
  return saida;
}

/**
 * O que sai de cada silêncio longo: o miolo, deixando a margem dos dois lados.
 * No começo e no fim do arquivo não há fala a proteger — sai inteiro.
 * @param {Intervalo[]} silencios
 * @param {{ duracao: number, minimoSeg?: number, margemSeg?: number }} opcoes
 * @returns {Intervalo[]}
 */
export function cortesDosSilencios(silencios, { duracao, minimoSeg = PADROES.minimoSeg, margemSeg = PADROES.margemSeg }) {
  /** @type {Intervalo[]} */
  const saida = [];
  for (const s of silencios) {
    if (s.fim - s.inicio < minimoSeg) continue;
    const inicio = s.inicio <= 0.05 ? 0 : s.inicio + margemSeg;
    const fim = s.fim >= duracao - 0.05 ? duracao : s.fim - margemSeg;
    if (fim - inicio > 0.001) saida.push({ inicio: arred(inicio), fim: arred(fim) });
  }
  return saida;
}

/**
 * Minúsculas, sem acento, sem pontuação, espaços simples.
 * @param {string} texto
 */
export function normalizarTexto(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * A heurística da palavra de corte (ver o topo do arquivo): cada segmento que
 * traz a palavra sai junto com o anterior, que é a tomada errada, e com a pausa
 * até o seguinte, menos a margem.
 * @param {Segmento[]} segmentos — da transcrição do BRUTO, em ordem
 * @param {string} palavra
 * @param {{ margemSeg?: number }} [opcoes]
 * @returns {Array<Intervalo & { trecho: string }>}
 */
export function cortesDaPalavra(segmentos, palavra, { margemSeg = PADROES.margemSeg } = {}) {
  const alvo = normalizarTexto(palavra);
  if (!alvo) return [];
  const saida = [];
  for (let i = 0; i < segmentos.length; i++) {
    if (!` ${normalizarTexto(segmentos[i].texto)} `.includes(` ${alvo} `)) continue;
    const de = i > 0 ? segmentos[i - 1] : segmentos[i];
    const seguinte = segmentos[i + 1];
    const fim = seguinte ? Math.max(segmentos[i].fim, seguinte.inicio - margemSeg) : segmentos[i].fim;
    saida.push({
      inicio: arred(de.inicio),
      fim: arred(fim),
      trecho: (i > 0 ? `${segmentos[i - 1].texto.trim()} | ` : '') + segmentos[i].texto.trim(),
    });
  }
  return saida;
}

/**
 * O que MANTER: o complemento do que sai, dentro de [0, duracao]. Pedaço
 * mantido curto demais (um estalo entre dois cortes) vai junto com os cortes.
 * @param {{ duracao: number, remover: Intervalo[], mantidoMinimoSeg?: number }} opcoes
 * @returns {Intervalo[]}
 */
export function intervalosAManter({ duracao, remover, mantidoMinimoSeg = PADROES.mantidoMinimoSeg }) {
  const fora = unirIntervalos(
    remover.map((r) => ({ inicio: Math.max(0, r.inicio), fim: Math.min(duracao, r.fim) })),
  );
  /** @type {Intervalo[]} */
  const manter = [];
  let cursor = 0;
  for (const r of fora) {
    if (r.inicio - cursor >= mantidoMinimoSeg) manter.push({ inicio: arred(cursor), fim: arred(r.inicio) });
    cursor = Math.max(cursor, r.fim);
  }
  if (duracao - cursor >= mantidoMinimoSeg) manter.push({ inicio: arred(cursor), fim: arred(duracao) });
  return manter;
}

/**
 * O que saiu, como o OS guarda: o complemento de `manter`, cada corte com o
 * motivo — palavra de corte se encosta num trecho da palavra, senão silêncio.
 * @param {{ duracao: number, manter: Intervalo[], daPalavra?: Intervalo[] }} opcoes
 * @returns {Corte[]}
 */
export function cortesRemovidos({ duracao, manter, daPalavra = [] }) {
  /** @type {Corte[]} */
  const saida = [];
  let cursor = 0;
  const empurra = (/** @type {number} */ inicio, /** @type {number} */ fim) => {
    if (fim - inicio <= 0.001) return;
    const palavra = daPalavra.some((p) => p.inicio < fim && p.fim > inicio);
    saida.push({ inicio: arred(inicio), fim: arred(fim), motivo: palavra ? 'palavra-de-corte' : 'silencio' });
  };
  for (const m of manter) {
    empurra(cursor, m.inicio);
    cursor = m.fim;
  }
  empurra(cursor, duracao);
  return saida;
}

/**
 * Os cortes que o vídeo final de fato tem: o complemento do `manter` que foi
 * cortado, não os `removidos` que o `cortes` calculou — o `manter` pode ter sido
 * ajustado à mão depois. O pedaço que sai e não estava nos `removidos` originais
 * é `manual`; o resto guarda o motivo (palavra de corte se encosta numa tomada
 * errada, senão silêncio).
 * @param {{ duracaoBrutoSeg?: unknown, manter?: unknown, removidos?: unknown, tomadasErradas?: unknown }} plano
 * @param {number} [duracaoMedidaSeg] a do bruto medida, quando o plano não traz
 * @returns {Corte[]}
 */
export function cortesAplicados(plano, duracaoMedidaSeg) {
  const duracao = Number(plano?.duracaoBrutoSeg ?? duracaoMedidaSeg);
  if (!Number.isFinite(duracao) || duracao <= 0) throw new Error('O cortes.json não traz `duracaoBrutoSeg`.');
  const manter = lerManter(plano);
  const daPalavra = Array.isArray(plano.tomadasErradas) ? /** @type {Intervalo[]} */ (plano.tomadasErradas) : [];
  const saidos = cortesRemovidos({ duracao, manter, daPalavra });
  if (!Array.isArray(plano.removidos)) return saidos;
  const previstos = unirIntervalos(/** @type {Intervalo[]} */ (plano.removidos));
  /** @type {Corte[]} */
  const saida = [];
  const empurra = (/** @type {number} */ inicio, /** @type {number} */ fim, /** @type {Motivo} */ motivo) => {
    if (fim - inicio > 0.001) saida.push({ inicio: arred(inicio), fim: arred(fim), motivo });
  };
  for (const c of saidos) {
    let cursor = c.inicio;
    for (const p of previstos) {
      if (p.fim <= cursor || p.inicio >= c.fim) continue;
      const de = Math.max(cursor, p.inicio);
      const ate = Math.min(c.fim, p.fim);
      empurra(cursor, de, 'manual');
      empurra(de, ate, c.motivo);
      cursor = ate;
    }
    empurra(cursor, c.fim, 'manual');
  }
  return saida;
}

/**
 * O cortes.json é DESTE bruto? Um plano de outro arquivo corta em tempos
 * arbitrários. Duração diferente ou trecho além do fim é erro; só o caminho
 * diferente (a pasta mudou de lugar) é aviso.
 * @param {{ arquivo?: unknown, duracaoBrutoSeg?: unknown } | null} plano
 * @param {Intervalo[]} manter
 * @param {{ arquivo: string, duracao: number, toleranciaSeg?: number }} bruto
 * @returns {{ erro: string | null, avisos: string[] }}
 */
export function conferirPlanoContraBruto(plano, manter, { arquivo, duracao, toleranciaSeg = 0.1 }) {
  /** @type {string[]} */
  const avisos = [];
  const doPlano = plano?.duracaoBrutoSeg === undefined ? NaN : Number(plano.duracaoBrutoSeg);
  if (Number.isFinite(doPlano) && Math.abs(doPlano - duracao) > toleranciaSeg) {
    return {
      erro: `O cortes.json é de um arquivo com ${doPlano.toFixed(1)} s e este tem ${duracao.toFixed(1)} s — rode \`cortes\` de novo neste bruto.`,
      avisos,
    };
  }
  const ultimo = manter[manter.length - 1];
  if (ultimo && ultimo.fim > duracao + toleranciaSeg) {
    return { erro: `O \`manter\` vai até ${ultimo.fim} s e o arquivo tem ${duracao.toFixed(1)} s.`, avisos };
  }
  if (typeof plano?.arquivo === 'string' && plano.arquivo && plano.arquivo !== arquivo) {
    avisos.push(`O cortes.json foi feito para ${plano.arquivo}; a duração bate com ${arquivo}, sigo.`);
  }
  return { erro: null, avisos };
}

/** @param {Intervalo[]} lista */
export function duracaoTotal(lista) {
  return arred(lista.reduce((n, i) => n + (i.fim - i.inicio), 0));
}

/**
 * O plano da edição inteiro: o que `root-midia cortes` grava no cortes.json.
 * @param {{
 *   duracao: number,
 *   silencios: Intervalo[],
 *   segmentos?: Segmento[] | null,
 *   palavra?: string | null,
 *   minimoSeg?: number,
 *   margemSeg?: number,
 *   mantidoMinimoSeg?: number,
 * }} entrada
 */
export function planoDeCortes(entrada) {
  const { duracao } = entrada;
  const doSilencio = cortesDosSilencios(entrada.silencios, {
    duracao,
    minimoSeg: entrada.minimoSeg,
    margemSeg: entrada.margemSeg,
  });
  const comPalavra = entrada.segmentos?.length && entrada.palavra ? entrada.palavra : null;
  const daPalavra = comPalavra ? cortesDaPalavra(entrada.segmentos ?? [], comPalavra, { margemSeg: entrada.margemSeg }) : [];
  const manter = intervalosAManter({
    duracao,
    remover: [...doSilencio, ...daPalavra],
    mantidoMinimoSeg: entrada.mantidoMinimoSeg,
  });
  const removidos = cortesRemovidos({ duracao, manter, daPalavra });
  return {
    duracaoBrutoSeg: arred(duracao),
    duracaoFinalSeg: duracaoTotal(manter),
    /** Nula quando não houve transcrição do bruto: aí só os silêncios saíram. */
    palavraDeCorte: comPalavra,
    manter,
    removidos,
    tomadasErradas: daPalavra.map((p) => ({ inicio: p.inicio, fim: p.fim, trecho: p.trecho })),
  };
}

/**
 * O filtro do ffmpeg que junta os pedaços mantidos, reencodando: `trim` +
 * `concat` segura vídeo com taxa de quadros variável (o `select` com
 * `setpts=N/FRAME_RATE/TB` só acerta em taxa constante).
 * @param {Intervalo[]} manter
 * @param {{ video: boolean, audio: boolean }} fluxos
 */
export function filtroDoCorte(manter, { video, audio }) {
  if (!manter.length) throw new Error('Nada a manter: o corte apagaria o arquivo inteiro.');
  if (!video && !audio) throw new Error('O arquivo não tem vídeo nem áudio.');
  /** @type {string[]} */
  const partes = [];
  /** @type {string[]} */
  const entradas = [];
  manter.forEach((m, i) => {
    if (video) {
      partes.push(`[0:v]trim=start=${m.inicio}:end=${m.fim},setpts=PTS-STARTPTS[v${i}]`);
      entradas.push(`[v${i}]`);
    }
    if (audio) {
      partes.push(`[0:a]atrim=start=${m.inicio}:end=${m.fim},asetpts=PTS-STARTPTS[a${i}]`);
      entradas.push(`[a${i}]`);
    }
  });
  const saidas = `${video ? '[v]' : ''}${audio ? '[a]' : ''}`;
  partes.push(`${entradas.join('')}concat=n=${manter.length}:v=${video ? 1 : 0}:a=${audio ? 1 : 0}${saidas}`);
  const mapas = [...(video ? ['-map', '[v]'] : []), ...(audio ? ['-map', '[a]'] : [])];
  return { filtro: partes.join(';\n'), mapas };
}

/**
 * A lista do concat demuxer para cortar SEM reencodar (`-f concat -c copy`).
 * @param {string} arquivo — caminho absoluto
 * @param {Intervalo[]} manter
 */
export function listaDoConcat(arquivo, manter) {
  const nome = `'${arquivo.replace(/'/g, "'\\''")}'`;
  return ['ffconcat version 1.0', ...manter.flatMap((m) => [`file ${nome}`, `inpoint ${m.inicio}`, `outpoint ${m.fim}`]), ''].join('\n');
}

/**
 * Cortar sem reencodar só é exato quando toda borda cai num quadro-chave (o
 * vídeo recomeça num quadro inteiro). Gravação só com quadros-chave (ProRes,
 * intra) passa; H.264 do OBS, com um quadro-chave a cada ~2 s, quase nunca.
 * @param {Intervalo[]} manter
 * @param {number[]} quadrosChave — tempos em segundos
 * @param {{ duracao: number, toleranciaSeg?: number }} opcoes
 */
export function podeCortarSemReencodar(manter, quadrosChave, { duracao, toleranciaSeg = 0.02 }) {
  if (manter.length === 1 && manter[0].inicio <= 0.001 && manter[0].fim >= duracao - 0.001) return true;
  if (!quadrosChave.length) return false;
  const ordenados = [...quadrosChave].sort((a, b) => a - b);
  const perto = (/** @type {number} */ t) => {
    let lo = 0;
    let hi = ordenados.length - 1;
    while (lo < hi) {
      const meio = (lo + hi) >> 1;
      if (ordenados[meio] < t) lo = meio + 1;
      else hi = meio;
    }
    const vizinhos = [ordenados[lo], ordenados[lo - 1]].filter((x) => x !== undefined);
    return vizinhos.some((k) => Math.abs(k - t) <= toleranciaSeg);
  };
  return manter.every(
    (m) => (m.inicio <= 0.001 || perto(m.inicio)) && (m.fim >= duracao - 0.001 || perto(m.fim)),
  );
}

/**
 * O codificador de vídeo para o reencode: libx264 quando o ffmpeg tem;
 * senão o de hardware do Mac.
 * @param {string} encoders — a saída de `ffmpeg -hide_banner -encoders`
 */
export function codecDeVideo(encoders) {
  if (/\blibx264\b/.test(encoders)) return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18'];
  if (/\bh264_videotoolbox\b/.test(encoders)) return ['-c:v', 'h264_videotoolbox', '-b:v', '8M'];
  throw new Error('Este ffmpeg não tem libx264 nem h264_videotoolbox para reencodar o vídeo.');
}

/**
 * Confere o cortes.json antes de cortar: lista em ordem, dentro do arquivo.
 * @param {unknown} valor
 * @returns {Intervalo[]}
 */
export function lerManter(valor) {
  const lista = Array.isArray(valor) ? valor : /** @type {{ manter?: unknown }} */ (valor ?? {}).manter;
  if (!Array.isArray(lista) || !lista.length) throw new Error('O cortes.json não traz a lista `manter`.');
  let fim = -Infinity;
  return lista.map((m, i) => {
    const inicio = Number(m?.inicio);
    const f = Number(m?.fim);
    if (!Number.isFinite(inicio) || !Number.isFinite(f) || f <= inicio || inicio < 0) {
      throw new Error(`O trecho ${i + 1} de \`manter\` não é um intervalo válido.`);
    }
    if (inicio < fim) throw new Error(`O trecho ${i + 1} de \`manter\` começa antes do fim do anterior.`);
    fim = f;
    return { inicio, fim: f };
  });
}
