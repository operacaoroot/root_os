import { randomUUID } from 'node:crypto';

import { ActorType, PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ApprovalsService } from '../src/approvals/approvals.service';
import { AuditService } from '../src/audit/audit.service';
import { comContexto } from '../src/common/contexto-execucao';
import { SimuladoProvider } from '../src/comercial/canais/simulado.provider';
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
 * REVISÃO ADVERSARIAL (lane G, 13/10/2026) · o canal do comercial contra a régua.
 *
 * Estes casos afirmam o comportamento CERTO e ficam vermelhos enquanto o
 * defeito existir. Por isso o arquivo NÃO entra no commit da revisão: ele é a
 * prova citada em `homolog/revisao/lane-B.md`.
 *
 *   1. O M6 com a novidade escrita por uma PESSOA vai à porta em nome do
 *      sistema (`completarM6` chama `submeter` sem `quem`): quem escreveu o
 *      texto livre consegue liberar o próprio envio (invariante 7).
 *   2. O telefone de destino não entra nos argumentos aprovados: o efeito relê
 *      `Lead.phone` na hora de enviar, então trocar o telefone depois da
 *      aprovação manda a mensagem (com o link da sala) para outro número.
 */

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (lead, mensagens, aprovação e rastro do comercial)');
process.env.ENCRYPTION_KEY ??= 'chave-de-teste-da-sala-0123456789abcdef';

const MARCA = `rg${Date.now().toString(36).slice(-6)}`;
const ORG = `org-revisao-${MARCA}`;
const LUCAS = { id: `lucas-${MARCA}`, papeis: ['gestor_marketing'] };

class ProvedorEspiao extends SimuladoProvider {
  readonly destinos: string[] = [];
  readonly textos: string[] = [];
  override async enviarTexto(destino: string, texto: string) {
    this.destinos.push(destino);
    this.textos.push(texto);
    return super.enviarTexto(destino, texto);
  }
  override async enviarFormulario(destino: string, texto: string, f: never) {
    this.destinos.push(destino);
    this.textos.push(texto);
    return super.enviarFormulario(destino, texto, f);
  }
}

describe('revisão: o canal do comercial e a régua', () => {
  let prisma: PrismaClient;
  let approvals: ApprovalsService;
  let acoes: AcoesService;
  let whats: WhatsappComercialService;
  let sala: SalaService;
  const espiao = new ProvedorEspiao();
  const naEmpresa = <T>(fn: () => Promise<T>): Promise<T> => comContexto({ orgId: ORG, correlationId: `revisao-${MARCA}`, origem: 'http' }, fn);

  beforeAll(async () => {
    vi.setSystemTime(new Date('2026-10-13T14:00:00-03:00'));
    process.env.GATEWAY_MODO = 'impor';
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.org.create({ data: { id: ORG, name: `Revisao ${MARCA}`, slug: `revisao-${MARCA}` } });
    const papel = await prisma.role.create({ data: { orgId: ORG, key: 'gestor_marketing', name: 'Gestor de Marketing' }, select: { id: true } });
    await prisma.user.create({ data: { id: LUCAS.id, orgId: ORG, email: `${LUCAS.id}@revisao.teste`, name: 'Lucas', passwordHash: 'sem-senha-util', roles: { connect: { id: papel.id } } } });

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
    sala = new SalaService(p, fio, reacoes);
    sala.onModuleInit();
    whats = new WhatsappComercialService(p, fio, reacoes, new RelogioComercialRegistry(), sala, efeitos, porta, espiao);
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

  it('B-1 · o token da sala não fica em claro nos argumentos da porta, no fato nem na mensagem; só o provedor recebe o link', async () => {
    // O relógio está parado (vi.setSystemTime): o prefixo 328 separa este telefone dos outros casos.
    const tel = `+55328${Date.now().toString().slice(-8)}`;
    const { leadId } = await naEmpresa(() => whats.receberEntrada(ORG, { telefone: tel, texto: 'Oi', nome: 'Marina Duarte', mensagemId: `${MARCA}-b1` }));
    const m1 = await prisma.comercialMensagem.findFirstOrThrow({ where: { leadId, template: 'M1' } });
    expect(m1.estado, m1.erro ?? '').toBe('na_fila');
    const link = await naEmpresa(() => sala.linkDoLead(ORG, leadId));
    const token = /\/s\/([A-Za-z0-9_-]{43})/.exec(link ?? '')![1];

    await naEmpresa(() => approvals.confirm(ORG, m1.approvalId!, LUCAS));
    await naEmpresa(() => acoes.executarAprovada(ORG, m1.approvalId!, LUCAS.id));
    expect((await prisma.comercialMensagem.findUniqueOrThrow({ where: { id: m1.id } })).estado).toBe('enviada');

    const chamadas = await prisma.toolCall.findMany({ where: { orgId: ORG, capabilityId: CAPACIDADE_DO_WHATSAPP } });
    const fatos = await prisma.leadEvent.findMany({ where: { leadId } });
    const mensagens = await prisma.comercialMensagem.findMany({ where: { leadId } });
    const eventosDoRastro = await prisma.eventLog.findMany({ where: { orgId: ORG } });
    const auditoria = await prisma.auditLog.findMany({ where: { orgId: ORG } });
    const aprovacoes = await prisma.approval.findMany({ where: { orgId: ORG } });
    expect(chamadas.length).toBeGreaterThan(0);
    for (const linha of [...chamadas, ...fatos, ...mensagens, ...eventosDoRastro, ...auditoria, ...aprovacoes]) {
      expect(JSON.stringify(linha, (_k, v) => (typeof v === 'bigint' ? String(v) : v))).not.toContain(token);
    }
    expect(espiao.textos.some((t) => t.includes(`/s/${token}`))).toBe(true);
  });

  it('o M6 escrito por uma pessoa vai à porta em nome dela (quem escreveu não libera)', async () => {
    const tel = `+55329${Date.now().toString().slice(-8)}`;
    const { leadId } = await naEmpresa(() => whats.receberEntrada(ORG, { telefone: tel, texto: 'Oi', nome: 'Marina Duarte', mensagemId: `${MARCA}-m6` }));
    const id = randomUUID();
    await prisma.comercialMensagem.create({
      data: { id, leadId, direcao: 'saida', provedor: 'simulado', destino: 'lead', template: 'M6', texto: 'Marina, [novidade: falta escrever]', estado: 'rascunho' },
    });

    // A rota `POST /comercial/simulador/mensagens/:id/novidade` é chamada pelo Lucas e passa quem é (B-2).
    await naEmpresa(() => whats.completarM6(ORG, id, 'Baixamos o preço pela metade só até amanhã, aproveite agora.', { id: LUCAS.id }));

    const m6 = await prisma.comercialMensagem.findUniqueOrThrow({ where: { id } });
    expect(m6.estado, m6.erro ?? '').toBe('na_fila');
    const aprovacao = await prisma.approval.findUniqueOrThrow({ where: { id: m6.approvalId! } });
    expect(aprovacao.capabilityId).toBe(CAPACIDADE_DO_WHATSAPP);
    // Certo: quem escreveu o texto livre é o proponente e não pode liberar o próprio envio.
    expect(aprovacao.propostoPorTipo).toBe(ActorType.user);
    expect(aprovacao.propostoPorId).toBe(LUCAS.id);
    // E a porta recusa que ele libere o próprio texto.
    await expect(naEmpresa(() => approvals.confirm(ORG, m6.approvalId!, LUCAS))).rejects.toThrow();
  });

  it('o telefone de destino trocado depois da aprovação não recebe a mensagem', async () => {
    const tel = `+55329${Date.now().toString().slice(-8)}`;
    const { leadId } = await naEmpresa(() => whats.receberEntrada(ORG, { telefone: tel, texto: 'Oi', nome: 'Marina Duarte', mensagemId: `${MARCA}-tel` }));
    const m1 = await prisma.comercialMensagem.findFirstOrThrow({ where: { leadId, template: 'M1' } });
    expect(m1.estado, m1.erro ?? '').toBe('na_fila');
    const original = (await prisma.lead.findUniqueOrThrow({ where: { id: leadId }, select: { phone: true } })).phone;

    // Alguém troca o telefone do lead enquanto a M1 (com o link da sala) espera na fila.
    await prisma.lead.update({ where: { id: leadId }, data: { phone: '5511999990000' } });

    await naEmpresa(() => approvals.confirm(ORG, m1.approvalId!, LUCAS)).catch(() => undefined);
    await naEmpresa(() => acoes.executarAprovada(ORG, m1.approvalId!, LUCAS.id)).catch(() => undefined);

    // Certo: a aprovação foi para o número que estava na mesa; nada sai para o número novo.
    expect(espiao.destinos).not.toContain('5511999990000');
    expect(original).toBeTruthy();
  });
});
