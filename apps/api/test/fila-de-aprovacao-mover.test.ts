import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ActorType, ApprovalState, PrismaClient, RiskLevel, ToolCallStatus } from '@prisma/client';

import { ApprovalsController } from '../src/approvals/approvals.controller';
import { ApprovalsService, hashDaSuperficieAntiga } from '../src/approvals/approvals.service';
import { DESTINO_NAO_CONFERE, conferirPedidoDeMover, destinoDoHash, destinosCitados } from '../src/approvals/destino-do-mover';
import { AuditService } from '../src/audit/audit.service';
import { MoverService } from '../src/comercial/mover.service';
import { AcoesService } from '../src/gateway/acoes.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { EventLogService } from '../src/gateway/event-log.service';
import { ToolGateway } from '../src/gateway/tool-gateway.service';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * O PEDIDO DE MOVER NA FILA — revisão adversarial da rodada do painel (18/10/2026).
 *
 *   PA-1 · quem assina o mover via só o resumo, texto livre; o hash prende só
 *          `{para}`. Agora a fila deriva o destino do HASH (recalculado para
 *          cada etapa), a frase usa esse destino, o texto que cita outro impede
 *          (e `confirm` recusa), e `POST /approvals` não cria pedido com `para`.
 *   PA-7 · quem pediu lê o estado do próprio pedido (só leitura, sem o token).
 *   PA-8 · a confirmada da superfície do token que venceu vai para "expirou" e
 *          para o fim da ordem; a da porta (com capacidade) fica como estava.
 */

const resumoDoFunil = (de: string, para: string, pend = '') =>
  `Mover Construtora Alicerce de ${de} para ${para}${pend ? ` com pendências: ${pend}` : ' (portões cumpridos)'}. Pedido por Lucas pela tela do funil.`;

describe('o destino do mover sai do hash, não do texto (PA-1, conta pura)', () => {
  it('cada etapa tem um hash próprio, e o hash do PATCH (status) não é de etapa nenhuma', () => {
    expect(destinoDoHash(hashDaSuperficieAntiga('lead', { para: 'reuniao_agendada' }))).toBe('reuniao_agendada');
    expect(destinoDoHash(hashDaSuperficieAntiga('lead', { para: 'follow_up' }))).toBe('follow_up');
    expect(destinoDoHash(hashDaSuperficieAntiga('lead', { status: 'ganho' }))).toBeNull();
  });

  it('o resumo que o servidor escreve confere com o hash', () => {
    const c = conferirPedidoDeMover({
      contentHash: hashDaSuperficieAntiga('lead', { para: 'reuniao_agendada' }),
      resumo: resumoDoFunil('E2 · Qualificação', 'E3 · Reunião agendada'),
    });
    expect(c).toEqual({ destino: 'reuniao_agendada', rotulo: 'E3 · Reunião agendada', impedimento: null });
  });

  it('o cenário do laudo: texto diz E3, hash prende E7, e a linha fica impedida', () => {
    const c = conferirPedidoDeMover({
      contentHash: hashDaSuperficieAntiga('lead', { para: 'follow_up' }),
      resumo: resumoDoFunil('E2 · Qualificação', 'E3 · Reunião agendada'),
    });
    expect(c?.destino).toBe('follow_up');
    expect(c?.impedimento).toBe(DESTINO_NAO_CONFERE);
  });

  it('o rótulo curto também conta como destino citado ("para Reunião agendada")', () => {
    const c = conferirPedidoDeMover({
      contentHash: hashDaSuperficieAntiga('lead', { para: 'follow_up' }),
      resumo: 'Mover ACME para Reunião agendada.',
    });
    expect(c?.impedimento).toBe(DESTINO_NAO_CONFERE);
  });

  it('diz que move e o hash não é de etapa (status, próxima ação): impede', () => {
    const c = conferirPedidoDeMover({
      contentHash: hashDaSuperficieAntiga('lead', { status: 'ganho' }),
      resumo: resumoDoFunil('E2 · Qualificação', 'E3 · Reunião agendada'),
    });
    expect(c).toEqual({ destino: null, rotulo: null, impedimento: DESTINO_NAO_CONFERE });
  });

  it('a aprovação do PATCH /leads que não diz mover segue como sempre', () => {
    expect(conferirPedidoDeMover({ contentHash: hashDaSuperficieAntiga('lead', { status: 'ganho' }), resumo: 'Marcar o lead como ganho' })).toBeNull();
  });

  it('pendência que fala "para a proposta" não vira destino citado', () => {
    const resumo = resumoDoFunil('E1 · Novo lead', 'E3 · Reunião agendada', 'levar o orçamento para Proposta (E2)');
    expect(destinosCitados(resumo)).toEqual(['reuniao_agendada']);
    expect(conferirPedidoDeMover({ contentHash: hashDaSuperficieAntiga('lead', { para: 'reuniao_agendada' }), resumo })?.impedimento).toBeNull();
  });
});

describe('POST /approvals não cria pedido de mover (PA-1, sem banco)', () => {
  const criar = vi.fn(async () => ({ approvalId: 'a', token: 't', summary: 's', expiresAt: 'x' }));
  const controlador = new ApprovalsController({ create: criar } as never, {} as never, {} as never, {} as never);
  const usuario = { sub: 'u1', orgId: 'org-1', roles: ['gestor_marketing'], permissions: ['mcp.executar'] } as never;

  it('recusa `para` no recurso lead, com qualquer valor, sem criar nada', () => {
    for (const para of ['follow_up', 'reuniao_agendada', null, '']) {
      expect(() =>
        controlador.create(usuario, { resourceType: 'lead', resourceId: 'L', changes: { para }, summary: 'Mover ACME para E3 · Reunião agendada' }),
      ).toThrow(ForbiddenException);
    }
    expect(criar).not.toHaveBeenCalled();
  });

  it('o PATCH de status do lead e `para` em outro recurso continuam passando', async () => {
    await controlador.create(usuario, { resourceType: 'lead', resourceId: 'L', changes: { status: 'ganho' } });
    await controlador.create(usuario, { resourceType: 'task', resourceId: 'T', changes: { status: 'feito', para: 'x' } });
    expect(criar).toHaveBeenCalledTimes(2);
  });
});

const URL = process.env.TEST_DATABASE_URL;
if (URL) exigirBancoDescartavel(URL, 'cria e apaga empresas, usuários e aprovações');

const ORG = 'org-fila-mover';
const CAP = 'comercial.whatsapp.enviar';
const VER_E_DECIDIR = ['aprovacoes.ver', 'aprovacoes.decidir'];
const sessao = (sub: string) => ({ sub, orgId: ORG, email: `${sub}@teste`, name: sub, roles: ['admin_master'], permissions: VER_E_DECIDIR }) as never;

describe.skipIf(!URL)('a fila do mover, contra o banco (PA-1, PA-7, PA-8)', () => {
  let prisma: PrismaClient;
  let controlador: ApprovalsController;
  let mover: MoverService;
  const ids: Record<string, string> = {};
  const ANA = `ana-${ORG}`;
  const BETO = `beto-${ORG}`;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    for (const key of VER_E_DECIDIR) await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
    expect(await prisma.capability.findUnique({ where: { id: CAP } }), `rode db:seed:politica: falta "${CAP}"`).not.toBeNull();
    await prisma.org.upsert({ where: { id: ORG }, create: { id: ORG, name: ORG, slug: ORG }, update: {} });
    const papel = await prisma.role.upsert({
      where: { orgId_key: { orgId: ORG, key: 'admin_master' } },
      create: { orgId: ORG, key: 'admin_master', name: 'admin', permissions: { connect: VER_E_DECIDIR.map((key) => ({ key })) } },
      update: {},
      select: { id: true },
    });
    for (const id of [ANA, BETO]) {
      await prisma.user.upsert({
        where: { id },
        create: { id, orgId: ORG, name: id, email: `${id}@teste.mover`, passwordHash: 'x', roles: { connect: { id: papel.id } } },
        update: { isActive: true },
      });
    }
    const lead = await prisma.lead.create({ data: { orgId: ORG, name: 'Construtora Alicerce' }, select: { id: true } });
    ids.lead = lead.id;

    const MIN = 60 * 1000;
    const aprovacao = (apelido: string, extra: Record<string, unknown>) =>
      prisma.approval.create({
        data: {
          orgId: ORG,
          propostoPorId: BETO,
          propostoPorTipo: ActorType.user,
          contentHash: `hash-${apelido}`,
          resumo: `pedido ${apelido}`,
          status: ApprovalState.pendente,
          nivelExigido: RiskLevel.R2,
          alcadaMinima: 'operador',
          tokenHash: `token-${apelido}-${Math.random()}`,
          expiraEm: new Date(Date.now() + 10 * MIN),
          resourceType: 'lead',
          resourceId: lead.id,
          ...extra,
        },
        select: { id: true },
      });

    // O pedido legítimo: hash de E3, resumo do servidor dizendo E3.
    ids.certo = (
      await aprovacao('certo', {
        contentHash: hashDaSuperficieAntiga('lead', { para: 'reuniao_agendada' }),
        resumo: resumoDoFunil('E2 · Qualificação', 'E3 · Reunião agendada'),
      })
    ).id;
    // O forjado do laudo: hash de E7, resumo dizendo E3.
    ids.forjado = (
      await aprovacao('forjado', {
        contentHash: hashDaSuperficieAntiga('lead', { para: 'follow_up' }),
        resumo: resumoDoFunil('E2 · Qualificação', 'E3 · Reunião agendada'),
      })
    ).id;
    // PA-8: confirmada da superfície do token, vencida há uma hora.
    ids.confirmadaVencida = (
      await aprovacao('confirmada-vencida', {
        contentHash: hashDaSuperficieAntiga('lead', { para: 'reuniao_agendada' }),
        resumo: resumoDoFunil('E1 · Novo lead', 'E3 · Reunião agendada'),
        status: ApprovalState.confirmada,
        aprovadoPorId: ANA,
        aprovadoEm: new Date(Date.now() - 65 * MIN),
        criadoEm: new Date(Date.now() - 70 * MIN),
        expiraEm: new Date(Date.now() - 60 * MIN),
      })
    ).id;
    // PA-8: confirmada da PORTA, vencida: fica como estava (o limbo dela sai pela recusa).
    const chamada = await prisma.toolCall.create({
      data: {
        orgId: ORG,
        capabilityId: CAP,
        actorType: ActorType.user,
        actorId: BETO,
        status: ToolCallStatus.aguardando_aprovacao,
        args: { leadId: lead.id, mensagemId: 'm-1', texto: 'Oi', destino: 'lead' },
        nivel: RiskLevel.R3,
      },
      select: { id: true },
    });
    ids.daPorta = (
      await aprovacao('da-porta', {
        capabilityId: CAP,
        toolCallId: chamada.id,
        resourceType: CAP,
        resourceId: 'm-1',
        status: ApprovalState.confirmada,
        aprovadoPorId: ANA,
        aprovadoEm: new Date(Date.now() - 65 * MIN),
        criadoEm: new Date(Date.now() - 80 * MIN),
        expiraEm: new Date(Date.now() - 60 * MIN),
      })
    ).id;

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
    mover = new MoverService(p, undefined as never, approvals);
  });

  afterAll(async () => {
    await prisma.approval.deleteMany({ where: { orgId: ORG } });
    await prisma.toolCall.deleteMany({ where: { orgId: ORG } });
    await prisma.auditLog.deleteMany({ where: { orgId: ORG } });
    await prisma.lead.deleteMany({ where: { orgId: ORG } });
    await prisma.user.deleteMany({ where: { orgId: ORG } });
    await prisma.role.deleteMany({ where: { orgId: ORG } });
    await prisma.org.deleteMany({ where: { id: ORG } });
    await prisma.$disconnect();
  });

  const item = async (id: string) => (await controlador.fila(sessao(ANA))).itens.find((i) => i.id === id);

  it('PA-1: o pedido certo traz o destino conferido e pode ser assinado', async () => {
    const i = await item(ids.certo);
    expect(i?.destinoConferido).toEqual({ etapa: 'reuniao_agendada', rotulo: 'E3 · Reunião agendada' });
    expect(i?.impedimento).toBeNull();
    expect(i?.euPossoAprovar).toBe(true);
  });

  it('PA-1: o forjado mostra o destino REAL, fica impedido e sem botão', async () => {
    const i = await item(ids.forjado);
    expect(i?.destinoConferido).toEqual({ etapa: 'follow_up', rotulo: 'E7 · Follow-up' });
    expect(i?.impedimento).toBe(DESTINO_NAO_CONFERE);
    expect(i?.euPossoAprovar).toBe(false);
    expect(i?.porQueNao).toBe(DESTINO_NAO_CONFERE);
  });

  it('PA-1: o servidor recusa confirmar o forjado, e a aprovação continua pendente', async () => {
    await expect(controlador.confirm(sessao(ANA), ids.forjado, {}, undefined)).rejects.toThrow(DESTINO_NAO_CONFERE);
    expect((await prisma.approval.findUnique({ where: { id: ids.forjado } }))?.status).toBe(ApprovalState.pendente);
  });

  it('PA-8: a confirmada do token que venceu vai para "expirou", sem botão, e para depois das que valem', async () => {
    const fila = await controlador.fila(sessao(ANA));
    const i = fila.itens.find((x) => x.id === ids.confirmadaVencida);
    expect(i?.gaveta).toBe('expirou');
    expect(i?.euPossoAprovar).toBe(false);
    expect(i?.porQueNao).toMatch(/prazo venceu antes de quem pediu concluir/);
    const ordem = fila.itens.map((x) => x.id);
    expect(ordem.indexOf(ids.confirmadaVencida)).toBeGreaterThan(ordem.indexOf(ids.certo));
    expect(ordem.indexOf(ids.confirmadaVencida)).toBeGreaterThan(ordem.indexOf(ids.forjado));
    // Só leitura: o estado gravado não mudou.
    expect((await prisma.approval.findUnique({ where: { id: ids.confirmadaVencida } }))?.status).toBe(ApprovalState.confirmada);
  });

  it('PA-8: a confirmada da porta, mesmo vencida, segue na gaveta "confirmada" e na frente', async () => {
    const fila = await controlador.fila(sessao(ANA));
    const i = fila.itens.find((x) => x.id === ids.daPorta);
    expect(i?.gaveta).toBe('confirmada');
    expect(fila.itens.map((x) => x.id).indexOf(ids.daPorta)).toBe(0);
  });

  it('PA-7: quem pediu lê o estado do próprio pedido, com o destino do hash; outra pessoa não lê', async () => {
    const meu = await mover.estadoDoPedido(ORG, ids.lead, BETO, ids.certo);
    expect(meu).toMatchObject({ approvalId: ids.certo, estado: 'esperando', para: 'reuniao_agendada', confirmadaPor: null });
    expect(JSON.stringify(meu)).not.toMatch(/token/i);
    const vencido = await mover.estadoDoPedido(ORG, ids.lead, BETO, ids.confirmadaVencida);
    expect(vencido).toMatchObject({ estado: 'venceu', confirmadaPor: ANA });
    expect(await mover.estadoDoPedido(ORG, ids.lead, ANA, ids.certo)).toBeNull();
    expect(await mover.estadoDoPedido('outra-empresa', ids.lead, BETO, ids.certo)).toBeNull();
  });

  it('PA-7: confirmado, o estado vira "confirmada" com o nome de quem assinou', async () => {
    await controlador.confirm(sessao(ANA), ids.certo, {}, undefined);
    const meu = await mover.estadoDoPedido(ORG, ids.lead, BETO, ids.certo);
    expect(meu).toMatchObject({ estado: 'confirmada', confirmadaPor: ANA });
    expect(meu?.confirmadaEm).toBeTruthy();
  });
});
