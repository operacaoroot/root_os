import { readdirSync, readFileSync, statSync } from 'node:fs';
import type { ArquivoNoDisco } from './pertenca-da-vault';

/*
 * O PASSEIO DA VAULT, EM BYTES (R-1 da ROOT-19-REV).
 *
 * O índice do git guarda o caminho como bytes, e a pertença compara bytes com
 * bytes: um nome em NFD no disco é outro nome que o mesmo em NFC, e a leitura
 * do arquivo tem de abrir exatamente o que está no disco. O NFC só aparece
 * depois, para montar a chave e o rótulo (`pertenca-da-vault.ts`).
 *
 * Entradas que começam com ponto continuam de fora (`.obsidian`, `.trash`,
 * `.git`), menos o `.gitattributes`, que é lido — e não indexado — porque é
 * ele que diz se o git converte o conteúdo entre o blob e o disco (C19-03).
 *
 * Mora fora do serviço para que a suíte passeie a vault de teste com a MESMA
 * função que o conector usa.
 */

export interface DescobertaNaPasta {
  /** Os `.md`, lidos. */
  arquivos: ArquivoNoDisco[];
  /** Os `.md` que o passeio achou e o disco não deixou ler (permissão, sumiu no meio). */
  ilegiveis: Array<{ caminho: Buffer; motivo: string }>;
  /** Os `.gitattributes` achados no caminho, com o texto. Ilegível conta como conversão. */
  atributos: Array<{ caminho: string; texto: string }>;
  /** Quantos `.md` o passeio achou (lidos ou não). */
  mdNoDisco: number;
}

/** O caminho absoluto de um relativo em bytes. */
export function noDisco(raiz: string, rel: Buffer): Buffer {
  return Buffer.concat([Buffer.from(raiz), Buffer.from('/'), rel]);
}

export function descobrirNaPasta(raiz: string): DescobertaNaPasta {
  const base = Buffer.from(raiz);
  const barra = Buffer.from('/');
  const mds: Buffer[] = [];
  const atributos: Buffer[] = [];
  const descer = (rel: Buffer) => {
    const dir = rel.length ? Buffer.concat([base, barra, rel]) : base;
    for (const entry of readdirSync(dir, { withFileTypes: true, encoding: 'buffer' })) {
      const nome = entry.name;
      const caminho = rel.length ? Buffer.concat([rel, barra, nome]) : Buffer.from(nome);
      if (nome[0] === 0x2e) {
        if (entry.isFile() && nome.toString('latin1') === '.gitattributes') atributos.push(caminho);
        continue;
      }
      if (entry.isDirectory()) descer(caminho);
      else if (entry.isFile() && nome.toString('latin1').toLowerCase().endsWith('.md')) mds.push(caminho);
    }
  };
  descer(Buffer.alloc(0));

  const saida: DescobertaNaPasta = { arquivos: [], ilegiveis: [], atributos: [], mdNoDisco: mds.length };
  for (const caminho of mds) {
    try {
      const full = noDisco(raiz, caminho);
      saida.arquivos.push({ caminho, bytes: readFileSync(full), modificadoEm: statSync(full).mtime });
    } catch (e) {
      saida.ilegiveis.push({ caminho, motivo: (e as Error).message });
    }
  }
  for (const a of atributos) {
    try {
      saida.atributos.push({ caminho: a.toString('utf8'), texto: readFileSync(noDisco(raiz, a), 'utf8') });
    } catch {
      // Não dá para saber o que ele liga; a falha fechada é contar como conversão.
      saida.atributos.push({ caminho: a.toString('utf8'), texto: '* filter=ilegivel' });
    }
  }
  return saida;
}
