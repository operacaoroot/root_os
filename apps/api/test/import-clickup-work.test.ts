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

/*
 * MOEDA E ETAPA `done` (ROOT-06a). A allowlist do contrato ainda é só a do
 * Marketing, então a estrutura de Gestão de Leads (9 etapas, duas `done`, e o
 * campo `currency` em BRL) entra na segunda lista da fixture, com os IDs da
 * allowlist; a generalização do lote fica para a L6.
 */
const LEADS = LISTAS[1];
const CAMPO_VALOR = 'campo-valor-em-negociacao';
const ETAPAS_DE_LEADS = [
  ['st-oportunidade', 'oportunidade', 'open', '#87909e'],
  ['st-qualificacao', 'em qualificação', 'custom', '#1090e0'],
  ['st-marcar', 'marcar reunião', 'custom', '#b660e0'],
  ['st-agendada', 'reunião agendada', 'custom', '#f8ae00'],
  ['st-orcamento', 'enviar orçamento', 'custom', '#e16b16'],
  ['st-followup', 'followup', 'custom', '#5f55ee'],
  ['st-geladeira', 'geladeira', 'done', '#6f7d8c'],
  ['st-perdido', 'perdido', 'done', '#d33d44'],
  ['st-fechado', 'fechado', 'closed', '#008844'],
] as const;
type ValorDaOrigem = { fieldId: string; optionId?: string | null; value?: string | number | boolean | null };
function lead(id: string, statusId: string, fieldValues: ValorDaOrigem[], order: number) {
  return {
    id, listId: LEADS, statusId, title: `Lead ${id}`, description: null, priority: null, assignees: [],
    startDate: null, dueDate: null, createdAt: null, updatedAt: null, parentId: null, archived: false, order,
    url: null, tags: [], fieldValues, comments: [], attachments: [], checklists: [], dependencies: [],
  };
}
function fixtureComercial(valores: Record<string, ValorDaOrigem['value']> = {
  'lead-1': '1500', 'lead-2': 1500.5, 'lead-3': '1500.50', 'lead-4': '0',
}) {
  const base = fixture() as Record<string, unknown> & { lists: Array<Record<string, unknown>>; tasks: unknown[] };
  base.lists[1] = {
    ...base.lists[1], name: 'Gestão de Leads (estrutura)',
    statuses: ETAPAS_DE_LEADS.map(([id, name, type, color], order) => ({ id, name, type, color, order })),
    fields: [
      ...(base.lists[1].fields as unknown[]),
      { id: CAMPO_VALOR, name: 'Valor em negocição', type: 'moeda', moeda: 'BRL', casas: 2, order: 1, options: [] },
    ],
  };
  const etapas = ['st-fechado', 'st-perdido', 'st-geladeira', 'st-oportunidade'];
  Object.entries(valores).forEach(([id, value], i) => {
    base.tasks.push(lead(id, etapas[i % etapas.length], [{ fieldId: CAMPO_VALOR, value }], i));
  });
  base.tasks.push(lead('lead-sem-valor', 'st-oportunidade', [], 99));
  return SnapshotSchema.parse(base);
}
const specDe = (s: ReturnType<typeof fixture>, chave: string) =>
  inventariar(s, ORG, validarSnapshot(s).caminhos).specs.find((x) => x.chave === chave)!;

// sha256 de `canonical(specs)` da fixture do Marketing, medido na base f58de1e
// (os arquivos do importador são os mesmos de 1194a49) antes desta fatia.
const SPECS_DO_MARKETING_NA_BASE = '55e5d21923f790efc20ce1af14d1410b6cac1dc8133bfb62ee295d44c3294add';

describe('importação ClickUp → Work: moeda e etapa done (ROOT-06a)', () => {
  it('etapa done passa, avisa e vira closed com nome, cor e ordem da origem', () => {
    const s = fixtureComercial();
    const v = validarSnapshot(s);
    expect(v.erros).toEqual([]);
    expect(v.avisos).toEqual(expect.arrayContaining([
      `lista ${LEADS}: etapa st-geladeira (geladeira) é done na origem e será gravada como closed; 1 tarefa(s) nela`,
      `lista ${LEADS}: etapa st-perdido (perdido) é done na origem e será gravada como closed; 1 tarefa(s) nela`,
    ]));
    const { specs } = inventariar(s, ORG, v.caminhos);
    const etapas = specs.filter((x) => x.chave.startsWith(`status:${LEADS}:`));
    expect(etapas.map((x) => [x.conferir.name, x.conferir.type, x.conferir.color, x.conferir.order])).toEqual(
      ETAPAS_DE_LEADS.map(([, name, type, color], order) => [name, type === 'done' ? 'closed' : type, color, order]),
    );
    for (const e of etapas) expect(e.dados).toEqual(e.conferir);
  });

  it('trocar done por closed na origem muda o origemHash: a origem fica registrada', () => {
    const comDone = specDe(fixtureComercial(), `status:${LEADS}:st-geladeira`);
    const s = fixtureComercial();
    s.lists[1].statuses.find((x) => x.id === 'st-geladeira')!.type = 'closed';
    const comClosed = specDe(s, `status:${LEADS}:st-geladeira`);
    expect(comClosed.conferir).toEqual(comDone.conferir);
    expect(comClosed.origemHash).not.toBe(comDone.origemHash);
  });

  it('tipo de etapa desconhecido continua erro, inclusive nome de propriedade do Object', () => {
    for (const tipo of ['archived', 'toString', 'constructor']) {
      const s = fixtureComercial();
      s.lists[1].statuses[0].type = tipo;
      expect(validarSnapshot(s).erros).toContain(`status ${LEADS}/st-oportunidade: tipo ${tipo} sem mapeamento nativo`);
    }
  });

  it('conta por lista as tarefas em etapa done', () => {
    const s = fixtureComercial({ a: '1', b: '2', c: '3', d: '4', e: '5', f: '6' });
    // 'b' e 'f' caem em perdido; 'c' em geladeira.
    expect(validarSnapshot(s).avisos.filter((a) => a.includes('é done na origem'))).toEqual([
      `lista ${LEADS}: etapa st-geladeira (geladeira) é done na origem e será gravada como closed; 1 tarefa(s) nela`,
      `lista ${LEADS}: etapa st-perdido (perdido) é done na origem e será gravada como closed; 2 tarefa(s) nela`,
    ]);
  });

  it('campo moeda grava type moeda; 1500.5 e "1500.50" dão o mesmo valor com origemHash diferentes', () => {
    const s = fixtureComercial();
    const { specs } = inventariar(s, ORG, validarSnapshot(s).caminhos);
    expect(specs.find((x) => x.chave === `field:${LEADS}:${CAMPO_VALOR}`)!.conferir).toMatchObject({ type: 'moeda', name: 'Valor em negocição' });
    const valor = (taskId: string) => specs.find((x) => x.chave === `value:${taskId}:${CAMPO_VALOR}`)!;
    expect(valor('lead-1').conferir).toMatchObject({ optionId: null, value: 'BRL 1500.00' });
    expect(valor('lead-2').conferir.value).toBe('BRL 1500.50');
    expect(valor('lead-3').conferir.value).toBe('BRL 1500.50');
    expect(valor('lead-4').conferir.value).toBe('BRL 0.00');
    expect(valor('lead-2').origemHash).not.toBe(valor('lead-3').origemHash);
    for (const id of ['lead-1', 'lead-2', 'lead-3', 'lead-4']) expect(valor(id).dados).toEqual(valor(id).conferir);
    expect(specs.some((x) => x.chave === `value:lead-sem-valor:${CAMPO_VALOR}`)).toBe(false);
  });

  it('campo moeda sem moeda ou casas, com opções, ou valor com optionId é erro com os IDs', () => {
    const campo = (s: ReturnType<typeof fixture>) => s.lists[1].fields.find((f) => f.id === CAMPO_VALOR)!;
    const semMoeda = fixtureComercial();
    delete campo(semMoeda).moeda;
    expect(validarSnapshot(semMoeda).erros).toContain(`campo ${LEADS}/${CAMPO_VALOR}: tipo moeda exige moeda e casas`);
    const semCasas = fixtureComercial();
    delete campo(semCasas).casas;
    expect(validarSnapshot(semCasas).erros).toContain(`campo ${LEADS}/${CAMPO_VALOR}: tipo moeda exige moeda e casas`);
    const tresCasas = fixtureComercial();
    campo(tresCasas).casas = 3;
    expect(validarSnapshot(tresCasas).erros).toContain(`campo ${LEADS}/${CAMPO_VALOR}: precisão 3 não suportada (o valor guarda até 2 casas)`);
    const comOpcao = fixtureComercial();
    campo(comOpcao).options = [{ id: 'op-1', name: 'Alto', color: '#fff', order: 0 }];
    expect(validarSnapshot(comOpcao).erros).toContain(`campo ${LEADS}/${CAMPO_VALOR}: tipo moeda não tem opções`);
    const valorComOpcao = fixtureComercial();
    valorComOpcao.tasks.find((t) => t.id === 'lead-1')!.fieldValues[0].optionId = 'op-1';
    expect(validarSnapshot(valorComOpcao).erros).toContain(`valor do campo ${CAMPO_VALOR} da tarefa lead-1: tipo moeda não aceita optionId`);
    const dolar = fixtureComercial();
    campo(dolar).moeda = 'USD';
    expect(validarSnapshot(dolar).avisos).toContain(`campo ${LEADS}/${CAMPO_VALOR}: moeda USD; sem valor gravado, a tela propõe BRL para valor novo`);
    expect(specDe(dolar, `value:lead-1:${CAMPO_VALOR}`).conferir.value).toBe('USD 1500.00');
  });

  it('valor fora do formato recusa o snapshot, e o erro não traz o valor', () => {
    const ruins = { 'lead-1': '1500.555', 'lead-2': '1e3', 'lead-3': '1.500,00', 'lead-4': '1000000000000', 'lead-5': null };
    const s = fixtureComercial(ruins);
    const { erros } = validarSnapshot(s);
    expect(erros).toEqual([
      `valor do campo ${CAMPO_VALOR} da tarefa lead-1: mais casas que a precisão 2`,
      `valor do campo ${CAMPO_VALOR} da tarefa lead-2: fora do formato decimal (sem expoente, vírgula, espaço, símbolo ou zero à esquerda)`,
      `valor do campo ${CAMPO_VALOR} da tarefa lead-3: fora do formato decimal (sem expoente, vírgula, espaço, símbolo ou zero à esquerda)`,
      `valor do campo ${CAMPO_VALOR} da tarefa lead-4: mais de 12 dígitos inteiros (teto de Decimal(14,2))`,
      `valor do campo ${CAMPO_VALOR} da tarefa lead-5: tipo de valor inválido`,
    ]);
    for (const bruto of ['1500.555', '1e3', '1.500,00', '1000000000000']) expect(erros.join('\n')).not.toContain(bruto);
    expect(() => inventariar(s, ORG, validarSnapshot(s).caminhos)).toThrow(`valor do campo ${CAMPO_VALOR} da tarefa lead-1: mais casas que a precisão 2`);
  });

  it('regressão do Marketing: sem moeda e sem done, os specs são os mesmos da base', () => {
    const s = fixture();
    const v = validarSnapshot(s);
    expect(v.erros).toEqual([]);
    expect(v.avisos).toEqual([
      'root-001: 1 checklist(s) somente no snapshot; Work não tem modelo nativo',
      'root-001: 1 dependência(s) somente no snapshot; Work não tem modelo nativo',
    ]);
    const { specs } = inventariar(s, ORG, v.caminhos);
    expect(specs).toHaveLength(34);
    expect(createHash('sha256').update(canonical(specs)).digest('hex')).toBe(SPECS_DO_MARKETING_NA_BASE);
  });

  it('mesma origem é igual; valor editado no banco vira conflito com a edição preservada', async () => {
    const s = fixtureComercial();
    const specs = inventariar(s, ORG, validarSnapshot(s).caminhos).specs;
    const rows = new Map<string, Record<string, unknown>>();
    for (const spec of specs) {
      rows.set(spec.id, { id: spec.id, ...spec.conferir,
        ...(spec.tipo === 'task' ? { tags: (spec.conferir.tagIds as string[]).map((id) => ({ id })) } : {}) });
    }
    const records = Object.fromEntries(specs.map((sp) => [sp.chave, { id: sp.id, origemHash: sp.origemHash }]));
    const db = fakeDb(rows);
    expect((await planejar(db, specs, records)).every((a) => a.estado === 'igual')).toBe(true);
    const valor = specs.find((x) => x.chave === `value:lead-1:${CAMPO_VALOR}`)!;
    rows.get(valor.id)!.value = 'BRL 2000.00';
    expect(await planejar(db, [valor], records)).toEqual([
      { spec: valor, estado: 'conflito', motivo: 'registro nativo divergiu; edição local preservada' },
    ]);
    expect(rows.get(valor.id)!.value).toBe('BRL 2000.00');
  });

  it('rollback rechecado recusa depois de o valor monetário ser editado', async () => {
    const s = fixtureComercial();
    const specs = inventariar(s, ORG, validarSnapshot(s).caminhos).specs;
    const valor = specs.find((x) => x.chave === `value:lead-1:${CAMPO_VALOR}`)!;
    const valores = [{ id: valor.id, value: 'BRL 1500.00' }];
    let deletes = 0;
    let locked = false;
    const empty = { findMany: async () => [], deleteMany: async () => { deletes++; } };
    const tx = {
      ...Object.fromEntries(['workFolder', 'workList', 'workStatus', 'workField', 'workFieldOption',
        'workTag', 'workTask', 'workComment', 'auditLog'].map((name) => [name, empty])),
      workFieldValue: { ...empty, findMany: async () => valores },
      $executeRawUnsafe: async () => { locked = true; return 0; },
    } as unknown as PrismaClient;
    const depoisDoImport = await fingerprintImportado(tx, specs);
    const db = { $transaction: async (fn: (client: PrismaClient) => Promise<void>) => {
      valores[0].value = 'BRL 2000.00';
      return fn(tx);
    } } as unknown as PrismaClient;
    await expect(reverterLote(db, specs, { value: [valor.id] }, depoisDoImport)).rejects.toThrow('Rollback recusado');
    expect(locked).toBe(true);
    expect(deletes).toBe(0);
  });

  it('CLI offline: snapshot comercial passa com avisos; valor ruim sai com código 2 e sem o valor na saída', () => {
    const dir = mkdtempSync(join(tmpdir(), 'clickup-work-moeda-'));
    const rodar = (snapshot: unknown) => {
      const caminho = join(dir, 'snapshot.json');
      writeFileSync(caminho, JSON.stringify(snapshot));
      const p = spawnSync(process.execPath, [
        '--import', 'tsx', 'prisma/import-clickup-work.ts', '--snapshot', caminho, '--offline',
      ], { cwd: resolve('.'), env: { ...process.env, DATABASE_URL: '' }, encoding: 'utf8' });
      if (p.error || !p.stdout) throw new Error(`CLI sem saída: ${p.error?.message ?? p.stderr}`);
      return { status: p.status, stdout: p.stdout, relatorio: JSON.parse(p.stdout) };
    };
    try {
      const bom = rodar(fixtureComercial());
      expect(bom.status).toBe(0);
      expect(bom.relatorio.errors).toEqual([]);
      expect(bom.relatorio.warnings.filter((w: string) => w.includes('é done na origem'))).toHaveLength(2);
      const ruim = rodar(fixtureComercial({ 'lead-1': '1500.555' }));
      expect(ruim.status).toBe(2);
      expect(ruim.relatorio.errors).toEqual([`valor do campo ${CAMPO_VALOR} da tarefa lead-1: mais casas que a precisão 2`]);
      expect(ruim.stdout).not.toContain('1500.555');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
