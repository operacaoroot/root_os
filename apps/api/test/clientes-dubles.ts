import { Readable } from 'node:stream';

import {
  MIME_DA_PASTA,
  copiarEstruturaDoModelo,
  nomeSemColisao,
  nomeValidoNoDrive,
  subirAteARaiz,
  type DriveDoCliente,
  type ItemDoDrive,
} from '../src/google/drive-do-cliente';

/*
 * OS DUBLÊS DA LANE A4 (rodada dos agentes, 21/10/2026): um Drive em memória
 * que implementa `DriveDoCliente` com as MESMAS regras puras do conector (nome
 * sem colisão, subida até a raiz, cópia do modelo), e um storage em memória.
 * Nunca fala com o Google. Cada escrita fica anotada em `escritas`, que é o que
 * os testes conferem ("nada foi enviado").
 */

export interface NoDoDrive {
  id: string;
  nome: string;
  mimeType: string;
  pais: string[];
  conteudo?: Buffer;
}

let seq = 0;
export const idDoDrive = (prefixo = 'id') => `${prefixo}${String(++seq).padStart(4, '0')}${'x'.repeat(12)}`;

export class DriveEmMemoria implements DriveDoCliente {
  readonly nos = new Map<string, NoDoDrive>();
  readonly escritas: Array<{ tipo: 'pasta' | 'copia' | 'envio'; id: string; pai: string; nome: string }> = [];

  pasta(nome: string, pai: string | null, id = idDoDrive('p')): string {
    this.nos.set(id, { id, nome, mimeType: MIME_DA_PASTA, pais: pai ? [pai] : [] });
    return id;
  }
  arquivo(nome: string, pai: string, conteudo = Buffer.from('x'), id = idDoDrive('a')): string {
    this.nos.set(id, { id, nome, mimeType: nome.endsWith('.md') ? 'text/markdown' : 'application/octet-stream', pais: [pai], conteudo });
    return id;
  }
  filhos(pai: string): NoDoDrive[] {
    return [...this.nos.values()].filter((n) => n.pais.includes(pai));
  }

  private item(n: NoDoDrive): ItemDoDrive {
    return { id: n.id, nome: n.nome, mimeType: n.mimeType, url: `drive://${n.id}`, pais: [...n.pais] };
  }

  async itemDoDrive(_org: string, id: string): Promise<ItemDoDrive | null> {
    const n = this.nos.get(id);
    return n ? this.item(n) : null;
  }
  async pastaReal(org: string, id: string): Promise<ItemDoDrive | null> {
    const i = await this.itemDoDrive(org, id);
    return i && i.mimeType === MIME_DA_PASTA ? i : null;
  }
  async filhosDaPasta(_org: string, pastaId: string, filtro: { nome?: string; soPastas?: boolean } = {}): Promise<ItemDoDrive[]> {
    return this.filhos(pastaId)
      .filter((n) => (!filtro.soPastas || n.mimeType === MIME_DA_PASTA) && (filtro.nome === undefined || n.nome === filtro.nome))
      .map((n) => this.item(n));
  }
  async dentroDaRaiz(org: string, id: string, raizId: string): Promise<boolean> {
    return subirAteARaiz(id, raizId, async (x) => (await this.itemDoDrive(org, x))?.pais ?? null);
  }
  async criarPasta(_org: string, paiId: string, nome: string): Promise<ItemDoDrive> {
    if (!nomeValidoNoDrive(nome)) throw new Error('nome inválido');
    if (!this.nos.has(paiId)) throw new Error('pai não existe');
    const id = this.pasta(nome, paiId);
    this.escritas.push({ tipo: 'pasta', id, pai: paiId, nome });
    return this.item(this.nos.get(id)!);
  }
  async copiarArquivo(_org: string, arquivoId: string, paiId: string, nome: string): Promise<ItemDoDrive> {
    const o = this.nos.get(arquivoId)!;
    const id = this.arquivo(nome, paiId, o.conteudo);
    this.escritas.push({ tipo: 'copia', id, pai: paiId, nome });
    return this.item(this.nos.get(id)!);
  }
  async copiarEstrutura(org: string, modeloId: string, destinoId: string) {
    return copiarEstruturaDoModelo(this, org, modeloId, destinoId);
  }
  async enviarArquivo(_org: string, e: { paiId: string; nome: string; tipoMime: string; conteudo: Buffer }): Promise<ItemDoDrive> {
    if (!this.nos.has(e.paiId)) throw new Error('pai não existe');
    const nome = nomeSemColisao(e.nome, this.filhos(e.paiId).map((n) => n.nome));
    const id = this.arquivo(nome, e.paiId, e.conteudo);
    this.escritas.push({ tipo: 'envio', id, pai: e.paiId, nome });
    return this.item(this.nos.get(id)!);
  }
}

/**
 * A raiz da Root no dublê: `10-clientes` com o `_modelo-cliente` (as nove
 * subpastas, um `.md` em 03-kickoff e uma planilha que não é copiada).
 */
export function montarRaiz(d: DriveEmMemoria): { raiz: string; modelo: string; fora: string } {
  const topo = d.pasta('Root', null);
  const raiz = d.pasta('10-clientes', topo);
  const modelo = d.pasta('_modelo-cliente', raiz);
  for (const s of ['01-comercial', '02-contrato', '03-kickoff', '04-entrega', '05-acompanhamento', '06-financeiro', '07-evidencias', '99-arquivo', '_fonte']) {
    const sub = d.pasta(s, modelo);
    if (s === '03-kickoff') d.arquivo('roteiro-do-kickoff.md', sub, Buffer.from('# Roteiro'));
  }
  d.arquivo('LEIA-ME.md', modelo, Buffer.from('# Pasta do cliente'));
  d.arquivo('planilha.xlsx', modelo);
  const fora = d.pasta('Pessoal', topo);
  return { raiz, modelo, fora };
}

export class StorageEmMemoria {
  readonly objetos = new Map<string, { corpo: Buffer; tipo: string }>();
  async put(chave: string, corpo: Buffer, tipo: string): Promise<void> {
    this.objetos.set(chave, { corpo: Buffer.from(corpo), tipo });
  }
  async get(chave: string): Promise<{ stream: NodeJS.ReadableStream; size: number }> {
    const o = this.objetos.get(chave);
    if (!o) throw new Error('objeto não existe');
    return { stream: Readable.from([o.corpo]), size: o.corpo.length };
  }
}
