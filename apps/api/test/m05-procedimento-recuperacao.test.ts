import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { AuditService } from '../src/audit/audit.service';
import { ProcedimentoDoAgenteService } from '../src/agents/procedimento-do-agente.service';
import { ContextoTrabalhoService } from '../src/memory/contexto-trabalho.service';
import { construirFonteAutorizada } from '../src/memory/fonte-autorizada';
import { hashDoCorpo } from '../src/memory/procedencia';
const url = process.env.TEST_DATABASE_URL ?? '';
if (new URL(url).hostname !== '127.0.0.1' || new URL(url).pathname !== '/rootos_dia_m05_test_20261008') throw new Error('M05 author destination required');
const db = new PrismaClient(), writer = new PrismaClient(), modelId = 'm05-simulated-model';
const access = ['obsidian.ver', 'tarefas.ver', 'tarefas.editar', 'mcp.ver', 'mcp.executar', 'admin.usuarios', 'automacoes.executar'];
const procedure = { proposito: 'M05 source synthesis', gatilho: 'Explicit request by allowed person', passos: ['Read the selected version', 'Summarize its source'], definicaoDePronto: 'Recorded source summary' };
async function status(p: Promise<unknown>) { try { await p; return 200; } catch (e) { const code = (e as { getStatus?: () => number }).getStatus?.(); if (!code) throw e; return code; } }
function barrierAt(table: string, method: string, predicate: (input: any) => boolean, action: () => Promise<unknown>) {
  let used = false;
  return new Proxy(db, { get(target, key) {
    const value = Reflect.get(target, key);
    if (key === table) return new Proxy(value, { get(delegate, methodKey) {
      const call = Reflect.get(delegate, methodKey);
      if (methodKey !== method) return typeof call === 'function' ? call.bind(delegate) : call;
      return async (input: any) => { const result = await call.call(delegate, input); if (!used && predicate(input)) { used = true; await action(); } return result; };
    } });
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}
async function fixture() {
  const orgId = randomUUID(), person = randomUUID(), second = randomUUID();
  await db.org.create({ data: { id: orgId, name: 'M05 own recovery fixture', slug: 'm05-' + orgId } });
  const permissions = await Promise.all(access.map((key) => db.permission.upsert({ where: { key }, create: { key }, update: {} })));
  const role = await db.role.create({ data: { orgId, key: 'm05-all', name: 'M05 own role', permissions: { connect: permissions.map((p) => ({ id: p.id })) } } });
  for (const id of [person, second]) await db.user.create({ data: { id, orgId, name: 'M05 synthetic person', email: id + '@qa.invalid', passwordHash: 'no-login', roles: { connect: { id: role.id } } } });
  const body = 'M05 historical synthetic source: eight green crates.', body2 = 'M05 current synthetic source: nine green crates.';
  const item = await db.contextItem.create({ data: { orgId, chave: 'm05-manual-' + randomUUID(), title: 'M05 current source', body: body2, contentHash: hashDoCorpo(body2), sourceType: 'operador', sourceRef: 'Own synthetic note', versao: 2, acessoRestrito: true, leitores: [person, second] } });
  const v = await db.contextItemVersion.create({ data: { orgId, itemId: item.id, versao: 1, mudanca: 'criacao', kind: 'nota', title: 'M05 historical source', body, contentHash: hashDoCorpo(body), sourceType: item.sourceType, sourceRef: item.sourceRef, semEventoPorque: 'migracao' } });
  await db.contextItemVersion.create({ data: { orgId, itemId: item.id, versao: 2, mudanca: 'alteracao', kind: 'nota', title: item.title, body: item.body, contentHash: item.contentHash, sourceType: item.sourceType, sourceRef: item.sourceRef, semEventoPorque: 'migracao' } });
  const list = await db.workList.create({ data: { orgId, name: 'M05 own list', statuses: { create: { orgId, name: 'Open' } } } });
  const model = { estado: vi.fn().mockResolvedValue({ disponivel: true, provider: 'llama.cpp-local', modelo: modelId, motivo: null }),
    resumir: vi.fn().mockResolvedValue({ texto: 'M05 synthesized eight green crates from historical v1.', modelo: modelId, tokensIn: 12, tokensOut: 9 }) };
  const service = new ProcedimentoDoAgenteService(db as never, new AuditService(db as never), model as never);
  const create = { requestId: randomUUID(), nome: 'M05 local operator', missao: 'Summarize the exact version', pilar: 'Operação', donoId: person, modelo: modelId, procedimento: procedure };
  const agent = await service.criar(orgId, person, create);
  await db.agent.update({ where: { id: agent.id }, data: { estado: 'ativo', ativo: true } });
  const input = { requestId: randomUUID(), pedido: 'Summarize the historical version', itemId: item.id, versionId: v.id, contentHash: v.contentHash, expectedItemVersion: 2 };
  const taskInput = { requestId: randomUUID(), versionId: v.id, contentHash: v.contentHash, expectedItemVersion: 2, listId: list.id, title: 'M05 own task' };
  const work = new ContextoTrabalhoService(db as never, new AuditService(db as never));
  return { orgId, person, second, role, item, v, agent, create, model, service, input, taskInput, work };
}
describe('M05 own PG recovery and exact sources', () => {
  beforeAll(async () => { await db.$connect(); await writer.$connect(); });
  afterAll(async () => { await db.$disconnect(); await writer.$disconnect(); });
  it('lost creation response is recovered without POST, model or extra agent', async () => {
    const f = await fixture(), calls = f.model.estado.mock.calls.length;
    const recovered = await (f.service as any).criacaoPorPedido(f.orgId, f.person, f.create.requestId);
    expect(recovered).toMatchObject({ id: f.agent.id, slug: f.agent.slug, repetido: true, escopo: { orgId: f.orgId, userId: f.person, agentId: f.agent.id, agentSlug: f.agent.slug } });
    expect(f.model.estado.mock.calls.length).toBe(calls); expect(f.model.resumir).not.toHaveBeenCalled();
    expect(await db.agent.count({ where: { orgId: f.orgId } })).toBe(1);
    expect(await db.auditLog.count({ where: { orgId: f.orgId, action: 'agent.procedimento.create' } })).toBe(1);
  });
  it('historical procedure source is pinned and requestId recovery has no extra call', async () => {
    const f = await fixture(), executed = await f.service.executar(f.orgId, f.person, f.agent.slug, f.input);
    const recovered = await f.service.porPedido(f.orgId, f.person, f.agent.slug, f.input.requestId);
    expect(recovered.id).toBe(executed.id); expect(recovered.retratoFonte.body).toBe(f.v.body);
    expect(recovered.retratoFonte.versao.versionId).toBe(f.v.id); expect(recovered.retratoFonte.versaoAtual).toBe(2);
    expect(recovered.retratoFonte.citacao.contentHash).toBe(f.v.contentHash);
    expect(recovered.escopo).toEqual({ orgId: f.orgId, userId: f.person, agentId: f.agent.id, agentSlug: f.agent.slug });
    expect(recovered.capacidadesExecutor.capacidades.ferramentasExternas).toBe(false);
    expect(recovered.capacidadesExecutor.capacidades.cancelarInferencia).toBe(false);
    expect(f.model.resumir).toHaveBeenCalledTimes(1); expect(await db.session.count({ where: { orgId: f.orgId } })).toBe(1);
    expect((await f.service.executar(f.orgId, f.person, f.agent.slug, f.input)).id).toBe(executed.id); expect(f.model.resumir).toHaveBeenCalledTimes(1);
    expect(await status(f.service.executar(f.orgId, f.person, f.agent.slug, { ...f.input, pedido: 'Different intent' }))).toBe(409);
  });
  it('creation result needs exact creator, company and audit request', async () => {
    const f = await fixture(), other = await fixture();
    expect(await status(f.service.criacaoPorPedido(f.orgId, f.second, f.create.requestId))).toBe(404);
    expect(await status(f.service.criacaoPorPedido(other.orgId, other.person, f.create.requestId))).toBe(404);
    expect(await status(f.service.criacaoPorPedido(f.orgId, f.person, randomUUID()))).toBe(404);
    await writer.user.update({ where: { id: f.person }, data: { isActive: false } });
    expect(await status(f.service.criacaoPorPedido(f.orgId, f.person, f.create.requestId))).toBe(403);
    expect(f.model.resumir).not.toHaveBeenCalled();
  });
  it('creation recovery denies revocation committed during audit I/O', async () => {
    const f = await fixture(), facade = barrierAt('auditLog', 'findMany', () => true, () => writer.user.update({ where: { id: f.person }, data: { isActive: false } }));
    const service = new ProcedimentoDoAgenteService(facade as never, new AuditService(db as never), f.model as never);
    expect(await status(service.criacaoPorPedido(f.orgId, f.person, f.create.requestId))).toBe(403);
  });
  it('configuration is scoped and denies revocation during model health', async () => {
    const f = await fixture(); expect((await f.service.configuracao(f.orgId, f.person)).escopo).toEqual({ orgId: f.orgId, userId: f.person });
    f.model.estado.mockImplementation(async () => { await writer.user.update({ where: { id: f.person }, data: { isActive: false } }); return { disponivel: true, provider: 'llama.cpp-local', modelo: modelId, motivo: null }; });
    expect(await status(f.service.configuracao(f.orgId, f.person))).toBe(403);
  });
  it('procedure recovery for another person, agent, org or absent receipt has no effect', async () => {
    const f = await fixture(); await f.service.executar(f.orgId, f.person, f.agent.slug, f.input);
    expect(await status(f.service.porPedido(f.orgId, f.second, f.agent.slug, f.input.requestId))).toBe(404);
    expect(await status(f.service.porPedido(f.orgId, f.person, 'unavailable-agent', f.input.requestId))).toBe(404);
    expect(await status(f.service.porPedido(randomUUID(), f.person, f.agent.slug, f.input.requestId))).toBe(403);
    expect(await status(f.service.porPedido(f.orgId, f.person, f.agent.slug, randomUUID()))).toBe(404);
    expect(f.model.resumir).toHaveBeenCalledTimes(1); expect(await db.session.count({ where: { orgId: f.orgId } })).toBe(1);
  });
  it('task result recovery reads original link and has no extra task or audit', async () => {
    const f = await fixture(), created = await f.work.criar(f.orgId, f.person, f.item.id, f.taskInput);
    await db.workTask.update({ where: { id: created.taskId }, data: { title: 'Changed title after creation' } });
    const recovered = await f.work.porPedido(f.orgId, f.person, f.item.id, f.taskInput.requestId);
    expect(recovered.taskId).toBe(created.taskId); expect(recovered.replayed).toBe(true);
    expect(recovered.fonte.retratoFonte?.body).toBe(f.v.body); expect(recovered.fonte.versionId).toBe(f.v.id);
    expect(await db.workTask.count({ where: { orgId: f.orgId } })).toBe(1);
    expect(await db.auditLog.count({ where: { orgId: f.orgId, action: 'work.task.create.contexto' } })).toBe(1);
    expect((await f.work.criar(f.orgId, f.person, f.item.id, f.taskInput)).taskId).toBe(created.taskId);
    expect(await status(f.work.criar(f.orgId, f.person, f.item.id, { ...f.taskInput, title: 'Changed intent' }))).toBe(409);
  });
  it('task recovery denies wrong person, item and absent receipt', async () => {
    const f = await fixture(); await f.work.criar(f.orgId, f.person, f.item.id, f.taskInput);
    expect(await status(f.work.porPedido(f.orgId, f.second, f.item.id, f.taskInput.requestId))).toBe(404);
    expect(await status(f.work.porPedido(f.orgId, f.person, randomUUID(), f.taskInput.requestId))).toBe(404);
    expect(await status(f.work.porPedido(f.orgId, f.person, f.item.id, randomUUID()))).toBe(404);
    expect(await db.workTask.count({ where: { orgId: f.orgId } })).toBe(1);
  });
  it('current ACL and inactivated person refuse recovery', async () => {
    const f = await fixture(); await f.service.executar(f.orgId, f.person, f.agent.slug, f.input); await f.work.criar(f.orgId, f.person, f.item.id, f.taskInput);
    await writer.contextItem.update({ where: { id: f.item.id }, data: { leitores: [] } });
    expect(await status(f.service.porPedido(f.orgId, f.person, f.agent.slug, f.input.requestId))).toBe(404);
    expect(await status(f.work.porPedido(f.orgId, f.person, f.item.id, f.taskInput.requestId))).toBe(404);
    await writer.user.update({ where: { id: f.person }, data: { isActive: false } });
    expect(await status(f.service.porPedido(f.orgId, f.person, f.agent.slug, f.input.requestId))).toBe(403);
    expect(await status(f.work.porPedido(f.orgId, f.person, f.item.id, f.taskInput.requestId))).toBe(403);
  });
  it('paused agent and unavailable model advertise refusal and never send a new call', async () => {
    const f = await fixture(); await writer.agent.update({ where: { id: f.agent.id }, data: { estado: 'pausado', ativo: false } });
    const sources = await f.service.fontes(f.orgId, f.person, f.agent.slug);
    expect(sources.capacidadesExecutor.novasExecucoesPermitidas).toBe(false);
    expect(sources.items[0].versoes[0].retratoFonte.body).toBeNull();
    expect((await f.service.executar(f.orgId, f.person, f.agent.slug, f.input)).status).toBe('recusada');
    expect(f.model.resumir).not.toHaveBeenCalled();
    await writer.agent.update({ where: { id: f.agent.id }, data: { estado: 'ativo', ativo: true } });
    f.model.estado.mockResolvedValue({ disponivel: false, provider: 'llama.cpp-local', modelo: null, motivo: 'Modelo local não configurado.' });
    expect((await f.service.fontes(f.orgId, f.person, f.agent.slug)).capacidadesExecutor.novasExecucoesPermitidas).toBe(false);
    expect((await f.service.executar(f.orgId, f.person, f.agent.slug, { ...f.input, requestId: randomUUID() })).status).toBe('recusada');
    expect(f.model.resumir).not.toHaveBeenCalled();
  });
  it('procedure list final source I/O does not outlive active-person access', async () => {
    const f = await fixture(), facade = barrierAt('contextItem', 'findMany', (p) => !!p.where.id?.in, () => writer.user.update({ where: { id: f.person }, data: { isActive: false } }));
    const service = new ProcedimentoDoAgenteService(facade as never, new AuditService(db as never), f.model as never);
    expect(await status(service.fontes(f.orgId, f.person, f.agent.slug))).toBe(403);
  });
  it('task recovery final ACL I/O does not outlive active-person access', async () => {
    const f = await fixture(); await f.work.criar(f.orgId, f.person, f.item.id, f.taskInput);
    const facade = barrierAt('contextItem', 'findFirst', () => true, () => writer.user.update({ where: { id: f.person }, data: { isActive: false } }));
    const service = new ContextoTrabalhoService(facade as never, new AuditService(db as never));
    expect(await status(service.porPedido(f.orgId, f.person, f.item.id, f.taskInput.requestId))).toBe(403);
  });
  it('task source list final ACL I/O does not outlive active-person access', async () => {
    const f = await fixture(), task = await f.work.criar(f.orgId, f.person, f.item.id, f.taskInput);
    const facade = barrierAt('contextItem', 'findFirst', (p) => p.select?.id === true, () => writer.user.update({ where: { id: f.person }, data: { isActive: false } }));
    const service = new ContextoTrabalhoService(facade as never, new AuditService(db as never));
    expect(await status(service.fontes(f.orgId, f.person, task.taskId))).toBe(403);
  });
  it.each([
    ['task recovery', 2], ['task source list', 3], ['procedure source list', 3], ['procedure detail', 4],
  ] as const)('last person I/O cannot retain revoked ACL: %s', async (route, lastUserCall) => {
    const f = await fixture();
    const task = await f.work.criar(f.orgId, f.person, f.item.id, f.taskInput);
    const execution = await f.service.executar(f.orgId, f.person, f.agent.slug, f.input);
    let calls = 0, committed = false;
    const facade = barrierAt('user', 'findFirst', (p) => !!p.select?.roles && ++calls === lastUserCall,
      async () => { await writer.contextItem.update({ where: { id: f.item.id }, data: { leitores: [] } }); committed = true; });
    const work = new ContextoTrabalhoService(facade as never, new AuditService(db as never));
    const procedure = new ProcedimentoDoAgenteService(facade as never, new AuditService(db as never), f.model as never);
    if (route === 'procedure source list') {
      const result = await procedure.fontes(f.orgId, f.person, f.agent.slug);
      expect(committed).toBe(true); expect(result.items).toEqual([]);
    } else {
      const pending = route === 'task recovery' ? work.porPedido(f.orgId, f.person, f.item.id, f.taskInput.requestId)
        : route === 'task source list' ? work.fontes(f.orgId, f.person, task.taskId)
        : procedure.detalhe(f.orgId, f.person, f.agent.slug, execution.id);
      const result = await status(pending);
      expect(committed).toBe(true); expect(result).toBe(404);
    }
    expect(await writer.contextItem.findUnique({ where: { id: f.item.id }, select: { leitores: true } })).toEqual({ leitores: [] });
  });
  it('last person I/O before model cannot retain revoked ACL', async () => {
    const f = await fixture(); let calls = 0, committed = false;
    const facade = barrierAt('user', 'findFirst', (p) => !!p.select?.roles && ++calls === 6,
      async () => { await writer.contextItem.update({ where: { id: f.item.id }, data: { leitores: [] } }); committed = true; });
    const service = new ProcedimentoDoAgenteService(facade as never, new AuditService(db as never), f.model as never);
    await status(service.executar(f.orgId, f.person, f.agent.slug, f.input));
    expect(committed).toBe(true); expect(f.model.resumir).not.toHaveBeenCalled();
    expect(await writer.contextItem.findUnique({ where: { id: f.item.id }, select: { leitores: true } })).toEqual({ leitores: [] });
  });
  it('last person I/O before model cannot retain a paused agent', async () => {
    const f = await fixture(); let calls = 0, committed = false;
    const facade = barrierAt('user', 'findFirst', (p) => !!p.select?.roles && ++calls === 6,
      async () => { await writer.agent.update({ where: { id: f.agent.id }, data: { estado: 'pausado', ativo: false } }); committed = true; });
    const service = new ProcedimentoDoAgenteService(facade as never, new AuditService(db as never), f.model as never);
    await service.executar(f.orgId, f.person, f.agent.slug, f.input);
    expect(committed).toBe(true); expect(f.model.resumir).not.toHaveBeenCalled();
    expect(await writer.agent.findUnique({ where: { id: f.agent.id }, select: { estado: true, ativo: true } })).toEqual({ estado: 'pausado', ativo: false });
  });
  it('pause during model retains tokens and withholds the output', async () => {
    const f = await fixture(); f.model.resumir.mockImplementation(async () => { await writer.agent.update({ where: { id: f.agent.id }, data: { estado: 'pausado', ativo: false } }); return { texto: 'Private output withheld', modelo: modelId, tokensIn: 12, tokensOut: 9 }; });
    const result = await f.service.executar(f.orgId, f.person, f.agent.slug, f.input);
    expect(result.status).toBe('recusada'); expect(result.resposta).toBeNull(); expect(result.consumo).toMatchObject({ tokensIn: 12, tokensOut: 9 });
    expect(f.model.resumir).toHaveBeenCalledTimes(1);
    expect((await f.service.porPedido(f.orgId, f.person, f.agent.slug, f.input.requestId)).id).toBe(result.id); expect(f.model.resumir).toHaveBeenCalledTimes(1);
  });
  it('revoked source during model health never reaches a synthesis call', async () => {
    const f = await fixture(); f.model.estado.mockImplementation(async () => { await writer.contextItem.update({ where: { id: f.item.id }, data: { leitores: [] } }); return { disponivel: true, provider: 'llama.cpp-local', modelo: modelId, motivo: null }; });
    expect(await status(f.service.executar(f.orgId, f.person, f.agent.slug, f.input))).toBe(404); expect(f.model.resumir).not.toHaveBeenCalled();
  });
  it('body corruption and future version are refused before new effect', async () => {
    const f = await fixture(), futureBody = 'Future synthetic v3';
    const future = await writer.contextItemVersion.create({ data: { orgId: f.orgId, itemId: f.item.id, versao: 3, mudanca: 'alteracao', kind: 'nota', title: 'Future synthetic', body: futureBody,
      contentHash: hashDoCorpo(futureBody), sourceType: f.item.sourceType, sourceRef: f.item.sourceRef, semEventoPorque: 'migracao' } });
    expect(await status(f.service.executar(f.orgId, f.person, f.agent.slug, { ...f.input, versionId: future.id, contentHash: future.contentHash }))).toBe(409);
    expect(await status(f.work.criar(f.orgId, f.person, f.item.id, { ...f.taskInput, versionId: future.id, contentHash: future.contentHash }))).toBe(409);
    await writer.contextItemVersion.update({ where: { id: f.v.id }, data: { body: 'Body tampered without its hash' } });
    expect(await status(f.service.executar(f.orgId, f.person, f.agent.slug, f.input))).toBe(409);
    expect(await status(f.work.criar(f.orgId, f.person, f.item.id, f.taskInput))).toBe(409);
    expect(await db.session.count({ where: { orgId: f.orgId } })).toBe(0); expect(await db.workTask.count({ where: { orgId: f.orgId } })).toBe(0);
    expect(f.model.resumir).not.toHaveBeenCalled();
  });
  it.each([
    ['detail', 'itemId'], ['detail', 'versionId'], ['detail', 'versao'], ['detail', 'contentHash'], ['detail', 'title'],
    ['request', 'itemId'], ['request', 'versionId'], ['request', 'versao'], ['request', 'contentHash'], ['request', 'title'],
  ] as const)('procedure stored source integrity: %s/%s', async (route, field) => {
    const f = await fixture(), execution = await f.service.executar(f.orgId, f.person, f.agent.slug, f.input);
    const step = await db.sessionStep.findUniqueOrThrow({ where: { sessionId_ordem: { sessionId: execution.id, ordem: 1 } } });
    const original = step.payload as any;
    const changed = field === 'versao' ? 99 : field === 'contentHash' ? 'f'.repeat(64)
      : field === 'title' ? 'Synthetic source title changed only in stored record' : randomUUID();
    await writer.sessionStep.update({ where: { id: step.id }, data: { payload: { ...original, fonte: { ...original.fonte, [field]: changed } } } });
    const committed = await writer.sessionStep.findUniqueOrThrow({ where: { id: step.id }, select: { payload: true } });
    expect((committed.payload as any).fonte[field]).toBe(changed);
    const pending = route === 'detail' ? f.service.detalhe(f.orgId, f.person, f.agent.slug, execution.id)
      : f.service.porPedido(f.orgId, f.person, f.agent.slug, f.input.requestId);
    expect(await status(pending)).toBe(409);
    expect(f.model.resumir).toHaveBeenCalledTimes(1); expect(await db.session.count({ where: { orgId: f.orgId } })).toBe(1);
  });
  it('helper never labels manual as Vault or fabricates ingestion receipts', async () => {
    const f = await fixture(), receipt = construirFonteAutorizada({ item: f.item, versaoSelecionada: f.v, incluirCorpo: true, acessoVerificadoEm: new Date(), novoUsoPermitido: true });
    expect(receipt.colecao).toBe('manual_local'); expect(receipt.identidadeCanonica.documentId).toBe(f.item.id);
    expect(receipt.estado).toEqual({ coleta: 'nao_verificada', indexacao: 'nao_verificada', projecao: 'nao_verificada', ultimoReciboId: null });
    expect(receipt.body).toBe(f.v.body); expect(receipt.title).toBe(f.v.title); expect(receipt.versaoAtual).toBe(2);
  });
});
