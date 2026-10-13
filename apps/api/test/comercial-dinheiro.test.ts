import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createServer as criarNet } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ApprovalsService } from '../src/approvals/approvals.service';
import { AuditService } from '../src/audit/audit.service';
import { ReauthService } from '../src/auth/reauth.service';
import { comContexto } from '../src/common/contexto-execucao';
import { ConfigComercialService } from '../src/comercial/config.service';
import { ZapsignService } from '../src/comercial/conectores/zapsign.service';
import { ContratoVivoService } from '../src/comercial/contrato-vivo.service';
import { DecisoesRegistry, DecisoesService } from '../src/comercial/decisoes.service';
import { CAP_COBRANCA, CAP_CONTRATO, DinheiroService } from '../src/comercial/dinheiro.service';
import { hashDoConteudo } from '../src/comercial/eventos';
import { CAP_FECHAMENTO, FechamentoService } from '../src/comercial/fechamento.service';
import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { RelogioComercialRegistry } from '../src/comercial/relogio.registry';
import { SalaService } from '../src/comercial/sala.service';
import { WhatsappComercialService } from '../src/comercial/whatsapp.service';
import { AsaasService } from '../src/finance/asaas.service';
import { AcoesService } from '../src/gateway/acoes.service';
import { ConectoresConfiguradosRegistry } from '../src/gateway/conectores-configurados.registry';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { EventLogService } from '../src/gateway/event-log.service';
import { InterruptoresRegistry } from '../src/gateway/interruptores.registry';
import { PortaDoOperador } from '../src/gateway/porta-do-operador.service';
import { ToolGateway } from '../src/gateway/tool-gateway.service';
import { ConectoresService } from '../src/integrations/conectores.service';
import { TrilhoService } from '../src/onboarding/trilho/trilho.service';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * O DINHEIRO DO COCKPIT CONTRA A RÉGUA E OS DUBLÊS (lane D, 13/10/2026).
 *
 * A política é a do BANCO (`db:seed:politica`), a porta é a de verdade e o
 * Asaas e a ZapSign são os dublês da homologação (`homolog/mocks`), subidos
 * aqui por `child_process` em portas livres, com o webhook apontado para um
 * servidor HTTP deste teste que entrega o corpo ao serviço com o cabeçalho que
 * o dublê mandou. O caminho inteiro:
 *
 *   aceite na sala → cobrança e contrato propostos pela porta (R4, retidos) →
 *   a titular assina com senha e motivo → cliente e cobrança parcelada no
 *   Asaas, documento com dois signatários na ZapSign → "pagar" e "assinar" no
 *   dublê → webhooks gravam os fatos (reentrega não duplica, segredo errado é
 *   recusado) → o fechamento é proposto (R4) → a titular assina → cinco
 *   escritas → rodar de novo não duplica nada → a régua da parcela não repete.
 */

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (lead, cobrança, contrato, fechamento, aprovação e rastro do comercial)');
process.env.ENCRYPTION_KEY ??= 'chave-de-teste-da-sala-0123456789abcdef';
process.env.GATEWAY_MODO = 'impor';

const MARCA = `dn${Date.now().toString(36).slice(-6)}`;
const ORG = `org-dinheiro-${MARCA}`;
const SENHA = 'senha-da-titular-lane-d';
const SEGREDO_ASAAS = `asaas-${MARCA}-segredo-de-teste`;
const SEGREDO_ZAP = `zap-${MARCA}-segredo-de-teste`;
const RAIZ = path.resolve(__dirname, '../../..');
const CNPJ = `1${Date.now().toString().slice(-13)}`;

async function portaLivre(): Promise<number> {
  return new Promise((ok, falha) => {
    const s = criarNet();
    s.once('error', falha);
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => ok(p));
    });
  });
}

async function esperar(url: string, ms = 10_000): Promise<void> {
  const ate = Date.now() + ms;
  while (Date.now() < ate) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`dublê não respondeu em ${url}`);
}

describe('do aceite ao cliente ativo, pela porta e pelos dublês', () => {
  let prisma: PrismaClient;
  let approvals: ApprovalsService;
  let acoes: AcoesService;
  let sala: SalaService;
  let whats: WhatsappComercialService;
  let dinheiro: DinheiroService;
  let fechamento: FechamentoService;
  let contratoVivo: ContratoVivoService;
  let decisoesSvc: DecisoesService;
  let fio: FioService;
  let titularId = '';
  let gestorId = '';
  let outroTitularId = '';
  let estado = '';
  let portaAsaas = 0;
  let portaZap = 0;
  const filhos: ChildProcess[] = [];
  let receptor: Server;
  const recebidos: { qual: string; status: number }[] = [];
  const naEmpresa = <T>(fn: () => Promise<T>): Promise<T> => comContexto({ orgId: ORG, correlationId: `dinheiro-${MARCA}`, origem: 'http' }, fn);

  let leadId = '';
  let token = '';

  /** A titular assina (senha + motivo, R4) e a fila executa: o "um toque" de /atendimento. */
  async function titularAssina(approvalId: string): Promise<{ status: string }> {
    await naEmpresa(() => approvals.confirm(ORG, approvalId, { id: titularId, papeis: ['admin_master'], reauth: { senha: SENHA } }, 'conferi o aceite, o valor e as parcelas'));
    return naEmpresa(() => acoes.executarAprovada(ORG, approvalId, titularId)) as Promise<{ status: string }>;
  }

  async function aprovacao(capabilityId: string) {
    return prisma.approval.findFirstOrThrow({ where: { orgId: ORG, capabilityId }, orderBy: { criadoEm: 'desc' } });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    estado = mkdtempSync(path.join(tmpdir(), 'lane-d-'));

    // O receptor dos webhooks: o dublê manda para cá, e daqui o corpo vai ao serviço com o cabeçalho que veio.
    const portaReceptor = await portaLivre();
    receptor = createServer(async (req, res) => {
      const partes: Buffer[] = [];
      for await (const p of req) partes.push(p as Buffer);
      const corpo = JSON.parse(Buffer.concat(partes).toString('utf8') || '{}');
      try {
        if (req.url === '/asaas') await dinheiro.webhookDoAsaas(String(req.headers['asaas-access-token'] ?? ''), corpo);
        else await dinheiro.webhookDaZapsign(String(req.headers['x-zapsign-token'] ?? ''), corpo);
        recebidos.push({ qual: String(req.url), status: 200 });
        res.writeHead(200).end('{}');
      } catch (e) {
        const status = (e as { status?: number }).status ?? 500;
        recebidos.push({ qual: String(req.url), status });
        res.writeHead(status).end(String((e as Error).message));
      }
    });
    await new Promise<void>((ok) => receptor.listen(portaReceptor, '127.0.0.1', ok));

    portaAsaas = await portaLivre();
    portaZap = await portaLivre();
    const subir = (arquivo: string, porta: number, webhook: string, segredo: string) => {
      const f = spawn(process.execPath, [path.join(RAIZ, arquivo)], {
        env: { ...process.env, PORT: String(porta), WEBHOOK_URL: webhook, WEBHOOK_TOKEN: segredo, PUBLIC_URL: `http://127.0.0.1:${porta}`, ESTADO: path.join(estado, `${porta}.json`) },
        stdio: 'ignore',
      });
      filhos.push(f);
    };
    subir('homolog/mocks/asaas/server.mjs', portaAsaas, `http://127.0.0.1:${portaReceptor}/asaas`, SEGREDO_ASAAS);
    subir('homolog/mocks/zapsign/server.mjs', portaZap, `http://127.0.0.1:${portaReceptor}/zapsign`, SEGREDO_ZAP);
    await esperar(`http://127.0.0.1:${portaAsaas}/health`);
    await esperar(`http://127.0.0.1:${portaZap}/health`);

    // As credenciais dos conectores vêm do ambiente, lidas na construção.
    process.env.ASAAS_BASE_URL = `http://127.0.0.1:${portaAsaas}/v3`;
    process.env.ASAAS_API_KEY = 'chave-de-homologacao';
    process.env.ASAAS_WEBHOOK_TOKEN = SEGREDO_ASAAS;
    process.env.ZAPSIGN_BASE_URL = `http://127.0.0.1:${portaZap}/api/v1`;
    process.env.ZAPSIGN_API_TOKEN = 'token-de-homologacao';
    process.env.ZAPSIGN_WEBHOOK_TOKEN = SEGREDO_ZAP;

    await prisma.org.create({ data: { id: ORG, name: `Dinheiro ${MARCA}`, slug: `dinheiro-${MARCA}` } });
    const admin = await prisma.role.create({ data: { orgId: ORG, key: 'admin_master', name: 'Admin' }, select: { id: true } });
    titularId = (
      await prisma.user.create({
        data: { orgId: ORG, email: `titular-${MARCA}@dinheiro.teste`, name: 'Titular da Root', passwordHash: await bcrypt.hash(SENHA, 4), roles: { connect: { id: admin.id } } },
        select: { id: true },
      })
    ).id;
    // D-1: quem tem leads.editar sem ser titular, e um segundo titular que não é o signatário cadastrado.
    const gestor = await prisma.role.create({ data: { orgId: ORG, key: 'gestor_marketing', name: 'Gestor' }, select: { id: true } });
    gestorId = (
      await prisma.user.create({
        data: { orgId: ORG, email: `gestor-${MARCA}@dinheiro.teste`, name: 'Mesa', passwordHash: await bcrypt.hash(SENHA, 4), roles: { connect: { id: gestor.id } } },
        select: { id: true },
      })
    ).id;
    outroTitularId = (
      await prisma.user.create({
        data: { orgId: ORG, email: `outro-${MARCA}@dinheiro.teste`, name: 'Outro titular', passwordHash: await bcrypt.hash(SENHA, 4), roles: { connect: { id: admin.id } }, createdAt: new Date(Date.now() + 60_000) },
        select: { id: true },
      })
    ).id;

    const p = prisma as unknown as PrismaService;
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
    fio = new FioService(p, reacoes);
    const relogio = new RelogioComercialRegistry();
    sala = new SalaService(p, fio, reacoes);
    sala.onModuleInit();
    whats = new WhatsappComercialService(p, fio, reacoes, relogio, sala, efeitos, porta);
    whats.onModuleInit();
    const config = new ConfigComercialService(p);
    const registroDeDecisoes = new DecisoesRegistry();
    const decisoes = new DecisoesService(p, fio, config, registroDeDecisoes);
    decisoesSvc = decisoes;
    const asaas = new AsaasService(new ConectoresConfiguradosRegistry());
    const zapsign = new ZapsignService();
    dinheiro = new DinheiroService(p, fio, reacoes, efeitos, porta, asaas, zapsign, whats, reauth, audit);
    dinheiro.onModuleInit();
    const trilhos = new TrilhoService(p, undefined as never, eventos, undefined as never);
    fechamento = new FechamentoService(p, fio, reacoes, efeitos, porta, dinheiro, config, decisoes, registroDeDecisoes, trilhos, whats, relogio);
    fechamento.onModuleInit();
    contratoVivo = new ContratoVivoService(p, fio, relogio, decisoes);
    contratoVivo.onModuleInit();
  }, 60_000);

  afterAll(async () => {
    vi.useRealTimers();
    for (const f of filhos) f.kill();
    await new Promise<void>((ok) => receptor?.close(() => ok()));
    try {
      rmSync(estado, { recursive: true, force: true });
    } catch {
      /* o Windows pode segurar o arquivo do dublê por um instante */
    }
    const ids = (await prisma.lead.findMany({ where: { orgId: ORG }, select: { id: true } })).map((l) => l.id);
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
      prisma.$executeRawUnsafe('DELETE FROM "EventLog" WHERE "orgId" = $1', ORG),
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
    ]);
    const trilhos = (await prisma.onboardingTrilho.findMany({ where: { orgId: ORG }, select: { id: true } })).map((t) => t.id);
    await prisma.onboardingMarco.deleteMany({ where: { trilhoId: { in: trilhos } } });
    await prisma.onboardingTrilho.deleteMany({ where: { orgId: ORG } });
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
    await prisma.comercialConfig.deleteMany({ where: { orgId: ORG } });
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

  it('o aceite na sala propõe cobrança e contrato pela porta: R4, retidos, nada sai no dublê', async () => {
    const tel = `+55329${Date.now().toString().slice(-8)}`;
    const r = await naEmpresa(() => whats.receberEntrada(ORG, { telefone: tel, texto: 'Oi, quero a Operação ROOT', nome: 'Marina Duarte', mensagemId: `${MARCA}-1` }));
    leadId = r.leadId;
    // A ficha do lead (a espinha a cria pela reação; aqui, direto) é onde o fechamento guarda o vínculo.
    await prisma.comercialFicha.create({ data: { leadId, etapa: 'proposta', perfil: 'P2' } });
    // B-1: o texto da M1 leva só o marcador; o token sai do link que o OS reescreve da cifra.
    const m1 = await prisma.comercialMensagem.findFirstOrThrow({ where: { leadId, template: 'M1' } });
    expect(m1.texto).not.toMatch(/\/s\/[A-Za-z0-9_-]{20,}/);
    token = /\/s\/([A-Za-z0-9_-]{40,48})/.exec((await naEmpresa(() => sala.linkDoLead(ORG, leadId))) ?? '')![1];

    await naEmpresa(() =>
      fio.registrar(ORG, leadId, 'proposta.publicada', 'v1', {
        versao: 1,
        produto: 'operacao',
        valorCentavos: 1_199_700,
        parcelas: 3,
        parcelaCentavos: 399_900,
        formas: ['pix', 'boleto', 'cartao'],
        validaAte: '2026-10-24T23:59:00-03:00',
        dentroDaTabela: true,
        laudo: { ok: true, apontamentos: [] },
        hash: hashDoConteudo({ lead: leadId, v: 1 }),
      }),
    );
    await sala.aceiteDados(token, { cnpj: CNPJ, razaoSocial: 'Construtora Alicerce Ltda', endereco: 'Rua A, 1, Juiz de Fora', quemAssina: 'Marina Duarte', email: 'marina@alicerce.test' });
    await sala.aceitePagamento(token, { produto: 'operacao', forma: 'pix', versao: 1 });
    // B-6/D-2: depois do aceite os dados do contratante congelam. Os mesmos dados de novo não mudam nada;
    // outro CNPJ é 409 e não entra no fio.
    await sala.aceiteDados(token, { cnpj: CNPJ, razaoSocial: 'Construtora Alicerce Ltda', endereco: 'Rua A, 1, Juiz de Fora', quemAssina: 'Marina Duarte', email: 'marina@alicerce.test' });
    await expect(
      sala.aceiteDados(token, { cnpj: '99888777000166', razaoSocial: 'Outra Empresa Ltda', endereco: 'Rua A, 1, Juiz de Fora', quemAssina: 'Marina Duarte', email: 'marina@alicerce.test' }),
    ).rejects.toMatchObject({ status: 409 });
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'aceite.dados' } })).toBe(1);

    const cob = await aprovacao(CAP_COBRANCA);
    const ctr = await aprovacao(CAP_CONTRATO);
    for (const a of [cob, ctr]) {
      expect(a.status).toBe('pendente');
      expect(a.nivelExigido).toBe('R4');
      expect(a.exigeReauth).toBe(true);
      expect(a.alcadaMinima).toBe('titular');
      expect(a.propostoPorId).toBe('comercial');
    }
    // D-2: o pedido da cobrança leva o devedor (e o hash da aprovação o cobre).
    const pedido = await prisma.toolCall.findFirst({ where: { orgId: ORG, capabilityId: CAP_COBRANCA }, orderBy: { criadoEm: 'desc' } });
    expect(pedido?.args).toMatchObject({ devedorDocumento: CNPJ, devedorRazaoSocial: 'Construtora Alicerce Ltda', devedorEmail: 'marina@alicerce.test' });
    expect(await prisma.comercialCobranca.count({ where: { leadId } })).toBe(0);
    expect(await prisma.comercialDocumento.count({ where: { leadId } })).toBe(0);
    const noDuble = (await (await fetch(`http://127.0.0.1:${portaAsaas}/v3/payments`, { headers: { access_token: 'x' } })).json()) as { totalCount: number };
    expect(noDuble.totalCount).toBe(0);

    // Propor de novo não duplica a fila.
    const de_novo = await naEmpresa(() => dinheiro.proporAceite(ORG, leadId));
    expect(de_novo).toMatchObject({ cobranca: 'na_fila', contrato: 'na_fila' });
    expect(await prisma.approval.count({ where: { orgId: ORG, capabilityId: { in: [CAP_COBRANCA, CAP_CONTRATO] } } })).toBe(2);
  });

  it('a titular assina (senha e motivo): cliente e cobrança parcelada no Asaas, documento com dois signatários na ZapSign', async () => {
    expect((await titularAssina((await aprovacao(CAP_COBRANCA)).id)).status).toBe('executado');
    expect((await titularAssina((await aprovacao(CAP_CONTRATO)).id)).status).toBe('executado');

    const parcelas = await prisma.comercialCobranca.findMany({ where: { leadId }, orderBy: { parcela: 'asc' } });
    expect(parcelas.map((c) => [c.parcela, c.parcelas, c.valorCentavos, c.forma])).toEqual([
      [1, 3, 399_900, 'pix'],
      [2, 3, 399_900, 'pix'],
      [3, 3, 399_900, 'pix'],
    ]);
    expect(parcelas[0].linkPagamento).toContain(`127.0.0.1:${portaAsaas}/fatura/`);
    expect(parcelas[0].pixCopiaECola).toContain('HOMOLOGACAO');
    const ref = `cob-${leadId}-v1`;
    const noDuble = (await (await fetch(`http://127.0.0.1:${portaAsaas}/v3/payments?externalReference=${ref}`, { headers: { access_token: 'x' } })).json()) as { totalCount: number };
    expect(noDuble.totalCount).toBe(3);

    const doc = await prisma.comercialDocumento.findFirstOrThrow({ where: { leadId } });
    expect(doc.hashConteudo).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.linkCliente).toContain(`127.0.0.1:${portaZap}/assinar/`);
    // D-1: o link que assina pela Root só existe cifrado.
    expect(doc.linkRoot).toMatch(/^v1\./);
    expect(doc.linkRoot).not.toContain('/assinar/');
    const tipos = (await prisma.leadEvent.findMany({ where: { leadId }, select: { type: true } })).map((e) => e.type);
    expect(tipos).toEqual(expect.arrayContaining(['cobranca.criada', 'contrato.gerado']));
    // A M7 (link de assinatura) foi preparada e espera a fila do WhatsApp (R3).
    const m7 = await prisma.comercialMensagem.findFirstOrThrow({ where: { leadId, template: 'M7' } });
    expect(m7.texto).toContain(doc.linkCliente!);

    // A sala mostra o link de pagamento, o Pix e o link de assinatura do cliente.
    const e = await sala.estado(token);
    expect(e.aceite?.cobranca).toMatchObject({ linkPagamento: parcelas[0].linkPagamento, pixCopiaECola: parcelas[0].pixCopiaECola, primeiraParcelaCentavos: 399_900 });
    expect(e.aceite?.contrato?.linkAssinatura).toBe(doc.linkCliente);

    // Rodar de novo: nada a propor, nada duplica.
    expect(await naEmpresa(() => dinheiro.proporAceite(ORG, leadId))).toMatchObject({ cobranca: 'ja_existe', contrato: 'ja_existe' });
  });

  it('webhook com segredo errado ou sem segredo é recusado; nada é gravado', async () => {
    const parcela1 = await prisma.comercialCobranca.findFirstOrThrow({ where: { leadId, parcela: 1 } });
    const corpo = { id: 'evt-falso', event: 'PAYMENT_RECEIVED', payment: { id: parcela1.externoId, value: 3999, paymentDate: '2026-10-13' } };
    await expect(dinheiro.webhookDoAsaas('segredo-errado', corpo)).rejects.toMatchObject({ status: 401 });
    await expect(dinheiro.webhookDoAsaas(undefined, corpo)).rejects.toMatchObject({ status: 401 });
    await expect(dinheiro.webhookDaZapsign('segredo-errado', { token: 'x', signers: [] })).rejects.toMatchObject({ status: 401 });
    // Conector sem segredo configurado recusa tudo, até o segredo "certo".
    const antes = process.env.ASAAS_WEBHOOK_TOKEN;
    process.env.ASAAS_WEBHOOK_TOKEN = '';
    const semSegredo = new AsaasService(new ConectoresConfiguradosRegistry());
    process.env.ASAAS_WEBHOOK_TOKEN = antes;
    expect(semSegredo.webhookAutentico('')).toBe(false);
    expect(semSegredo.webhookAutentico(SEGREDO_ASAAS)).toBe(false);
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'pix.pago' } })).toBe(0);
  });

  it('pagar e assinar no dublê: os webhooks gravam os fatos, a reentrega não duplica e o fechamento vai à fila (R4)', async () => {
    const parcela1 = await prisma.comercialCobranca.findFirstOrThrow({ where: { leadId, parcela: 1 } });
    const pago = await fetch(`http://127.0.0.1:${portaAsaas}/simular/pagar/${parcela1.externoId}`, { method: 'POST', headers: { accept: 'application/json' } });
    expect(pago.ok).toBe(true);
    expect(recebidos.at(-1)).toEqual({ qual: '/asaas', status: 200 });
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'pix.pago' } })).toBe(1);
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'parcela.paga' } })).toBe(1);
    expect((await prisma.comercialCobranca.findUniqueOrThrow({ where: { id: parcela1.id } })).estado).toBe('paga');

    // Reentrega do mesmo webhook: zero fatos novos.
    const corpo = { id: 'evt-reentrega', event: 'PAYMENT_RECEIVED', payment: { id: parcela1.externoId, value: 3999, paymentDate: '2026-10-13' } };
    expect(await dinheiro.webhookDoAsaas(SEGREDO_ASAAS, corpo)).toMatchObject({ gravados: 0 });
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'pix.pago' } })).toBe(1);

    // Ainda sem as duas assinaturas: o fechamento não foi proposto, nem a pedido de uma pessoa.
    expect(await prisma.approval.count({ where: { orgId: ORG, capabilityId: CAP_FECHAMENTO } })).toBe(0);
    expect(await naEmpresa(() => fechamento.propor(ORG, leadId, { id: titularId, tipo: 'user' as never }))).toEqual({
      pulado: 'falta: contrato assinado pelo cliente, contrato assinado pela Root',
    });
    expect(await prisma.approval.count({ where: { orgId: ORG, capabilityId: CAP_FECHAMENTO } })).toBe(0);

    const doc = await prisma.comercialDocumento.findFirstOrThrow({ where: { leadId } });
    const assinar = async (link: string) => {
      const t = link.split('/assinar/')[1];
      const r = await fetch(`http://127.0.0.1:${portaZap}/simular/assinar/${t}`, { method: 'POST', headers: { accept: 'application/json' }, redirect: 'manual' });
      expect(r.status).toBeLessThan(400);
    };
    await assinar(doc.linkCliente!);
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'contrato.assinado_cliente' } })).toBe(1);
    expect(await prisma.approval.count({ where: { orgId: ORG, capabilityId: CAP_FECHAMENTO } })).toBe(0);

    // D-1: o link de assinar pela Root só sai para o signatário cadastrado, titular, com a senha certa.
    const pedir = (id: string, papeis: string[], senha?: string) => naEmpresa(() => dinheiro.linkParaAssinarPelaRoot(ORG, leadId, { id, papeis }, senha));
    await expect(pedir(gestorId, ['gestor_marketing'], SENHA)).rejects.toMatchObject({ status: 403 });
    await expect(pedir(titularId, ['admin_master', 'ia_acao'], SENHA)).rejects.toMatchObject({ status: 403 });
    await expect(pedir(outroTitularId, ['admin_master'], SENHA)).rejects.toMatchObject({ status: 403 });
    await expect(pedir(titularId, ['admin_master'])).rejects.toMatchObject({ status: 401 });
    await expect(pedir(titularId, ['admin_master'], 'senha-errada')).rejects.toMatchObject({ status: 401 });
    const pelaRoot = await pedir(titularId, ['admin_master'], SENHA);
    expect(pelaRoot.linkAssinatura).toContain(`127.0.0.1:${portaZap}/assinar/`);
    const entregas = await prisma.auditLog.findMany({ where: { orgId: ORG, action: 'comercial.contrato.link_da_root_entregue' } });
    expect(entregas).toHaveLength(1);
    expect(JSON.stringify(entregas[0])).not.toContain('/assinar/');
    await assinar(pelaRoot.linkAssinatura!);
    expect(recebidos.filter((x) => x.qual === '/zapsign').every((x) => x.status === 200)).toBe(true);
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'contrato.assinado_root' } })).toBe(1);
    const depois = await prisma.comercialDocumento.findUniqueOrThrow({ where: { id: doc.id } });
    expect(depois.estado).toBe('assinado');
    expect(depois.assinadoClienteEm).toBeTruthy();
    expect(depois.assinadoRootEm).toBeTruthy();

    // Reentrega do doc_signed: nada novo.
    const reentrega = {
      event_type: 'doc_signed',
      token: doc.externoId,
      status: 'signed',
      signers: [
        { token: 'a', external_id: 'cliente', status: 'signed', signed_at: '2026-10-13T13:00:00Z' },
        { token: 'b', external_id: 'root', status: 'signed', signed_at: '2026-10-13T13:01:00Z' },
      ],
    };
    expect(await dinheiro.webhookDaZapsign(SEGREDO_ZAP, reentrega)).toMatchObject({ gravados: 0 });

    // Os três fatos no fio, fechamentoAutomatico desligado (padrão): o sistema propõe à porta e a titular assina.
    const f = await aprovacao(CAP_FECHAMENTO);
    expect(f.status).toBe('pendente');
    expect(f.nivelExigido).toBe('R4');
    expect(f.resourceId).toBe(`fech-${leadId}-v1`);
  });

  it('a titular assina o fechamento: cinco escritas, cliente ativo; rodar de novo não duplica nada', async () => {
    // D-2: um aceite.dados com outro CNPJ chega ao fio depois da cobrança aprovada (por fora da sala, que já
    // recusa). O fechamento cria o cliente com o devedor da cobrança aprovada, nunca com o aceite mais novo.
    await naEmpresa(() =>
      fio.registrar(ORG, leadId, 'aceite.dados', 'dados-trocados', { cnpj: '99888777000166', razaoSocial: 'Outra Empresa Ltda', endereco: 'Rua Z, 9', quemAssina: 'Outra Pessoa', email: 'outra@exemplo.test' }, { semReacoes: true }),
    );
    expect((await titularAssina((await aprovacao(CAP_FECHAMENTO)).id)).status).toBe('executado');
    expect(await prisma.partner.count({ where: { orgId: ORG, cnpjCpf: '99888777000166' } })).toBe(0);
    const tela = await naEmpresa(() => fechamento.doLead(ORG, leadId));
    expect(tela.estado, JSON.stringify(tela.escritas)).toBe('concluido');
    expect(tela.chave).toBe(`fech-${leadId}-v1`);
    expect(tela.escritas.map((e) => [e.escrita, e.estado])).toEqual([
      ['cliente', 'criado'],
      ['contrato', 'criado'],
      ['cobranca', 'reaproveitado'],
      ['kit_e_trilho', 'criado'],
      ['grupo', 'criado'],
    ]);
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'cliente.ativo' } })).toBe(1);
    const trilho = tela.escritas.find((e) => e.escrita === 'kit_e_trilho')!;
    expect(trilho.detalhe).toMatch(/^trilho aberto na fase \d de 5\. Lacunas \[a decidir\]/);
    console.info(`[lane D] kit e trilho: ${trilho.detalhe}`);
    const ficha = await prisma.comercialFicha.findUniqueOrThrow({ where: { leadId } });
    expect(ficha.partnerId && ficha.contractId && ficha.trilhoId && ficha.grupoJid).toBeTruthy();

    const contar = async () => ({
      partners: await prisma.partner.count({ where: { orgId: ORG, cnpjCpf: CNPJ } }),
      contratos: await prisma.contract.count({ where: { orgId: ORG } }),
      cobrancas: await prisma.comercialCobranca.count({ where: { leadId } }),
      noAsaas: ((await (await fetch(`http://127.0.0.1:${portaAsaas}/v3/payments`, { headers: { access_token: 'x' } })).json()) as { totalCount: number }).totalCount,
      trilhos: await prisma.onboardingTrilho.count({ where: { orgId: ORG } }),
      grupo: (await prisma.comercialFicha.findUniqueOrThrow({ where: { leadId } })).grupoJid,
      ativos: await prisma.leadEvent.count({ where: { leadId, type: 'cliente.ativo' } }),
    });
    const antes = await contar();
    expect(antes).toMatchObject({ partners: 1, contratos: 1, cobrancas: 3, noAsaas: 3, trilhos: 1, ativos: 1 });

    // Segunda passada com a linha "caída no meio" (estado e escritas apagados): reaproveita tudo.
    await prisma.comercialFechamento.updateMany({ where: { leadId }, data: { estado: 'erro', escritas: [] } });
    const a = await dinheiro.aceiteDoLead(leadId);
    const segunda = await naEmpresa(() => fechamento.executar(ORG, leadId, a!));
    expect(segunda.estado).toBe('concluido');
    expect(segunda.escritas.every((e) => e.estado === 'reaproveitado')).toBe(true);
    expect(await contar()).toEqual(antes);

    // Propor de novo depois de concluído: nada vai à fila.
    expect(await naEmpresa(() => fechamento.propor(ORG, leadId, { id: titularId, tipo: 'user' as never }))).toMatchObject({ estado: 'concluido' });
    expect(await prisma.approval.count({ where: { orgId: ORG, capabilityId: CAP_FECHAMENTO } })).toBe(1);
  });

  it('contrato vivo: parcelas, régua e marcos; a régua não repete na mesma passagem', async () => {
    const vivo = await naEmpresa(() => contratoVivo.doLead(ORG, leadId));
    expect(vivo.parcelas.map((p) => p.estado)).toEqual(['paga', 'pendente', 'pendente']);
    expect(vivo.marcos.map((m) => m.chave)).toEqual(['dia_15_indicacao', 'd_30_continuidade']);
    expect(vivo.faseDaImplantacao).toEqual({ atual: 1, total: 5 });

    // Parcela 2 vence em 2 dias (D-3 já alcançado); parcela 3 venceu há 11 dias (D+10).
    const agora = new Date();
    const dia = 86_400_000;
    await prisma.comercialCobranca.updateMany({ where: { leadId, parcela: 2 }, data: { vence: new Date(agora.getTime() + 2 * dia) } });
    await prisma.comercialCobranca.updateMany({ where: { leadId, parcela: 3 }, data: { vence: new Date(agora.getTime() - 11 * dia) } });

    const r1 = await naEmpresa(() => contratoVivo.regua(ORG, agora));
    expect(r1).toEqual({ avisos: 2, decisoes: 1 });
    const r2 = await naEmpresa(() => contratoVivo.regua(ORG, agora));
    expect(r2).toEqual({ avisos: 0, decisoes: 0 });
    const avisos = await prisma.leadEvent.findMany({ where: { leadId, type: 'parcela.vence' }, select: { payload: true } });
    expect(avisos.map((a) => (a.payload as { aviso: string }).aviso).sort()).toEqual(['D+10', 'D-3']);
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'parcela.atrasada' } })).toBe(1);
    const decisao = await prisma.comercialDecisao.findFirstOrThrow({ where: { leadId, tipo: 'excecao_do_vigia' } });
    expect(decisao.padrao).toBe('aguardar');

    // Marcos: 16 dias depois do cliente ativo, o dia 15 sai uma vez.
    const m1 = await naEmpresa(() => contratoVivo.marcos(ORG, new Date(agora.getTime() + 16 * dia)));
    const m2 = await naEmpresa(() => contratoVivo.marcos(ORG, new Date(agora.getTime() + 16 * dia)));
    expect(m1.marcos).toBeGreaterThanOrEqual(1);
    expect(m2.marcos).toBe(0);
  });
  /** Um lead que já aceitou, com os três fatos do fechamento gravados direto no fio (os webhooks já foram medidos acima). */
  async function leadQueFechou(nome: string, cnpj: string): Promise<string> {
    const tel = `+55328${Date.now().toString().slice(-8)}`;
    const r = await naEmpresa(() => whats.receberEntrada(ORG, { telefone: tel, texto: 'Oi', nome, mensagemId: `${MARCA}-${nome}` }));
    const id = r.leadId;
    const hash = hashDoConteudo({ lead: id, v: 1 });
    await naEmpresa(async () => {
      await fio.registrar(ORG, id, 'aceite.dados', 'dados', { cnpj, razaoSocial: `${nome} Ltda`, endereco: 'Rua B, 2', quemAssina: nome, email: `${cnpj}@cliente.test` });
      await fio.registrar(ORG, id, 'proposta.aceita', 'v1', { versao: 1, produto: 'imersao', valorCentavos: 297_000, parcelas: 10, forma: 'cartao', hash });
      await fio.registrar(ORG, id, 'pix.pago', `pay-${id}`, { provedor: 'asaas', externoId: `pay-${id}`, parcela: 1, valorCentavos: 29_700, pagoEm: new Date().toISOString() });
      await fio.registrar(ORG, id, 'contrato.assinado_cliente', `doc-${id}`, { provedor: 'zapsign', externoId: `doc-${id}`, em: new Date().toISOString() });
      await fio.registrar(ORG, id, 'contrato.assinado_root', `doc-${id}`, { provedor: 'zapsign', externoId: `doc-${id}`, em: new Date().toISOString(), por: null });
    });
    return id;
  }

  it('fechamento automático ligado: abre a janela de veto antes de propor; vencida no padrão "seguir", vai à porta (R4 continua)', async () => {
    await prisma.comercialConfig.upsert({ where: { orgId: ORG }, create: { orgId: ORG, fechamentoAutomatico: true, janelaDeVetoMinutos: 30 }, update: { fechamentoAutomatico: true, janelaDeVetoMinutos: 30 } });
    const id = await leadQueFechou('Studio Lume', `2${Date.now().toString().slice(-13)}`);
    const chave = `fech-${id}-v1`;
    const veto = await prisma.comercialDecisao.findFirstOrThrow({ where: { leadId: id, tipo: 'veto_de_fechamento' } });
    expect(veto.padrao).toBe('seguir');
    expect(await prisma.approval.count({ where: { orgId: ORG, capabilityId: CAP_FECHAMENTO, resourceId: chave } })).toBe(0);

    // O relógio passa depois da janela: o padrão é aplicado e o fechamento vai à fila, ainda R4.
    await naEmpresa(() => decisoesSvc.expirarVencidas(ORG, new Date(Date.now() + 31 * 60_000)));
    const f = await prisma.approval.findFirstOrThrow({ where: { orgId: ORG, capabilityId: CAP_FECHAMENTO, resourceId: chave } });
    expect(f.nivelExigido).toBe('R4');
    expect(f.status).toBe('pendente');
  });

  it('VETO na janela: nada é proposto e o fechamento fica vetado até alguém rodar de novo', async () => {
    const id = await leadQueFechou('Cafe Serra', `3${Date.now().toString().slice(-13)}`);
    const veto = await prisma.comercialDecisao.findFirstOrThrow({ where: { leadId: id, tipo: 'veto_de_fechamento' } });
    await naEmpresa(() => decisoesSvc.responder(ORG, veto.id, 'vetar', { id: titularId, nome: 'Titular da Root' }, 'tela'));
    expect(await prisma.approval.count({ where: { orgId: ORG, capabilityId: CAP_FECHAMENTO, resourceId: `fech-${id}-v1` } })).toBe(0);
    const tela = await naEmpresa(() => fechamento.doLead(ORG, id));
    expect(tela.vetado).toBe(true);
    expect(await prisma.leadEvent.count({ where: { leadId: id, type: 'veto.registrado' } })).toBe(1);
    // Rodar de novo (uma pessoa): volta à fila, em nome de quem pediu.
    const r = await naEmpresa(() => fechamento.propor(ORG, id, { id: titularId, tipo: 'user' as never }));
    expect(r).toMatchObject({ estado: 'na_fila' });
    await prisma.comercialConfig.update({ where: { orgId: ORG }, data: { fechamentoAutomatico: false } });
  });
  it('o relógio devolve à fila o R4 que venceu sem assinatura (uma vez por hora) e nunca o que a titular recusou', async () => {
    const id = await leadQueFechou('Otica Vista', `4${Date.now().toString().slice(-13)}`);
    const doLead = (cap: string) => prisma.approval.findMany({ where: { orgId: ORG, capabilityId: cap, resourceId: { contains: id } }, orderBy: { criadoEm: 'asc' } });
    const [cob] = await doLead(CAP_COBRANCA);
    expect(cob.status).toBe('pendente');
    expect(await doLead(CAP_CONTRATO)).toHaveLength(1);
    expect(await doLead(CAP_FECHAMENTO)).toHaveLength(1);
    // A titular recusa a cobrança; as outras duas vencem sem ninguém assinar.
    await naEmpresa(() => approvals.reject(ORG, cob.id, { id: titularId, papeis: ['admin_master'] }));

    // Uma hora depois (o relógio do processo também: a validade da aprovação nova conta dali).
    const depois = new Date(Date.now() + 61 * 60_000);
    vi.setSystemTime(depois);
    const r1 = await naEmpresa(() => fechamento.repropor(ORG, depois));
    expect(r1.fechamentos).toBeGreaterThanOrEqual(1); // os outros leads da suíte que esperam a titular também voltam
    expect(await doLead(CAP_COBRANCA)).toHaveLength(1); // recusada: máquina não refaz
    expect(await doLead(CAP_CONTRATO)).toHaveLength(2);
    expect(await doLead(CAP_FECHAMENTO)).toHaveLength(2);
    // A mesma passagem de novo: as novas estão vivas, nada se repete.
    await naEmpresa(() => fechamento.repropor(ORG, depois));
    vi.useRealTimers();
    expect(await doLead(CAP_CONTRATO)).toHaveLength(2);
    expect(await doLead(CAP_FECHAMENTO)).toHaveLength(2);
  });
});
