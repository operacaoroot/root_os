import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClienteFechadoForaSchema, RECUSA_SEM_MODELO_DE_CONTRATO, type ComercialEtapa } from '@mktos/shared';

import { ApprovalsService } from '../src/approvals/approvals.service';
import { AuditService } from '../src/audit/audit.service';
import type { ArquivistaDoClientePort, PastaDoClientePort, PedidoDeArquivo, PedidoDePasta, ResultadoDaPasta, ResultadoDoArquivo } from '../src/clientes/portas';
import { comContexto } from '../src/common/contexto-execucao';
import { AssinadoNaPastaService } from '../src/comercial/assinado-na-pasta.service';
import { SimuladoProvider } from '../src/comercial/canais/simulado.provider';
import { ConfigComercialService } from '../src/comercial/config.service';
import { ContratoDaRootService } from '../src/comercial/contrato-da-root/contrato-da-root.service';
import { DecisoesRegistry, DecisoesService } from '../src/comercial/decisoes.service';
import { DinheiroService } from '../src/comercial/dinheiro.service';
import { camposDaDeclaracao, payloadDaDeclaracao } from '../src/comercial/fechado-fora';
import { FechamentoService } from '../src/comercial/fechamento.service';
import { FichaService } from '../src/comercial/ficha.service';
import { FioService, ReacoesRegistry } from '../src/comercial/fio.service';
import { OnboardingAntecipadoService } from '../src/comercial/onboarding-antecipado.service';
import { lerWebhookDaZapsign, type PortaDeAssinatura } from '../src/comercial/portas/assinatura.port';
import type { PortaDeCobranca } from '../src/comercial/portas/cobranca.port';
import { RelogioComercialRegistry } from '../src/comercial/relogio.registry';
import { SalaService } from '../src/comercial/sala.service';
import { VigiaService } from '../src/comercial/vigia.service';
import { WhatsappComercialService } from '../src/comercial/whatsapp.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { EventLogService } from '../src/gateway/event-log.service';
import { InterruptoresRegistry } from '../src/gateway/interruptores.registry';
import { PortaDoOperador } from '../src/gateway/porta-do-operador.service';
import { ToolGateway } from '../src/gateway/tool-gateway.service';
import { leituraDoArquivo } from '../src/google/drive-das-atas';
import { ConectoresService } from '../src/integrations/conectores.service';
import { StubProvider } from '../src/llm/stub.provider';
import type { MemoriaService } from '../src/memory/memoria.service';
import { TrilhoService } from '../src/onboarding/trilho/trilho.service';
import { PolicyService } from '../src/policy/policy.service';
import { SinaisService } from '../src/policy/sinais.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * O CONTRATO E A PASTA DO CLIENTE NA RODADA DOS AGENTES (21/10/2026, lane A2), contra o Postgres.
 *
 *   · CO-10, a 7ª escrita `pasta` do fechamento, com um dublê da porta da pasta:
 *     pronta (e idempotente pelo ponteiro: rodar de novo não chama a porta),
 *     aguardando aprovação, erro (o fechamento conclui mesmo assim, com o motivo à
 *     vista) e sem raiz; e o "Iniciar onboarding" pedindo a mesma pasta;
 *   · CO-08, o webhook da ZapSign com as duas assinaturas: o fato
 *     `contrato.assinado` e a cópia do PDF para `02-contrato` pelo arquivista;
 *     arquivista "ainda não ligado" e PDF que não vem ficam registrados, sem cair;
 *   · CO-13 e CO-14, a minuta e o laudo: sem a nota, a recusa exata; com o modelo
 *     lido do Drive PELA PORTA (dublê dos efeitos R0), a minuta conferida (a
 *     inserção inventada e o número sem fonte viram lacuna), rascunho no OS que a
 *     ficha não confunde com contrato de assinatura, a cópia em `02-contrato` e o
 *     laudo com as regras e o modelo (o trecho inventado sai);
 *   · CO-11, o resumo do vigia pelo stub, com o número inventado descartado.
 *
 * Dados fictícios; nenhuma chamada real de rede.
 */

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (leads, fichas, fechamentos, documentos, cards, trilhos, Partner, fio e auditoria)');

const MARCA = `a2c${Date.now().toString(36).slice(-6)}`;
const ORG = `org-a2-contrato-${MARCA}`;
const PASTA_DO_STUB = resolve(__dirname, '../../../homolog/fixtures/stub');
const ID_DO_MODELO = 'ArquivoDoModelo0001';
const ID_DA_PASTA = 'PastaDosContratos01';
const MODELO_SINTETICO = [
  '# CONTRATO DE PRESTAÇÃO DE SERVIÇOS',
  '',
  'CONTRATANTE: ________________, inscrita no CNPJ sob o nº ________________.',
  '',
  'CONTRATADA: Operação Root, ________________.',
  '',
  '1. OBJETO',
  '',
  '1.1. A CONTRATADA presta o serviço ________________.',
  '',
  '2. PREÇO',
  '',
  '2.1. Valor total de R$ ________ (________), em ____ parcelas.',
  '',
  '3. PRAZO',
  '',
  '3.1. O contrato vale por ________ a partir da assinatura, conforme a cláusula 2.1.',
].join('\n');

describe.skipIf(!URL)('o contrato e a pasta do cliente dos agentes do comercial, contra o Postgres', { timeout: 60_000 }, () => {
  let prisma: PrismaClient;
  let fio: FioService;
  let fechamento: FechamentoService;
  let dinheiro: DinheiroService;
  let antecipado: OnboardingAntecipadoService;
  let contrato: ContratoDaRootService;
  let euId = '';
  const notas: Record<string, string> = {};
  const pedidosDePasta: PedidoDePasta[] = [];
  let respostaDaPasta: (p: PedidoDePasta) => Promise<ResultadoDaPasta> = async () => ({ estado: 'erro', motivo: 'não configurado' });
  const arquivados: PedidoDeArquivo[] = [];
  let respostaDoArquivista: (p: PedidoDeArquivo) => Promise<ResultadoDoArquivo> = async (p) => ({ estado: 'enviado', subpasta: p.subpasta ?? '_fonte', nome: 'arquivo.pdf', arquivoId: 'arq-1', url: 'https://drive.example/arq-1' });
  let pdfAssinado: Buffer | null = Buffer.from('%PDF-1.7 contrato assinado de teste');
  const arquivosNoDrive: { id: string; name: string; mimeType: string }[] = [];
  let pastasDoModelo = [ID_DA_PASTA];

  const naEmpresa = <T>(fn: () => Promise<T>): Promise<T> => comContexto({ orgId: ORG, correlationId: `a2c-${MARCA}`, origem: 'http' }, fn);
  let seq = 0;

  async function lead(nome: string, etapa: ComercialEtapa = 'proposta', phone = `55329${String(Date.now() + ++seq).slice(-8)}`) {
    const l = await prisma.lead.create({ data: { orgId: ORG, name: nome, phone }, select: { id: true } });
    await prisma.comercialFicha.create({ data: { leadId: l.id, etapa, empresa: nome, perfil: 'P2' } });
    return l.id;
  }

  /** O lead fecha pela declaração (o caminho mais curto do mesmo fechamento). */
  async function declararAceite(leadId: string, razaoSocial: string, cnpj: string, extra: Partial<{ produto: string; valorCentavos: number; parcelas: number; forma: string }> = {}) {
    const input = ClienteFechadoForaSchema.parse({
      razaoSocial, cnpj, quemAssina: 'Maria Exemplo', email: `maria-${MARCA}-${seq}@exemplo.test`, telefone: '(32) 99999-0101', endereco: 'Rua das Flores, 100, Centro',
      produto: extra.produto ?? 'operacao', valorCentavos: extra.valorCentavos ?? 1_199_700, parcelas: extra.parcelas ?? 3, forma: extra.forma ?? 'boleto',
      assinadoEm: '2026-10-01', primeiroVencimento: '2026-10-10', motivoSemCobranca: 'boleto do banco',
    });
    const sha = createHash('sha256').update(`pdf-${MARCA}-${leadId}`).digest('hex');
    const payload = payloadDaDeclaracao(camposDaDeclaracao(input, sha), 1, { id: euId, nome: 'Rodrigo Exemplo' });
    await fio.registrar(ORG, leadId, 'contrato.anexado', sha, { nome: 'c.pdf', bytes: 10, tipo: 'application/pdf', sha256: sha, chave: `x/${sha}`, assinadoEm: '2026-10-01', procedencia: 'teste', por: 'Rodrigo Exemplo' });
    await fio.registrar(ORG, leadId, 'aceite.declarado', String(payload.hash), payload);
    return (await naEmpresa(() => fechamento.aceiteParaFechar(ORG, leadId)))!;
  }

  const cnpjNovo = () => `8${(Date.now() + ++seq).toString().slice(-13)}`;
  const escrita = (tela: { escritas: { escrita: string; estado: string; detalhe: string; ref: string | null }[] }, qual: string) => tela.escritas.find((e) => e.escrita === qual)!;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    const p = prisma as unknown as PrismaService;
    await prisma.org.create({ data: { id: ORG, name: `Agentes A2 contrato ${MARCA}`, slug: `a2-contrato-${MARCA}` } });
    for (const key of ['leads.editar', 'tarefas.editar']) await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
    const admin = await prisma.role.create({ data: { orgId: ORG, key: 'admin_master', name: 'Admin', permissions: { connect: [{ key: 'leads.editar' }, { key: 'tarefas.editar' }] } }, select: { id: true } });
    euId = (await prisma.user.create({ data: { orgId: ORG, email: `rodrigo-${MARCA}@a2.teste`, name: 'Rodrigo Exemplo', passwordHash: await bcrypt.hash('x', 4), roles: { connect: { id: admin.id } } }, select: { id: true } })).id;

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
    // O Drive da Root, dublê dos dois efeitos R0 que o construtor usa (o Google de verdade não está aqui).
    efeitos.registrar(
      {
        'contexto.arquivo.listar': async (args) => arquivosNoDrive.filter((f) => !args.pasta || f.id === ID_DO_MODELO),
        'contexto.arquivo.ler': async (args) =>
          leituraDoArquivo({ id: String(args.id), nome: 'Contrato Root v1', mimeType: 'application/vnd.google-apps.document', modificadoEm: null, link: null, pastas: pastasDoModelo, bytes: null, texto: MODELO_SINTETICO }),
      },
      'test/dublê do Drive',
    );

    const reacoes = new ReacoesRegistry();
    fio = new FioService(p, reacoes);
    const relogio = new RelogioComercialRegistry();
    const sala = new SalaService(p, fio, reacoes);
    sala.onModuleInit();
    const whats = new WhatsappComercialService(p, fio, reacoes, relogio, sala, efeitos, porta, new SimuladoProvider());
    whats.onModuleInit();
    const config = new ConfigComercialService(p);
    const registroDeDecisoes = new DecisoesRegistry();
    const decisoes = new DecisoesService(p, fio, config, registroDeDecisoes);
    const fichas = new FichaService(p, fio, config);
    const naoChamar = new Proxy({} as PortaDeCobranca, { get: (_a, chave) => (chave === 'provedor' ? 'asaas' : chave === 'configurada' ? () => true : () => { throw new Error('a cobrança não deveria ser chamada'); }) });
    const assinatura: PortaDeAssinatura = {
      provedor: 'zapsign',
      configurada: () => true,
      criarDocumento: async () => { throw new Error('não chamar'); },
      enviarParaAssinar: async () => null,
      consultarEstado: async () => null,
      webhookAutentico: (t) => t === 'segredo-do-teste',
      interpretarWebhook: lerWebhookDaZapsign,
      baixarAssinado: async () => (pdfAssinado ? { buffer: pdfAssinado, tipoMime: 'application/pdf', bytes: pdfAssinado.length } : null),
    };
    dinheiro = new DinheiroService(p, fio, reacoes, efeitos, porta, naoChamar, assinatura, whats);
    dinheiro.onModuleInit();
    const trilhos = new TrilhoService(p, undefined as never, eventos, undefined as never);
    const pasta: PastaDoClientePort = {
      garantir: async (pedido) => {
        pedidosDePasta.push(pedido);
        return respostaDaPasta(pedido);
      },
    };
    fechamento = new FechamentoService(p, fio, reacoes, efeitos, porta, dinheiro, config, decisoes, registroDeDecisoes, trilhos, whats, relogio, undefined, pasta);
    fechamento.onModuleInit();
    antecipado = new OnboardingAntecipadoService(p, fio, reacoes, fichas, trilhos, pasta);
    antecipado.onModuleInit();
    const arquivista: ArquivistaDoClientePort = {
      arquivar: async (pedido) => {
        arquivados.push(pedido);
        return respostaDoArquivista(pedido);
      },
    };
    new AssinadoNaPastaService(p, fio, reacoes, assinatura, arquivista).onModuleInit();
    const memoria = { porChave: async (_org: string, chave: string) => (notas[chave] ? { body: notas[chave] } : null) } as unknown as MemoriaService;
    contrato = new ContratoDaRootService(p, fio, memoria, porta, fechamento, new StubProvider(PASTA_DO_STUB), arquivista);
  }, 60_000);

  afterAll(async () => {
    if (!prisma) return;
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
    await prisma.comercialFechamento.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.comercialCobranca.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.comercialDocumento.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.comercialDecisao.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.comercialMensagem.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.comercialReacao.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.comercialFicha.deleteMany({ where: { leadId: { in: ids } } });
    await prisma.partner.deleteMany({ where: { orgId: ORG } });
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

  // -------------------------------------------------------------------------
  // CO-10 · a 7ª escrita
  // -------------------------------------------------------------------------

  it('CO-10 pronta: a 7ª escrita pede a pasta DEPOIS do card, com a origem do fechado-fora; rodar de novo reaproveita pelo ponteiro sem chamar a porta', async () => {
    const leadId = await lead('Padaria Sete Escritas');
    const a = await declararAceite(leadId, 'Padaria Sete Escritas Ltda', cnpjNovo());
    respostaDaPasta = async (p) => {
      await prisma.partner.update({ where: { id: p.partnerId }, data: { pastaDriveId: `pasta-${p.partnerId.slice(0, 8)}`, pastaDriveUrl: `https://drive.example/${p.partnerId.slice(0, 8)}` } });
      return { estado: 'pronta', pastaId: `pasta-${p.partnerId.slice(0, 8)}`, url: `https://drive.example/${p.partnerId.slice(0, 8)}`, ligada: false };
    };
    const antes = pedidosDePasta.length;
    const tela = await naEmpresa(() => fechamento.executar(ORG, leadId, a));
    expect(tela.estado).toBe('concluido');
    expect(tela.escritas.map((e) => e.escrita)).toEqual(['cliente', 'contrato', 'cobranca', 'kit_e_trilho', 'card', 'grupo', 'pasta']);
    expect(escrita(tela, 'pasta')).toMatchObject({ estado: 'criado', onde: 'Google Drive' });
    expect(pedidosDePasta.slice(antes)).toHaveLength(1);
    const ficha = await prisma.comercialFicha.findUniqueOrThrow({ where: { leadId } });
    expect(pedidosDePasta.at(-1)).toEqual({ orgId: ORG, partnerId: ficha.partnerId, origem: 'fechado-fora', leadId });

    await prisma.comercialFechamento.updateMany({ where: { leadId }, data: { estado: 'erro', escritas: [] } });
    const segunda = await naEmpresa(() => fechamento.executar(ORG, leadId, a));
    expect(escrita(segunda, 'pasta')).toMatchObject({ estado: 'reaproveitado', detalhe: 'a pasta já estava ligada ao cliente' });
    expect(pedidosDePasta.slice(antes)).toHaveLength(1);
    // A ficha do comercial mostra o ponteiro (o componente "Abrir pasta do cliente").
    const projecao = await naEmpresa(() => new FichaService(prisma as unknown as PrismaService, fio, new ConfigComercialService(prisma as unknown as PrismaService)).projecao(ORG, leadId));
    expect(projecao.pasta).toEqual({ partnerId: ficha.partnerId, url: expect.stringContaining('https://drive.example/'), erro: null });
  });

  it('CO-10 aguardando: a porta reteve (R3) e a escrita diz isso, com a aprovação; o fechamento conclui', async () => {
    const leadId = await lead('Mercado Aguardando');
    const a = await declararAceite(leadId, 'Mercado Aguardando Ltda', cnpjNovo());
    respostaDaPasta = async () => ({ estado: 'aguardando_aprovacao', approvalId: 'ap-pasta-1' });
    const tela = await naEmpresa(() => fechamento.executar(ORG, leadId, a));
    expect(tela.estado).toBe('concluido');
    expect(escrita(tela, 'pasta')).toMatchObject({ estado: 'aguardando_aprovacao', ref: 'ap-pasta-1' });
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'cliente.ativo' } })).toBe(1);
  });

  it('CO-10 erro: o Drive falha, a escrita fica em erro com o motivo e o fechamento conclui mesmo assim (cliente ativo)', async () => {
    const leadId = await lead('Ótica Drive Fora');
    const a = await declararAceite(leadId, 'Ótica Drive Fora Ltda', cnpjNovo());
    respostaDaPasta = async () => ({ estado: 'erro', motivo: 'o Drive respondeu 500' });
    const tela = await naEmpresa(() => fechamento.executar(ORG, leadId, a));
    expect(tela.estado).toBe('concluido');
    expect(escrita(tela, 'pasta')).toMatchObject({ estado: 'erro', detalhe: 'o Drive respondeu 500' });
    expect(['cliente', 'contrato', 'card'].map((k) => escrita(tela, k).estado).every((e) => e !== 'erro')).toBe(true);
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'cliente.ativo' } })).toBe(1);
    const linha = await prisma.comercialFechamento.findFirstOrThrow({ where: { leadId } });
    expect(linha.erro).toContain('pasta: o Drive respondeu 500');
  });

  it('CO-10 sem raiz: a escrita fica pulada com o motivo', async () => {
    const leadId = await lead('Pet Sem Raiz');
    const a = await declararAceite(leadId, 'Pet Sem Raiz Ltda', cnpjNovo());
    respostaDaPasta = async () => ({ estado: 'sem_raiz', motivo: 'a nota clientes.pasta.raiz não existe' });
    const tela = await naEmpresa(() => fechamento.executar(ORG, leadId, a));
    expect(escrita(tela, 'pasta')).toMatchObject({ estado: 'pulado', detalhe: 'sem a raiz dos clientes no Drive: a nota clientes.pasta.raiz não existe' });
  });

  it('CO-10 iniciar onboarding: a mesma porta, origem onboarding-antecipado, em nome de quem iniciou; o resultado vai ao fio', async () => {
    const leadId = await lead('Auto Peças Antes');
    respostaDaPasta = async () => ({ estado: 'aguardando_aprovacao', approvalId: 'ap-pasta-2' });
    const r = await naEmpresa(() => antecipado.iniciar(ORG, leadId, {}, { id: euId, nome: 'Rodrigo Exemplo', papeis: ['admin_master'] }));
    expect(r.estado).toBe('criado');
    expect(r.pasta).toEqual({ estado: 'aguardando_aprovacao', approvalId: 'ap-pasta-2', motivo: expect.stringContaining('/atendimento') });
    expect(pedidosDePasta.at(-1)).toEqual({ orgId: ORG, partnerId: r.partnerId, origem: 'onboarding-antecipado', leadId, atorId: euId });
    const fato = await prisma.leadEvent.findFirstOrThrow({ where: { leadId, type: 'pasta.do_cliente' } });
    expect(fato.payload).toMatchObject({ origem: 'onboarding-antecipado', estado: 'aguardando_aprovacao', approvalId: 'ap-pasta-2' });
  });

  // -------------------------------------------------------------------------
  // CO-08 · o PDF assinado em 02-contrato
  // -------------------------------------------------------------------------

  async function documentoNaZapsign(leadId: string, externoId: string) {
    await prisma.comercialDocumento.create({ data: { leadId, provedor: 'zapsign', externoId, estado: 'enviado', hashConteudo: `h-${externoId}` } });
  }
  const webhook = (externoId: string) => ({
    token: externoId,
    event_type: 'doc_signed',
    status: 'signed',
    signed_file: 'https://zapsign.example/assinado.pdf',
    signers: [
      { external_id: 'cliente', status: 'signed', signed_at: '2026-10-21T10:00:00Z' },
      { external_id: 'root', status: 'signed', signed_at: '2026-10-21T11:00:00Z' },
    ],
  });

  it('CO-08: as duas assinaturas viram `contrato.assinado`, e o PDF vai a 02-contrato pelo arquivista (a URL do provedor fica no documento)', async () => {
    const leadId = await lead('Café Assinado');
    const ext = `zap-${MARCA}-1`;
    await documentoNaZapsign(leadId, ext);
    const antes = arquivados.length;
    const r = await dinheiro.webhookDaZapsign('segredo-do-teste', webhook(ext));
    expect(r.ok).toBe(true);
    const doc = await prisma.comercialDocumento.findFirstOrThrow({ where: { leadId, externoId: ext } });
    expect([doc.estado, doc.pdfUrl]).toEqual(['assinado', 'https://zapsign.example/assinado.pdf']);
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'contrato.assinado' } })).toBe(1);
    expect(arquivados.slice(antes)).toHaveLength(1);
    expect(arquivados.at(-1)).toMatchObject({ orgId: ORG, leadId, partnerId: null, origem: 'contrato-assinado', subpasta: '02-contrato', tipoMime: 'application/pdf' });
    const fato = await prisma.leadEvent.findFirstOrThrow({ where: { leadId, type: 'documento.na_pasta' } });
    expect(fato.payload).toMatchObject({ origem: 'contrato-assinado', estado: 'enviado', subpasta: '02-contrato' });
    // A reentrega do webhook não copia de novo.
    await dinheiro.webhookDaZapsign('segredo-do-teste', webhook(ext));
    expect(arquivados.slice(antes)).toHaveLength(1);
  });

  it('CO-08: arquivista "ainda não ligado" e PDF que não vem ficam registrados com o motivo, sem derrubar o webhook', async () => {
    const l1 = await lead('Studio Não Ligado');
    respostaDoArquivista = async () => ({ estado: 'so_no_os', motivo: 'o arquivista ainda não está ligado nesta versão' });
    await documentoNaZapsign(l1, `zap-${MARCA}-2`);
    await expect(dinheiro.webhookDaZapsign('segredo-do-teste', webhook(`zap-${MARCA}-2`))).resolves.toMatchObject({ ok: true });
    expect((await prisma.leadEvent.findFirstOrThrow({ where: { leadId: l1, type: 'documento.na_pasta' } })).payload).toMatchObject({ estado: 'so_no_os', motivo: 'o arquivista ainda não está ligado nesta versão' });

    const l2 = await lead('Rede Sem PDF');
    pdfAssinado = null;
    try {
      await documentoNaZapsign(l2, `zap-${MARCA}-3`);
      await expect(dinheiro.webhookDaZapsign('segredo-do-teste', webhook(`zap-${MARCA}-3`))).resolves.toMatchObject({ ok: true });
      expect((await prisma.leadEvent.findFirstOrThrow({ where: { leadId: l2, type: 'documento.na_pasta' } })).payload).toMatchObject({ estado: 'erro', motivo: expect.stringContaining('não devolveu o PDF assinado') });
      expect(await prisma.comercialReacao.count({ where: { leadId: l2, estado: 'erro' } })).toBe(0);
    } finally {
      pdfAssinado = Buffer.from('%PDF-1.7 contrato assinado de teste');
      respostaDoArquivista = async (p) => ({ estado: 'enviado', subpasta: p.subpasta ?? '_fonte', nome: 'arquivo.pdf', arquivoId: 'arq-1', url: 'https://drive.example/arq-1' });
    }
  });

  // -------------------------------------------------------------------------
  // CO-13 e CO-14 · a minuta e o laudo
  // -------------------------------------------------------------------------

  it('CO-13 sem a nota do modelo: recusa com a frase exata, sem ler o Drive', async () => {
    const leadId = await lead('Padaria Sem Modelo');
    await declararAceite(leadId, 'Padaria Sem Modelo Ltda', cnpjNovo());
    const erro = await naEmpresa(() => contrato.gerar(ORG, leadId, { id: euId, nome: 'Rodrigo Exemplo' })).catch((e) => e);
    expect(erro).toBeInstanceOf(BadRequestException);
    expect((erro as BadRequestException).message).toBe(RECUSA_SEM_MODELO_DE_CONTRATO);
    expect(await prisma.toolCall.count({ where: { orgId: ORG, capabilityId: { startsWith: 'contexto.arquivo' } } })).toBe(0);
  });

  it('CO-13: sem proposta aceita não há minuta (409); arquivo que não está no Drive é 404; dois com o mesmo nome sem a pasta é 409', async () => {
    notas['comercial.contrato.modelo'] = 'Contrato Root v1';
    const semAceite = await lead('Sem Aceite');
    await expect(naEmpresa(() => contrato.gerar(ORG, semAceite, { id: euId, nome: null }))).rejects.toBeInstanceOf(ConflictException);
    const leadId = await lead('Mercearia Drive');
    await declararAceite(leadId, 'Mercearia Drive Ltda', cnpjNovo());
    arquivosNoDrive.length = 0;
    await expect(naEmpresa(() => contrato.gerar(ORG, leadId, { id: euId, nome: null }))).rejects.toBeInstanceOf(NotFoundException);
    arquivosNoDrive.push({ id: ID_DO_MODELO, name: 'Contrato Root v1', mimeType: 'application/vnd.google-apps.document' }, { id: 'OutroArquivo00001', name: 'contrato root v1.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    await expect(naEmpresa(() => contrato.gerar(ORG, leadId, { id: euId, nome: null }))).rejects.toBeInstanceOf(ConflictException);
    // Com a pasta na segunda linha da nota, o arquivo tem de estar nela.
    notas['comercial.contrato.modelo'] = `Contrato Root v1\n${ID_DA_PASTA}`;
    pastasDoModelo = ['OutraPasta00000001'];
    await expect(naEmpresa(() => contrato.gerar(ORG, leadId, { id: euId, nome: null }))).rejects.toBeInstanceOf(NotFoundException);
    pastasDoModelo = [ID_DA_PASTA];
  });

  it('CO-13 e CO-14: o modelo lido do Drive pela porta vira minuta conferida, rascunho no OS, cópia em 02-contrato e laudo das regras e do modelo', async () => {
    notas['comercial.contrato.modelo'] = `Contrato Root v1\n${ID_DA_PASTA}`;
    const leadId = await lead('Padaria Exemplo de Teste');
    await declararAceite(leadId, 'Padaria Exemplo de Teste Ltda', '11.222.333/0001-81', { produto: 'imersao', valorCentavos: 297_000, parcelas: 10, forma: 'pix' });
    const antes = arquivados.length;
    const m = await naEmpresa(() => contrato.gerar(ORG, leadId, { id: euId, nome: 'Rodrigo Exemplo' }));

    expect(m.origem).toBe('modelo');
    expect(m.modeloDoDrive).toMatchObject({ id: ID_DO_MODELO, pastaConferida: true });
    expect(m.conteudo).toContain('⟦inserido: Padaria Exemplo de Teste Ltda⟧');
    expect(m.conteudo).toContain('⟦lacuna: conferir "12 meses" (não veio da proposta nem da ficha)⟧');
    expect(m.conteudo).toContain('⟦lacuna: número "35" sem fonte⟧');
    expect(m.lacunas).toHaveLength(3);
    expect(m.avisos.join(' ')).toContain('12 meses');

    // O Drive foi lido pela porta, em nome de quem clicou (R0).
    const leituras = await prisma.toolCall.findMany({ where: { orgId: ORG, capabilityId: { in: ['contexto.arquivo.listar', 'contexto.arquivo.ler'] }, status: 'executado' }, select: { capabilityId: true, actorId: true } });
    expect(leituras.filter((l) => l.actorId === euId).map((l) => l.capabilityId)).toEqual(expect.arrayContaining(['contexto.arquivo.listar', 'contexto.arquivo.ler']));

    // Rascunho no OS, que a ficha NÃO confunde com contrato de assinatura.
    const doc = await prisma.comercialDocumento.findUniqueOrThrow({ where: { id: m.documentoId } });
    expect([doc.provedor, doc.estado, doc.conteudo]).toEqual(['minuta', 'rascunho', m.conteudo]);
    const ficha = await naEmpresa(() => new FichaService(prisma as unknown as PrismaService, fio, new ConfigComercialService(prisma as unknown as PrismaService)).projecao(ORG, leadId));
    expect(ficha.ligadoA.contrato).toBeNull();
    expect(await prisma.leadEvent.count({ where: { leadId, type: 'minuta.gerada' } })).toBe(1);

    // A cópia em 02-contrato.
    expect(arquivados.slice(antes)).toHaveLength(1);
    expect(arquivados.at(-1)).toMatchObject({ origem: 'minuta', subpasta: '02-contrato', tipoMime: 'text/markdown', leadId });
    expect((await prisma.leadEvent.findFirstOrThrow({ where: { leadId, type: 'documento.na_pasta' } })).payload).toMatchObject({ origem: 'minuta', estado: 'enviado' });

    // O laudo: lacunas pelas regras, o apontamento do modelo com trecho da minuta, o inventado fora.
    const laudo = m.laudo!;
    expect(laudo.porModelo).toBe(true);
    expect(laudo.apontamentos.filter((a) => a.regra === 'lacuna_aberta')).toHaveLength(3);
    expect(laudo.apontamentos.some((a) => a.regra === 'valor_por_extenso')).toBe(false);
    expect(laudo.apontamentos.find((a) => a.origem === 'modelo')).toMatchObject({ titulo: 'Prazo sem data de início escrita', trecho: 'a partir da assinatura' });
    expect(laudo.apontamentos.some((a) => a.titulo === 'Cláusula inventada')).toBe(false);
    expect(laudo.avisos.join(' ')).toContain('o trecho não está na minuta');
    expect(laudo.apontamentos[0].gravidade).toBe('alta');
    const gravado = await prisma.comercialDocumento.findUniqueOrThrow({ where: { id: m.documentoId } });
    expect((gravado.laudo as { apontamentos: unknown[] }).apontamentos).toHaveLength(laudo.apontamentos.length);
    expect((await prisma.leadEvent.findFirstOrThrow({ where: { leadId, type: 'minuta.revisada' } })).payload).toMatchObject({ altas: 3, porModelo: true });

    // A tela relê a minuta e o laudo.
    const tela = await naEmpresa(() => contrato.doLead(ORG, leadId));
    expect(tela?.documentoId).toBe(m.documentoId);
    expect(tela?.laudo?.apontamentos).toHaveLength(laudo.apontamentos.length);
    // Revisar de novo não reescreve a minuta.
    await naEmpresa(() => contrato.revisar(ORG, leadId));
    expect((await prisma.comercialDocumento.findUniqueOrThrow({ where: { id: m.documentoId } })).conteudo).toBe(m.conteudo);
  });

  it('CO-13 sem resposta útil do modelo: a minuta é a que o sistema preencheu, com o aviso', async () => {
    const leadId = await lead('Loja Sem Fixture');
    await declararAceite(leadId, 'Loja Sem Fixture Ltda', cnpjNovo());
    const m = await naEmpresa(() => contrato.gerar(ORG, leadId, { id: euId, nome: null }));
    expect(m.origem).toBe('sistema');
    expect(m.avisos.join(' ')).toContain('a minuta é a que o sistema preencheu sozinho');
    expect(m.conteudo).toBe(MODELO_SINTETICO);
    expect(m.laudo?.apontamentos.some((a) => a.regra === 'placeholder')).toBe(true);
  });

  // -------------------------------------------------------------------------
  // CO-11 · o resumo do vigia pelo stub
  // -------------------------------------------------------------------------

  it('CO-11: o resumo vem do stub pela função; a linha com o número que o vigia não contou é trocada pela do sistema', async () => {
    const vigia = new VigiaService(prisma as unknown as PrismaService, fio, {} as DecisoesService, {} as ConfigComercialService, new RelogioComercialRegistry(), {} as MemoriaService, new StubProvider(PASTA_DO_STUB));
    const premissa = (chave: string, ok: boolean | null) => ({ chave, automacao: null, premissa: chave, ok, detalhe: 'x', leads: ok === false ? ['l1'] : [] });
    const base = { dia: '2026-10-21', em: new Date().toISOString(), conferidas: 3, quebradas: 1, naoConferidas: 0, decisoesAbertas: 1, premissas: [premissa('a', false), premissa('b', true), premissa('c', true)] };
    const r = await vigia.resumir(ORG, base);
    expect(r.origem).toBe('misto');
    expect(r.linhas[0]).toBe('Algumas premissas quebraram na passagem de hoje.');
    expect(r.linhas[1]).toBe('Quebrou: a, tocando 1 lead(s).');
    expect(r.avisos.join(' ')).toContain('o número 7');
    const limpo = await vigia.resumir(ORG, { ...base, quebradas: 0, decisoesAbertas: 0, premissas: [premissa('b', true)] });
    expect(limpo.origem).toBe('modelo');
    expect(limpo.linhas[0]).toBe('O funil amanheceu conferido e de pé.');
    const semModelo = await new VigiaService(prisma as unknown as PrismaService, fio, {} as DecisoesService, {} as ConfigComercialService, new RelogioComercialRegistry(), {} as MemoriaService).resumir(ORG, base);
    expect(semModelo.origem).toBe('sistema');
  });
});

