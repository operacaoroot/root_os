import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ModeloLocalService } from '../src/agents/modelo-local.service';
import { CriarProcedimentoSchema, ExecutarProcedimentoSchema, ProcedimentoDoAgenteService } from '../src/agents/procedimento-do-agente.service';
import { hashDoCorpo } from '../src/memory/procedencia';
import { SessionService } from '../src/agents/session.service';
import { ModeloProcedimentoDuble, montarProcedimento, executarProcedimento, depoisDeListarFontes } from './procedimento-local-dubles';
import { SessaoHistoricaConsultaSchema } from '@mktos/shared';
import { exigirBancoDescartavel } from './banco-de-teste';

const savedUrl = process.env.ROOTOS_LOCAL_MODEL_URL;
const modelId = 'rootos-qa-qwen2.5-0.5b-q4_k_m';
const procedure = { proposito: 'Preparar um resumo da fonte de QA', gatilho: 'Quando a pessoa autorizada iniciar um pedido',
  passos: ['Ler a versão de QA escolhida', 'Preparar um resumo com a versão identificada'], definicaoDePronto: 'Resumo encontrado na execução, com fonte e versão identificadas' };
const id = () => randomUUID();
const createInput = (owner: string, model: string | null = modelId) => ({ requestId: id(), nome: 'Agente QA local', missao: procedure.proposito,
  pilar: 'Operação', donoId: owner, modelo: model, procedimento: procedure });
async function status(p: Promise<unknown>) { try { await p; return 200; } catch (e) { if (e instanceof HttpException) return e.getStatus(); throw e; } }

describe('transporte do modelo local', () => {
  afterAll(() => { if (savedUrl === undefined) delete process.env.ROOTOS_LOCAL_MODEL_URL; else process.env.ROOTOS_LOCAL_MODEL_URL = savedUrl; vi.unstubAllGlobals(); });
  it('sem endpoint, não tenta inferência', async () => {
    delete process.env.ROOTOS_LOCAL_MODEL_URL; const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect((await new ModeloLocalService().estado()).disponivel).toBe(false); expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['https://provider.example', 'http://127.0.0.1:4272/?key=abc', 'http://user:secret@127.0.0.1:4272', 'http://127.0.0.1:4272/v1', 'http://remote.example:4272'])('recusa endpoint fora do contrato: %s', async (url) => {
    process.env.ROOTOS_LOCAL_MODEL_URL = url; const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect((await new ModeloLocalService().estado()).disponivel).toBe(false); expect(fetch).not.toHaveBeenCalled();
  });
  it('observa o ID do servidor, sem usar catálogo remoto', async () => {
    process.env.ROOTOS_LOCAL_MODEL_URL = 'http://127.0.0.1:4272'; const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ id: modelId }] }) }); vi.stubGlobal('fetch', fetch);
    expect(await new ModeloLocalService().estado()).toMatchObject({ disponivel: true, modelo: modelId });
    expect(fetch.mock.calls[0][1].redirect).toBe('error');
  });
  it('tool_calls não são executadas e modelo diferente é recusado', async () => {
    process.env.ROOTOS_LOCAL_MODEL_URL = 'http://127.0.0.1:4272'; const adapter = new ModeloLocalService();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ model: modelId, choices: [{ message: { tool_calls: [{}] } }] }) }));
    await expect(adapter.resumir(modelId, 'system', 'pedido')).rejects.toThrow('Ferramenta não permitida');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ model: 'outro', choices: [{ message: { content: 'texto' } }] }) }));
    await expect(adapter.resumir(modelId, 'system', 'pedido')).rejects.toThrow('modelo servido difere');
  });
  it('schemas recusam capacidade/empresa/estado contrabandeados', () => {
    for (const extra of [{ capacidades: ['financeiro.pagar'] }, { estado: 'ativo' }, { orgId: id() }]) expect(CriarProcedimentoSchema.safeParse({ ...createInput(id()), ...extra }).success).toBe(false);
    expect(ExecutarProcedimentoSchema.safeParse({ requestId: id(), pedido: 'resuma', itemId: id(), versionId: id(), contentHash: 'a'.repeat(64), expectedItemVersion: 1, ferramentas: ['enviar'] }).success).toBe(false);
  });
});

const url = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(url ?? '', 'ESCREVE fixtures próprias de procedimento local');
const org = id(), otherOrg = id(), person = id(), second = id(), outsider = id();
describe.skipIf(!url)('procedimento local — Postgres QA com fixtures próprias', () => {
  let db: PrismaClient, service: ProcedimentoDoAgenteService, roleId: string, itemId: string, versionId: string, hash: string;
  let model: ModeloProcedimentoDuble;
  const input = () => ({ requestId: id(), pedido: 'Resuma a fonte em uma frase', itemId, versionId, contentHash: hash, expectedItemVersion: 1, expectedSopVersion: 1 });
  async function makeActive(owner = person) { const a = await service.criar(org, person, createInput(owner)); await db.agent.update({ where: { id: a.id }, data: { estado: 'ativo', ativo: true } }); return a; }
  async function clean() { await db.sessionStep.deleteMany({ where: { orgId: org } }); await db.session.deleteMany({ where: { orgId: org } }); await db.sop.deleteMany({ where: { orgId: org } }); await db.agent.deleteMany({ where: { orgId: org } }); await db.auditLog.deleteMany({ where: { orgId: org } }); await db.contextItemVersion.deleteMany({ where: { orgId: org } }); await db.contextItem.deleteMany({ where: { orgId: org } }); }
  beforeAll(async () => {
    vi.unstubAllGlobals(); db = new PrismaClient({ datasources: { db: { url } } });
    for (const orgId of [org, otherOrg]) await db.org.create({ data: { id: orgId, name: 'QA procedimento isolado', slug: 'qa-proc-' + orgId } });
    const permissions = await Promise.all(['mcp.ver', 'mcp.executar', 'admin.usuarios', 'automacoes.executar', 'obsidian.ver'].map((key) => db.permission.upsert({ where: { key }, create: { key }, update: {} })));
    roleId = (await db.role.create({ data: { orgId: org, key: 'qa-proc', name: 'QA procedimento', permissions: { connect: permissions.map((p) => ({ id: p.id })) } } })).id;
    for (const personId of [person, second]) await db.user.create({ data: { id: personId, orgId: org, name: 'Pessoa QA procedimento', email: personId + '@qa.invalid', passwordHash: 'sem-login', roles: { connect: { id: roleId } } } });
    await db.user.create({ data: { id: outsider, orgId: otherOrg, name: 'Pessoa vizinha QA', email: outsider + '@qa.invalid', passwordHash: 'sem-login' } });
  });
  beforeEach(async () => {
    vi.unstubAllGlobals(); await clean(); await db.user.updateMany({ where: { id: { in: [person, second] } }, data: { isActive: true } });
    await db.role.update({ where: { id: roleId }, data: { permissions: { connect: [{ key: 'obsidian.ver' }, { key: 'mcp.ver' }, { key: 'mcp.executar' }] } } });
    const body = 'QA: Ana prepara o relatório semanal. Bruno confere a entrega na sexta-feira.'; hash = hashDoCorpo(body);
    const item = await db.contextItem.create({ data: { orgId: org, chave: 'qa:agente:' + id(), title: 'Fonte privada QA', body, sourceType: 'operador', sourceRef: 'Exercício local', contentHash: hash, acessoRestrito: true, leitores: [person, second] } }); itemId = item.id;
    versionId = (await db.contextItemVersion.create({ data: { orgId: org, itemId, versao: 1, mudanca: 'criacao', kind: 'nota', title: item.title, body, sourceType: 'operador', sourceRef: item.sourceRef, contentHash: hash, semEventoPorque: 'migracao' } })).id;
    model = new ModeloProcedimentoDuble();
    model.estado.mockResolvedValue({ disponivel: true, provider: 'llama.cpp-local', modelo: modelId, motivo: null });
    model.resumir.mockResolvedValue({ texto: 'Síntese controlada para teste de fronteira', modelo: modelId, tokensIn: 10, tokensOut: 8, finishReason: 'stop' });
    service = montarProcedimento(db, model);
  });
  afterAll(async () => {
    if (!db) return;
    try {
      await clean(); await db.user.deleteMany({ where: { id: { in: [person, second, outsider] } } });
      await db.role.deleteMany({ where: { orgId: org } }); await db.org.deleteMany({ where: { id: { in: [org, otherOrg] } } });
    } finally {
      await db.$disconnect(); if (savedUrl === undefined) delete process.env.ROOTOS_LOCAL_MODEL_URL; else process.env.ROOTOS_LOCAL_MODEL_URL = savedUrl;
    }
  });
  it('cria planejado e reenvio perdido não duplica agente', async () => {
    const p = createInput(person); const [a, b] = await Promise.all([service.criar(org, person, p), service.criar(org, person, p)]);
    expect(a.id).toBe(b.id); expect(await db.agent.count({ where: { orgId: org } })).toBe(1);
    const agent = await db.agent.findUniqueOrThrow({ where: { id: a.id } }); expect(agent).toMatchObject({ estado: 'planejado', ativo: false, cron: null, modelo: modelId, capacidades: ['contexto.memoria.buscar'] });
    model.estado.mockResolvedValue({ disponivel: false, provider: 'llama.cpp-local', modelo: null, motivo: 'Modelo indisponível.' }); expect((await service.criar(org, person, p)).id).toBe(a.id);
    expect(await status(service.criar(org, person, { ...p, nome: 'Outro nome' }))).toBe(409); expect(await status(service.criar(org, second, p))).toBe(409);
  });
  it('nega dono externo/inativo e permissão atual revogada', async () => {
    expect(await status(service.criar(org, person, createInput(outsider)))).toBe(400);
    await db.user.update({ where: { id: second }, data: { isActive: false } }); expect(await status(service.criar(org, person, createInput(second)))).toBe(400);
    await db.role.update({ where: { id: roleId }, data: { permissions: { disconnect: { key: 'mcp.executar' } } } }); const a = await makeActive(); expect(await status(executarProcedimento(service, org, person, a.slug, input()))).toBe(403); expect(await db.session.count({ where: { orgId: org } })).toBe(0);
  });
  it('sem modelo registra recusa e reenvio devolve a mesma sessão', async () => {
    const a = await makeActive(), p = input(); model.estado.mockResolvedValue({ disponivel: false, provider: 'llama.cpp-local', modelo: null, motivo: 'Servidor do modelo local indisponível.' });
    const r = await executarProcedimento(service, org, person, a.slug, p); expect(r.status).toBe('recusada'); expect(r.modeloUsado).toBeNull(); expect(r.resposta).toBeNull(); expect(model.resumir).not.toHaveBeenCalled();
    expect((await executarProcedimento(service, org, person, a.slug, p)).id).toBe(r.id); expect(await db.session.count({ where: { orgId: org } })).toBe(1);
  });
  it('pausado recusa antes do modelo, sem novo efeito', async () => {
    const a = await makeActive(); await db.agent.update({ where: { id: a.id }, data: { estado: 'pausado', ativo: false } });
    expect((await executarProcedimento(service, org, person, a.slug, input())).status).toBe('recusada'); expect(model.resumir).not.toHaveBeenCalled();
  });
  it('simultâneos geram uma chamada; pedido, ator ou agente diferente não reutiliza a identidade', async () => {
    const a = await makeActive(), p = input(); const [x, y] = await Promise.all([executarProcedimento(service, org, person, a.slug, p), executarProcedimento(service, org, person, a.slug, p)]);
    expect(x.id).toBe(y.id); expect(model.resumir).toHaveBeenCalledTimes(1); const b = await makeActive();
    for (const call of [() => executarProcedimento(service, org, person, a.slug, { ...p, pedido: 'outro' }), () => executarProcedimento(service, org, second, a.slug, p), () => executarProcedimento(service, org, person, b.slug, p)]) expect(await status(call())).toBe(409);
  });
  it('versão histórica escolhida permanece depois de atualização e replay após arquivamento', async () => {
    const a = await makeActive(), p = input(); const r = await executarProcedimento(service, org, person, a.slug, p);
    await db.contextItem.update({ where: { id: itemId }, data: { versao: 2, body: 'QA versão seguinte', contentHash: hashDoCorpo('QA versão seguinte') } });
    await db.contextItemVersion.create({ data: { orgId: org, itemId, versao: 2, mudanca: 'alteracao', kind: 'nota', title: 'Fonte privada QA', body: 'QA versão seguinte', sourceType: 'operador', sourceRef: 'Exercício local', contentHash: hashDoCorpo('QA versão seguinte'), semEventoPorque: 'migracao' } });
    expect((await service.detalhe(org, person, a.slug, r.id)).fonte.versionId).toBe(versionId);
    expect((await executarProcedimento(service, org, person, a.slug, { ...p, requestId: id(), expectedItemVersion: 2 })).fonte.versionId).toBe(versionId);
    await db.contextItem.update({ where: { id: itemId }, data: { arquivadoEm: new Date() } }); expect((await executarProcedimento(service, org, person, a.slug, p)).id).toBe(r.id);
    expect(await status(executarProcedimento(service, org, person, a.slug, { ...p, requestId: id(), expectedItemVersion: 2 }))).toBe(404);
  });
  it('hash adulterado, origem alterada e versão corrente obsoleta recusam sem sessão', async () => {
    const a = await makeActive(), p = input(); expect(await status(executarProcedimento(service, org, person, a.slug, { ...p, contentHash: 'a'.repeat(64) }))).toBe(409);
    await db.contextItem.update({ where: { id: itemId }, data: { sourceRef: 'outra origem' } }); expect(await status(executarProcedimento(service, org, person, a.slug, p))).toBe(409);
    await db.contextItem.update({ where: { id: itemId }, data: { sourceRef: 'Exercício local', versao: 2 } }); expect(await status(executarProcedimento(service, org, person, a.slug, p))).toBe(409); expect(await db.session.count({ where: { orgId: org } })).toBe(0);
  });
  it('restrita vazia nega fonte/lista/uso e revogação posterior nega resultado', async () => {
    const a = await makeActive(); const r = await executarProcedimento(service, org, person, a.slug, input());
    await db.contextItem.update({ where: { id: itemId }, data: { leitores: [] } });
    expect((await service.fontes(org, person, a.slug)).items).toEqual([]); expect(await status(service.detalhe(org, person, a.slug, r.id))).toBe(404); expect(await status(executarProcedimento(service, org, person, a.slug, input()))).toBe(404);
  });
  it('revogação durante leitura elimina metadados privados da lista de fontes, sem consultar o modelo', async () => {
    const a = await makeActive(); model.estado.mockClear();
    service = montarProcedimento(depoisDeListarFontes(db, () => db.contextItem.update({ where: { id: itemId }, data: { leitores: [] } })), model);
    expect((await service.fontes(org, person, a.slug)).items).toEqual([]); expect(model.resumir).not.toHaveBeenCalled();
    expect(model.estado).not.toHaveBeenCalled();
  });
  it('permissão revogada durante leitura recusa a lista antes do retorno', async () => {
    const a = await makeActive(); model.estado.mockClear();
    service = montarProcedimento(depoisDeListarFontes(db, () => db.role.update({ where: { id: roleId }, data: { permissions: { disconnect: { key: 'obsidian.ver' } } } })), model);
    expect(await status(service.fontes(org, person, a.slug))).toBe(403); expect(model.resumir).not.toHaveBeenCalled();
    expect(model.estado).not.toHaveBeenCalled();
  });
  it('pausa durante health do modelo impede enviar a primeira chamada', async () => {
    const a = await makeActive(); model.estado.mockImplementation(async () => { await db.agent.update({ where: { id: a.id }, data: { estado: 'pausado', ativo: false } }); return { disponivel: true, provider: 'llama.cpp-local' as const, modelo: modelId, motivo: null }; });
    const r = await executarProcedimento(service, org, person, a.slug, input()); expect(r.status).toBe('recusada'); expect(model.resumir).not.toHaveBeenCalled();
  });
  it('revogação da fonte durante health impede enviar conteúdo ao modelo', async () => {
    const a = await makeActive(); model.estado.mockImplementation(async () => { await db.contextItem.update({ where: { id: itemId }, data: { leitores: [] } }); return { disponivel: true, provider: 'llama.cpp-local' as const, modelo: modelId, motivo: null }; });
    expect(await status(executarProcedimento(service, org, person, a.slug, input()))).toBe(404); expect(model.resumir).not.toHaveBeenCalled();
  });
  it('pausa no meio da inferência impede registrar saída', async () => {
    const a = await makeActive(); model.resumir.mockImplementation(async () => { await db.agent.update({ where: { id: a.id }, data: { estado: 'pausado', ativo: false } }); return { texto: 'Não publicar esta saída', modelo: modelId, tokensIn: 10, tokensOut: 8, finishReason: 'stop' as const }; });
    const r = await executarProcedimento(service, org, person, a.slug, input()); expect(r.resposta).toBeNull(); expect(r.status).toBe('recusada'); expect(r.modeloUsado).toBe(modelId); expect(r.consumo.tokensIn).toBe(10);
  });
  it('revogação de fonte no meio não conserva saída privada nem retorna texto', async () => {
    const a = await makeActive(); model.resumir.mockImplementation(async () => { await db.contextItem.update({ where: { id: itemId }, data: { leitores: [] } }); return { texto: 'Não divulgar saída privada', modelo: modelId, tokensIn: 10, tokensOut: 8, finishReason: 'stop' as const }; });
    expect(await status(executarProcedimento(service, org, person, a.slug, input()))).toBe(404);
    expect(JSON.stringify(await db.sessionStep.findMany({ where: { orgId: org } }))).not.toContain('Não divulgar saída privada');
  });
  it('origem alterada durante inferência recusa saída e mantém medição real da tentativa', async () => {
    const a = await makeActive(); model.resumir.mockImplementation(async () => { await db.contextItem.update({ where: { id: itemId }, data: { sourceRef: 'Origem alterada durante o pedido' } }); return { texto: 'Não aceitar esta saída', modelo: modelId, tokensIn: 10, tokensOut: 8, finishReason: 'stop' as const }; });
    const result = await executarProcedimento(service, org, person, a.slug, input());
    expect(result.status).toBe('recusada'); expect(result.resposta).toBeNull();
    const row = await db.session.findFirstOrThrow({ where: { orgId: org } }); expect(row.status).toBe('recusada'); expect(row.tokensIn).toBe(10);
    expect(JSON.stringify(await db.sessionStep.findMany({ where: { orgId: org } }))).not.toContain('Não aceitar esta saída');
  });
  it('fonte arquivada durante a chamada recusa a saída seguinte', async () => {
    const a = await makeActive(); model.resumir.mockImplementation(async () => { await db.contextItem.update({ where: { id: itemId }, data: { arquivadoEm: new Date() } }); return { texto: 'Não aceitar saída após arquivo', modelo: modelId, tokensIn: 10, tokensOut: 8, finishReason: 'stop' as const }; });
    const r = await executarProcedimento(service, org, person, a.slug, input()); expect(r.status).toBe('recusada'); expect(r.resposta).toBeNull(); expect(r.consumo.tokensOut).toBe(8);
  });
  it('falha de modelo informa situação e reenvio não chama novamente', async () => {
    const a = await makeActive(), p = input(); model.resumir.mockRejectedValue(Error('A chamada do modelo local falhou.')); const r = await executarProcedimento(service, org, person, a.slug, p);
    expect(r.status).toBe('falhou'); expect(r.motivo).toContain('modelo local falhou'); expect((await executarProcedimento(service, org, person, a.slug, p)).id).toBe(r.id); expect(model.resumir).toHaveBeenCalledTimes(1);
  });
  it('capacidade externa adicionada é recusada sem executar ferramentas', async () => {
    const a = await makeActive(); await db.agent.update({ where: { id: a.id }, data: { capacidades: ['contexto.memoria.buscar', 'financeiro.pagar'] } });
    expect((await executarProcedimento(service, org, person, a.slug, input())).motivo).toContain('Ferramenta não permitida'); expect(model.resumir).not.toHaveBeenCalled();
  });
  it('GET sessões e traço legados não divulgam fonte, pedido livre ou resultado privado', async () => {
    const a = await makeActive(), p = { ...input(), pedido: 'Pedido privado que não aparece no histórico legado' }; const r = await executarProcedimento(service, org, person, a.slug, p);
    const legacy = new SessionService(db as unknown as PrismaService); const serial = JSON.stringify([
      await legacy.listar(org, person, SessaoHistoricaConsultaSchema.parse({})), await legacy.traco(org, person, r.id),
    ]);
    for (const privateText of ['Fonte privada QA', 'Ana prepara', 'Síntese controlada', p.pedido]) expect(serial).not.toContain(privateText);
    expect(await status(service.detalhe(org, second, a.slug, r.id))).toBe(404); expect(await status(service.detalhe(otherOrg, outsider, a.slug, r.id))).toBe(403);
  });

});
