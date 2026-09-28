// @ts-check
/*
 * O envio do vídeo final ao YouTube (MD10), do lado do Mac.
 *
 * O OS abre a sessão resumable com os metadados travados (sempre privado) e
 * devolve a URI e um token curto; aqui só os BYTES vão, direto do Mac ao
 * YouTube — o vídeo não passa pela VPS. Blocos de 64 MiB (múltiplos de 256 KiB,
 * a regra do protocolo), `fetch` nativo, e a retomada é a do protocolo:
 *
 *   · 308 com `Range: bytes=0-N` → o próximo bloco começa em N+1;
 *   · conexão caída no meio → pergunta onde parou (`Content-Range: bytes * /total`,
 *     corpo vazio) e segue de lá;
 *   · 5xx → espera (1 s, 2 s, 4 s…) e pergunta onde parou;
 *   · 401 → pede ao OS um token novo para a MESMA sessão, no máximo
 *     `TOKENS_SEGUIDOS` vezes seguidas; o mesmo token de volta, ou o 401 que
 *     persiste, param o envio (a autorização foi tirada ou venceu);
 *   · 404 → a sessão sumiu: pede uma NOVA ao OS e recomeça do zero;
 *   · 200/201 → o corpo traz o id do vídeo.
 *
 * O estado vai para `~/.config/root/youtube-ep-NN.json` a cada passo, SEM a URI
 * e sem o token: quem guarda a sessão é o OS (cifrada), e o Mac a pede de novo.
 * Nada aqui apaga arquivo.
 */

/** 64 MiB por pedido. */
export const BLOCO = 64 * 1024 * 1024;
/** Todo bloco que não é o último tem de ser múltiplo disto. */
export const MULTIPLO = 256 * 1024;
/** Quantas falhas seguidas (rede ou 5xx) antes de desistir. */
export const TENTATIVAS = 6;
/** Quantos tokens novos seguidos (401 atrás de 401) antes de desistir. */
export const TOKENS_SEGUIDOS = 2;

const RECONECTAR = 'conecte o canal de novo no OS (aba Episódios, "Conectar o canal"), logado na conta dona do canal';

/** O bloco arredondado para baixo ao múltiplo de 256 KiB (nunca zero). @param {number} bytes */
export function tamanhoDoBloco(bytes) {
  const n = Math.floor(Number(bytes) / MULTIPLO) * MULTIPLO;
  return n > 0 ? n : MULTIPLO;
}

/**
 * O próximo byte a mandar, a partir do `Range` do 308 (`bytes=0-1048575`).
 * Sem cabeçalho, o YouTube não recebeu nada: começa do zero.
 * @param {string | null | undefined} range
 */
export function proximoByte(range) {
  const m = /bytes=0-(\d+)/.exec(String(range ?? ''));
  return m ? Number(m[1]) + 1 : 0;
}

/** @param {number} inicio @param {number} fim (inclusivo) @param {number} total */
export function cabecalhoDoBloco(inicio, fim, total) {
  return `bytes ${inicio}-${fim}/${total}`;
}

/** Onde o estado do envio fica no Mac. @param {string} home @param {string} apelido */
export function caminhoDoEstado(home, apelido) {
  return `${home.replace(/\/+$/, '')}/.config/root/youtube-${apelido}.json`;
}

/** Espera exponencial, com teto de 30 s. @param {number} tentativa (1, 2, 3…) */
export function espera(tentativa) {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, tentativa - 1));
}

class FalhaDoEnvio extends Error {}

/**
 * Manda o arquivo à sessão do YouTube, retomando do que já chegou.
 *
 * @param {{
 *   total: number,
 *   sessao: (nova: boolean) => Promise<{ uri: string, token: string, nova: boolean }>,
 *   tokenNovo: () => Promise<{ token: string }>,
 *   lerBloco: (inicio: number, fim: number) => Promise<Uint8Array>,
 *   gravarEstado?: (e: Record<string, unknown>) => void,
 *   fetch?: typeof globalThis.fetch,
 *   esperar?: (ms: number) => Promise<void>,
 *   avisar?: (msg: string) => void,
 *   bloco?: number,
 *   tentativas?: number,
 * }} o
 * @returns {Promise<{ videoId: string, blocos: number, retomadas: number, sessoes: number }>}
 */
export async function enviarAoYoutube(o) {
  const f = o.fetch ?? globalThis.fetch;
  const esperar = o.esperar ?? ((ms) => new Promise((ok) => setTimeout(ok, ms)));
  const avisar = o.avisar ?? (() => {});
  const gravar = o.gravarEstado ?? (() => {});
  const bloco = tamanhoDoBloco(o.bloco ?? BLOCO);
  const limite = o.tentativas ?? TENTATIVAS;
  const total = o.total;
  if (!(total > 0)) throw new FalhaDoEnvio('O arquivo está vazio.');

  let s = await o.sessao(false);
  let sessoes = 1;
  let blocos = 0;
  let retomadas = 0;
  let falhas = 0;
  let recusasDeToken = 0;
  /** @type {number | null} */
  let offset = null;

  /** Pergunta ao YouTube até onde chegou. Devolve o id do vídeo quando o envio já terminou. */
  const consultar = async () => {
    const r = await f(s.uri, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${s.token}`, 'Content-Length': '0', 'Content-Range': `bytes */${total}` },
    });
    return r;
  };

  /** Trata uma resposta do protocolo. `null` = seguir o laço; string = o id do vídeo. */
  const tratar = async (/** @type {Response} */ r) => {
    if (r.status === 308) {
      await r.arrayBuffer().catch(() => undefined);
      offset = proximoByte(r.headers.get('range'));
      falhas = 0;
      recusasDeToken = 0;
      return null;
    }
    if (r.status === 200 || r.status === 201) {
      const j = /** @type {{ id?: string }} */ (await r.json().catch(() => ({})));
      if (!j.id) throw new FalhaDoEnvio(`O YouTube terminou o envio (HTTP ${r.status}) sem devolver o id do vídeo.`);
      return j.id;
    }
    const corpo = (await r.text().catch(() => '')).slice(0, 200);
    if (r.status === 401) {
      recusasDeToken++;
      if (recusasDeToken > TOKENS_SEGUIDOS) {
        throw new FalhaDoEnvio(`O YouTube recusou ${recusasDeToken} tokens seguidos (HTTP 401): a autorização do canal foi tirada ou venceu; ${RECONECTAR}.`);
      }
      avisar('o YouTube recusou o token do envio (401): pedindo outro ao OS…');
      const antes = s.token;
      s = { ...s, ...(await o.tokenNovo()) };
      if (s.token === antes) {
        throw new FalhaDoEnvio(`O YouTube recusou o token do envio (HTTP 401) e o OS devolveu o mesmo token: ${RECONECTAR}.`);
      }
      offset = null;
      return null;
    }
    if (r.status === 404 || r.status === 410) {
      avisar(`a sessão de envio sumiu (HTTP ${r.status}): pedindo uma nova ao OS e recomeçando do zero…`);
      s = await o.sessao(true);
      sessoes++;
      offset = 0;
      return null;
    }
    if (r.status >= 500) {
      falhas++;
      if (falhas > limite) throw new FalhaDoEnvio(`O YouTube respondeu HTTP ${r.status} ${falhas} vezes seguidas: ${corpo}`);
      avisar(`o YouTube respondeu HTTP ${r.status}; esperando e retomando…`);
      await esperar(espera(falhas));
      offset = null;
      retomadas++;
      return null;
    }
    throw new FalhaDoEnvio(`O YouTube recusou o envio (HTTP ${r.status}): ${corpo}`);
  };

  // Uma sessão que o OS devolveu aberta pode já ter bytes: começa perguntando.
  if (!s.nova) offset = null;
  else offset = 0;

  for (;;) {
    if (offset === null) {
      try {
        const id = await tratar(await consultar());
        if (id) return { videoId: id, blocos, retomadas, sessoes };
        if (offset === null) continue;
      } catch (e) {
        if (e instanceof FalhaDoEnvio) throw e;
        falhas++;
        if (falhas > limite) throw new FalhaDoEnvio(`Sem conexão com o YouTube depois de ${falhas} tentativas: ${/** @type {Error} */ (e).message}`);
        await esperar(espera(falhas));
        continue;
      }
    }
    const inicio = /** @type {number} */ (offset);
    if (inicio >= total) {
      // Tudo chegou mas a resposta final se perdeu: a consulta devolve o id.
      offset = null;
      continue;
    }
    const fim = Math.min(inicio + bloco, total) - 1;
    const corpo = await o.lerBloco(inicio, fim);
    try {
      const r = await f(s.uri, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${s.token}`,
          'Content-Length': String(corpo.byteLength),
          'Content-Range': cabecalhoDoBloco(inicio, fim, total),
        },
        body: /** @type {any} */ (corpo),
      });
      blocos++;
      const id = await tratar(r);
      if (id) {
        gravar({ ultimoByte: total, total, sessoes, blocos, retomadas, videoId: id, concluidoEm: new Date().toISOString() });
        return { videoId: id, blocos, retomadas, sessoes };
      }
      // O que o YouTube confirmou até aqui (o 308), para quem olhar o arquivo de estado.
      if (offset !== null) gravar({ ultimoByte: offset, total, sessoes, blocos, retomadas, atualizadoEm: new Date().toISOString() });
    } catch (e) {
      if (e instanceof FalhaDoEnvio) throw e;
      // A conexão caiu no meio do bloco: pergunta onde parou.
      falhas++;
      retomadas++;
      if (falhas > limite) throw new FalhaDoEnvio(`A conexão com o YouTube caiu ${falhas} vezes seguidas: ${/** @type {Error} */ (e).message}`);
      avisar(`a conexão caiu no bloco que começa em ${inicio}; retomando…`);
      await esperar(espera(falhas));
      offset = null;
    }
  }
}
