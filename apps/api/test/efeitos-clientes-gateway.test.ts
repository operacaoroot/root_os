import { createHash } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { ActorType, ApprovalState, RiskLevel, type Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalsService, canonicalHash } from '../src/approvals/approvals.service';
import type { AuditService } from '../src/audit/audit.service';
import type { EfeitoClienteEscopoService } from '../src/clientes-escopo/efeito-cliente-escopo.service';
import { contextoAtual } from '../src/common/contexto-execucao';
import { AcoesService } from '../src/gateway/acoes.service';
import { EfeitosRegistry, type ContextoDoEfeito } from '../src/gateway/efeitos.registry';
import type { EventLogService } from '../src/gateway/event-log.service';
import { ToolGateway, type ExecCtx } from '../src/gateway/tool-gateway.service';
import type { PolicyService } from '../src/policy/policy.service';
import type { SinaisService } from '../src/policy/sinais.service';
import type { PrismaService } from '../src/prisma/prisma.service';

const ORG = 'org-qa';
const TOKEN = 'token-ficticio-apenas-para-teste';
const APROVACAO = 'aprovacao-persistida';
const APROVADOR = 'pessoa-que-aprovou';
const CAPACIDADES = [
  { id: 'drive.pasta.criar', resource: { type: 'cliente', id: 'cliente-qa' }, args: { clienteId: 'cliente-qa', nome: 'Pasta QA' } },
  { id: 'drive.arquivo.enviar', resource: { type: 'arquivo-do-cliente', id: 'arquivo-qa' }, args: {
    clienteId: 'cliente-qa', subpasta: '04-entrega', nome: 'Arquivo QA', chave: 'qa/storage', sha256: 'a'.repeat(64), bytes: 8,
  } },
];

function montar(capacidade: typeof CAPACIDADES[number], op: { semGuarda?: boolean; exigeAprovacao?: boolean } = {}) {
  const { id, resource, args } = capacidade;
  const ap = {
    id: APROVACAO, orgId: ORG, capabilityId: id, toolCallId: 'chamada-retida',
    aprovadoPorId: APROVADOR, aprovadoEm: new Date(), propostoPorId: 'proponente',
    resourceType: resource.type, resourceId: resource.id, nivelExigido: RiskLevel.R3,
    contentHash: canonicalHash(resource.type, args, []), resumo: 'Teste de Drive', motivo: null, canal: 'gdrive',
    status: ApprovalState.confirmada as ApprovalState, expiraEm: new Date(Date.now() + 60_000),
    tokenHash: createHash('sha256').update(TOKEN).digest('hex'),
  };
  const ler = async ({ where }: { where: Prisma.ApprovalWhereInput }) => {
    if ((where.id && where.id !== ap.id) || (where.orgId && where.orgId !== ap.orgId)
      || (where.tokenHash && where.tokenHash !== ap.tokenHash) || (where.capabilityId && where.capabilityId !== ap.capabilityId)
      || (where.status && where.status !== ap.status)) return null;
    return { ...ap };
  };
  const updateMany = vi.fn(async ({ where }: { where: Prisma.ApprovalWhereInput }) => {
    if (where.status !== ap.status || where.id !== ap.id) return { count: 0 };
    ap.status = ApprovalState.consumida;
    return { count: 1 };
  });
  const prisma = {
    approval: { findFirst: vi.fn(ler), findUnique: vi.fn(ler), updateMany },
    policyDecision: { update: async () => ({}) },
    toolCall: {
      findFirst: async () => ({ id: ap.toolCallId, args, capabilityId: id, agentSlug: null, correlationId: 'proposta-qa' }),
      create: async () => ({ id: 'chamada-atual' }),
      update: async () => ({}),
    },
  } as unknown as PrismaService;
  const decisao = { permitido: true, exigeAprovacao: op.exigeAprovacao ?? true, nivel: 'R3', motivo: 'Escrita de teste', sinaisAcionados: [] };
  const policy = {
    resolverCapacidade: () => ({ id, argsSchema: { type: 'object' }, efeito: { sensibilidade: 'confidencial' }, hashKeys: [] }),
    simular: () => decisao,
    avaliarERegistrar: async () => ({ decisao, decisionId: 'decisao-qa' }),
  } as unknown as PolicyService;
  const sinais = { calcular: async () => [] } as unknown as SinaisService;
  const audit = { log: async () => ({}) } as unknown as AuditService;
  const eventos = { registrar: async () => ({}) } as unknown as EventLogService;
  const approvals = new ApprovalsService(prisma, audit);
  const propor = vi.spyOn(approvals, 'propor').mockResolvedValue({
    approvalId: 'nova-proposta', resumo: 'Pedido retido', expiraEm: new Date().toISOString(), token: 'novo-token-ficticio',
  } as Awaited<ReturnType<ApprovalsService['propor']>>);
  const consumir = vi.spyOn(approvals, 'consumir');
  const exigirAntesDaAprovacao = vi.fn(async (_orgId: string, _capabilityId: string, _approvalId: string, _args: Record<string, unknown>) => {
    expect(ap.status).toBe(ApprovalState.confirmada);
  });
  const guarda = { exigirAntesDaAprovacao } as unknown as EfeitoClienteEscopoService;
  const registro = new EfeitosRegistry();
  const efeito = vi.fn(async (_args: Record<string, unknown>, ctx: ContextoDoEfeito) => ({
    ctx, atorDoContexto: contextoAtual()?.actorId, tipoDoContexto: contextoAtual()?.actorType,
  }));
  registro.registrar({ [id]: (entrada, _org, ctx) => efeito(entrada, ctx) }, 'Teste sem Drive');
  const gateway = new ToolGateway(
    prisma, policy, sinais, approvals, eventos, undefined, undefined, registro, undefined, op.semGuarda ? undefined : guarda,
  );
  const acoes = new AcoesService(prisma, gateway, eventos, undefined, policy, approvals);
  const ctx: ExecCtx & { approvalId: string } = {
    orgId: ORG, actorId: 'agente-chamador', actorType: ActorType.ai, correlationId: 'token-qa', approvalId: 'id-injetado',
  };
  const chamar = (token?: string, alvo = resource, contexto: ExecCtx = ctx) => gateway.executar(
    { capabilityId: id, args, ctx: contexto, approvalToken: token, resource: alvo },
    (entrada, contextoDoEfeito) => efeito(entrada, contextoDoEfeito),
  );

  return { ap, acoes, chamar, efeito, ctx, exigirAntesDaAprovacao, updateMany, consumir, propor };
}

describe.each(CAPACIDADES)('aprovação e carteira para $id', (capacidade) => {
  it('usa o ID persistido do token e executa como quem aprovou, com uso único', async () => {
    const m = montar(capacidade);
    const primeiro = await m.chamar(TOKEN);
    expect(primeiro).toMatchObject({ status: 'executado', resultado: {
      ctx: { orgId: ORG, approvalId: APROVACAO, actorId: APROVADOR, actorType: ActorType.user },
      atorDoContexto: APROVADOR, tipoDoContexto: ActorType.user,
    } });
    expect(m.exigirAntesDaAprovacao).toHaveBeenCalledWith(ORG, capacidade.id, APROVACAO, capacidade.args);
    expect(await m.chamar(TOKEN)).toMatchObject({ status: 'recusado' });
    expect(m.ap.status).toBe(ApprovalState.consumida);
    expect(m.efeito).toHaveBeenCalledTimes(1);
    expect(m.updateMany).toHaveBeenCalledTimes(1);
  });

  it('recusa o token antes do consumo se a autorização original mudou', async () => {
    const m = montar(capacidade);
    m.exigirAntesDaAprovacao.mockRejectedValueOnce(new ForbiddenException('Autorização revogada.'));
    expect(await m.chamar(TOKEN)).toMatchObject({ status: 'recusado' });
    expect(m.ap.status).toBe(ApprovalState.confirmada);
    expect(m.consumir).not.toHaveBeenCalled();
    expect(m.updateMany).not.toHaveBeenCalled();
    expect(m.efeito).not.toHaveBeenCalled();
  });

  it('devolve uma recusa genérica se a consulta falhar com detalhes internos', async () => {
    const m = montar(capacidade);
    m.exigirAntesDaAprovacao.mockRejectedValueOnce(new Error(`Falha interna com tokenHash: ${m.ap.tokenHash}`));
    const resultado = await m.chamar(TOKEN);
    expect(resultado).toMatchObject({ status: 'recusado' });
    expect(JSON.stringify(resultado)).not.toContain(m.ap.tokenHash);
    expect(m.updateMany).not.toHaveBeenCalled();
  });

  it('preserva a aprovação quando o token é usado com outro recurso', async () => {
    const m = montar(capacidade);
    expect(await m.chamar(TOKEN, { ...capacidade.resource, id: 'recurso-forjado' })).toMatchObject({ status: 'recusado' });
    expect(m.ap.status).toBe(ApprovalState.confirmada);
    expect(m.updateMany).not.toHaveBeenCalled();
    expect(m.efeito).not.toHaveBeenCalled();
  });

  it('recusa a execução pós-confirmação antes do consumo se a autorização original mudou', async () => {
    const m = montar(capacidade);
    m.exigirAntesDaAprovacao.mockRejectedValueOnce(new ForbiddenException('Autorização revogada.'));
    await expect(m.acoes.executarAprovada(ORG, APROVACAO, APROVADOR)).rejects.toBeInstanceOf(ForbiddenException);
    expect(m.ap.status).toBe(ApprovalState.confirmada);
    expect(m.updateMany).not.toHaveBeenCalled();
    expect(m.efeito).not.toHaveBeenCalled();
  });

  it('confere a carteira e preserva o uso único na execução pós-confirmação', async () => {
    const m = montar(capacidade);
    expect(await m.acoes.executarAprovada(ORG, APROVACAO, APROVADOR)).toMatchObject({
      status: 'executado', resultado: { ctx: { approvalId: APROVACAO, actorId: APROVADOR, actorType: ActorType.user } },
    });
    await expect(m.acoes.executarAprovada(ORG, APROVACAO, APROVADOR)).rejects.toThrow(/uso único/);
    expect(m.exigirAntesDaAprovacao).toHaveBeenCalledExactlyOnceWith(ORG, capacidade.id, APROVACAO, capacidade.args);
    expect(m.updateMany).toHaveBeenCalledTimes(1);
    expect(m.efeito).toHaveBeenCalledTimes(1);
  });

  it('recusa um ator pós-confirmação diferente do aprovador persistido', async () => {
    const m = montar(capacidade);
    await expect(m.acoes.executarAprovada(ORG, APROVACAO, 'outra-pessoa')).rejects.toBeInstanceOf(ForbiddenException);
    expect(m.updateMany).not.toHaveBeenCalled();
    expect(m.efeito).not.toHaveBeenCalled();
  });

  it('falha fechada nos dois caminhos sem o verificador da carteira', async () => {
    const m = montar(capacidade, { semGuarda: true });
    expect(await m.chamar(TOKEN)).toMatchObject({ status: 'recusado' });
    await expect(m.acoes.executarAprovada(ORG, APROVACAO, APROVADOR)).rejects.toBeInstanceOf(ForbiddenException);
    expect(m.updateMany).not.toHaveBeenCalled();
    expect(m.efeito).not.toHaveBeenCalled();
  });

  it('retém uma proposta sem token mesmo com approvalId forjado no contexto', async () => {
    const m = montar(capacidade);
    expect(await m.chamar()).toMatchObject({ status: 'aguardando_aprovacao', approvalId: 'nova-proposta' });
    expect(m.propor).toHaveBeenCalledTimes(1);
    expect(m.consumir).not.toHaveBeenCalled();
    expect(m.efeito).not.toHaveBeenCalled();
  });

  it('recusa Drive se a configuração vigente deixou de exigir aprovação', async () => {
    const m = montar(capacidade, { exigeAprovacao: false });
    expect(await m.chamar()).toMatchObject({ status: 'recusado' });
    expect(await m.chamar(TOKEN)).toMatchObject({ status: 'recusado' });
    expect(m.updateMany).not.toHaveBeenCalled();
    expect(m.efeito).not.toHaveBeenCalled();
  });
});

it('descarta approvalId vindo do contexto sem mudar a execução de outra capacidade', async () => {
  const m = montar({ ...CAPACIDADES[0], id: 'contexto.outro' }, { exigeAprovacao: false, semGuarda: true });
  expect(await m.chamar()).toMatchObject({ status: 'executado' });
  expect(m.efeito.mock.calls[0][1]).not.toHaveProperty('approvalId');
  expect(m.exigirAntesDaAprovacao).not.toHaveBeenCalled();
});
