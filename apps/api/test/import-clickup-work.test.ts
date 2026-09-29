import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { SnapshotSchema, canonical, idNativo, raizPermitidaDoAnexo, validarSnapshot } from '../prisma/import-clickup-work.contract';
import { inventariar } from '../prisma/import-clickup-work.plan';
import { classificarRollback, fingerprintImportado, planejar, reverterLote, verificarArquivos } from '../prisma/import-clickup-work';

const ORG = '11111111-1111-4111-8111-111111111111';
const LISTAS = ['901328341442', '901328341443', '901328341445', '901328341450',
  '901328341456', '901328341455', '901328341451'];
function fixture() {
  return SnapshotSchema.parse({
    schemaVersion: 1, source: 'clickup', capturedAt: '2026-09-29T04:00:00.000Z', spaceId: '901313864063',
    scope: { folderPath: ['Demandas internas', 'Marketing'], listIds: LISTAS },
    completeness: { allLists: true, allTasks: true, includeClosed: true, paginationComplete: true }, extractionGaps: [], unknownSourceFields: [],
    folders: [
      { id: 'demandas', name: 'Demandas internas', parentId: null },
      { id: 'marketing', name: 'Marketing', parentId: 'demandas' },
    ],
    lists: LISTAS.map((id, order) => ({
      id, name: order === 0 ? 'Gestão de Temas' : `Lista ${order}`, folderId: 'marketing', order,
      statuses: [
        { id: `${id}-todo`, name: 'to do', type: 'open', color: '#87909e', order: 0 },
        { id: `${id}-done`, name: 'complete', type: 'closed', color: '#00aa00', order: 1 },
      ],
      fields: [{ id: `${id}-data`, name: 'Data de Publicação', type: 'data', order: 0, options: [] }],
    })),
    tasks: [
      {
        id: 'root-001', listId: LISTAS[0], statusId: `${LISTAS[0]}-todo`, title: 'ROOT-001',
        description: 'Pacote v1 aprovado', priority: 'alta', assignees: [{ id: 'p1', name: 'Pedro' }],
        startDate: null, dueDate: null, createdAt: '2026-09-20T12:00:00.000Z', updatedAt: null,
        parentId: null, archived: false, order: 0, url: 'https://app.clickup.com/t/root-001',
        tags: [{ id: 'tag-roteiro', name: 'Roteiro', color: '#ffcc00' }],
        fieldValues: [{ fieldId: `${LISTAS[0]}-data`, value: '2026-10-01' }],
        comments: [{ id: 'c1', authorId: 'p1', authorName: 'Pedro', text: 'Manter pacote v1', createdAt: '2026-09-28T10:00:00.000Z' }],
        attachments: [{ id: 'a1', name: 'pacote.pdf', url: '/api/trabalho/arquivos/root-001/a1', sha256: 'a'.repeat(64), localPath: '/vault/90-OS/migrations/marketing-20260929/files/root-001/a1' }],
        checklists: [{ id: 'ch1', name: 'Passagem', items: [{ id: 'i1', name: 'Conferir', resolved: true }] }],
        dependencies: [{ taskId: 'root-001-sub', type: 'depende de' }], raw: { source: 'full' },
      },
      {
        id: 'root-001-sub', listId: LISTAS[0], statusId: `${LISTAS[0]}-done`, title: 'Revisão',
        description: null, priority: null, assignees: [], startDate: null, dueDate: null, createdAt: null, updatedAt: null,
        parentId: 'root-001', archived: false, order: 1, url: null,
        tags: [], fieldValues: [], comments: [], attachments: [], checklists: [], dependencies: [],
      },
    ],
  });
}
function fakeDb(rows: Map<string, Record<string, unknown>>) {
  const model = {
    findUnique: async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null,
    findFirst: async () => null,
    findMany: async () => [],
    create: () => { throw new Error('dry-run escreveu no banco'); },
  };
  return Object.fromEntries(['workFolder', 'workList', 'workStatus', 'workField', 'workFieldOption',
    'workTag', 'workTask', 'workFieldValue', 'workComment'].map((name) => [name, model])) as unknown as PrismaClient;
}

describe('importação segura ClickUp → Work', () => {
  it('resolve a raiz do refresh para conferir bytes no dry-run, sem aceitar prefixos semelhantes', () => {
    const path = '/private/tmp/root-os-migration-20260929-refresh/files/root-001/a1';
    expect(raizPermitidaDoAnexo(path)).toBe('/private/tmp/root-os-migration-20260929-refresh/files/');
    expect(raizPermitidaDoAnexo('/private/tmp/root-os-migration-20260929-refresh/files-outside/a1')).toBeUndefined();
    const s = fixture();
    s.tasks[0].attachments[0].localPath = path;
    expect(validarSnapshot(s).erros).toEqual([]);
  });
  it('confere bytes, tamanho, arquivo regular e limite do vault antes do apply', async () => {
    const raiz = mkdtempSync(join(tmpdir(), 'clickup-work-attachments-'));
    const fora = mkdtempSync(join(tmpdir(), 'clickup-work-outside-'));
    try {
      const path = join(raiz, 'pacote.pdf');
      const bytes = Buffer.from('pacote preservado');
      writeFileSync(path, bytes);
      const t = fixture().tasks[0];
      const a = t.attachments[0];
      a.localPath = path;
      a.sha256 = createHash('sha256').update(bytes).digest('hex');
      a.size = bytes.length;
      expect(await verificarArquivos([t], raiz)).toEqual([]);
      writeFileSync(path, Buffer.alloc(bytes.length, 42));
      expect((await verificarArquivos([t], raiz)).join(' ')).toContain('SHA-256');
      a.size = 1;
      expect((await verificarArquivos([t], raiz)).join(' ')).toContain('tamanho');
      const link = join(raiz, 'atalho.pdf');
      symlinkSync(path, link);
      a.localPath = link;
      expect((await verificarArquivos([t], raiz)).join(' ')).toContain('arquivo regular');
      a.localPath = join(fora, 'fora.pdf');
      writeFileSync(a.localPath, bytes);
      a.size = bytes.length;
      expect((await verificarArquivos([t], raiz)).join(' ')).toContain('fora do vault permitido');
    } finally {
      rmSync(raiz, { recursive: true, force: true });
      rmSync(fora, { recursive: true, force: true });
    }
  });
  it('CLI offline é dry-run real sem conexão, arquivo de manifesto ou escrita no banco', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clickup-work-offline-'));
    try {
      const caminho = join(dir, 'snapshot.json');
      writeFileSync(caminho, JSON.stringify(fixture()));
      const processo = spawnSync(process.execPath, [
        '--import', 'tsx', 'prisma/import-clickup-work.ts', '--snapshot', caminho, '--offline',
      ], { cwd: resolve('.'), env: { ...process.env, DATABASE_URL: '' }, encoding: 'utf8' });
      if (processo.error || !processo.stdout) throw new Error(`CLI sem saída: ${processo.error?.message ?? processo.stderr}`);
      const relatorio = JSON.parse(processo.stdout);
      expect(processo.status).toBe(0);
      expect(relatorio).toMatchObject({ mode: 'offline-dry-run', counts: { lists: 7, tasks: 2 }, errors: [] });
      expect(readdirSync(dir)).toEqual(['snapshot.json']);
      expect(JSON.parse(readFileSync(caminho, 'utf8')).source).toBe('clickup');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('amarra os sete IDs da origem ao caminho e recusa Lucas Creator, órfãos e cobertura incompleta', () => {
    const s = fixture();
    expect(validarSnapshot(s).erros).toEqual([]);
    const lucas = structuredClone(s);
    lucas.scope.listIds[0] = '901327640001';
    lucas.lists[0].id = '901327640001';
    expect(validarSnapshot(lucas).erros.join(' ')).toContain('Lucas Creator');
    const outraRaiz = structuredClone(s);
    outraRaiz.scope.listIds[1] = '901329999999';
    outraRaiz.lists[1].id = '901329999999';
    expect(validarSnapshot(outraRaiz).erros.join(' ')).toContain('allowlist fixa');
    const incompleto = structuredClone(s);
    incompleto.completeness.paginationComplete = false;
    incompleto.extractionGaps.push('comentários da lista 2 sem página final');
    expect(validarSnapshot(incompleto).erros).toEqual(expect.arrayContaining([
      'cobertura incompleta: paginationComplete=false',
      'lacuna de extração: comentários da lista 2 sem página final',
    ]));
  });

  it('preserva identidade, status por lista, subtarefa, comentário e link estável sem recriar pacote', () => {
    const s = fixture();
    const v = validarSnapshot(s);
    const { specs, avisos } = inventariar(s, ORG, v.caminhos);
    const parent = specs.find((x) => x.chave === 'task:root-001')!;
    const child = specs.find((x) => x.chave === 'task:root-001-sub')!;
    const comment = specs.find((x) => x.chave === 'comment:root-001:c1')!;
    expect(parent.id).toBe(idNativo(ORG, s.spaceId, 'task', 'root-001'));
    expect(parent.conferir.statusId).toBe(idNativo(ORG, s.spaceId, 'status', `${LISTAS[0]}:${LISTAS[0]}-todo`));
    expect(parent.conferir.description).toContain('Pacote v1 aprovado');
    expect(parent.conferir.description).toContain('/api/trabalho/arquivos/root-001/a1');
    expect(parent.conferir.description).toContain(`/trabalho?lista=${LISTAS[0]}&tarefa=${child.id}`);
    expect(child.conferir.parentId).toBe(parent.id);
    expect(comment.conferir).toMatchObject({ authorId: null, authorName: 'Pedro', text: 'Manter pacote v1', createdAt: '2026-09-28T10:00:00.000Z' });
    expect(avisos).toEqual([]);
    expect(v.avisos.join(' ')).toContain('somente no snapshot');
    expect(canonical({ dia: new Date('2026-09-29T04:00:00Z') })).toContain('2026-09-29T04:00:00.000Z');
  });

  it('dry-run não escreve; repetição é no-op; edição nativa ou mudança da origem vira conflito', async () => {
    const s = fixture();
    const specs = inventariar(s, ORG, validarSnapshot(s).caminhos).specs;
    const rows = new Map<string, Record<string, unknown>>();
    const db = fakeDb(rows);
    const first = await planejar(db, specs);
    expect(first.every((x) => x.estado === 'criar')).toBe(true);
    for (const spec of specs) {
      rows.set(spec.id, { id: spec.id, ...spec.conferir,
        ...(spec.tipo === 'task' ? { tags: (spec.conferir.tagIds as string[]).map((id) => ({ id })) } : {}) });
    }
    const records = Object.fromEntries(specs.map((sp) => [sp.chave, { id: sp.id, origemHash: sp.origemHash }]));
    const second = await planejar(db, specs, records);
    expect(second.every((x) => x.estado === 'igual')).toBe(true);
    const task = specs.find((x) => x.chave === 'task:root-001')!;
    rows.get(task.id)!.title = 'Edição nativa posterior';
    const edited = await planejar(db, [task], records);
    expect(edited[0].estado).toBe('conflito');
    rows.get(task.id)!.title = task.conferir.title;
    const sourceChanged = await planejar(db, [{ ...task, origemHash: 'outra-fonte' }], records);
    expect(sourceChanged[0].estado).toBe('conflito');
  });

  it('recusa lista duplicada pelo ID externo mesmo quando a linha determinística já existe', async () => {
    const s = fixture();
    const spec = inventariar(s, ORG, validarSnapshot(s).caminhos).specs.find((x) => x.chave === `list:${LISTAS[0]}`)!;
    const db = fakeDb(new Map([[spec.id, { id: spec.id, ...spec.conferir }]]));
    (db.workList as unknown as { findMany: () => Promise<Array<{ id: string }>> }).findMany = async () => [
      { id: spec.id }, { id: 'lista-nativa-duplicada' },
    ];
    const actions = await planejar(db, [spec]);
    expect(actions[0]).toMatchObject({ estado: 'conflito', motivo: 'identidade nativa existente lista-nativa-duplicada' });
  });

  it('rollback rechecado dentro da transação recusa comentário surgido após a prévia', async () => {
    const s = fixture();
    const specs = inventariar(s, ORG, validarSnapshot(s).caminhos).specs;
    const task = specs.find((x) => x.chave === 'task:root-001')!;
    const taskRows = [{ id: task.id, comments: [] as Array<{ id: string }> }];
    let deletes = 0;
    let locked = false;
    const empty = { findMany: async () => [], deleteMany: async () => { deletes++; } };
    const tx = {
      ...Object.fromEntries(['workFolder', 'workList', 'workStatus', 'workField', 'workFieldOption',
        'workTag', 'workFieldValue', 'workComment', 'auditLog'].map((name) => [name, empty])),
      workTask: { ...empty, findMany: async () => taskRows },
      $executeRawUnsafe: async () => { locked = true; return 0; },
    } as unknown as PrismaClient;
    const before = await fingerprintImportado(tx, specs);
    const db = { $transaction: async (fn: (client: PrismaClient) => Promise<void>) => {
      taskRows[0].comments.push({ id: 'comentario-nativo-posterior' });
      return fn(tx);
    } } as unknown as PrismaClient;
    await expect(reverterLote(db, specs, { task: [task.id] }, before)).rejects.toThrow('Rollback recusado');
    expect(locked).toBe(true);
    expect(deletes).toBe(0);
  });

  it('reconhece rollback já commitado para reconciliar manifesto sem segunda exclusão', () => {
    const run = { preFingerprint: 'antes', postFingerprint: 'depois' };
    expect(classificarRollback('depois', run)).toBe('pronto');
    expect(classificarRollback('antes', run)).toBe('ja-revertido');
    expect(classificarRollback('edição-nativa', run)).toBe('divergente');
  });
});
