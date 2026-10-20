import { createHash } from 'node:crypto';

import { JwtService } from '@nestjs/jwt';
import type { ExecutionContext } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { classificar } from '@mktos/policy';
import {
  ClienteFechadoForaSchema,
  ETAPA_PADRAO_DO_ONBOARDING_ANTECIPADO,
  MODELOS_DE_LISTA,
  OnboardingAntecipadoSchema,
  PORTA_DA_IMPLANTACAO,
  conferirEtapaDeEntrada,
  etapasDeEntrada,
  motivoParaNaoIniciarOnboarding,
  rotuloCurtoDaEtapa,
  type ComercialEtapa,
} from '@mktos/shared';

import { ApprovalsService } from '../src/approvals/approvals.service';
import { AuditService } from '../src/audit/audit.service';
import { ReauthService } from '../src/auth/reauth.service';
import { comContexto } from '../src/common/contexto-execucao';
import { AUTOR_DO_FECHAMENTO, AUTOR_DO_FUNIL, cardIdDoLead, seloDoCard } from '../src/comercial/card-da-implantacao';
import { ConfigComercialService } from '../src/comercial/config.service';
import { DecisoesRegistry, DecisoesService } from '../src/comercial/decisoes.service';
import { DinheiroService } from '../src/comercial/dinheiro.service';
import { camposDaDeclaracao, payloadDaDeclaracao } from '../src/comercial/fechado-fora';
import { FechamentoService } from '../src/comercial/fechamento.service';
import { FichaService } from '../src/comercial/ficha.service';
import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { SoGenteGuard } from '../src/comercial/mover.service';
import { EFEITO_DE_INICIAR_ONBOARDING, OnboardingAntecipadoService } from '../src/comercial/onboarding-antecipado.service';
import type { PortaDeAssinatura } from '../src/comercial/portas/assinatura.port';
import type { PortaDeCobranca } from '../src/comercial/portas/cobranca.port';
import { ReacoesDaEspinha } from '../src/comercial/reacoes-da-espinha';
import { RelogioDaEspinha } from '../src/comercial/relogio-da-espinha';
import { RelogioComercialRegistry } from '../src/comercial/relogio.registry';
import { SalaService } from '../src/comercial/sala.service';
import { WhatsappComercialService } from '../src/comercial/whatsapp.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { EventLogService } from '../src/gateway/event-log.service';
import { InterruptoresRegistry } from '../src/gateway/interruptores.registry';
import { PortaDoOperador } from '../src/gateway/porta-do-operador.service';
import { ToolGateway } from '../src/gateway/tool-gateway.service';
import { ConectoresService } from '../src/integrations/conectores.service';
import { TrilhoService } from '../src/onboarding/trilho/trilho.service';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import { ExecutoresDeRotinaRegistry } from '../src/routines/executores.registry';
import { MovimentoDoQuadroService } from '../src/work/movimento-do-quadro.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * INICIAR O ONBOARDING ANTES DO NEGÓCIO FECHADO (ajustes da versão final A2, 19/10/2026).
 *
 *  1. a parte pura: o nível pela escada (R0, efeito interno), a etapa de entrada
 *     (padrão Kickoff marcado; recusa a do fechamento, a de encerramento e a que não
 *     existe), quem pode (antes de fechado e fora das saídas) e o selo;
 *  2. contra o Postgres: iniciar em lead em proposta abre o card na lista certa, na
 *     etapa certa, com o cliente (Partner) na ficha e no card, o trilho ligado, o fato
 *     no fio e a auditoria com a pessoa; iniciar de novo não duplica nada; conta de
 *     máquina, agente e lead fechado ou em saída são recusados com o motivo;
 *  3. lead perdido: o card fica, com o aviso no comentário e no selo;
 *  4. fechar depois: o mesmo card (sem o selo de antes), o comentário do fechamento,
 *     nenhum Partner nem trilho novo; fechar de novo também não duplica;
 *  5. o cliente: ficha, CNPJ, telefone ou e-mail e nome, e fornecedor nunca vira cliente.
 */

describe('onboarding antecipado: a parte pura', () => {
  const etapas = MODELOS_DE_LISTA['onboarding-de-cliente'].etapas.map((e) => ({ name: e.name, type: e.type }));

  it('o efeito é interno e a escada dá R0, sem segunda pessoa', () => {
    expect(classificar(EFEITO_DE_INICIAR_ONBOARDING)).toBe('R0');
  });

  it('a etapa de entrada: padrão Kickoff marcado; a do fechamento, a de encerramento e a inexistente são recusadas', () => {
    expect(ETAPA_PADRAO_DO_ONBOARDING_ANTECIPADO).toBe('Kickoff marcado');
    expect(conferirEtapaDeEntrada(etapas, undefined)).toEqual({ ok: true, etapa: 'Kickoff marcado' });
    expect(conferirEtapaDeEntrada(etapas, '  kit   MONTADO ')).toEqual({ ok: true, etapa: 'Kit montado' });
    expect(conferirEtapaDeEntrada(etapas, 'Fechado no comercial')).toMatchObject({ ok: false, motivo: expect.stringMatching(/etapa do fechamento/) });
    expect(conferirEtapaDeEntrada(etapas, 'Encerrado')).toMatchObject({ ok: false, motivo: expect.stringMatching(/não começa encerrado/) });
    expect(conferirEtapaDeEntrada(etapas, 'Etapa que não existe')).toMatchObject({ ok: false, motivo: expect.stringMatching(/não existe/) });
    expect(etapasDeEntrada(etapas)).toEqual(['Kickoff marcado', 'Kit montado', 'Contexto carregado', 'Imersão', 'Operação assistida']);
    expect(OnboardingAntecipadoSchema.safeParse({ etapa: 'Kit montado', extra: 1 }).success).toBe(false);
  });

  it('quem pode: qualquer etapa antes de fechado, fora das quatro saídas (parceiro incluso)', () => {
    for (const etapa of ['novo_lead', 'qualificacao', 'reuniao_agendada', 'sessao', 'diagnostico', 'proposta', 'follow_up', 'contrato'] as ComercialEtapa[]) {
      expect(motivoParaNaoIniciarOnboarding({ etapa, clienteAtivo: false })).toBeNull();
    }
    expect(motivoParaNaoIniciarOnboarding({ etapa: 'fechado', clienteAtivo: true })).toMatch(/já fechou/);
    expect(motivoParaNaoIniciarOnboarding({ etapa: 'contrato', clienteAtivo: true })).toMatch(/já fechou/);
    for (const etapa of ['desqualificado', 'geladeira', 'perdido', 'parceiro'] as ComercialEtapa[]) {
      expect(motivoParaNaoIniciarOnboarding({ etapa, clienteAtivo: false })).toMatch(/saiu do funil/);
    }
    expect(rotuloCurtoDaEtapa('proposta')).toBe('Proposta');
  });

  it('o selo: antecipado com a etapa do lead; aviso de saída; sai quando o lead fecha; o do fechamento não muda', () => {
    const base = { leadId: 'l1', criadoEm: new Date('2026-10-19T12:00:00Z'), motivoSaida: null, fechadoEm: null };
    expect(seloDoCard({ ...base, etapa: 'proposta', antecipado: true })).toEqual({ tipo: 'antecipado', leadId: 'l1', rotulo: 'Iniciado antes do fechamento · lead em Proposta' });
    expect(seloDoCard({ ...base, etapa: 'perdido', motivoSaida: 'preco', antecipado: true })).toEqual({ tipo: 'saiu_do_funil', leadId: 'l1', rotulo: 'lead saiu do funil: Perdido, preço' });
    expect(seloDoCard({ ...base, etapa: 'fechado', antecipado: true, fechadoEm: new Date('2026-10-25T12:00:00Z') }))
      .toEqual({ tipo: 'fechamento', leadId: 'l1', rotulo: 'fechado no comercial · 25/10/2026' });
    expect(seloDoCard({ ...base, etapa: 'fechado', antecipado: false })).toEqual({ tipo: 'fechamento', leadId: 'l1', rotulo: 'criado pelo fechamento · 19/10/2026' });
  });

  it('o selo: "Negócio fechado" à mão, sem fechamento nem cliente ativo, não diz "fechado no comercial"', () => {
    const base = { leadId: 'l1', criadoEm: new Date('2026-10-19T12:00:00Z'), motivoSaida: null, fechadoEm: null };
    expect(seloDoCard({ ...base, etapa: 'fechado', antecipado: true })).toEqual({
      tipo: 'antecipado',
      leadId: 'l1',
      rotulo: 'Iniciado antes do fechamento · lead em Negócio fechado, sem fechamento registrado',
    });
    // O cliente ativo (que o quadro passa em `fechadoEm`) é o que tira o selo.
    expect(seloDoCard({ ...base, etapa: 'fechado', antecipado: true, fechadoEm: new Date('2026-10-26T12:00:00Z') }))
      .toEqual({ tipo: 'fechamento', leadId: 'l1', rotulo: 'fechado no comercial · 26/10/2026' });
  });

  it('a porta única da implantação cita a terceira porta (cartão solto continua recusado)', () => {
    expect(PORTA_DA_IMPLANTACAO).toMatch(/Iniciar onboarding/);
  });

  it('o guarda do mover recusa conta de máquina e quem não tem sessão (o agente não inicia)', () => {
    const ctx = (user: unknown) => ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as unknown as ExecutionContext;
    const g = new SoGenteGuard();
    expect(() => g.canActivate(ctx({ sub: 'x', roles: ['ia_servico'] }))).toThrow(/de gente/);
    expect(() => g.canActivate(ctx({ sub: 'x', roles: ['ia_acao'] }))).toThrow(/de gente/);
    expect(() => g.canActivate(ctx(undefined))).toThrow();
    expect(g.canActivate(ctx({ sub: 'x', roles: ['admin_master'] }))).toBe(true);
  });
});

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (leads, fichas, cards, trilhos, Partner, fio e auditoria)');
process.env.ENCRYPTION_KEY ??= 'chave-de-teste-da-sala-0123456789abcdef';
process.env.GATEWAY_MODO = 'impor';

const MARCA = `oa${Date.now().toString(36).slice(-6)}`;
const ORG = `org-onb-antecipado-${MARCA}`;
const SENHA = 'senha-de-teste-a2';
const CNPJ = `5${Date.now().toString().slice(-13)}`;

describe.skipIf(!URL)('onboarding antecipado contra o Postgres', { timeout: 60_000 }, () => {
  let prisma: PrismaClient;
  let svc: OnboardingAntecipadoService;
  let fichas: FichaService;
  let fio: FioService;
  let fechamento: FechamentoService;
  let movimento: MovimentoDoQuadroService;
  let euId = '';
  let maquinaId = '';
  let inativoId = '';
  let semTarefasId = '';
  let trilhosSvc: TrilhoService;
  let leadA = '';
  const naEmpresa = <T>(fn: () => Promise<T>): Promise<T> => comContexto({ orgId: ORG, correlationId: `a2-${MARCA}`, origem: 'http' }, fn);
  const eu = () => ({ id: euId, nome: 'Rodrigo da Root', papeis: ['admin_master'] });

  async function lead(nome: string, etapa: ComercialEtapa, extra: { phone?: string | null; email?: string | null; empresa?: string | null; cnpj?: string | null; produto?: string | null; valorCentavos?: number | null } = {}) {
    const l = await prisma.lead.create({ data: { orgId: ORG, name: nome, phone: extra.phone ?? null, email: extra.email ?? null }, select: { id: true } });
    await prisma.comercialFicha.create({
      data: { leadId: l.id, etapa, empresa: extra.empresa === undefined ? nome : extra.empresa, cnpj: extra.cnpj ?? null, produto: extra.produto ?? null, valorCentavos: extra.valorCentavos ?? null, perfil: 'P2' },
    });
    return l.id;
  }

  const contar = async (leadId: string) => ({
    cards: await prisma.workTask.count({ where: { orgId: ORG, id: cardIdDoLead(ORG, leadId) } }),
    cardsNaEmpresa: await prisma.workTask.count({ where: { orgId: ORG } }),
    trilhos: await prisma.onboardingTrilho.count({ where: { orgId: ORG } }),
    partners: await prisma.partner.count({ where: { orgId: ORG } }),
    fatos: await prisma.leadEvent.count({ where: { leadId, type: 'implantacao.iniciada_antes_do_fechamento' } }),
  });

  let seq = 0;
  const cnpjNovo = () => `8${(Date.now() + ++seq).toString().slice(-13)}`;
  /** O lead fecha pela declaração (o caminho mais curto do mesmo fechamento: as seis escritas são as mesmas). */
  async function declararAceite(leadId: string, razaoSocial: string, cnpj: string, email: string) {
    const input = ClienteFechadoForaSchema.parse({
      razaoSocial, cnpj, quemAssina: 'Fulano Teste', email, telefone: '(32) 99999-0101',
      produto: 'operacao', valorCentavos: 1_199_700, parcelas: 3, forma: 'boleto', assinadoEm: '2026-10-01', primeiroVencimento: '2026-10-10', motivoSemCobranca: 'boleto do banco',
    });
    const sha = createHash('sha256').update(`pdf-${MARCA}-${leadId}`).digest('hex');
    const payload = payloadDaDeclaracao(camposDaDeclaracao(input, sha), 1, { id: euId, nome: 'Rodrigo da Root' });
    await fio.registrar(ORG, leadId, 'contrato.anexado', sha, { nome: 'c.pdf', bytes: 10, tipo: 'application/pdf', sha256: sha, chave: `x/${sha}`, assinadoEm: '2026-10-01', procedencia: 'teste', por: 'Rodrigo da Root' });
    await fio.registrar(ORG, leadId, 'aceite.declarado', String(payload.hash), payload);
    return (await naEmpresa(() => fechamento.aceiteParaFechar(ORG, leadId)))!;
  }

  async function seloDe(leadId: string) {
    const card = await prisma.workTask.findUniqueOrThrow({ where: { id: cardIdDoLead(ORG, leadId) }, select: { listId: true } });
    const m = await naEmpresa(() => movimento.daLista(ORG, card.listId));
    return m.itens.find((i) => i.tarefaId === cardIdDoLead(ORG, leadId))?.procedencia ?? null;
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    const p = prisma as unknown as PrismaService;
    await prisma.org.create({ data: { id: ORG, name: `Onboarding antecipado ${MARCA}`, slug: `onb-antecipado-${MARCA}` } });
    for (const key of ['leads.editar', 'tarefas.editar']) await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
    const admin = await prisma.role.create({ data: { orgId: ORG, key: 'admin_master', name: 'Admin', permissions: { connect: [{ key: 'leads.editar' }, { key: 'tarefas.editar' }] } }, select: { id: true } });
    const ia = await prisma.role.create({ data: { orgId: ORG, key: 'ia_servico', name: 'IA' }, select: { id: true } });
    const soLeads = await prisma.role.create({ data: { orgId: ORG, key: 'gestor_marketing', name: 'Só leads', permissions: { connect: [{ key: 'leads.editar' }] } }, select: { id: true } });
    const hash = await bcrypt.hash(SENHA, 4);
    semTarefasId = (await prisma.user.create({ data: { orgId: ORG, email: `sem-tarefas-${MARCA}@a2.teste`, name: 'Perdeu tarefas', passwordHash: hash, roles: { connect: { id: soLeads.id } } }, select: { id: true } })).id;
    euId = (await prisma.user.create({ data: { orgId: ORG, email: `rodrigo-${MARCA}@a2.teste`, name: 'Rodrigo da Root', passwordHash: hash, roles: { connect: { id: admin.id } } }, select: { id: true } })).id;
    maquinaId = (await prisma.user.create({ data: { orgId: ORG, email: `ia-${MARCA}@a2.teste`, name: 'Conta de serviço', passwordHash: hash, roles: { connect: { id: ia.id } } }, select: { id: true } })).id;
    inativoId = (await prisma.user.create({ data: { orgId: ORG, email: `inativo-${MARCA}@a2.teste`, name: 'Saiu da casa', passwordHash: hash, isActive: false, roles: { connect: { id: admin.id } } }, select: { id: true } })).id;

    const audit = new AuditService(p);
    const policy = new PolicyService(p);
    await policy.onModuleInit();
    const reauth = new ReauthService(p, new JwtService({ secret: `segredo-${MARCA}` }), audit);
    const approvals = new ApprovalsService(p, audit, reauth);
    const eventos = new EventLogService(p);
    const efeitos = new EfeitosRegistry();
    const interruptores = new InterruptoresRegistry();
    new ConectoresService(p, audit, eventos, interruptores).onModuleInit();
    const gateway = new ToolGateway(p, policy, new SinaisService(p, policy), approvals, eventos, undefined, interruptores, efeitos);
    const porta = new PortaDoOperador(gateway, efeitos);

    const reacoes = new ReacoesRegistry();
    fio = new FioService(p, reacoes);
    const relogio = new RelogioComercialRegistry();
    const sala = new SalaService(p, fio, reacoes);
    sala.onModuleInit();
    const whats = new WhatsappComercialService(p, fio, reacoes, relogio, sala, efeitos, porta);
    whats.onModuleInit();
    const config = new ConfigComercialService(p);
    const registroDeDecisoes = new DecisoesRegistry();
    const decisoes = new DecisoesService(p, fio, config, registroDeDecisoes);
    fichas = new FichaService(p, fio, config);
    // A espinha projeta a ficha dos fatos (a saída move a etapa), como em produção.
    new ReacoesDaEspinha(p, fio, reacoes, fichas, decisoes, registroDeDecisoes, new RelogioDaEspinha(p, new ExecutoresDeRotinaRegistry(), relogio, decisoes, fio, config, fichas)).inscrever();
    const naoChamar = new Proxy({} as PortaDeCobranca, { get: (_a, chave) => (chave === 'provedor' ? 'asaas' : chave === 'configurada' ? () => true : () => { throw new Error('a cobrança não deveria ser chamada'); }) });
    const assinatura = new Proxy({ provedor: 'zapsign' } as PortaDeAssinatura, { get: (alvo, chave) => (chave === 'provedor' ? alvo.provedor : () => { throw new Error('a ZapSign não deveria ser chamada'); }) });
    const dinheiro = new DinheiroService(p, fio, reacoes, efeitos, porta, naoChamar, assinatura, whats, reauth, audit);
    dinheiro.onModuleInit();
    const trilhos = new TrilhoService(p, undefined as never, eventos, undefined as never);
    fechamento = new FechamentoService(p, fio, reacoes, efeitos, porta, dinheiro, config, decisoes, registroDeDecisoes, trilhos, whats, relogio);
    fechamento.onModuleInit();
    trilhosSvc = trilhos;
    svc = new OnboardingAntecipadoService(p, fio, reacoes, fichas, trilhos);
    svc.onModuleInit();
    movimento = new MovimentoDoQuadroService(p);
  }, 60_000);

  afterAll(async () => {
    const ids = (await prisma.lead.findMany({ where: { orgId: ORG }, select: { id: true } })).map((l) => l.id);
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
      prisma.$executeRawUnsafe('DELETE FROM "EventLog" WHERE "orgId" = $1', ORG),
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
    ]);
    const trilhos = (await prisma.onboardingTrilho.findMany({ where: { orgId: ORG }, select: { id: true } })).map((t) => t.id);
    await prisma.onboardingMarco.deleteMany({ where: { trilhoId: { in: trilhos } } });
    await prisma.onboardingTrilho.deleteMany({ where: { orgId: ORG } });
    await prisma.workComment.deleteMany({ where: { orgId: ORG } });
    await prisma.workTask.deleteMany({ where: { orgId: ORG } });
    await prisma.workStatus.deleteMany({ where: { orgId: ORG } });
    await prisma.workList.deleteMany({ where: { orgId: ORG } });
    await prisma.workFolder.deleteMany({ where: { orgId: ORG } });
    await prisma.contract.deleteMany({ where: { orgId: ORG } });
    await prisma.partner.deleteMany({ where: { orgId: ORG } });
    await prisma.comercialFechamento.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.comercialCobranca.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.comercialDocumento.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.comercialDecisao.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.comercialMensagem.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.comercialReacao.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.comercialFicha.deleteMany({ where: { leadId: { in: ids } } });
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
  }, 60_000);

  it('iniciar em lead em proposta: card na lista certa e na etapa padrão, com selo, cliente, trilho, fato e auditoria', async () => {
    leadA = await lead('Padaria Trigo Antes', 'proposta', { phone: '5532999990101', email: 'joana@trigoantes.test', produto: 'operacao', valorCentavos: 1_199_700 });
    const r = await naEmpresa(() => svc.iniciar(ORG, leadA, {}, eu()));
    expect(r).toMatchObject({ leadId: leadA, estado: 'criado', cardId: cardIdDoLead(ORG, leadA), etapa: 'Kickoff marcado', cliente: 'criado', selo: 'Iniciado antes do fechamento · lead em Proposta' });

    const card = await prisma.workTask.findUniqueOrThrow({ where: { id: r.cardId }, include: { list: { include: { folder: true } }, status: true } });
    expect([card.list.folder?.name, card.list.name, card.status.name, card.title]).toEqual(['Clientes', 'Onboarding de cliente', 'Kickoff marcado', 'Padaria Trigo Antes']);
    expect(card.description).toContain('Procedência: iniciado antes do fechamento · lead em Proposta');
    expect(card.description).toContain('Produto: Operação ROOT · R$');
    expect(card.description).toContain('Lead no comercial: /comercial/lead/');
    // Nada inventado: o CNPJ não existia na ficha e não aparece.
    expect(card.description).toMatch(/^Cliente: Padaria Trigo Antes\n/);

    const ficha = await prisma.comercialFicha.findUniqueOrThrow({ where: { leadId: leadA } });
    expect([ficha.cardId, ficha.etapa]).toEqual([r.cardId, 'proposta']);
    expect(ficha.trilhoId).toBe(r.trilhoId);
    expect(ficha.partnerId).toBe(r.partnerId);
    const partner = await prisma.partner.findUniqueOrThrow({ where: { id: r.partnerId! } });
    expect([partner.isCliente, partner.razaoSocial, partner.phone, partner.email, partner.cnpjCpf]).toEqual([true, 'Padaria Trigo Antes', '5532999990101', 'joana@trigoantes.test', null]);
    expect(card.clienteId).toBe(partner.id);
    const trilho = await prisma.onboardingTrilho.findUniqueOrThrow({ where: { id: r.trilhoId! } });
    expect([trilho.cardId, trilho.cliente, trilho.contatoWhatsapp]).toEqual([r.cardId, 'Padaria Trigo Antes', '5532999990101']);

    const fato = await prisma.leadEvent.findFirstOrThrow({ where: { leadId: leadA, type: 'implantacao.iniciada_antes_do_fechamento' } });
    expect(fato.payload).toMatchObject({ cardId: r.cardId, etapa: 'Kickoff marcado', etapaDoLead: 'proposta', porId: euId, partnerId: partner.id, trilhoId: r.trilhoId });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { orgId: ORG, action: 'comercial.implantacao.iniciada_antes_do_fechamento', entityId: leadA } });
    expect([audit.actorType, audit.actorId]).toEqual(['user', euId]);
    const criacao = await prisma.auditLog.findFirstOrThrow({ where: { orgId: ORG, action: 'work.task.create', entityId: r.cardId } });
    expect([criacao.actorType, criacao.actorId, (criacao.after as { procedencia: string }).procedencia]).toEqual(['user', euId, 'antecipado']);
    const comentario = await prisma.workComment.findFirstOrThrow({ where: { taskId: r.cardId } });
    expect([comentario.authorId, comentario.authorName]).toEqual([euId, 'Rodrigo da Root']);

    expect(await seloDe(leadA)).toEqual({ tipo: 'antecipado', leadId: leadA, rotulo: 'Iniciado antes do fechamento · lead em Proposta' });
    // O painel do lead mostra o link para o card e o trilho (retrolink lead → card → trilho).
    const projecao = await naEmpresa(() => fichas.projecao(ORG, leadA));
    expect(projecao.ligadoA.implantacao).toMatchObject({ cardId: r.cardId, etapa: 'Kickoff marcado', trilhoId: r.trilhoId });
    expect(projecao.fio.some((l) => l.type === 'implantacao.iniciada_antes_do_fechamento')).toBe(true);
  });

  it('iniciar duas vezes (até com outra etapa): um card, um trilho, um Partner, um fato', async () => {
    const antes = await contar(leadA);
    const r = await naEmpresa(() => svc.iniciar(ORG, leadA, { etapa: 'Kit montado' }, eu()));
    expect(r).toMatchObject({ estado: 'reaproveitado', cardId: cardIdDoLead(ORG, leadA), etapa: 'Kickoff marcado' });
    expect(await contar(leadA)).toEqual(antes);
    expect(antes).toMatchObject({ cards: 1, trilhos: 1, partners: 1, fatos: 1 });
    // Dois cliques juntos também dão um só.
    const juntos = await Promise.all([naEmpresa(() => svc.iniciar(ORG, leadA, {}, eu())), naEmpresa(() => svc.iniciar(ORG, leadA, {}, eu()))]);
    expect(juntos.map((x) => x.estado)).toEqual(['reaproveitado', 'reaproveitado']);
    expect(await contar(leadA)).toEqual(antes);
  });

  it('dois cliques juntos num lead novo: um card, um trilho, um Partner', async () => {
    const l = await lead('Studio Lume Corrida', 'diagnostico', { phone: '5532999990102' });
    const antes = await contar(l);
    const r = await Promise.all([naEmpresa(() => svc.iniciar(ORG, l, {}, eu())), naEmpresa(() => svc.iniciar(ORG, l, {}, eu()))]);
    expect(r.map((x) => x.estado).sort()).toEqual(['criado', 'reaproveitado']);
    const depois = await contar(l);
    expect([depois.cards, depois.trilhos - antes.trilhos, depois.partners - antes.partners, depois.fatos]).toEqual([1, 1, 1, 1]);
  });

  it('a etapa escolhida vale; a do fechamento, a de encerramento e a inexistente são recusadas sem escrever nada', async () => {
    const l = await lead('Ótica Vista Antes', 'follow_up');
    const antes = await contar(l);
    await expect(naEmpresa(() => svc.iniciar(ORG, l, { etapa: 'Fechado no comercial' }, eu()))).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/etapa do fechamento/) });
    await expect(naEmpresa(() => svc.iniciar(ORG, l, { etapa: 'Encerrado' }, eu()))).rejects.toMatchObject({ status: 400 });
    await expect(naEmpresa(() => svc.iniciar(ORG, l, { etapa: 'Etapa inventada' }, eu()))).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/não existe/) });
    await expect(naEmpresa(() => svc.iniciar(ORG, l, { etapa: 12 }, eu()))).rejects.toMatchObject({ status: 400 });
    expect(await contar(l)).toEqual(antes);
    const r = await naEmpresa(() => svc.iniciar(ORG, l, { etapa: 'Kit montado' }, eu()));
    expect([r.estado, r.etapa]).toEqual(['criado', 'Kit montado']);
    const card = await prisma.workTask.findUniqueOrThrow({ where: { id: r.cardId }, include: { status: true } });
    expect(card.status.name).toBe('Kit montado');
    // Sem produto nem valor na ficha: o card diz [a decidir], nunca um número.
    expect(card.description).toContain('Produto: [a decidir] · [a decidir]');
  });

  it('conta de máquina, agente e gente inativa recebem 403; lead de outra empresa é 404', async () => {
    const l = await lead('Café Serra Máquina', 'proposta');
    const antes = await contar(l);
    await expect(naEmpresa(() => svc.iniciar(ORG, l, {}, { id: euId, nome: 'IA', papeis: ['ia_acao'] }))).rejects.toMatchObject({ status: 403 });
    await expect(naEmpresa(() => svc.iniciar(ORG, l, {}, { id: maquinaId, nome: 'IA', papeis: ['admin_master'] }))).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/de gente/) });
    await expect(naEmpresa(() => svc.iniciar(ORG, l, {}, { id: inativoId, nome: 'Saiu', papeis: ['admin_master'] }))).rejects.toMatchObject({ status: 403 });
    await expect(naEmpresa(() => svc.iniciar(ORG, l, {}, { id: 'agente-qualquer', nome: 'Agente', papeis: [] }))).rejects.toMatchObject({ status: 403 });
    // Revisão A2, achado 5: o token ainda diz tarefas.editar, o banco não; a permissão vale AGORA.
    await expect(naEmpresa(() => svc.iniciar(ORG, l, {}, { id: semTarefasId, nome: 'Perdeu tarefas', papeis: ['gestor_marketing'] }))).rejects.toMatchObject({ status: 403, message: 'Acesso insuficiente.' });
    await expect(naEmpresa(() => svc.iniciar(ORG, 'lead-de-outra-empresa', {}, eu()))).rejects.toMatchObject({ status: 404 });
    expect(await contar(l)).toEqual(antes);
  });

  it('lead fechado ou em qualquer saída é recusado com o motivo, sem escrever nada', async () => {
    const fechado = await lead('Rede Pão Bom Fechado', 'fechado');
    await expect(naEmpresa(() => svc.iniciar(ORG, fechado, {}, eu()))).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/já fechou/) });
    for (const saida of ['desqualificado', 'geladeira', 'perdido', 'parceiro'] as ComercialEtapa[]) {
      const l = await lead(`Lead em ${saida}`, saida);
      await expect(naEmpresa(() => svc.iniciar(ORG, l, {}, eu()))).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/saiu do funil/) });
      expect((await contar(l)).cards).toBe(0);
    }
    // Cliente já ativo (fechamento concluído) também é recusado, mesmo antes da etapa andar.
    const ativo = await lead('Mercado Ativo', 'contrato');
    await fio.registrar(ORG, ativo, 'cliente.ativo', `fech-${ativo}-v1`, { chave: `fech-${ativo}-v1` }, { semReacoes: true });
    await expect(naEmpresa(() => svc.iniciar(ORG, ativo, {}, eu()))).rejects.toMatchObject({ status: 409 });
  });

  it('a busca da Implantação só traz leads elegíveis', async () => {
    const lista = await naEmpresa(() => svc.elegiveis(ORG));
    const nomes = lista.map((l) => l.nome);
    expect(nomes).not.toContain('Padaria Trigo Antes'); // já tem card
    expect(nomes).not.toContain('Rede Pão Bom Fechado');
    expect(nomes).not.toContain('Mercado Ativo');
    expect(nomes.some((n) => n.startsWith('Lead em '))).toBe(false);
    expect(nomes).toContain('Café Serra Máquina');
    expect((await naEmpresa(() => svc.elegiveis(ORG, 'café serra'))).map((l) => l.nome)).toEqual(['Café Serra Máquina']);
    const etapas = await naEmpresa(() => svc.etapas(ORG));
    expect(etapas).toEqual({ etapas: ['Kickoff marcado', 'Kit montado', 'Contexto carregado', 'Imersão', 'Operação assistida'], padrao: 'Kickoff marcado' });
  });

  it('lead perdido com o onboarding iniciado: o card fica, com o aviso no comentário e no selo', async () => {
    const l = await lead('Pet Feliz Perdido', 'proposta');
    const r = await naEmpresa(() => svc.iniciar(ORG, l, {}, eu()));
    await naEmpresa(() => fichas.registrarSaida(ORG, l, { saida: 'perdido', motivo: 'preco', detalhe: 'achou caro' }, { id: euId, nome: 'Rodrigo da Root' }));
    const ficha = await prisma.comercialFicha.findUniqueOrThrow({ where: { leadId: l } });
    expect(ficha.etapa).toBe('perdido');
    const card = await prisma.workTask.findUniqueOrThrow({ where: { id: r.cardId } });
    expect(card.archived).toBe(false);
    const avisos = await prisma.workComment.findMany({ where: { taskId: r.cardId, authorName: AUTOR_DO_FUNIL } });
    expect(avisos).toHaveLength(1);
    expect(avisos[0].text).toMatch(/^Aviso: lead saiu do funil: Perdido, preço \(achou caro\)\. O card fica aqui até alguém decidir arquivar ou seguir\. Nada foi apagado\.$/);
    expect(await seloDe(l)).toEqual({ tipo: 'saiu_do_funil', leadId: l, rotulo: 'lead saiu do funil: Perdido, preço' });
    // A mesma reação de novo não repete o aviso.
    const saida = await prisma.leadEvent.findFirstOrThrow({ where: { leadId: l, type: 'saida.registrada' } });
    await svc.avisarSaida({ eventoId: saida.id, orgId: ORG, leadId: l, type: 'saida.registrada', payload: saida.payload as never, em: saida.occurredAt });
    expect(await prisma.workComment.count({ where: { taskId: r.cardId, authorName: AUTOR_DO_FUNIL } })).toBe(1);
    // Lead sem card antecipado: a saída não toca em nada.
    const outro = await lead('Auto Peças Sul Sem Card', 'proposta');
    await naEmpresa(() => fichas.registrarSaida(ORG, outro, { saida: 'perdido', motivo: 'sumiu' }, { id: euId, nome: 'Rodrigo da Root' }));
    expect(await prisma.workTask.count({ where: { id: cardIdDoLead(ORG, outro) } })).toBe(0);
  });

  it('revisão A2, achado 9: lead em saída com o card antecipado é recusado com o motivo, sem escrever', async () => {
    const l = await lead('Saída Depois do Card', 'proposta');
    await naEmpresa(() => svc.iniciar(ORG, l, {}, eu()));
    await prisma.comercialFicha.update({ where: { leadId: l }, data: { etapa: 'perdido' } });
    const auditoria = await prisma.auditLog.count({ where: { orgId: ORG } });
    const antes = await contar(l);
    await expect(naEmpresa(() => svc.iniciar(ORG, l, {}, eu()))).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/saiu do funil/) });
    expect(await prisma.auditLog.count({ where: { orgId: ORG } })).toBe(auditoria);
    expect(await contar(l)).toEqual(antes);
  });

  it('revisão A2, achado 3: com o fechamento a caminho (pendente ou em curso), iniciar recusa com o motivo', async () => {
    const l = await lead('Fechando Agora', 'contrato');
    await prisma.comercialFechamento.create({ data: { leadId: l, chave: `fech-${l}-v1`, versao: 1, estado: 'pendente', escritas: [] } });
    await expect(naEmpresa(() => svc.iniciar(ORG, l, {}, eu()))).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/fechamento deste lead já está a caminho/) });
    expect((await contar(l)).cards).toBe(0);
    expect(await prisma.onboardingTrilho.count({ where: { orgId: ORG, cliente: 'Fechando Agora' } })).toBe(0);
  });

  it('revisão A2, achado 3 (Q2c): iniciar em paralelo com o fechamento dá um card, um trilho e um cliente, sem órfão', async () => {
    const res: { iniciar: string; fechamento: string | undefined; cards: number; trilhos: number; orfaos: number; partners: number; comCnpj: number }[] = [];
    for (let i = 0; i < 6; i++) {
      const nome = `Corrida ${i} ${MARCA}`;
      const doc = cnpjNovo();
      const l = await lead(nome, 'contrato', { empresa: `${nome} Ltda`, phone: `55329222${String(i).padStart(5, '0')}` });
      const a = await declararAceite(l, `${nome} Ltda`, doc, `c${i}@corrida.test`);
      const tr0 = await prisma.onboardingTrilho.count({ where: { orgId: ORG } });
      const pa0 = await prisma.partner.count({ where: { orgId: ORG } });
      const [ri, rf] = await Promise.allSettled([naEmpresa(() => svc.iniciar(ORG, l, {}, eu())), naEmpresa(() => fechamento.executar(ORG, l, a))]);
      const ficha = await prisma.comercialFicha.findUniqueOrThrow({ where: { leadId: l } });
      res.push({
        iniciar: ri.status === 'fulfilled' ? ri.value.estado : `recusado ${(ri.reason as { status?: number }).status ?? (ri.reason as Error).message}`,
        fechamento: rf.status === 'fulfilled' ? rf.value.estado : `erro ${(rf.reason as Error).message}`,
        cards: await prisma.workTask.count({ where: { orgId: ORG, id: cardIdDoLead(ORG, l) } }),
        trilhos: (await prisma.onboardingTrilho.count({ where: { orgId: ORG } })) - tr0,
        orfaos: await prisma.onboardingTrilho.count({ where: { orgId: ORG, cliente: { startsWith: nome }, NOT: { id: ficha.trilhoId ?? '' } } }),
        partners: (await prisma.partner.count({ where: { orgId: ORG } })) - pa0,
        comCnpj: await prisma.partner.count({ where: { orgId: ORG, cnpjCpf: doc, isCliente: true } }),
      });
    }
    for (const r of res) {
      expect(['criado', 'reaproveitado', 'recusado 409']).toContain(r.iniciar);
      expect(r).toMatchObject({ fechamento: 'concluido', cards: 1, trilhos: 1, orfaos: 0, partners: 1, comCnpj: 1 });
    }
  });

  it('revisão A2, achado 4: com o pool de 2 conexões, dois leads ao mesmo tempo iniciam sem esgotar o pool', async () => {
    const pequeno = new PrismaClient({ datasources: { db: { url: `${URL}${URL!.includes('?') ? '&' : '?'}connection_limit=2&pool_timeout=5` } } });
    try {
      const pp = pequeno as unknown as PrismaService;
      const reacoes2 = new ReacoesRegistry();
      const fio2 = new FioService(pp, reacoes2);
      const svc2 = new OnboardingAntecipadoService(pp, fio2, reacoes2, new FichaService(pp, fio2, new ConfigComercialService(pp)), new TrilhoService(pp, undefined as never, new EventLogService(pp), undefined as never));
      const l1 = await lead('Pool Um', 'proposta');
      const l2 = await lead('Pool Dois', 'proposta');
      const r = await Promise.all([naEmpresa(() => svc2.iniciar(ORG, l1, {}, eu())), naEmpresa(() => svc2.iniciar(ORG, l2, {}, eu()))]);
      expect(r.map((x) => x.estado)).toEqual(['criado', 'criado']);
    } finally {
      await pequeno.$disconnect();
    }
  });

  it('fechar depois reaproveita o card (sem o selo de antes), o trilho e o Partner; fechar de novo não duplica', async () => {
    const antes = await contar(leadA);
    const cardAntes = await prisma.workTask.findUniqueOrThrow({ where: { id: cardIdDoLead(ORG, leadA) }, include: { status: true } });
    const fichaAntes = await prisma.comercialFicha.findUniqueOrThrow({ where: { leadId: leadA } });

    // O lead fecha (aqui pela declaração, o caminho mais curto do mesmo fechamento: as seis escritas são as mesmas).
    const input = ClienteFechadoForaSchema.parse({
      razaoSocial: 'Padaria Trigo Antes Ltda', cnpj: CNPJ, quemAssina: 'Joana Trigo', email: 'joana@trigoantes.test', telefone: '(32) 99999-0101',
      produto: 'operacao', valorCentavos: 1_199_700, parcelas: 3, forma: 'boleto', assinadoEm: '2026-10-01', primeiroVencimento: '2026-10-10', motivoSemCobranca: 'o cliente paga por boleto do banco',
    });
    const sha = createHash('sha256').update(`pdf-${MARCA}`).digest('hex');
    const campos = camposDaDeclaracao(input, sha);
    const payload = payloadDaDeclaracao(campos, 1, { id: euId, nome: 'Rodrigo da Root' });
    await fio.registrar(ORG, leadA, 'contrato.anexado', sha, { nome: 'contrato.pdf', bytes: 10, tipo: 'application/pdf', sha256: sha, chave: `x/${sha}`, assinadoEm: '2026-10-01', procedencia: 'teste', por: 'Rodrigo da Root' });
    await fio.registrar(ORG, leadA, 'aceite.declarado', String(payload.hash), payload);
    const a = await naEmpresa(() => fechamento.aceiteParaFechar(ORG, leadA));
    const tela = await naEmpresa(() => fechamento.executar(ORG, leadA, a!));
    expect(tela.escritas.map((e) => [e.escrita, e.estado])).toEqual([
      ['cliente', 'reaproveitado'],
      ['contrato', 'criado'],
      ['cobranca', 'pulado'],
      ['kit_e_trilho', 'reaproveitado'],
      ['card', 'reaproveitado'],
      ['grupo', 'criado'],
    ]);
    expect(tela.escritas.find((e) => e.escrita === 'card')?.ref).toBe(cardAntes.id);

    const depois = await contar(leadA);
    expect(depois).toEqual(antes);
    const ficha = await prisma.comercialFicha.findUniqueOrThrow({ where: { leadId: leadA } });
    expect([ficha.cardId, ficha.trilhoId, ficha.partnerId]).toEqual([fichaAntes.cardId, fichaAntes.trilhoId, fichaAntes.partnerId]);
    // O Partner é o mesmo e ganhou só o que estava vazio (o CNPJ); o nome e o e-mail ficaram.
    const partner = await prisma.partner.findUniqueOrThrow({ where: { id: ficha.partnerId! } });
    expect([partner.cnpjCpf, partner.razaoSocial, partner.email]).toEqual([CNPJ, 'Padaria Trigo Antes', 'joana@trigoantes.test']);
    const contrato = await prisma.contract.findUniqueOrThrow({ where: { id: ficha.contractId! } });
    expect(contrato.partnerId).toBe(partner.id);
    // O card: a mesma etapa, o comentário do fechamento, o fato no fio, e o selo de antes saiu.
    const card = await prisma.workTask.findUniqueOrThrow({ where: { id: cardAntes.id }, include: { status: true } });
    expect([card.status.name, card.clienteId, card.archived]).toEqual([cardAntes.status.name, partner.id, false]);
    const doFechamento = await prisma.workComment.findMany({ where: { taskId: card.id, authorName: AUTOR_DO_FECHAMENTO } });
    expect(doFechamento).toHaveLength(1);
    expect(doFechamento[0].text).toMatch(new RegExp(`^Fechamento comercial em \\d{2}/\\d{2}/\\d{4} \\(fech-${leadA}-v1\\)\\. O card foi iniciado antes do fechamento e segue em Kickoff marcado\\.$`));
    expect(await prisma.leadEvent.count({ where: { leadId: leadA, type: 'implantacao.fechamento_registrado' } })).toBe(1);
    expect(await prisma.leadEvent.count({ where: { leadId: leadA, type: 'implantacao.card_criado' } })).toBe(0);
    const selo = await seloDe(leadA);
    expect(selo?.tipo).toBe('fechamento');
    expect(selo?.rotulo).toMatch(/^fechado no comercial · /);
    expect(selo?.rotulo).not.toMatch(/antes do fechamento/);

    // Fechar de novo: a linha concluída devolve onde está; forçada a rodar outra vez, as escritas reaproveitam tudo.
    await naEmpresa(() => fechamento.executar(ORG, leadA, a!));
    await prisma.comercialFechamento.updateMany({ where: { leadId: leadA }, data: { estado: 'erro' } });
    const de_novo = await naEmpresa(() => fechamento.executar(ORG, leadA, a!));
    expect(de_novo.escritas.filter((e) => e.estado === 'criado')).toEqual([]);
    expect(await contar(leadA)).toEqual(antes);
    expect(await prisma.workComment.count({ where: { taskId: card.id, authorName: AUTOR_DO_FECHAMENTO } })).toBe(1);
    expect(await prisma.leadEvent.count({ where: { leadId: leadA, type: 'implantacao.fechamento_registrado' } })).toBe(1);
    expect(await prisma.contract.count({ where: { orgId: ORG, partnerId: partner.id } })).toBe(1);
    // Revisão A2, achado 9: depois de fechado, iniciar de novo é recusado com o motivo e não escreve nada.
    const auditoria = await prisma.auditLog.count({ where: { orgId: ORG } });
    await expect(naEmpresa(() => svc.iniciar(ORG, leadA, {}, eu()))).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/já fechou/) });
    expect(await prisma.auditLog.count({ where: { orgId: ORG } })).toBe(auditoria);
    expect(await contar(leadA)).toEqual(antes);
  });

  describe('o cliente (Partner): uma pessoa, um cadastro', () => {
    it('pelo CNPJ (só entre clientes); fornecedor com o mesmo CNPJ não vira cliente', async () => {
      const doc = `6${Date.now().toString().slice(-13)}`;
      const cliente = await prisma.partner.create({ data: { orgId: ORG, isCliente: true, razaoSocial: 'Construtora Alicerce SA', cnpjCpf: doc } });
      const l = await lead('Marina Duarte', 'sessao', { empresa: 'Construtora Alicerce', cnpj: `${doc.slice(0, 2)}.${doc.slice(2, 5)}.${doc.slice(5, 8)}/${doc.slice(8, 12)}-${doc.slice(12)}` });
      const r = await naEmpresa(() => svc.iniciar(ORG, l, {}, eu()));
      expect([r.cliente, r.partnerId]).toEqual(['cnpj', cliente.id]);

      const doc2 = `7${Date.now().toString().slice(-13)}`;
      const fornecedor = await prisma.partner.create({ data: { orgId: ORG, isFornecedor: true, razaoSocial: 'Fornecedor de Cimento', cnpjCpf: doc2 } });
      const l2 = await lead('Comprador de Cimento', 'proposta', { cnpj: doc2 });
      const r2 = await naEmpresa(() => svc.iniciar(ORG, l2, {}, eu()));
      expect(r2.cliente).toBe('criado');
      expect(r2.partnerId).not.toBe(fornecedor.id);
      expect((await prisma.partner.findUniqueOrThrow({ where: { id: fornecedor.id } })).isCliente).toBe(false);
    });

    it('revisão A2, achado 1 (Q2a): telefone e e-mail SOZINHOS não ligam o lead a outro cliente, nem no fechamento', async () => {
      const porTel = await prisma.partner.create({ data: { orgId: ORG, isCliente: true, razaoSocial: 'Cliente do Telefone', phone: '(32) 98888-0002' } });
      const l = await lead('Outro Nome Qualquer', 'qualificacao', { phone: '5532988880002' });
      const r = await naEmpresa(() => svc.iniciar(ORG, l, {}, eu()));
      expect(r.cliente).toBe('criado');
      expect(r.partnerId).not.toBe(porTel.id);

      // O contador partilhado: o e-mail dele não une a empresa nova ao cliente antigo.
      const outro = await prisma.partner.create({ data: { orgId: ORG, isCliente: true, razaoSocial: 'Cliente Antigo Contábil SA', email: 'contador@escritorio.test' } });
      const l2 = await lead('Fulana', 'proposta', { empresa: 'Empresa Nova Ltda', email: 'contador@escritorio.test' });
      const r2 = await naEmpresa(() => svc.iniciar(ORG, l2, {}, eu()));
      expect(r2.cliente).toBe('criado');
      expect(r2.partnerId).not.toBe(outro.id);
      const doc = cnpjNovo();
      const a = await declararAceite(l2, 'Empresa Nova Ltda', doc, 'financeiro@empresanova.test');
      const tela = await naEmpresa(() => fechamento.executar(ORG, l2, a));
      expect(tela.escritas.find((e) => e.escrita === 'cliente')).toMatchObject({ estado: 'reaproveitado', ref: r2.partnerId });
      const ficha = await prisma.comercialFicha.findUniqueOrThrow({ where: { leadId: l2 } });
      expect((await prisma.contract.findUniqueOrThrow({ where: { id: ficha.contractId! } })).partnerId).toBe(r2.partnerId);
      expect((await prisma.partner.findUniqueOrThrow({ where: { id: outro.id } })).cnpjCpf).toBeNull();
      expect((await prisma.partner.findUniqueOrThrow({ where: { id: r2.partnerId! } })).cnpjCpf).toBe(doc);
    });

    it('revisão A2, achado 2 (Q2b): o fechamento não grava no cliente da ficha um CNPJ que outro cliente já tem; segue pelo CNPJ e avisa', async () => {
      const doc = cnpjNovo();
      const z = await prisma.partner.create({ data: { orgId: ORG, isCliente: true, razaoSocial: 'Cliente Z Com CNPJ', cnpjCpf: doc } });
      const l = await lead('Beltrano', 'proposta', { empresa: 'Nome Diferente Comércio', phone: '5532911110000' });
      const r = await naEmpresa(() => svc.iniciar(ORG, l, {}, eu()));
      expect(r.cliente).toBe('criado');
      const a = await declararAceite(l, 'Cliente Z Com CNPJ', doc, 'z@z.test');
      const tela = await naEmpresa(() => fechamento.executar(ORG, l, a));
      const escrita = tela.escritas.find((e) => e.escrita === 'cliente')!;
      expect([escrita.estado, escrita.ref]).toEqual(['reaproveitado', z.id]);
      expect(escrita.detalhe).toMatch(/A conciliar: outro cliente da empresa já tem o CNPJ do aceite/);
      expect(await prisma.partner.count({ where: { orgId: ORG, cnpjCpf: doc, isCliente: true } })).toBe(1);
      // O cliente de antes fica (nada é apagado), sem o CNPJ alheio.
      expect((await prisma.partner.findUniqueOrThrow({ where: { id: r.partnerId! } })).cnpjCpf).toBeNull();
      const ficha = await prisma.comercialFicha.findUniqueOrThrow({ where: { leadId: l } });
      expect(ficha.partnerId).toBe(z.id);
      expect((await prisma.contract.findUniqueOrThrow({ where: { id: ficha.contractId! } })).partnerId).toBe(z.id);
      const card = await prisma.workTask.findUniqueOrThrow({ where: { id: cardIdDoLead(ORG, l) }, include: { comments: true } });
      expect(card.clienteId).toBe(z.id);
      expect(card.comments.filter((c) => c.text.startsWith('Cliente a conciliar:'))).toHaveLength(1);
      const aviso = await prisma.leadEvent.findMany({ where: { leadId: l, type: 'cliente.a_conciliar' } });
      expect(aviso).toHaveLength(1);
      expect(aviso[0].payload).toMatchObject({ partnerDaFicha: r.partnerId, partnerDoFechamento: z.id });
      // Fechar de novo não repete o aviso nem cria cliente.
      await prisma.comercialFechamento.updateMany({ where: { leadId: l }, data: { estado: 'erro' } });
      await naEmpresa(() => fechamento.executar(ORG, l, a));
      expect(await prisma.leadEvent.count({ where: { leadId: l, type: 'cliente.a_conciliar' } })).toBe(1);
      expect(await prisma.partner.count({ where: { orgId: ORG, cnpjCpf: doc, isCliente: true } })).toBe(1);
    });

    it('revisão A2: o cliente da ficha com OUTRO CNPJ não recebe o contrato; o fechamento segue a D-12 e avisa', async () => {
      const docAntigo = cnpjNovo();
      const antigo = await prisma.partner.create({ data: { orgId: ORG, isCliente: true, razaoSocial: 'Grupo Antigo SA', cnpjCpf: docAntigo } });
      const l = await lead('Grupo Antigo Filial', 'proposta', { empresa: 'Grupo Antigo SA', cnpj: docAntigo });
      expect(await naEmpresa(() => svc.iniciar(ORG, l, {}, eu()))).toMatchObject({ cliente: 'cnpj', partnerId: antigo.id });
      const docNovo = cnpjNovo();
      const a = await declararAceite(l, 'Grupo Antigo Filial Ltda', docNovo, 'filial@grupo.test');
      const tela = await naEmpresa(() => fechamento.executar(ORG, l, a));
      const escrita = tela.escritas.find((e) => e.escrita === 'cliente')!;
      expect(escrita.estado).toBe('criado');
      expect(escrita.ref).not.toBe(antigo.id);
      expect(escrita.detalhe).toMatch(/A conciliar: o cliente ligado ao lead antes do fechamento tem outro CNPJ/);
      expect((await prisma.partner.findUniqueOrThrow({ where: { id: antigo.id } })).cnpjCpf).toBe(docAntigo);
      expect((await prisma.partner.findUniqueOrThrow({ where: { id: escrita.ref! } })).cnpjCpf).toBe(docNovo);
    });

    it('pelo nome normalizado; fornecedor de mesmo nome nunca é promovido', async () => {
      const porNome = await prisma.partner.create({ data: { orgId: ORG, isCliente: true, razaoSocial: 'Café Serra Ltda' } });
      const l = await lead('Café Serra Contato', 'proposta', { empresa: 'CAFE  SERRA LTDA' });
      expect(await naEmpresa(() => svc.iniciar(ORG, l, {}, eu()))).toMatchObject({ cliente: 'nome', partnerId: porNome.id });

      const fornecedor = await prisma.partner.create({ data: { orgId: ORG, isFornecedor: true, razaoSocial: 'Gráfica Papel Bom' } });
      const l2 = await lead('Gráfica Papel Bom', 'proposta');
      const r2 = await naEmpresa(() => svc.iniciar(ORG, l2, {}, eu()));
      expect(r2.cliente).toBe('criado');
      expect(r2.partnerId).not.toBe(fornecedor.id);
      expect((await prisma.partner.findUniqueOrThrow({ where: { id: fornecedor.id } })).isCliente).toBe(false);
    });

    it('o Partner que a ficha já aponta vem primeiro', async () => {
      const daFicha = await prisma.partner.create({ data: { orgId: ORG, isCliente: true, razaoSocial: 'Nome Antigo do Cliente' } });
      const l = await lead('Nome Novo do Lead', 'contrato');
      await prisma.comercialFicha.update({ where: { leadId: l }, data: { partnerId: daFicha.id } });
      expect(await naEmpresa(() => svc.iniciar(ORG, l, {}, eu()))).toMatchObject({ cliente: 'ficha', partnerId: daFicha.id });
      const card = await prisma.workTask.findUniqueOrThrow({ where: { id: cardIdDoLead(ORG, l) } });
      expect(card.clienteId).toBe(daFicha.id);
    });

    it('revisão A2, achado 2: ao fim da suíte, nenhum par de clientes da empresa com o mesmo CNPJ', async () => {
      const clientes = await prisma.partner.findMany({ where: { orgId: ORG, isCliente: true, cnpjCpf: { not: null } }, select: { cnpjCpf: true } });
      const docs = clientes.map((c) => c.cnpjCpf!.replace(/\D/g, '')).filter(Boolean);
      expect(docs.length).toBeGreaterThan(3);
      expect(new Set(docs).size).toBe(docs.length);
      expect(trilhosSvc).toBeDefined();
    });
  });
});
