import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ActorType, ApprovalState, PrismaClient, RiskLevel, ToolCallStatus } from '@prisma/client';

import { ApprovalsController } from '../src/approvals/approvals.controller';
import { ApprovalsService } from '../src/approvals/approvals.service';
import { AcoesService } from '../src/gateway/acoes.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { EventLogService } from '../src/gateway/event-log.service';
import { ToolGateway } from '../src/gateway/tool-gateway.service';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import { AuditService } from '../src/audit/audit.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * O NOME DO LEAD NA FILA — `alvo`, rodada do painel P4 (18/10/2026).
 *
 * A fila de /atendimento passou a escrever "Enviar WhatsApp para Marina
 * Duarte" em vez de um id. O nome é um campo SÓ DE LEITURA a mais na listagem,
 * e esta suíte prova as três coisas que ele não pode fazer:
 *
 *   1. aparecer para quem só ACOMPANHA a fila (mesma régua do conteúdo exato:
 *      o nome sai dos argumentos, e os argumentos são de quem decide);
 *   2. atravessar empresa: um `leadId` de outra empresa gravado nos argumentos
 *      ou no recurso não acha nada;
 *   3. inventar nome: sem lead, `null`.
 *
 * E a de cima: a ficha do comercial (`empresa`) vence o nome do contato, como
 * no resumo do pedido de mover.
 */
const URL = process.env.TEST_DATABASE_URL;
if (URL) exigirBancoDescartavel(URL, 'cria e apaga empresas, leads e aprovações');

const ORG_A = 'org-alvo-a';
const ORG_B = 'org-alvo-b';
const TODAS = [ORG_A, ORG_B];
const CAP = 'comercial.whatsapp.enviar';
const VER = ['aprovacoes.ver'];
const VER_E_DECIDIR = ['aprovacoes.ver', 'aprovacoes.decidir'];

const sessao = (sub: string, orgId: string, permissions: string[]) =>
  ({ sub, orgId, email: `${sub}@teste`, name: sub, roles: ['admin_master'], permissions }) as never;

describe.skipIf(!URL)('a fila diz o nome do lead, só para quem decide', () => {
  let prisma: PrismaClient;
  let controlador: ApprovalsController;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    for (const key of VER_E_DECIDIR) await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
    expect(await prisma.capability.findUnique({ where: { id: CAP } }), `rode db:seed:politica: falta "${CAP}"`).not.toBeNull();

    for (const orgId of TODAS) {
      await prisma.org.upsert({ where: { id: orgId }, create: { id: orgId, name: orgId, slug: orgId }, update: {} });
      const decide = await prisma.role.upsert({
        where: { orgId_key: { orgId, key: 'admin_master' } },
        create: { orgId, key: 'admin_master', name: 'admin', permissions: { connect: VER_E_DECIDIR.map((key) => ({ key })) } },
        update: {},
        select: { id: true },
      });
      const ve = await prisma.role.upsert({
        where: { orgId_key: { orgId, key: 'analista' } },
        create: { orgId, key: 'analista', name: 'analista', permissions: { connect: VER.map((key) => ({ key })) } },
        update: {},
        select: { id: true },
      });
      for (const [id, papel] of [[`ana-${orgId}`, decide.id], [`beto-${orgId}`, decide.id], [`tito-${orgId}`, ve.id]] as const) {
        await prisma.user.upsert({
          where: { id },
          create: { id, orgId, name: id, email: `${id}@teste.alvo`, passwordHash: 'x', roles: { connect: { id: papel } } },
          update: { isActive: true },
        });
      }
    }

    const marina = await prisma.lead.create({ data: { orgId: ORG_A, name: 'Marina Duarte' }, select: { id: true } });
    const alicerce = await prisma.lead.create({ data: { orgId: ORG_A, name: 'Carlos (contato)' }, select: { id: true } });
    await prisma.comercialFicha.create({ data: { orgId: ORG_A, leadId: alicerce.id, empresa: 'Construtora Alicerce' } });
    const daB = await prisma.lead.create({ data: { orgId: ORG_B, name: 'Segredo da B' }, select: { id: true } });
    ids.daB = daB.id;

    const aprovacao = (apelido: string, extra: Record<string, unknown>) =>
      prisma.approval.create({
        data: {
          orgId: ORG_A,
          propostoPorId: `beto-${ORG_A}`,
          propostoPorTipo: ActorType.user,
          contentHash: `hash-${apelido}-0123456789abcdef`,
          resumo: `pedido ${apelido}`,
          status: ApprovalState.pendente,
          nivelExigido: RiskLevel.R3,
          alcadaMinima: 'responsavel',
          tokenHash: `token-${apelido}-${Math.random()}`,
          expiraEm: new Date(Date.now() + 60 * 60 * 1000),
          resourceType: 'lead',
          resourceId: '-',
          ...extra,
        },
        select: { id: true },
      });

    // O pedido de mover do funil: recurso `lead`, sem ação retida.
    ids.mover = (await aprovacao('mover', { resourceId: alicerce.id })).id;
    // Recurso `lead` apontando para o lead da OUTRA empresa: não pode achar nada.
    ids.cruzado = (await aprovacao('cruzado', { resourceId: daB.id })).id;
    // A capacidade do comercial, com `leadId` nos argumentos.
    const chamada = await prisma.toolCall.create({
      data: {
        orgId: ORG_A,
        capabilityId: CAP,
        actorType: ActorType.user,
        actorId: `beto-${ORG_A}`,
        status: ToolCallStatus.aguardando_aprovacao,
        args: { leadId: marina.id, mensagemId: 'm-1', texto: 'Oi, Marina', destino: 'lead' },
        nivel: RiskLevel.R3,
      },
      select: { id: true },
    });
    ids.whatsapp = (
      await aprovacao('whatsapp', { capabilityId: CAP, toolCallId: chamada.id, resourceType: 'comercial.mensagem', resourceId: 'm-1' })
    ).id;
    // Sem lead nenhum.
    ids.semLead = (await aprovacao('sem-lead', { resourceType: 'campaign', resourceId: 'cmp-1' })).id;

    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    const policy = new PolicyService(p);
    await policy.onModuleInit();
    const approvals = new ApprovalsService(p, audit);
    const eventos = new EventLogService(p);
    const efeitos = new EfeitosRegistry();
    efeitos.registrar({ [CAP]: async () => ({ enviado: true }) });
    const gateway = new ToolGateway(p, policy, new SinaisService(p, policy), approvals, eventos, undefined, undefined, efeitos);
    controlador = new ApprovalsController(approvals, new AcoesService(p, gateway, eventos, undefined, policy), p, gateway);
  });

  afterAll(async () => {
    await prisma.approval.deleteMany({ where: { orgId: { in: TODAS } } });
    await prisma.toolCall.deleteMany({ where: { orgId: { in: TODAS } } });
    await prisma.auditLog.deleteMany({ where: { orgId: { in: TODAS } } });
    await prisma.comercialFicha.deleteMany({ where: { orgId: { in: TODAS } } });
    await prisma.lead.deleteMany({ where: { orgId: { in: TODAS } } });
    await prisma.user.deleteMany({ where: { orgId: { in: TODAS } } });
    await prisma.role.deleteMany({ where: { orgId: { in: TODAS } } });
    await prisma.org.deleteMany({ where: { id: { in: TODAS } } });
    await prisma.$disconnect();
  });

  it('quem decide lê o nome: dos argumentos (leadId) e do recurso lead, com a empresa da ficha na frente', async () => {
    const fila = await controlador.fila(sessao(`ana-${ORG_A}`, ORG_A, VER_E_DECIDIR));
    const alvo = (id: string) => fila.itens.find((i) => i.id === id)?.alvo;
    expect(alvo(ids.whatsapp)).toBe('Marina Duarte');
    expect(alvo(ids.mover)).toBe('Construtora Alicerce');
    expect(alvo(ids.semLead)).toBeNull();
  });

  it('o lead de outra empresa não aparece, nem pelo recurso', async () => {
    const fila = await controlador.fila(sessao(`ana-${ORG_A}`, ORG_A, VER_E_DECIDIR));
    expect(fila.itens.find((i) => i.id === ids.cruzado)?.alvo).toBeNull();
    expect(JSON.stringify(fila)).not.toContain('Segredo da B');
  });

  it('quem só acompanha não recebe o nome, como não recebe o conteúdo', async () => {
    const fila = await controlador.fila(sessao(`tito-${ORG_A}`, ORG_A, VER));
    expect(fila.itens.length).toBe(4);
    expect(fila.itens.every((i) => i.alvo === null)).toBe(true);
    expect(JSON.stringify(fila)).not.toContain('Marina Duarte');
  });
});
