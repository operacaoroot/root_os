import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
import { AssistenteService } from '../src/comercial/assistente.service';
import { ConfigComercialService } from '../src/comercial/config.service';
import { ZapsignService } from '../src/comercial/conectores/zapsign.service';
import { ContratoVivoService } from '../src/comercial/contrato-vivo.service';
import { DecisoesRegistry, DecisoesService } from '../src/comercial/decisoes.service';
import { DiagnosticoService } from '../src/comercial/diagnostico.service';
import { CAP_COBRANCA, CAP_CONTRATO, DinheiroService } from '../src/comercial/dinheiro.service';
import { CAP_FECHAMENTO, FechamentoService } from '../src/comercial/fechamento.service';
import { FichaService } from '../src/comercial/ficha.service';
import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { decifrarLinkDaRoot } from '../src/comercial/link-da-root';
import { CAPACIDADE_DA_PROPOSTA, PropostaService } from '../src/comercial/proposta.service';
import { ReacoesDaEspinha } from '../src/comercial/reacoes-da-espinha';
import { RelogioDaEspinha } from '../src/comercial/relogio-da-espinha';
import { RelogioComercialRegistry } from '../src/comercial/relogio.registry';
import { SalaService } from '../src/comercial/sala.service';
import { segredoDoAmbiente } from '../src/comercial/sala-token';
import { CAPACIDADE_DO_WHATSAPP, WhatsappComercialService } from '../src/comercial/whatsapp.service';
import { AsaasService } from '../src/finance/asaas.service';
import { AcoesService } from '../src/gateway/acoes.service';
import { ConectoresConfiguradosRegistry } from '../src/gateway/conectores-configurados.registry';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { EventLogService } from '../src/gateway/event-log.service';
import { InterruptoresRegistry } from '../src/gateway/interruptores.registry';
import { PortaDoOperador } from '../src/gateway/porta-do-operador.service';
import { ToolGateway } from '../src/gateway/tool-gateway.service';
import { ConectoresService } from '../src/integrations/conectores.service';
import { StubProvider } from '../src/llm/stub.provider';
import { TrilhoService } from '../src/onboarding/trilho/trilho.service';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ExecutoresDeRotinaRegistry } from '../src/routines/executores.registry';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * A JORNADA DO COCKPIT DE PONTA A PONTA, EM PROCESSO (lane Jornada, 13/10/2026).
 *
 * A MESMA jornada de `homolog/e2e/jornada-docker.mjs`, sem HTTP: os serviços
 * montados à mão (como as suítes comercial-*), a política do BANCO
 * (`db:seed:politica`), a porta de verdade, o provedor `stub` com as fixtures
 * da homologação e os dublês do Asaas e da ZapSign subidos por child_process,
 * com o webhook apontado para um receptor deste teste.
 *
 *   lead entra pelo simulador → M1 com formulário (R3) → formulário na sala →
 *   M2 com horários (R3) → horário escolhido → M3 da véspera pelo relógio (R3)
 *   → confirmação de véspera no fio → ata da sessão → diagnóstico com stub →
 *   sócio aprova → proposta da tabela com o quadro de exemplo, decisão de um
 *   toque, porta (R3) → M4 (R3) →
 *   leitura por bloco → pedido de ajuste na fila → decisão de um toque →
 *   aceite → cobrança e contrato (R4) → Pix pago e contrato assinado nos
 *   dublês → webhooks → fechamento (R4, 5 escritas) → contrato vivo → funil.
 *
 * O QUE SE MEDE: os TOQUES HUMANOS. Cada passo que exige uma pessoa é contado,
 * nunca removido. O desenho do cockpit promete dois toques fixos (conduzir a
 * sessão e assinar pela Root) mais as decisões de um toque; a régua de hoje
 * acrescenta os outros, e o número abaixo é o MEDIDO. Mudar a régua muda o
 * número, e este teste fica vermelho para dizer isso alto.
 */

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (a jornada inteira do comercial: lead, mensagens, proposta, cobrança, contrato, fechamento, aprovações e rastro)');
process.env.ENCRYPTION_KEY ??= 'chave-de-teste-da-sala-0123456789abcdef';
process.env.GATEWAY_MODO = 'impor';

const RAIZ = path.resolve(__dirname, '../../..');
// Como a homologação (`homolog/.env.homolog`): o quadro de custos é o EXEMPLO do mapa, e o revisor o aponta.
process.env.QUADRO_DE_CUSTOS_EXEMPLO = path.join(RAIZ, 'homolog/fixtures/quadro-de-custos-exemplo.json');
const ATA = readFileSync(path.join(RAIZ, 'homolog/fixtures/ata-alicerce.md'), 'utf8');
const MARCA = `jn${Date.now().toString(36).slice(-6)}`;
const SENHA = 'senha-da-jornada-de-ponta-a-ponta';
const SEGREDO_ASAAS = `asaas-${MARCA}-segredo-da-jornada`;
const SEGREDO_ZAP = `zap-${MARCA}-segredo-da-jornada`;
const TEL = `+55329${Date.now().toString().slice(-8)}`;
const CNPJ = `5${Date.now().toString().slice(-13)}`;

/*
 * OS TOQUES MEDIDOS (13/10/2026, régua 1.8.0 do banco):
 *
 *   do desenho (2 fixos + as decisões de um toque):
 *     · conduzir a sessão e subir a ata (sócio da conta);
 *     · assinar o contrato pela Root (sócio);
 *     · decidir o pedido de ajuste na fila (um toque).
 *   que a régua acrescenta, e por quê:
 *     · liberar M1, M2, M3 e M4 (4): `comercial.whatsapp.enviar` é R3 (sai da
 *       casa, irreversível, confidencial) e o proponente é o sistema; OUTRA
 *       pessoa com alçada responsável libera cada uma. O sinal
 *       `volume_atipico` (pedidos da última hora acima de 3× a média por
 *       hora da capacidade, que numa empresa nova é quase zero) sobe a M2 e a
 *       M3 a R4 quando saem na mesma hora da M1: aí assina a titular, com
 *       senha e motivo, e o toque continua UM. Por isso a asserção abaixo
 *       confere a CHAVE de cada toque, não o degrau: o degrau do WhatsApp
 *       depende do relógio de verdade (o `criadoEm` do ToolCall é do banco);
 *     · aprovar o diagnóstico (1): o portão de E5 pede "diagnóstico aprovado
 *       por sócio" e só ele solta a proposta;
 *     · levar à liberação a proposta com o quadro de EXEMPLO (1, revisão E-3):
 *       não há dado real de custos de terceiros; o quadro do mapa vem marcado
 *       exemplo, o revisor aponta e a versão cai na decisão
 *       `proposta_fora_da_tabela`. Antes da revisão o exemplo era nota e o
 *       laudo saía limpo, e era assim que o número de exemplo chegava a todo
 *       cliente. Com o dado real escrito, esse toque some;
 *     · liberar a publicação da proposta (1): `comercial.proposta.publicar` R3;
 *     · assinar a cobrança e o contrato (2): R4, titular com senha e motivo
 *       (obrigação financeira; a proposta de lote único da lane D reduziria os
 *       três R4 a um, e não foi executada);
 *     · assinar o fechamento (1): `comercial.fechamento.executar` R4.
 *   Total: 3 do desenho + 10 da régua = 13.
 */
const TOQUES_MEDIDOS = 13;

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

async function esperarUrl(url: string, ms = 10_000): Promise<void> {
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

type Pessoa = { id: string; nome: string; papeis: string[] };
type Toque = { n: number; chave: string; quem: string; acao: string; porque: string };

describe.skipIf(!URL)('a jornada do cockpit de ponta a ponta, contando os toques humanos', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: URL } } });
  const p = prisma as unknown as PrismaService;
  let ORG = '';
  const socio: Pessoa = { id: '', nome: 'Sócio da conta', papeis: ['admin_master'] };
  const titular: Pessoa = { id: '', nome: 'Sócia titular', papeis: ['diretor'] };
  const mesa: Pessoa = { id: '', nome: 'Mesa', papeis: ['gestor_marketing'] };

  let fio: FioService;
  let fichas: FichaService;
  let decisoes: DecisoesService;
  let config: ConfigComercialService;
  let sala: SalaService;
  let whats: WhatsappComercialService;
  let relogioComercial: RelogioComercialRegistry;
  let diagnosticos: DiagnosticoService;
  let propostas: PropostaService;
  let dinheiro: DinheiroService;
  let fechamento: FechamentoService;
  let contratoVivo: ContratoVivoService;
  let approvals: ApprovalsService;
  let acoes: AcoesService;

  let estadoDosDubles = '';
  let portaAsaas = 0;
  let portaZap = 0;
  const filhos: ChildProcess[] = [];
  let receptor: Server;

  let leadId = '';
  let token = '';
  const toques: Toque[] = [];
  const doCliente: string[] = [];

  const naEmpresa = <T>(fn: () => Promise<T>): Promise<T> => comContexto({ orgId: ORG, correlationId: `jornada-${MARCA}`, origem: 'http' }, fn);
  const aos = (iso: string) => vi.setSystemTime(new Date(iso));
  const tipos = async () => (await prisma.leadEvent.findMany({ where: { leadId }, select: { type: true } })).map((e) => e.type);
  const etapa = async () => (await prisma.comercialFicha.findUnique({ where: { leadId } }))?.etapa;

  function tocar(chave: string, quem: Pessoa, acao: string, porque: string): void {
    toques.push({ n: toques.length + 1, chave, quem: quem.nome, acao, porque });
  }

  /** Confirma pela mesma rota de /atendimento: R3 pela mesa (responsável), R4 pela titular com senha e motivo. */
  async function confirmar(chave: string, approvalId: string, porque: string): Promise<void> {
    const a = await prisma.approval.findFirstOrThrow({ where: { id: approvalId, orgId: ORG } });
    expect(a.status, `${a.capabilityId} devia esperar na fila`).toBe('pendente');
    expect(a.propostoPorId).not.toBe(a.alcadaMinima === 'titular' ? titular.id : mesa.id);
    const quem = a.alcadaMinima === 'titular' ? titular : mesa;
    await naEmpresa(() =>
      approvals.confirm(ORG, approvalId, { id: quem.id, papeis: quem.papeis, ...(a.exigeReauth ? { reauth: { senha: SENHA } } : {}) }, a.exigeReauth ? `conferi: ${porque}` : undefined),
    );
    const exec = (await naEmpresa(() => acoes.executarAprovada(ORG, approvalId, quem.id))) as { status: string };
    expect(exec.status, `${a.capabilityId} não executou`).toBe('executado');
    tocar(chave, quem, `${a.exigeReauth ? 'assina' : 'libera'} ${a.capabilityId} (${a.nivelExigido})`, porque);
  }

  /** A mensagem de um template, retida na porta; outra pessoa libera. */
  async function liberarMensagem(template: string, porque: string) {
    const m = await prisma.comercialMensagem.findFirstOrThrow({ where: { leadId, template } });
    expect(m.estado, `${template} devia estar retida na fila`).toBe('na_fila');
    expect(m.approvalId).toBeTruthy();
    const call = await prisma.toolCall.findFirstOrThrow({ where: { orgId: ORG, capabilityId: CAPACIDADE_DO_WHATSAPP, approvalId: m.approvalId! } });
    expect(call.status).toBe('aguardando_aprovacao');
    await confirmar(template, m.approvalId!, porque);
    const depois = await prisma.comercialMensagem.findUniqueOrThrow({ where: { id: m.id } });
    expect(depois.estado).toBe('enviada');
    return depois;
  }

  beforeAll(async () => {
    // Terça, 14:00 de São Paulo: dentro da janela da política, e a véspera do primeiro horário oferecido cai hoje.
    aos('2026-10-13T14:00:00-03:00');

    const portaReceptor = await portaLivre();
    receptor = createServer(async (req, res) => {
      const partes: Buffer[] = [];
      for await (const parte of req) partes.push(parte as Buffer);
      const corpo = JSON.parse(Buffer.concat(partes).toString('utf8') || '{}');
      try {
        if (req.url === '/asaas') await dinheiro.webhookDoAsaas(String(req.headers['asaas-access-token'] ?? ''), corpo);
        else await dinheiro.webhookDaZapsign(String(req.headers['x-zapsign-token'] ?? ''), corpo);
        res.writeHead(200).end('{}');
      } catch (e) {
        res.writeHead((e as { status?: number }).status ?? 500).end(String((e as Error).message));
      }
    });
    await new Promise<void>((ok) => receptor.listen(portaReceptor, '127.0.0.1', ok));
    estadoDosDubles = mkdtempSync(path.join(tmpdir(), 'jornada-'));
    portaAsaas = await portaLivre();
    portaZap = await portaLivre();
    const subir = (arquivo: string, porta: number, webhook: string, segredo: string) => {
      filhos.push(
        spawn(process.execPath, [path.join(RAIZ, arquivo)], {
          env: { ...process.env, PORT: String(porta), WEBHOOK_URL: webhook, WEBHOOK_TOKEN: segredo, PUBLIC_URL: `http://127.0.0.1:${porta}`, ESTADO: path.join(estadoDosDubles, `${porta}.json`) },
          stdio: 'ignore',
        }),
      );
    };
    subir('homolog/mocks/asaas/server.mjs', portaAsaas, `http://127.0.0.1:${portaReceptor}/asaas`, SEGREDO_ASAAS);
    subir('homolog/mocks/zapsign/server.mjs', portaZap, `http://127.0.0.1:${portaReceptor}/zapsign`, SEGREDO_ZAP);
    await esperarUrl(`http://127.0.0.1:${portaAsaas}/health`);
    await esperarUrl(`http://127.0.0.1:${portaZap}/health`);
    process.env.ASAAS_BASE_URL = `http://127.0.0.1:${portaAsaas}/v3`;
    process.env.ASAAS_API_KEY = 'chave-de-homologacao';
    process.env.ASAAS_WEBHOOK_TOKEN = SEGREDO_ASAAS;
    process.env.ZAPSIGN_BASE_URL = `http://127.0.0.1:${portaZap}/api/v1`;
    process.env.ZAPSIGN_API_TOKEN = 'token-de-homologacao';
    process.env.ZAPSIGN_WEBHOOK_TOKEN = SEGREDO_ZAP;

    const org = await prisma.org.create({ data: { name: `Jornada ${MARCA}`, slug: `jornada-${MARCA}` } });
    ORG = org.id;
    const hash = await bcrypt.hash(SENHA, 4);
    const papel = async (key: string, name: string) => (await prisma.role.create({ data: { orgId: ORG, key, name } })).id;
    const admin = await papel('admin_master', 'Admin Master');
    const diretor = await papel('diretor', 'Diretor');
    const gestor = await papel('gestor_marketing', 'Gestor de Marketing');
    const pessoa = async (quem: Pessoa, roleId: string, email: string) => {
      quem.id = (await prisma.user.create({ data: { orgId: ORG, name: quem.nome, email: `${email}.${MARCA}@jornada.teste`, passwordHash: hash, roles: { connect: { id: roleId } } } })).id;
    };
    // O sócio da conta nasce primeiro: é o dono do lead pela regra-v1 (primeiro admin_master/diretor).
    await pessoa(socio, admin, 'socio');
    await pessoa(titular, diretor, 'titular');
    await pessoa(mesa, gestor, 'mesa');

    const audit = new AuditService(p);
    const policy = new PolicyService(p);
    await policy.onModuleInit();
    approvals = new ApprovalsService(p, audit, new ReauthService(p, new JwtService({ secret: `segredo-${MARCA}` }), audit));
    const log = new EventLogService(p);
    const efeitos = new EfeitosRegistry();
    const interruptores = new InterruptoresRegistry();
    new ConectoresService(p, audit, log, interruptores).onModuleInit();
    const gateway = new ToolGateway(p, policy, new SinaisService(p, policy), approvals, log, undefined, interruptores, efeitos);
    acoes = new AcoesService(p, gateway, log, interruptores, policy);
    const porta = new PortaDoOperador(gateway, efeitos);

    // A montagem do ComercialModule, na ordem em que o Nest inicia os serviços.
    const reacoes = new ReacoesRegistry();
    fio = new FioService(p, reacoes);
    config = new ConfigComercialService(p);
    const aoDecidir = new DecisoesRegistry();
    decisoes = new DecisoesService(p, fio, config, aoDecidir);
    fichas = new FichaService(p, fio, config);
    relogioComercial = new RelogioComercialRegistry();
    const relogio = new RelogioDaEspinha(p, new ExecutoresDeRotinaRegistry(), relogioComercial, decisoes, fio, config, fichas);
    relogio.inscrever();
    new ReacoesDaEspinha(p, fio, reacoes, fichas, decisoes, aoDecidir, relogio).inscrever();
    sala = new SalaService(p, fio, reacoes);
    sala.onModuleInit();
    whats = new WhatsappComercialService(p, fio, reacoes, relogioComercial, sala, efeitos, porta);
    whats.onModuleInit();
    const llm = new StubProvider(path.join(RAIZ, 'homolog/fixtures/stub'));
    diagnosticos = new DiagnosticoService(p, fio, reacoes, llm);
    diagnosticos.inscrever();
    propostas = new PropostaService(p, fio, reacoes, decisoes, aoDecidir, config, efeitos, porta, relogioComercial, llm);
    propostas.inscrever();
    new AssistenteService(p, reacoes, sala, llm, decisoes, aoDecidir).inscrever();
    dinheiro = new DinheiroService(p, fio, reacoes, efeitos, porta, new AsaasService(new ConectoresConfiguradosRegistry()), new ZapsignService(), whats);
    dinheiro.onModuleInit();
    const trilhos = new TrilhoService(p, undefined as never, log, undefined as never);
    fechamento = new FechamentoService(p, fio, reacoes, efeitos, porta, dinheiro, config, decisoes, aoDecidir, trilhos, whats, relogioComercial);
    fechamento.onModuleInit();
    contratoVivo = new ContratoVivoService(p, fio, relogioComercial, decisoes);
    contratoVivo.onModuleInit();

    // A config de homologação (a mesma que `db:seed:comercial` grava).
    await config.gravar(ORG, { validadePropostaDias: 8, valoresDeHomologacao: true });
  }, 60_000);

  afterAll(async () => {
    vi.useRealTimers();
    for (const f of filhos) f.kill();
    await new Promise<void>((ok) => receptor?.close(() => ok()));
    try {
      rmSync(estadoDosDubles, { recursive: true, force: true });
    } catch {
      /* o Windows pode segurar o arquivo do dublê por um instante */
    }
    if (ORG) {
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
      await prisma.rotina.deleteMany({ where: { orgId: ORG } });
      await prisma.approval.deleteMany({ where: { orgId: ORG } });
      await prisma.toolCall.deleteMany({ where: { orgId: ORG } });
      await prisma.policyDecision.deleteMany({ where: { orgId: ORG } });
      await prisma.auditLog.deleteMany({ where: { orgId: ORG } });
      await prisma.user.deleteMany({ where: { orgId: ORG } });
      await prisma.role.deleteMany({ where: { orgId: ORG } });
      await prisma.org.deleteMany({ where: { id: ORG } });
    }
    await prisma.$disconnect();
  }, 60_000);

  it('1 · o lead entra pelo simulador; a M1 com o formulário fica retida em R3 e outra pessoa libera', async () => {
    const r = await naEmpresa(() => whats.receberEntrada(ORG, { telefone: TEL, texto: 'Oi! Vi o vídeo do fechamento. Funciona com Omie?', nome: 'Marina Duarte', canal: 'conteudo', palavraChave: 'FECHAMENTO', mensagemId: `${MARCA}-1` }));
    leadId = r.leadId;
    doCliente.push('manda o primeiro "oi" no WhatsApp');
    expect(r.leadNovo).toBe(true);
    expect(await etapa()).toBe('novo_lead');
    const m1 = await liberarMensagem('M1', 'a primeira resposta ao lead sai da casa (R3)');
    expect((m1.interativo as { formulario?: { campos: unknown[] } }).formulario?.campos).toHaveLength(4);
    // B-1: o texto guardado leva o marcador; o token sai do link que o OS reescreve da cifra.
    expect(m1.texto).not.toMatch(/\/s\/[A-Za-z0-9_-]{20,}/);
    token = /\/s\/([A-Za-z0-9_-]{40,48})/.exec((await sala.linkDoLead(ORG, leadId)) ?? '')![1];
    expect((await sala.estado(token)).estagio).toBe('conversa');
  });

  it('2 · o formulário na sala qualifica e prepara a M2 com dois horários (R3); o lead escolhe o primeiro', async () => {
    aos('2026-10-13T14:05:00-03:00');
    const e = await sala.form(token, { sistema: 'Omie', baseOrganizada: true, maiorDor: 'o fechamento do mês sai no dia 9, sempre atrasado', equipeFinanceiro: 3, nome: 'Marina Duarte', empresa: 'Construtora Alicerce' });
    doCliente.push('responde o formulário na sala');
    expect(e.conversa.horariosOferecidos.length).toBeGreaterThanOrEqual(2);
    expect(await etapa()).toBe('qualificacao');
    aos('2026-10-13T14:10:00-03:00');
    const m2 = await liberarMensagem('M2', 'a oferta de horários sai da casa (R3)');
    const [b1] = (m2.interativo as { botoes: { chave: string }[] }).botoes;
    expect(b1.chave).toBe('2026-10-14T10:00:00-03:00');
    const depois = await sala.agenda(token, { horario: b1.chave });
    doCliente.push('escolhe o horário na sala');
    expect(depois.conversa.horario).toBe(b1.chave);
    expect(await etapa()).toBe('reuniao_agendada');
  });

  it('3 · a véspera: o relógio prepara a M3 (R3), outra pessoa libera, e a confirmação entra no fio', async () => {
    aos('2026-10-13T14:20:00-03:00');
    const vespera = relogioComercial.inscritas().find(([n]) => n === 'whats.vespera')![1];
    await naEmpresa(() => vespera(ORG, new Date()) as Promise<unknown>);
    await liberarMensagem('M3', 'a confirmação de véspera sai da casa (R3)');
    expect(await tipos()).toContain('agenda.confirmada');
    // O portão de E3 está cumprido; quem leva a E4 é a ata.
    expect(await etapa()).toBe('reuniao_agendada');
  });

  it('4 · o sócio conduz a sessão e sobe a ata; o diagnóstico sai com as 4 falas com minuto', async () => {
    aos('2026-10-14T10:45:00-03:00');
    await naEmpresa(() => fichas.registrarAta(ORG, leadId, { texto: ATA, fonte: 'granola' }, { id: socio.id, nome: socio.nome }));
    tocar('sessao', socio, 'conduz a sessão estratégica e sobe a ata', 'a sessão é humana por desenho (E4)');
    const diag = await diagnosticos.vigente(ORG, leadId);
    expect(diag, 'o leitor de ata não gravou o diagnóstico').toBeTruthy();
    expect(((diag!.payload as { dores: { minuto: string }[] }).dores).map((d) => d.minuto)).toEqual(['04:12', '11:40', '19:05', '27:30']);
    expect(await etapa()).toBe('diagnostico');
  });

  it('5 · o sócio aprova; a proposta com o quadro de EXEMPLO cai na decisão, o sócio a leva à porta (R3) e outra pessoa libera; a M4 avisa (R3)', async () => {
    aos('2026-10-14T11:00:00-03:00');
    await naEmpresa(() => diagnosticos.aprovar(ORG, leadId, { id: socio.id, nome: socio.nome }));
    tocar('diagnostico', socio, 'aprova o diagnóstico', 'portão de E5: diagnóstico aprovado por sócio solta a proposta');
    const [rascunho] = await propostas.rascunhos(ORG, leadId);
    expect(rascunho).toMatchObject({ versao: 1, estado: 'na_fila', dentroDaTabela: true });
    expect(rascunho.laudo.apontamentos).toEqual([expect.stringMatching(/VALORES DE EXEMPLO/)]);
    const fora = await prisma.comercialDecisao.findFirstOrThrow({ where: { leadId, tipo: 'proposta_fora_da_tabela', estado: 'aberta' } });
    await naEmpresa(() => decisoes.responder(ORG, fora.id, 'liberar', { id: socio.id, nome: socio.nome }, 'tela'));
    tocar('quadro', socio, 'leva à liberação a proposta com o quadro de exemplo', 'o revisor aponta número de exemplo (E-3): uma pessoa decide, um toque');
    const [v1] = await propostas.rascunhos(ORG, leadId);
    expect(v1).toMatchObject({ versao: 1, estado: 'na_porta' });
    const chamada = await prisma.toolCall.findFirstOrThrow({ where: { orgId: ORG, capabilityId: CAPACIDADE_DA_PROPOSTA } });
    expect(chamada.status).toBe('aguardando_aprovacao');
    await confirmar('proposta', v1.approvalId!, 'a proposta sai para o cliente (R3)');
    expect(await tipos()).toContain('proposta.publicada');
    expect(await etapa()).toBe('proposta');
    aos('2026-10-14T11:05:00-03:00');
    await liberarMensagem('M4', 'o aviso da proposta sai da casa (R3)');
  });

  it('6 · o cliente lê por bloco; o pedido de ajuste cai na fila e a decisão de um toque mantém o preço', async () => {
    aos('2026-10-14T15:00:00-03:00');
    let e = await sala.estado(token);
    expect(e.estagio).toBe('proposta');
    for (const bloco of ['ouvimos', 'recomendada', 'alternativa', 'custos', 'validade'] as const) e = await sala.propostaLida(token, { bloco, versao: 1 });
    doCliente.push('lê os cinco blocos da proposta');
    expect(e.proposta?.blocosLidos).toHaveLength(5);
    expect(e.proposta?.custosDeTerceiros).toMatchObject({ exemplo: true });
    expect(await etapa()).toBe('follow_up');
    e = await sala.ajuste(token, { pedido: 'Consegue 8% de desconto à vista?', descontoPct: 8 });
    doCliente.push('pede 8% de desconto');
    expect(e.proposta?.ajustePendente).toBe(true);
    const fila = await naEmpresa(() => decisoes.fila(ORG));
    expect(JSON.stringify(fila)).toContain('pedido_de_ajuste');
    const d = await prisma.comercialDecisao.findFirstOrThrow({ where: { leadId, tipo: 'pedido_de_ajuste', estado: 'aberta' } });
    await naEmpresa(() => decisoes.responder(ORG, d.id, 'manter', { id: socio.id, nome: socio.nome }, 'tela'));
    tocar('ajuste', socio, 'decide o pedido de ajuste (manter o preço)', 'desconto é decisão de gente: a fila, um toque');
    expect((await sala.estado(token)).proposta).toMatchObject({ versao: 1, ajustePendente: false });
  });

  it('7 · o aceite na sala propõe cobrança e contrato (R4); a titular assina; parcelas e documento nos dublês', async () => {
    aos('2026-10-14T16:00:00-03:00');
    await sala.aceiteDados(token, { cnpj: CNPJ, razaoSocial: 'Construtora Alicerce Ltda', endereco: 'Rua Fictícia, 100, Juiz de Fora, MG', quemAssina: 'Marina Duarte', email: 'marina@alicerce.teste' });
    await sala.aceitePagamento(token, { produto: 'operacao', forma: 'pix', versao: 1 });
    const e = await sala.aceiteContrato(token);
    doCliente.push('confere os dados', 'aceita a Operação ROOT em Pix', 'abre o passo do contrato');
    expect(e.estagio).toBe('contrato');
    expect(await etapa()).toBe('contrato');
    const ap = (cap: string) => prisma.approval.findFirstOrThrow({ where: { orgId: ORG, capabilityId: cap, resourceId: { contains: leadId } } });
    const cob = await ap(CAP_COBRANCA);
    const ctr = await ap(CAP_CONTRATO);
    for (const a of [cob, ctr]) expect([a.nivelExigido, a.alcadaMinima, a.exigeReauth]).toEqual(['R4', 'titular', true]);
    await confirmar('cobranca', cob.id, 'obrigação financeira com o cliente (R4)');
    await confirmar('contrato', ctr.id, 'contrato enviado para assinatura (R4)');
    expect(await prisma.comercialCobranca.count({ where: { leadId } })).toBe(3);
    const s = await sala.estado(token);
    expect(s.aceite?.cobranca?.linkPagamento).toContain(`127.0.0.1:${portaAsaas}/fatura/`);
    expect(s.aceite?.contrato?.linkAssinatura).toContain(`127.0.0.1:${portaZap}/assinar/`);
  });

  it('8 · Pix pago e contrato assinado nos dublês (cliente e Root): os webhooks gravam, o fechamento vai à porta (R4) e a titular assina', async () => {
    vi.useRealTimers(); // os dublês e os webhooks andam no relógio de verdade
    const s = await sala.estado(token);
    const fatura = /\/fatura\/([\w-]+)/.exec(s.aceite!.cobranca!.linkPagamento!)![1];
    expect((await fetch(`http://127.0.0.1:${portaAsaas}/simular/pagar/${fatura}`, { method: 'POST', headers: { accept: 'application/json' } })).ok).toBe(true);
    doCliente.push('paga a 1ª parcela no Pix (dublê)');
    const assinar = async (link: string) => {
      const r = await fetch(`http://127.0.0.1:${portaZap}/simular/assinar/${link.split('/assinar/')[1]}`, { method: 'POST', headers: { accept: 'application/json' }, redirect: 'manual' });
      expect(r.status).toBeLessThan(400);
    };
    await assinar(s.aceite!.contrato!.linkAssinatura!);
    doCliente.push('assina o contrato (dublê)');
    const doc = await prisma.comercialDocumento.findFirstOrThrow({ where: { leadId } });
    // D-1: o link da Root só existe cifrado no banco; quem assina pela Root o recebe decifrado.
    await assinar(decifrarLinkDaRoot(doc.linkRoot!, segredoDoAmbiente()!, doc.id)!);
    tocar('root', socio, 'assina o contrato pela Root (ZapSign)', 'o contrato tem dois signatários; a Root assina por um sócio');
    expect(await tipos()).toEqual(expect.arrayContaining(['pix.pago', 'contrato.assinado_cliente', 'contrato.assinado_root']));

    const f = await prisma.approval.findFirstOrThrow({ where: { orgId: ORG, capabilityId: CAP_FECHAMENTO, resourceId: `fech-${leadId}-v1` } });
    expect(f.nivelExigido).toBe('R4');
    await confirmar('fechamento', f.id, 'o fechamento cria cliente, contrato, cobrança, trilho e grupo (R4)');
    const tela = await naEmpresa(() => fechamento.doLead(ORG, leadId));
    expect(tela.estado, JSON.stringify(tela.escritas)).toBe('concluido');
    expect(tela.escritas).toHaveLength(5);
    expect(await etapa()).toBe('fechado');
  });

  it('9 · o contrato vivo traz as parcelas e o funil conta o lead em "fechado"', async () => {
    const vivo = await naEmpresa(() => contratoVivo.doLead(ORG, leadId));
    expect(vivo.parcelas.map((x) => x.estado)).toEqual(['paga', 'pendente', 'pendente']);
    const funil = await naEmpresa(() => fichas.funil(ORG, null));
    const fechados = funil.colunas.find((c) => c.etapa === 'fechado')!.cartoes;
    expect(fechados.map((c) => c.leadId)).toEqual([leadId]);
    expect((await sala.estado(token)).estagio).toBe('comeco');
  });

  it(`10 · os toques humanos medidos: ${TOQUES_MEDIDOS} (3 do desenho + 10 da régua de hoje)`, () => {
    console.info(`[jornada] ${toques.length} toques humanos:\n${toques.map((t) => `  ${t.n}. ${t.quem} · ${t.acao} · ${t.porque}`).join('\n')}`);
    console.info(`[jornada] ${doCliente.length} ações do cliente: ${doCliente.join('; ')}`);
    expect(toques.map((t) => t.chave)).toEqual(['M1', 'M2', 'M3', 'sessao', 'diagnostico', 'quadro', 'proposta', 'M4', 'ajuste', 'cobranca', 'contrato', 'root', 'fechamento']);
    // Os R4 do dinheiro são sempre da titular, com senha e motivo.
    for (const t of toques.filter((x) => ['cobranca', 'contrato', 'fechamento'].includes(x.chave))) expect(t).toMatchObject({ quem: titular.nome, acao: expect.stringMatching(/^assina .* \(R4\)$/) });
    expect(toques).toHaveLength(TOQUES_MEDIDOS);
  });
});
