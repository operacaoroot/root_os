import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient, type Prisma } from '@prisma/client';
import { SnapshotSchema, idNativo, validarSnapshot } from '../prisma/import-clickup-work.contract';
import { arvoreDoLote, inventariar, type Spec } from '../prisma/import-clickup-work.plan';
import {
  classificarRollback, fingerprintImportado, planejar, planejarArvore, reverterLote, transformarEmArvore,
} from '../prisma/import-clickup-work';
import { AuditService } from '../src/audit/audit.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { CheckoutDeTarefaService } from '../src/work/checkout-de-tarefa.service';
import { WorkService } from '../src/work/work.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * ==========================================================================
 * A PASTA DO LOTE VIRA ÁRVORE SEM MUDAR O FINGERPRINT (ROOT-17, C-15)
 * ==========================================================================
 *
 * O lote de 30/09 entrou com a pasta plana "Demandas internas / Marketing".
 * A árvore cria o espaço e a pasta-mãe da origem e pendura a pasta do lote nela
 * escrevendo só colunas novas, com o `updatedAt` de antes (decisão F-a
 * estendida). O que esta suíte cobra:
 *  1. O fingerprint do lote não muda com a árvore, e o dry-run continua `igual`.
 *  2. A colisão de pasta não depende da ordem física das linhas (errata E-1).
 *  3. Pasta nativa dentro da pasta do lote e vínculo de tabela que a captura
 *     fixa não lê aparecem na captura só quando existem (condição 2, E-2).
 *  4. A estrutura mostra espaço → pasta-mãe → pasta do lote → listas, com a
 *     lista vazia.
 *  5. Rollback apaga as linhas do lote e a posição; os nós da árvore ficam.
 *     Reimportar e refazer a árvore dá os mesmos IDs, duas vezes.
 *  6. Nada atravessa empresa, e plano velho não grava.
 *  7. Escrita de outra sessão comitada enquanto a CLI espera o lock entra na
 *     conferência: a árvore recusa sem criar nada e o rollback recusa sem
 *     apagar nada (A-1 da ROOT-17-REV).
 */

const LISTAS = ['901328341442', '901328341443', '901328341445', '901328341450',
  '901328341456', '901328341455', '901328341451'];
const VAZIA = LISTAS[0];

function fixture() {
  const tarefa = (id: string, listId: string, order: number, extra: Record<string, unknown> = {}) => ({
    id, listId, statusId: `${listId}-todo`, title: `QA17 ${id}`, description: null, priority: null, assignees: [],
    startDate: null, dueDate: null, createdAt: null, updatedAt: null, parentId: null, archived: false, order,
    url: null, tags: [], fieldValues: [], comments: [], attachments: [], checklists: [], dependencies: [], ...extra,
  });
  return SnapshotSchema.parse({
    schemaVersion: 1, source: 'clickup', capturedAt: '2026-09-29T04:00:00.000Z', spaceId: '901313864063',
    scope: { folderPath: ['Demandas internas', 'Marketing'], listIds: LISTAS },
    completeness: { allLists: true, allTasks: true, includeClosed: true, paginationComplete: true },
    extractionGaps: [], unknownSourceFields: [],
    folders: [
      { id: 'demandas', name: 'Demandas internas', parentId: null },
      { id: 'marketing', name: 'Marketing', parentId: 'demandas' },
    ],
    lists: LISTAS.map((id, order) => ({
      id, name: id === VAZIA ? 'Gestão de Temas' : `Lista ${order}`, folderId: 'marketing', order,
      statuses: [
        { id: `${id}-todo`, name: 'to do', type: 'open', color: '#87909e', order: 0 },
        { id: `${id}-ok`, name: 'complete', type: 'closed', color: '#6bc950', order: 1 },
      ],
      fields: [{ id: `${id}-obs`, name: 'Observação', type: 'texto', order: 0, options: [] }],
    })),
    // A Gestão de Temas fica sem tarefa, como na origem: a lista vazia tem de aparecer.
    tasks: LISTAS.slice(1).flatMap((listId, i) => [
      tarefa(`t${i}-a`, listId, 0, {
        tags: [{ id: 'tag-qa17', name: 'QA17', color: '#ffcc00' }],
        fieldValues: [{ fieldId: `${listId}-obs`, value: `obs ${i}` }],
        comments: [{ id: `c${i}`, authorName: 'Pessoa QA', text: 'comentário', createdAt: '2026-09-28T10:00:00.000Z' }],
      }),
      tarefa(`t${i}-b`, listId, 1),
    ]),
  });
}

describe('árvore do lote: o plano', () => {
  const ORG = '17171717-0000-4000-8000-000000000000';
  const s = fixture();
  const arvore = arvoreDoLote(s, ORG, '  Espaço QA17  ');
  const id = (tipo: string, origem: string) => idNativo(ORG, s.spaceId, tipo, origem);

  it('espaço e pasta-mãe com idNativo de kind space e folder; a pasta do lote vai para dentro da mãe', () => {
    expect(arvore.nos).toEqual([
      { tipo: 'space', chave: 'space:901313864063', id: id('space', '901313864063'), externalId: '901313864063',
        dados: { orgId: ORG, name: 'Espaço QA17', externalId: '901313864063', order: 0 } },
      { tipo: 'folder', chave: 'folder:demandas', id: id('folder', 'demandas'), externalId: 'demandas',
        dados: { orgId: ORG, name: 'Demandas internas', externalId: 'demandas', order: 0, spaceId: id('space', '901313864063'), parentId: null } },
    ]);
    expect(arvore.posicoes).toEqual([
      { chave: 'folder:marketing', id: id('folder', 'marketing'), externalId: 'marketing', spaceId: null, parentId: id('folder', 'demandas') },
    ]);
  });

  it('a pasta do lote continua plana no inventário: nome com o caminho e sem pai', () => {
    const pasta = inventariar(s, ORG, validarSnapshot(s).caminhos).specs.find((x) => x.tipo === 'folder')!;
    expect(pasta.id).toBe(arvore.posicoes[0].id);
    expect(pasta.dados).toEqual({ orgId: ORG, name: 'Demandas internas / Marketing', order: 0 });
  });

  it('cadeia mais funda sai da mãe mais alta para baixo; ciclo e nome vazio são recusados', () => {
    const fundo = fixture();
    fundo.folders = [
      { id: 'a', name: 'A', parentId: null }, { id: 'b', name: 'B', parentId: 'a' }, { id: 'marketing', name: 'Marketing', parentId: 'b' },
    ];
    const a = arvoreDoLote(fundo, ORG, 'E');
    expect(a.nos.map((n) => [n.chave, n.dados.spaceId ?? null, n.dados.parentId ?? null])).toEqual([
      ['space:901313864063', null, null], ['folder:a', a.nos[0].id, null], ['folder:b', null, a.nos[1].id],
    ]);
    expect(a.posicoes[0].parentId).toBe(a.nos[2].id);
    const ciclo = fixture();
    ciclo.folders = [{ id: 'demandas', name: 'D', parentId: 'marketing' }, { id: 'marketing', name: 'M', parentId: 'demandas' }];
    expect(() => arvoreDoLote(ciclo, ORG, 'E')).toThrow('ciclo na pasta marketing');
    expect(() => arvoreDoLote(s, ORG, '   ')).toThrow('nome do espaço vazio');
  });
});

const URL_DO_TESTE = process.env.TEST_DATABASE_URL;
const CASA = '17171717-1717-4171-8171-171717171717';
const VIZINHA = '17171717-1717-4171-8171-17171717171b';
const QUANDO = new Date('2026-09-30T12:00:00.000Z');
const ESPACO = 'Espaço QA17';
// Sessão da CLI nos casos de concorrência: o nome a acha em pg_stat_activity, e o schema do
// vínculo de teste fica só no search_path dela, fora do catálogo das suítes que rodam em paralelo.
const NOME_DA_CLI = 'qa17-cli';
const SCHEMA_DO_VINCULO = 'qa17_concorrencia';

async function criarLote(db: PrismaClient, specs: Spec[]) {
  for (const s of specs) {
    const carimbo = s.tipo === 'folder' || s.tipo === 'list' ? { createdAt: QUANDO, updatedAt: QUANDO }
      : s.tipo === 'task' ? { createdAt: QUANDO, updatedAt: QUANDO, statusDesde: QUANDO } : {};
    const data = { id: s.id, ...s.dados, ...carimbo } as never;
    switch (s.tipo) {
      case 'folder': await db.workFolder.create({ data }); break;
      case 'list': await db.workList.create({ data }); break;
      case 'status': await db.workStatus.create({ data }); break;
      case 'field': await db.workField.create({ data }); break;
      case 'option': await db.workFieldOption.create({ data }); break;
      case 'tag': await db.workTag.create({ data }); break;
      case 'task': await db.workTask.create({ data }); break;
      case 'value': await db.workFieldValue.create({ data }); break;
      case 'comment': await db.workComment.create({ data }); break;
    }
  }
}

async function limpar(db: PrismaClient, orgId: string) {
  const org = { orgId };
  await db.workTask.deleteMany({ where: org });
  await db.workField.deleteMany({ where: org });
  await db.workTag.deleteMany({ where: org });
  await db.workList.deleteMany({ where: org });
  // Filhas antes das mães: a chave da pasta-mãe é RESTRICT.
  for (let i = 0; i < 5; i++) await db.workFolder.deleteMany({ where: { ...org, children: { none: {} } } });
  await db.workSpace.deleteMany({ where: org });
}

exigirBancoDescartavel(URL_DO_TESTE ?? '', 'ESCREVE nele (duas empresas com o lote sintético e a árvore)');

describe.skipIf(!URL_DO_TESTE)('árvore do lote no banco (ROOT-17)', () => {
  let db: PrismaClient;
  let sessaoX: PrismaClient;
  let sessaoDaCli: PrismaClient;
  const s = fixture();
  const lote = (orgId: string) => inventariar(s, orgId, validarSnapshot(s).caminhos).specs;
  const specs = lote(CASA);
  const daVizinha = lote(VIZINHA);
  const arvore = arvoreDoLote(s, CASA, ESPACO);
  const pastaDoLote = specs.find((x) => x.tipo === 'folder')!.id;
  const registros = (lista: Spec[]) => Object.fromEntries(lista.map((x) => [x.chave, { id: x.id, origemHash: x.origemHash }]));
  const criados = Object.fromEntries(['folder', 'list', 'status', 'field', 'option', 'tag', 'task', 'value', 'comment']
    .map((tipo) => [tipo, specs.filter((x) => x.tipo === tipo).map((x) => x.id)]));
  let antesDoLote = '';
  let f0 = '';
  let espacoNativo = '';
  let homonima = '';

  const estados = async (lista: Spec[]) => (await planejar(db, lista, registros(lista))).map((a) => a.estado);
  const todosIguais = async (lista: Spec[]) => (await estados(lista)).every((e) => e === 'igual');

  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url: URL_DO_TESTE } } });
    sessaoX = new PrismaClient({ datasources: { db: { url: URL_DO_TESTE } } });
    const daCli = new URL(URL_DO_TESTE!);
    daCli.searchParams.set('application_name', NOME_DA_CLI);
    daCli.searchParams.set('options', `-c search_path=${SCHEMA_DO_VINCULO},public`);
    sessaoDaCli = new PrismaClient({ datasources: { db: { url: daCli.toString() } } });
    for (const [id, slug] of [[CASA, 'qa17-casa'], [VIZINHA, 'qa17-vizinha']]) {
      await db.org.upsert({ where: { id }, create: { id, name: slug, slug }, update: {} });
      await limpar(db, id);
    }
    antesDoLote = await fingerprintImportado(db, specs);
    await criarLote(db, specs);
    await criarLote(db, daVizinha);
    f0 = await fingerprintImportado(db, specs);
    // A homônima da errata E-1: pasta de topo nativa num espaço nativo, com o nome da pasta do lote.
    espacoNativo = (await db.workSpace.create({ data: { orgId: CASA, name: 'Espaço nativo QA17' } })).id;
    homonima = (await db.workFolder.create({ data: { orgId: CASA, spaceId: espacoNativo, name: 'Demandas internas / Marketing' } })).id;
  });

  afterAll(async () => {
    if (!db) return;
    for (const id of [CASA, VIZINHA]) await limpar(db, id);
    await db.org.deleteMany({ where: { id: { in: [CASA, VIZINHA] } } });
    await sessaoX?.$disconnect();
    await sessaoDaCli?.$disconnect();
    await db.$disconnect();
  });

  it('a colisão de pasta não depende da ordem física: UPDATE sem mudança de valor não muda o dry-run (E-1)', async () => {
    expect(await todosIguais(specs)).toBe(true);
    await db.$executeRaw`UPDATE "WorkFolder" SET "name" = "name" WHERE "id" = ${pastaDoLote}`;
    expect(await todosIguais(specs)).toBe(true);
    await db.$executeRaw`UPDATE "WorkFolder" SET "name" = "name" WHERE "id" = ${homonima}`;
    expect(await todosIguais(specs)).toBe(true);
    expect(await fingerprintImportado(db, specs)).toBe(f0);
  });

  it('a árvore cria espaço e pasta-mãe, pendura a pasta do lote só por colunas novas e o fingerprint não muda', async () => {
    const plano = await planejarArvore(db, arvore, specs);
    expect(plano.nos.map((n) => n.estado)).toEqual(['criar', 'criar']);
    expect(plano.posicoes.map((x) => x.estado)).toEqual(['mover']);
    const antes = await db.workFolder.findUniqueOrThrow({ where: { id: pastaDoLote } });
    const r = await transformarEmArvore(db, specs, arvore, { fingerprint: f0, plano });
    expect(r).toEqual({
      criados: { space: [arvore.nos[0].id], folder: [arvore.nos[1].id] },
      movidas: [{ id: pastaDoLote, antes: { spaceId: null, parentId: null, externalId: null },
        depois: { spaceId: null, parentId: arvore.nos[1].id, externalId: 'marketing' } }],
      fingerprint: f0,
    });
    const depois = await db.workFolder.findUniqueOrThrow({ where: { id: pastaDoLote } });
    expect(depois).toEqual({ ...antes, parentId: arvore.nos[1].id, externalId: 'marketing' });
    expect(depois.updatedAt.toISOString()).toBe(QUANDO.toISOString());
    expect(await db.workFolder.findUniqueOrThrow({ where: { id: arvore.nos[1].id } })).toMatchObject({
      orgId: CASA, name: 'Demandas internas', externalId: 'demandas', spaceId: arvore.nos[0].id, parentId: null,
    });
    expect(await fingerprintImportado(db, specs)).toBe(f0);
    expect(classificarRollback(f0, { preFingerprint: antesDoLote, postFingerprint: f0 })).toBe('pronto');
    expect(await todosIguais(specs)).toBe(true);
    await db.$executeRaw`UPDATE "WorkFolder" SET "name" = "name" WHERE "id" = ${pastaDoLote}`;
    expect(await todosIguais(specs)).toBe(true);
  });

  it('refazer a árvore não cria nem move nada', async () => {
    const plano = await planejarArvore(db, arvore, specs);
    expect([...plano.nos, ...plano.posicoes].map((x) => x.estado)).toEqual(['igual', 'igual', 'igual']);
    const r = await transformarEmArvore(db, specs, arvore, { fingerprint: f0, plano });
    expect(r).toEqual({ criados: { space: [], folder: [] }, movidas: [], fingerprint: f0 });
    expect(await db.workSpace.count({ where: { orgId: CASA } })).toBe(2);
  });

  it('a estrutura mostra espaço → pasta-mãe → pasta do lote → listas, e a lista vazia aparece', async () => {
    const prisma = db as unknown as PrismaService;
    const audit = new AuditService(prisma);
    const svc = new WorkService(prisma, audit, new CheckoutDeTarefaService(prisma, audit, new EventLogService(prisma)));
    const e = await svc.estrutura(CASA);
    expect(e.espacos.find((x) => x.id === arvore.nos[0].id)).toEqual({ id: arvore.nos[0].id, name: ESPACO, order: 0, externalId: '901313864063' });
    const mae = e.folders.find((f) => f.id === arvore.nos[1].id)!;
    expect(mae).toMatchObject({ name: 'Demandas internas', spaceId: arvore.nos[0].id, parentId: null, lists: [] });
    const pasta = e.folders.find((f) => f.id === pastaDoLote)!;
    expect(pasta).toMatchObject({ name: 'Demandas internas / Marketing', spaceId: null, parentId: mae.id, externalId: 'marketing' });
    expect(pasta.lists.map((l) => [l.externalId, l.total])).toEqual(LISTAS.map((id) => [id, id === VAZIA ? 0 : 2]));
    expect(pasta.lists[0].statuses.map((x) => x.name)).toEqual(['to do', 'complete']);
    expect(e.listasSoltas.filter((l) => LISTAS.includes(l.externalId ?? ''))).toEqual([]);
  });

  it('pasta nativa dentro da pasta do lote entra na captura e o rollback recusa antes de apagar (condição 2)', async () => {
    const filha = await db.workFolder.create({ data: { orgId: CASA, parentId: pastaDoLote, name: 'Subpasta nativa' } });
    try {
      const comFilha = await fingerprintImportado(db, specs);
      expect(comFilha).not.toBe(f0);
      expect(classificarRollback(comFilha, { preFingerprint: antesDoLote, postFingerprint: f0 })).toBe('divergente');
      await expect(reverterLote(db, specs, criados, f0)).rejects.toThrow('Rollback recusado');
      expect(await db.workTask.count({ where: { orgId: CASA } })).toBe(specs.filter((x) => x.tipo === 'task').length);
    } finally {
      await db.workFolder.delete({ where: { id: filha.id } });
    }
    expect(await fingerprintImportado(db, specs)).toBe(f0);
  });

  it('vínculo de tabela que a captura fixa não lê entra na captura só quando aponta para o lote (E-2)', async () => {
    const tarefa = specs.find((x) => x.tipo === 'task')!.id;
    const desfazer = new Error('desfaz o DDL do teste');
    await expect(db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE TABLE "R17VinculoDeTeste" ("id" TEXT PRIMARY KEY,
        "workTaskId" TEXT NOT NULL REFERENCES "WorkTask"("id") ON DELETE CASCADE)`);
      expect(await fingerprintImportado(tx, specs)).toBe(f0);
      await tx.$executeRaw`INSERT INTO "R17VinculoDeTeste" ("id", "workTaskId") VALUES ('v1', ${tarefa})`;
      const comVinculo = await fingerprintImportado(tx, specs);
      expect(comVinculo).not.toBe(f0);
      await tx.$executeRaw`DELETE FROM "R17VinculoDeTeste"`;
      expect(await fingerprintImportado(tx, specs)).toBe(f0);
      throw desfazer;
    })).rejects.toBe(desfazer);
    expect(await db.$queryRaw<Array<{ existe: boolean }>>`SELECT to_regclass('"R17VinculoDeTeste"') IS NOT NULL AS existe`)
      .toEqual([{ existe: false }]);
  });

  it('plano velho não grava: pasta do lote mexida depois do dry-run recusa a árvore e nada nasce', async () => {
    const daVizinhaArvore = arvoreDoLote(s, VIZINHA, ESPACO);
    const pastaDaVizinha = daVizinha.find((x) => x.tipo === 'folder')!.id;
    const f0Vizinha = await fingerprintImportado(db, daVizinha);
    const plano = await planejarArvore(db, daVizinhaArvore, daVizinha);
    expect([...plano.nos, ...plano.posicoes].map((x) => x.estado)).toEqual(['criar', 'criar', 'mover']);
    await db.workFolder.update({ where: { id: pastaDaVizinha }, data: { order: 0 } });
    try {
      await expect(transformarEmArvore(db, daVizinha, daVizinhaArvore, { fingerprint: f0Vizinha, plano }))
        .rejects.toThrow('Banco mudou durante o planejamento');
      expect(await db.workSpace.count({ where: { orgId: VIZINHA } })).toBe(0);
      expect(await db.workFolder.findUniqueOrThrow({ where: { id: pastaDaVizinha } }))
        .toMatchObject({ spaceId: null, parentId: null, externalId: null });
    } finally {
      await db.$executeRaw`UPDATE "WorkFolder" SET "updatedAt" = ${QUANDO} WHERE "id" = ${pastaDaVizinha}`;
    }
    expect(await fingerprintImportado(db, daVizinha)).toBe(f0Vizinha);
  });

  it('a árvore de uma empresa não toca a outra, e espaço homônimo nativo é conflito sem escrita', async () => {
    const pastaDaVizinha = daVizinha.find((x) => x.tipo === 'folder')!.id;
    expect(await db.workFolder.findUniqueOrThrow({ where: { id: pastaDaVizinha } }))
      .toMatchObject({ orgId: VIZINHA, spaceId: null, parentId: null, externalId: null });
    const daVizinhaArvore = arvoreDoLote(s, VIZINHA, ESPACO);
    expect(daVizinhaArvore.nos[0].id).not.toBe(arvore.nos[0].id);
    const nativo = await db.workSpace.create({ data: { orgId: VIZINHA, name: ESPACO } });
    try {
      const plano = await planejarArvore(db, daVizinhaArvore, daVizinha);
      expect(plano.nos[0]).toMatchObject({ estado: 'conflito', motivo: `identidade nativa existente ${nativo.id}` });
      await expect(transformarEmArvore(db, daVizinha, daVizinhaArvore, { fingerprint: await fingerprintImportado(db, daVizinha), plano }))
        .rejects.toThrow('Árvore recusada');
      expect(await db.workFolder.count({ where: { orgId: VIZINHA, externalId: { not: null } } })).toBe(0);
    } finally {
      await db.workSpace.delete({ where: { id: nativo.id } });
    }
  });

  it('pasta-mãe que alguém pôs dentro da pasta do lote fecharia ciclo: conflito e nada gravado', async () => {
    const daVizinhaArvore = arvoreDoLote(s, VIZINHA, ESPACO);
    const pastaDaVizinha = daVizinha.find((x) => x.tipo === 'folder')!.id;
    const mae = daVizinhaArvore.nos[1];
    const f0Vizinha = await fingerprintImportado(db, daVizinha);
    await db.workFolder.create({ data: { id: mae.id, orgId: VIZINHA, name: 'Demandas internas', externalId: 'demandas', parentId: pastaDaVizinha } });
    try {
      const plano = await planejarArvore(db, daVizinhaArvore, daVizinha);
      expect(plano.nos[1]).toMatchObject({ estado: 'igual', aviso: 'em outro lugar da árvore; fica como está' });
      expect(plano.posicoes[0]).toMatchObject({ estado: 'conflito', motivo: 'a pasta-mãe está dentro da pasta do lote' });
      await expect(transformarEmArvore(db, daVizinha, daVizinhaArvore, { fingerprint: await fingerprintImportado(db, daVizinha), plano }))
        .rejects.toThrow('Árvore recusada');
      expect(await db.workSpace.count({ where: { orgId: VIZINHA } })).toBe(0);
      expect(await db.workFolder.findUniqueOrThrow({ where: { id: pastaDaVizinha } })).toMatchObject({ parentId: null, externalId: null });
    } finally {
      await db.workFolder.delete({ where: { id: mae.id } });
    }
    expect(await fingerprintImportado(db, daVizinha)).toBe(f0Vizinha);
  });

  it('rollback apaga as linhas do lote e a posição, os nós da árvore ficam; reimportar e refazer a árvore dá os mesmos IDs, duas vezes', async () => {
    const tarefas = specs.filter((x) => x.tipo === 'task').map((x) => x.id).sort();
    for (let rodada = 1; rodada <= 2; rodada++) {
      await reverterLote(db, specs, criados, f0);
      expect(await fingerprintImportado(db, specs)).toBe(antesDoLote);
      expect(classificarRollback(antesDoLote, { preFingerprint: antesDoLote, postFingerprint: f0 })).toBe('ja-revertido');
      expect(await db.workFolder.findUnique({ where: { id: pastaDoLote } })).toBeNull();
      expect(await db.workSpace.findUnique({ where: { id: arvore.nos[0].id } })).not.toBeNull();
      expect(await db.workFolder.findUnique({ where: { id: arvore.nos[1].id } })).toMatchObject({ spaceId: arvore.nos[0].id });
      expect(await db.workFolder.findUnique({ where: { id: homonima } })).not.toBeNull();

      // Com a pasta fora, a posição de nascimento passa a contar: homônima plana nativa é conflito.
      const plana = await db.workFolder.create({ data: { orgId: CASA, name: 'Demandas internas / Marketing' } });
      const pasta = specs.find((x) => x.tipo === 'folder')!;
      expect((await planejar(db, [pasta]))[0]).toMatchObject({ estado: 'conflito', motivo: `identidade nativa existente ${plana.id}` });
      await db.workFolder.delete({ where: { id: plana.id } });
      expect((await planejar(db, [pasta]))[0].estado).toBe('criar');

      await criarLote(db, specs);
      expect(await fingerprintImportado(db, specs)).toBe(f0);
      const plano = await planejarArvore(db, arvore, specs);
      expect([...plano.nos, ...plano.posicoes].map((x) => x.estado)).toEqual(['igual', 'igual', 'mover']);
      expect((await transformarEmArvore(db, specs, arvore, { fingerprint: f0, plano })).fingerprint).toBe(f0);
      expect((await db.workTask.findMany({ where: { orgId: CASA }, select: { id: true } })).map((t) => t.id).sort()).toEqual(tarefas);
      expect(await todosIguais(specs)).toBe(true);
    }
    expect(await db.workSpace.count({ where: { orgId: CASA } })).toBe(2);
    expect(await db.workFolder.count({ where: { orgId: CASA, externalId: 'demandas' } })).toBe(1);
  });

  /*
   * A-1 da ROOT-17-REV: a sessão X escreve e segura a transação; a CLI pede o lock e fica
   * esperando a X; só então a X faz COMMIT. `espera` diz em que instrução a CLI esperou a X.
   */
  async function comCommitDuranteOLock<T>(
    escrever: (x: Prisma.TransactionClient) => Promise<unknown>,
    rodarCli: (cli: PrismaClient) => Promise<T>,
  ): Promise<{ espera: string; resultado: PromiseSettledResult<T> }> {
    let soltar = () => {};
    const portao = new Promise<void>((r) => { soltar = r; });
    let avisar: (pid: number) => void = () => {};
    const escreveu = new Promise<number>((r) => { avisar = r; });
    const x = sessaoX.$transaction(async (t) => {
      await escrever(t);
      const [{ pid }] = await t.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid() AS pid`;
      avisar(pid);
      await portao;
    }, { timeout: 60000 });
    const pidDaX = await Promise.race([escreveu, x.then(() => -1)]);
    const resultado = Promise.allSettled([rodarCli(sessaoDaCli)]).then(([r]) => r);
    let espera = '';
    for (const ate = Date.now() + 10000; !espera && Date.now() < ate;) {
      const linhas = await db.$queryRaw<Array<{ instrucao: string }>>`
        SELECT split_part(query, ' ', 1) || ' ' || split_part(query, ' ', 2) AS instrucao FROM pg_stat_activity
         WHERE application_name = ${NOME_DA_CLI} AND ${pidDaX}::int = ANY(pg_blocking_pids(pid))`;
      espera = linhas[0]?.instrucao ?? '';
      if (!espera) await new Promise((r) => setTimeout(r, 20));
    }
    soltar();
    await x;
    return { espera, resultado: await resultado };
  }
  const recusa = (r: PromiseSettledResult<unknown>) => (r.status === 'rejected' ? (r.reason as Error).message : 'gravou');
  const tarefasDoLote = specs.filter((x) => x.tipo === 'task').length;

  it('árvore: título de tarefa do lote comitado por outra sessão durante a espera do lock faz recusar, e nada nasce (A-1)', async () => {
    const daVizinhaArvore = arvoreDoLote(s, VIZINHA, ESPACO);
    const pastaDaVizinha = daVizinha.find((x) => x.tipo === 'folder')!.id;
    const tarefa = daVizinha.find((x) => x.tipo === 'task')!.id;
    const { title } = await db.workTask.findUniqueOrThrow({ where: { id: tarefa }, select: { title: true } });
    const f0Vizinha = await fingerprintImportado(db, daVizinha);
    const plano = await planejarArvore(db, daVizinhaArvore, daVizinha);
    expect([...plano.nos, ...plano.posicoes].map((x) => x.estado)).toEqual(['criar', 'criar', 'mover']);
    try {
      const { espera, resultado } = await comCommitDuranteOLock(
        (x) => x.$executeRaw`UPDATE "WorkTask" SET "title" = 'QA17 título concorrente' WHERE "id" = ${tarefa}`,
        (cli) => transformarEmArvore(cli, daVizinha, daVizinhaArvore, { fingerprint: f0Vizinha, plano }));
      expect(recusa(resultado)).toContain('Banco mudou durante o planejamento');
      expect(espera).toBe('LOCK TABLE');
      expect(await db.workSpace.count({ where: { orgId: VIZINHA } })).toBe(0);
      expect(await db.workFolder.findUniqueOrThrow({ where: { id: pastaDaVizinha } }))
        .toMatchObject({ spaceId: null, parentId: null, externalId: null });
    } finally {
      await db.$executeRaw`UPDATE "WorkTask" SET "title" = ${title} WHERE "id" = ${tarefa}`;
    }
    expect(await fingerprintImportado(db, daVizinha)).toBe(f0Vizinha);
  }, 30000);

  // A tabela do vínculo vem do catálogo; o lock dela também tem de vir antes do snapshot (mutante R4 da revisão).
  it('rollback: vínculo externo comitado por outra sessão durante a espera do lock faz recusar, e nada é apagado (A-1)', async () => {
    const tarefa = specs.find((x) => x.tipo === 'task')!.id;
    const vinculo = `"${SCHEMA_DO_VINCULO}"."R17VinculoConcorrente"`;
    await db.$executeRawUnsafe(`CREATE SCHEMA "${SCHEMA_DO_VINCULO}"`);
    try {
      await db.$executeRawUnsafe(`CREATE TABLE ${vinculo} ("id" TEXT PRIMARY KEY,
        "workTaskId" TEXT NOT NULL REFERENCES "WorkTask"("id") ON DELETE RESTRICT)`);
      expect(await fingerprintImportado(sessaoDaCli, specs)).toBe(f0);
      const { espera, resultado } = await comCommitDuranteOLock(
        (x) => x.$executeRawUnsafe(`INSERT INTO ${vinculo} ("id", "workTaskId") VALUES ('v1', $1)`, tarefa),
        (cli) => reverterLote(cli, specs, criados, f0));
      expect(recusa(resultado)).toContain('Rollback recusado');
      expect(espera).toBe('LOCK TABLE');
      expect(await db.workTask.count({ where: { orgId: CASA } })).toBe(tarefasDoLote);
    } finally {
      await db.$executeRawUnsafe(`DROP SCHEMA "${SCHEMA_DO_VINCULO}" CASCADE`);
    }
    expect(await fingerprintImportado(sessaoDaCli, specs)).toBe(f0);
  }, 30000);

  it('rollback: auditoria de tarefa do lote comitada por outra sessão durante a espera do lock faz recusar, e nada é apagado (A-1)', async () => {
    const tarefa = specs.find((x) => x.tipo === 'task')!.id;
    try {
      const { espera, resultado } = await comCommitDuranteOLock(
        (x) => x.auditLog.create({ data: {
          id: 'qa17-auditoria-concorrente', orgId: CASA, action: 'work.task.update', entityType: 'work_task', entityId: tarefa,
        } }),
        (cli) => reverterLote(cli, specs, criados, f0));
      expect(recusa(resultado)).toContain('Rollback recusado');
      expect(espera).toBe('LOCK TABLE');
      expect(await db.workTask.count({ where: { orgId: CASA } })).toBe(tarefasDoLote);
    } finally {
      await db.auditLog.deleteMany({ where: { id: 'qa17-auditoria-concorrente' } });
    }
    expect(await fingerprintImportado(db, specs)).toBe(f0);
  }, 30000);
});
