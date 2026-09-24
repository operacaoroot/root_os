// @ts-check
/*
 * A conversa com o ROOT OS: o login normal da API (o mesmo desenho de
 * `packages/mcp/src/client.ts` — POST /auth/login, token no cabeçalho) e os três
 * pedidos da estação de mídia. O `fetch` é injetável para o teste.
 */

import { PALAVRA_PADRAO, cortesAplicados } from './cortes.mjs';
import { segmentosDaTranscricao } from './whisper.mjs';

/**
 * O corpo JSON que as rotas de mídia do episódio aceitam (2 MB, o
 * `PAUTA_TETO_DO_CORPO_DA_MIDIA` do shared — `apps/api/test/pauta-robustez.test.ts`
 * confere que os dois andam juntos), com uma folga. O resto da API segue nos 100 kb do Nest.
 */
export const TETO_DO_CORPO = 2 * 1024 * 1024 - 2048;

/**
 * As variáveis que a ferramenta lê. Faltar a senha não é erro aqui: só os
 * subcomandos que falam com o OS a exigem (`exigirOs`).
 * @param {Record<string, string | undefined>} env
 */
export function configuracao(env) {
  const limpo = (/** @type {string | undefined} */ v) => (v ?? '').trim();
  return {
    url: (limpo(env.ROOT_OS_API_URL) || 'http://localhost:4001/api').replace(/\/+$/, ''),
    email: limpo(env.ROOT_OS_EMAIL),
    senha: env.ROOT_OS_SENHA ?? '',
    modelo: limpo(env.WHISPER_MODEL),
    palavra: limpo(env.ROOT_MIDIA_PALAVRA) || PALAVRA_PADRAO,
  };
}

/**
 * O arquivo de variáveis (`CHAVE=valor` por linha, `#` comenta, aspas em volta
 * saem). Cada chamada de Bash do Claude Code abre um shell novo: a ferramenta lê
 * o arquivo sozinha em vez de depender de um `source` que não persiste.
 * @param {string} texto
 * @returns {Record<string, string>}
 */
export function lerArquivoDeVariaveis(texto) {
  /** @type {Record<string, string>} */
  const saida = {};
  for (const linha of String(texto ?? '').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(linha);
    if (!m) continue;
    const valor = m[2];
    const aspas = /^(['"])(.*)\1$/.exec(valor);
    saida[m[1]] = aspas ? aspas[2] : valor.replace(/\s+#.*$/, '');
  }
  return saida;
}

/** O ambiente vence o arquivo: quem exporta na mão está sobrescrevendo de propósito. */
export function juntarVariaveis(/** @type {Record<string, string | undefined>} */ env, /** @type {Record<string, string>} */ doArquivo) {
  /** @type {Record<string, string | undefined>} */
  const saida = { ...doArquivo };
  for (const [k, v] of Object.entries(env)) if (v !== undefined) saida[k] = v;
  return saida;
}

/** A API é desta máquina (loopback)? O ensaio do vigia só roda contra ela. @param {string} url */
export function ehLocal(url) {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '::1' || /^127\./.test(host);
  } catch {
    return false;
  }
}

/** @param {ReturnType<typeof configuracao>} c */
export function exigirOs(c) {
  const faltam = [!c.email && 'ROOT_OS_EMAIL', !c.senha && 'ROOT_OS_SENHA'].filter(Boolean);
  if (faltam.length) {
    throw new Error(
      `Faltam ${faltam.join(' e ')} — o e-mail e a senha de uma conta do OS com pauta.editar ` +
        '(a ferramenta entra pelo login normal da API; não guarde a senha no repositório).',
    );
  }
  if (/^http:/i.test(c.url) && !ehLocal(c.url)) {
    throw new Error(
      `ROOT_OS_API_URL (${c.url}) é http fora desta máquina: a senha iria em claro. Use https://.`,
    );
  }
}

/**
 * @param {{ url: string, email: string, senha: string, fetch?: typeof globalThis.fetch }} opcoes
 */
export function clienteDoOs({ url, email, senha, fetch: f = globalThis.fetch }) {
  /** @type {string | null} */
  let token = null;

  async function entrar() {
    const res = await f(`${url}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: senha }),
    });
    if (!res.ok) throw new Error(`O login no OS falhou (HTTP ${res.status}). Confira ROOT_OS_EMAIL e ROOT_OS_SENHA.`);
    const dados = /** @type {{ token?: string }} */ (await res.json());
    if (!dados.token) throw new Error('O login no OS não devolveu token.');
    token = dados.token;
  }

  /**
   * @param {'GET' | 'POST' | 'PUT'} metodo
   * @param {string} caminho
   * @param {unknown} [corpo] JSON, ou um FormData (o multipart monta o próprio cabeçalho)
   */
  async function pedir(metodo, caminho, corpo) {
    if (!token) await entrar();
    const multipart = typeof FormData !== 'undefined' && corpo instanceof FormData;
    const enviar = () =>
      f(`${url}${caminho}`, {
        method: metodo,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(corpo === undefined || multipart ? {} : { 'Content-Type': 'application/json' }),
        },
        body: corpo === undefined ? undefined : multipart ? /** @type {FormData} */ (corpo) : JSON.stringify(corpo),
      });
    let res = await enviar();
    if (res.status === 401) {
      await entrar();
      res = await enviar();
    }
    const texto = await res.text();
    if (!res.ok) throw new Error(`${metodo} ${caminho} → HTTP ${res.status}: ${mensagemDoErro(texto)}`);
    return texto ? JSON.parse(texto) : null;
  }

  return {
    pendentes: () => pedir('GET', '/pauta/episodios/pendentes-midia'),
    /** @param {string} id @param {unknown} corpo */
    midia: (id, corpo) => pedir('POST', `/pauta/episodios/${encodeURIComponent(id)}/midia`, corpo),
    /** @param {string} id @param {unknown} corpo */
    transcricao: (id, corpo) => pedir('POST', `/pauta/episodios/${encodeURIComponent(id)}/transcricao`, corpo),
    /** Todos os episódios da empresa (MC11: o pacote é depois da fila da mídia). */
    episodios: () => pedir('GET', '/pauta/episodios'),
    /** @param {string} id */
    thumbs: (id) => pedir('GET', `/pauta/episodios/${encodeURIComponent(id)}/thumbs`),
    /** @param {string} id @param {number} n @param {Uint8Array} png @param {string} nome */
    enviarThumb: (id, n, png, nome) => {
      const form = new FormData();
      form.append('file', new Blob([png], { type: 'image/png' }), nome);
      return pedir('POST', `/pauta/episodios/${encodeURIComponent(id)}/thumbs/${n}`, form);
    },
    /** A semana de posts do episódio (MC15): as matérias e as três peças de cada uma. @param {string} id */
    semana: (id) => pedir('GET', `/pauta/episodios/${encodeURIComponent(id)}/semana`),
    /** Um PNG da peça: o slide n do carrossel, ou o story (n = 1). @param {string} pecaId @param {number} n @param {Uint8Array} png @param {string} nome */
    enviarImagemDaPeca: (pecaId, n, png, nome) => {
      const form = new FormData();
      form.append('file', new Blob([png], { type: 'image/png' }), nome);
      return pedir('POST', `/pauta/pecas/${encodeURIComponent(pecaId)}/imagens/${n}`, form);
    },
    /** O corte renderizado: o mp4 fica no Mac, vai só onde ele está e o que foi medido. @param {string} pecaId @param {unknown} corpo */
    videoDoCorte: (pecaId, corpo) => pedir('PUT', `/pauta/pecas/${encodeURIComponent(pecaId)}/video`, corpo),
    /** O calendário da semana (MC16): sete dias a partir de `de` (AAAA-MM-DD), ou desta semana. @param {string} [de] */
    agenda: (de) => pedir('GET', `/pauta/agenda${de ? `?de=${encodeURIComponent(de)}` : ''}`),
  };
}

/**
 * A mensagem que a API escreveu (`{message}` do Nest, ou a lista do zod), sem o
 * corpo inteiro.
 * @param {string} texto
 */
export function mensagemDoErro(texto) {
  try {
    const j = JSON.parse(texto);
    if (Array.isArray(j?.issues)) {
      return j.issues
        .map((/** @type {{ path?: string, message?: string }} */ i) => (i.path ? `${i.path}: ${i.message}` : i.message))
        .join('; ')
        .slice(0, 800);
    }
    const m = j?.message ?? j?.error;
    if (Array.isArray(m)) return m.join('; ').slice(0, 800);
    if (typeof m === 'string') return m.slice(0, 800);
  } catch {
    /* não é JSON: vai o texto */
  }
  return String(texto ?? '').slice(0, 300);
}

/**
 * O episódio da fila pelo que o Pedro digita: `ep-07`, `7`, `07` ou o id.
 * Com `lista`, a busca é na lista de todos os episódios (o pacote, MC11).
 * @template {{ id: string, numero: number, apelido: string }} T
 * @param {T[]} fila
 * @param {string} ep
 * @param {{ lista?: boolean }} [opcoes]
 * @returns {T}
 */
export function acharEpisodio(fila, ep, opcoes = {}) {
  const alvo = String(ep ?? '').trim().toLowerCase();
  const numero = /^(?:ep-?)?0*(\d+)$/.exec(alvo)?.[1];
  const achado = fila.find((e) => e.id === alvo || e.apelido === alvo || (numero !== undefined && e.numero === Number(numero)));
  if (achado) return achado;
  const quais = fila.map((e) => e.apelido).join(', ') || 'nenhum';
  if (opcoes.lista) throw new Error(`Não achei o ${ep} entre os episódios da empresa (${quais}).`);
  throw new Error(
    `O ${ep} não está na fila da mídia (gravação ou edição). Na fila: ${quais}. ` +
      'Se ele ainda está no roteiro, gere o roteiro; se já passou da edição, volte o status na tela.',
  );
}

/**
 * O corpo da mídia a partir do cortes.json e das durações medidas. Os cortes
 * saem do `manter` (o que foi cortado de fato), não dos `removidos` do plano.
 * @param {{
 *   arquivoBruto: string,
 *   arquivoFinal: string,
 *   duracaoSeg: number,
 *   duracaoBrutoSeg?: number,
 *   plano?: { duracaoBrutoSeg?: number, manter?: unknown, removidos?: unknown, tomadasErradas?: unknown, palavraDeCorte?: string | null } | null,
 *   editor?: 'palmier' | 'ffmpeg' | 'manual',
 * }} m
 */
export function corpoDaMidia(m) {
  return {
    arquivoBruto: m.arquivoBruto,
    arquivoFinal: m.arquivoFinal,
    duracaoSeg: Math.round(m.duracaoSeg * 1000) / 1000,
    ...(m.duracaoBrutoSeg ? { duracaoBrutoSeg: Math.round(m.duracaoBrutoSeg * 1000) / 1000 } : {}),
    cortes: m.plano ? cortesAplicados(m.plano, m.duracaoBrutoSeg) : [],
    palavraDeCorte: m.plano?.palavraDeCorte ?? null,
    editor: m.editor ?? 'ffmpeg',
  };
}

/**
 * O corpo da transcrição a partir do JSON que `root-midia transcrever` grava
 * (`{segmentos, idioma, modelo}`), de uma lista crua ou do JSON do whisper-cli.
 * @param {unknown} valor
 */
export function corpoDaTranscricao(valor) {
  const v = /** @type {{ idioma?: unknown, modelo?: unknown }} */ (Array.isArray(valor) ? {} : valor ?? {});
  return {
    segmentos: segmentosDaTranscricao(valor),
    ...(typeof v.idioma === 'string' && v.idioma ? { idioma: v.idioma } : {}),
    ...(typeof v.modelo === 'string' && v.modelo ? { modelo: v.modelo.slice(0, 120) } : {}),
  };
}

/**
 * Corpo maior que o que a API aceita vira mensagem clara aqui, não um 413 lá.
 * @param {unknown} corpo
 */
export function corpoGrandeDemais(corpo) {
  const bytes = Buffer.byteLength(JSON.stringify(corpo), 'utf8');
  if (bytes <= TETO_DO_CORPO) return null;
  return (
    `A transcrição tem ${Math.round(bytes / 1024)} kB e a API aceita até ~${Math.floor(TETO_DO_CORPO / 1024)} kB por pedido. ` +
    'Isso passa muito de 1h de fala: confira se o arquivo é a transcrição do vídeo final ou divida o episódio.'
  );
}
