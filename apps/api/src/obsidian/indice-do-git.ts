import { createHash } from 'node:crypto';

/*
 * ============================================================================
 * O ÍNDICE DO GIT DA VAULT, LIDO SEM O GIT (C19-03, R-2 da ROOT-19-REV)
 * ============================================================================
 *
 * A imagem da API não tem o binário do git (`Dockerfile`: `node:22-slim` com
 * `openssl` e `ca-certificates`), e a vault chega montada só leitura com o
 * `.git` junto. Para saber se um `.md` pertence à coleção `vault:` basta o
 * arquivo `.git/index`: ele diz quais caminhos o git rastreia e qual blob cada
 * um deve ter. Este arquivo lê esse formato (`gitformat-index(5)`) e mais nada.
 *
 * FUNÇÕES PURAS, sem disco e sem banco: quem lê os bytes é o conector. É o que
 * deixa a suíte provar cada recusa com um índice de verdade, criado pelo git do
 * próprio teste, sem montar serviço nenhum.
 *
 * O QUE ELE LÊ: as versões 2, 3 e 4 (a 4, com a compressão de prefixo do
 * caminho, aparece quando alguém liga `feature.manyFiles` ou `index.version` —
 * recusá-la pararia a projeção por uma escolha de desempenho do clone).
 *
 * O QUE ELE RECUSA, e recusar aqui quer dizer "índice ilegível": a volta não
 * cria, não altera e não arquiva nada (C19-03).
 *   · assinatura, versão, contagem ou tamanho que não fecham;
 *   · soma final que não confere — a soma NULA é aceita, porque é o que o git
 *     grava com `index.skipHash`;
 *   · extensão obrigatória (primeira letra minúscula). As duas que existem hoje
 *     são `link` (índice dividido: as entradas moram em outro arquivo) e `sdir`
 *     (índice esparso: uma entrada vale por um diretório inteiro). Em nenhuma
 *     das duas a lista lida aqui é a lista de arquivos rastreados;
 *   · caminho que o próprio git nunca grava (vazio, absoluto, com `.`, `..` ou
 *     `.git` como componente, com barra no fim) ou entradas fora de ordem.
 *
 * O QUE ELE NÃO DECIDE: pertença. Uma entrada com estágio diferente de 0
 * (conflito de merge), com `skip-worktree` ou `intent-to-add`, ou com modo de
 * link simbólico ou de submódulo, é devolvida como está; quem a classifica como
 * "não verificável" é `pertenca-da-vault.ts`.
 *
 * O QUE ELE NÃO COBRE, dito para ninguém supor que cobre: o índice não é o
 * `HEAD`. Um `git add` sem commit na VPS faz o arquivo contar como rastreado
 * (R-2). Fechar isso pede ler a árvore do commit, que é outra fatia.
 */

/** Tamanho do identificador de objeto e da soma final num repositório SHA-1. */
const TAMANHO_DO_HASH = 20;

/** O que antecede o identificador em cada entrada: dez campos de 32 bits. */
const CAMPOS_FIXOS = 40;

/** Os quatro tipos de objeto que o campo `mode` admite (os 4 bits altos dos 16 baixos). */
export const TIPO_ARQUIVO = 0b1000;
export const TIPO_LINK_SIMBOLICO = 0b1010;
export const TIPO_SUBMODULO = 0b1110;

export interface EntradaDoIndice {
  /** O caminho como o git o gravou, em BYTES. É ele que se compara com o disco (R-1). */
  caminho: Buffer;
  /** O `mode` inteiro (0o100644, 0o100755, 0o120000, 0o160000…). */
  modo: number;
  /** O identificador do blob, em hexadecimal minúsculo. */
  blob: string;
  /** 0 é o normal; 1 a 3 são os lados de um conflito de merge. */
  estagio: number;
  skipWorktree: boolean;
  intentToAdd: boolean;
}

export type LeituraDoIndice =
  | {
      ok: true;
      versao: 2 | 3 | 4;
      entradas: EntradaDoIndice[];
      /** As assinaturas das extensões opcionais que foram puladas, na ordem. */
      extensoes: string[];
      /** A soma final era nula (`index.skipHash`) e por isso não foi conferida. */
      somaNula: boolean;
    }
  | { ok: false; motivo: string };

class IndiceIlegivel extends Error {}

/**
 * O identificador de blob que o git daria a estes bytes:
 * `sha1("blob " + tamanho + "\0" + bytes)`.
 *
 * É a condição 3 de C19-03: se o arquivo do disco não produz o blob que o
 * índice registra, ele foi mexido na VPS fora do git.
 */
export function blobDoGit(bytes: Buffer): string {
  return createHash('sha1')
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest('hex');
}

/**
 * O inteiro de largura variável do índice v4 — a mesma codificação do
 * deslocamento de `OFS_DELTA` no pacote (`gitformat-pack(5)`): sete bits por
 * byte, o bit alto diz que há mais, e cada byte a mais soma 2^7, 2^14…
 */
export function lerInteiroVariavel(buf: Buffer, inicio: number): { valor: number; fim: number } {
  let i = inicio;
  if (i >= buf.length) throw new IndiceIlegivel('inteiro variável cortado no fim do arquivo');
  let c = buf[i++];
  let valor = c & 0x7f;
  while (c & 0x80) {
    if (i >= buf.length) throw new IndiceIlegivel('inteiro variável cortado no fim do arquivo');
    valor += 1;
    c = buf[i++];
    valor = valor * 128 + (c & 0x7f);
    if (valor > Number.MAX_SAFE_INTEGER / 256) throw new IndiceIlegivel('inteiro variável grande demais');
  }
  return { valor, fim: i };
}

/** O caminho que o git aceita gravar no índice. Qualquer outro é índice estragado. */
function caminhoAceitavel(caminho: Buffer): boolean {
  if (caminho.length === 0) return false;
  if (caminho[0] === 0x2f || caminho[caminho.length - 1] === 0x2f) return false;
  for (const parte of caminho.toString('latin1').split('/')) {
    if (parte === '' || parte === '.' || parte === '..' || parte === '.git') return false;
  }
  return true;
}

/** `memcmp` dos nomes e, empatados, o estágio — a ordem em que o git grava. */
function emOrdem(anterior: EntradaDoIndice, atual: EntradaDoIndice): boolean {
  const c = Buffer.compare(anterior.caminho, atual.caminho);
  return c < 0 || (c === 0 && anterior.estagio < atual.estagio);
}

/**
 * Lê o `.git/index`. Nunca lança: o que não fecha volta como `{ ok: false }`
 * com o motivo, porque o motivo vai para o recibo da volta.
 */
export function lerIndiceDoGit(bytes: Buffer): LeituraDoIndice {
  try {
    return lerOuLancar(bytes);
  } catch (e) {
    if (e instanceof IndiceIlegivel) return { ok: false, motivo: e.message };
    return { ok: false, motivo: `índice ilegível (${(e as Error).message})` };
  }
}

function lerOuLancar(bytes: Buffer): LeituraDoIndice {
  if (bytes.length < 12 + TAMANHO_DO_HASH) throw new IndiceIlegivel('índice menor que o cabeçalho mais a soma final');
  if (bytes.toString('latin1', 0, 4) !== 'DIRC') throw new IndiceIlegivel('assinatura do índice não é DIRC');

  const versao = bytes.readUInt32BE(4);
  if (versao !== 2 && versao !== 3 && versao !== 4) {
    throw new IndiceIlegivel(`versão ${versao} do índice desconhecida (lidas: 2, 3 e 4)`);
  }

  /*
   * A SOMA PRIMEIRO, e o resto só depois. Um índice que não fecha a soma é um
   * arquivo pela metade (o git reescreve o índice por cópia e troca, mas uma
   * leitura no meio de um `pull` ou um disco cheio deixam isso acontecer) — e
   * lido entrada a entrada ele pareceria um índice menor, com notas faltando,
   * que é exatamente o estado que arquivaria a memória.
   */
  const corpo = bytes.subarray(0, bytes.length - TAMANHO_DO_HASH);
  const soma = bytes.subarray(bytes.length - TAMANHO_DO_HASH);
  const somaNula = soma.every((b) => b === 0);
  if (!somaNula) {
    const calculada = createHash('sha1').update(corpo).digest();
    if (!calculada.equals(soma)) throw new IndiceIlegivel('a soma final do índice não confere (arquivo cortado ou alterado)');
  }

  const total = bytes.readUInt32BE(8);
  const entradas: EntradaDoIndice[] = [];
  let pos = 12;
  let caminhoAnterior: Buffer = Buffer.alloc(0);

  for (let n = 0; n < total; n++) {
    const inicioDaEntrada = pos;
    if (pos + CAMPOS_FIXOS + TAMANHO_DO_HASH + 2 > corpo.length) {
      throw new IndiceIlegivel(`o índice declara ${total} entrada(s) e acaba na ${n + 1}ª`);
    }
    const modo = corpo.readUInt32BE(pos + 24);
    const blob = corpo.toString('hex', pos + CAMPOS_FIXOS, pos + CAMPOS_FIXOS + TAMANHO_DO_HASH);
    pos += CAMPOS_FIXOS + TAMANHO_DO_HASH;
    const bandeiras = corpo.readUInt16BE(pos);
    pos += 2;

    const estendida = (bandeiras & 0x4000) !== 0;
    let skipWorktree = false;
    let intentToAdd = false;
    if (estendida) {
      if (versao === 2) throw new IndiceIlegivel('entrada com bandeira estendida num índice versão 2');
      if (pos + 2 > corpo.length) throw new IndiceIlegivel('bandeira estendida cortada no fim do arquivo');
      const extra = corpo.readUInt16BE(pos);
      pos += 2;
      skipWorktree = (extra & 0x4000) !== 0;
      intentToAdd = (extra & 0x2000) !== 0;
    }
    const tamanhoDeclarado = bandeiras & 0x0fff;

    let caminho: Buffer;
    if (versao === 4) {
      const corte = lerInteiroVariavel(corpo, pos);
      pos = corte.fim;
      if (corte.valor > caminhoAnterior.length) {
        throw new IndiceIlegivel('compressão de prefixo pede para tirar mais do que o caminho anterior tem');
      }
      const nul = corpo.indexOf(0, pos);
      if (nul < 0) throw new IndiceIlegivel('caminho sem NUL no fim (índice v4)');
      caminho = Buffer.concat([caminhoAnterior.subarray(0, caminhoAnterior.length - corte.valor), corpo.subarray(pos, nul)]);
      pos = nul + 1;
    } else {
      const nul = corpo.indexOf(0, pos);
      if (nul < 0) throw new IndiceIlegivel('caminho sem NUL no fim');
      caminho = Buffer.from(corpo.subarray(pos, nul));
      // A entrada ocupa um múltiplo de oito bytes, com 1 a 8 NULs depois do nome.
      const tamanhoDaEntrada = (pos - inicioDaEntrada + caminho.length + 8) & ~7;
      const proxima = inicioDaEntrada + tamanhoDaEntrada;
      if (proxima > corpo.length) throw new IndiceIlegivel('preenchimento da entrada passa do fim do arquivo');
      for (let i = nul; i < proxima; i++) {
        if (corpo[i] !== 0) throw new IndiceIlegivel('preenchimento da entrada com byte diferente de NUL');
      }
      pos = proxima;
    }

    if (tamanhoDeclarado !== 0x0fff && tamanhoDeclarado !== caminho.length) {
      throw new IndiceIlegivel('o tamanho do caminho declarado na entrada não é o do caminho lido');
    }
    if (!caminhoAceitavel(caminho)) throw new IndiceIlegivel('caminho que o git não grava no índice');

    const entrada: EntradaDoIndice = {
      caminho,
      modo,
      blob,
      estagio: (bandeiras >> 12) & 0x3,
      skipWorktree,
      intentToAdd,
    };
    const ultima = entradas[entradas.length - 1];
    if (ultima && !emOrdem(ultima, entrada)) throw new IndiceIlegivel('entradas do índice fora de ordem');
    entradas.push(entrada);
    caminhoAnterior = caminho;
  }

  const extensoes: string[] = [];
  while (pos < corpo.length) {
    if (pos + 8 > corpo.length) throw new IndiceIlegivel('cabeçalho de extensão cortado');
    const assinatura = corpo.toString('latin1', pos, pos + 4);
    const tamanho = corpo.readUInt32BE(pos + 4);
    if (pos + 8 + tamanho > corpo.length) throw new IndiceIlegivel(`extensão "${assinatura}" passa do fim do arquivo`);
    const primeira = corpo[pos];
    if (!(primeira >= 0x41 && primeira <= 0x5a)) {
      const porque =
        assinatura === 'link'
          ? ' (índice dividido: as entradas moram em outro arquivo)'
          : assinatura === 'sdir'
            ? ' (índice esparso: uma entrada vale por um diretório inteiro)'
            : '';
      throw new IndiceIlegivel(`extensão obrigatória "${assinatura}" no índice${porque}`);
    }
    extensoes.push(assinatura);
    pos += 8 + tamanho;
  }

  return { ok: true, versao: versao as 2 | 3 | 4, entradas, extensoes, somaNula };
}

/** O tipo de objeto do `mode` de uma entrada (`TIPO_ARQUIVO`, `TIPO_LINK_SIMBOLICO`…). */
export function tipoDoModo(modo: number): number {
  return (modo >> 12) & 0xf;
}
