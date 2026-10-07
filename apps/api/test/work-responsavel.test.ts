import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TrabTarefaCreateSchema, TrabTarefaUpdateSchema } from '@mktos/shared';
import { WorkService } from '../src/work/work.service';
import { AuditService } from '../src/audit/audit.service';
import { CaixaService } from '../src/caixa/caixa.service';
import { parseWorkTaskQuery } from '../src/work/work-task-query';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { CheckoutDeTarefaService } from '../src/work/checkout-de-tarefa.service';
import type { ToolGateway } from '../src/gateway/tool-gateway.service';
import type { ModulosService } from '../src/tenants/modulos.service';
import { exigirBancoDescartavel } from './banco-de-teste';

const U = 'd1fa0460-3c45-40bd-8c78-594edcf72d30';
describe('contrato de responsável por conta', () => {
  it('UUID, null e omissão são distintos na entrada', () => {
    expect(TrabTarefaUpdateSchema.parse({ assigneeUserId: U })).toEqual({ assigneeUserId: U });
    expect(TrabTarefaUpdateSchema.parse({ assigneeUserId: null })).toEqual({ assigneeUserId: null });
    expect(TrabTarefaUpdateSchema.parse({ title: 'Título' })).not.toHaveProperty('assigneeUserId');
    expect(TrabTarefaCreateSchema.safeParse({ listId: U, title: 'Tarefa', assigneeUserId: 'nome' }).success).toBe(false);
  });
  it('versão exige instante com fuso, preservado até o serviço', () => {
    expect(TrabTarefaUpdateSchema.parse({ expectedUpdatedAt: '2026-10-07T14:00:00.123-03:00' })).toEqual({ expectedUpdatedAt: '2026-10-07T14:00:00.123-03:00' });
    expect(TrabTarefaUpdateSchema.safeParse({ expectedUpdatedAt: '2026-10-07' }).success).toBe(false);
  });
  it('filtros por conta e sem vínculo não aceitam nome ou conflito de seleção', () => {
    expect(parseWorkTaskQuery({ assigneeUserId: U })).toMatchObject({ assigneeUserId: U, semResponsavel: false });
    expect(parseWorkTaskQuery({ semResponsavel: '1' })).toMatchObject({ semResponsavel: true });
    for (const raw of [{ assigneeUserId: 'Pessoa' }, { assigneeUserId: [U] }, { assigneeUserId: U, semResponsavel: '1' }, { assignee: 'Nome', assigneeUserId: U }, { semResponsavel: 'true' }]) {
      expect(() => parseWorkTaskQuery(raw)).toThrow();
    }
  });
});

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE dados sintéticos da rotina Trabalho');
const orgId = randomUUID(), vizinha = randomUUID();
const eu = randomUUID(), homonimo = randomUUID(), inativo = randomUUID(), outraPessoa = randomUUID();
async function statusDe(p: Promise<unknown>) { try { await p; return 200; } catch (e) { if (e instanceof HttpException) return e.getStatus(); throw e; } }

describe.skipIf(!URL)('rotina Trabalho no Postgres descartável', () => {
  let db: PrismaClient, svc: WorkService, caixa: CaixaService;
  let listId: string, outraListaId: string, statusId: string, outroStatus: string, taskId: string, tagId: string, fieldId: string;
  const pedido = (usuarioId: string) => ({ orgId, usuarioId, permissoes: ['dashboard.ver', 'tarefas.ver'], comConversa: true });
  async function estado() {
    const row = await db.workTask.findUniqueOrThrow({ where: { id: taskId }, include: { tags: true, values: true, comments: true } });
    const logs = await db.auditLog.findMany({ where: { orgId, entityId: taskId }, orderBy: { createdAt: 'asc' } });
    return { row, logs };
  }
  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url: URL } } });
    const p = db as unknown as PrismaService;
    svc = new WorkService(p, new AuditService(p), { agentesParaEscolher: async () => [] } as unknown as CheckoutDeTarefaService);
    caixa = new CaixaService(p, {} as ToolGateway, { modulosDaOrg: async () => new Set(['trabalho']) } as unknown as ModulosService);
    for (const id of [orgId, vizinha]) await db.org.create({ data: { id, name: 'Empresa sintética', slug: `rotina-${id}` } });
    for (const [id, org, isActive] of [[eu, orgId, true], [homonimo, orgId, true], [inativo, orgId, false], [outraPessoa, vizinha, true]] as const) {
      await db.user.create({ data: { id, orgId: org, name: 'Pessoa QA', email: `${id}@rotina.test`, passwordHash: 'sem-login', isActive } });
    }
    listId = (await db.workList.create({ data: { orgId, name: 'Lista principal' } })).id;
    outraListaId = (await db.workList.create({ data: { orgId, name: 'Segunda lista' } })).id;
    statusId = (await db.workStatus.create({ data: { orgId, listId, name: 'A fazer', type: 'open' } })).id;
    outroStatus = (await db.workStatus.create({ data: { orgId, listId, name: 'Em andamento', type: 'custom', order: 1 } })).id;
    await db.workStatus.create({ data: { orgId, listId: outraListaId, name: 'A fazer', type: 'open' } });
    tagId = (await db.workTag.create({ data: { orgId, name: 'Material' } })).id;
    fieldId = (await db.workField.create({ data: { orgId, listId, name: 'Material', type: 'texto' } })).id;
  });
  beforeEach(async () => {
    await db.workTask.deleteMany({ where: { orgId } });
    await db.auditLog.deleteMany({ where: { orgId } });
    await db.user.update({ where: { id: eu }, data: { name: 'Pessoa QA', isActive: true } });
    taskId = (await db.workTask.create({ data: {
      orgId, listId, statusId, title: 'Card original', assignee: 'Texto importado',
      assigneeUserId: eu, description: 'Material preservado', externalId: 'original-rotina', externalUrl: 'https://example.invalid/original',
      dueDate: new Date(Date.now() - 86400000), tags: { connect: { id: tagId } },
    } })).id;
    await db.workFieldValue.create({ data: { orgId, taskId, fieldId, value: 'Conteúdo original' } });
    await db.workComment.create({ data: { orgId, taskId, authorId: homonimo, authorName: 'Pessoa QA', text: 'Comentário do homônimo' } });
  });
  afterAll(async () => {
    if (!db) return;
    await db.workTask.deleteMany({ where: { orgId } });
    await db.auditLog.deleteMany({ where: { orgId } });
    await db.workField.deleteMany({ where: { orgId } });
    await db.workTag.deleteMany({ where: { orgId } });
    await db.workList.deleteMany({ where: { orgId } });
    await db.user.deleteMany({ where: { id: { in: [eu, homonimo, inativo, outraPessoa] } } });
    await db.org.deleteMany({ where: { id: { in: [orgId, vizinha] } } });
    await db.$disconnect();
  });
  it('catalogo publica apenas quatro campos e pessoas da empresa', async () => {
    const e = await svc.estrutura(orgId);
    expect(e.pessoas?.map((p) => p.id).sort()).toEqual([eu, homonimo, inativo].sort());
    expect(e.pessoas?.every((p) => Object.keys(p).sort().join(',') === 'email,id,isActive,name')).toBe(true);
  });
  it('homônimos têm consultas separadas em todas as listas e renomear conserva o vínculo', async () => {
    const segundaEtapa = await db.workStatus.findFirstOrThrow({ where: { listId: outraListaId } });
    const second = await db.workTask.create({ data: { orgId, listId: outraListaId, statusId: segundaEtapa.id, title: 'Outra lista', assigneeUserId: eu } });
    expect((await svc.tarefas(orgId, { assigneeUserId: eu })).items.map((t) => t.id).sort()).toEqual([taskId, second.id].sort());
    expect((await svc.tarefas(orgId, { assigneeUserId: homonimo })).total).toBe(0);
    await db.user.update({ where: { id: eu }, data: { name: 'Pessoa renomeada' } });
    expect((await svc.tarefa(orgId, taskId)).assigneeUserName).toBe('Pessoa renomeada');
    expect((await svc.tarefas(orgId, { assigneeUserId: eu })).total).toBe(2);
  });
  it('vincular e limpar conservam texto legado, material, tags e comentário', async () => {
    const before = await estado();
    await svc.editarTarefa(orgId, eu, taskId, { assigneeUserId: homonimo, expectedUpdatedAt: before.row.updatedAt.toISOString() });
    await svc.editarTarefa(orgId, eu, taskId, { assigneeUserId: null });
    const after = await estado();
    const preservado = (s: typeof before) => ({ id: s.row.id, assignee: s.row.assignee, description: s.row.description, externalId: s.row.externalId, externalUrl: s.row.externalUrl, agenteId: s.row.agenteId, tags: s.row.tags, values: s.row.values, comments: s.row.comments, statusId: s.row.statusId });
    expect(preservado(after)).toEqual(preservado(before));
    expect(after.row.assigneeUserId).toBeNull();
    expect((await svc.tarefas(orgId, { semResponsavel: true })).items.map((t) => t.id)).toEqual([taskId]);
  });
  it('outra empresa ou nova pessoa inativa recebem recusa sem qualquer gravação', async () => {
    const before = await estado();
    expect(await statusDe(svc.editarTarefa(orgId, eu, taskId, { assigneeUserId: outraPessoa, title: 'Indevido' }))).toBe(404);
    expect(await statusDe(svc.editarTarefa(orgId, eu, taskId, { assigneeUserId: inativo, title: 'Indevido' }))).toBe(400);
    expect(await estado()).toEqual(before);
  });
  it('vínculo inativo existente persiste com omissão ou mesmo ID', async () => {
    await db.workTask.update({ where: { id: taskId }, data: { assigneeUserId: inativo } });
    await svc.editarTarefa(orgId, eu, taskId, { title: 'Mudança permitida' });
    await svc.editarTarefa(orgId, eu, taskId, { assigneeUserId: inativo });
    const task = await svc.tarefa(orgId, taskId);
    expect(task.assigneeUserId).toBe(inativo);
    expect(task.assigneeUserIsActive).toBe(false);
  });
  it('FK composta recusa associação por empresa mesmo fora da API', async () => {
    await expect(db.workTask.update({ where: { id: taskId }, data: { assigneeUserId: outraPessoa } })).rejects.toMatchObject({ code: 'P2003' });
    expect((await estado()).row.assigneeUserId).toBe(eu);
  });
  it('etapa persiste com versão nova e audit registra ator e antes/depois', async () => {
    const before = await estado();
    const after = await svc.editarTarefa(orgId, eu, taskId, { statusId: outroStatus, expectedUpdatedAt: before.row.updatedAt.toISOString() });
    expect(after.statusName).toBe('Em andamento');
    expect(new Date(after.updatedAt).getTime()).toBeGreaterThan(before.row.updatedAt.getTime());
    const log = (await estado()).logs[0];
    expect(log).toMatchObject({ actorId: eu, action: 'work.task.update', before: { status: 'A fazer' }, after: { status: 'Em andamento' } });
  });
  it('versão stale ou repetição recebe 409 sem alterar card, tags, campos ou audit', async () => {
    const old = (await estado()).row.updatedAt.toISOString();
    await svc.editarTarefa(orgId, eu, taskId, { title: 'Primeira edição', expectedUpdatedAt: old });
    const before = await estado();
    const p = svc.editarTarefa(orgId, eu, taskId, { title: 'Perdedor', tagIds: [], campos: { [fieldId]: { value: 'Perdido' } }, expectedUpdatedAt: old });
    expect(await statusDe(p)).toBe(409);
    expect(await estado()).toEqual(before);
  });
  it('duas edições com a mesma versão têm um vencedor e um conflito sem efeitos parciais', async () => {
    const version = (await estado()).row.updatedAt.toISOString();
    const results = await Promise.all([
      statusDe(svc.editarTarefa(orgId, eu, taskId, { title: 'A', campos: { [fieldId]: { value: 'A' } }, expectedUpdatedAt: version })),
      statusDe(svc.editarTarefa(orgId, eu, taskId, { title: 'B', campos: { [fieldId]: { value: 'B' } }, expectedUpdatedAt: version })),
    ]);
    expect(results.sort()).toEqual([200, 409]);
    const final = await estado();
    expect(final.row.values[0].value).toBe(final.row.title);
    expect(final.logs).toHaveLength(1);
  });
  it('escrita sem versão mantém compatibilidade e faz a versão avançar', async () => {
    const before = (await estado()).row.updatedAt.getTime();
    await svc.editarTarefa(orgId, eu, taskId, { title: 'Legado' });
    expect((await estado()).row.updatedAt.getTime()).toBeGreaterThan(before);
  });
  it('falha de auditoria reverte card, etiquetas e material', async () => {
    const before = await estado();
    const p = db as unknown as PrismaService;
    const falha = new WorkService(p, { log: async () => { throw new Error('audit indisponível'); } } as unknown as AuditService, {} as CheckoutDeTarefaService);
    await expect(falha.editarTarefa(orgId, eu, taskId, { title: 'Não gravar', tagIds: [], campos: { [fieldId]: { value: 'Não gravar' } } })).rejects.toThrow('audit indisponível');
    expect(await estado()).toEqual(before);
  });
  it('Caixa, conversa e contador seguem a mesma conta e não excluem o recado do homônimo', async () => {
    const main = await caixa.montar(pedido(eu));
    const other = await caixa.montar(pedido(homonimo));
    expect(main.tarefas.itens.map((t) => t.id)).toEqual([taskId]);
    expect(other.tarefas.itens).toHaveLength(0);
    expect(main.conversa.itens.map((c) => c.autor)).toEqual(['Pessoa QA']);
    expect(other.conversa.itens).toHaveLength(0);
    expect((await caixa.contar(pedido(eu))).tarefas).toBe(main.tarefas.itens.length);
  });
});
