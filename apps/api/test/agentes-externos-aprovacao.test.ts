import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';

import { ApprovalsService } from '../src/approvals/approvals.service';
import { decisoresComCanal } from '../src/gateway/canais/quem-decide';
import { ExecucaoExternaService } from '../src/agentes-externos/execucao-externa.service';
import { portaDublada } from './porta-dublada';

/*
 * A6 (30/10/2026): o pedido que a Rootinha deixou retido é confirmado por
 * QUALQUER sócio com a permissão de aprovar e a alçada — Pedro, Lucas ou Rodrigo,
 * inclusive quem pediu —, porque quem PROPÕE é o agente (`propostoPorId` =
 * "rootinha", `propostoPorTipo` = ai) e a invariante 7 só tira da lista quem
 * propôs. E o CA-02 (o aviso pelo WhatsApp) manda o pedido aos três.
 *
 * Conferido no código, sem mudança: `ApprovalsService.confirm` recusa só quem
 * propôs, conta de máquina, usuário inativo e alçada abaixo da exigida; e
 * `decisoresComCanal` (quem o CA-02 avisa) usa a mesma régua. Este arquivo é a
 * prova, ponta a ponta: a proposta sai da rota do agente externo com a porta da
 * aplicação, e a confirmação é a do serviço de verdade.
 */

const ORG = 'org-1';
const SOCIOS = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Pedro', phone: '5532999990001' },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Lucas', phone: '5532999990002' },
  { id: '33333333-3333-4333-8333-333333333333', name: 'Rodrigo', phone: '5532999990003' },
];
const PAPEL_DE_SOCIO = { key: 'admin_master', permissions: [{ key: 'aprovacoes.decidir' }, { key: 'aprovacoes.ver' }] };
const MAQUINA = { id: '44444444-4444-4444-8444-444444444444', name: 'IA', roles: [{ key: 'ia_servico', permissions: [{ key: 'aprovacoes.decidir' }] }] };

/** A proposta que a rota do agente externo deixa na fila, com a porta da aplicação. */
async function propostaDaRootinha(solicitanteId: string) {
  const dublada = portaDublada();
  dublada.efeitos.registrar({ 'email.enviar': async () => ({ enviado: true }) }, 'teste');
  const prisma = {
    agent: { findFirst: async () => ({ slug: 'rootinha', estado: 'ativo', ativo: true, capacidades: ['email.enviar'], rebaixadoAte: null }) },
    user: { findFirst: async () => ({ id: solicitanteId, roles: [{ key: 'admin_master' }] }), findMany: async () => [] },
    whatsAppMensagem: { findFirst: async () => null },
  };
  const svc = new ExecucaoExternaService(prisma as never, dublada.porta, dublada.efeitos, { registrar: async () => ({}) } as never);
  const r = await svc.executar({ orgId: ORG, solicitantePadraoId: solicitanteId }, 'rootinha', 'email.enviar', {
    args: { para: 'cliente@exemplo.com', assunto: 'Proposta', corpo: 'Segue a proposta.' },
  });
  expect(r.status).toBe('aguardando_aprovacao');
  return dublada.registro.propostas[0] as { propostoPorId: string; propostoPorTipo: string; decisao: { nivel: string; aprovacao: { alcadaMinima: string } } };
}

function servicoDeAprovacao(proposta: { propostoPorId: string; propostoPorTipo: string; decisao: { nivel: string; aprovacao: { alcadaMinima: string } } }) {
  const linha = {
    id: 'ap-1', orgId: ORG, status: 'pendente', expiraEm: new Date(Date.now() + 600_000),
    propostoPorId: proposta.propostoPorId, propostoPorTipo: proposta.propostoPorTipo,
    nivelExigido: proposta.decisao.nivel, alcadaMinima: proposta.decisao.aprovacao.alcadaMinima,
    exigeReauth: false, resourceType: 'email.enviar', resourceId: 'cliente@exemplo.com', resumo: 'e-mail ao cliente',
  };
  const usuarios = [...SOCIOS.map((s) => ({ ...s, isActive: true, passwordHash: 'x', roles: [PAPEL_DE_SOCIO] })), { ...MAQUINA, isActive: true, passwordHash: 'x' }];
  const prisma = {
    approval: {
      findFirst: async () => ({ ...linha }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    user: { findFirst: async ({ where }: { where: { id: string } }) => usuarios.find((u) => u.id === where.id) ?? null },
  };
  const audit = { log: vi.fn(async () => undefined) };
  return { svc: new ApprovalsService(prisma as never, audit as never), prisma };
}

describe('A6: o que a Rootinha propõe, qualquer sócio confirma', () => {
  it('a proposta da rota externa é do AGENTE, não de quem pediu', async () => {
    const p = await propostaDaRootinha(SOCIOS[0].id);
    expect(p).toMatchObject({ propostoPorId: 'rootinha', propostoPorTipo: 'ai' });
    expect(p.decisao.nivel).toBe('R3');
  });

  it.each(SOCIOS)('$name confirma — inclusive quando foi ele quem pediu à Rootinha', async (socio) => {
    const p = await propostaDaRootinha(SOCIOS[0].id);
    const { svc, prisma } = servicoDeAprovacao(p);
    await expect(svc.confirm(ORG, 'ap-1', { id: socio.id, papeis: ['admin_master'] })).resolves.toMatchObject({ ok: true });
    expect(prisma.approval.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'confirmada', aprovadoPorId: socio.id }) }));
  });

  it('conta de máquina não confirma', async () => {
    const { svc } = servicoDeAprovacao(await propostaDaRootinha(SOCIOS[0].id));
    await expect(svc.confirm(ORG, 'ap-1', { id: MAQUINA.id, papeis: ['ia_servico'] })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('o contraste: quando o proponente é a pessoa (o laço interno), ela não confirma o próprio pedido', async () => {
    const { svc } = servicoDeAprovacao({ propostoPorId: SOCIOS[0].id, propostoPorTipo: 'ai', decisao: { nivel: 'R3', aprovacao: { alcadaMinima: 'responsavel' } } });
    await expect(svc.confirm(ORG, 'ap-1', { id: SOCIOS[0].id, papeis: ['admin_master'] })).rejects.toThrow(/Quem propôs/);
  });

  it('o CA-02 avisa os três sócios no WhatsApp: ninguém sai da lista, porque quem propôs é o agente', async () => {
    const p = await propostaDaRootinha(SOCIOS[0].id);
    const prisma = {
      channelIdentity: {
        findFirst: async () => null,
        findMany: async () => [...SOCIOS, MAQUINA].map((s, i) => ({ userId: s.id, externalId: `55329999000${i + 1}`, criadoEm: new Date(i) })),
      },
      user: {
        findFirst: async () => null,
        findMany: async () => [
          ...SOCIOS.map((s) => ({ id: s.id, name: s.name, isActive: true, roles: [PAPEL_DE_SOCIO] })),
          { id: MAQUINA.id, name: MAQUINA.name, isActive: true, roles: MAQUINA.roles },
        ],
      },
    };
    const destinos = await decisoresComCanal(prisma, ORG, p.decisao.aprovacao.alcadaMinima, p.propostoPorId);
    expect(destinos.map((d) => d.nome)).toEqual(['Pedro', 'Lucas', 'Rodrigo']);
  });
});
