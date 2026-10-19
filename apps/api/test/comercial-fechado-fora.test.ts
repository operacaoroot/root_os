import { Readable } from 'node:stream';

import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A_DECIDIR, ClienteFechadoForaSchema, PRODUTOS_COM_PRECO, type ClienteFechadoForaInput } from '@mktos/shared';

import { ApprovalsService } from '../src/approvals/approvals.service';
import { AuditService } from '../src/audit/audit.service';
import { ReauthService } from '../src/auth/reauth.service';
import { comContexto } from '../src/common/contexto-execucao';
import { ConfigComercialService } from '../src/comercial/config.service';
import { ContratoVivoService } from '../src/comercial/contrato-vivo.service';
import { DecisoesRegistry, DecisoesService } from '../src/comercial/decisoes.service';
import { DinheiroService } from '../src/comercial/dinheiro.service';
import { aceiteDaDeclaracao, camposDaDeclaracao, ehPdf, hashDaDeclaracao, parcelasDoContratoFora, payloadDaDeclaracao, somarMeses } from '../src/comercial/fechado-fora';
import { FechadoForaService, type ArmazemDoAnexo } from '../src/comercial/fechado-fora.service';
import { CAP_FECHAMENTO, FechamentoService } from '../src/comercial/fechamento.service';
import { FichaService } from '../src/comercial/ficha.service';
import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { ReacoesDaEspinha } from '../src/comercial/reacoes-da-espinha';
import { RelogioDaEspinha } from '../src/comercial/relogio-da-espinha';
import type { PortaDeAssinatura } from '../src/comercial/portas/assinatura.port';
import type { NovaCobranca, PortaDeCobranca } from '../src/comercial/portas/cobranca.port';
import { RelogioComercialRegistry } from '../src/comercial/relogio.registry';
import { SalaService } from '../src/comercial/sala.service';
import { WhatsappComercialService } from '../src/comercial/whatsapp.service';
import { AcoesService } from '../src/gateway/acoes.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { EventLogService } from '../src/gateway/event-log.service';
import { InterruptoresRegistry } from '../src/gateway/interruptores.registry';
import { PortaDoOperador } from '../src/gateway/porta-do-operador.service';
import { ToolGateway } from '../src/gateway/tool-gateway.service';
import { ConectoresService } from '../src/integrations/conectores.service';
import { LeadsService } from '../src/leads/leads.service';
import { TrilhoService } from '../src/onboarding/trilho/trilho.service';
import { PolicyService } from '../src/policy/policy.service';
import { ExecutoresDeRotinaRegistry } from '../src/routines/executores.registry';
import { SinaisService } from '../src/policy/sinais.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * REGISTRAR CLIENTE JÁ FECHADO (rodada do trabalho T1b, 19/10/2026).
 *
 *  1. a parte pura: o hash cobre os dados e o PDF, o aceite é relido com o hash
 *     recalculado, as parcelas do contrato saem do 1º vencimento declarado;
 *  2. contra o Postgres, pela porta e pela política do banco: registrar cria o
 *     lead (entrada idempotente), o anexo e o aceite declarado, e propõe o
 *     fechamento (R4, retido); repetir não duplica nada; quem registrou não
 *     assina; outra titular assina e as seis escritas rodam sem cobrança nova
 *     e sem ZapSign; o card da implantação nasce com o cliente (Partner); o
 *     contrato aparece em Contratos vivos; rodar de novo não duplica; marcando a
 *     cobrança, ela nasce como a do funil.
 */

const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n');
const SHA_FALSO = 'a'.repeat(64);

function entrada(extra: Partial<ClienteFechadoForaInput> = {}): ClienteFechadoForaInput {
  return ClienteFechadoForaSchema.parse({
    razaoSocial: 'Padaria Trigo Bom Ltda',
    cnpj: '12.345.678/0001-90',
    quemAssina: 'Joana Trigo',
    email: 'Joana@TrigoBom.test',
    telefone: '(32) 99999-0001',
    produto: 'operacao',
    valorCentavos: 1_199_700,
    parcelas: 3,
    forma: 'boleto',
    assinadoEm: '2026-09-01',
    primeiroVencimento: '2026-09-10',
    motivoSemCobranca: 'o cliente já paga por boleto do banco',
    ...extra,
  });
}

describe('cliente fechado fora: a parte pura', () => {
  it('o formulário: sem cobrança nova exige o motivo; o padrão é NÃO criar cobrança', () => {
    const r = ClienteFechadoForaSchema.safeParse({ ...entrada(), motivoSemCobranca: undefined });
    expect(r.success).toBe(false);
    expect(entrada().criarCobranca).toBe(false);
    expect(ClienteFechadoForaSchema.safeParse({ ...entrada(), criarCobranca: true, motivoSemCobranca: undefined }).success).toBe(true);
    expect(ClienteFechadoForaSchema.safeParse({ ...entrada(), produto: 'kit' }).success).toBe(false); // sem preço na tabela: [a decidir]
    expect(ClienteFechadoForaSchema.safeParse({ ...entrada(), cnpj: '123' }).success).toBe(false);
    expect(ClienteFechadoForaSchema.safeParse({ ...entrada(), primeiroVencimento: '2026-08-01' }).success).toBe(false);
    expect(PRODUTOS_COM_PRECO).toEqual(['imersao', 'operacao']);
  });

  it('o hash cobre os dados e o PDF; o aceite relido recalcula o hash e marca a origem', () => {
    const c = camposDaDeclaracao(entrada(), SHA_FALSO);
    expect(c.cnpj).toBe('12345678000190');
    expect(c.email).toBe('joana@trigobom.test');
    expect(c.endereco).toBe(A_DECIDIR);
    const h = hashDaDeclaracao(c);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDaDeclaracao(camposDaDeclaracao(entrada(), 'b'.repeat(64)))).not.toBe(h);
    expect(hashDaDeclaracao(camposDaDeclaracao(entrada({ valorCentavos: 1_199_701 }), SHA_FALSO))).not.toBe(h);
    const payload = payloadDaDeclaracao(c, 1, { id: 'u1', nome: 'Rodrigo' });
    const a = aceiteDaDeclaracao(payload, new Date());
    expect(a?.hash).toBe(h);
    expect(a?.fora).toMatchObject({ criarCobranca: false, motivoSemCobranca: 'o cliente já paga por boleto do banco', porId: 'u1', arquivoSha256: SHA_FALSO });
    // O payload que mente sobre o próprio hash não engana: o hash é recalculado dos campos.
    expect(aceiteDaDeclaracao({ ...payload, valorCentavos: 1, hash: h }, new Date())?.hash).not.toBe(h);
    expect(aceiteDaDeclaracao({ ...payload, arquivoSha256: 'x' }, new Date())).toBeNull();
  });

  it('as parcelas do contrato saem do 1º vencimento declarado, a última absorve a diferença', () => {
    expect(somarMeses('2026-01-31', 1)).toBe('2026-02-28');
    expect(somarMeses('2026-11-10', 2)).toBe('2027-01-10');
    const p = parcelasDoContratoFora(1_000_000, 3, '2026-09-10', '2026-10-19');
    expect(p).toEqual({ parcelaCentavos: 333_333, ultimaParcelaCentavos: 333_334, vencimentos: ['2026-09-10', '2026-10-10', '2026-11-10'], proximo: '2026-11-10' });
    expect(parcelasDoContratoFora(300, 3, '2026-01-10', '2027-01-01').proximo).toBe('2026-03-10');
    expect(ehPdf(PDF)).toBe(true);
    expect(ehPdf(Buffer.from('<html>'))).toBe(false);
  });
});

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (lead, fechamento, aprovação, card e rastro do comercial)');
process.env.ENCRYPTION_KEY ??= 'chave-de-teste-da-sala-0123456789abcdef';
process.env.GATEWAY_MODO = 'impor';

const MARCA = `ff${Date.now().toString(36).slice(-6)}`;
const ORG = `org-fechado-fora-${MARCA}`;
const SENHA = 'senha-das-titulares-t1b';
const CNPJ = `2${Date.now().toString().slice(-13)}`;
const CNPJ2 = `3${Date.now().toString().slice(-13)}`;

describe.skipIf(!URL)('registrar cliente já fechado, pela porta e contra o Postgres', { timeout: 60_000 }, () => {
  let prisma: PrismaClient;
  let approvals: ApprovalsService;
  let acoes: AcoesService;
  let fechamento: FechamentoService;
  let fora: FechadoForaService;
  let contratoVivo: ContratoVivoService;
  let quemRegistraId = '';
  let outraTitularId = '';
  let leadId = '';
  const guardados = new Map<string, Buffer>();
  const cobrancas: NovaCobranca[] = [];
  let assinaturas = 0;
  const naEmpresa = <T>(fn: () => Promise<T>): Promise<T> => comContexto({ orgId: ORG, correlationId: `t1b-${MARCA}`, origem: 'http' }, fn);
  const quem = () => ({ id: quemRegistraId, nome: 'Rodrigo da Root', papeis: ['admin_master'], permissions: ['leads.editar', 'leads.ver'] });
  const arquivo = (buffer = PDF) => ({ buffer, originalname: 'Contrato assinado – Trigo Bom.pdf', mimetype: 'application/pdf', size: buffer.length });

  async function assina(approvalId: string, por: string) {
    await naEmpresa(() => approvals.confirm(ORG, approvalId, { id: por, papeis: ['admin_master'], reauth: { senha: SENHA } }, 'conferi o contrato anexado e os dados'));
    return naEmpresa(() => acoes.executarAprovada(ORG, approvalId, por)) as Promise<{ status: string }>;
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    const p = prisma as unknown as PrismaService;
    await prisma.org.create({ data: { id: ORG, name: `Fechado fora ${MARCA}`, slug: `fechado-fora-${MARCA}` } });
    const admin = await prisma.role.create({ data: { orgId: ORG, key: 'admin_master', name: 'Admin' }, select: { id: true } });
    const hash = await bcrypt.hash(SENHA, 4);
    quemRegistraId = (await prisma.user.create({ data: { orgId: ORG, email: `rodrigo-${MARCA}@t1b.teste`, name: 'Rodrigo da Root', passwordHash: hash, roles: { connect: { id: admin.id } } }, select: { id: true } })).id;
    outraTitularId = (await prisma.user.create({ data: { orgId: ORG, email: `lidiane-${MARCA}@t1b.teste`, name: 'Outra titular', passwordHash: hash, roles: { connect: { id: admin.id } } }, select: { id: true } })).id;

    const audit = new AuditService(p);
    const policy = new PolicyService(p);
    await policy.onModuleInit();
    const reauth = new ReauthService(p, new JwtService({ secret: `segredo-${MARCA}` }), audit);
    approvals = new ApprovalsService(p, audit, reauth);
    const eventos = new EventLogService(p);
    const efeitos = new EfeitosRegistry();
    const interruptores = new InterruptoresRegistry();
    new ConectoresService(p, audit, eventos, interruptores).onModuleInit();
    const gateway = new ToolGateway(p, policy, new SinaisService(p, policy), approvals, eventos, undefined, interruptores, efeitos);
    acoes = new AcoesService(p, gateway, eventos, interruptores, policy);
    const porta = new PortaDoOperador(gateway, efeitos);

    const reacoes = new ReacoesRegistry();
    const fio = new FioService(p, reacoes);
    const relogio = new RelogioComercialRegistry();
    const sala = new SalaService(p, fio, reacoes);
    sala.onModuleInit();
    const whats = new WhatsappComercialService(p, fio, reacoes, relogio, sala, efeitos, porta);
    whats.onModuleInit();
    const config = new ConfigComercialService(p);
    const registroDeDecisoes = new DecisoesRegistry();
    const decisoes = new DecisoesService(p, fio, config, registroDeDecisoes);
    // A espinha projeta a ficha dos fatos (como em produção): a reação a `cliente.ativo` vem antes da nossa.
    const fichas = new FichaService(p, fio, config);
    new ReacoesDaEspinha(p, fio, reacoes, fichas, decisoes, registroDeDecisoes, new RelogioDaEspinha(p, new ExecutoresDeRotinaRegistry(), relogio, decisoes, fio, config, fichas)).inscrever();
    // Os dublês das portas: a cobrança registra o que lhe pedem; a assinatura conta (e não deve ser chamada).
    const cobranca: PortaDeCobranca = {
      provedor: 'asaas',
      configurada: () => true,
      criarCliente: async () => ({ externoId: `cus-${MARCA}`, reaproveitado: false }),
      criarCobranca: async (n) => {
        cobrancas.push(n);
        return {
          reaproveitada: false,
          parcelas: Array.from({ length: n.parcelas }, (_, i) => ({ externoId: `pay-${MARCA}-${n.referenciaExterna}-${i + 1}`, parcela: i + 1, parcelas: n.parcelas, valorCentavos: i === n.parcelas - 1 && n.ultimaParcelaCentavos ? n.ultimaParcelaCentavos : n.parcelaCentavos, vence: n.primeiroVencimento, estado: 'pendente' as const, pagaEm: null, linkPagamento: null })),
        };
      },
      consultarCobranca: async () => null,
      pixDaCobranca: async () => null,
      webhookAutentico: () => false,
      interpretarWebhook: () => null,
    };
    const assinatura = new Proxy({ provedor: 'zapsign' } as PortaDeAssinatura, {
      get: (alvo, chave) => (chave === 'provedor' ? alvo.provedor : () => { assinaturas++; throw new Error('a ZapSign não deveria ser chamada'); }),
    });
    const dinheiro = new DinheiroService(p, fio, reacoes, efeitos, porta, cobranca, assinatura, whats, reauth, audit);
    dinheiro.onModuleInit();
    const trilhos = new TrilhoService(p, undefined as never, eventos, undefined as never);
    fechamento = new FechamentoService(p, fio, reacoes, efeitos, porta, dinheiro, config, decisoes, registroDeDecisoes, trilhos, whats, relogio);
    fechamento.onModuleInit();
    contratoVivo = new ContratoVivoService(p, fio, relogio, decisoes);
    contratoVivo.onModuleInit();
    const leads = new LeadsService(p, audit, {} as never);
    const armazem: ArmazemDoAnexo = {
      put: async (k, corpo) => void guardados.set(k, corpo),
      get: async (k) => ({ stream: Readable.from(guardados.get(k) ?? Buffer.alloc(0)), contentType: 'application/pdf', size: guardados.get(k)?.length ?? 0 }),
    };
    fora = new FechadoForaService(p, fio, reacoes, fichas, fechamento, leads, undefined, armazem);
    fora.onModuleInit();
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

  it('registrar cria o lead pela entrada, o anexo e o aceite declarado, e propõe o fechamento (R4, retido)', async () => {
    const r = await naEmpresa(() => fora.registrar(ORG, quem(), entrada({ cnpj: CNPJ }), arquivo()));
    leadId = r.leadId;
    expect(r).toMatchObject({ leadNovo: true, registroNovo: true, versao: 1, chave: `fech-${leadId}-v1`, fechamento: { estado: 'na_fila' } });
    expect(r.anexo.nome).toBe('Contrato assinado _ Trigo Bom.pdf');
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect([lead.name, lead.email, lead.phone]).toEqual(['Padaria Trigo Bom Ltda', 'joana@trigobom.test', '5532999990001']);
    const tipos = (await prisma.leadEvent.findMany({ where: { leadId }, select: { type: true } })).map((e) => e.type);
    expect(tipos).toEqual(expect.arrayContaining(['entrada', 'dono.atribuido', 'contrato.anexado', 'aceite.declarado']));
    // Nunca como se o cliente tivesse aceitado na sala.
    expect(tipos).not.toContain('proposta.aceita');
    expect(tipos).not.toContain('aceite.dados');
    const decl = await prisma.leadEvent.findFirstOrThrow({ where: { leadId, type: 'aceite.declarado' } });
    expect(decl.payload).toMatchObject({ procedencia: 'registrado à mão: contrato assinado fora do sistema', porId: quemRegistraId, criarCobranca: false, endereco: '[a decidir]' });
    const anexo = await prisma.leadEvent.findFirstOrThrow({ where: { leadId, type: 'contrato.anexado' } });
    expect(guardados.get(String((anexo.payload as { chave: string }).chave))?.equals(PDF)).toBe(true);
    const ficha = await prisma.comercialFicha.findUniqueOrThrow({ where: { leadId } });
    expect(ficha.donoId).toBe(quemRegistraId);

    const ap = await prisma.approval.findFirstOrThrow({ where: { orgId: ORG, capabilityId: CAP_FECHAMENTO, resourceId: r.chave } });
    expect([ap.status, ap.nivelExigido, ap.exigeReauth, ap.alcadaMinima, ap.propostoPorId]).toEqual(['pendente', 'R4', true, 'titular', quemRegistraId]);
    expect(r.fechamento.approvalId).toBe(ap.id);
    // Nada foi escrito antes da assinatura.
    expect(await prisma.partner.count({ where: { orgId: ORG } })).toBe(0);
    expect(await prisma.workTask.count({ where: { orgId: ORG } })).toBe(0);
  });

  it('repetir o mesmo registro não duplica nada; o PDF falso e a conta de máquina são recusados', async () => {
    const r = await naEmpresa(() => fora.registrar(ORG, quem(), entrada({ cnpj: CNPJ }), arquivo()));
    expect(r).toMatchObject({ leadId, leadNovo: false, registroNovo: false, versao: 1, fechamento: { estado: 'na_fila' } });
    expect(await prisma.lead.count({ where: { orgId: ORG } })).toBe(1);
    expect(await prisma.leadEvent.count({ where: { leadId, type: { in: ['aceite.declarado', 'contrato.anexado'] } } })).toBe(2);
    expect(await prisma.approval.count({ where: { orgId: ORG, capabilityId: CAP_FECHAMENTO } })).toBe(1);
    await expect(naEmpresa(() => fora.registrar(ORG, quem(), entrada({ cnpj: CNPJ }), { ...arquivo(Buffer.from('<html>não é pdf</html>')) }))).rejects.toMatchObject({ status: 400 });
    await expect(naEmpresa(() => fora.registrar(ORG, quem(), entrada({ cnpj: CNPJ }), undefined))).rejects.toMatchObject({ status: 400 });
    await expect(naEmpresa(() => fora.registrar(ORG, { ...quem(), papeis: ['ia_acao'] }, entrada({ cnpj: CNPJ }), arquivo()))).rejects.toMatchObject({ status: 403 });
    // A máquina não propõe o fechamento de quem fechou fora.
    expect(await naEmpresa(() => fechamento.propor(ORG, leadId, { id: 'comercial', tipo: 'system' as never }))).toMatchObject({ pulado: expect.stringMatching(/só uma pessoa propõe/) });
  });

  it('quem registrou não assina; outra titular assina e as seis escritas rodam sem cobrança nova e sem ZapSign', async () => {
    const ap = await prisma.approval.findFirstOrThrow({ where: { orgId: ORG, capabilityId: CAP_FECHAMENTO } });
    await expect(naEmpresa(() => approvals.confirm(ORG, ap.id, { id: quemRegistraId, papeis: ['admin_master'], reauth: { senha: SENHA } }, 'eu mesmo'))).rejects.toBeTruthy();
    expect((await assina(ap.id, outraTitularId)).status).toBe('executado');

    const tela = await naEmpresa(() => fechamento.doLead(ORG, leadId));
    expect(tela.estado).toBe('concluido');
    expect(tela.escritas.map((e) => [e.escrita, e.estado])).toEqual([
      ['cliente', 'criado'],
      ['contrato', 'criado'],
      ['cobranca', 'pulado'],
      ['kit_e_trilho', 'criado'],
      ['card', 'criado'],
      ['grupo', 'criado'],
    ]);
    expect(tela.escritas.find((e) => e.escrita === 'cobranca')?.detalhe).toContain('o cliente já paga por boleto do banco');
    expect(cobrancas).toHaveLength(0);
    expect(assinaturas).toBe(0);
    expect(await prisma.comercialCobranca.count({ where: { leadId } })).toBe(0);

    const ficha = await prisma.comercialFicha.findUniqueOrThrow({ where: { leadId } });
    expect(ficha.etapa).toBe('fechado');
    const partner = await prisma.partner.findUniqueOrThrow({ where: { id: ficha.partnerId! } });
    expect([partner.razaoSocial, partner.cnpjCpf, partner.isCliente]).toEqual(['Padaria Trigo Bom Ltda', CNPJ, true]);
    // O card da implantação com o cliente ligado.
    const card = await prisma.workTask.findUniqueOrThrow({ where: { id: ficha.cardId! }, include: { list: { include: { folder: true } } } });
    expect([card.list.folder?.name, card.list.name, card.clienteId]).toEqual(['Clientes', 'Onboarding de cliente', partner.id]);
    // O contrato do Financeiro conta do 1º vencimento declarado; o PDF é o documento assinado.
    const contrato = await prisma.contract.findUniqueOrThrow({ where: { id: ficha.contractId! } });
    expect(contrato.dataInicio.toISOString().slice(0, 10)).toBe('2026-09-10');
    expect(contrato.dataFim?.toISOString().slice(0, 10)).toBe('2026-11-10');
    expect(contrato.descricao).toContain('assinado fora do sistema');
    const doc = await prisma.comercialDocumento.findFirstOrThrow({ where: { leadId } });
    expect([doc.provedor, doc.estado]).toEqual(['anexo', 'assinado']);
    const tipos = (await prisma.leadEvent.findMany({ where: { leadId }, select: { type: true } })).map((e) => e.type);
    expect(tipos).toEqual(expect.arrayContaining(['cliente.ativo', 'implantacao.card_criado', 'etapa.mudou']));
    const mudou = await prisma.leadEvent.findFirstOrThrow({ where: { leadId, type: 'etapa.mudou' }, orderBy: { occurredAt: 'desc' } });
    expect((mudou.payload as { motivo: string }).motivo).toMatch(/fechado fora do sistema/);
  });

  it('aparece em Contratos vivos; rodar de novo não duplica; outro registro do cliente ativo é 409', async () => {
    const lista = await naEmpresa(() => contratoVivo.lista(ORG));
    const meu = lista.find((c) => c.leadId === leadId);
    expect(meu).toMatchObject({ cliente: 'Padaria Trigo Bom Ltda', produto: 'operacao', valorCentavos: 1_199_700, parcelas: [], cnpj: CNPJ });
    expect(['ativo', 'em_implantacao']).toContain(meu?.situacao);

    const a = await naEmpresa(() => fechamento.aceiteParaFechar(ORG, leadId));
    await naEmpresa(() => fechamento.executar(ORG, leadId, a!));
    const contagem = async () => ({
      partners: await prisma.partner.count({ where: { orgId: ORG } }),
      contratos: await prisma.contract.count({ where: { orgId: ORG } }),
      cards: await prisma.workTask.count({ where: { orgId: ORG } }),
      trilhos: await prisma.onboardingTrilho.count({ where: { orgId: ORG } }),
      documentos: await prisma.comercialDocumento.count({ where: { leadId } }),
      ativos: await prisma.leadEvent.count({ where: { leadId, type: 'cliente.ativo' } }),
    });
    expect(await contagem()).toEqual({ partners: 1, contratos: 1, cards: 1, trilhos: 1, documentos: 1, ativos: 1 });
    // O mesmo registro de novo devolve onde está, sem propor nada.
    const r = await naEmpresa(() => fora.registrar(ORG, quem(), entrada({ cnpj: CNPJ }), arquivo()));
    expect(r).toMatchObject({ registroNovo: false, fechamento: { estado: 'concluido' } });
    await expect(naEmpresa(() => fora.registrar(ORG, quem(), entrada({ cnpj: CNPJ, valorCentavos: 900_000 }), arquivo()))).rejects.toMatchObject({ status: 409 });
    expect(await contagem()).toEqual({ partners: 1, contratos: 1, cards: 1, trilhos: 1, documentos: 1, ativos: 1 });
    expect(await prisma.approval.count({ where: { orgId: ORG, capabilityId: CAP_FECHAMENTO } })).toBe(1);
  });

  it('marcando a cobrança, ela nasce como a do funil (parcelas no provedor) e o contrato lê as parcelas dela', async () => {
    const r = await naEmpresa(() => fora.registrar(ORG, quem(), entrada({ cnpj: CNPJ2, razaoSocial: 'Mercado Bom Preço Ltda', telefone: '(32) 99999-0002', criarCobranca: true, motivoSemCobranca: undefined }), arquivo()));
    expect(r.fechamento.estado).toBe('na_fila');
    expect((await assina(r.fechamento.approvalId!, outraTitularId)).status).toBe('executado');
    const tela = await naEmpresa(() => fechamento.doLead(ORG, r.leadId));
    expect(tela.escritas.find((e) => e.escrita === 'cobranca')?.estado).toBe('criado');
    expect(cobrancas).toHaveLength(1);
    expect(cobrancas[0]).toMatchObject({ parcelas: 3, parcelaCentavos: 399_900, forma: 'boleto', referenciaExterna: `cob-${r.leadId}-v1` });
    expect(await prisma.comercialCobranca.count({ where: { leadId: r.leadId } })).toBe(3);
    expect(assinaturas).toBe(0);
    const ficha = await prisma.comercialFicha.findUniqueOrThrow({ where: { leadId: r.leadId } });
    expect(ficha.etapa).toBe('fechado');
  });

  it('quem registrou não assina nem quando outra pessoa propõe de novo: o efeito recusa e nada é escrito', async () => {
    const r = await naEmpresa(() => fora.registrar(ORG, quem(), entrada({ cnpj: `4${CNPJ.slice(1)}`, razaoSocial: 'Ótica Vista Ltda', telefone: '(32) 99999-0003' }), arquivo()));
    await naEmpresa(() => approvals.reject(ORG, r.fechamento.approvalId!, { id: outraTitularId, papeis: ['admin_master'] }));
    // A outra titular propõe de novo ("rodar de novo"): a porta deixaria quem registrou assinar, o efeito não.
    const de_novo = await naEmpresa(() => fechamento.propor(ORG, r.leadId, { id: outraTitularId, tipo: 'user' as never }));
    expect(de_novo).toMatchObject({ estado: 'na_fila' });
    const ap = (de_novo as { approvalId: string }).approvalId;
    await naEmpresa(() => approvals.confirm(ORG, ap, { id: quemRegistraId, papeis: ['admin_master'], reauth: { senha: SENHA } }, 'tentando assinar o meu registro'));
    const saida = await naEmpresa(() => acoes.executarAprovada(ORG, ap, quemRegistraId)).catch((e: Error) => ({ status: 'erro', erro: e.message }));
    expect(JSON.stringify(saida)).toMatch(/não assina o próprio registro/);
    expect(await prisma.leadEvent.count({ where: { leadId: r.leadId, type: 'cliente.ativo' } })).toBe(0);
    expect((await prisma.comercialFicha.findUniqueOrThrow({ where: { leadId: r.leadId } })).partnerId).toBeNull();
  });

  it('o PDF anexado é lido de volta para quem confere', async () => {
    const a = await naEmpresa(() => fora.anexo(ORG, leadId));
    const partes: Buffer[] = [];
    for await (const p of a.stream) partes.push(p as Buffer);
    expect(Buffer.concat(partes).equals(PDF)).toBe(true);
    expect(a.nome).toBe('Contrato assinado _ Trigo Bom.pdf');
  });
});
