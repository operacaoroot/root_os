import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ActorType, ApprovalState, PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/audit/audit.service';
import { ClienteEscopoService } from '../src/clientes-escopo/cliente-escopo.service';
import { TarefaEscopoService } from '../src/clientes-escopo/tarefa-escopo.service';
import { EfeitoClienteEscopoService, type PedidoEfeitoCliente } from '../src/clientes-escopo/efeito-cliente-escopo.service';
import { canonicalHash } from '../src/approvals/approvals.service';
import { PolicyService } from '../src/policy/policy.service';

const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL obrigatório para a prova dos efeitos por cliente.');
const alvo = new URL(url);
if (!['postgres:', 'postgresql:'].includes(alvo.protocol) || !['127.0.0.1', 'localhost'].includes(alvo.hostname)
  || alvo.search || alvo.hash || !((alvo.port === '55583' && alvo.pathname === '/rootos_lote5_test')
    || (alvo.port === '5432' && alvo.pathname === '/marketing_os_test'))) {
  throw new Error('A prova exige o banco descartável local ou o banco próprio do CI.');
}

describe('efeitos por cliente: autoridade persistida no PostgreSQL', () => {
  let db: PrismaClient, guard: EfeitoClienteEscopoService, policy: PolicyService;
  const orgs: string[] = [];
  beforeAll(async () => {
    db = new PrismaClient({ datasources: { db: { url } } });
    const prisma = db as unknown as PrismaService;
    const escopo = new ClienteEscopoService(prisma, new AuditService(prisma));
    policy = new PolicyService(prisma);
    await policy.onModuleInit();
    guard = new EfeitoClienteEscopoService(prisma, escopo, new TarefaEscopoService(prisma, escopo), policy);
  });
  afterAll(async () => {
    if (!db) return;
    try {
      const where = { orgId: { in: orgs } };
      await db.approval.deleteMany({ where });
      await db.toolCall.deleteMany({ where });
      await db.arquivoDoCliente.deleteMany({ where });
      await db.workAnexo.deleteMany({ where });
      await db.workTask.deleteMany({ where });
      await db.workStatus.deleteMany({ where });
      await db.workList.deleteMany({ where });
      await db.clienteAcessoVinculo.deleteMany({ where });
      await db.clienteAcessoPerfil.deleteMany({ where });
      await db.user.deleteMany({ where });
      await db.role.deleteMany({ where });
      await db.partner.deleteMany({ where });
      await db.org.deleteMany({ where: { id: { in: orgs } } });
    } finally { await db.$disconnect(); }
  });

  async function fixture(arquivo = false) {
    const org = await db.org.create({ data: { name: 'QA efeito', slug: 'qa-efeito-' + randomUUID() } });
    orgs.push(org.id);
    const orgId = org.id;
    const permissions = await Promise.all(['tarefas.editar', 'aprovacoes.decidir'].map(key =>
      db.permission.upsert({ where: { key }, update: {}, create: { key } })));
    const role = await db.role.create({ data: { orgId, key: 'qa_efeito', name: 'QA', permissions: { connect: permissions.map(p => ({ id: p.id })) } } });
    async function pessoa() {
      const user = await db.user.create({ data: { orgId, name: 'QA', email: randomUUID() + '@qa.invalid', passwordHash: 'sem-login', roles: { connect: { id: role.id } } } });
      await db.clienteAcessoPerfil.create({ data: { orgId, userId: user.id, modo: 'ALL' } });
      return user.id;
    }
    const proponente = await pessoa(), aprovador = await pessoa();
    const cliente = await db.partner.create({ data: { orgId, razaoSocial: 'Cliente A', isCliente: true } });
    const outro = await db.partner.create({ data: { orgId, razaoSocial: 'Cliente B', isCliente: true } });
    const capabilityId = arquivo ? 'drive.arquivo.enviar' as const : 'drive.pasta.criar' as const;
    const resourceType = arquivo ? 'arquivo-do-cliente' as const : 'cliente' as const;
    const args: Record<string, unknown> = arquivo
      ? { clienteId: cliente.id, subpasta: '04-entrega', nome: 'qa.txt', chave: 'qa/' + randomUUID(), sha256: 'a'.repeat(64), bytes: 1, tipoMime: 'text/plain', origem: 'anexo_tarefa' }
      : { clienteId: cliente.id, nome: 'Cliente A', origem: 'manual' };
    const linha = arquivo ? await db.arquivoDoCliente.create({ data: {
      orgId, partnerId: cliente.id, atorId: proponente, origem: 'anexo_tarefa', nomeOriginal: 'qa.txt', tipoMime: 'text/plain',
      chave: String(args.chave), sha256: String(args.sha256), bytes: 1, subpasta: '04-entrega', nome: 'qa.txt', estado: 'aguardando_aprovacao',
    } }) : null;
    const resourceId = linha?.id ?? cliente.id;
    const cap = policy.resolverCapacidade(orgId, capabilityId);
    if (!cap) throw new Error('Capacidade necessária ausente no catálogo de teste.');
    const hashKeys = (cap as unknown as { hashKeys?: string[] }).hashKeys ?? [];
    const chamada = await db.toolCall.create({ data: { orgId, capabilityId, actorType: ActorType.user, actorId: proponente, status: 'aguardando_aprovacao', args: args as never } });
    const ap = await db.approval.create({ data: {
      orgId, toolCallId: chamada.id, capabilityId, propostoPorId: proponente, propostoPorTipo: ActorType.user,
      resourceType, resourceId, contentHash: canonicalHash(resourceType, args, hashKeys), resumo: 'QA', status: ApprovalState.consumida,
      tokenHash: randomUUID(), aprovadoPorId: aprovador, aprovadoEm: new Date(), consumidoEm: new Date(), expiraEm: new Date(Date.now() + 600_000),
    } });
    await db.toolCall.update({ where: { id: chamada.id }, data: { approvalId: ap.id } });
    if (linha) await db.arquivoDoCliente.update({ where: { id: linha.id }, data: { approvalId: ap.id } });
    const pedido: PedidoEfeitoCliente = {
      orgId, clienteId: cliente.id, capabilityId, resourceType, resourceId, args,
      ctx: { orgId, actorType: ActorType.user, actorId: aprovador, approvalId: ap.id },
      ...(linha ? { arquivo: { atorId: proponente, refTipo: null, refId: null } } : {}),
    };
    return { orgId, proponente, aprovador, cliente, outro, ap, chamada, pedido, linha };
  }

  it('confere originador e aprovador distintos sem modificar os registros', async () => {
    const f = await fixture();
    await expect(guard.exigir(f.pedido)).resolves.toMatchObject({ proponenteId: f.proponente, proponenteTipo: ActorType.user });
    expect(await db.approval.findUnique({ where: { id: f.ap.id } })).toEqual(f.ap);
  });
  it('revalida revogação de ALL mesmo que o usuário mantenha vínculo com o cliente', async () => {
    const f = await fixture();
    await db.clienteAcessoPerfil.update({ where: { userId_orgId: { userId: f.proponente, orgId: f.orgId } }, data: { modo: 'SELECTED' } });
    await db.clienteAcessoVinculo.create({ data: { orgId: f.orgId, userId: f.proponente, clienteId: f.cliente.id } });
    await expect(guard.exigir(f.pedido)).rejects.toThrow();
  });
  it.each(['proponente', 'aprovador'] as const)('nega %s inativo depois da aprovação', async campo => {
    const f = await fixture(); await db.user.update({ where: { id: f[campo] }, data: { isActive: false } });
    await expect(guard.exigir(f.pedido)).rejects.toThrow();
  });
  it.each(['proponente', 'aprovador'] as const)('nega %s sem perfil explícito', async campo => {
    const f = await fixture(); await db.clienteAcessoPerfil.delete({ where: { userId_orgId: { userId: f[campo], orgId: f.orgId } } });
    await expect(guard.exigir(f.pedido)).rejects.toThrow();
  });
  it.each(['proponente', 'aprovador'] as const)('nega revogação de papel do %s', async campo => {
    const f = await fixture(); await db.user.update({ where: { id: f[campo] }, data: { roles: { set: [] } } });
    await expect(guard.exigir(f.pedido)).rejects.toThrow();
  });
  it('não transfere a aprovação para outro cliente, recurso ou organização', async () => {
    const f = await fixture(), outra = await fixture();
    await expect(guard.exigir({ ...f.pedido, clienteId: f.outro.id, args: { ...f.pedido.args, clienteId: f.outro.id } })).rejects.toThrow();
    await expect(guard.exigir({ ...f.pedido, resourceId: f.outro.id })).rejects.toThrow();
    await expect(guard.exigir({ ...f.pedido, orgId: outra.orgId, ctx: { ...f.pedido.ctx, orgId: outra.orgId } })).rejects.toThrow();
  });
  it('nega conteúdo persistido adulterado e cliente inativo', async () => {
    const f = await fixture();
    await db.toolCall.update({ where: { id: f.chamada.id }, data: { args: { ...f.pedido.args, nome: 'Outro nome' } as never } });
    await expect(guard.exigir(f.pedido)).rejects.toThrow();
    await db.toolCall.update({ where: { id: f.chamada.id }, data: { args: f.pedido.args as never } });
    await db.partner.update({ where: { id: f.cliente.id }, data: { ativo: false } });
    await expect(guard.exigir(f.pedido)).rejects.toThrow();
  });
  it('preflight mantém confirmada a aprovação recusada por revogação', async () => {
    const f = await fixture();
    await db.approval.update({ where: { id: f.ap.id }, data: { status: ApprovalState.confirmada, consumidoEm: null } });
    await expect(guard.exigirAntesDaAprovacao(f.orgId, f.pedido.capabilityId, f.ap.id, f.pedido.args)).resolves.toBeDefined();
    await db.user.update({ where: { id: f.proponente }, data: { isActive: false } });
    await expect(guard.exigirAntesDaAprovacao(f.orgId, f.pedido.capabilityId, f.ap.id, f.pedido.args)).rejects.toThrow();
    expect((await db.approval.findUniqueOrThrow({ where: { id: f.ap.id } })).status).toBe(ApprovalState.confirmada);
  });
  it('não aceita efeito sem aprovação consumida nem sem identidade do aprovador', async () => {
    const f = await fixture();
    await expect(guard.exigir({ ...f.pedido, ctx: { ...f.pedido.ctx, approvalId: null } })).rejects.toThrow();
    await expect(guard.exigir({ ...f.pedido, ctx: { ...f.pedido.ctx, actorId: f.proponente } })).rejects.toThrow();
    await db.approval.update({ where: { id: f.ap.id }, data: { status: ApprovalState.confirmada } });
    await expect(guard.exigir(f.pedido)).rejects.toThrow();
  });
  it('sistema só vale com identidade persistida coerente e sem originador humano no arquivo', async () => {
    const f = await fixture(true), id = 'arquivista-do-cliente';
    await db.approval.update({ where: { id: f.ap.id }, data: { propostoPorTipo: ActorType.system, propostoPorId: id } });
    await db.toolCall.update({ where: { id: f.chamada.id }, data: { actorType: ActorType.system, actorId: id } });
    await expect(guard.exigir(f.pedido)).rejects.toThrow();
    await db.arquivoDoCliente.update({ where: { id: f.linha!.id }, data: { atorId: null } });
    await expect(guard.exigir({ ...f.pedido, arquivo: { atorId: null, refTipo: null, refId: null } })).resolves.toMatchObject({ proponenteTipo: ActorType.system });
    await db.toolCall.update({ where: { id: f.chamada.id }, data: { actorId: 'sistema-desconhecido' } });
    await expect(guard.exigir({ ...f.pedido, arquivo: { atorId: null, refTipo: null, refId: null } })).rejects.toThrow();
  });
  it('arquivo reclassificado em tarefa de outro cliente não reutiliza a aprovação', async () => {
    const f = await fixture(true);
    const lista = await db.workList.create({ data: { orgId: f.orgId, name: 'QA' } });
    const status = await db.workStatus.create({ data: { orgId: f.orgId, listId: lista.id, name: 'QA', type: 'open' } });
    const task = await db.workTask.create({ data: { orgId: f.orgId, listId: lista.id, statusId: status.id, title: 'QA', clienteId: f.cliente.id } });
    const anexo = await db.workAnexo.create({ data: { orgId: f.orgId, taskId: task.id, nome: 'qa.txt', tipoMime: 'text/plain', chave: String(f.pedido.args.chave), sha256: 'a'.repeat(64), bytes: 1, autorNome: 'QA', autorId: f.proponente } });
    const arquivo = { atorId: f.proponente, refTipo: 'WorkAnexo', refId: anexo.id };
    await db.arquivoDoCliente.update({ where: { id: f.linha!.id }, data: { refTipo: arquivo.refTipo, refId: arquivo.refId } });
    await expect(guard.exigir({ ...f.pedido, arquivo })).resolves.toBeDefined();
    await db.workTask.update({ where: { id: task.id }, data: { clienteId: f.outro.id } });
    await expect(guard.exigir({ ...f.pedido, arquivo })).rejects.toThrow();
  });
});
