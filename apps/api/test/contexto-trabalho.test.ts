import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ContextoTarefaCreateSchema } from '@mktos/shared';
import { ContextoTrabalhoService, normalizarPedidoDeContexto, fingerprintDeContexto } from '../src/memory/contexto-trabalho.service';
import { MemoriaService } from '../src/memory/memoria.service';
import { ObsidianService } from '../src/obsidian/obsidian.service';
import { hashDoCorpo } from '../src/memory/procedencia';
import { coletarEstado } from '../src/memory/documentacao';
import { podeLerFonte } from '../src/memory/acesso-memoria';
import { AuditService } from '../src/audit/audit.service';
import { comContexto } from '../src/common/contexto-execucao';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { EventLogService } from '../src/gateway/event-log.service';
import type { RegistroDeConectores } from '../src/integrations/conectores.registry';
import type { ConectoresConfiguradosRegistry } from '../src/gateway/conectores-configurados.registry';
import { exigirBancoDescartavel } from './banco-de-teste';

const id = () => randomUUID();
describe('contrato do uso de Contexto', () => {
  it('valida UUIDs, hash, versão corrente e rejeita campos não contratados', () => {
    const p = { requestId: id(), versionId: id(), contentHash: 'a'.repeat(64), expectedItemVersion: 1, listId: id(), title: ' Tarefa ' };
    expect(ContextoTarefaCreateSchema.parse(p).title).toBe('Tarefa');
    for (const delta of [{ description: 'corpo da fonte' }, { expectedItemVersion: 0 }, { contentHash: 'hash' }, { versionId: 'nome' }])
      expect(ContextoTarefaCreateSchema.safeParse({ ...p, ...delta }).success).toBe(false);
  });
  it('normaliza intenção equivalente e separa pedidos de pessoas distintas', () => {
    const p = { requestId: id(), versionId: id(), contentHash: 'a'.repeat(64), expectedItemVersion: 1, listId: id(), title: ' Tarefa ' };
    const a = normalizarPedidoDeContexto(p), b = normalizarPedidoDeContexto({ ...p, title: 'Tarefa', assigneeUserId: null });
    expect(a).toEqual(b);
    expect(fingerprintDeContexto('org', 'A', 'fonte', a)).toBe(fingerprintDeContexto('org', 'A', 'fonte', b));
    expect(fingerprintDeContexto('org', 'A', 'fonte', a)).not.toBe(fingerprintDeContexto('org', 'B', 'fonte', a));
  });
  it('fonte restrita com lista vazia ou sem solicitante nega leitura', () => {
    expect(podeLerFonte({ acessoRestrito: false })).toBe(true);
    expect(podeLerFonte({ acessoRestrito: true, leitores: [] }, 'A')).toBe(false);
    expect(podeLerFonte({ acessoRestrito: true, leitores: ['A'] })).toBe(false);
    expect(podeLerFonte({ acessoRestrito: true, leitores: ['A'] }, 'A')).toBe(true);
  });
});
const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE fixtures próprias de Contexto');
const org = id(), vizinha = id(), pessoa = id(), segunda = id(), estrangeira = id();
async function status(p: Promise<unknown>) { try { await p; return 200; } catch (e) { if (e instanceof HttpException) return e.getStatus(); throw e; } }

describe.skipIf(!URL)('Contexto e tarefa no Postgres descartável', () => {
  let db: PrismaClient, svc: ContextoTrabalhoService, memoria: MemoriaService, knowledge: ObsidianService;
  let listId: string, statusId: string, roleId: string, noteId: string, versionId: string, hash: string;
  const req = () => ({ requestId: id(), versionId, contentHash: hash, expectedItemVersion: 1, listId, title: 'Tarefa solicitada', assigneeUserId: pessoa });
  const contexto = <T>(fn: () => T) => comContexto({ orgId: org, actorType: 'user', actorId: pessoa, correlationId: id(), origem: 'script' }, fn);
  async function fonte(body = 'Material sintético original', restricted = true) {
    const h = hashDoCorpo(body);
    const n = await db.contextItem.create({ data: { orgId: org, chave: 'qa:' + id(), title: 'Fonte sintética', body, sourceType: 'operador', sourceRef: 'QA local', contentHash: h, acessoRestrito: restricted, leitores: restricted ? [pessoa, segunda] : [] } });
    const v = await db.contextItemVersion.create({ data: { orgId: org, itemId: n.id, versao: 1, mudanca: 'criacao', kind: 'nota', title: n.title, body, sourceType: 'operador', sourceRef: n.sourceRef, contentHash: h, semEventoPorque: 'migracao' } });
    return { n, v, hash: h };
  }
  async function nEfeitos() { return { tasks: await db.workTask.count({ where: { orgId: org } }), links: await db.workContextSource.count({ where: { orgId: org } }), audit: await db.auditLog.count({ where: { orgId: org } }) }; }
  async function limpar() {
    await db.workContextSource.deleteMany({ where: { orgId: org } });
    await db.workTask.deleteMany({ where: { orgId: org } }); await db.auditLog.deleteMany({ where: { orgId: org } });
    await db.contextItemVersion.deleteMany({ where: { orgId: org } }); await db.contextItem.deleteMany({ where: { orgId: org } });
    await db.knowledgeNote.deleteMany({ where: { orgId: org } });
  }
  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url: URL } } });
    const p = db as unknown as PrismaService;
    svc = new ContextoTrabalhoService(p, new AuditService(p));
    memoria = new MemoriaService(p, { registrar: async () => { throw Error('fixture sem evento'); } } as unknown as EventLogService);
    knowledge = new ObsidianService(p, {} as ConectoresConfiguradosRegistry, {} as RegistroDeConectores, memoria);
    for (const orgId of [org, vizinha]) await db.org.create({ data: { id: orgId, name: 'QA Contexto', slug: 'ctx-' + orgId } });
    const permissions = [];
    for (const key of ['obsidian.ver', 'obsidian.editar', 'tarefas.ver', 'tarefas.editar']) permissions.push(await db.permission.upsert({ where: { key }, create: { key }, update: {} }));
    const role = await db.role.create({ data: { orgId: org, key: 'ctx', name: 'QA Contexto', permissions: { connect: permissions.map((p) => ({ id: p.id })) } } }); roleId = role.id;
    for (const uid of [pessoa, segunda]) await db.user.create({ data: { id: uid, orgId: org, name: 'Pessoa QA', email: uid + '@qa.invalid', passwordHash: 'sem-login', roles: { connect: { id: roleId } } } });
    await db.user.create({ data: { id: estrangeira, orgId: vizinha, name: 'Vizinha QA', email: estrangeira + '@qa.invalid', passwordHash: 'sem-login' } });
    listId = (await db.workList.create({ data: { orgId: org, name: 'QA lista' } })).id;
    statusId = (await db.workStatus.create({ data: { orgId: org, listId, name: 'A fazer', type: 'open' } })).id;
  });
  beforeEach(async () => {
    await limpar();
    await db.user.updateMany({ where: { id: { in: [pessoa, segunda] } }, data: { isActive: true } });
    await db.role.update({ where: { id: roleId }, data: { permissions: { connect: { key: 'obsidian.ver' } } } });
    const f = await fonte(); noteId = f.n.id; versionId = f.v.id; hash = f.hash;
  });
  afterAll(async () => {
    if (!db) return; await limpar();
    await db.workList.deleteMany({ where: { orgId: org } });
    await db.user.deleteMany({ where: { id: { in: [pessoa, segunda, estrangeira] } } });
    await db.role.deleteMany({ where: { id: roleId } });
    await db.org.deleteMany({ where: { id: { in: [org, vizinha] } } }); await db.$disconnect();
  });
  it('cria tarefa, vínculo e auditoria sem copiar corpo para tarefa/audit', async () => {
    const r = await svc.criar(org, pessoa, noteId, req());
    expect(r.replayed).toBe(false); expect(r.fonte).toMatchObject({ itemId: noteId, versionId, versao: 1, contentHash: hash, body: 'Material sintético original' });
    expect(await nEfeitos()).toEqual({ tasks: 1, links: 1, audit: 1 });
    const t = await db.workTask.findUniqueOrThrow({ where: { id: r.taskId } }); expect(t.description).toBeNull(); expect(t.agenteId).toBeNull();
    expect(JSON.stringify(await db.auditLog.findMany({ where: { orgId: org } }))).not.toContain('Material sintético original');
  });
  it('pedidos concorrentes e replay criam apenas um efeito', async () => {
    const p = req(); const [a,b] = await Promise.all([svc.criar(org, pessoa, noteId, p), svc.criar(org, pessoa, noteId, p)]);
    expect(a.taskId).toBe(b.taskId); expect([a.replayed,b.replayed].sort()).toEqual([false,true]);
    expect((await svc.criar(org, pessoa, noteId, p)).taskId).toBe(a.taskId); expect(await nEfeitos()).toEqual({ tasks: 1, links: 1, audit: 1 });
  });
  it('outro payload ou ator não reutiliza identidade do pedido', async () => {
    const p = req(); await svc.criar(org, pessoa, noteId, p);
    expect(await status(svc.criar(org, pessoa, noteId, { ...p, title: 'Outro título' }))).toBe(409);
    expect(await status(svc.criar(org, segunda, noteId, p))).toBe(409); expect(await nEfeitos()).toEqual({ tasks: 1, links: 1, audit: 1 });
  });
  it('revogação ou inativação atual recusa sem efeitos', async () => {
    await db.role.update({ where: { id: roleId }, data: { permissions: { disconnect: { key: 'obsidian.ver' } } } });
    expect(await status(svc.criar(org, pessoa, noteId, req()))).toBe(403);
    await db.role.update({ where: { id: roleId }, data: { permissions: { connect: { key: 'obsidian.ver' } } } });
    await db.user.update({ where: { id: pessoa }, data: { isActive: false } });
    expect(await status(svc.criar(org, pessoa, noteId, req()))).toBe(403); expect(await nEfeitos()).toEqual({ tasks: 0, links: 0, audit: 0 });
  });
  it('restrito vazio e pessoa sem concessão ficam ocultos em todos os leitores de memória', async () => {
    await db.contextItem.update({ where: { id: noteId }, data: { leitores: [] } });
    expect((await memoria.listar(org, {}, pessoa)).total).toBe(0);
    expect((await memoria.buscar(org, 'Material', 1, undefined, pessoa)).itens).toEqual([]);
    expect(await memoria.obter(org, noteId, pessoa)).toBeNull();
    expect(await status(memoria.historico(org, noteId, pessoa))).toBe(404);
    expect(await status(svc.criar(org, pessoa, noteId, req()))).toBe(404);
  });
  it('leitor interno sem pessoa, revogado ou inativo não recebe fonte restrita', async () => {
    expect(await memoria.obter(org, noteId)).toBeNull();
    expect(await contexto(() => memoria.obter(org, noteId))).not.toBeNull();
    await db.role.update({ where: { id: roleId }, data: { permissions: { disconnect: { key: 'obsidian.ver' } } } });
    expect(await contexto(() => memoria.obter(org, noteId))).toBeNull();
    await db.role.update({ where: { id: roleId }, data: { permissions: { connect: { key: 'obsidian.ver' } } } });
    await db.user.update({ where: { id: pessoa }, data: { isActive: false } });
    expect((await contexto(() => memoria.buscar(org, 'Material'))).itens).toEqual([]);
  });
  it('índice Knowledge respeita restrição pela chave/path, inclusive leitor ausente', async () => {
    const path = 'qa-contexto/' + noteId + '.md'; await db.contextItem.update({ where: { id: noteId }, data: { chave: 'vault:' + path } });
    const kn = await db.knowledgeNote.create({ data: { orgId: org, path, title: 'Material QA', content: 'Material sintético original', fileTime: new Date(), wordCount: 3 } });
    expect(await knowledge.get(org, kn.id)).toBeNull();
    expect((await knowledge.search(org, 'Material')).items).toEqual([]);
    expect((await knowledge.list(org)).total).toBe(0);
    expect(await knowledge.get(org, kn.id, pessoa)).not.toBeNull();
    await db.contextItem.update({ where: { id: noteId }, data: { leitores: [] } });
    expect(await knowledge.get(org, kn.id, pessoa)).toBeNull();
  });
  it('documentação sem pessoa não exporta corpo ou título de fonte restrita', async () => {
    await db.contextItem.update({ where: { id: noteId }, data: { kind: 'definicao' } });
    const estado = await coletarEstado(db, org);
    expect(estado.notas).toEqual([]);
    await db.contextItem.update({ where: { id: noteId }, data: { acessoRestrito: false } });
    expect((await coletarEstado(db, org)).notas).toHaveLength(1);
  });
  it('projeção condicionada recusa destino restrito mesmo com ID e hash conhecidos', async () => {
    const f = await fonte('Fonte aberta para projeção', false);
    const antes = await db.contextItem.findUniqueOrThrow({ where: { id: noteId } });
    await db.contextItem.update({ where: { id: noteId }, data: { leitores: [] } });
    const pedido = {
      fonte: { id: f.n.id, chave: f.n.chave, versao: 1, hash: f.hash },
      destino: { id: noteId, chave: antes.chave, versao: 1, hash },
      title: 'Projeção solicitada', body: 'Novo corpo', tags: [], sourceRef: 'QA projeção', motivo: 'QA',
    };
    expect(await contexto(() => status(memoria.projetarCondicionado(org, pedido)))).toBe(409);
    const depois = await db.contextItem.findUniqueOrThrow({ where: { id: noteId } });
    expect(depois.body).toBe(antes.body); expect(depois.versao).toBe(1);
    expect(await db.contextItemVersion.count({ where: { itemId: noteId } })).toBe(1);
  });
  it('escolha histórica mantém versão usada após atualização, com replay antigo', async () => {
    const p = req(), a = await svc.criar(org, pessoa, noteId, p);
    await contexto(() => memoria.alterar(org, noteId, { body: 'Novo material', sourceRef: 'Origem atualizada', versaoEsperada: 1 }));
    const old = await svc.fontes(org, pessoa, a.taskId);
    expect(old.fontes[0]).toMatchObject({ versionId, versao: 1, body: 'Material sintético original', sourceRef: 'QA local', versaoAtual: 2 });
    expect((await svc.criar(org, pessoa, noteId, p)).taskId).toBe(a.taskId);
    expect(await status(svc.criar(org, pessoa, noteId, req()))).toBe(409);
    const selected = await svc.criar(org, pessoa, noteId, { ...req(), expectedItemVersion: 2 });
    expect(selected.fonte).toMatchObject({ versionId, versao: 1, versaoAtual: 2 });
  });
  it('versão de outro item, lista ou responsável de outra empresa não causa efeito', async () => {
    const f = await fonte('Outra fonte');
    expect(await status(svc.criar(org, pessoa, noteId, { ...req(), versionId: f.v.id, contentHash: f.hash }))).toBe(404);
    expect(await status(svc.criar(org, pessoa, noteId, { ...req(), assigneeUserId: estrangeira }))).toBe(404);
    const l = await db.workList.create({ data: { orgId: vizinha, name: 'Vizinha' } });
    try { expect(await status(svc.criar(org, pessoa, noteId, { ...req(), listId: l.id }))).toBe(404); } finally { await db.workList.delete({ where: { id: l.id } }); }
    expect(await nEfeitos()).toEqual({ tasks: 0, links: 0, audit: 0 });
  });
  it('corpo adulterado e versão futura não são consumidos', async () => {
    await db.contextItemVersion.update({ where: { id: versionId }, data: { body: 'Adulterado' } });
    expect(await status(svc.criar(org, pessoa, noteId, req()))).toBe(409);
    await db.contextItemVersion.update({ where: { id: versionId }, data: { body: 'Material sintético original' } });
    const v = await db.contextItemVersion.create({ data: { orgId: org, itemId: noteId, versao: 2, mudanca: 'alteracao', kind: 'nota', title: 'Futura', body: 'Futura', sourceType: 'operador', contentHash: hashDoCorpo('Futura'), semEventoPorque: 'migracao' } });
    expect(await status(svc.criar(org, pessoa, noteId, { ...req(), versionId: v.id, contentHash: v.contentHash }))).toBe(409);
    expect(await nEfeitos()).toEqual({ tasks: 0, links: 0, audit: 0 });
  });
  it('falha de auditoria reverte tarefa e vínculo', async () => {
    const audit = new AuditService(db as unknown as PrismaService); vi.spyOn(audit,'log').mockRejectedValue(new Error('Falha QA de audit'));
    const fail = new ContextoTrabalhoService(db as unknown as PrismaService, audit);
    await expect(fail.criar(org, pessoa, noteId, req())).rejects.toThrow('Falha QA de audit');
    expect(await nEfeitos()).toEqual({ tasks: 0, links: 0, audit: 0 });
  });
  it('arquivamento preserva versão consumida e recusa uso novo', async () => {
    const p = req(), r = await svc.criar(org, pessoa, noteId, p);
    await contexto(() => memoria.arquivar(org, noteId, 'QA'));
    expect((await svc.fontes(org,pessoa,r.taskId)).fontes[0]).toMatchObject({ arquivada: true, versionId, versao: 1 });
    expect((await svc.criar(org,pessoa,noteId,p)).taskId).toBe(r.taskId);
    expect(await status(svc.criar(org,pessoa,noteId,{ ...req(), expectedItemVersion:2 }))).toBe(409);
  });
  it('o banco recusa concessão cruzada e alteração do elo persistido', async () => {
    await expect(db.contextItem.update({ where: { id: noteId }, data: { leitores: [estrangeira] } })).rejects.toThrow();
    const r = await svc.criar(org, pessoa, noteId, req());
    await expect(db.workContextSource.update({ where: { id:r.fonte.id }, data: { versao:9 } })).rejects.toThrow();
    expect((await svc.fontes(org,pessoa,r.taskId)).fontes[0].versao).toBe(1);
  });
});
