import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RESPOSTA_DO_FORMULARIO, TIPO_DA_PENDENCIA_DA_TRIAGEM } from '@mktos/shared';

import { ApprovalsService } from '../src/approvals/approvals.service';
import { AuditService } from '../src/audit/audit.service';
import type { ArquivistaDoClientePort, PedidoDeArquivo } from '../src/clientes/portas';
import { comContexto } from '../src/common/contexto-execucao';
import { SimuladoProvider } from '../src/comercial/canais/simulado.provider';
import { EvolutionEntradaService } from '../src/comercial/evolution-entrada.service';
import { FichaService } from '../src/comercial/ficha.service';
import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { FormularioDoSiteController } from '../src/comercial/formulario-do-site/formulario-do-site.controller';
import {
  FormularioDoSiteService,
  NOTA_DO_FORMULARIO_DO_SITE,
  formularioLigadoNaNota,
} from '../src/comercial/formulario-do-site/formulario-do-site.service';
import { ConfigComercialService } from '../src/comercial/config.service';
import { DecisoesRegistry, DecisoesService } from '../src/comercial/decisoes.service';
import { ReacoesDaEspinha } from '../src/comercial/reacoes-da-espinha';
import { RelogioDaEspinha } from '../src/comercial/relogio-da-espinha';
import { ExecutoresDeRotinaRegistry } from '../src/routines/executores.registry';
import { LeadCriarService } from '../src/comercial/lead-criar.service';
import { RelogioComercialRegistry } from '../src/comercial/relogio.registry';
import { SalaService } from '../src/comercial/sala.service';
import { RAZAO_DO_TETO_DA_TRIAGEM, TriagemDoWhatsappService } from '../src/comercial/triagem-do-whatsapp/triagem-do-whatsapp.service';
import { expurgarTextoVencido } from '../src/pendencias/retencao-do-texto';
import { WhatsappComercialService } from '../src/comercial/whatsapp.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { EventLogService } from '../src/gateway/event-log.service';
import { InterruptoresRegistry } from '../src/gateway/interruptores.registry';
import { PortaDoOperador } from '../src/gateway/porta-do-operador.service';
import { ToolGateway } from '../src/gateway/tool-gateway.service';
import { ConectoresService } from '../src/integrations/conectores.service';
import { LeadsService } from '../src/leads/leads.service';
import { StubProvider } from '../src/llm/stub.provider';
import type { MemoriaService } from '../src/memory/memoria.service';
import { PendenciasRegistry } from '../src/pendencias/pendencias.registry';
import { PendenciasService } from '../src/pendencias/pendencias.service';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { ModulosService } from '../src/tenants/modulos.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * A ENTRADA DE LEADS DA RODADA DOS AGENTES (21/10/2026, lane A2), contra o Postgres.
 *
 *   · CO-15, o formulário do site: o lead nasce PELA PORTA (`comercial.lead.criar`,
 *     R1) pela entrada idempotente; a mesma requisição é o mesmo lead e o mesmo
 *     fato; a isca não grava nada; campo inválido é 400; chave de empresa que não
 *     existe e empresa sem o módulo são o mesmo 404; o teto por origem dá 429; e
 *     nenhuma mensagem, cobrança ou contrato nasce dele (a M1 não é preparada);
 *   · CO-16, a triagem do WhatsApp pela Evolution: as cinco classes com o stub, a
 *     confiança baixa virando pendência e a pessoa decidindo "lead novo" (que vai
 *     pela porta em nome dela), o documento indo ao arquivista, e a triagem
 *     desligada deixando tudo como antes. Nada é respondido ao contato.
 *
 * A hora é fixada às 14:00 de São Paulo num dia útil: fora da janela da política
 * (08h-20h) o R1 vira R2 e o pedido fica retido, que é outro caso (também medido).
 */

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (leads, fichas, fio, pendências, auditoria e o registro da porta)');

const ORG = randomUUID();
const MARCA = `a2e${Date.now().toString(36).slice(-6)}`;
const PASTA_DO_STUB = resolve(__dirname, '../../../homolog/fixtures/stub');
const INSTANCIA = `inst-${MARCA}`;

describe.skipIf(!URL)('a entrada de leads dos agentes do comercial, contra o Postgres', { timeout: 60_000 }, () => {
  let prisma: PrismaClient;
  let formulario: FormularioDoSiteService;
  let controlador: FormularioDoSiteController;
  let triagem: TriagemDoWhatsappService;
  let entrada: EvolutionEntradaService;
  let pendencias: PendenciasService;
  let fio: FioService;
  const modulosLigados = new Set(['leads']);
  const notas: Record<string, string> = {};
  const arquivados: PedidoDeArquivo[] = [];
  let pessoaId = '';
  const ambienteAntes = process.env.WHATSAPP_PROVEDOR;

  const naEmpresa = <T>(fn: () => Promise<T>): Promise<T> => comContexto({ orgId: ORG, correlationId: `a2e-${MARCA}`, origem: 'http' }, fn);
  const corpo = (extra: Record<string, unknown> = {}) => ({ k: ORG, nome: 'Ana Formulário', email: `ana-${MARCA}@exemplo.test`, telefone: '(32) 98888-1111', empresa: 'Mercearia Exemplo', mensagem: 'Quero entender a Imersão.', ...extra });
  const leadsDoForm = () => prisma.lead.findMany({ where: { orgId: ORG, email: `ana-${MARCA}@exemplo.test` }, select: { id: true } });
  const evolucao = (telefone: string, mensagem: Record<string, unknown>, messageType = 'conversation', id = randomUUID()) => ({
    event: 'messages.upsert',
    instance: INSTANCIA,
    data: { key: { remoteJid: `${telefone}@s.whatsapp.net`, fromMe: false, id }, pushName: 'Contato Exemplo', messageType, message: mensagem },
  });

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T14:00:00-03:00'));
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    const p = prisma as unknown as PrismaService;
    await prisma.org.create({ data: { id: ORG, name: `Agentes A2 entrada ${MARCA}`, slug: `a2-entrada-${MARCA}` } });
    // Responder a triagem do WhatsApp exige `leads.editar` (relida no banco).
    const papel = await prisma.role.create({ data: { orgId: ORG, key: 'admin_master', name: 'Admin', permissions: { connectOrCreate: [{ where: { key: 'leads.editar' }, create: { key: 'leads.editar' } }] } }, select: { id: true } });
    pessoaId = (await prisma.user.create({ data: { orgId: ORG, email: `lucas-${MARCA}@a2.teste`, name: 'Lucas Exemplo', passwordHash: await bcrypt.hash('x', 4), roles: { connect: { id: papel.id } } }, select: { id: true } })).id;

    const audit = new AuditService(p);
    const policy = new PolicyService(p);
    await policy.onModuleInit();
    const approvals = new ApprovalsService(p, audit);
    const eventos = new EventLogService(p);
    const efeitos = new EfeitosRegistry();
    const interruptores = new InterruptoresRegistry();
    new ConectoresService(p, audit, eventos, interruptores).onModuleInit();
    const gateway = new ToolGateway(p, policy, new SinaisService(p, policy), approvals, eventos, undefined, interruptores, efeitos);
    const porta = new PortaDoOperador(gateway, efeitos);

    const reacoes = new ReacoesRegistry();
    fio = new FioService(p, reacoes);
    const sala = new SalaService(p, fio, reacoes);
    sala.onModuleInit();
    const relogio = new RelogioComercialRegistry();
    const whats = new WhatsappComercialService(p, fio, reacoes, relogio, sala, efeitos, porta, new SimuladoProvider());
    whats.onModuleInit();
    const config = new ConfigComercialService(p);
    const fichas = new FichaService(p, fio, config);
    // A espinha projeta a ficha dos fatos (canal e empresa do formulário), como em produção.
    const registroDeDecisoes = new DecisoesRegistry();
    const decisoes = new DecisoesService(p, fio, config, registroDeDecisoes);
    new ReacoesDaEspinha(p, fio, reacoes, fichas, decisoes, registroDeDecisoes, new RelogioDaEspinha(p, new ExecutoresDeRotinaRegistry(), relogio, decisoes, fio, config, fichas)).inscrever();
    const modulos = { modulosDaOrg: async () => modulosLigados } as unknown as ModulosService;
    const leads = new LeadsService(p, audit, modulos);
    new LeadCriarService(efeitos, leads, fichas, fio, whats).onModuleInit();
    const memoria = { porChave: async (_org: string, chave: string) => (notas[chave] ? { body: notas[chave] } : null) } as unknown as MemoriaService;
    // A empresa optou pelo formulário do site (a nota que a revisão de 21/10 exige).
    notas[NOTA_DO_FORMULARIO_DO_SITE] = 'ligado\nformulário de operacaoroot.com';
    formulario = new FormularioDoSiteService(p, porta, modulos, memoria);
    controlador = new FormularioDoSiteController(formulario);
    const registroDePendencias = new PendenciasRegistry();
    pendencias = new PendenciasService(p, registroDePendencias);
    const arquivista: ArquivistaDoClientePort = {
      arquivar: async (pedido) => {
        arquivados.push(pedido);
        return { estado: 'na_fila', motivo: 'sem pasta do cliente ainda' };
      },
    };
    triagem = new TriagemDoWhatsappService(p, fio, memoria, porta, pendencias, registroDePendencias, new StubProvider(PASTA_DO_STUB), arquivista);
    triagem.onModuleInit();
    const evolution = { ligado: async () => true, instanciaDaEmpresa: async () => INSTANCIA };
    entrada = new EvolutionEntradaService(p, whats, sala, evolution as never, undefined, triagem);
  }, 60_000);

  afterAll(async () => {
    vi.useRealTimers();
    if (ambienteAntes === undefined) delete process.env.WHATSAPP_PROVEDOR;
    else process.env.WHATSAPP_PROVEDOR = ambienteAntes;
    if (!prisma) return;
    const ids = (await prisma.lead.findMany({ where: { orgId: ORG }, select: { id: true } })).map((l) => l.id);
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
      prisma.$executeRawUnsafe('DELETE FROM "EventLog" WHERE "orgId" = $1', ORG),
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
    ]);
    await prisma.pendencia.deleteMany({ where: { orgId: ORG } });
    await prisma.comercialMensagem.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.comercialReacao.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.comercialDecisao.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.comercialFicha.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.salaDoCliente.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.leadEvent.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.lead.deleteMany({ where: { orgId: ORG } });
    await prisma.partner.deleteMany({ where: { orgId: ORG } });
    await prisma.approval.deleteMany({ where: { orgId: ORG } });
    await prisma.toolCall.deleteMany({ where: { orgId: ORG } });
    await prisma.policyDecision.deleteMany({ where: { orgId: ORG } });
    await prisma.auditLog.deleteMany({ where: { orgId: ORG } });
    await prisma.rotina.deleteMany({ where: { orgId: ORG } });
    await prisma.comercialConfig.deleteMany({ where: { orgId: ORG } });
    await prisma.user.deleteMany({ where: { orgId: ORG } });
    await prisma.role.deleteMany({ where: { orgId: ORG } });
    await prisma.org.deleteMany({ where: { id: ORG } });
    await prisma.$disconnect();
  }, 60_000);

  // -------------------------------------------------------------------------
  // CO-15 · o formulário do site
  // -------------------------------------------------------------------------

  it('CO-15: o envio cria o lead pela porta (R1, executado), com ficha, fio e a empresa na ficha; a resposta não ecoa nada', async () => {
    const r = await controlador.lead(corpo(), { ip: '10.1.1.1' } as never);
    expect(r).toEqual(RESPOSTA_DO_FORMULARIO);
    const leads = await leadsDoForm();
    expect(leads).toHaveLength(1);
    const leadId = leads[0].id;
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect([lead.name, lead.phone]).toEqual(['Ana Formulário', '5532988881111']);
    const ficha = await prisma.comercialFicha.findUniqueOrThrow({ where: { leadId } });
    expect([ficha.etapa, ficha.canal, ficha.empresa]).toEqual(['novo_lead', 'site', 'Mercearia Exemplo']);
    const tipos = (await prisma.leadEvent.findMany({ where: { leadId }, select: { type: true } })).map((e) => e.type);
    expect(tipos).toEqual(expect.arrayContaining(['entrada', 'lead.chegou', 'site.formulario']));
    const chamada = await prisma.toolCall.findFirstOrThrow({ where: { orgId: ORG, capabilityId: 'comercial.lead.criar' } });
    expect([chamada.status, chamada.nivel, chamada.actorType]).toEqual(['executado', 'R1', 'system']);
  });

  it('CO-15: a mesma requisição de novo é o mesmo lead e o mesmo fato; outra mensagem do mesmo contato cai no mesmo lead', async () => {
    await controlador.lead(corpo(), { ip: '10.1.1.2' } as never);
    const leads = await leadsDoForm();
    expect(leads).toHaveLength(1);
    expect(await prisma.leadEvent.count({ where: { leadId: leads[0].id, type: 'site.formulario' } })).toBe(1);
    expect(await prisma.leadEvent.count({ where: { leadId: leads[0].id, type: 'lead.chegou' } })).toBe(1);
    await controlador.lead(corpo({ mensagem: 'Esqueci de dizer: somos três sócios.' }), { ip: '10.1.1.3' } as never);
    expect(await leadsDoForm()).toHaveLength(1);
    expect(await prisma.leadEvent.count({ where: { leadId: leads[0].id, type: 'site.formulario' } })).toBe(2);
  });

  it('CO-15: nenhuma mensagem, cobrança ou contrato nasce do formulário (a M1 não é preparada)', async () => {
    const [{ id }] = await leadsDoForm();
    expect(await prisma.comercialMensagem.count({ where: { leadId: id } })).toBe(0);
    expect(await prisma.comercialCobranca.count({ where: { leadId: id } })).toBe(0);
    expect(await prisma.comercialDocumento.count({ where: { leadId: id } })).toBe(0);
    expect(await prisma.approval.count({ where: { orgId: ORG } })).toBe(0);
    const m1 = await prisma.comercialReacao.findFirst({ where: { leadId: id, reacao: 'whats.m1' }, select: { resultado: true } });
    expect(JSON.stringify(m1?.resultado ?? {})).toContain('lead do formulário do site');
  });

  it('CO-15: a isca preenchida devolve o mesmo "recebido" e não grava nada', async () => {
    const antes = await prisma.lead.count({ where: { orgId: ORG } });
    const r = await controlador.lead(corpo({ email: `robo-${MARCA}@exemplo.test`, website: 'http://spam.example' }), { ip: '10.1.1.4' } as never);
    expect(r).toEqual(RESPOSTA_DO_FORMULARIO);
    expect(await prisma.lead.count({ where: { orgId: ORG } })).toBe(antes);
  });

  it('CO-15: campos inválidos são 400 sem gravar; chave que não existe e empresa sem o módulo são o mesmo 404', async () => {
    const antes = await prisma.lead.count({ where: { orgId: ORG } });
    await expect(controlador.lead(corpo({ email: 'nao-e-email', telefone: undefined }), { ip: '10.1.1.5' } as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controlador.lead(corpo({ email: undefined, telefone: undefined }), { ip: '10.1.1.5' } as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controlador.lead(corpo({ k: randomUUID() }), { ip: '10.1.1.5' } as never)).rejects.toBeInstanceOf(NotFoundException);
    modulosLigados.delete('leads');
    try {
      await expect(controlador.lead(corpo({ email: `sem-modulo-${MARCA}@exemplo.test` }), { ip: '10.1.1.5' } as never)).rejects.toBeInstanceOf(NotFoundException);
    } finally {
      modulosLigados.add('leads');
    }
    expect(await prisma.lead.count({ where: { orgId: ORG } })).toBe(antes);
  });

  it('REVISÃO CO-15: sem o opt-in da empresa (nota comercial.formulario.site = ligado) é o mesmo 404, e nada é gravado', async () => {
    const antes = await prisma.lead.count({ where: { orgId: ORG } });
    for (const corpoDaNota of [undefined, 'desligado', '', 'ligada mas não']) {
      if (corpoDaNota === undefined) delete notas[NOTA_DO_FORMULARIO_DO_SITE];
      else notas[NOTA_DO_FORMULARIO_DO_SITE] = corpoDaNota;
      await expect(controlador.lead(corpo({ email: `sem-optin-${MARCA}@exemplo.test` }), { ip: '10.1.1.9' } as never)).rejects.toBeInstanceOf(NotFoundException);
    }
    expect(await prisma.lead.count({ where: { orgId: ORG } })).toBe(antes);
    notas[NOTA_DO_FORMULARIO_DO_SITE] = 'ligado';
    expect(formularioLigadoNaNota('**Ligado**\nqualquer coisa')).toBe(true);
    expect(formularioLigadoNaNota('\n  ligado  ')).toBe(true);
    expect(formularioLigadoNaNota('desligado')).toBe(false);
  });

  it('CO-15: o teto por origem dá 429 (e outra origem segue)', async () => {
    const c = new FormularioDoSiteController(formulario);
    c.tetos.porOrigem = 2;
    await c.lead(corpo({ email: `t1-${MARCA}@exemplo.test` }), { ip: '10.9.9.9' } as never);
    await c.lead(corpo({ email: `t2-${MARCA}@exemplo.test` }), { ip: '10.9.9.9' } as never);
    const erro = await c.lead(corpo({ email: `t3-${MARCA}@exemplo.test` }), { ip: '10.9.9.9' } as never).catch((e) => e);
    expect(erro).toBeInstanceOf(HttpException);
    expect((erro as HttpException).getStatus()).toBe(429);
    await expect(c.lead(corpo({ email: `t4-${MARCA}@exemplo.test` }), { ip: '10.9.9.8' } as never)).resolves.toEqual(RESPOSTA_DO_FORMULARIO);
  });

  it('CO-15: fora da janela da política (23h) o R1 sobe para R2 e fica retido; o site ouve o mesmo "recebido"', async () => {
    vi.setSystemTime(new Date('2026-10-21T23:30:00-03:00'));
    try {
      const r = await controlador.lead(corpo({ email: `noite-${MARCA}@exemplo.test` }), { ip: '10.1.1.6' } as never);
      expect(r).toEqual(RESPOSTA_DO_FORMULARIO);
      expect(await prisma.lead.count({ where: { orgId: ORG, email: `noite-${MARCA}@exemplo.test` } })).toBe(0);
      expect(await prisma.approval.count({ where: { orgId: ORG, capabilityId: 'comercial.lead.criar' } })).toBe(1);
    } finally {
      vi.setSystemTime(new Date('2026-10-21T14:00:00-03:00'));
    }
  });

  // -------------------------------------------------------------------------
  // CO-16 · a triagem do WhatsApp
  // -------------------------------------------------------------------------

  it('CO-16 desligada (sem a nota): o número que não é lead segue para o canal, como antes', async () => {
    process.env.WHATSAPP_PROVEDOR = 'evolution';
    const r = await naEmpresa(() => entrada.processar(ORG, evolucao('5532977770001', { conversation: 'Oi, quanto custa a imersão?' }), '5532977770001'));
    expect(r).toBeNull();
    expect(await prisma.lead.count({ where: { orgId: ORG, phone: '5532977770001' } })).toBe(0);
  });

  it('CO-16 lead novo: o número desconhecido vira lead pela porta (origem whatsapp), com a classe no fio', async () => {
    notas['comercial.whatsapp.triagem'] = 'ligada\nnota de teste';
    const r = await naEmpresa(() => entrada.processar(ORG, evolucao('5532977770002', { conversation: 'Oi, quanto custa a imersão?' }), '5532977770002'));
    expect(r).toBe('triagem: lead_novo');
    const lead = await prisma.lead.findFirstOrThrow({ where: { orgId: ORG, phone: '5532977770002' }, select: { id: true, name: true } });
    expect(lead.name).toBe('Contato Exemplo');
    const triada = await prisma.leadEvent.findFirstOrThrow({ where: { leadId: lead.id, type: 'whats.triada' } });
    expect(triada.payload).toMatchObject({ classe: 'lead_novo', origem: 'modelo', destino: 'lead novo no funil' });
    const chamada = await prisma.toolCall.findFirstOrThrow({ where: { orgId: ORG, capabilityId: 'comercial.lead.criar', actorId: 'triagem-do-whatsapp' } });
    expect(chamada.status).toBe('executado');
    // Nada foi RESPONDIDO ao contato: a M1 do funil espera uma pessoa (R3), nada saiu.
    expect(await prisma.comercialMensagem.count({ where: { leadId: lead.id, direcao: 'saida', estado: 'enviada' } })).toBe(0);
  });

  it('CO-16 dúvida de lead e cliente ativo: a mensagem do lead segue o caminho de sempre e ganha a classe no fio', async () => {
    const duvida = await naEmpresa(() => entrada.processar(ORG, evolucao('5532977770002', { conversation: 'Sobre o boleto da proposta, vence quando?' }), '5532977770002'));
    expect(duvida).toBe('mensagem de lead');
    const lead = await prisma.lead.findFirstOrThrow({ where: { orgId: ORG, phone: '5532977770002' }, select: { id: true } });
    const classes = async (leadId: string) => (await prisma.leadEvent.findMany({ where: { leadId, type: 'whats.triada' }, orderBy: { occurredAt: 'asc' }, select: { payload: true } })).map((e) => (e.payload as { classe: string }).classe);
    expect(await classes(lead.id)).toEqual(['lead_novo', 'duvida_de_lead']);

    const cliente = await prisma.lead.create({ data: { orgId: ORG, name: 'Cliente Exemplo', phone: '5532977770003' }, select: { id: true } });
    await prisma.comercialFicha.create({ data: { leadId: cliente.id, etapa: 'fechado', clienteAtivoEm: new Date() } });
    const ativo = await naEmpresa(() => entrada.processar(ORG, evolucao('5532977770003', { conversation: 'A conciliação do mês ficou pronta?' }), '5532977770003'));
    expect(ativo).toBe('mensagem de lead');
    expect(await classes(cliente.id)).toEqual(['cliente_ativo']);
  });

  it('CO-16 documento: o arquivo vai ao arquivista (origem whatsapp, sem cliente = partnerId nulo); sem o binário, o motivo fica', async () => {
    const pdf = Buffer.from('%PDF-1.4 documento de teste').toString('base64');
    const r = await naEmpresa(() => entrada.processar(ORG, evolucao('5532977770004', { documentMessage: { fileName: 'nota.pdf', mimetype: 'application/pdf' }, base64: pdf }, 'documentMessage'), '5532977770004'));
    expect(r).toBe('triagem: documento (arquivista: na_fila)');
    expect(arquivados.at(-1)).toMatchObject({ orgId: ORG, partnerId: null, leadId: null, origem: 'whatsapp', nomeOriginal: 'nota.pdf', tipoMime: 'application/pdf' });
    const sem = await naEmpresa(() => entrada.processar(ORG, evolucao('5532977770004', { documentMessage: { fileName: 'nota2.pdf', mimetype: 'application/pdf' } }, 'documentMessage'), '5532977770004'));
    expect(sem).toContain('sem o arquivo: ligue o webhook base64');
    expect(arquivados).toHaveLength(1);
  });

  it('CO-16 outro: propaganda de número desconhecido não cria lead nem pendência', async () => {
    const r = await naEmpresa(() => entrada.processar(ORG, evolucao('5532977770005', { conversation: 'Promoção imperdível de cartões!' }), '5532977770005'));
    expect(r).toBe('triagem: outro (ignorado)');
    expect(await prisma.lead.count({ where: { orgId: ORG, phone: '5532977770005' } })).toBe(0);
    expect(await prisma.pendencia.count({ where: { orgId: ORG } })).toBe(0);
  });

  it('CO-16 confiança baixa: vira pendência para uma pessoa; ela decide "lead novo" e o lead nasce pela porta em nome dela', async () => {
    const r = await naEmpresa(() => entrada.processar(ORG, evolucao('5532977770006', { conversation: 'Tudo bem por aí?' }), '5532977770006'));
    expect(r).toBe('triagem: pendência');
    const p = await prisma.pendencia.findFirstOrThrow({ where: { orgId: ORG, tipo: TIPO_DA_PENDENCIA_DA_TRIAGEM } });
    expect([p.funcao, p.estado]).toEqual(['CO-16', 'aberta']);
    expect(p.titulo).toContain('…0006');
    expect(p.titulo).not.toContain('5532977770006');
    expect((p.opcoes as { chave: string }[]).map((o) => o.chave)).toEqual(['lead_novo', 'cliente_ativo', 'outro']);
    expect(await prisma.lead.count({ where: { orgId: ORG, phone: '5532977770006' } })).toBe(0);

    await naEmpresa(() => pendencias.responder(ORG, p.id, pessoaId, 'lead_novo'));
    const lead = await prisma.lead.findFirstOrThrow({ where: { orgId: ORG, phone: '5532977770006' }, select: { id: true } });
    const triada = await prisma.leadEvent.findFirstOrThrow({ where: { leadId: lead.id, type: 'whats.triada' } });
    expect(triada.payload).toMatchObject({ classe: 'lead_novo', origem: 'pessoa' });
    expect(await prisma.toolCall.count({ where: { orgId: ORG, capabilityId: 'comercial.lead.criar', actorId: pessoaId, status: 'executado' } })).toBe(1);
  });

  it('CO-16: instância de outra empresa no corpo não entra, nem na triagem', async () => {
    const outro = { ...evolucao('5532977770007', { conversation: 'Oi, quanto custa a imersão?' }), instance: 'inst-de-outra-empresa' };
    expect(await naEmpresa(() => entrada.processar(ORG, outro, '5532977770007'))).toBe('ignorado: outra instância');
    expect(await prisma.lead.count({ where: { orgId: ORG, phone: '5532977770007' } })).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Produção 22, M4 · a triagem pronta para ser ligada
  // -------------------------------------------------------------------------

  const espiarModelo = () => {
    const llm = (triagem as unknown as { llm: { complete: (...a: unknown[]) => Promise<unknown> } }).llm;
    return vi.spyOn(llm, 'complete');
  };

  it('Produção 22: a segunda entrega da mesma mensagem não chama o modelo nem abre pendência nova', async () => {
    const modelo = espiarModelo();
    try {
      const corpo = evolucao('5532977770011', { conversation: 'Tudo bem por aí?' }, 'conversation', randomUUID());
      expect(await naEmpresa(() => entrada.processar(ORG, corpo, '5532977770011'))).toBe('triagem: pendência');
      expect(modelo).toHaveBeenCalledTimes(1);
      const antes = await prisma.pendencia.count({ where: { orgId: ORG } });
      expect(await naEmpresa(() => entrada.processar(ORG, corpo, '5532977770011'))).toBe('triagem: repetida (ignorada)');
      expect(modelo).toHaveBeenCalledTimes(1);
      expect(await prisma.pendencia.count({ where: { orgId: ORG } })).toBe(antes);
    } finally {
      modelo.mockRestore();
    }
  });

  it('Produção 22: a dedupe também vale depois de a API reiniciar (o banco lembra a pendência da mensagem)', async () => {
    const idDaMensagem = randomUUID();
    const corpo = evolucao('5532977770012', { conversation: 'Tudo bem por aí?' }, 'conversation', idDaMensagem);
    expect(await naEmpresa(() => entrada.processar(ORG, corpo, '5532977770012'))).toBe('triagem: pendência');
    // uma triagem nova (memória vazia), como depois de um arranque
    const interno = triagem as unknown as { fio: never; memoria: never; porta: never; registroDePendencias: never };
    const outra = new TriagemDoWhatsappService(
      prisma as unknown as PrismaService,
      interno.fio,
      interno.memoria,
      interno.porta,
      pendencias,
      interno.registroDePendencias,
      new StubProvider(PASTA_DO_STUB),
    );
    const modelo = vi.spyOn((outra as unknown as { llm: { complete: () => Promise<unknown> } }).llm, 'complete');
    const r = await naEmpresa(() =>
      outra.triar(ORG, { telefone: '5532977770012', leadId: null, texto: 'Tudo bem por aí?', documento: null, mensagemId: idDaMensagem, nome: null }),
    );
    expect(r).toBe('triagem: repetida (ignorada)');
    expect(modelo).not.toHaveBeenCalled();
  });

  it('Produção 22: da 6ª mensagem do mesmo número na hora em diante, pendência SEM modelo e com a razão (uma por hora)', async () => {
    const modelo = espiarModelo();
    try {
      const numero = '5532977770013';
      for (let i = 1; i <= 5; i++) {
        expect(await naEmpresa(() => entrada.processar(ORG, evolucao(numero, { conversation: `Promoção imperdível número ${i}` }), numero))).toBe('triagem: outro (ignorado)');
      }
      expect(modelo).toHaveBeenCalledTimes(5);
      expect(await naEmpresa(() => entrada.processar(ORG, evolucao(numero, { conversation: 'Promoção imperdível número 6' }), numero))).toBe('triagem: pendência');
      expect(await naEmpresa(() => entrada.processar(ORG, evolucao(numero, { conversation: 'Promoção imperdível número 7' }), numero))).toBe('triagem: pendência');
      expect(modelo).toHaveBeenCalledTimes(5);
      const doTeto = await prisma.pendencia.findMany({ where: { orgId: ORG, chave: { startsWith: `whatsapp:teto:${numero}:` } } });
      expect(doTeto).toHaveLength(1);
      expect(doTeto[0].contexto).toContain(RAZAO_DO_TETO_DA_TRIAGEM);
      expect(doTeto[0].textoExpiraEm).not.toBeNull();
      // outro número não é afetado
      expect(await naEmpresa(() => entrada.processar(ORG, evolucao('5532977770014', { conversation: 'Promoção imperdível' }), '5532977770014'))).toBe('triagem: outro (ignorado)');
      expect(modelo).toHaveBeenCalledTimes(6);
    } finally {
      modelo.mockRestore();
    }
  });

  it('Produção 22: o texto da pendência vence em 14 dias; o expurgo limpa o vencido e não o novo, e a pendência fica', async () => {
    const DIA_MS = 24 * 60 * 60 * 1000;
    const idVelha = randomUUID();
    const corpo = evolucao('5532977770015', { conversation: 'Tudo bem por aí? texto que vai vencer' }, 'conversation', idVelha);
    expect(await naEmpresa(() => entrada.processar(ORG, corpo, '5532977770015'))).toBe('triagem: pendência');
    const velha = await prisma.pendencia.findUniqueOrThrow({ where: { orgId_chave: { orgId: ORG, chave: `whatsapp:${idVelha}` } } });
    expect(velha.textoExpiraEm!.getTime()).toBe(Date.now() + 14 * DIA_MS);
    expect((velha.dados as { texto: string }).texto).toContain('texto que vai vencer');
    expect(velha.contexto).toContain('texto que vai vencer');
    try {
      // uma nova, aberta 10 dias depois
      vi.setSystemTime(new Date(Date.now() + 10 * DIA_MS));
      const idNova = randomUUID();
      const nova = evolucao('5532977770016', { conversation: 'Tudo bem por aí? texto novo' }, 'conversation', idNova);
      expect(await naEmpresa(() => entrada.processar(ORG, nova, '5532977770016'))).toBe('triagem: pendência');
      // 15 dias depois da primeira: só ela venceu
      vi.setSystemTime(new Date(Date.now() + 5 * DIA_MS));
      const simulado = await expurgarTextoVencido(prisma, new Date(), { simular: true });
      expect(simulado.pendencias).toBeGreaterThanOrEqual(1);
      expect((await prisma.pendencia.findUniqueOrThrow({ where: { id: velha.id } })).textoExpiraEm).not.toBeNull();
      const r = await expurgarTextoVencido(prisma, new Date());
      expect(r.pendencias).toBeGreaterThanOrEqual(1);
      const limpa = await prisma.pendencia.findUniqueOrThrow({ where: { id: velha.id } });
      expect(limpa.textoExpiraEm).toBeNull();
      expect((limpa.dados as Record<string, unknown>).texto).toBeUndefined();
      expect((limpa.dados as Record<string, unknown>).telefone).toBe('5532977770015');
      expect(JSON.stringify(limpa)).not.toContain('texto que vai vencer');
      expect([limpa.estado, limpa.titulo]).toEqual([velha.estado, velha.titulo]);
      const intacta = await prisma.pendencia.findUniqueOrThrow({ where: { orgId_chave: { orgId: ORG, chave: `whatsapp:${idNova}` } } });
      expect((intacta.dados as { texto: string }).texto).toContain('texto novo');
      expect(intacta.textoExpiraEm).not.toBeNull();
      // rodar de novo não apaga nada a mais
      expect((await expurgarTextoVencido(prisma, new Date())).pendencias).toBe(0);
    } finally {
      vi.setSystemTime(new Date('2026-10-21T14:00:00-03:00'));
    }
  });
});
