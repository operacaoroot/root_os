import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { lerIndiceDoGit, type LeituraDoIndice } from './indice-do-git';
import { dataDoCommit, lerObjetoDoGit } from './objetos-do-git';

/*
 * ============================================================================
 * O `.git` DA VAULT, VISTO DE DENTRO DO CONTAINER (C19-03 e C19-08)
 * ============================================================================
 *
 * Duas perguntas, e as duas sem o binário do git:
 *
 *  1. DÁ PARA CONFIAR NO ÍNDICE COMO LISTA DO QUE O GIT RASTREIA? Não dá quando
 *     o repositório usa objetos SHA-256 (o identificador de blob muda de tamanho
 *     e de algoritmo), quando o clone converte fim de linha ou passa o arquivo
 *     por filtro (`core.autocrlf`, `.gitattributes` com `text`, `eol`, `filter`,
 *     `ident`, `working-tree-encoding`: os bytes do disco deixam de ser os do
 *     blob, e toda nota pareceria alterada fora do git), ou quando a
 *     configuração inclui outro arquivo que o container não enxerga. Nesses
 *     casos a resposta é "rastreamento não verificável" e a volta não escreve
 *     nada (C19-03).
 *
 *  2. O QUE O RECIBO A MONTANTE DIZ (C19-08)? Em que commit a vault está, de
 *     quando ele é, quando foi a última busca bem-sucedida (`FETCH_HEAD`), quando
 *     o `HEAD` andou pela última vez (`logs/HEAD`) e se a vault ficou atrás do
 *     que a busca trouxe — que é como o congelamento do `pull --ff-only` aparece
 *     aqui dentro, já que o log do cron fica fora do container.
 *
 * A configuração GLOBAL do git da VPS (`/root/.gitconfig`, `/etc/gitconfig`) não
 * está montada. Um `core.autocrlf` posto lá converteria os arquivos sem nada
 * aqui saber; o sintoma seria uma taxa alta de "alterado fora do git", e é por
 * isso que a pertença transforma essa taxa num aviso único de conversão
 * provável (R-2), em vez de centenas de linhas.
 */

export interface ConfigDoGit {
  /** `secao.chave` ou `secao.subsecao.chave`, chave e seção em minúsculas. */
  valores: Map<string, string[]>;
}

/** Lê o formato de `.git/config` (`git-config(1)`, "CONFIGURATION FILE"). */
export function lerConfigDoGit(texto: string): ConfigDoGit {
  const valores = new Map<string, string[]>();
  let secao = '';
  const linhas = texto.replace(/\r\n?/g, '\n').split('\n');
  for (let n = 0; n < linhas.length; n++) {
    let linha = linhas[n];
    // Continuação de linha: barra invertida no fim, fora de aspas.
    while (/\\$/.test(linha) && n + 1 < linhas.length) linha = linha.slice(0, -1) + linhas[++n];
    const t = linha.trim();
    if (!t || t.startsWith('#') || t.startsWith(';')) continue;
    const cab = /^\[\s*([A-Za-z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\s*\](.*)$/.exec(t);
    if (cab) {
      const [, nome, sub] = cab;
      const partes = nome.toLowerCase().split('.');
      secao = sub !== undefined ? `${partes[0]}.${sub.replace(/\\(.)/g, '$1')}` : partes.join('.');
      const resto = cab[3].trim();
      if (!resto || resto.startsWith('#') || resto.startsWith(';')) continue;
      linha = resto;
    }
    const m = /^\s*([A-Za-z][A-Za-z0-9-]*)\s*(?:=(.*))?$/.exec(linha);
    if (!m || !secao) continue;
    const chave = `${secao}.${m[1].toLowerCase()}`;
    const valor = m[2] === undefined ? 'true' : valorDaConfig(m[2]);
    valores.set(chave, [...(valores.get(chave) ?? []), valor]);
  }
  return { valores };
}

/** Tira comentário fora de aspas, aspas e os escapes simples. */
function valorDaConfig(bruto: string): string {
  let saida = '';
  let emAspas = false;
  for (let i = 0; i < bruto.length; i++) {
    const c = bruto[i];
    if (c === '"') {
      emAspas = !emAspas;
      continue;
    }
    if (!emAspas && (c === '#' || c === ';')) break;
    if (c === '\\' && i + 1 < bruto.length) {
      const p = bruto[++i];
      saida += p === 'n' ? '\n' : p === 't' ? '\t' : p === 'b' ? '\b' : p;
      continue;
    }
    saida += c;
  }
  return saida.trim();
}

/** O último valor de uma chave (o git usa o último quando ela se repete). */
export function valorDaChave(config: ConfigDoGit, chave: string): string | null {
  const v = config.valores.get(chave.toLowerCase());
  return v && v.length ? v[v.length - 1] : null;
}

function verdadeiro(v: string | null): boolean {
  return v !== null && ['true', 'yes', 'on', '1'].includes(v.toLowerCase());
}

/**
 * A configuração do repositório deixa os bytes do disco iguais aos do blob?
 * Devolve o motivo quando não deixa, ou quando não dá para saber.
 */
export function motivoNaConfig(config: ConfigDoGit): string | null {
  const formato = valorDaChave(config, 'extensions.objectformat');
  if (formato && formato.toLowerCase() !== 'sha1') {
    return `o repositório usa objetos ${formato} (extensions.objectformat); o leitor confere blobs SHA-1`;
  }
  const autocrlf = valorDaChave(config, 'core.autocrlf');
  if (autocrlf && (verdadeiro(autocrlf) || autocrlf.toLowerCase() === 'input')) {
    return `core.autocrlf=${autocrlf}: o git converte fim de linha, e o disco deixa de ser o blob`;
  }
  for (const chave of config.valores.keys()) {
    if (chave === 'include.path' || (chave.startsWith('includeif.') && chave.endsWith('.path'))) {
      return 'a configuração do repositório inclui outro arquivo, que o container não enxerga';
    }
  }
  if (valorDaChave(config, 'core.attributesfile')) {
    return 'core.attributesFile aponta atributos para fora do repositório, que o container não enxerga';
  }
  if (verdadeiro(valorDaChave(config, 'core.bare'))) {
    return 'o repositório é bare: não há cópia de trabalho a conferir';
  }
  if (verdadeiro(valorDaChave(config, 'core.splitindex'))) {
    return 'core.splitIndex: índice dividido, as entradas moram em outro arquivo';
  }
  return null;
}

/** Atributos que convertem o conteúdo entre o blob e o disco. */
const ATRIBUTOS_QUE_CONVERTEM = new Set(['text', 'eol', 'crlf', 'filter', 'ident', 'working-tree-encoding']);

/**
 * Um `.gitattributes` liga conversão em algum arquivo? Conservador de propósito:
 * qualquer linha que ATRIBUA um desses atributos (inclusive dentro de uma
 * definição de macro `[attr]`) conta, sem tentar descobrir se o padrão alcança
 * algum `.md`. Desligar (`-text`, `!eol`) não converte nada e não conta.
 */
export function atributosConvertem(texto: string): string | null {
  for (const bruta of texto.replace(/\r\n?/g, '\n').split('\n')) {
    const linha = bruta.trim();
    if (!linha || linha.startsWith('#')) continue;
    const campos = linha.split(/\s+/).slice(1);
    for (const campo of campos) {
      if (campo.startsWith('-') || campo.startsWith('!')) continue;
      const nome = campo.split('=')[0].toLowerCase();
      if (ATRIBUTOS_QUE_CONVERTEM.has(nome)) return `"${linha}"`;
    }
  }
  return null;
}

/**
 * O endereço do repositório sem credencial. `https://usuario:token@host/x`
 * vira `https://host/x`; o formato `git@host:caminho` não carrega senha (o
 * `:` ali separa host e caminho) e fica como está. Consulta e fragmento saem.
 */
export function urlSemCredencial(url: string | null): string | null {
  if (!url) return null;
  const u = url.trim();
  const comEsquema = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)([^?#]*)/i.exec(u);
  if (comEsquema) {
    const autoridade = comEsquema[2].includes('@') ? comEsquema[2].slice(comEsquema[2].lastIndexOf('@') + 1) : comEsquema[2];
    return `${comEsquema[1]}${autoridade}${comEsquema[3]}`;
  }
  return u.split(/[?#]/)[0];
}

/** A linha do `FETCH_HEAD` que o `pull` funde: a primeira sem `not-for-merge`. */
export function remotoDoFetchHead(texto: string): string | null {
  for (const linha of texto.split('\n')) {
    const m = /^([0-9a-f]{40,64})\t([^\t]*)\t/.exec(linha);
    if (m && m[2] !== 'not-for-merge') return m[1];
  }
  return null;
}

/** O instante da última linha de um reflog (`logs/HEAD`). Nome e e-mail ficam de fora. */
export function ultimaLinhaDoReflog(texto: string): { de: string; para: string; em: Date } | null {
  const linhas = texto.split('\n').filter((l) => l.trim());
  for (let i = linhas.length - 1; i >= 0; i--) {
    const m = /^([0-9a-f]{40,64}) ([0-9a-f]{40,64}) .*?(\d+) [+-]\d{4}(?:\t.*)?$/.exec(linhas[i]);
    if (m) return { de: m[1], para: m[2], em: new Date(Number(m[3]) * 1000) };
  }
  return null;
}

/** Resolve `HEAD` (`ref: refs/heads/x` ou identificador solto) pelos refs soltos e por `packed-refs`. */
export function resolverHead(gitDir: string): string | null {
  const head = lerTexto(join(gitDir, 'HEAD'))?.trim();
  if (!head) return null;
  if (/^[0-9a-f]{40,64}$/.test(head)) return head;
  const m = /^ref:\s*(\S+)$/.exec(head);
  if (!m || m[1].includes('..')) return null;
  const solto = lerTexto(join(gitDir, m[1]))?.trim();
  if (solto && /^[0-9a-f]{40,64}$/.test(solto)) return solto;
  for (const linha of (lerTexto(join(gitDir, 'packed-refs')) ?? '').split('\n')) {
    const p = /^([0-9a-f]{40,64}) (\S+)$/.exec(linha.trim());
    if (p && p[2] === m[1]) return p[1];
  }
  return null;
}

function lerTexto(caminho: string): string | null {
  try {
    return readFileSync(caminho, 'utf8');
  } catch {
    return null;
  }
}

/** O endereço do remoto do ramo atual (ou de `origin`), sem credencial. */
function remotoDaConfig(config: ConfigDoGit, gitDir: string): string | null {
  const head = lerTexto(join(gitDir, 'HEAD'))?.trim() ?? '';
  const ramo = /^ref:\s*refs\/heads\/(.+)$/.exec(head)?.[1];
  const remoto = (ramo && valorDaChave(config, `branch.${ramo}.remote`)) || 'origin';
  return urlSemCredencial(valorDaChave(config, `remote.${remoto}.url`));
}

/** O que o recibo publica sobre a montante (C19-08, bloco `montante`). */
export interface MontanteDaVault {
  repositorio: string | null;
  commit: string | null;
  commitEm: string | null;
  /** Por que `commitEm` ficou nulo, quando ficou. */
  commitEmMotivo: string | null;
  /** A última busca que TROUXE o remoto (`FETCH_HEAD` com a linha que o pull funde). */
  ultimaBuscaEm: string | null;
  /**
   * A última busca que terminou SEM trazer nada. Medido no E-20.2 com o git
   * 2.50.1: uma busca que falha (remoto fora, chave recusada) zera o
   * `FETCH_HEAD` e atualiza a data dele. A data do arquivo, sozinha, diria
   * "buscou agora" sobre uma busca que falhou — por isso as duas ficam separadas,
   * e a busca boa anterior deixa de ser visível até a próxima dar certo.
   */
  ultimaBuscaFalhouEm: string | null;
  ultimoAvancoEm: string | null;
  remotoNaBusca: string | null;
  /** `HEAD` diferente do que a última busca trouxe: o `pull` buscou e não fundiu. */
  atrasado: boolean;
  /** A última busca falhou, ou a última bem-sucedida é mais velha que `PRAZO_DA_BUSCA_MS`. */
  buscaParada: boolean;
  errosDoPull: 'não visível no container';
}

/**
 * Quanto tempo sem busca bem-sucedida faz a montante contar como parada. O cron
 * da VPS busca a cada 5 minutos (ROOT-05, I2); uma hora são doze buscas
 * perdidas seguidas, o que já não é soluço de rede. Decisão técnica desta fatia,
 * reversível: o número só decide se o recibo diz `parcial` em vez de `ok`.
 */
export const PRAZO_DA_BUSCA_MS = 60 * 60 * 1000;

/** Tudo o que a volta lê do `.git`, numa leitura só. */
export interface RepositorioDaVault {
  /** `null` quando a vault não tem `.git` (diretório). */
  gitDir: string | null;
  indice: LeituraDoIndice | null;
  /** Motivo de "rastreamento não verificável", ou `null` quando dá para confiar. */
  naoVerificavel: string | null;
  montante: MontanteDaVault;
  /** `HEAD` e mtime do índice, para conferir que nada andou no meio da volta (R-2). */
  marca: { head: string | null; indiceModificadoEm: number | null };
}

/** A marca de "antes e depois" da volta: se o `pull` mexeu no meio, ela muda. */
export function marcaDoRepositorio(raiz: string): RepositorioDaVault['marca'] {
  const gitDir = join(raiz, '.git');
  let indiceModificadoEm: number | null = null;
  try {
    indiceModificadoEm = statSync(join(gitDir, 'index')).mtimeMs;
  } catch {
    indiceModificadoEm = null;
  }
  return { head: existsSync(gitDir) ? resolverHead(gitDir) : null, indiceModificadoEm };
}

/**
 * Lê o `.git` da vault. Nunca lança: o que não dá para ler vira motivo de
 * "rastreamento não verificável" e campos nulos no bloco `montante`.
 *
 * `atributos` são os textos dos `.gitattributes` que o passeio da vault achou
 * (`listarArquivos`); `.git/info/attributes` é lido aqui.
 */
export function lerRepositorioDaVault(
  raiz: string,
  atributos: Array<{ caminho: string; texto: string }>,
  agora: Date = new Date(),
): RepositorioDaVault {
  const gitDir = join(raiz, '.git');
  const montanteVazio: MontanteDaVault = {
    repositorio: null,
    commit: null,
    commitEm: null,
    commitEmMotivo: null,
    ultimaBuscaEm: null,
    ultimaBuscaFalhouEm: null,
    ultimoAvancoEm: null,
    remotoNaBusca: null,
    atrasado: false,
    buscaParada: false,
    errosDoPull: 'não visível no container',
  };
  let ehDiretorio = false;
  try {
    ehDiretorio = statSync(gitDir).isDirectory();
  } catch {
    ehDiretorio = false;
  }
  if (!ehDiretorio) {
    return {
      gitDir: null,
      indice: null,
      naoVerificavel: existsSync(gitDir)
        ? '.git é arquivo (worktree ou submódulo), não diretório: o índice mora em outro lugar'
        : 'a vault não tem .git: não há como saber o que o git rastreia',
      montante: montanteVazio,
      marca: { head: null, indiceModificadoEm: null },
    };
  }

  const config = lerConfigDoGit(lerTexto(join(gitDir, 'config')) ?? '');
  let naoVerificavel = motivoNaConfig(config);
  if (!naoVerificavel) {
    const infoAttributes = lerTexto(join(gitDir, 'info', 'attributes'));
    const todos = [...atributos, ...(infoAttributes !== null ? [{ caminho: '.git/info/attributes', texto: infoAttributes }] : [])];
    for (const a of todos) {
      const linha = atributosConvertem(a.texto);
      if (linha) {
        naoVerificavel = `${a.caminho} liga conversão de conteúdo (${linha}), e o disco deixa de ser o blob`;
        break;
      }
    }
  }

  if (!naoVerificavel) {
    try {
      if (readdirSync(gitDir).some((n) => n.startsWith('sharedindex.'))) {
        naoVerificavel = 'índice dividido (.git/sharedindex.*): as entradas moram em outro arquivo';
      }
    } catch {
      // A leitura do índice logo abaixo diz o que houver.
    }
  }

  let indice: LeituraDoIndice | null = null;
  let indiceModificadoEm: number | null = null;
  try {
    const caminhoDoIndice = join(gitDir, 'index');
    indiceModificadoEm = statSync(caminhoDoIndice).mtimeMs;
    indice = lerIndiceDoGit(readFileSync(caminhoDoIndice));
  } catch (e) {
    indice = { ok: false, motivo: `não consegui ler .git/index (${(e as Error).message})` };
  }
  if (!naoVerificavel && indice && !indice.ok) naoVerificavel = indice.motivo;

  const commit = resolverHead(gitDir);
  let commitEm: string | null = null;
  let commitEmMotivo: string | null = null;
  if (commit) {
    const { objeto, motivo } = lerObjetoDoGit(gitDir, commit);
    const data = objeto?.tipo === 'commit' ? dataDoCommit(objeto.conteudo) : null;
    commitEm = data ? data.toISOString() : null;
    commitEmMotivo = data ? null : (motivo ?? 'o objeto de HEAD não é um commit legível');
  } else {
    commitEmMotivo = 'HEAD não resolve para um commit';
  }

  let ultimaBuscaEm: Date | null = null;
  let ultimaBuscaFalhouEm: Date | null = null;
  let remotoNaBusca: string | null = null;
  try {
    const caminho = join(gitDir, 'FETCH_HEAD');
    const quando = statSync(caminho).mtime;
    remotoNaBusca = remotoDoFetchHead(readFileSync(caminho, 'utf8'));
    if (remotoNaBusca) ultimaBuscaEm = quando;
    else ultimaBuscaFalhouEm = quando;
  } catch {
    ultimaBuscaEm = null;
  }
  const reflog = ultimaLinhaDoReflog(lerTexto(join(gitDir, 'logs', 'HEAD')) ?? '');
  const repositorio = remotoDaConfig(config, gitDir);

  return {
    gitDir,
    indice,
    naoVerificavel,
    montante: {
      repositorio,
      commit,
      commitEm,
      commitEmMotivo,
      ultimaBuscaEm: ultimaBuscaEm ? ultimaBuscaEm.toISOString() : null,
      ultimaBuscaFalhouEm: ultimaBuscaFalhouEm ? ultimaBuscaFalhouEm.toISOString() : null,
      ultimoAvancoEm: reflog ? reflog.em.toISOString() : null,
      remotoNaBusca,
      atrasado: Boolean(commit && remotoNaBusca && commit !== remotoNaBusca),
      // Sem remoto não há montante a ficar parada. Com remoto: nunca buscou, a última
      // busca falhou, ou a última que deu certo passou do prazo.
      buscaParada:
        Boolean(repositorio) &&
        (!ultimaBuscaEm || Boolean(ultimaBuscaFalhouEm) || agora.getTime() - ultimaBuscaEm.getTime() > PRAZO_DA_BUSCA_MS),
      errosDoPull: 'não visível no container',
    },
    marca: { head: commit, indiceModificadoEm },
  };
}
