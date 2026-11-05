import 'reflect-metadata';
import { randomUUID } from 'node:crypto';

import { JwtService } from '@nestjs/jwt';
import { ActorType, Prisma, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ApprovalsService } from '../src/approvals/approvals.service';
import { AuditService } from '../src/audit/audit.service';
import { ReauthService } from '../src/auth/reauth.service';
import { ClienteEscopoService } from '../src/clientes-escopo/cliente-escopo.service';
import { EfeitoComercialEscopoService } from '../src/clientes-escopo/efeito-comercial-escopo.service';
import { cardIdDoLead } from '../src/comercial/card-da-implantacao';
import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { CAPACIDADE_DA_SALA, SalaVersaoService } from '../src/comercial/sala-versao.service';
import { SalaService } from '../src/comercial/sala.service';
import { comContexto, SemTenantError } from '../src/common/contexto-execucao';
import { AcoesService } from '../src/gateway/acoes.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { EventLogService } from '../src/gateway/event-log.service';
import { InterruptoresRegistry } from '../src/gateway/interruptores.registry';
import { PortaDoOperador } from '../src/gateway/porta-do-operador.service';
import { ToolGateway } from '../src/gateway/tool-gateway.service';
import { ConectoresService } from '../src/integrations/conectores.service';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { comTenantNaSessao } from '../src/prisma/sessao-de-banco';

const rodar = process.env.RLS_NO_TESTE === '1';
const senha = 'senha-fixture-sala-rls';
const orgs: string[] = [];
const rascunho = {
  proximosPassos: [{ oque: 'Conferir o documento', quando: '2026-11-05', comQuem: 'Marina' }],
  combinado: [],
  quemCuida: null,
};

function urlsDoTeste() {
  const dono = new URL(process.env.TEST_DATABASE_URL ?? '');
  const app = new URL(process.env.TENANT_DATABASE_URL ?? '');
  if ([dono, app].some(url => !['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || !/^\/(rls_test|marketing_os_test|marketing_os_test_rls)$/.test(url.pathname) || url.hash
    || [...url.searchParams.keys()].some(key => key !== 'connection_limit'))
    || dono.host !== app.host || dono.pathname !== app.pathname
    || dono.username === 'mktos_app' || app.username !== 'mktos_app') {
    throw new Error('Use TEST_DATABASE_URL e TENANT_DATABASE_URL para o mesmo banco RLS descartável em loopback.');
  }
  return { dono: dono.href, app: app.href };
}

describe.skipIf(!rodar)('publicação da Sala pelo papel mktos_app em modo impor', { timeout: 30_000 }, () => {
  let admin: PrismaClient;
  let app: PrismaClient;
  let sala: SalaService;
  let versoes: SalaVersaoService;
  let approvals: ApprovalsService;
  let acoes: AcoesService;
  let porta: PortaDoOperador;
  let efeitos: EfeitosRegistry;
  let orgA: string;
  let orgB: string;
  let permissaoEditar: string;
  let permissaoAprovar: string;
  let senhaHash: string;

  const noTenant = <T>(orgId: string | null, fn: () => Promise<T>) =>
    comContexto({ orgId, correlationId: randomUUID(), origem: 'http' }, fn);

  beforeAll(async () => {
    const urls = urlsDoTeste();
    vi.stubEnv('GATEWAY_MODO', 'impor');
    vi.setSystemTime(new Date('2026-11-04T14:00:00-03:00'));
    admin = new PrismaClient({ datasourceUrl: urls.dono });
    app = comTenantNaSessao(new PrismaClient({ datasourceUrl: urls.app }), { modo: 'impor' });
    const tabelas = ['Approval', 'ClienteAcessoPerfil', 'ComercialFicha', 'Lead', 'LeadEvent', 'Partner', 'SalaDoCliente', 'SalaVersao', 'ToolCall', 'User'];
    const estado = await admin.$queryRaw<{ tabela: string; rls: boolean; force: boolean }[]>`
      SELECT tabela, rls, force FROM app_rls_estado() WHERE tabela IN (${Prisma.join(tabelas)})
    `;
    expect(estado).toHaveLength(tabelas.length);
    expect(estado.every(t => t.rls && t.force)).toBe(true);

    for (const nome of ['A', 'B']) {
      const org = await admin.org.create({ data: { name: `QA Sala ${nome}`, slug: `qa-sala-${randomUUID()}` } });
      orgs.push(org.id);
    }
    [orgA, orgB] = orgs;
    const papel = await noTenant(orgA, () => app.$transaction(tx => tx.$queryRaw<{ usuario: string; bypass: boolean; tenant: string }[]>`
      SELECT current_user::text AS usuario, (rolsuper OR rolbypassrls) AS bypass,
        current_setting('app.org_id') AS tenant
      FROM pg_roles WHERE rolname = current_user
    `));
    expect(papel).toEqual([{ usuario: 'mktos_app', bypass: false, tenant: orgA }]);

    const permissoes = await Promise.all(['leads.editar', 'aprovacoes.decidir'].map(key =>
      admin.permission.upsert({ where: { key }, update: {}, create: { key } })));
    [permissaoEditar, permissaoAprovar] = permissoes.map(permissao => permissao.id);
    senhaHash = await bcrypt.hash(senha, 4);

    const prisma = app as unknown as PrismaService;
    const audit = new AuditService(prisma);
    const policy = new PolicyService(prisma);
    await policy.onModuleInit();
    approvals = new ApprovalsService(prisma, audit, new ReauthService(prisma, new JwtService({ secret: 'qa-sala-rls' }), audit));
    const log = new EventLogService(prisma);
    efeitos = new EfeitosRegistry();
    const interruptores = new InterruptoresRegistry();
    new ConectoresService(prisma, audit, log, interruptores).onModuleInit();
    const guarda = new EfeitoComercialEscopoService(prisma, new ClienteEscopoService(prisma, audit), policy);
    const gateway = new ToolGateway(prisma, policy, new SinaisService(prisma, policy), approvals, log, undefined, interruptores, efeitos, undefined, undefined, guarda);
    acoes = new AcoesService(prisma, gateway, log, interruptores, policy, approvals);
    const reacoes = new ReacoesRegistry();
    const fio = new FioService(prisma, reacoes);
    sala = new SalaService(prisma, fio, reacoes);
    porta = new PortaDoOperador(gateway, efeitos);
    versoes = new SalaVersaoService(prisma, fio, efeitos, porta, guarda);
    versoes.onModuleInit();
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    try {
      if (!admin || orgs.length === 0) return;
      const where = { orgId: { in: orgs } };
      await admin.$transaction([
        admin.salaVersao.deleteMany({ where }),
        admin.salaDoCliente.deleteMany({ where }),
        admin.comercialFicha.deleteMany({ where }),
        admin.leadEvent.deleteMany({ where }),
        admin.onboardingTrilho.deleteMany({ where }),
        admin.workTask.deleteMany({ where }),
        admin.workStatus.deleteMany({ where }),
        admin.workList.deleteMany({ where }),
        admin.lead.deleteMany({ where }),
        admin.approval.deleteMany({ where }),
        admin.policyDecision.deleteMany({ where }),
        admin.toolCall.deleteMany({ where }),
        admin.$executeRaw`ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete`,
        admin.eventLog.deleteMany({ where }),
        admin.$executeRaw`ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete`,
        admin.auditLog.deleteMany({ where }),
        admin.clienteAcessoPerfil.deleteMany({ where }),
        admin.user.deleteMany({ where }),
        admin.partner.deleteMany({ where }),
        admin.role.deleteMany({ where }),
        admin.org.deleteMany({ where: { id: { in: orgs } } }),
      ]);
    } finally {
      await app?.$disconnect();
      await admin?.$disconnect();
    }
  });

  async function cliente(orgId: string) {
    return admin.partner.create({ data: { orgId, razaoSocial: 'Cliente de teste da Sala', isCliente: true } });
  }

  async function fixture(orgId = orgA, clienteVinculado = true) {
    async function pessoa(papel: string, permissionId: string) {
      const role = await admin.role.upsert({
        where: { orgId_key: { orgId, key: papel } },
        update: {},
        create: { orgId, key: papel, name: papel, permissions: { connect: { id: permissionId } } },
      });
      const { id } = await admin.user.create({
        data: { orgId, email: `${randomUUID()}@qa.invalid`, name: papel, passwordHash: senhaHash, roles: { connect: { id: role.id } } },
      });
      await admin.clienteAcessoPerfil.create({ data: { orgId, userId: id, modo: 'ALL' } });
      return { id, papeis: [papel], reauth: { senha } };
    }
    const proponente = await pessoa('gestor_marketing', permissaoEditar);
    const aprovador = await pessoa('admin_master', permissaoAprovar);
    const clienteId = clienteVinculado ? (await cliente(orgId)).id : null;
    const { id: leadId } = await admin.lead.create({ data: { orgId, name: 'Lead de teste da Sala' } });
    await admin.comercialFicha.create({ data: { orgId, leadId, partnerId: clienteId } });

    const { link, salaId } = await noTenant(orgId, () => sala.garantir(orgId, leadId));
    const token = new URL(link!).pathname.split('/').at(-1)!;
    const estadoPublico = () => noTenant(null, () => sala.estado(token));
    const salvar = () => noTenant(orgId, () => versoes.salvarRascunho(orgId, leadId, rascunho, proponente));
    const pedir = async (item?: 'atas') => {
      const pedido = await noTenant<{ approvalId: string | null; estado: string }>(orgId, () => item
        ? versoes.publicarItem(orgId, leadId, item, proponente)
        : versoes.publicar(orgId, leadId, proponente));
      expect(pedido).toMatchObject({ estado: 'na_porta', approvalId: expect.any(String) });
      return pedido.approvalId!;
    };
    const confirmar = (id: string) => noTenant(orgId, () =>
      approvals.confirm(orgId, id, aprovador, 'Conferi o conteúdo da Sala'));
    const executar = (id: string) => noTenant(orgId, () => acoes.executarAprovada(orgId, id, aprovador.id));
    const fatos = () => admin.leadEvent.findMany({ where: { orgId, leadId, type: 'sala.publicada' } });

    return { orgId, leadId, salaId, clienteId, proponente, aprovador, estadoPublico, salvar, pedir, confirmar, executar, fatos };
  }

  async function executarEfeito(f: Awaited<ReturnType<typeof fixture>>, approvalId: string) {
    const ap = await admin.approval.findUniqueOrThrow({ where: { id: approvalId } });
    const chamada = await admin.toolCall.findUniqueOrThrow({ where: { id: ap.toolCallId! } });
    return noTenant(f.orgId, () => efeitos.executar(CAPACIDADE_DA_SALA, chamada.args as Record<string, unknown>, {
      orgId: f.orgId, actorType: ActorType.user, actorId: f.aprovador.id, approvalId,
    }));
  }

  it('publica a versão do próprio cliente e isola versões, aprovações e fatos entre as empresas', async () => {
    const a = await fixture();
    const b = await fixture(orgB);
    await a.salvar();
    await b.salvar();
    const approvalId = await a.pedir();
    const approvalB = await b.pedir();
    expect((await a.estadoPublico()).publicada).toBeNull();

    await expect(noTenant(orgA, () => approvals.confirm(orgA, approvalId, a.proponente)))
      .rejects.toThrow('Quem propôs a ação não pode aprová-la.');
    expect(await admin.salaVersao.findFirstOrThrow({ where: { leadId: a.leadId } })).toMatchObject({
      approvalId, origemCliente: { versao: 1, clienteId: a.clienteId },
    });
    await a.confirmar(approvalId);
    await expect(executarEfeito(a, approvalId)).rejects.toMatchObject({ status: 403 });
    await expect(noTenant(orgB, () => acoes.executarAprovada(orgB, approvalId, b.aprovador.id))).rejects.toThrow('Aprovação não encontrada');
    await expect(a.executar(approvalId)).resolves.toMatchObject({ status: 'executado' });

    expect(await a.estadoPublico()).toMatchObject({ publicada: { versao: 1, conteudo: { proximosPassos: rascunho.proximosPassos } } });
    expect((await a.estadoPublico()).publicada).not.toHaveProperty('origemCliente');
    expect((await b.estadoPublico()).publicada).toBeNull();
    expect(await admin.approval.findUniqueOrThrow({ where: { id: approvalB } })).toMatchObject({ status: 'pendente' });
    expect(await a.fatos()).toEqual([expect.objectContaining({ payload: expect.objectContaining({ liberadaPor: a.aprovador.id }) })]);
    expect(await b.fatos()).toEqual([]);

    const linhasDaOutra = await noTenant(orgB, () => app.$transaction(async tx => ({
      versoes: await tx.salaVersao.count({ where: { leadId: a.leadId } }),
      aprovacoes: await tx.approval.count({ where: { id: approvalId } }),
      fatos: await tx.leadEvent.count({ where: { leadId: a.leadId } }),
      escritas: (await tx.salaVersao.updateMany({ where: { leadId: a.leadId }, data: { estado: 'substituida' } })).count,
    })));
    expect(linhasDaOutra).toEqual({ versoes: 0, aprovacoes: 0, fatos: 0, escritas: 0 });
    await expect(app.salaVersao.findMany()).rejects.toBeInstanceOf(SemTenantError);
  });

  it.each(['regravação idêntica', 'cliente trocado', 'legado', 'proponente revogado', 'aprovador revogado'] as const)(
    'recusa %s antes de consumir a aprovação e mantém a Sala fora do ar',
    async caso => {
      const f = await fixture();
      const inicial = await f.salvar();
      const id = await f.pedir();
      await f.confirmar(id);
      switch (caso) {
        case 'regravação idêntica': {
          const regravado = await f.salvar();
          expect(regravado.rascunho).toMatchObject({ hash: inicial.rascunho.hash, approvalId: null });
          break;
        }
        case 'cliente trocado':
          await admin.comercialFicha.update({ where: { leadId: f.leadId }, data: { partnerId: (await cliente(f.orgId)).id } });
          break;
        case 'legado':
          await admin.salaVersao.updateMany({ where: { leadId: f.leadId }, data: { origemCliente: Prisma.DbNull } });
          break;
        case 'proponente revogado':
          await admin.clienteAcessoPerfil.updateMany({ where: { orgId: f.orgId, userId: f.proponente.id }, data: { modo: 'SELECTED' } });
          break;
        case 'aprovador revogado':
          await admin.user.update({ where: { id: f.aprovador.id }, data: { isActive: false } });
          break;
      }
      await expect(f.executar(id)).rejects.toMatchObject({ status: 403 });
      expect(await admin.approval.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'confirmada', consumidoEm: null });
      expect((await f.estadoPublico()).publicada).toBeNull();
      expect(await f.fatos()).toEqual([]);
    },
  );

  it('assina null explícito e revalida o aprovador antes do retorno idempotente do efeito', async () => {
    const f = await fixture(orgA, false);
    await f.salvar();
    const id = await f.pedir();
    const ap = await admin.approval.findUniqueOrThrow({ where: { id } });
    expect(await admin.toolCall.findUniqueOrThrow({ where: { id: ap.toolCallId! } })).toMatchObject({
      args: { clienteId: null, origemCliente: { versao: 1, clienteId: null } },
    });
    await f.confirmar(id);
    await expect(f.executar(id)).resolves.toMatchObject({ status: 'executado' });
    await expect(executarEfeito(f, id)).resolves.toMatchObject({ jaPublicada: true });
    await expect(f.executar(id)).rejects.toThrow(/uso único/);
    await admin.clienteAcessoPerfil.deleteMany({ where: { orgId: f.orgId, userId: f.aprovador.id } });
    await expect(executarEfeito(f, id)).rejects.toMatchObject({ status: 403 });
    expect(await f.fatos()).toHaveLength(1);
  });

  it('um novo clique só reaproveita a aprovação confirmada se o aprovador ainda tem autorização', async () => {
    const f = await fixture();
    await f.salvar();
    const anterior = await f.pedir();
    expect(await f.pedir()).toBe(anterior);
    await f.confirmar(anterior);
    expect(await f.pedir()).toBe(anterior);

    await admin.user.update({ where: { id: f.aprovador.id }, data: { isActive: false } });
    const novo = await f.pedir();
    expect(novo).not.toBe(anterior);
    expect(await admin.salaVersao.findFirstOrThrow({ where: { leadId: f.leadId } })).toMatchObject({ approvalId: novo, estado: 'na_porta' });
    expect(await admin.approval.findUniqueOrThrow({ where: { id: novo } })).toMatchObject({ status: 'pendente', aprovadoPorId: null });

    await admin.user.update({ where: { id: f.aprovador.id }, data: { isActive: true } });
    await expect(f.executar(anterior)).rejects.toMatchObject({ status: 403 });
    expect(await f.fatos()).toHaveLength(0);
  });

  it('preserva o token após revogação e publica uma só vez quando duas chamadas concorrem', async () => {
    const f = await fixture();
    await f.salvar();
    // Observa o token emitido pelo serviço real. A Sala devolve apenas o ID na resposta.
    const emissao = vi.spyOn(approvals, 'propor');
    let token: string;
    let id: string;
    try {
      id = await f.pedir();
      const emitida = await emissao.mock.results[0].value;
      expect(emitida.approvalId).toBe(id);
      token = emitida.token;
    } finally {
      emissao.mockRestore();
    }
    const ap = await admin.approval.findUniqueOrThrow({ where: { id } });
    const chamada = await admin.toolCall.findUniqueOrThrow({ where: { id: ap.toolCallId! } });
    const usarToken = () => noTenant(f.orgId, () => porta.executar({
      orgId: f.orgId, actorId: f.proponente.id, capabilityId: CAPACIDADE_DA_SALA,
      args: chamada.args as Record<string, unknown>, approvalToken: token,
      resource: { type: ap.resourceType, id: ap.resourceId },
    }));
    await f.confirmar(id);

    const perfil = { userId_orgId: { userId: f.aprovador.id, orgId: f.orgId } };
    await admin.clienteAcessoPerfil.update({ where: perfil, data: { modo: 'SELECTED' } });
    await expect(usarToken()).rejects.toMatchObject({ status: 403 });
    expect(await admin.approval.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'confirmada', consumidoEm: null });
    expect(await f.fatos()).toHaveLength(0);

    await admin.clienteAcessoPerfil.update({ where: perfil, data: { modo: 'ALL' } });
    const resultados = await Promise.allSettled([usarToken(), usarToken()]);
    expect(resultados).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'fulfilled', value: expect.objectContaining({ leadId: f.leadId, eventoId: expect.any(String) }) }),
      expect.objectContaining({ status: 'rejected', reason: expect.objectContaining({ status: 403 }) }),
    ]));
    expect(await admin.approval.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'consumida' });
    expect(await f.fatos()).toEqual([expect.objectContaining({ payload: expect.objectContaining({ liberadaPor: f.aprovador.id }) })]);
    expect(await admin.salaVersao.findFirstOrThrow({ where: { leadId: f.leadId } })).toMatchObject({ estado: 'publicada', publicadaPor: f.aprovador.id });
  });

  it('publica o item em separado sem liberar o rascunho da Sala inteira', async () => {
    const f = await fixture();
    await f.salvar();
    await noTenant(f.orgId, () => versoes.salvarRascunhoDoItem(f.orgId, f.leadId, 'atas', { resumo: 'Resumo conferido da ata' }, f.proponente));
    const id = await f.pedir('atas');
    await f.confirmar(id);
    await expect(f.executar(id)).resolves.toMatchObject({ status: 'executado', resultado: { item: 'atas' } });
    expect(await admin.salaVersao.findMany({ where: { leadId: f.leadId }, select: { item: true, estado: true }, orderBy: { numero: 'asc' } }))
      .toEqual([{ item: null, estado: 'rascunho' }, { item: 'atas', estado: 'publicada' }]);
    expect((await f.estadoPublico()).publicada).toBeNull();
  });

  it('confere o cliente do cartão canônico antes de projetar o trilho na Sala', async () => {
    const f = await fixture();
    const lista = await admin.workList.create({ data: { orgId: f.orgId, name: 'Implantação QA' } });
    const status = await admin.workStatus.create({ data: { orgId: f.orgId, listId: lista.id, name: 'Aberto', type: 'open' } });
    const card = await admin.workTask.create({ data: {
      id: cardIdDoLead(f.orgId, f.leadId), orgId: f.orgId, listId: lista.id, statusId: status.id,
      title: 'Implantação QA', clienteId: f.clienteId, leadId: f.leadId,
    } });
    const trilho = await admin.onboardingTrilho.create({ data: {
      orgId: f.orgId, slug: randomUUID(), cliente: 'Cliente de teste da Sala', fase: 'operacao', cardId: card.id,
      proximoPasso: 'Conferir o acesso', proximoPassoDono: 'Marina', proximoPassoEm: new Date('2026-11-05'),
    } });
    await admin.comercialFicha.update({ where: { leadId: f.leadId }, data: { cardId: card.id, trilhoId: trilho.id, clienteAtivoEm: new Date() } });
    const ler = () => noTenant(f.orgId, () => versoes.versoes(f.orgId, f.leadId));
    expect((await ler()).rascunho.conteudo.proximosPassos).toEqual([{ oque: 'Conferir o acesso', quando: '2026-11-05', comQuem: 'Marina' }]);
    expect((await f.estadoPublico()).area?.fase.atual).toBe('fase-5');

    const clienteAlheio = await cliente(f.orgId);
    await admin.workTask.update({ where: { id: card.id }, data: { clienteId: clienteAlheio.id } });
    expect((await ler()).rascunho.conteudo.proximosPassos).toEqual([]);
    expect((await f.estadoPublico()).area?.fase.atual).not.toBe('fase-5');
  });
});
