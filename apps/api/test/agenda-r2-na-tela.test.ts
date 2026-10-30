import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { PrismaClient, ActorType } from '@prisma/client';
import { CAPACIDADES_DA_AGENDA } from '@mktos/shared';

import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import { ApprovalsService } from '../src/approvals/approvals.service';
import { AuditService } from '../src/audit/audit.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { ToolGateway } from '../src/gateway/tool-gateway.service';
import { PortaDoOperador, type AcaoRetida } from '../src/gateway/porta-do-operador.service';
import { InterruptoresRegistry } from '../src/gateway/interruptores.registry';
import { ConectoresService } from '../src/integrations/conectores.service';
import { comContexto } from '../src/common/contexto-execucao';
import { EscritaDaAgendaService } from '../src/agenda/escrita/escrita.service';
import { PedidoDeEscritaSchema } from '../src/agenda/escrita/escrita-pura';
import type { ReguaService } from '../src/agenda/regua/regua.service';
import type { EspelhoService } from '../src/agenda/espelho/espelho.service';
import { analisarAprovacaoR2, deltaDaAprovacaoR2, fecharComPrazo, recusaDoAutorDaSobrescrita } from '../src/agenda/sobrescrita-r2-da-agenda';
import { lerDelta, lerPolitica, resolverPolitica } from '@mktos/policy';
import politicaRoot from '@mktos/policy/politica-root.json';
import politicaMktos from '@mktos/policy/politica-marketing-os.json';
import { exigirBancoDescartavel } from './banco-de-teste';
import type { PrismaService } from '../src/prisma/prisma.service';

/*
 * ============================================================================
 * AGENDA V2, DECISÃO 2 — "MARCAR PELA TELA SAI NO CLIQUE", E SÓ PARA GENTE
 * ============================================================================
 *
 * O que esta suíte prova, contra a porta DE VERDADE (régua, `PolicyDecision`,
 * `ToolCall`, aprovação), com efeitos falsos no lugar do Google:
 *
 *   1. a aprovação de R2 da empresa só é DESLIGADA por sobrescrita assinada
 *      (sem autor e motivo: 403), e a versão nova que não diz nada HERDA o valor;
 *   2. gente na tela (`actorType: user`, `naTela: true`, pessoa ativa relida no
 *      banco) com a aprovação desligada: o R2 da agenda EXECUTA no clique;
 *   3. a mesma pessoa SEM a flag (empresa sem sobrescrita, ou religada): fila;
 *   4. agente (`ai`), rotina (`system`), conta de máquina, usuário inativo e
 *      `naTela` ausente: fila SEMPRE, com a aprovação desligada;
 *   5. R3 (`agenda.reuniao.reabrir`) nunca sai no clique;
 *   6. `naTela` não entra pelo corpo do pedido (esquema estrito).
 */

describe('B2: quem assina a sobrescrita e o comando que termina, sem banco', () => {
  it('só gente assina: ativo e sem papel de máquina', () => {
    expect(recusaDoAutorDaSobrescrita({ isActive: true, papeis: ['admin_master'] }, 'socio@exemplo.invalid', 'casa')).toBeNull();
    expect(recusaDoAutorDaSobrescrita({ isActive: true, papeis: ['analista'] }, 'p@exemplo.invalid', 'casa')).toBeNull();
    expect(recusaDoAutorDaSobrescrita(null, 'ninguem@exemplo.invalid', 'casa')).toMatch(/não achei/);
    expect(recusaDoAutorDaSobrescrita({ isActive: false, papeis: ['admin_master'] }, 'saiu@exemplo.invalid', 'casa')).toMatch(/desativado/);
    expect(recusaDoAutorDaSobrescrita({ isActive: true, papeis: ['ia_servico'] }, 'ia@exemplo.invalid', 'casa')).toMatch(/conta de máquina/);
    expect(recusaDoAutorDaSobrescrita({ isActive: true, papeis: ['admin_master', 'ia_acao'] }, 'misto@exemplo.invalid', 'casa')).toMatch(/conta de máquina/);
  });

  it('fechar o app tem prazo: um close que nunca termina não segura o comando', async () => {
    expect(await fecharComPrazo(async () => undefined, 1000)).toBe('fechado');
    expect(await fecharComPrazo(() => new Promise(() => undefined), 20)).toBe('prazo');
    expect(await fecharComPrazo(async () => { throw new Error('x'); }, 1000)).toBe('fechado');
  });
});

describe('a análise da sobrescrita (o que o comando mostra), sem banco', () => {
  const BASE = resolverPolitica(lerPolitica(politicaRoot, 'politica-root.json'), lerDelta(politicaMktos, 'politica-marketing-os.json'));

  it('desligar muda só as quatro R2 da agenda, só na tela; reabrir (R3) e fora da tela seguem na fila', () => {
    const linhas = analisarAprovacaoR2(BASE, deltaDaAprovacaoR2(null, '2026-10-30'), true, false);
    expect(linhas).toEqual([
      { capacidade: CAPACIDADES_DA_AGENDA.marcar, nivel: 'R2', hojeNaTela: 'fila', depoisNaTela: 'clique', foraDaTela: 'fila' },
      { capacidade: CAPACIDADES_DA_AGENDA.alterar, nivel: 'R2', hojeNaTela: 'fila', depoisNaTela: 'clique', foraDaTela: 'fila' },
      { capacidade: CAPACIDADES_DA_AGENDA.cancelar, nivel: 'R2', hojeNaTela: 'fila', depoisNaTela: 'clique', foraDaTela: 'fila' },
      { capacidade: CAPACIDADES_DA_AGENDA.desmarcar, nivel: 'R2', hojeNaTela: 'fila', depoisNaTela: 'clique', foraDaTela: 'fila' },
      { capacidade: CAPACIDADES_DA_AGENDA.reabrir, nivel: 'R3', hojeNaTela: 'fila', depoisNaTela: 'fila', foraDaTela: 'fila' },
    ]);
  });

  it('o delta preserva o que a empresa já tem (a sobrescrita substitui o delta inteiro)', () => {
    const outra = { ...BASE.capacidades.find((c) => c.id === 'email.enviar')!, nivel: 'R4' as const };
    const d = deltaDaAprovacaoR2({ versao: '1.2.0', atualizadoEm: '2026-10-01', origem: 'x', descricao: 'y', estende: 'politica-marketing-os.json', capacidades: [outra] }, '2026-10-30');
    expect(d.capacidades.map((c) => c.id)).toEqual(['email.enviar']);
    expect(d.versao).toBe('1.2.0');
  });
});

const URL = process.env.TEST_DATABASE_URL;
if (URL) exigirBancoDescartavel(URL, 'escreve política, propostas, aprovações e RASTRO');

const ORG = 'org-agenda-r2-tela';
const ORG_SEM = 'org-agenda-r2-sem';
const RODRIGO = 'rodrigo-agenda-r2';
const LUCAS = 'lucas-agenda-r2';
const MAQUINA = 'maquina-agenda-r2';
const INATIVO = 'inativo-agenda-r2';
const PEDRO_SEM = 'pedro-agenda-r2-sem';

const ARGS_MARCAR = {
  chave: 'abcdefghij0123456789',
  tipo: 'cliente',
  modalidade: 'online',
  cliente: 'Papeleira Ficticia',
  responsavel: 'Rodrigo',
  responsaveis: ['Rodrigo'],
  inicio: '2026-09-02T15:00:00-03:00',
  fim: '2026-09-02T16:00:00-03:00',
};
const ARGS_REABRIR = { chave: 'abcdefghij0123456780', eventoId: 'evento-ficticio-1', tituloAtual: 'Reunião Online - Papeleira Ficticia - Rodrigo' };

describe.skipIf(!URL)('agenda v2, decisão 2: R2 no clique só para gente na tela', () => {
  let prisma: PrismaClient;
  let policy: PolicyService;
  let gateway: ToolGateway;
  let porta: PortaDoOperador;
  let chamadas: Array<{ capacidade: string; ator: string | null }>;

  const em = <T>(org: string, fn: () => Promise<T>): Promise<T> =>
    comContexto({ orgId: org, correlationId: `r2-${Date.now()}`, origem: 'http' }, fn);

  const pedirPelaPorta = (org: string, actorId: string, capabilityId: string, args: Record<string, unknown>, extra: { naTela?: boolean; actorType?: ActorType } = {}) =>
    em(org, () => porta.executar({ orgId: org, actorId, capabilityId, args, resource: { type: capabilityId, id: 'alvo' }, ...extra }));

  async function criarOrg(id: string, slug: string) {
    await prisma.org.upsert({ where: { id }, create: { id, name: `Agenda R2 ${slug}`, slug }, update: {} });
  }
  async function criarUsuario(org: string, id: string, nome: string, papel: string, ativo = true) {
    const role = await prisma.role.upsert({
      where: { orgId_key: { orgId: org, key: papel } },
      create: { orgId: org, key: papel, name: papel },
      update: {},
      select: { id: true },
    });
    await prisma.user.upsert({
      where: { id },
      create: { id, orgId: org, email: `${id}@agenda.invalid`, name: nome, passwordHash: 'sem-senha', isActive: ativo, roles: { connect: { id: role.id } } },
      update: { isActive: ativo, roles: { set: [{ id: role.id }] } },
    });
  }

  beforeAll(async () => {
    // 14:00 em São Paulo: fora das 08h às 20h o sinal `fora_da_janela` subiria R2 para R3.
    vi.setSystemTime(new Date('2026-09-01T14:00:00-03:00'));
    process.env.GATEWAY_MODO = 'impor';
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    await criarOrg(ORG, 'agenda-r2-tela');
    await criarOrg(ORG_SEM, 'agenda-r2-sem');
    await criarUsuario(ORG, RODRIGO, 'Rodrigo Ficticio', 'admin_master');
    await criarUsuario(ORG, LUCAS, 'Lucas Ficticio', 'gestor_marketing');
    await criarUsuario(ORG, MAQUINA, 'Conta de Acao', 'ia_acao');
    await criarUsuario(ORG, INATIVO, 'Fulano Inativo', 'admin_master', false);
    await criarUsuario(ORG_SEM, PEDRO_SEM, 'Pedro Ficticio', 'admin_master');

    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    policy = new PolicyService(p);
    await policy.onModuleInit();
    const approvals = new ApprovalsService(p, audit);
    const eventos = new EventLogService(p);
    chamadas = [];
    const registro = new EfeitosRegistry();
    const falso = (capacidade: string) => async (_a: Record<string, unknown>, _o: string, ctx: { actorId?: string | null }) => {
      chamadas.push({ capacidade, ator: ctx.actorId ?? null });
      return { ok: true, id: 'evento-ficticio-1', titulo: 'Reunião Online - Papeleira Ficticia - Rodrigo' };
    };
    registro.registrar(Object.fromEntries(Object.values(CAPACIDADES_DA_AGENDA).map((c) => [c, falso(c)])), 'teste');
    const interruptores = new InterruptoresRegistry();
    const conectores = new ConectoresService(p, audit, eventos, interruptores);
    conectores.onModuleInit();
    gateway = new ToolGateway(p, policy, new SinaisService(p, policy), approvals, eventos, undefined, interruptores, registro);
    porta = new PortaDoOperador(gateway, registro);
  });

  afterAll(async () => {
    vi.useRealTimers();
    const orgs = [ORG, ORG_SEM];
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
      prisma.$executeRawUnsafe('DELETE FROM "EventLog" WHERE "orgId" = ANY($1)', orgs),
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
    ]);
    await prisma.approval.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.toolCall.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.policyDecision.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.policyVersion.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.auditLog.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.user.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.role.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.org.deleteMany({ where: { id: { in: orgs } } });
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    chamadas = [];
    // `volume_atipico` compara a última hora com a média: zerar as chamadas mantém a régua no assunto.
    await prisma.toolCall.deleteMany({ where: { orgId: { in: [ORG, ORG_SEM] } } });
  });

  it('desligar a aprovação de R2 sem autor e motivo é recusado (afrouxamento, RF-P-06)', async () => {
    const delta = { versao: '1.0.0', atualizadoEm: '2026-09-01', origem: 'teste', descricao: 'teste', estende: 'politica-marketing-os.json', capacidades: [] };
    await expect(em(ORG, () => policy.sobrescrever({ orgId: ORG, delta, aprovacaoR2Ligada: false }))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(em(ORG, () => policy.sobrescrever({ orgId: ORG, delta, autorId: RODRIGO, motivo: 'curto', aprovacaoR2Ligada: false }))).rejects.toBeInstanceOf(ForbiddenException);
    expect(await em(ORG, () => policy.aprovacaoR2Ligada(ORG))).toBe(true);

    const r = await em(ORG, () => policy.sobrescrever({
      orgId: ORG, delta, autorId: RODRIGO,
      motivo: '2026-09-01: marcar pela tela sai no clique para gente (agenda v2, decisão 2)',
      aprovacaoR2Ligada: false,
    }));
    expect(r.criada).toBe(true);
    expect(await em(ORG, () => policy.aprovacaoR2Ligada(ORG))).toBe(false);
    const estado = await em(ORG, () => policy.estadoDaAprovacaoR2(ORG));
    expect(estado).toMatchObject({ ligada: false, autorId: RODRIGO, versao: r.versao });

    // A empresa sem sobrescrita segue com a regra de sempre.
    expect(await em(ORG_SEM, () => policy.aprovacaoR2Ligada(ORG_SEM))).toBe(true);
  });

  it('gente na tela, aprovação desligada: o R2 da agenda EXECUTA no clique', async () => {
    const r = await pedirPelaPorta(ORG, RODRIGO, CAPACIDADES_DA_AGENDA.marcar, ARGS_MARCAR, { naTela: true });
    expect((r as AcaoRetida).status).not.toBe('aguardando_aprovacao');
    expect(chamadas).toEqual([{ capacidade: CAPACIDADES_DA_AGENDA.marcar, ator: RODRIGO }]);
    const chamada = await prisma.toolCall.findFirst({ where: { orgId: ORG, capabilityId: CAPACIDADES_DA_AGENDA.marcar }, orderBy: { criadoEm: 'desc' } });
    expect(chamada?.status).toBe('executado');
    expect(chamada?.nivel).toBe('R2');
    const decisao = await prisma.policyDecision.findUnique({ where: { id: chamada!.decisionId! } });
    expect(decisao?.exigeAprovacao).toBe(false);
  });

  it.each([
    ['alterar', CAPACIDADES_DA_AGENDA.alterar, { chave: 'abcdefghij0123456781', eventoId: 'evento-ficticio-1', antes: { titulo: 'x', inicio: '2026-09-02T15:00:00-03:00', fim: '2026-09-02T16:00:00-03:00', meet: true }, depois: { inicio: '2026-09-02T16:00:00-03:00', fim: '2026-09-02T17:00:00-03:00' } }],
    ['cancelar', CAPACIDADES_DA_AGENDA.cancelar, { chave: 'abcdefghij0123456782', eventoId: 'evento-ficticio-1', tituloAtual: 'x', motivo: 'cliente pediu', avisar: true }],
    ['desmarcar', CAPACIDADES_DA_AGENDA.desmarcar, { chave: 'abcdefghij0123456783', eventoId: 'evento-ficticio-1', tituloAtual: 'x' }],
  ])('gente na tela, aprovação desligada: %s (R2) também sai no clique', async (_n, cap, args) => {
    await pedirPelaPorta(ORG, RODRIGO, cap, args as Record<string, unknown>, { naTela: true });
    expect(chamadas.map((c) => c.capacidade)).toEqual([cap]);
  });

  it('R3 (reabrir) nunca sai no clique, nem para gente na tela com a aprovação desligada', async () => {
    const r = (await pedirPelaPorta(ORG, RODRIGO, CAPACIDADES_DA_AGENDA.reabrir, ARGS_REABRIR, { naTela: true })) as AcaoRetida;
    expect(r.status).toBe('aguardando_aprovacao');
    expect(r.nivel).toBe('R3');
    expect(chamadas).toEqual([]);
  });

  it('gente sem `naTela` (a rota antiga, um script): fila, mesmo com a aprovação desligada', async () => {
    const r = (await pedirPelaPorta(ORG, RODRIGO, CAPACIDADES_DA_AGENDA.marcar, ARGS_MARCAR)) as AcaoRetida;
    expect(r.status).toBe('aguardando_aprovacao');
    expect(r.nivel).toBe('R2');
    expect(chamadas).toEqual([]);
  });

  it.each([
    ['rotina (system)', ActorType.system, 'vigia-da-agenda'],
    ['agente (ai)', ActorType.ai, 'agente-qualquer'],
  ])('%s com `naTela: true` vindo de fora: fila sempre', async (_n, actorType, actorId) => {
    const r = (await pedirPelaPorta(ORG, actorId, CAPACIDADES_DA_AGENDA.marcar, ARGS_MARCAR, { naTela: true, actorType })) as AcaoRetida;
    expect(r.status).toBe('aguardando_aprovacao');
    expect(chamadas).toEqual([]);
  });

  it('agente pelo laço (ExecCtx direto na porta) com `naTela: true`: fila', async () => {
    const r = await em(ORG, () => gateway.executar(
      { capabilityId: CAPACIDADES_DA_AGENDA.marcar, args: ARGS_MARCAR, ctx: { orgId: ORG, actorType: ActorType.ai, actorId: null, agentSlug: 'agente-qualquer', correlationId: 'laco-1', naTela: true } },
      async () => { chamadas.push({ capacidade: 'laco', ator: null }); return { ok: true }; },
    ));
    expect(r.status).toBe('aguardando_aprovacao');
    expect(chamadas).toEqual([]);
  });

  it.each([
    ['conta de máquina (ia_acao)', MAQUINA],
    ['usuário inativo', INATIVO],
    ['usuário que não existe', 'ninguem-agenda-r2'],
  ])('%s com `actorType: user` e `naTela: true`: fila (a porta relê no banco)', async (_n, actorId) => {
    const r = (await pedirPelaPorta(ORG, actorId, CAPACIDADES_DA_AGENDA.marcar, ARGS_MARCAR, { naTela: true })) as AcaoRetida;
    expect(r.status).toBe('aguardando_aprovacao');
    expect(chamadas).toEqual([]);
  });

  it('gente na tela numa empresa SEM a sobrescrita: fila (a regra de sempre)', async () => {
    const r = (await pedirPelaPorta(ORG_SEM, PEDRO_SEM, CAPACIDADES_DA_AGENDA.marcar, ARGS_MARCAR, { naTela: true })) as AcaoRetida;
    expect(r.status).toBe('aguardando_aprovacao');
    expect(chamadas).toEqual([]);
  });

  it('`naTela` não entra pelo corpo do pedido: o esquema é estrito', () => {
    const pedido = {
      acao: 'marcar', chave: 'abcdefghij0123456789',
      compromisso: { tipo: 'interna', modalidade: 'online', responsaveis: ['Rodrigo'], inicio: '2026-09-02T15:00:00-03:00', fim: '2026-09-02T16:00:00-03:00' },
    };
    expect(PedidoDeEscritaSchema.safeParse(pedido).success).toBe(true);
    expect(PedidoDeEscritaSchema.safeParse({ ...pedido, naTela: true }).success).toBe(false);
  });

  it('o serviço da escrita só põe `naTela` para gente relida no banco (e a porta confirma)', async () => {
    const regua = { avaliar: async () => ({ cor: 'verde', itens: [] }) } as unknown as ReguaService;
    const espelho = { refletir: async () => null } as unknown as EspelhoService;
    const servico = new EscritaDaAgendaService(prisma as unknown as PrismaService, porta, regua, espelho, policy);
    const pedido = {
      acao: 'marcar' as const, chave: 'abcdefghij0123456784',
      compromisso: { tipo: 'interna' as const, modalidade: 'online' as const, responsaveis: ['Rodrigo' as const], inicio: '2026-09-02T15:00:00-03:00', fim: '2026-09-02T16:00:00-03:00' },
    };
    const daTela = await em(ORG, () => servico.executar({ orgId: ORG, actorType: 'user', actorId: RODRIGO, naTela: true }, pedido));
    expect(daTela.status).toBe('executado');
    expect(daTela.desfazer?.acao).toBe('desmarcar');

    chamadas = [];
    const doLink = await em(ORG, () => servico.executar({ orgId: ORG, actorType: 'system', actorId: 'link-de-escolha', agentSlug: 'link-de-escolha', naTela: true }, { ...pedido, chave: 'abcdefghij0123456785' }));
    expect(doLink.status).toBe('aguardando_aprovacao');
    expect(doLink.precisaDeOutraPessoa).toBe(false);
    expect(chamadas).toEqual([]);

    const daMaquina = await em(ORG, () => servico.executar({ orgId: ORG, actorType: 'user', actorId: MAQUINA, naTela: true }, { ...pedido, chave: 'abcdefghij0123456786' }));
    expect(daMaquina.status).toBe('aguardando_aprovacao');
    expect(chamadas).toEqual([]);
  });

  it('a versão nova que não diz nada herda a aprovação desligada; religar não pede assinatura', async () => {
    const delta = { versao: '1.0.1', atualizadoEm: '2026-09-01', origem: 'teste', descricao: 'outra sobrescrita', estende: 'politica-marketing-os.json', capacidades: [] };
    const outra = await em(ORG, () => policy.deltaDaEmpresa(ORG));
    expect(outra).not.toBeNull();
    await em(ORG, () => policy.sobrescrever({ orgId: ORG, delta, autorId: RODRIGO, motivo: 'troca de descrição do delta da empresa' }));
    expect(await em(ORG, () => policy.aprovacaoR2Ligada(ORG))).toBe(false);

    const r = await em(ORG, () => policy.sobrescrever({ orgId: ORG, delta, aprovacaoR2Ligada: true }));
    expect(r.criada).toBe(true);
    expect(await em(ORG, () => policy.aprovacaoR2Ligada(ORG))).toBe(true);
    const fila = (await pedirPelaPorta(ORG, RODRIGO, CAPACIDADES_DA_AGENDA.marcar, { ...ARGS_MARCAR, chave: 'abcdefghij0123456787' }, { naTela: true })) as AcaoRetida;
    expect(fila.status).toBe('aguardando_aprovacao');
    expect(chamadas).toEqual([]);
  });
});
