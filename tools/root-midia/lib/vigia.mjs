// @ts-check
/*
 * O vigia do Mac (MD2): o launchd acorda o `root-midia vigia` quando a pasta do
 * OBS muda (WatchPaths) e a cada 15 min (StartInterval). Uma passagem acha o
 * bruto do episódio em Gravação, roda a mesma cadeia do comando manual só pelo
 * ffmpeg e manda ao OS; depois renderiza o que a Derivação ainda não tem.
 *
 * Aqui mora o que decide e o que monta, sem ffmpeg nem rede: onde fica cada
 * coisa, qual arquivo é o bruto, a trava, a memória entre passagens, o plist do
 * launchd, a notificação e o log, e a decisão da metade do bruto de uma
 * passagem, com disco, relógio e cadeia injetados. O bruto só é LIDO: o único
 * arquivo que este arquivo remove é a porta da trava (a catraca do
 * `root-midia.test.ts` confere).
 */

import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { lerArquivoDeVariaveis } from './os.mjs';

export const ROTULO = 'com.operacaoroot.root-midia.vigia';
/** O que o OBS grava (mp4 e mov, ou mkv com remux depois). */
export const EXTENSOES_DO_BRUTO = Object.freeze(['.mkv', '.mp4', '.mov']);
/** Uma passagem que morreu sem soltar a trava não segura as outras para sempre. */
export const PRAZO_DA_TRAVA_MS = 3 * 60 * 60 * 1000;
/** As duas leituras do bruto: tamanho e data iguais com este intervalo = o OBS parou de escrever. */
export const INTERVALO_DAS_LEITURAS_MS = 60_000;
/** E o arquivo precisa estar parado há pelo menos isto. */
export const IDADE_MINIMA_MS = 2 * 60_000;
/** Quanto a passagem espera um bruto novo "amadurecer" antes de desistir e deixar para a próxima. */
export const ESPERA_MAXIMA_MS = 5 * 60_000;
export const TETO_DO_LOG = 5 * 1024 * 1024;
export const INTERVALO_DO_AGENTE_SEG = 900;
export const FOLGA_DO_AGENTE_SEG = 60;
/** A mesma notificação não se repete antes disto: o launchd acorda o vigia a cada 15 min. */
export const SILENCIO_DA_NOTIFICACAO_MS = 6 * 60 * 60 * 1000;
/** O render que falhou com as mesmas peças só é tentado de novo depois disto (a falha pode ter sido a rede). */
export const ESPERA_DO_RENDER_REPETIDO_MS = 24 * 60 * 60 * 1000;

/** @param {string} caminho @param {string} home */
function comHome(caminho, home) {
  return caminho === '~' ? home : caminho.startsWith('~/') ? join(home, caminho.slice(2)) : caminho;
}

/**
 * Onde fica cada coisa. A trava e a memória moram ao lado do arquivo de
 * variáveis (`~/.config/root/` por padrão): o ensaio, com outro arquivo, não
 * encosta na trava do vigia de verdade.
 * @param {Record<string, string | undefined>} env
 * @param {string} home
 */
export function caminhosDoVigia(env, home) {
  const arquivoDeVariaveis = resolve(comHome(env.ROOT_MIDIA_ENV?.trim() || join(home, '.config', 'root', 'root-midia.env'), home));
  const pasta = dirname(arquivoDeVariaveis);
  return {
    obs: resolve(comHome(env.ROOT_MIDIA_OBS_DIR?.trim() || join(home, 'Movies', 'OBS'), home)),
    variaveis: arquivoDeVariaveis,
    trava: join(pasta, 'root-midia-vigia.lock'),
    memoria: join(pasta, 'root-midia-vigia.estado.json'),
    log: resolve(comHome(env.ROOT_MIDIA_VIGIA_LOG?.trim() || join(home, 'Library', 'Logs', 'root-midia', 'vigia.log'), home)),
    agentes: join(home, 'Library', 'LaunchAgents'),
  };
}

/** A pasta de trabalho do episódio, dentro da do OBS (fora da raiz que o vigia olha). @param {string} obs @param {string} apelido */
export function pastaDoEpisodio(obs, apelido) {
  return join(obs, 'root-midia', apelido);
}

// ---------------------------------------------------------------------------
// Qual arquivo é o bruto
// ---------------------------------------------------------------------------

/**
 * @typedef {{ nome: string, arquivo: boolean, tamanho: number, mtimeMs: number }} Entrada
 */

/**
 * O que há na raiz da pasta do OBS, sem descer: a pasta `root-midia/` (e toda
 * outra) fica de fora, e link simbólico também — ele daria ao vigia um arquivo
 * de fora da pasta que o Pedro escolheu.
 * @param {string} pasta
 * @returns {Entrada[]}
 */
export function lerPastaDoObs(pasta) {
  /** @type {Entrada[]} */
  const saida = [];
  for (const nome of readdirSync(pasta)) {
    try {
      const st = lstatSync(join(pasta, nome));
      saida.push({ nome, arquivo: st.isFile(), tamanho: st.size, mtimeMs: st.mtimeMs });
    } catch {
      /* sumiu entre a listagem e o stat: fica para a próxima leitura */
    }
  }
  return saida;
}

/**
 * Os candidatos a bruto: arquivo comum com a extensão do OBS, não oculto, e
 * modificado DEPOIS da entrada do episódio em Gravação.
 * @param {Entrada[]} entradas @param {{ statusDesdeMs: number }} o
 */
export function candidatosDoBruto(entradas, { statusDesdeMs }) {
  return entradas
    .filter(
      (e) =>
        e.arquivo &&
        !e.nome.startsWith('.') &&
        EXTENSOES_DO_BRUTO.includes(extname(e.nome).toLowerCase()) &&
        e.mtimeMs > statusDesdeMs,
    )
    .sort((a, b) => a.nome.localeCompare(b.nome));
}

/**
 * Duas leituras dos candidatos com um intervalo entre elas. Algum mudou (ou
 * apareceu, ou sumiu) = o OBS está gravando, e a passagem pula. Mais de um =
 * ambíguo, ninguém adivinha. Um só, parado, mas modificado há menos de 2 min =
 * jovem (espera). Um só, parado e maduro = pronto.
 * @param {Entrada[]} antes @param {Entrada[]} depois
 * @param {{ agoraMs: number, idadeMinimaMs?: number }} o
 * @returns {{ estado: 'nenhum' } | { estado: 'gravando' | 'ambiguo', arquivos: string[] } | { estado: 'jovem', arquivo: string, esperarMs: number } | { estado: 'vazio' | 'pronto', arquivo: string, tamanho: number, mtimeMs: number }}
 */
export function estadoDoBruto(antes, depois, { agoraMs, idadeMinimaMs = IDADE_MINIMA_MS }) {
  if (!antes.length && !depois.length) return { estado: 'nenhum' };
  const assinatura = (/** @type {Entrada} */ e) => `${e.tamanho}:${e.mtimeMs}`;
  const deAntes = new Map(antes.map((e) => [e.nome, assinatura(e)]));
  const mudaram = [
    ...depois.filter((e) => deAntes.get(e.nome) !== assinatura(e)).map((e) => e.nome),
    ...antes.filter((e) => !depois.some((d) => d.nome === e.nome)).map((e) => e.nome),
  ];
  if (mudaram.length) return { estado: 'gravando', arquivos: [...new Set(mudaram)].sort() };
  if (depois.length > 1) return { estado: 'ambiguo', arquivos: depois.map((e) => e.nome) };
  const [unico] = depois;
  const idade = agoraMs - unico.mtimeMs;
  if (idade < idadeMinimaMs) return { estado: 'jovem', arquivo: unico.nome, esperarMs: Math.ceil(idadeMinimaMs - idade) };
  return { estado: unico.tamanho > 0 ? 'pronto' : 'vazio', arquivo: unico.nome, tamanho: unico.tamanho, mtimeMs: unico.mtimeMs };
}

/** O que o vigia mostra ao Pedro quando não escolhe sozinho. @param {string} apelido */
export function mensagemDeAmbiguo(apelido) {
  return `ambíguo: rode /root-midia ${apelido}`;
}

/**
 * O episódio que o vigia pode tocar: exatamente um em Gravação sem mídia.
 * @template {{ status: string, falta: string }} T
 * @param {T[]} itens
 * @returns {{ episodio: T } | { motivo: 'nenhum' | 'varios', quantos: number }}
 */
export function episodioDaGravacao(itens) {
  const emGravacao = itens.filter((e) => e.status === 'gravacao' && e.falta === 'midia');
  if (emGravacao.length === 1) return { episodio: emGravacao[0] };
  return { motivo: emGravacao.length ? 'varios' : 'nenhum', quantos: emGravacao.length };
}

/**
 * Com dois ou mais em Gravação o vigia não escolhe, mas só avisa quando há o
 * que escolher: um candidato gravado depois da entrada do mais antigo deles.
 * Pôr dois episódios em Gravação para gravar em lote não vira aviso a cada 6 h.
 * @param {Array<{ status: string, falta: string, statusDesde?: string | null }>} itens
 * @param {Entrada[]} entradas a raiz da pasta do OBS
 */
export function gravacaoParaVarios(itens, entradas) {
  const desdes = itens
    .filter((e) => e.status === 'gravacao' && e.falta === 'midia')
    .map((e) => Date.parse(e.statusDesde ?? ''))
    .filter(Number.isFinite);
  // A API anterior à MD2 não manda o statusDesde: sem ele, avisa como antes.
  if (!desdes.length) return true;
  return candidatosDoBruto(entradas, { statusDesdeMs: Math.min(...desdes) }).length > 0;
}

/**
 * O OBS está escrevendo na raiz agora (uma gravação ou arquivo mexido nos
 * últimos 2 min)? Uma leitura só, para a passagem que não olhou o bruto não
 * pôr ffmpeg e Chrome para disputar o Mac com a gravação.
 * @param {Entrada[]} entradas @param {number} agoraMs @param {number} [idadeMinimaMs]
 */
export function obsEscrevendo(entradas, agoraMs, idadeMinimaMs = IDADE_MINIMA_MS) {
  return candidatosDoBruto(entradas, { statusDesdeMs: agoraMs - idadeMinimaMs }).length > 0;
}

/**
 * O vigia só manda a mídia se o episódio AINDA está em Gravação sem mídia: a
 * cadeia leva dezenas de minutos, e nesse meio o Pedro pode ter mandado à mão
 * (ele está em Edição) ou mudado o status. A API aceita mídia na Edição também,
 * e o final editado à mão seria trocado pelo corte do ffmpeg.
 * @param {{ apelido: string, status: string, falta: string } | null} alvo @param {string} apelido
 * @returns {string | null}
 */
export function motivoParaOVigiaNaoEnviar(alvo, apelido) {
  if (!alvo) return `${apelido} mudou durante a cadeia (saiu da fila da mídia); nada enviado`;
  if (alvo.status === 'gravacao' && alvo.falta === 'midia') return null;
  return `${alvo.apelido} mudou durante a cadeia (agora em ${alvo.status}, falta ${alvo.falta}); nada enviado`;
}

/**
 * O que um render do vigia deixou de fora e o Pedro precisa saber, porque o
 * comando manual só avisa no terminal: o carrossel com texto estourado não
 * sobe, e o corte sem trecho é pulado.
 * @param {string} apelido @param {'corte' | 'story' | 'carrossel'} formato
 * @param {any} retorno o que `cortesVerticais`, `stories` ou `carrosseis` devolveu
 * @returns {string[]}
 */
export function avisosDoRender(apelido, formato, retorno) {
  if (formato === 'carrossel') {
    return (retorno?.carrosseis ?? [])
      .filter((/** @type {any} */ c) => c?.enviado === false)
      .map((/** @type {any} */ c) => {
        const slides = (c.estourados ?? []).filter((/** @type {unknown} */ n) => typeof n === 'number');
        const onde = slides.length ? ` no slide ${slides.join(', ')}` : '';
        return `${apelido}: o carrossel da matéria ${c.n} estourou o texto${onde} e não subiu; encurte na tela`;
      });
  }
  if (formato === 'corte') {
    return (retorno?.pulados ?? []).map((/** @type {any} */ p) => `${apelido}: o corte da matéria ${p.n} ficou sem render (${p.motivo})`);
  }
  return [];
}

// ---------------------------------------------------------------------------
// A metade do bruto de uma passagem
// ---------------------------------------------------------------------------

/**
 * @typedef {'sem-status' | 'sem-obs' | 'nenhum' | 'jovem' | 'sumiu' | 'gravando' | 'ambiguo' | 'vazio' | 'ja-falhou' | 'sem-modelo' | 'mudou' | 'enviado' | 'falhou'} EstadoDoPasso
 */

/**
 * Acha o candidato, espera ele parar e ficar maduro, e roda a cadeia. Disco,
 * relógio, espera, transcritor e cadeia chegam de fora: a suíte prova cada
 * caminho sem ffmpeg. Devolve o estado (a passagem pula os renders em
 * `gravando` e `jovem`) e o que aconteceu, em palavras.
 * @template T
 * @param {{
 *   ep: { apelido: string, statusDesde?: string | null },
 *   obs: string,
 *   existe: (caminho: string) => boolean,
 *   ler: (pasta: string) => Entrada[],
 *   agora: () => number,
 *   esperar: (ms: number) => Promise<void>,
 *   intervaloMs: number,
 *   idadeMinimaMs: number,
 *   esperaMaximaMs: number,
 *   jaFalhou: (chave: string) => boolean,
 *   lembrarFalha: (chave: string) => void,
 *   transcritor: () => ({ falta: string } | ({ ensaio: boolean } & T)),
 *   cadeia: (bruto: string, transcritor: { ensaio: boolean } & T) => Promise<{ status?: string | null, naoEnviado?: string }>,
 *   notificar: (msg: string) => Promise<void>,
 *   registrar: (msg: string) => void,
 * }} o
 * @returns {Promise<{ estado: EstadoDoPasso, texto: string }>}
 */
export async function passoDoBruto(o) {
  const { ep, obs } = o;
  const statusDesdeMs = Date.parse(ep.statusDesde ?? '');
  if (!Number.isFinite(statusDesdeMs)) return { estado: 'sem-status', texto: `${ep.apelido}: a API não disse desde quando ele está em Gravação (é anterior à MD2)` };
  if (!o.existe(obs)) {
    await o.notificar(`A pasta do OBS ${obs} não existe (ROOT_MIDIA_OBS_DIR).`);
    return { estado: 'sem-obs', texto: 'sem a pasta do OBS' };
  }
  const ler = () => candidatosDoBruto(o.ler(obs), { statusDesdeMs });
  let antes = ler();
  if (!antes.length) return { estado: 'nenhum', texto: `${ep.apelido}: nenhuma gravação nova desde a entrada em Gravação` };
  const limite = o.agora() + o.esperaMaximaMs;
  await o.esperar(o.intervaloMs);
  for (;;) {
    const depois = ler();
    const e = estadoDoBruto(antes, depois, { agoraMs: o.agora(), idadeMinimaMs: o.idadeMinimaMs });
    if (e.estado === 'jovem') {
      if (o.agora() + e.esperarMs > limite) return { estado: 'jovem', texto: `${ep.apelido}: ${e.arquivo} ainda é novo demais; fica para a próxima passagem` };
      await o.esperar(e.esperarMs);
      antes = depois;
      continue;
    }
    if (e.estado === 'nenhum') return { estado: 'sumiu', texto: `${ep.apelido}: a gravação sumiu entre as leituras` };
    if ('arquivos' in e) {
      if (e.estado === 'gravando') return { estado: 'gravando', texto: `${ep.apelido}: o OBS ainda está gravando (${e.arquivos.join(', ')}); a passagem pula` };
      await o.notificar(mensagemDeAmbiguo(ep.apelido));
      return { estado: 'ambiguo', texto: `${ep.apelido}: ${e.arquivos.length} gravações novas (${e.arquivos.join(', ')}); nada enviado` };
    }
    if (e.estado === 'vazio') return { estado: 'vazio', texto: `${ep.apelido}: ${e.arquivo} está vazio` };

    const bruto = join(obs, e.arquivo);
    const chave = chaveDoBruto(bruto, e.tamanho, e.mtimeMs);
    if (o.jaFalhou(chave)) return { estado: 'ja-falhou', texto: `${ep.apelido}: ${e.arquivo} já falhou numa passagem anterior; rode /root-midia ${ep.apelido}` };
    const transcritor = o.transcritor();
    // Faltar o modelo não é culpa do bruto: com o modelo no lugar, a próxima passagem faz.
    if ('falta' in transcritor) {
      await o.notificar(`${ep.apelido}: ${transcritor.falta}`);
      return { estado: 'sem-modelo', texto: `${ep.apelido}: ${transcritor.falta}` };
    }
    if (transcritor.ensaio) o.registrar(`${ep.apelido}: transcrição de ENSAIO (sem whisper), contra a API desta máquina`);
    o.registrar(`${ep.apelido}: o bruto é ${bruto}`);
    try {
      const r = await o.cadeia(bruto, transcritor);
      if (r.naoEnviado) {
        await o.notificar(r.naoEnviado);
        return { estado: 'mudou', texto: r.naoEnviado };
      }
      await o.notificar(`${ep.apelido}: mídia e transcrição no OS (${r.status}).`);
      return { estado: 'enviado', texto: `${ep.apelido}: ${e.arquivo} → ${r.status}` };
    } catch (err) {
      o.lembrarFalha(chave);
      const msg = /** @type {Error} */ (err).message.split('\n')[0].slice(0, 160);
      o.registrar(`${ep.apelido}: a cadeia parou: ${/** @type {Error} */ (err).message}`);
      await o.notificar(`${ep.apelido}: o vigia parou (${msg}). Rode /root-midia ${ep.apelido}.`);
      return { estado: 'falhou', texto: `${ep.apelido}: a cadeia parou (${msg})` };
    }
  }
}

/**
 * O ambiente que o agente do launchd vai ver: só o arquivo de variáveis e o
 * caminho dele. O `vigia instalar` confere e monta os caminhos com ISTO, e não
 * com o shell de quem instala: variável exportada só no shell passaria no
 * instalar e quebraria toda passagem.
 * @param {string} textoDoArquivo @param {string} caminho
 * @returns {Record<string, string>}
 */
export function ambienteDoAgente(textoDoArquivo, caminho) {
  return { ...lerArquivoDeVariaveis(textoDoArquivo), ROOT_MIDIA_ENV: caminho };
}

/**
 * Um nome que ainda não existe na pasta do episódio: o final de uma edição
 * feita à mão (PalmierPro) nunca é sobrescrito pelo vigia.
 * @param {string} pasta @param {string} base sem extensão @param {string} ext com o ponto
 * @param {(caminho: string) => boolean} [existe]
 */
export function nomeLivre(pasta, base, ext, existe = existsSync) {
  const primeiro = join(pasta, `${base}${ext}`);
  if (!existe(primeiro)) return primeiro;
  for (let i = 2; i < 1000; i++) {
    const outro = join(pasta, `${base}-${i}${ext}`);
    if (!existe(outro)) return outro;
  }
  throw new Error(`A pasta ${pasta} tem ${base}${ext} até ${base}-999${ext}: arrume a pasta antes.`);
}

// ---------------------------------------------------------------------------
// A trava: uma passagem por vez
// ---------------------------------------------------------------------------

/** @param {number} pid @param {number} agoraMs */
export function conteudoDaTrava(pid, agoraMs) {
  return `${JSON.stringify({ pid, desde: new Date(agoraMs).toISOString() })}\n`;
}

/**
 * A trava lida do arquivo; livre, vazia ou ilegível = nula. Soltar a trava
 * escreve "livre" em vez de apagar o arquivo.
 * @param {string} texto
 * @returns {{ pid: number, desdeMs: number } | null}
 */
export function lerTrava(texto) {
  try {
    const t = JSON.parse(texto);
    const desdeMs = Date.parse(t?.desde);
    if (t?.livre === true || !Number.isInteger(t?.pid) || !Number.isFinite(desdeMs)) return null;
    return { pid: t.pid, desdeMs };
  } catch {
    return null;
  }
}

/**
 * Ocupada = de um processo vivo e com menos de 3 h. O processo morto (o Mac
 * desligou no meio, um kill) libera na hora; o que ficou pendurado, no prazo.
 * @param {{ pid: number, desdeMs: number } | null} trava
 * @param {{ agoraMs: number, vivo: (pid: number) => boolean, prazoMs?: number }} o
 */
export function travaOcupada(trava, { agoraMs, vivo, prazoMs = PRAZO_DA_TRAVA_MS }) {
  if (!trava) return false;
  if (agoraMs - trava.desdeMs >= prazoMs) return false;
  return vivo(trava.pid);
}

/** @param {number} pid */
export function processoVivo(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return /** @type {NodeJS.ErrnoException} */ (e).code === 'EPERM';
  }
}

/** A porta de uma tomada que morreu no meio (milissegundos de trabalho) não fica fechada: passado isto, sai. */
export const PRAZO_DA_PORTA_MS = 60_000;

/**
 * Toma a trava ou diz que não deu (a segunda instância sai calada). Ler, conferir
 * e escrever a trava acontece atrás de uma PORTA criada com `wx`, que só um
 * processo abre por vez: `root-midia vigia` rodado à mão junto com o launchd
 * não sai com dois donos. Quem acha a porta fechada perdeu, e a porta que ficou
 * de uma tomada morta há mais de 1 min é retirada para a próxima passagem.
 * @param {string} caminho
 * @param {{ pid: number, agoraMs: number, vivo?: (pid: number) => boolean, prazoMs?: number }} o
 */
export function tomarTrava(caminho, { pid, agoraMs, vivo = processoVivo, prazoMs }) {
  mkdirSync(dirname(caminho), { recursive: true });
  const porta = `${caminho}.porta`;
  try {
    closeSync(openSync(porta, 'wx', 0o600));
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EEXIST') throw e;
    try {
      if (agoraMs - statSync(porta).mtimeMs >= PRAZO_DA_PORTA_MS) unlinkSync(porta);
    } catch {
      /* outra instância retirou antes */
    }
    return false;
  }
  try {
    const conteudo = conteudoDaTrava(pid, agoraMs);
    if (existsSync(caminho) && travaOcupada(lerTrava(readFileSync(caminho, 'utf8')), { agoraMs, vivo, prazoMs })) return false;
    writeFileSync(caminho, conteudo, { mode: 0o600 });
    return lerTrava(readFileSync(caminho, 'utf8'))?.pid === pid;
  } finally {
    unlinkSync(porta);
  }
}

/** Solta só a própria trava. @param {string} caminho @param {number} pid @param {number} agoraMs */
export function soltarTrava(caminho, pid, agoraMs) {
  try {
    if (lerTrava(readFileSync(caminho, 'utf8'))?.pid !== pid) return false;
    writeFileSync(caminho, `${JSON.stringify({ livre: true, em: new Date(agoraMs).toISOString() })}\n`);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// A memória entre passagens
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   notificacoes: Record<string, number>,
 *   renders: Record<string, { assinatura: string, em: number }>,
 *   brutosQueFalharam: Record<string, number>,
 * }} Memoria
 */

/** @param {string | null | undefined} texto @returns {Memoria} */
export function lerMemoria(texto) {
  /** @type {Memoria} */
  const vazia = { notificacoes: {}, renders: {}, brutosQueFalharam: {} };
  if (!texto) return vazia;
  try {
    const m = JSON.parse(texto);
    const objeto = (/** @type {unknown} */ v) => (v && typeof v === 'object' && !Array.isArray(v) ? /** @type {Record<string, any>} */ (v) : {});
    const numeros = (/** @type {unknown} */ v) => Object.fromEntries(Object.entries(objeto(v)).filter(([, n]) => typeof n === 'number' && Number.isFinite(n)));
    const renders = Object.fromEntries(
      Object.entries(objeto(m?.renders)).filter(([, r]) => typeof r?.assinatura === 'string' && typeof r?.em === 'number' && Number.isFinite(r.em)),
    );
    return { notificacoes: numeros(m?.notificacoes), renders, brutosQueFalharam: numeros(m?.brutosQueFalharam) };
  } catch {
    return vazia;
  }
}

/**
 * A notificação repetida (o mesmo "ambíguo" a cada 15 min) fica calada por 6 h.
 * Devolve a memória nova, ou nula quando é para calar.
 * @param {Memoria} m @param {string} texto @param {number} agoraMs
 * @returns {Memoria | null}
 */
export function registrarNotificacao(m, texto, agoraMs) {
  const antes = m.notificacoes[texto];
  if (antes !== undefined && agoraMs - antes < SILENCIO_DA_NOTIFICACAO_MS) return null;
  const notificacoes = Object.fromEntries(Object.entries(m.notificacoes).filter(([, em]) => agoraMs - em < SILENCIO_DA_NOTIFICACAO_MS));
  return { ...m, notificacoes: { ...notificacoes, [texto]: agoraMs } };
}

/**
 * O bruto é o mesmo arquivo enquanto caminho, tamanho e data não mudam. Um que
 * falhou (whisper, ffmpeg, 400 do OS) não é refeito a cada 15 min: o Pedro
 * roda à mão, ou regrava.
 * @param {string} caminho @param {number} tamanho @param {number} mtimeMs
 */
export function chaveDoBruto(caminho, tamanho, mtimeMs) {
  return `${caminho}|${tamanho}|${Math.round(mtimeMs)}`;
}

/** @param {string} episodioId @param {string} formato */
export function chaveDoRender(episodioId, formato) {
  return `${episodioId}:${formato}`;
}

/**
 * Os formatos a renderizar agora, na ordem corte → story → carrossel: o que o
 * OS diz que falta, menos o que já foi tentado com a mesma assinatura nas
 * últimas 24 h (nada mudou desde a tentativa — o carrossel com texto estourado
 * não é refeito a cada 15 min).
 * @param {{ id: string, precisaDeRender?: Record<string, { pecas: number, assinatura: string } | undefined> }} episodio
 * @param {Memoria} m
 * @param {number} agoraMs
 * @returns {Array<{ formato: 'corte' | 'story' | 'carrossel', pecas: number, assinatura: string }>}
 */
export function rendersAFazer(episodio, m, agoraMs) {
  /** @type {Array<'corte' | 'story' | 'carrossel'>} */
  const ordem = ['corte', 'story', 'carrossel'];
  /** @type {Array<{ formato: 'corte' | 'story' | 'carrossel', pecas: number, assinatura: string }>} */
  const saida = [];
  for (const formato of ordem) {
    const pendente = episodio.precisaDeRender?.[formato];
    if (!pendente || !(pendente.pecas > 0)) continue;
    const tentado = m.renders[chaveDoRender(episodio.id, formato)];
    if (tentado && tentado.assinatura === pendente.assinatura && agoraMs - tentado.em < ESPERA_DO_RENDER_REPETIDO_MS) continue;
    saida.push({ formato, pecas: pendente.pecas, assinatura: pendente.assinatura });
  }
  return saida;
}

// ---------------------------------------------------------------------------
// O launchd, a notificação e o log
// ---------------------------------------------------------------------------

/** @param {string} v */
function xml(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * O agente do launchd. WatchPaths na pasta do OBS (gravação nova), 15 min de
 * intervalo para o que não depende de arquivo novo (os renders da Derivação),
 * 60 s de folga entre disparos e o log no lugar do stdout. Das variáveis, SÓ o
 * caminho do arquivo delas: a senha fica no arquivo com permissão 600, nunca
 * aqui. `Nice` baixo porque ffmpeg e whisper disputam o Mac com uma reunião.
 * @param {{ rotulo?: string, node: string, script: string, obs: string, log: string, variaveis: string }} o
 */
export function plistDoVigia({ rotulo = ROTULO, node, script, obs, log, variaveis }) {
  const texto = (/** @type {string} */ v) => `<string>${xml(v)}</string>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  ${texto(rotulo)}
  <key>ProgramArguments</key>
  <array>
    ${texto(node)}
    ${texto(script)}
    ${texto('vigia')}
  </array>
  <key>WatchPaths</key>
  <array>
    ${texto(obs)}
  </array>
  <key>StartInterval</key>
  <integer>${INTERVALO_DO_AGENTE_SEG}</integer>
  <key>ThrottleInterval</key>
  <integer>${FOLGA_DO_AGENTE_SEG}</integer>
  <key>Nice</key>
  <integer>10</integer>
  <key>StandardOutPath</key>
  ${texto(log)}
  <key>StandardErrorPath</key>
  ${texto(log)}
  <key>EnvironmentVariables</key>
  <dict>
    <key>ROOT_MIDIA_ENV</key>
    ${texto(variaveis)}
  </dict>
</dict>
</plist>
`;
}

/**
 * Os argumentos do `launchctl` (sempre em lista, nunca num shell).
 * @param {'bootstrap' | 'bootout' | 'print'} acao
 * @param {{ uid: number, rotulo?: string, plist?: string }} o
 */
export function argsDoLaunchctl(acao, { uid, rotulo = ROTULO, plist }) {
  if (!Number.isInteger(uid) || uid < 0) throw new Error(`uid inválido: ${uid}`);
  if (acao === 'bootstrap') {
    if (!plist) throw new Error('bootstrap precisa do caminho do plist.');
    return ['bootstrap', `gui/${uid}`, plist];
  }
  return [acao, `gui/${uid}/${rotulo}`];
}

/**
 * O `osascript` recebe o texto como argumento do script (`on run argv`), nunca
 * dentro dele: nome de arquivo com aspas não vira AppleScript.
 * @param {string} mensagem @param {string} [titulo]
 */
export function argsDaNotificacao(mensagem, titulo = 'root-midia') {
  const limpo = (/** @type {string} */ v, /** @type {number} */ teto) => String(v).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, teto);
  return [
    '-e', 'on run argv',
    '-e', 'display notification (item 1 of argv) with title (item 2 of argv)',
    '-e', 'end run',
    limpo(mensagem, 240),
    limpo(titulo, 60),
  ];
}

/** Uma linha do log, com a hora; quebra de linha vira ⏎ para o `tail -1` do `estado` ler inteiro. @param {number} agoraMs @param {string} msg */
export function linhaDoLog(agoraMs, msg) {
  return `${new Date(agoraMs).toISOString()} ${String(msg).trimEnd().replace(/\r?\n+/g, ' ⏎ ')}\n`;
}

/** @param {number} tamanho @param {number} [teto] */
export function precisaRodarOLog(tamanho, teto = TETO_DO_LOG) {
  return tamanho >= teto;
}

/** A última linha com conteúdo do log. @param {string} texto */
export function ultimaLinha(texto) {
  const linhas = String(texto ?? '').split('\n').filter((l) => l.trim());
  return linhas[linhas.length - 1] ?? null;
}

/**
 * A permissão do arquivo de variáveis: com a senha dentro, só o dono lê.
 * @param {number} modo o `st.mode`
 */
export function permissaoAbertaDemais(modo) {
  return (modo & 0o077) !== 0;
}

// ---------------------------------------------------------------------------
// O ensaio
// ---------------------------------------------------------------------------

/**
 * A transcrição de ENSAIO: um segmento por trecho com som (o complemento dos
 * silêncios), com texto sintético. Só vale contra a API desta máquina (quem
 * chama confere) e nunca com o modelo do whisper à mão. Com `palavra`, o
 * segundo trecho a leva — a cadeia tira essa tomada e a anterior, como numa
 * gravação de verdade.
 * @param {Array<{ inicio: number, fim: number }>} silencios
 * @param {number} duracao
 * @param {{ palavra?: string | null }} [o]
 */
export function transcricaoDeEnsaio(silencios, duracao, { palavra = null } = {}) {
  const ordenados = [...silencios].sort((a, b) => a.inicio - b.inicio);
  /** @type {Array<{ inicio: number, fim: number, texto: string }>} */
  const segmentos = [];
  let t = 0;
  const arred = (/** @type {number} */ v) => Math.round(v * 1000) / 1000;
  for (const s of [...ordenados, { inicio: duracao, fim: duracao }]) {
    const fim = Math.min(s.inicio, duracao);
    if (fim - t >= 0.3) {
      const n = segmentos.length + 1;
      const texto = palavra && n === 2 ? `Trecho ${n} do ensaio, ${palavra}.` : `Trecho ${n} do ensaio do vigia.`;
      segmentos.push({ inicio: arred(t), fim: arred(fim), texto });
    }
    t = Math.max(t, s.fim);
  }
  if (!segmentos.length && duracao > 0) segmentos.push({ inicio: 0, fim: arred(duracao), texto: 'Trecho 1 do ensaio do vigia.' });
  return { duracaoSeg: arred(duracao), idioma: 'pt', modelo: 'ensaio', segmentos };
}
