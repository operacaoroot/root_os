import { ActorType, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ApprovalsService } from '../src/approvals/approvals.service';
import { AuditService } from '../src/audit/audit.service';
import { comContexto } from '../src/common/contexto-execucao';
import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { RelogioComercialRegistry } from '../src/comercial/relogio.registry';
import { SalaService } from '../src/comercial/sala.service';
import { CAPACIDADE_DO_WHATSAPP, WhatsappComercialService } from '../src/comercial/whatsapp.service';
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
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * O CANAL CONTRA A RÉGUA DE VERDADE (Lane B, 13/10/2026).
 *
 * A M1 do lead que acabou de chegar vai à porta como `comercial.whatsapp.enviar`
 * com a política do BANCO (`db:seed:politica`): a capacidade é R3, então a
 * mensagem fica RETIDA, nada sai pelo provedor, e só a confirmação de OUTRA
 * pessoa com alçada (um toque em `/atendimento`) a entrega. O proponente é o
 * sistema (`comercial`): qualquer pessoa com alçada de plantão confirma.
 */

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (lead, mensagens, aprovação e rastro do comercial)');
process.env.ENCRYPTION_KEY ??= 'chave-de-teste-da-sala-0123456789abcdef';

const MARCA = `cp${Date.now().toString(36).slice(-6)}`;
const ORG = `org-canal-${MARCA}`;
const LUCAS = { id: `lucas-${MARCA}`, papeis: ['gestor_marketing'] };

describe('a M1 vai pela porta e espera a segunda pessoa', () => {
  let prisma: PrismaClient;
  let approvals: ApprovalsService;
  let acoes: AcoesService;
  let whats: WhatsappComercialService;
  const naEmpresa = <T>(fn: () => Promise<T>): Promise<T> => comContexto({ orgId: ORG, correlationId: `canal-${MARCA}`, origem: 'http' }, fn);

  beforeAll(async () => {
    // 14:00 de São Paulo: fora da janela o sinal `fora_da_janela` sobe R3 para R4.
    vi.setSystemTime(new Date('2026-10-13T14:00:00-03:00'));
    process.env.GATEWAY_MODO = 'impor';
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.org.create({ data: { id: ORG, name: `Canal ${MARCA}`, slug: `canal-${MARCA}` } });
    const papel = await prisma.role.create({ data: { orgId: ORG, key: 'gestor_marketing', name: 'Gestor de Marketing' }, select: { id: true } });
    await prisma.user.create({ data: { id: LUCAS.id, orgId: ORG, email: `${LUCAS.id}@canal.teste`, name: 'Lucas', passwordHash: 'sem-senha-util', roles: { connect: { id: papel.id } } } });

    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    const policy = new PolicyService(p);
    await policy.onModuleInit();
    approvals = new ApprovalsService(p, audit);
    const eventos = new EventLogService(p);
    const efeitos = new EfeitosRegistry();
    const interruptores = new InterruptoresRegistry();
    const conectores = new ConectoresService(p, audit, eventos, interruptores);
    conectores.onModuleInit();
    const gateway = new ToolGateway(p, policy, new SinaisService(p, policy), approvals, eventos, undefined, interruptores, efeitos);
    acoes = new AcoesService(p, gateway, eventos, interruptores, policy);
    const porta = new PortaDoOperador(gateway, efeitos);

    const reacoes = new ReacoesRegistry();
    const fio = new FioService(p, reacoes);
    const sala = new SalaService(p, fio, reacoes);
    sala.onModuleInit();
    whats = new WhatsappComercialService(p, fio, reacoes, new RelogioComercialRegistry(), sala, efeitos, porta);
    whats.onModuleInit();
  });

  afterAll(async () => {
    vi.useRealTimers();
    const ids = (await prisma.lead.findMany({ where: { orgId: ORG }, select: { id: true } })).map((l) => l.id);
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
      prisma.$executeRawUnsafe('DELETE FROM "EventLog" WHERE "orgId" = $1', ORG),
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
    ]);
    await prisma.comercialMensagem.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.comercialReacao.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.salaDoCliente.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.leadEvent.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.lead.deleteMany({ where: { orgId: ORG } });
    await prisma.approval.deleteMany({ where: { orgId: ORG } });
    await prisma.toolCall.deleteMany({ where: { orgId: ORG } });
    await prisma.policyDecision.deleteMany({ where: { orgId: ORG } });
    await prisma.auditLog.deleteMany({ where: { orgId: ORG } });
    await prisma.user.deleteMany({ where: { orgId: ORG } });
    await prisma.role.deleteMany({ where: { orgId: ORG } });
    await prisma.org.deleteMany({ where: { id: ORG } });
    await prisma.$disconnect();
  });

  it('R3: retida, nada sai; um toque de outra pessoa entrega no simulado e grava whats.enviada', async () => {
    const tel = `+55329${Date.now().toString().slice(-8)}`;
    const { leadId } = await naEmpresa(() => whats.receberEntrada(ORG, { telefone: tel, texto: 'Oi! Funciona com Omie?', nome: 'Marina Duarte', mensagemId: `${MARCA}-1` }));

    const m1 = await prisma.comercialMensagem.findFirstOrThrow({ where: { leadId, template: 'M1' } });
    expect(m1.estado, m1.erro ?? '').toBe('na_fila');
    expect(m1.approvalId).toBeTruthy();
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'whats.enviada' } })).toBe(0);

    const chamada = await prisma.toolCall.findFirstOrThrow({ where: { orgId: ORG, capabilityId: CAPACIDADE_DO_WHATSAPP } });
    expect(chamada.status).toBe('aguardando_aprovacao');
    expect(chamada.actorType).toBe(ActorType.system);
    const decisao = await prisma.policyDecision.findFirstOrThrow({ where: { orgId: ORG, capabilityId: CAPACIDADE_DO_WHATSAPP } });
    expect(decisao.nivel).toBe('R3');

    await naEmpresa(() => approvals.confirm(ORG, m1.approvalId!, LUCAS));
    const exec = await naEmpresa(() => acoes.executarAprovada(ORG, m1.approvalId!, LUCAS.id));
    expect(exec.status).toBe('executado');

    const depois = await prisma.comercialMensagem.findUniqueOrThrow({ where: { id: m1.id } });
    expect(depois.estado).toBe('enviada');
    expect(depois.mensagemExternaId).toMatch(/^sim-/);
    const [enviada] = await prisma.leadEvent.findMany({ where: { leadId, type: 'whats.enviada' } });
    expect(enviada.payload).toMatchObject({ template: 'M1', aprovadaPor: LUCAS.id });
  });
});
