import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { ActorType, AgentEstado, AgentTipo, ContextKind, ContextSource, EstadoDeAgente, PrismaClient, RiskLevel, SessionStatus } from '@prisma/client';
import { MARCO_DO_KIT, refDaAta } from '@mktos/shared';

import { AgentRuntime } from '../src/agents/agent-runtime.service';
import type { ContextBuilder } from '../src/agents/context-builder.service';
import { SessionService } from '../src/agents/session.service';
import { ApprovalsService } from '../src/approvals/approvals.service';
import { AuditService } from '../src/audit/audit.service';
import type { ArquivistaDoClientePort, PedidoDeArquivo, ResultadoDoArquivo } from '../src/clientes/portas';
import { comContexto } from '../src/common/contexto-execucao';
import { gravarReuniaoDoGranola, levarReuniaoDiretaParaFicha, reuniaoDoGranolaNaFicha } from '../src/ficha/granola.service';
import { EfeitosRegistry } from '../src/gateway/efeitos.registry';
import { EventLogService } from '../src/gateway/event-log.service';
import { ToolGateway } from '../src/gateway/tool-gateway.service';
import type { ChamadaParaTeto, LlmMessage, LlmProvider, LlmStepInput, LlmStepOutput } from '../src/llm/llm.provider';
import { StubProvider } from '../src/llm/stub.provider';
import { MemoriaService } from '../src/memory/memoria.service';
import { KitDoTrilhoService } from '../src/onboarding/trilho/kit/kit.service';
import { LeituraDaAtaService } from '../src/onboarding/trilho/leitura-da-ata.service';
import { TrilhoService } from '../src/onboarding/trilho/trilho.service';
import { PendenciasRegistry } from '../src/pendencias/pendencias.registry';
import { PendenciasService } from '../src/pendencias/pendencias.service';
import { PolicyService } from '../src/policy/policy.service';
import { ProcedenciaExterna, SinaisService } from '../src/policy/sinais.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ExecutoresDeRotinaRegistry } from '../src/routines/executores.registry';
import { AtasService } from '../src/work/atas/atas.service';
import { CheckoutDeTarefaService } from '../src/work/checkout-de-tarefa.service';
import { garantirRotinaDaCobranca, SLUG_DA_ROTINA_DE_COBRANCA } from '../src/work/cobranca/cobranca';
import { CobrancaDeTarefasService } from '../src/work/cobranca/cobranca.service';
import { DelegadorService } from '../src/work/delegador/delegador.service';
import { TriagemDaCaixaService } from '../src/work/triagem-da-caixa/triagem-da-caixa.service';
import { WorkService } from '../src/work/work.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * A LANE A3+TR DA RODADA DOS AGENTES (21/10/2026), contra o Postgres: o leitor de
 * ata grava `ata.notas` e manda a ata GERADA a 03-kickoff (IM-01); o pesquisador
 * pelo laço do agente, com e sem a nota da busca na web (IM-02); o kit (IM-07); o
 * aceite da ata transacional, sem tarefa órfã em corrida (TR-01); o Granola numa
 * entrada só (TR-02/03); o cobrador (TR-07); a triagem com cache (TR-08); o
 * delegador sem atribuição automática (TR-09). Modelos e arquivista são dublês.
 */

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (empresa, trilhos, tarefas, pendências, sugestões e agentes de teste)');

const RAIZ = join(__dirname, '../../..');
const PASTA_DO_STUB = join(RAIZ, 'homolog/fixtures/stub');
const ATA_EXEMPLO = readFileSync(join(RAIZ, 'homolog/fixtures/ata-kickoff-exemplo.md'), 'utf8');

const MARCA = `a3_${randomUUID().slice(0, 8)}`;
const ORG = `org-a3-${MARCA}`;
const EU = `u-a3-eu-${MARCA}`;
const MAQUINA = `u-a3-maq-${MARCA}`;
const quem = { id: EU, nome: 'Rodrigo Teste' };

const naEmpresa = <T>(fn: () => Promise<T>) =>
  comContexto({ orgId: ORG, actorType: ActorType.user, actorId: EU, correlationId: `teste-${MARCA}`, origem: 'script' }, fn);
const comoSistema = <T>(fn: () => Promise<T>) =>
  comContexto({ orgId: ORG, actorType: 'system', actorId: null, correlationId: `teste-${MARCA}`, origem: 'script' }, fn);

/** O arquivista de mentira: guarda o pedido e diz "enviado". */
class ArquivistaDuble implements ArquivistaDoClientePort {
  pedidos: PedidoDeArquivo[] = [];
  async arquivar(p: PedidoDeArquivo): Promise<ResultadoDoArquivo> {
    this.pedidos.push(p);
    return { estado: 'enviado', subpasta: p.subpasta ?? '_fonte', nome: p.nomeOriginal, arquivoId: `arq-${this.pedidos.length}`, url: 'https://drive.exemplo/arq' };
  }
}

/** Um modelo de mentira que responde pela função e guarda cada pedido. */
class ModeloDuble implements LlmProvider {
  readonly name = 'duble';
  readonly model = 'claude-sonnet-5-5';
  configured = true;
  supportsTools = true;
  buscaNaWeb = true;
  chamadas: LlmStepInput[] = [];
  respostas: Record<string, string> = {};
  async complete(_m: LlmMessage): Promise<string> {
    return '{}';
  }
  async step(input: LlmStepInput): Promise<LlmStepOutput> {
    this.chamadas.push(input);
    const texto = this.respostas[input.funcao ?? ''] ?? '{}';
    return {
      text: texto,
      toolCalls: [],
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, custoUsd: 0.001, custoEstimado: true, modeloServido: 'claude-sonnet-5-5' },
      raw: [],
    };
  }
  tetoDeSaida(c: ChamadaParaTeto): number {
    return c.maxTokens ?? 1000;
  }
}

const DOSSIE = JSON.stringify({
  afirmacoes: [{ texto: 'Vende pão para cafeterias', fonte: 'triagem', hipotese: false }],
  hipoteses: [],
  perguntasQueFaltam: ['Quantas encomendas por dia?'],
  perfilSugerido: 'P2',
  motivoDoPerfil: 'tem planilha',
});

describe.skipIf(!URL)('lane A3+TR contra o Postgres', () => {
  let prisma: PrismaClient;
  let p: PrismaService;
  let memoria: MemoriaService;
  let eventos: EventLogService;
  let audit: AuditService;
  let trilhos: TrilhoService;
  let work: WorkService;
  let stub: StubProvider;
  let listaId = '';
  let statusAberto = '';
  let statusKit = '';
  let clienteId = '';
  let pesquisadorId = '';

  async function novoCard(titulo: string, extra: Record<string, unknown> = {}) {
    return prisma.workTask.create({ data: { orgId: ORG, listId: listaId, statusId: statusAberto, title: titulo, ...extra }, select: { id: true } });
  }
  async function novoTrilho(dados: Record<string, unknown> = {}) {
    return prisma.onboardingTrilho.create({
      data: { orgId: ORG, cliente: 'Padaria Exemplo', slug: `padaria-${randomUUID().slice(0, 8)}`, ...dados },
      select: { id: true },
    });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    p = prisma as unknown as PrismaService;
    eventos = new EventLogService(prisma as never);
    audit = new AuditService(p);
    memoria = new MemoriaService(p, eventos);
    trilhos = new TrilhoService(p, memoria, eventos, undefined as never);
    work = new WorkService(p, audit, new CheckoutDeTarefaService(p, audit, eventos));
    stub = new StubProvider(PASTA_DO_STUB);

    await prisma.org.create({ data: { id: ORG, name: `A3 ${MARCA}`, slug: `a3-${MARCA}` } });
    await prisma.user.create({ data: { id: EU, orgId: ORG, name: 'Rodrigo Teste', email: `${EU}@teste.local`, passwordHash: 'x' } });
    const papel = await prisma.role.create({ data: { orgId: ORG, key: 'ia_acao', name: 'IA / Ação' } });
    await prisma.user.create({ data: { id: MAQUINA, orgId: ORG, name: 'IA Teste', email: `${MAQUINA}@teste.local`, passwordHash: 'x', roles: { connect: { id: papel.id } } } });
    const lista = await prisma.workList.create({
      data: {
        orgId: ORG, name: `Execução ${MARCA}`,
        statuses: { create: [{ name: 'A fazer', type: 'open', order: 0 }, { name: 'Kit montado', type: 'custom', order: 1 }, { name: 'Feito', type: 'closed', order: 2 }] },
      },
      include: { statuses: true },
    });
    listaId = lista.id;
    statusAberto = lista.statuses.find((s) => s.name === 'A fazer')!.id;
    statusKit = lista.statuses.find((s) => s.name === 'Kit montado')!.id;
    clienteId = (await prisma.partner.create({ data: { orgId: ORG, isCliente: true, razaoSocial: 'Padaria Exemplo Ltda', nomeFantasia: 'Padaria Exemplo' } })).id;
    pesquisadorId = (await prisma.agent.create({
      data: {
        orgId: ORG, slug: 'pesquisador-de-conta', nome: 'Pesquisador de conta', iniciais: 'PC', missao: 'dossiê', tipo: AgentTipo.llm,
        estado: EstadoDeAgente.ativo, autonomiaAte: RiskLevel.R1, capacidades: ['contexto.memoria.buscar', 'contexto.nota.ler'],
      },
      select: { id: true },
    })).id;
  });

  afterAll(async () => {
    const orgId = ORG;
    await prisma.delegacaoSugestao.deleteMany({ where: { orgId } });
    await prisma.ataSugestao.deleteMany({ where: { orgId } });
    await prisma.pendencia.deleteMany({ where: { orgId } });
    await prisma.reuniaoDoCartao.deleteMany({ where: { orgId } });
    await prisma.onboardingMarco.deleteMany({ where: { orgId } });
    await prisma.onboardingAta.deleteMany({ where: { orgId } });
    await prisma.onboardingItem.deleteMany({ where: { orgId } });
    await prisma.onboardingTrilho.deleteMany({ where: { orgId } });
    await prisma.rotina.deleteMany({ where: { orgId } });
    await prisma.$disconnect();
  });

  // ==========================================================================
  describe('IM-01 · o leitor de ata grava as notas e manda a ata GERADA a 03-kickoff', () => {
    it('com cliente: marco ata.notas, o arquivista com 03-kickoff/ata e sem a transcrição bruta', async () => {
      const card = await novoCard('Card da Padaria', { clienteId });
      const t = await novoTrilho({ cardId: card.id, kickoffEm: new Date('2026-10-21T12:00:00Z') });
      const arquivista = new ArquivistaDuble();
      const leitura = new LeituraDaAtaService(stub, trilhos, p, memoria, undefined, arquivista);
      const r = await naEmpresa(() => leitura.lerAta(ORG, t.id, { tipo: 'texto', texto: ATA_EXEMPLO }, quem));
      expect(r.leitura.notas.map((n) => n.id)).toEqual(['encomendas-do-whatsapp', 'planilha-e-caixa']);
      const marco = await prisma.onboardingMarco.findFirst({ where: { trilhoId: t.id, tipo: 'ata.notas' } });
      expect((marco?.dados as { notas: { id: string }[] }).notas.map((n) => n.id)).toEqual(['encomendas-do-whatsapp', 'planilha-e-caixa']);
      expect(arquivista.pedidos).toHaveLength(1);
      const pedido = arquivista.pedidos[0];
      expect(pedido).toMatchObject({ orgId: ORG, partnerId: clienteId, origem: 'ata', subpasta: '03-kickoff', tipoMime: 'text/markdown' });
      const md = (pedido.conteudo as { buffer: Buffer }).buffer.toString('utf8');
      expect(md).toContain('## O que ficou da conversa');
      // A fala que não virou trecho não sai do OS: a transcrição bruta não vai ao Drive.
      expect(md).not.toContain('Vamos começar');
      expect(md).not.toContain('Quem decide compra de farinha');
      const lida = await prisma.onboardingMarco.findFirst({ where: { trilhoId: t.id, tipo: 'ata.lida' } });
      expect((lida?.dados as { copiaNoDrive: { estado: string } }).copiaNoDrive.estado).toBe('enviado');
      // A teia e a carga da memória leem o marco que o leitor gravou.
      expect((await prisma.onboardingAta.findFirst({ where: { trilhoId: t.id } }))?.hash).toHaveLength(64);
    });

    it('sem cliente ligado: a leitura segue, a cópia diz "sem_cliente" e o arquivista não é chamado', async () => {
      const t = await novoTrilho();
      const arquivista = new ArquivistaDuble();
      const leitura = new LeituraDaAtaService(stub, trilhos, p, memoria, undefined, arquivista);
      await naEmpresa(() => leitura.lerAta(ORG, t.id, { tipo: 'texto', texto: ATA_EXEMPLO }, quem));
      expect(arquivista.pedidos).toHaveLength(0);
      const lida = await prisma.onboardingMarco.findFirst({ where: { trilhoId: t.id, tipo: 'ata.lida' } });
      expect((lida?.dados as { copiaNoDrive: { estado: string } }).copiaNoDrive.estado).toBe('sem_cliente');
    });
  });

  // ==========================================================================
  describe('IM-02 · o pesquisador pelo laço do agente, com e sem a nota da busca na web', () => {
    let runtime: AgentRuntime;
    let modelo: ModeloDuble;
    beforeAll(async () => {
      vi.setSystemTime(new Date('2026-10-21T14:00:00-03:00'));
      modelo = new ModeloDuble();
      modelo.respostas['IM-02'] = DOSSIE;
      const policy = new PolicyService(p);
      await policy.onModuleInit();
      const gateway = new ToolGateway(p, policy, new SinaisService(p, policy), new ApprovalsService(p, audit), eventos);
      const contexto = { montar: async () => ({ blocos: '', fontes: [], procedencia: new ProcedenciaExterna() }) } as unknown as ContextBuilder;
      const registro = new EfeitosRegistry();
      registro.registrar({ 'contexto.memoria.buscar': async () => ({ items: [] }), 'contexto.nota.ler': async () => ({}) });
      runtime = new AgentRuntime(modelo, p, policy, gateway, contexto, new SessionService(p), registro);
    });
    afterAll(() => vi.useRealTimers());

    const gerar = async (m: LlmProvider) => {
      const t = await novoTrilho();
      const leitura = new LeituraDaAtaService(m, trilhos, p, memoria, runtime);
      const d = await comoSistema(() => leitura.gerarDossie(ORG, t.id, 'site da padaria', { id: null, nome: 'Rodrigo' }));
      return { t, d };
    };

    it('sem a nota: passa pelo laço (sessão do agente), com a função IM-02 e SEM busca na web', async () => {
      modelo.chamadas = [];
      const { t, d } = await gerar(modelo);
      expect(d.perfilSugerido).toBe('P2');
      expect(modelo.chamadas).toHaveLength(1);
      expect(modelo.chamadas[0].funcao).toBe('IM-02');
      expect(modelo.chamadas[0].servidor).toBeUndefined();
      expect(modelo.chamadas[0].tools?.length).toBeGreaterThan(0);
      const sessao = await prisma.session.findFirst({ where: { orgId: ORG, agentId: pesquisadorId }, orderBy: { criadaEm: 'desc' } });
      expect(sessao?.status).toBe(SessionStatus.respondida);
      const marco = await prisma.onboardingMarco.findFirst({ where: { trilhoId: t.id, tipo: 'dossie.gerado' } });
      expect(marco?.dados).toMatchObject({ via: 'laco', buscaNaWeb: false });
    });

    it('com a nota "ligada" e o provedor que busca: a ferramenta de servidor vai, com o teto de usos', async () => {
      await comoSistema(() =>
        memoria.criar(ORG, { chave: 'onboarding.pesquisa.web', title: 'Pesquisa na web do onboarding', body: 'ligada', kind: ContextKind.regra, sourceType: ContextSource.operador }),
      );
      modelo.chamadas = [];
      const { t } = await gerar(modelo);
      expect(modelo.chamadas[0].servidor).toEqual({ buscaNaWeb: { maxUsos: 5 } });
      expect(modelo.chamadas[0].turns[0].role === 'user' && modelo.chamadas[0].turns[0].text).toContain('Você pode buscar na web');
      const marco = await prisma.onboardingMarco.findFirst({ where: { trilhoId: t.id, tipo: 'dossie.gerado' } });
      expect(marco?.dados).toMatchObject({ via: 'laco', buscaNaWeb: true });
    });

    it('nota ligada, mas o provedor não busca: nada de ferramenta de servidor', async () => {
      modelo.buscaNaWeb = false;
      modelo.chamadas = [];
      await gerar(modelo);
      expect(modelo.chamadas[0].servidor).toBeUndefined();
      modelo.buscaNaWeb = true;
    });

    it('provedor que não chama ferramenta (o stub): cai na chamada direta, com a marca do stub', async () => {
      const { t, d } = await gerar(stub);
      expect(d.perfilSugerido).toBe('P2');
      const marco = await prisma.onboardingMarco.findFirst({ where: { trilhoId: t.id, tipo: 'dossie.gerado' } });
      expect(marco?.dados).toMatchObject({ via: 'direta' });
    });
  });

  // ==========================================================================
  describe('IM-07 · o montador do kit', () => {
    it('card em "Kit montado" sem kit avisa; montar grava o marco e manda kit e índice a 03-kickoff', async () => {
      const card = await prisma.workTask.create({ data: { orgId: ORG, listId: listaId, statusId: statusKit, title: 'Card do kit', clienteId }, select: { id: true } });
      const t = await novoTrilho({ cardId: card.id, observacoes: 'Produto: Imersão.\nDor: conferir encomendas à mão.' });
      const arquivista = new ArquivistaDuble();
      const kits = new KitDoTrilhoService(stub, p, trilhos, arquivista);
      const antes = await kits.doCard(ORG, t.id);
      expect(antes).toMatchObject({ etapaDoCard: 'Kit montado', kit: null, avisoSemKit: true, cliente: { partnerId: clienteId, pastaUrl: null } });
      const kit = await naEmpresa(() => kits.montar(ORG, t.id, quem));
      expect(kit.secoes).toHaveLength(6);
      expect(kit.copia.estado).toBe('enviado');
      expect(arquivista.pedidos.map((x) => [x.subpasta, x.origem, x.nomeOriginal])).toEqual([
        ['03-kickoff', 'kit', 'kit-padaria-exemplo.md'],
        ['03-kickoff', 'kit', 'indice-do-kit-padaria-exemplo.md'],
      ]);
      const marco = await prisma.onboardingMarco.findFirst({ where: { trilhoId: t.id, tipo: MARCO_DO_KIT } });
      expect((marco?.dados as { kit: string }).kit).toContain('## O que foi contratado (manifesto do fechamento)');
      const depois = await kits.doCard(ORG, t.id);
      expect(depois.avisoSemKit).toBe(false);
      expect(depois.kit?.arquivo).toBe('kit-padaria-exemplo.md');
    });

    it('sem manifesto e sem contexto: recusa antes de gastar modelo', async () => {
      const t = await novoTrilho();
      const kits = new KitDoTrilhoService(stub, p, trilhos, new ArquivistaDuble());
      await expect(naEmpresa(() => kits.montar(ORG, t.id, quem))).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ==========================================================================
  describe('TR-01 · o aceite da ata cria a tarefa na mesma transação', () => {
    let atas: AtasService;
    let arquivista: ArquivistaDuble;
    let ataRef = '';
    const gente = { id: EU, papeis: [] as string[] };
    beforeAll(async () => {
      arquivista = new ArquivistaDuble();
      atas = new AtasService(p, memoria, work, audit, stub, undefined, arquivista);
      const nota = await comoSistema(() =>
        memoria.criar(ORG, { chave: `ata:2026-10-21-${MARCA}`, title: 'Reunião de teste', body: 'Ata de teste. Marina vai enviar o relatório.', kind: ContextKind.nota, sourceType: ContextSource.operador }),
      );
      ataRef = refDaAta('colada', nota.id);
    });
    const sugestao = () =>
      prisma.ataSugestao.create({ data: { orgId: ORG, ataRef, titulo: `Enviar o relatório ${randomUUID().slice(0, 6)}`, trecho: 'Marina vai enviar o relatório.', listaId } });

    it('dois cliques ao mesmo tempo: uma tarefa, um 409, nenhuma sugestão aceita sem tarefa', async () => {
      const s = await sugestao();
      const r = await Promise.allSettled([
        naEmpresa(() => atas.aceitar(ORG, gente, s.id, { clienteId }, { vault: false })),
        naEmpresa(() => atas.aceitar(ORG, gente, s.id, { clienteId }, { vault: false })),
      ]);
      expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      expect((r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
      expect(await prisma.workTask.count({ where: { orgId: ORG, title: s.titulo } })).toBe(1);
      const final = await prisma.ataSugestao.findUniqueOrThrow({ where: { id: s.id } });
      expect(final.estado).toBe('aceita');
      expect(final.workTaskId).not.toBeNull();
      // A ata aceita de um cliente foi a 05-acompanhamento dele, uma vez.
      expect(arquivista.pedidos.filter((x) => x.subpasta === '05-acompanhamento')).toHaveLength(1);
      expect(arquivista.pedidos[0]).toMatchObject({ partnerId: clienteId, origem: 'ata', tipoMime: 'text/markdown' });
    });

    it('a segunda sugestão da mesma ata para o mesmo cliente não manda a ata de novo', async () => {
      const antes = arquivista.pedidos.length;
      const s = await sugestao();
      await naEmpresa(() => atas.aceitar(ORG, gente, s.id, { clienteId }, { vault: false }));
      expect(arquivista.pedidos.length).toBe(antes);
    });

    it('a tarefa que falha ao nascer leva a tomada junto: a sugestão continua em rascunho', async () => {
      const s = await sugestao();
      const espiao = vi.spyOn(work, 'gravarTarefaPreparada').mockRejectedValueOnce(new Error('o banco caiu no meio'));
      await expect(naEmpresa(() => atas.aceitar(ORG, gente, s.id, { clienteId }, { vault: false }))).rejects.toThrow('o banco caiu no meio');
      espiao.mockRestore();
      const final = await prisma.ataSugestao.findUniqueOrThrow({ where: { id: s.id } });
      expect([final.estado, final.workTaskId, final.decididaPor]).toEqual(['rascunho', null, null]);
      expect(await prisma.workTask.count({ where: { orgId: ORG, title: s.titulo } })).toBe(0);
    });
  });

  // ==========================================================================
  describe('TR-02/TR-03 · a reunião do Granola entra uma vez só', () => {
    const GID = `11111111-2222-4333-8444-${randomUUID().slice(-12)}`;
    it('as duas portas ao mesmo tempo, com o mesmo id: uma linha', async () => {
      const card = await novoCard('Card do Granola');
      const base = { taskId: card.id, titulo: 'Reunião', em: new Date('2026-10-21T13:00:00Z'), transcricao: 'transcrição', granolaId: GID };
      const r = await Promise.all([
        gravarReuniaoDoGranola(p, ORG, { ...base, link: `https://notes.granola.ai/d/${GID}`, autorId: null }),
        gravarReuniaoDoGranola(p, ORG, { ...base, link: null, autorId: EU }),
      ]);
      expect(r.filter((x) => x.criada)).toHaveLength(1);
      expect(r[0].id).toBe(r[1].id);
      expect(await prisma.reuniaoDoCartao.count({ where: { orgId: ORG, granolaId: GID } })).toBe(1);
    });

    it('o modo direto depois do webhook: "já estava", sem linha nova', async () => {
      const r = await levarReuniaoDiretaParaFicha(p, ORG, {
        granolaId: GID, titulo: 'Reunião', em: new Date(), participantes: [], emails: [], link: null, ata: `ata\n\ngranola:${GID}`, autorId: EU,
      });
      expect(['ja_estava', 'atualizada']).toContain(r.ficha);
      expect(await prisma.reuniaoDoCartao.count({ where: { orgId: ORG, OR: [{ granolaId: GID }, { transcricao: { contains: GID } }] } })).toBe(1);
    });

    it('a linha antiga, sem a coluna, ainda é achada pela marca e não duplica', async () => {
      const card = await novoCard('Card antigo');
      const velho = `22222222-3333-4444-8555-${randomUUID().slice(-12)}`;
      await prisma.reuniaoDoCartao.create({ data: { orgId: ORG, taskId: card.id, titulo: 'Antiga', em: new Date(), fonte: 'granola', transcricao: `ata\n\ngranola:${velho}` } });
      expect(await reuniaoDoGranolaNaFicha(p, ORG, velho)).not.toBeNull();
      const r = await gravarReuniaoDoGranola(p, ORG, { granolaId: velho, taskId: card.id, titulo: 'Nova', em: new Date(), link: null, transcricao: 'x', autorId: null });
      expect(r.criada).toBe(false);
    });
  });

  // ==========================================================================
  describe('TR-07 · o cobrador de tarefas', () => {
    let modelo: ModeloDuble;
    let cobranca: CobrancaDeTarefasService;
    const agora = new Date('2026-10-21T11:30:00Z');
    beforeAll(async () => {
      modelo = new ModeloDuble();
      // O modelo inventa um número: a frase cai na do sistema.
      modelo.respostas['TR-07'] = '{"frase":"Você tem 99 tarefas atrasadas."}';
      const registro = new PendenciasRegistry();
      const rotinas = new ExecutoresDeRotinaRegistry();
      cobranca = new CobrancaDeTarefasService(p, new PendenciasService(p, registro), modelo, memoria, rotinas, registro, audit);
      cobranca.onModuleInit();
      expect(rotinas.tem('trabalho.cobranca')).toBe(true);
      expect(registro.tratador('tarefa.cobranca')).toBeTruthy();
      const lista = await prisma.workList.create({
        data: { orgId: ORG, name: `Cobrança ${MARCA}`, statuses: { create: [{ name: 'A fazer', type: 'open', order: 0 }, { name: 'Feito', type: 'closed', order: 1 }] } },
        include: { statuses: true },
      });
      const aberto = lista.statuses.find((s) => s.type === 'open')!.id;
      const feito = lista.statuses.find((s) => s.type === 'closed')!.id;
      await prisma.workTask.createMany({
        data: [
          { orgId: ORG, listId: lista.id, statusId: aberto, title: 'Vencida da pessoa', assigneeUserId: EU, assignee: 'Rodrigo', dueDate: new Date('2026-10-18T12:00:00Z') },
          { orgId: ORG, listId: lista.id, statusId: aberto, title: 'Parada da pessoa', assigneeUserId: EU, assignee: 'Rodrigo' },
          { orgId: ORG, listId: lista.id, statusId: aberto, title: 'Sem dono nenhum' },
          { orgId: ORG, listId: lista.id, statusId: aberto, title: 'Da conta de máquina', assigneeUserId: MAQUINA, assignee: 'IA', dueDate: new Date('2026-10-01T12:00:00Z') },
          { orgId: ORG, listId: lista.id, statusId: feito, title: 'Encerrada vencida', assigneeUserId: EU, dueDate: new Date('2026-10-01T12:00:00Z') },
        ],
      });
      await prisma.workTask.updateMany({ where: { orgId: ORG, title: 'Parada da pessoa' }, data: { statusDesde: new Date('2026-10-01T12:00:00Z') } });
    });

    it('um item por pessoa e um para o sem dono; os números são do sistema; idempotente no dia', async () => {
      const r = await comoSistema(() => cobranca.cobrar(ORG, agora));
      expect(r).toMatchObject({ pessoas: 1, vencidas: 1, paradas: 1, dias: 7, doModelo: 0 });
      expect(r.semDono).toBeGreaterThanOrEqual(1);
      const minha = await prisma.pendencia.findFirstOrThrow({ where: { orgId: ORG, chave: `tarefa.cobranca:${EU}:2026-10-21` } });
      expect(minha).toMatchObject({ funcao: 'TR-07', tipo: 'tarefa.cobranca', paraUsuarioId: EU, titulo: '2 tarefas suas pedem atenção hoje' });
      expect(minha.contexto).not.toContain('99');
      expect(minha.contexto).toContain('Bom dia, Rodrigo.');
      expect(minha.contexto).toContain('- Vencida da pessoa');
      expect(minha.contexto).not.toContain('Da conta de máquina');
      expect(minha.contexto).not.toContain('Encerrada vencida');
      expect((minha.dados as { frase: string }).frase).toBe('sistema');
      const semDono = await prisma.pendencia.findFirstOrThrow({ where: { orgId: ORG, chave: 'tarefa.cobranca:sem-dono:2026-10-21' } });
      expect(semDono.paraUsuarioId).toBeNull();
      const segunda = await comoSistema(() => cobranca.cobrar(ORG, agora));
      expect(segunda.pendencias.sort()).toEqual(r.pendencias.sort());
      expect(await prisma.pendencia.count({ where: { orgId: ORG, tipo: 'tarefa.cobranca' } })).toBe(2);
    });

    it('a frase do modelo sem número inventado vale; a nota muda o N', async () => {
      modelo.respostas['TR-07'] = '{"frase":"Rodrigo, comece pela que venceu."}';
      await prisma.pendencia.deleteMany({ where: { orgId: ORG, tipo: 'tarefa.cobranca' } });
      const r = await comoSistema(() => cobranca.cobrar(ORG, agora));
      expect(r.doModelo).toBeGreaterThanOrEqual(1);
      await comoSistema(() =>
        memoria.criar(ORG, { chave: 'trabalho.cobranca.dias', title: 'Dias da cobrança', body: '30', kind: ContextKind.regra, sourceType: ContextSource.operador }),
      );
      const com30 = await comoSistema(() => cobranca.cobrar(ORG, agora));
      expect(com30).toMatchObject({ dias: 30, paradas: 0, vencidas: 1 });
    });

    it('a rotina nasce DESLIGADA e o seed é idempotente', async () => {
      await garantirRotinaDaCobranca(p, ORG);
      await garantirRotinaDaCobranca(p, ORG);
      const rotinas = await prisma.rotina.findMany({ where: { orgId: ORG, slug: SLUG_DA_ROTINA_DE_COBRANCA } });
      expect(rotinas).toHaveLength(1);
      expect(rotinas[0]).toMatchObject({ tipo: 'trabalho.cobranca', ativo: false, estado: AgentEstado.planejado, cron: '30 8 * * *', tz: 'America/Sao_Paulo' });
    });
  });

  // ==========================================================================
  describe('TR-08 · a triagem da caixa, com cache por item', () => {
    it('explícito pela referência; o modelo só agrupa o resto; a segunda leitura sai do cache', async () => {
      await prisma.pendencia.deleteMany({ where: { orgId: ORG } });
      const tarefa = await novoCard('Tarefa da padaria', { clienteId, dueDate: new Date('2026-10-01T12:00:00Z') });
      await prisma.pendencia.createMany({
        data: [
          { orgId: ORG, funcao: 'TR-05', tipo: 'arquivo.classificar', chave: `t8-a-${MARCA}`, titulo: 'Arquivo da tarefa', refTipo: 'work_task', refId: tarefa.id, opcoes: [] },
          { orgId: ORG, funcao: 'CO-16', tipo: 'whatsapp.triagem', chave: `t8-b-${MARCA}`, titulo: 'Mensagem da Construtora Alicerce', contexto: 'pediu o boleto', opcoes: [] },
          { orgId: ORG, funcao: 'AG-01', tipo: 'agenda.padrao', chave: `t8-c-${MARCA}`, titulo: 'Reunião fora do padrão', contexto: 'sem cliente no título', opcoes: [] },
          { orgId: ORG, funcao: 'TR-05', tipo: 'arquivo.classificar', chave: `t8-d-${MARCA}`, titulo: 'De outra pessoa', paraUsuarioId: MAQUINA, opcoes: [] },
        ],
      });
      const ids = Object.fromEntries((await prisma.pendencia.findMany({ where: { orgId: ORG } })).map((x) => [x.chave.slice(0, 4), x.id]));
      const modelo = new ModeloDuble();
      modelo.respostas['TR-08'] = JSON.stringify({ itens: [{ id: ids['t8-b'], cliente: 'Construtora Alicerce' }, { id: ids['t8-c'], cliente: 'Cliente Inventado' }] });
      const triagem = new TriagemDaCaixaService(p, modelo);
      const r = await comoSistema(() => triagem.daCaixa(ORG, EU, new Date('2026-10-21T13:00:00Z')));
      expect(r.total).toBe(3);
      const por = new Map(r.grupos.flatMap((g) => g.itens).map((i) => [i.id, i]));
      expect(por.get(ids['t8-a'])).toMatchObject({ cliente: 'Padaria Exemplo', clienteDe: 'explicito', urgencia: 'urgente', funcaoNome: 'Arquivista do cliente' });
      expect(por.get(ids['t8-b'])).toMatchObject({ cliente: 'Construtora Alicerce', clienteDe: 'modelo' });
      expect(por.get(ids['t8-c'])).toMatchObject({ cliente: null, clienteDe: 'nenhum' });
      expect(r.grupos[0]).toMatchObject({ urgencia: 'urgente', cliente: 'Padaria Exemplo' });
      expect(modelo.chamadas).toHaveLength(1);
      expect(modelo.chamadas[0].funcao).toBe('TR-08');
      // O item com cliente explícito não foi ao modelo.
      expect(JSON.stringify(modelo.chamadas[0].turns)).not.toContain('Arquivo da tarefa');
      const de2 = await comoSistema(() => triagem.daCaixa(ORG, EU, new Date('2026-10-21T13:00:00Z')));
      expect(modelo.chamadas).toHaveLength(1);
      expect(de2.doCache).toBe(2);
      // A rotina do cobrador foi garantida (desligada) por quem abriu a caixa.
      expect(await prisma.rotina.count({ where: { orgId: ORG, slug: SLUG_DA_ROTINA_DE_COBRANCA, ativo: false } })).toBe(1);
      // Contador honesto: descartar tira da lista.
      const pend = new PendenciasService(p, new PendenciasRegistry());
      await naEmpresa(() => pend.descartar(ORG, ids['t8-c'], EU));
      expect((await comoSistema(() => triagem.daCaixa(ORG, EU))).total).toBe(2);
    });

    it('sem modelo configurado: cai na regra, sem cliente agrupado', async () => {
      const modelo = new ModeloDuble();
      modelo.configured = false;
      const r = await comoSistema(() => new TriagemDaCaixaService(p, modelo).daCaixa(ORG, EU));
      expect(r.triagem).toBe('regra');
      expect(modelo.chamadas).toHaveLength(0);
    });
  });

  // ==========================================================================
  describe('TR-09 · o delegador propõe e só gente aceita', () => {
    let delegador: DelegadorService;
    let modelo: ModeloDuble;
    const gente = { id: EU, papeis: [] as string[] };
    beforeAll(() => {
      modelo = new ModeloDuble();
      modelo.respostas['TR-09'] = JSON.stringify({
        subtarefas: [
          { titulo: 'Ligar para o cliente', dono: { tipo: 'pessoa', nome: 'Rodrigo Teste' }, prazo: null, porque: 'é o dono da conta' },
          { titulo: 'Classificar os arquivos', dono: { tipo: 'agente', funcao: 'TR-05' }, prazo: null, porque: 'é o arquivista' },
        ],
      });
      delegador = new DelegadorService(p, work, audit, modelo);
    });

    it('tarefa sem agente: recusa antes do modelo; conta de máquina não propõe', async () => {
      const t = await novoCard('Sem agente');
      await expect(delegador.propor(ORG, gente, t.id)).rejects.toBeInstanceOf(BadRequestException);
      await expect(delegador.propor(ORG, { id: MAQUINA, papeis: ['ia_acao'] }, t.id)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(delegador.propor(ORG, { id: MAQUINA, papeis: [] }, t.id)).rejects.toBeInstanceOf(ForbiddenException);
      expect(modelo.chamadas).toHaveLength(0);
    });

    it('propor só cria sugestões (nenhuma subtarefa); aceitar cria UMA, na mesma transação; descartar fica registrado', async () => {
      const t = await novoCard('Tarefa grande do agente', { clienteId, agenteId: pesquisadorId, agenteEm: new Date() });
      const d = await naEmpresa(() => delegador.propor(ORG, gente, t.id));
      expect(d.atribuidaAAgente).toBe(true);
      expect(d.sugestoes.map((s) => [s.titulo, s.donoTipo, s.estado])).toEqual([
        ['Ligar para o cliente', 'pessoa', 'rascunho'],
        ['Classificar os arquivos', 'agente', 'rascunho'],
      ]);
      expect(await prisma.workTask.count({ where: { orgId: ORG, parentId: t.id } })).toBe(0);
      const [pessoa, agente] = d.sugestoes;
      const r = await Promise.allSettled([
        naEmpresa(() => delegador.aceitar(ORG, gente, pessoa.id, {})),
        naEmpresa(() => delegador.aceitar(ORG, gente, pessoa.id, {})),
      ]);
      expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      const subs = await prisma.workTask.findMany({ where: { orgId: ORG, parentId: t.id } });
      expect(subs).toHaveLength(1);
      expect(subs[0]).toMatchObject({ title: 'Ligar para o cliente', assigneeUserId: EU, agenteId: null, clienteId });
      // O agente sugerido não vira atribuição: a subtarefa nasce sem agente e sem pessoa, e diz para quem era.
      const doAgente = await naEmpresa(() => delegador.aceitar(ORG, gente, agente.id, {}));
      const sub2 = await prisma.workTask.findUniqueOrThrow({ where: { id: doAgente.subtarefaId! } });
      expect([sub2.agenteId, sub2.assigneeUserId]).toEqual([null, null]);
      expect(sub2.description).toContain('Arquivista do cliente (TR-05)');
      const outra = await naEmpresa(() => delegador.propor(ORG, gente, t.id));
      const terceira = outra.sugestoes.find((s) => s.estado === 'rascunho')!;
      await naEmpresa(() => delegador.descartar(ORG, gente, terceira.id));
      await expect(naEmpresa(() => delegador.aceitar(ORG, gente, terceira.id, {}))).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
