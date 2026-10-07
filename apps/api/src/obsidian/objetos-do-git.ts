import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

/*
 * ============================================================================
 * UM OBJETO DO GIT, LIDO SEM O GIT — só para a data do commit do recibo
 * ============================================================================
 *
 * O recibo a montante (C19-08) diz em que commit a vault está e de QUANDO é esse
 * commit (`commitEm`). O identificador sai de `HEAD`; a data mora dentro do
 * objeto do commit, que o git guarda solto (`objects/ab/cdef…`, comprimido com
 * zlib) ou dentro de um pacote (`objects/pack/*.pack`, achado pelo `.idx`, e às
 * vezes guardado como diferença de outro objeto).
 *
 * É LEITURA DE MELHOR ESFORÇO, e a assimetria é a decisão: a data do commit é
 * informação para quem lê o recibo, não critério de pertença. Pertença usa só o
 * índice e o blob (`indice-do-git.ts`). Qualquer coisa que não feche aqui —
 * objeto ausente, pacote em formato que este leitor não conhece, cadeia de
 * diferenças longa demais — devolve `null` com o motivo, e o recibo diz
 * "data do commit não lida" em vez de inventar uma.
 *
 * `zlib` é do próprio Node: nenhuma dependência nova.
 */

/** Teto de diferenças encadeadas. O git usa 50 por padrão (`pack.depth`). */
const PROFUNDIDADE_MAXIMA = 64;

/** Teto do objeto lido, para um commit que se diz enorme não virar alocação enorme. */
const MAIOR_OBJETO = 8 * 1024 * 1024;

export interface ObjetoDoGit {
  tipo: 'commit' | 'tree' | 'blob' | 'tag';
  conteudo: Buffer;
}

const TIPOS: Record<number, ObjetoDoGit['tipo']> = { 1: 'commit', 2: 'tree', 3: 'blob', 4: 'tag' };

class ObjetoIlegivel extends Error {}

/**
 * Descomprime um fluxo zlib que começa em `inicio`, sem saber onde ele acaba.
 * O `inflateSync` ignora o que vem depois do fim do fluxo e reclama quando o
 * fluxo está cortado; por isso a janela cresce até caber.
 */
function descomprimir(ler: (pos: number, tamanho: number) => Buffer, inicio: number, esperado: number): Buffer {
  let janela = Math.max(4096, esperado * 2 + 1024);
  for (let tentativa = 0; tentativa < 6; tentativa++) {
    const pedaco = ler(inicio, janela);
    try {
      const saida = inflateSync(pedaco);
      if (saida.length !== esperado) {
        throw new ObjetoIlegivel(`objeto descomprimido com ${saida.length} bytes, esperado ${esperado}`);
      }
      return saida;
    } catch (e) {
      if (e instanceof ObjetoIlegivel) throw e;
      const cortado = (e as { code?: string }).code === 'Z_BUF_ERROR';
      if (!cortado || pedaco.length < janela) throw new ObjetoIlegivel(`fluxo zlib ilegível (${(e as Error).message})`);
      janela *= 4;
    }
  }
  throw new ObjetoIlegivel('fluxo zlib maior que o teto de leitura');
}

/** Aplica uma diferença de pacote (`gitformat-pack(5)`, "deltified representation"). */
export function aplicarDiferenca(base: Buffer, delta: Buffer): Buffer {
  let i = 0;
  const lerTamanho = (): number => {
    let valor = 0;
    let deslocamento = 0;
    let c: number;
    do {
      if (i >= delta.length) throw new ObjetoIlegivel('diferença cortada no tamanho');
      c = delta[i++];
      valor += (c & 0x7f) * 2 ** deslocamento;
      deslocamento += 7;
    } while (c & 0x80);
    return valor;
  };
  const tamanhoDaBase = lerTamanho();
  if (tamanhoDaBase !== base.length) throw new ObjetoIlegivel('a diferença não é desta base');
  const tamanhoFinal = lerTamanho();
  if (tamanhoFinal > MAIOR_OBJETO) throw new ObjetoIlegivel('objeto grande demais');
  const saida = Buffer.alloc(tamanhoFinal);
  let escrito = 0;
  while (i < delta.length) {
    const op = delta[i++];
    if (op & 0x80) {
      let deslocamento = 0;
      let tamanho = 0;
      for (let b = 0; b < 4; b++) if (op & (1 << b)) deslocamento += delta[i++] * 2 ** (8 * b);
      for (let b = 0; b < 3; b++) if (op & (1 << (4 + b))) tamanho += delta[i++] * 2 ** (8 * b);
      if (tamanho === 0) tamanho = 0x10000;
      if (deslocamento + tamanho > base.length || escrito + tamanho > tamanhoFinal) {
        throw new ObjetoIlegivel('cópia da diferença fora dos limites');
      }
      base.copy(saida, escrito, deslocamento, deslocamento + tamanho);
      escrito += tamanho;
    } else if (op > 0) {
      if (i + op > delta.length || escrito + op > tamanhoFinal) throw new ObjetoIlegivel('inserção da diferença fora dos limites');
      delta.copy(saida, escrito, i, i + op);
      escrito += op;
      i += op;
    } else {
      throw new ObjetoIlegivel('instrução 0 numa diferença (reservada)');
    }
  }
  if (escrito !== tamanhoFinal) throw new ObjetoIlegivel('a diferença não produziu o tamanho declarado');
  return saida;
}

/** Um pacote e o índice dele, lidos sob demanda. */
interface Pacote {
  caminhoDoPacote: string;
  idx: Buffer;
  total: number;
}

function carregarPacotes(gitDir: string): Pacote[] {
  const pasta = join(gitDir, 'objects', 'pack');
  if (!existsSync(pasta)) return [];
  const pacotes: Pacote[] = [];
  for (const nome of readdirSync(pasta)) {
    if (!nome.endsWith('.idx')) continue;
    const idx = readFileSync(join(pasta, nome));
    // Só o índice de pacote versão 2: `\377tOc` e a versão 2.
    if (idx.length < 8 + 256 * 4 || idx.readUInt32BE(0) !== 0xff744f63 || idx.readUInt32BE(4) !== 2) continue;
    const total = idx.readUInt32BE(8 + 255 * 4);
    pacotes.push({ caminhoDoPacote: join(pasta, nome.replace(/\.idx$/, '.pack')), idx, total });
  }
  return pacotes;
}

/** O deslocamento do objeto no pacote, ou `null` se ele não está neste pacote. */
function deslocamentoNoPacote(p: Pacote, sha: Buffer): number | null {
  const fanout = 8;
  const primeiro = sha[0];
  let baixo = primeiro === 0 ? 0 : p.idx.readUInt32BE(fanout + (primeiro - 1) * 4);
  let alto = p.idx.readUInt32BE(fanout + primeiro * 4);
  const nomes = fanout + 256 * 4;
  while (baixo < alto) {
    const meio = (baixo + alto) >>> 1;
    const c = Buffer.compare(p.idx.subarray(nomes + meio * 20, nomes + meio * 20 + 20), sha);
    if (c === 0) {
      const crcs = nomes + p.total * 20;
      const offs = crcs + p.total * 4;
      const v = p.idx.readUInt32BE(offs + meio * 4);
      if (v & 0x80000000) {
        const grandes = offs + p.total * 4;
        const k = v & 0x7fffffff;
        return Number(p.idx.readBigUInt64BE(grandes + k * 8));
      }
      return v;
    }
    if (c < 0) baixo = meio + 1;
    else alto = meio;
  }
  return null;
}

function lerDoPacote(p: Pacote, deslocamento: number, gitDir: string, pacotes: Pacote[], profundidade: number): ObjetoDoGit {
  if (profundidade > PROFUNDIDADE_MAXIMA) throw new ObjetoIlegivel('cadeia de diferenças longa demais');
  const fd = openSync(p.caminhoDoPacote, 'r');
  try {
    const tamanhoDoArquivo = statSync(p.caminhoDoPacote).size;
    const ler = (pos: number, tamanho: number): Buffer => {
      const n = Math.max(0, Math.min(tamanho, tamanhoDoArquivo - pos));
      const buf = Buffer.alloc(n);
      if (n > 0) readSync(fd, buf, 0, n, pos);
      return buf;
    };
    const cab = ler(deslocamento, 32);
    let i = 0;
    let c = cab[i++];
    const tipo = (c >> 4) & 0x7;
    let tamanho = c & 0x0f;
    let deslocamentoDoTamanho = 4;
    while (c & 0x80) {
      c = cab[i++];
      tamanho += (c & 0x7f) * 2 ** deslocamentoDoTamanho;
      deslocamentoDoTamanho += 7;
    }
    if (tamanho > MAIOR_OBJETO) throw new ObjetoIlegivel('objeto grande demais');

    if (tipo >= 1 && tipo <= 4) {
      return { tipo: TIPOS[tipo], conteudo: descomprimir(ler, deslocamento + i, tamanho) };
    }
    if (tipo === 6) {
      // OFS_DELTA: a base está N bytes antes, na codificação de `lerInteiroVariavel`.
      let b = cab[i++];
      let distancia = b & 0x7f;
      while (b & 0x80) {
        b = cab[i++];
        distancia = (distancia + 1) * 128 + (b & 0x7f);
      }
      const base = lerDoPacote(p, deslocamento - distancia, gitDir, pacotes, profundidade + 1);
      const delta = descomprimir(ler, deslocamento + i, tamanho);
      return { tipo: base.tipo, conteudo: aplicarDiferenca(base.conteudo, delta) };
    }
    if (tipo === 7) {
      // REF_DELTA: a base é outro objeto, pelo identificador.
      const shaDaBase = ler(deslocamento + i, 20).toString('hex');
      const base = lerObjetoOuLancar(gitDir, shaDaBase, pacotes, profundidade + 1);
      const delta = descomprimir(ler, deslocamento + i + 20, tamanho);
      return { tipo: base.tipo, conteudo: aplicarDiferenca(base.conteudo, delta) };
    }
    throw new ObjetoIlegivel(`tipo ${tipo} de objeto de pacote desconhecido`);
  } finally {
    closeSync(fd);
  }
}

function lerObjetoOuLancar(gitDir: string, sha: string, pacotes: Pacote[], profundidade = 0): ObjetoDoGit {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new ObjetoIlegivel('identificador de objeto inválido');
  const solto = join(gitDir, 'objects', sha.slice(0, 2), sha.slice(2));
  if (existsSync(solto)) {
    const bruto = inflateSync(readFileSync(solto));
    const nul = bruto.indexOf(0);
    const cab = nul > 0 ? bruto.toString('latin1', 0, nul) : '';
    const m = /^(commit|tree|blob|tag) (\d+)$/.exec(cab);
    if (!m || Number(m[2]) !== bruto.length - nul - 1) throw new ObjetoIlegivel('cabeçalho de objeto solto ilegível');
    return { tipo: m[1] as ObjetoDoGit['tipo'], conteudo: bruto.subarray(nul + 1) };
  }
  const alvo = Buffer.from(sha, 'hex');
  for (const p of pacotes) {
    const deslocamento = deslocamentoNoPacote(p, alvo);
    if (deslocamento !== null) return lerDoPacote(p, deslocamento, gitDir, pacotes, profundidade);
  }
  throw new ObjetoIlegivel('objeto não encontrado (nem solto, nem nos pacotes)');
}

/** Um objeto pelo identificador. Nunca lança: o motivo vem junto. */
export function lerObjetoDoGit(gitDir: string, sha: string): { objeto: ObjetoDoGit | null; motivo: string | null } {
  try {
    return { objeto: lerObjetoOuLancar(gitDir, sha, carregarPacotes(gitDir)), motivo: null };
  } catch (e) {
    return { objeto: null, motivo: (e as Error).message };
  }
}

/** O instante do `committer` de um commit, que é quando ele foi gravado. */
export function dataDoCommit(conteudo: Buffer): Date | null {
  const texto = conteudo.toString('utf8');
  const fimDoCabecalho = texto.indexOf('\n\n');
  const cabecalho = fimDoCabecalho >= 0 ? texto.slice(0, fimDoCabecalho) : texto;
  const linha = cabecalho.split('\n').find((l) => l.startsWith('committer '));
  const m = linha ? / (\d+) [+-]\d{4}$/.exec(linha) : null;
  return m ? new Date(Number(m[1]) * 1000) : null;
}
