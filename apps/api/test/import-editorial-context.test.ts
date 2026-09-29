import { describe, expect, it } from 'vitest';
import { ContextKind, ContextSource } from '@prisma/client';
import { aplicarImportacao, planejarImportacao } from '../prisma/import-editorial-context';
import { CAMINHO_DA_MARCA, CHAVE_DA_MARCA_NA_VAULT, prepararPlano } from '../prisma/import-editorial-context.plan';
import type { NotaDeContexto, VersaoDeNota } from '../src/memory/memoria.service';

const ORG = '11111111-1111-4111-8111-111111111111';
const ids = ['8ckpuuy-30113', '8ckpuuy-30133', '8ckpuuy-30153',
  '8ckpuuy-30173', '8ckpuuy-30193', '8ckpuuy-30213', '8ckpuuy-30233'];
function docs() {
  return JSON.stringify({
    source: { provider: 'ClickUp', workspace_id: '9013259102', document_id: '8ckpuuy-36293',
      exported_at: '2026-09-29T10:59:32Z', content_format: 'text/md' },
    pages: ids.map((id, i) => ({ id, doc_id: '8ckpuuy-36293', workspace_id: 9013259102,
      name: `Página ${i + 1}`, content: `# Página ${i + 1}\nCorpo original.`,
      date_edited: 1790678284724, archived: false, deleted: false })),
  });
}
function marca() {
  return '---\ntipo: documento-mestre-de-marca\nversao: "2.0"\ntags: [root, marca]\n---\n\n# Guia ROOT\n\nTexto de referência.\n';
}
function nota(base: Partial<NotaDeContexto>): NotaDeContexto {
  return {
    id: 'id', chave: 'chave', kind: ContextKind.nota, title: 'Título', body: 'corpo', tags: [],
    sourceType: ContextSource.conector, sourceRef: 'ref', procedencia: 'conector:ref',
    validFrom: null, validUntil: null, supersedesId: null, confidence: 1,
    contentHash: 'hash', versao: 1, temVetor: false, arquivadoEm: null,
    criadoEm: '2026-09-29T00:00:00Z', atualizadoEm: '2026-09-29T00:00:00Z', ...base,
  };
}
function historico(comElo = true, contentHash = 'hash'): VersaoDeNota[] {
  return [{ versao: 1, eventoId: comElo ? 'evento' : null, eventoSeq: comElo ? '1' : null,
    semEventoPorque: comElo ? null : 'falha_ao_registrar', contentHash } as VersaoDeNota];
}
function memoriaFalsa(comElo = true) {
  const itens = new Map<string, NotaDeContexto>();
  const chamadas: string[] = [];
  return {
    itens, chamadas,
    porChave: async (_org: string, chave: string) => itens.get(chave) ?? null,
    historico: async (_org: string, id: string) => historico(comElo,
      [...itens.values()].find((item) => item.id === id)?.contentHash),
    criar: async (_org: string, entrada: { chave: string; title: string; body: string; tags?: string[];
      kind?: ContextKind; sourceType: ContextSource; sourceRef?: string | null }) => {
      chamadas.push(entrada.chave);
      const item = nota({ id: String(chamadas.length), chave: entrada.chave, title: entrada.title,
        body: entrada.body, tags: entrada.tags ?? [], kind: entrada.kind ?? ContextKind.nota,
        sourceType: entrada.sourceType, sourceRef: entrada.sourceRef ?? null,
        contentHash: plano.entradas.find((e) => e.chave === entrada.chave)!.contentHash });
      itens.set(item.chave, item);
      return item;
    },
  };
}
const plano = prepararPlano({ only: 'ambos', docsRaw: docs(), marcaRaw: marca() });

describe('importação seletiva do contexto editorial', () => {
  it('mantém os 7 corpos ClickUp e o guia, com chaves e hashes estáveis', () => {
    expect(plano.entradas).toHaveLength(8);
    expect(plano.entradas[0].body).toBe('# Página 1\nCorpo original.');
    expect(plano.entradas[0].sourceRef).toContain('8ckpuuy-30113@');
    expect(plano.entradas[7].body).toBe('# Guia ROOT\n\nTexto de referência.');
    expect(plano.entradas[7].sourceRef).toContain('@v2.0#sha256:');
    expect(plano.arquivos.clickupSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(plano.arquivos.marcaSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('recusa páginas fora do documento, repetidas, arquivadas ou sem corpo', () => {
    for (const alterar of [
      (p: any[]) => { p[0].doc_id = 'outro'; },
      (p: any[]) => { p[0].id = p[1].id; },
      (p: any[]) => { p[0].archived = true; },
      (p: any[]) => { p[0].content = ''; },
    ]) {
      const fonte = JSON.parse(docs());
      alterar(fonte.pages);
      expect(() => prepararPlano({ only: 'clickup', docsRaw: JSON.stringify(fonte) })).toThrow();
    }
  });

  it('reusa a cópia canônica da vault quando o corpo é idêntico', async () => {
    const memoria = memoriaFalsa();
    const entrada = plano.entradas[7];
    memoria.itens.set(CHAVE_DA_MARCA_NA_VAULT, nota({ id: 'vault-id', chave: CHAVE_DA_MARCA_NA_VAULT,
      title: entrada.title, body: entrada.body, contentHash: entrada.contentHash,
      sourceType: ContextSource.vault, sourceRef: CAMINHO_DA_MARCA }));
    const linhas = await planejarImportacao(memoria, ORG, plano);
    expect(linhas[7]).toMatchObject({ acao: 'reusar-vault', itemId: 'vault-id' });
    await aplicarImportacao(memoria, ORG, plano);
    expect(memoria.chamadas).toHaveLength(7);
    expect(memoria.itens.has(entrada.chave)).toBe(false);
  });

  it('aceita a marca da vault cuja primeira versão declara migração do acervo', async () => {
    const memoria = memoriaFalsa();
    const entrada = plano.entradas[7];
    memoria.itens.set(CHAVE_DA_MARCA_NA_VAULT, nota({ id: 'vault-id', chave: CHAVE_DA_MARCA_NA_VAULT,
      title: entrada.title, body: entrada.body, contentHash: entrada.contentHash,
      sourceType: ContextSource.vault, sourceRef: CAMINHO_DA_MARCA }));
    memoria.historico = async () => [{ versao: 1, eventoId: null, eventoSeq: null,
      semEventoPorque: 'migracao' } as VersaoDeNota];
    expect((await planejarImportacao(memoria, ORG, plano))[7].acao).toBe('reusar-vault');
  });

  it('bloqueia o guia quando a cópia canônica da vault diverge', async () => {
    const memoria = memoriaFalsa();
    const entrada = plano.entradas[7];
    memoria.itens.set(CHAVE_DA_MARCA_NA_VAULT, nota({ id: 'vault-id', chave: CHAVE_DA_MARCA_NA_VAULT,
      title: entrada.title, body: 'outra edição', contentHash: 'outro',
      sourceType: ContextSource.vault, sourceRef: CAMINHO_DA_MARCA }));
    expect((await planejarImportacao(memoria, ORG, plano))[7].acao).toBe('conflito');
    await expect(aplicarImportacao(memoria, ORG, plano)).rejects.toThrow('Nenhuma nova nota');
    expect(memoria.chamadas).toHaveLength(0);
  });

  it('dry-run não escreve; apply cria uma vez e a segunda execução é idempotente', async () => {
    const memoria = memoriaFalsa();
    expect((await planejarImportacao(memoria, ORG, plano)).map((x) => x.acao)).toEqual(Array(8).fill('criar'));
    expect(memoria.chamadas).toHaveLength(0);
    expect((await aplicarImportacao(memoria, ORG, plano)).map((x) => x.acao)).toEqual(Array(8).fill('criado'));
    expect(memoria.chamadas).toHaveLength(8);
    expect((await aplicarImportacao(memoria, ORG, plano)).map((x) => x.acao)).toEqual(Array(8).fill('igual'));
    expect(memoria.chamadas).toHaveLength(8);
  });

  it('bloqueia reexecução após edição nativa de uma nota importada', async () => {
    const memoria = memoriaFalsa();
    await aplicarImportacao(memoria, ORG, plano);
    const chave = plano.entradas[0].chave;
    memoria.itens.set(chave, nota({ ...memoria.itens.get(chave), body: 'editado no OS', contentHash: 'novo-hash' }));
    expect((await planejarImportacao(memoria, ORG, plano))[0].acao).toBe('conflito');
    await expect(aplicarImportacao(memoria, ORG, plano)).rejects.toThrow('Nenhuma nova nota');
    expect(memoria.chamadas).toHaveLength(8);
  });

  it('conflito em uma nota bloqueia o lote antes da primeira escrita', async () => {
    const memoria = memoriaFalsa();
    const entrada = plano.entradas[5];
    memoria.itens.set(entrada.chave, nota({ chave: entrada.chave, body: 'edição local' }));
    await expect(aplicarImportacao(memoria, ORG, plano)).rejects.toThrow('Nenhuma nova nota');
    expect(memoria.chamadas).toHaveLength(0);
  });

  it('evento ausente fica visível e impede nova execução', async () => {
    const memoria = memoriaFalsa(false);
    const primeiro = plano.entradas[0];
    await expect(aplicarImportacao(memoria, ORG, plano)).rejects.toThrow('foi criada, mas o evento');
    expect(memoria.chamadas).toEqual([primeiro.chave]);
    expect((await planejarImportacao(memoria, ORG, plano))[0].acao).toBe('evento-pendente');
    await expect(aplicarImportacao(memoria, ORG, plano)).rejects.toThrow('Nenhuma nova nota');
    expect(memoria.chamadas).toHaveLength(1);
  });
});
