import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ConflictException, ForbiddenException, GoneException } from '@nestjs/common';
import { ActorType, ApprovalState, PrismaClient, RiskLevel, ToolCallStatus } from '@prisma/client';

import { ApprovalsController } from '../src/approvals/approvals.controller';
import { ApprovalsService, hashDaSuperficieAntiga } from '../src/approvals/approvals.service';
import {
  EVENTO_DA_LIMPEZA,
  LimpezaDasVencidasService,
  SLUG_DA_LIMPEZA_DAS_VENCIDAS,
  TIPO_DA_LIMPEZA_DAS_VENCIDAS,
  resumoDaLimpeza,
} from '../src/approvals/limpeza-das-vencidas';
import { MOTIVO_SEM_CAMINHO, MOTIVOS_SEM_REPEDIDO, RepedidosRegistry, chaveDoPedido } from '../src/approvals/repedidos.registry';
import { AuditService } from '../src/audit/audit.service';
import { RepedidosDoComercial } from '../src/comercial/repedidos-do-comercial';
import { AcoesService } from '../src/gateway/acoes.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { EventLogService } from '../src/gateway/event-log.service';
import { ToolGateway } from '../src/gateway/tool-gateway.service';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ExecutoresDeRotinaRegistry } from '../src/routines/executores.registry';
import { ExecutorDaLimpezaDasVencidas } from '../src/routines/executores/aprovacoes-vencidas.executor';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * RODADA DO TRABALHO T7 (19/10/2026) — decidir sem trocar de tela.
 *
 *   · a vencida não se aprova: ganha "pedir de novo", que recria o pedido pelo
 *     caminho do domínio (registro), em nome de quem clicou, que então não assina;
 *   · tipo sem caminho seguro não ganha o botão, e a fila diz por quê;
 *   · a limpeza diária marca `expirada` só a `pendente` vencida, como sistema,
 *     com evento no RASTRO.
 */

describe('o registro do pedir de novo (puro)', () => {
  it('a chave é a capacidade, ou legado:<recurso> na superfície do token', () => {
    expect(chaveDoPedido('comercial.sala.publicar', 'comercial.sala')).toBe('comercial.sala.publicar');
    expect(chaveDoPedido(null, 'lead')).toBe('legado:lead');
  });

  it('inscrição dupla lança, e tipo da lista negativa não se inscreve', () => {
    const r = new RepedidosRegistry();
    r.inscrever('x.y', { permissoes: [], repedir: async () => ({ approvalId: null }) }, 'A');
    expect(() => r.inscrever('x.y', { permissoes: [], repedir: async () => ({ approvalId: null }) }, 'B')).toThrow(/duas vezes/);
    expect(() => r.inscrever('email.enviar', { permissoes: [], repedir: async () => ({ approvalId: null }) })).toThrow(/não se refazem/);
  });

  it('sem inscrição não há botão, com o motivo certo', () => {
    const r = new RepedidosRegistry();
    expect(r.porQueNao('email.enviar')).toBe(MOTIVOS_SEM_REPEDIDO['email.enviar']);
    expect(r.porQueNao('qualquer.coisa')).toBe(MOTIVO_SEM_CAMINHO);
  });

  it('o resumo da limpeza diz a contagem e a sobra', () => {
    expect(resumoDaLimpeza(0, false)).toMatch(/nenhuma/);
    expect(resumoDaLimpeza(1, false)).toBe('1 aprovação vencida marcada como expirada.');
    expect(resumoDaLimpeza(3, true)).toMatch(/3 aprovações.*Há mais/);
  });
});

describe('o comercial pede de novo pelo caminho de cada pedido (dublês)', () => {
  const base = {
    orgId: 'o',
    approvalId: 'venc',
    capabilityId: null,
    resourceType: 'lead',
    resourceId: 'L1',
    contentHash: hashDaSuperficieAntiga('lead', { para: 'reuniao_agendada' }),
    args: null,
    quem: { id: 'ana', nome: 'Ana', papeis: ['admin_master'] },
  };
  const montar = (o: Record<string, unknown>) => {
    const registro = new RepedidosRegistry();
    const r = new RepedidosDoComercial(
      registro,
      (o.salas ?? {}) as never,
      (o.propostas ?? {}) as never,
      (o.whats ?? {}) as never,
      (o.dinheiro ?? {}) as never,
      (o.fechamentos ?? {}) as never,
    );
    r.onModuleInit();
    return { r, registro };
  };

  it('inscreve os sete pedidos do comercial, todos com leads.editar', () => {
    const { registro } = montar({});
    expect(registro.inscritos).toEqual(
      [
        'comercial.cobranca.criar',
        'comercial.contrato.enviar',
        'comercial.fechamento.executar',
        'comercial.proposta.publicar',
        'comercial.sala.publicar',
        'comercial.whatsapp.enviar',
        'legado:lead',
      ].sort(),
    );
    for (const k of registro.inscritos) expect(registro.de(k)!.permissoes).toEqual(['leads.editar']);
  });

  // U4 (20/10/2026): o mover não pede mais assinatura. Pedir de novo um mover vencido responde 410 e não cria nada.
  it('mover: o pedido vencido de mover não volta à fila (aposentado); o que não é mover segue recusado', async () => {
    const { r } = montar({});
    await expect(r.moverDeNovo(base)).rejects.toBeInstanceOf(GoneException);
    await expect(r.moverDeNovo(base)).rejects.toThrow(/move direto no funil/);
    await expect(r.moverDeNovo({ ...base, contentHash: hashDaSuperficieAntiga('lead', { status: 'ganho' }) })).rejects.toThrow(ConflictException);
  });

  it('proposta: relê a versão do recurso e só devolve aprovação quando foi à porta', async () => {
    const repedirLiberacao = vi.fn(async () => ({ estado: 'na_porta', approvalId: 'np', versao: 2 }));
    const { r } = montar({ propostas: { repedirLiberacao } });
    const p = { ...base, capabilityId: 'comercial.proposta.publicar', resourceType: 'comercial.proposta', resourceId: 'L1:v2', args: { leadId: 'L1', versao: 2 } };
    expect(await r.propostaDeNovo(p)).toEqual({ approvalId: 'np' });
    expect(repedirLiberacao).toHaveBeenCalledWith('o', 'L1', 2, 'venc', { id: 'ana' });
    repedirLiberacao.mockResolvedValueOnce({ estado: 'segurada', approvalId: null, versao: 2 });
    await expect(r.propostaDeNovo(p)).rejects.toThrow(ConflictException);
  });

  it('cobrança: pega o pedido da cobrança e avisa quando o contrato foi junto; já existente recusa', async () => {
    const proporAceite = vi.fn(async () => ({ cobranca: 'proposta', contrato: 'proposta', approvalIds: ['c1', 'k1'] }));
    const { r } = montar({ dinheiro: { proporAceite } });
    const p = { ...base, capabilityId: 'comercial.cobranca.criar', resourceType: 'comercial.cobranca', resourceId: 'L1:v1', args: { leadId: 'L1' } };
    const out = await r.aceiteDeNovo(p, 'cobranca');
    expect(out.approvalId).toBe('c1');
    expect(out.aviso).toMatch(/contrato também/);
    expect((await r.aceiteDeNovo(p, 'contrato')).approvalId).toBe('k1');
    proporAceite.mockResolvedValueOnce({ cobranca: 'ja_existe', contrato: 'ja_existe', approvalIds: [] });
    await expect(r.aceiteDeNovo(p, 'cobranca')).rejects.toThrow(/já existe/);
  });
});

const URL = process.env.TEST_DATABASE_URL;
if (URL) exigirBancoDescartavel(URL, 'cria e apaga empresas, usuários, aprovações e eventos');

const ORG = 'org-t7-pedir-de-novo';
const PERMS = ['aprovacoes.ver', 'aprovacoes.decidir', 'leads.editar'];
const MIN = 60_000;

describe.skipIf(!URL)('pedir de novo e a limpeza das vencidas, contra o banco', () => {
  let prisma: PrismaClient;
  let controlador: ApprovalsController;
  let approvals: ApprovalsService;
  let limpeza: LimpezaDasVencidasService;
  const ANA = `ana-${ORG}`;
  const BETO = `beto-${ORG}`;
  const ids: Record<string, string> = {};
  let leadId = '';
  const chamadasDoDominio: Array<{ approvalId: string; quem: string; contentHash: string }> = [];

  const sessao = (sub: string, permissions = PERMS) =>
    ({ sub, orgId: ORG, email: `${sub}@teste`, name: sub, roles: ['admin_master'], permissions }) as never;

  const aprovacao = (extra: Record<string, unknown>) =>
    prisma.approval.create({
      data: {
        orgId: ORG,
        propostoPorId: BETO,
        propostoPorTipo: ActorType.user,
        contentHash: hashDaSuperficieAntiga('lead', { para: 'reuniao_agendada' }),
        resumo: 'Mover Construtora Alicerce de E2 · Qualificação para E3 · Reunião agendada (portões cumpridos).',
        status: ApprovalState.pendente,
        nivelExigido: RiskLevel.R2,
        alcadaMinima: 'operador',
        tokenHash: `t-${Math.random()}`,
        expiraEm: new Date(Date.now() - 30 * MIN),
        criadoEm: new Date(Date.now() - 40 * MIN),
        resourceType: 'lead',
        resourceId: leadId,
        ...extra,
      },
      select: { id: true },
    });

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    for (const key of PERMS) await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
    await prisma.org.upsert({ where: { id: ORG }, create: { id: ORG, name: ORG, slug: ORG }, update: {} });
    const papel = await prisma.role.upsert({
      where: { orgId_key: { orgId: ORG, key: 'admin_master' } },
      create: { orgId: ORG, key: 'admin_master', name: 'admin', permissions: { connect: PERMS.map((key) => ({ key })) } },
      update: {},
      select: { id: true },
    });
    for (const id of [ANA, BETO]) {
      await prisma.user.upsert({
        where: { id },
        create: { id, orgId: ORG, name: id, email: `${id}@teste.t7`, passwordHash: 'x', roles: { connect: { id: papel.id } } },
        update: { isActive: true },
      });
    }
    leadId = (await prisma.lead.create({ data: { orgId: ORG, name: 'Construtora Alicerce' }, select: { id: true } })).id;

    ids.vencida = (await aprovacao({})).id;
    ids.viva = (await aprovacao({ expiraEm: new Date(Date.now() + 10 * MIN), resourceId: 'outro-lead' })).id;
    ids.recusada = (await aprovacao({ status: ApprovalState.rejeitada, resourceId: 'lead-recusado' })).id;
    // Vencida de um tipo sem caminho seguro (o texto do e-mail não fica guardado).
    const chamada = await prisma.toolCall.create({
      data: {
        orgId: ORG,
        capabilityId: 'email.enviar',
        actorType: ActorType.user,
        actorId: BETO,
        status: ToolCallStatus.aguardando_aprovacao,
        args: { para: 'x@y.z', assunto: 'Oi', corpo: 'texto' },
        nivel: RiskLevel.R3,
      },
      select: { id: true },
    });
    ids.email = (
      await aprovacao({ capabilityId: 'email.enviar', toolCallId: chamada.id, resourceType: 'email.enviar', resourceId: 'e-1', nivelExigido: RiskLevel.R3 })
    ).id;
    // Para a limpeza: uma confirmada vencida (não é tocada) e uma pendente vencida.
    ids.confirmadaVencida = (await aprovacao({ status: ApprovalState.confirmada, resourceId: 'lead-conf', aprovadoPorId: ANA })).id;
    ids.paraLimpar = (await aprovacao({ resourceId: 'lead-limpar' })).id;

    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    const policy = new PolicyService(p);
    await policy.onModuleInit();
    approvals = new ApprovalsService(p, audit);
    const eventos = new EventLogService(p);
    const gateway = new ToolGateway(p, policy, new SinaisService(p, policy), approvals, eventos, undefined, undefined, new EfeitosRegistry());
    const repedidos = new RepedidosRegistry();
    /*
     * A receita de teste faz o que o domínio faz: cria o pedido do zero em nome
     * de quem clicou (aqui pela superfície do token, como o `PATCH /leads/:id`;
     * o mover do funil não pede mais assinatura desde a U4, 20/10/2026, e o
     * pedido de mover que nascesse aqui ficaria impedido na fila).
     */
    repedidos.inscrever('legado:lead', {
      permissoes: ['leads.editar'],
      repedir: async (pv) => {
        chamadasDoDominio.push({ approvalId: pv.approvalId, quem: pv.quem.id, contentHash: pv.contentHash });
        const t = await approvals.create({
          orgId: pv.orgId,
          actorId: pv.quem.id,
          resourceType: 'lead',
          resourceId: pv.resourceId,
          changes: { status: 'ganho' },
          summary: 'Marcar Construtora Alicerce como ganho.',
          propostoPorTipo: ActorType.user,
        });
        return { approvalId: t.approvalId, paraQuemPediu: { token: t.token } };
      },
    });
    limpeza = new LimpezaDasVencidasService(p, approvals, eventos);
    controlador = new ApprovalsController(approvals, new AcoesService(p, gateway, eventos, undefined, policy), p, gateway, repedidos, limpeza);
  });

  afterAll(async () => {
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
      prisma.eventLog.deleteMany({ where: { orgId: ORG } }),
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
    ]);
    await prisma.rotina.deleteMany({ where: { orgId: ORG } });
    await prisma.approval.deleteMany({ where: { orgId: ORG } });
    await prisma.toolCall.deleteMany({ where: { orgId: ORG } });
    await prisma.auditLog.deleteMany({ where: { orgId: ORG } });
    await prisma.lead.deleteMany({ where: { orgId: ORG } });
    await prisma.user.deleteMany({ where: { orgId: ORG } });
    await prisma.role.deleteMany({ where: { orgId: ORG } });
    await prisma.org.deleteMany({ where: { id: ORG } });
    await prisma.$disconnect();
  });

  const item = async (id: string, sub = ANA, permissions = PERMS) =>
    (await controlador.fila(sessao(sub, permissions))).itens.find((i) => i.id === id);

  it('a fila oferece "pedir de novo" na vencida com caminho, e só nela', async () => {
    const v = await item(ids.vencida);
    expect(v?.gaveta).toBe('expirou');
    expect(v?.euPossoAprovar).toBe(false);
    expect(v?.pedirDeNovo).toEqual({ pode: true, porQueNao: null });
    expect((await item(ids.viva))?.pedirDeNovo).toBeNull();
    expect((await item(ids.recusada))?.pedirDeNovo).toBeNull();
  });

  it('tipo sem caminho seguro não ganha o botão, e a fila diz por quê', async () => {
    const e = await item(ids.email);
    expect(e?.pedirDeNovo).toEqual({ pode: false, porQueNao: MOTIVOS_SEM_REPEDIDO['email.enviar'] });
  });

  it('sem a permissão da rota de origem, não pede de novo', async () => {
    const v = await item(ids.vencida, ANA, ['aprovacoes.ver']);
    expect(v?.pedirDeNovo?.pode).toBe(false);
    expect(v?.pedirDeNovo?.porQueNao).toMatch(/leads\.editar/);
    await expect(controlador.pedirDeNovo(sessao(ANA, ['aprovacoes.ver']), ids.vencida)).rejects.toThrow(ForbiddenException);
  });

  it('abrir a fila semeia a rotina diária da limpeza', async () => {
    await new Promise((r) => setTimeout(r, 200));
    const r = await prisma.rotina.findFirst({ where: { orgId: ORG, slug: SLUG_DA_LIMPEZA_DAS_VENCIDAS } });
    expect(r?.tipo).toBe(TIPO_DA_LIMPEZA_DAS_VENCIDAS);
    expect(r?.cron).toBe('0 3 * * *');
  });

  it('a viva e a recusada não se pedem de novo', async () => {
    await expect(controlador.pedirDeNovo(sessao(ANA), ids.viva)).rejects.toThrow(ConflictException);
    await expect(controlador.pedirDeNovo(sessao(ANA), ids.recusada)).rejects.toThrow(ConflictException);
  });

  it('pedir de novo cria o pedido pelo caminho do domínio, em nome de quem clicou; a vencida fica expirada', async () => {
    const r = await controlador.pedirDeNovo(sessao(ANA), ids.vencida);
    expect(r.anterior).toBe(ids.vencida);
    expect(r.approvalId).toBeTruthy();
    expect(r.approvalId).not.toBe(ids.vencida);
    expect(r.paraQuemPediu).toHaveProperty('token');
    expect(chamadasDoDominio).toEqual([{ approvalId: ids.vencida, quem: ANA, contentHash: hashDaSuperficieAntiga('lead', { para: 'reuniao_agendada' }) }]);

    const velha = await prisma.approval.findUnique({ where: { id: ids.vencida } });
    expect(velha?.status).toBe(ApprovalState.expirada);
    const nova = await prisma.approval.findUnique({ where: { id: r.approvalId! } });
    expect(nova?.propostoPorId).toBe(ANA);
    expect(nova?.status).toBe(ApprovalState.pendente);
    expect(nova!.expiraEm.getTime()).toBeGreaterThan(Date.now());

    const linha = await prisma.auditLog.findFirst({ where: { orgId: ORG, action: 'approval.pedida-de-novo' } });
    expect(linha?.actorId).toBe(ANA);
    expect(linha?.after).toEqual({ vencida: ids.vencida, nova: r.approvalId });
    ids.nova = r.approvalId!;
  });

  it('quem pediu de novo não assina o pedido novo (invariante 7); a outra pessoa pode', async () => {
    const minha = await item(ids.nova, ANA);
    expect(minha?.euPossoAprovar).toBe(false);
    expect(minha?.porQueNao).toMatch(/propôs/);
    await expect(approvals.confirm(ORG, ids.nova, { id: ANA, papeis: ['admin_master'] })).rejects.toThrow(/Quem propôs/);
    expect((await item(ids.nova, BETO))?.euPossoAprovar).toBe(true);
  });

  it('com o pedido novo vivo, a vencida não se pede de novo outra vez', async () => {
    expect((await item(ids.vencida))?.pedirDeNovo).toEqual({ pode: false, porQueNao: 'Já há um pedido vivo para isto na fila.' });
    await expect(controlador.pedirDeNovo(sessao(BETO), ids.vencida)).rejects.toThrow(ConflictException);
    expect(chamadasDoDominio).toHaveLength(1);
  });

  it('a limpeza marca só a pendente vencida, como sistema, com evento no RASTRO', async () => {
    const r = await limpeza.passagem(ORG, new Date());
    expect(r.quantas).toBeGreaterThanOrEqual(2); // paraLimpar e a do e-mail
    const estados = await prisma.approval.findMany({
      where: { id: { in: [ids.paraLimpar, ids.email, ids.confirmadaVencida, ids.viva, ids.nova, ids.recusada] } },
      select: { id: true, status: true },
    });
    const de = Object.fromEntries(estados.map((e) => [e.id, e.status]));
    expect(de[ids.paraLimpar]).toBe(ApprovalState.expirada);
    expect(de[ids.email]).toBe(ApprovalState.expirada);
    expect(de[ids.confirmadaVencida]).toBe(ApprovalState.confirmada);
    expect(de[ids.viva]).toBe(ApprovalState.pendente);
    expect(de[ids.nova]).toBe(ApprovalState.pendente);
    expect(de[ids.recusada]).toBe(ApprovalState.rejeitada);

    const ev = await prisma.eventLog.findFirst({ where: { orgId: ORG, tipo: EVENTO_DA_LIMPEZA } });
    expect(ev?.actorType).toBe(ActorType.system);
    expect(JSON.stringify(ev?.payload)).toContain(ids.paraLimpar);
  });

  it('passagem sem nada vencido é pulada e não escreve evento', async () => {
    const registro = new ExecutoresDeRotinaRegistry();
    const executor = new ExecutorDaLimpezaDasVencidas(limpeza, registro);
    executor.onModuleInit();
    expect(registro.tem(TIPO_DA_LIMPEZA_DAS_VENCIDAS)).toBe(true);
    const antes = await prisma.eventLog.count({ where: { orgId: ORG, tipo: EVENTO_DA_LIMPEZA } });
    const r = await registro.executar(TIPO_DA_LIMPEZA_DAS_VENCIDAS, {
      orgId: ORG,
      rotinaId: 'r',
      slug: SLUG_DA_LIMPEZA_DAS_VENCIDAS,
      config: {},
      refExterna: null,
      origem: 'manual',
      agora: new Date(),
    } as never);
    expect(r).toEqual({ status: 'pulada', resumo: 'nenhuma aprovação vencida esperando.' });
    expect(await prisma.eventLog.count({ where: { orgId: ORG, tipo: EVENTO_DA_LIMPEZA } })).toBe(antes);
  });
});
