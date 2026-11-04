import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { ModeloLocalService } from '../src/agents/modelo-local.service';
import { hashDoCorpo } from '../src/memory/procedencia';
import { executarProcedimento, montarProcedimento } from './procedimento-local-dubles';

// Esta prova nunca é simulada nem pulada. O comando separado exige configuração explícita.
const url = process.env.TEST_DATABASE_URL;
const destino = url ? new URL(url) : null;
if (process.env.ROOTOS_QA_PREVIEW !== '1' || !destino ||
    !['postgresql:', 'postgres:'].includes(destino.protocol) || destino.hostname !== '127.0.0.1' ||
    destino.pathname !== '/rootos_prova_trabalho' || destino.search || destino.hash || !process.env.ROOTOS_LOCAL_MODEL_URL) {
  throw new Error('A prova nativa exige ROOTOS_QA_PREVIEW=1, TEST_DATABASE_URL do clone local rootos_prova_trabalho e ROOTOS_LOCAL_MODEL_URL explícita.');
}
const db = new PrismaClient({ datasources: { db: { url } } });
const orgId = randomUUID(), personId = randomUUID();
const modelId = 'rootos-qa-qwen2.5-0.5b-q4_k_m';
beforeAll(async () => { await db.$connect(); });
afterAll(async () => { await db.$disconnect(); });

it('NATIVO: llama.cpp produz texto e consumo observado, com identidade e versão', async () => {
  const real = new ModeloLocalService();
  expect(await real.estado()).toMatchObject({ disponivel: true, modelo: modelId });
  await db.org.create({ data: { id: orgId, name: 'QA inferência nativa', slug: `qa-native-${orgId}` } });
  const permissions = await Promise.all(['mcp.ver', 'mcp.executar', 'admin.usuarios', 'automacoes.executar', 'obsidian.ver'].map(key =>
    db.permission.upsert({ where: { key }, create: { key }, update: {} })));
  const role = await db.role.create({ data: { orgId, key: 'qa-nativo', name: 'QA nativo', permissions: { connect: permissions.map(({ id }) => ({ id })) } } });
  await db.user.create({ data: { id: personId, orgId, name: 'Pessoa QA nativa', email: `${personId}@qa.invalid`, passwordHash: 'sem-login', roles: { connect: { id: role.id } } } });
  const body = 'QA: Ana prepara o relatório semanal. Bruno confere a entrega na sexta-feira.';
  const contentHash = hashDoCorpo(body);
  const item = await db.contextItem.create({ data: { orgId, chave: `qa:nativo:${randomUUID()}`, title: 'Fonte nativa QA', body,
    sourceType: 'operador', sourceRef: 'Exercício local', contentHash, acessoRestrito: true, leitores: [personId] } });
  const version = await db.contextItemVersion.create({ data: { orgId, itemId: item.id, versao: 1, mudanca: 'criacao', kind: 'nota',
    title: item.title, body, sourceType: 'operador', sourceRef: item.sourceRef, contentHash, semEventoPorque: 'migracao' } });
  const service = montarProcedimento(db, real);
  const agent = await service.criar(orgId, personId, { requestId: randomUUID(), nome: 'Agente QA nativo', missao: 'Resumo da versão de QA',
    pilar: 'Operação', donoId: personId, modelo: modelId, procedimento: { proposito: 'Resumo da versão de QA', gatilho: 'Pedido da pessoa autorizada',
      passos: ['Ler a versão escolhida', 'Preparar resumo com a versão identificada'], definicaoDePronto: 'Resumo registrado com fonte e versão' } });
  await db.agent.update({ where: { id: agent.id }, data: { estado: 'ativo', ativo: true } });
  const r = await executarProcedimento(service, orgId, personId, agent.slug, { requestId: randomUUID(), pedido: 'Summarize this source in one short sentence. Identify version 1.',
    itemId: item.id, versionId: version.id, contentHash, expectedItemVersion: 1, expectedSopVersion: 1 });
  expect(r.status).toBe('respondida'); expect(r.resposta?.length).toBeGreaterThan(5); expect(r.modeloUsado).toBe(modelId);
  expect(r.fonte.versionId).toBe(version.id); expect(r.consumo.tokensIn).toBeGreaterThan(0); expect(r.consumo.tokensOut).toBeGreaterThan(0);
  expect((await db.session.findUniqueOrThrow({ where: { id: r.id } })).provider).toBe('llama.cpp-local');
}, 120_000);
