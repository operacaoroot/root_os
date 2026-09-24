import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuditService } from '../src/audit/audit.service';
import { comContexto } from '../src/common/contexto-execucao';
import { EventLogService } from '../src/gateway/event-log.service';
import type {
  ChamadaParaTeto,
  LlmMessage,
  LlmProvider,
  LlmStepInput,
  LlmStepOutput,
} from '../src/llm/llm.provider';
import { MemoriaService } from '../src/memory/memoria.service';
import { hashDoToken } from '../src/onboarding/trilho/convite';
import { LeituraDaAtaService } from '../src/onboarding/trilho/leitura-da-ata.service';
import { LinkPublicoService } from '../src/onboarding/trilho/link-publico.service';
import { SLUG_DA_ROTINA_DO_RELOGIO, TIPO_DA_ROTINA_DO_RELOGIO, TrilhoService } from '../src/onboarding/trilho/trilho.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ModulosService } from '../src/tenants/modulos.service';
import { ProvisionamentoService } from '../src/tenants/provisionar.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * O TRILHO DE PONTA A PONTA, pelos serviços de verdade e com o modelo
 * substituído por um dublê que devolve o JSON combinado. O que se prova:
 *
 *   · o trilho nasce, e o roster + a rotina do relógio são semeados sozinhos;
 *   · a triagem (bloco A) vai pelo link público, é respondida e cumpre o portão;
 *   · avançar de fase RECUSA com a lista do que falta e ACEITA quando cumpre;
 *   · a ata vira propostas com a regra de corte, e o link BCD só sai quando
 *     nada interpretado está pendente (literal vai direto);
 *   · o cliente confirma, corrige e responde pela rota anônima; token errado,
 *     revogado e concluído não escrevem;
 *   · concluir recusa com obrigatório faltando; concluído, sai o retrato;
 *   · a empresa do cliente é provisionada e a memória dela recebe as notas com
 *     a chave estável e a procedência;
 *   · o relógio acha o lembrete no dia 3 e grava o marco com a mensagem.
 */

const URL = process.env.TEST_DATABASE_URL;
exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (trilhos, itens, convites, memória e rastro)');

const MARCA = `tr${Date.now().toString(36).slice(-5)}`;

const ATA = [
  '[00:04:12] Marcos: A gente vende peça de reposição para frota pesada, caminhão e ônibus. Cliente é transportadora e oficina de frota, de Juiz de Fora até Barbacena.',
  '[00:09:40] Marcos: dá certo com transportadora grande, dez veículos pra cima, que tem comprador.',
  '[00:11:05] Marcos: oficina pequena que compra no WhatsApp e atrasa, não dá certo.',
  '[00:14:32] Marcos: Cobramos por peça, tabela com desconto por volume. Cliente grande tem contrato mensal com prazo de vinte e oito dias.',
  '[00:18:20] Marcos: eu olho o faturamento do dia, a margem por pedido e o aberto, que é o que está vencido.',
  '[00:21:15] Marcos: aberto é o vencido; balcão é venda sem contrato; giro são as quarenta peças que não podem faltar.',
  '[00:26:00] Marcos: quase tudo é indicação e o vendedor externo. Instagram não traz nada.',
  '[00:31:44] Marcos: quem vai usar sou eu e a Carla, do financeiro. Ela já aprova pagamento hoje.',
  '[00:35:10] Marcos: a gente usa o Omie desde 2022. Quem administra é o Júnior, da TI terceirizada. A senha do Omie é frota2022 mas isso eu passo depois.',
  '[00:40:05] Rodrigo: e o status, prefere no grupo? Marcos: no grupo mesmo, não me manda e-mail.',
].join('\n');

/** O que o dublê devolve para cada agente, pelo prompt de sistema. */
const SAIDA_DO_LEITOR = JSON.stringify({
  propostas: [
    { temaId: 'negocio', texto: 'Vendemos peça de reposição para frota pesada — caminhão e ônibus — para transportadoras e oficinas de frota, de Juiz de Fora até Barbacena.', tipo: 'literal', minuto: '00:04:12', trecho: 'A gente vende peça de reposição para frota pesada, caminhão e ônibus. Cliente é transportadora e oficina de frota, de Juiz de Fora até Barbacena.' },
    { temaId: 'cliente-ideal', texto: 'Dá certo com transportadora de dez veículos ou mais e comprador dedicado; não dá certo com oficina pequena que compra no WhatsApp e atrasa.', tipo: 'interpretado', minuto: '00:09:40', trecho: 'dá certo com transportadora grande, dez veículos pra cima, que tem comprador.', nota: 'juntei 09:40 e 11:05' },
    { temaId: 'oferta-e-preco', texto: 'Cobramos por peça, com tabela de desconto por volume; cliente grande tem contrato mensal com prazo de 28 dias.', tipo: 'literal', minuto: '00:14:32', trecho: 'Cobramos por peça, tabela com desconto por volume. Cliente grande tem contrato mensal com prazo de vinte e oito dias.' },
    { temaId: 'numeros-que-importam', texto: 'Olho o faturamento do dia, a margem por pedido e o "aberto" (o que está vencido).', tipo: 'literal', minuto: '00:18:20', trecho: 'eu olho o faturamento do dia, a margem por pedido e o aberto, que é o que está vencido.' },
    { temaId: 'vocabulario', texto: '"Aberto" é o vencido; "balcão" é venda sem contrato; "giro" são as 40 peças que não podem faltar.', tipo: 'interpretado', minuto: '00:21:15', trecho: 'aberto é o vencido; balcão é venda sem contrato; giro são as quarenta peças que não podem faltar.' },
    { temaId: 'canais', texto: 'Quase tudo é indicação e o vendedor externo. Instagram não traz nada.', tipo: 'literal', minuto: '00:26:00', trecho: 'quase tudo é indicação e o vendedor externo. Instagram não traz nada.' },
    { temaId: 'd-dupla', texto: 'Quem usa: eu e a Carla, do financeiro. A Carla já aprova pagamento hoje.', tipo: 'literal', minuto: '00:31:44', trecho: 'quem vai usar sou eu e a Carla, do financeiro. Ela já aprova pagamento hoje.' },
    { temaId: 'd-acessos', texto: 'Usamos o Omie desde 2022; quem administra é o Júnior, da TI terceirizada.', tipo: 'literal', minuto: '00:35:10', trecho: 'a gente usa o Omie desde 2022. Quem administra é o Júnior, da TI terceirizada.' },
    { temaId: 'd-status', texto: 'Prefiro o status no grupo de WhatsApp, sem e-mail.', tipo: 'interpretado', minuto: '00:40:05', trecho: 'no grupo mesmo, não me manda e-mail.' },
    // Inventada: o trecho não está na ata. O parser tem de descartar.
    { temaId: 'regras-da-casa', texto: 'Ninguém dá desconto sem a Carla.', tipo: 'literal', minuto: null, trecho: 'ninguém dá desconto acima de oito por cento sem falar com a Carla' },
  ],
  emBranco: [],
});

class ModeloDuble implements LlmProvider {
  readonly name = 'duble';
  readonly model = 'claude-opus-5';
  readonly configured = true;
  readonly supportsTools = false;
  readonly leAnexos = false;
  chamadas: LlmStepInput[] = [];

  async complete(_input: LlmMessage): Promise<string> {
    return '{}';
  }

  async step(input: LlmStepInput): Promise<LlmStepOutput> {
    this.chamadas.push(input);
    const texto = input.system.includes('leitor de ata')
      ? SAIDA_DO_LEITOR
      : input.system.includes('pesquisador de conta')
        ? JSON.stringify({
            afirmacoes: [{ texto: 'Usa o Omie desde 2022', fonte: 'triagem', hipotese: false }],
            hipoteses: [{ titulo: 'Achar documento em minutos', comoEra: 'um dia procurando', comoFica: 'dois minutos', receita: 'arquivista-documental', metrica: 'minutos por documento' }],
            perguntasQueFaltam: ['Quantos veículos tem a frota média do cliente?'],
            perfilSugerido: 'P2',
            motivoDoPerfil: 'tem ERP com API',
          })
        : JSON.stringify({ perguntas: { negocio: 'Marcos, em duas frases: o que a Andrade vende, e para quem?' } });
    return {
      text: texto,
      toolCalls: [],
      stopReason: 'end_turn',
      usage: { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 0, custoUsd: 0.0175, custoEstimado: true, modeloServido: 'claude-opus-5' },
      raw: [],
    };
  }

  tetoDeSaida(_c: ChamadaParaTeto): number {
    return 16000;
  }
}

const transcricaoDuble = {
  configured: true,
  modelo: 'gpt-4o-transcribe',
  async transcrever() {
    return { texto: 'Ninguém dá desconto acima de oito por cento sem a Carla. Nunca prometer prazo sem consultar o estoque.', modelo: 'gpt-4o-transcribe', custoUsd: 0.001, custoEstimado: true, segundosEstimados: 12 };
  },
};

describe.skipIf(!URL)('o trilho de onboarding, de ponta a ponta', () => {
  let prisma: PrismaClient;
  let trilhos: TrilhoService;
  let leitura: LeituraDaAtaService;
  let link: LinkPublicoService;
  let modelo: ModeloDuble;
  let rootId = '';
  const criadas: string[] = [];
  const quem = { id: null as string | null, nome: 'Rodrigo (teste)' };

  let trilhoId = '';
  let tokenA = '';
  let tokenBCD = '';

  const naRoot = <T>(fn: () => Promise<T>) =>
    comContexto({ orgId: rootId, actorType: 'user', actorId: quem.id, correlationId: `teste-${MARCA}`, origem: 'http' }, fn);

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    const p = prisma as unknown as PrismaService;
    const eventos = new EventLogService(prisma as never);
    const auditoria = new AuditService(p);
    const memoria = new MemoriaService(p, eventos);
    const provisionamento = new ProvisionamentoService(p, eventos, auditoria, new ModulosService(p));
    modelo = new ModeloDuble();
    trilhos = new TrilhoService(p, memoria, eventos, provisionamento);
    leitura = new LeituraDaAtaService(modelo, trilhos, p);
    link = new LinkPublicoService(p, trilhos, transcricaoDuble as never);

    const root = await provisionamento.provisionar(
      { slug: `root-${MARCA}`, nome: `Root ${MARCA}`, modulos: ['trabalho'], admin: { email: `rodrigo.${MARCA}@root.local`, nome: 'Rodrigo' }, modo: 'criar' },
      { tipo: 'system' },
    );
    rootId = root.orgId;
    criadas.push(rootId);
    quem.id = root.admin?.userId ?? null;
  });

  afterAll(async () => {
    for (const orgId of criadas) {
      await prisma.onboardingTrilho.deleteMany({ where: { orgId } });
      await prisma.rotina.deleteMany({ where: { orgId } });
      await prisma.contextItemVersion.deleteMany({ where: { orgId } });
      await prisma.contextItem.deleteMany({ where: { orgId } });
      await prisma.knowledgeNote.deleteMany({ where: { orgId } });
      await prisma.sop.deleteMany({ where: { orgId } });
      await prisma.agent.deleteMany({ where: { orgId } });
      await prisma.auditLog.deleteMany({ where: { orgId } });
      await prisma.$transaction([
        prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
        prisma.eventLog.deleteMany({ where: { orgId } }),
        prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
      ]);
      await prisma.user.deleteMany({ where: { orgId } });
      await prisma.role.deleteMany({ where: { orgId } });
      await prisma.org.deleteMany({ where: { id: orgId } });
    }
    await prisma.$disconnect();
  });

  it('o trilho nasce na fase 0, com o roster do onboarding e a rotina do relógio semeados', async () => {
    const t = await naRoot(() =>
      trilhos.criar(rootId, { cliente: `Andrade Peças ${MARCA}`, contatoNome: 'Marcos Andrade', contatoEmail: `marcos.${MARCA}@andrade.local`, conduzidoPor: 'Rodrigo', reuniaoEm: '2026-10-02T13:00:00Z' }, quem),
    );
    trilhoId = t.id;
    expect(t.fase).toBe('qualificar');
    expect(t.slug).toMatch(/^andrade-pecas/);
    expect(t.podeAvancar).toBe(false);
    expect(t.marcos.map((m) => m.tipo)).toContain('trilho.criado');

    await naRoot(() => trilhos.listar(rootId));
    const agentes = await prisma.agent.findMany({ where: { orgId: rootId }, select: { slug: true } });
    expect(agentes.map((a) => a.slug).sort()).toEqual(['leitor-de-ata', 'pesquisador-de-conta', 'roteirista-de-kickoff']);
    const rotina = await prisma.rotina.findUnique({ where: { orgId_slug: { orgId: rootId, slug: SLUG_DA_ROTINA_DO_RELOGIO } } });
    expect(rotina?.tipo).toBe(TIPO_DA_ROTINA_DO_RELOGIO);
    expect(rotina?.estado).toBe('rodando');
    expect(rotina?.proximaExecucaoEm).not.toBeNull();
  });

  it('o link A: só o hash no banco; o cliente responde a triagem e o portão da fase 0 se cumpre', async () => {
    const c = await naRoot(() => trilhos.gerarConvite(rootId, trilhoId, 'A', quem));
    tokenA = c.token;
    expect(c.link).toContain(`/e/${c.token}`);
    expect(c.mensagem).toContain('Oi, Marcos!');
    const guardado = await prisma.onboardingConvite.findUnique({ where: { id: c.conviteId } });
    expect(guardado?.tokenHash).toBe(hashDoToken(c.token));
    expect(guardado?.tokenCifrado ?? '').not.toContain(c.token);

    const estado = await link.estado(tokenA);
    expect(estado.blocos).toBe('A');
    expect(estado.itens.map((i) => i.temaId)).toEqual(['a-empresa', 'a-sistemas', 'a-tarefa-que-toma-tempo', 'a-tirar-do-prato', 'a-uso-de-ia']);
    expect(estado.itens.every((i) => i.modo === 'responder')).toBe(true);

    // Concluir antes de responder: recusa com a lista.
    await expect(link.concluir(tokenA, 'Marcos')).rejects.toMatchObject({ response: { faltando: expect.arrayContaining(['O que a empresa faz, e quantas pessoas']) } });

    // Escolha fora das opções é recusada.
    await expect(link.responder(tokenA, 'a-uso-de-ia', 'sei lá', 'Marcos')).rejects.toThrow(/escolha uma das opções/);

    await link.responder(tokenA, 'a-empresa', 'Distribuímos peças de reposição para frota pesada; somos 14 pessoas.', 'Marcos');
    await link.responder(tokenA, 'a-sistemas', 'Omie desde 2022, com API; o Júnior da TI tira relatório.', 'Marcos');
    await link.responder(tokenA, 'a-tarefa-que-toma-tempo', 'Conferir o aberto com o extrato: umas 6 horas por semana.', 'Marcos');
    await link.responder(tokenA, 'a-tirar-do-prato', 'A conferência do aberto.', 'Marcos');
    const depois = await link.responder(tokenA, 'a-uso-de-ia', 'uso o chat às vezes', 'Marcos');
    expect(depois.progresso.obrigatoriosFaltando).toEqual([]);

    const fim = await link.concluir(tokenA, 'Marcos');
    expect(fim.retrato).toBeNull();
    // Concluído não aceita mais escrita — e responde 404 igual a inexistente? Não:
    // concluído ainda LÊ (o cliente pode reabrir), mas não escreve.
    await expect(link.responder(tokenA, 'a-empresa', 'outra', 'Marcos')).rejects.toThrow(/já foi concluído/);

    const t = await naRoot(() => trilhos.obter(rootId, trilhoId));
    expect(t.portoes.triagemRespondidaEm).toBeTruthy();
    expect(t.itens_.find((i) => i.temaId === 'a-sistemas')?.origem).toBe('triagem');
    expect(t.faltando).toContain('perfil decidido (P1, P2, P3 ou não entra)');
  });

  it('token errado, revogado e mal formado respondem "não encontrado"', async () => {
    await expect(link.estado('x'.repeat(43))).rejects.toThrow(/não encontrado/);
    await expect(link.estado('curto')).rejects.toThrow(/não encontrado/);
    const c = await naRoot(() => trilhos.gerarConvite(rootId, trilhoId, 'A', quem));
    await naRoot(() => trilhos.revogarConvite(rootId, trilhoId, c.conviteId, quem));
    await expect(link.estado(c.token)).rejects.toThrow(/não encontrado/);
  });

  it('avançar RECUSA com a lista do que falta e ACEITA quando o portão está cumprido', async () => {
    await expect(naRoot(() => trilhos.avancar(rootId, trilhoId, quem))).rejects.toMatchObject({
      response: { faltando: expect.arrayContaining(['perfil decidido (P1, P2, P3 ou não entra)', 'próximo passo escrito']) },
    });
    await naRoot(() => trilhos.atualizar(rootId, trilhoId, { perfil: 'P2', proximoPasso: 'diagnóstico de 60 min', proximoPassoDono: 'Lucas', proximoPassoEm: '2026-10-02' }, quem));
    const t1 = await naRoot(() => trilhos.avancar(rootId, trilhoId, quem));
    expect(t1.fase).toBe('diagnostico');
    // A fase nova nasce sem próximo passo, de propósito.
    expect(t1.proximoPasso).toBeNull();

    // Fase 1: receita + proposta enviada + próximo passo.
    await naRoot(() => trilhos.atualizar(rootId, trilhoId, { receita: 'arquivista-documental', nivel: 'entregar-pronto', portoes: { propostaEnviadaEm: '2026-10-03' }, proximoPasso: 'assinar contrato', proximoPassoDono: 'Rodrigo', proximoPassoEm: '2026-10-08' }, quem));
    const t2 = await naRoot(() => trilhos.avancar(rootId, trilhoId, quem));
    expect(t2.fase).toBe('contrato');
  });

  it('o dossiê e o roteiro personalizado passam pelo agente certo e viram marco', async () => {
    const d = await naRoot(() => leitura.gerarDossie(rootId, trilhoId, 'Site: Andrade Peças — distribuidora desde 1998.', quem));
    expect(d.perfilSugerido).toBe('P2');
    expect(modelo.chamadas.at(-1)?.agentSlug).toBe('pesquisador-de-conta');
    const folha = await naRoot(() => trilhos.folhaDeReuniao(rootId, trilhoId));
    expect(folha.markdown).toContain('Achar documento em minutos');

    const perguntas = await naRoot(() => leitura.personalizarRoteiro(rootId, trilhoId, quem));
    expect(perguntas.negocio).toContain('Andrade');
    const roteiro = await naRoot(() => trilhos.roteiro(rootId, trilhoId));
    expect(roteiro.blocos[0].temas[0].pergunta).toContain('Andrade');
    expect(roteiro.triagem.some((x) => x.resposta.includes('Omie'))).toBe(true);
  });

  it('a ata vira propostas: literal, interpretado, invenção descartada, segredo mascarado', async () => {
    const r = await naRoot(() => leitura.lerAta(rootId, trilhoId, { tipo: 'texto', texto: ATA }, quem, '2026-09-30T13:00:00Z'));
    expect(modelo.chamadas.at(-1)?.agentSlug).toBe('leitor-de-ata');
    // A senha ditada em 35:10 foi mascarada ANTES de ir ao modelo.
    expect(modelo.chamadas.at(-1)?.turns[0]).toMatchObject({ role: 'user' });
    expect((modelo.chamadas.at(-1)?.turns[0] as { text: string }).text).not.toContain('frota2022');
    expect(r.ata.segredosRemovidos).toBe(1);
    expect(r.ata.propostas).toBe(9);
    expect(r.leitura.avisos.some((a) => a.includes('invenção'))).toBe(true);

    const t = await naRoot(() => trilhos.obter(rootId, trilhoId));
    const por = new Map(t.itens_.map((i) => [i.temaId, i]));
    expect(por.get('negocio')).toMatchObject({ status: 'proposto', tipo: 'literal', fonteMinuto: '00:04:12' });
    expect(por.get('cliente-ideal')).toMatchObject({ status: 'proposto', tipo: 'interpretado' });
    expect(por.get('regras-da-casa')?.status).toBe('em-branco');
    expect(t.itens.pendentesDeAprovacao).toBe(3);
    expect(t.atas[0].modelo).toBe('claude-opus-5');
  });

  it('o link BCD não sai com interpretado pendente; aprovado, sai e os literais vão pela regra', async () => {
    await expect(naRoot(() => trilhos.gerarConvite(rootId, trilhoId, 'BCD', quem))).rejects.toMatchObject({
      response: { temas: expect.arrayContaining(['cliente-ideal', 'vocabulario', 'd-status']) },
    });
    await naRoot(() => trilhos.decidirItem(rootId, trilhoId, 'cliente-ideal', 'aprovar', null, quem));
    await naRoot(() => trilhos.decidirItem(rootId, trilhoId, 'vocabulario', 'editar', '"Aberto" é o vencido; "balcão" é venda sem contrato; "giro" são as 40 peças que não podem faltar no estoque.', quem));
    await naRoot(() => trilhos.decidirItem(rootId, trilhoId, 'd-status', 'descartar', null, quem));

    const c = await naRoot(() => trilhos.gerarConvite(rootId, trilhoId, 'BCD', quem));
    tokenBCD = c.token;
    expect(c.aprovadosPelaRegra).toBe(6);
    expect(c.mensagem).toContain('itens já vieram');
    await naRoot(() => trilhos.marcarEnviado(rootId, trilhoId, c.conviteId, quem));

    const msgs = await naRoot(() => trilhos.mensagensDoConvite(rootId, trilhoId, c.conviteId));
    // Sem ENCRYPTION_KEY no ambiente de teste o link não é reescrito — e isso é declarado, não erro.
    if (process.env.ENCRYPTION_KEY) expect(msgs.link).toContain('/e/');
    else expect(msgs.link).toBeNull();
  });

  it('o link é o KICKOFF: mapa na estação 3, decisão antes de confirmação, e a pergunta é a do roteirista', async () => {
    // As notas que nasceram da conversa entram pelo marco `ata.notas` e aparecem na teia.
    await naRoot(() =>
      trilhos.marco(rootId, trilhoId, 'ata.notas', '1 nota nasceu da conversa.', {
        notas: [{ id: 'frota-pesada', titulo: 'Frota pesada é o mercado', corpo: 'Caminhão e ônibus, transportadora e oficina de frota.', minuto: '00:04:12', liga: ['negocio', 'cliente-ideal'] }],
      }, quem),
    );
    const e = await link.estado(tokenBCD);
    // A teia: cada tema é uma nota; a proposta aprovada é rascunho; a nota da conversa já existe; o índice liga o que existe.
    const no = new Map(e.teia.nos.map((n) => [n.id, n]));
    expect(e.teia.pasta).toContain('/');
    expect(no.get('negocio')?.estado).toBe('rascunho');
    expect(no.get('regras-da-casa')?.estado).toBe('vazia');
    expect(no.get('conversa:frota-pesada')).toMatchObject({ estado: 'conversa', minuto: '00:04:12' });
    expect(no.get('indice')?.ligacoes).toEqual(['conversa:frota-pesada']);
    expect(e.teia.arestas.some((a) => a.de === 'conversa:frota-pesada' && a.para === 'negocio')).toBe(true);
    // O mapa: seis estações, o kickoff é onde ele está, e nada do futuro aparece como feito.
    expect(e.mapa.estacoes).toHaveLength(6);
    expect(e.mapa.estacaoAtual).toBe(3);
    expect(e.mapa.estacoes[2]).toMatchObject({ chave: 'kickoff', estado: 'aqui' });
    expect(e.mapa.estacoes[2].detalhe).toContain('confirmar');
    expect(e.mapa.estacoes.slice(3).every((x) => x.estado === 'adiante')).toBe(true);
    expect(e.mapa.promessa.pasta).toContain('/');
    expect(e.mapa.promessa.notas.length).toBeGreaterThan(0);
    // A ordem do kickoff: o que só ele decide vem primeiro; o que veio da conversa, depois.
    expect(e.ordem.decisoes).toContain('d-status');
    expect(e.ordem.decisoes).toContain('regras-da-casa');
    expect(e.ordem.confirmacoes).toContain('negocio');
    expect(e.ordem.decisoes.concat(e.ordem.confirmacoes, e.ordem.extras).sort()).toEqual(e.itens.map((i) => i.temaId).sort());
    // A pergunta que o cliente lê é a MESMA do roteiro do kickoff, reescrita pelo roteirista.
    const roteiro = await naRoot(() => trilhos.roteiro(rootId, trilhoId));
    const doRoteiro = new Map(roteiro.blocos.flatMap((b) => b.temas).map((t) => [t.id, t.pergunta]));
    for (const i of e.itens) expect(i.pergunta).toBe(doRoteiro.get(i.temaId));
    expect(e.itens.find((i) => i.temaId === 'negocio')?.pergunta).toContain('Andrade');
  });

  it('o cliente confirma, corrige e responde (texto e áudio); concluir recusa até os obrigatórios; depois sai o retrato', async () => {
    const e0 = await link.estado(tokenBCD);
    const por = new Map(e0.itens.map((i) => [i.temaId, i]));
    expect(por.get('negocio')).toMatchObject({ modo: 'confirmar', interpretado: false });
    expect(por.get('negocio')?.fonte).toContain('Da reunião de 30/09 · 00:04:12');
    expect(por.get('cliente-ideal')?.fonte).toContain('aprovado pela Root');
    expect(por.get('d-status')?.modo).toBe('responder');
    expect(por.get('regras-da-casa')?.modo).toBe('responder');
    // O trecho da ata NÃO vai ao cliente — só a proposta, o minuto e a etiqueta.
    // (o trecho começa com "A gente vende"; a proposta, com "Vendemos".)
    expect(JSON.stringify(e0)).not.toContain('A gente vende peça');
    expect(JSON.stringify(e0)).not.toContain('fonteTrecho');

    const aposConfirmar = await link.confirmar(tokenBCD, 'negocio', 'Marcos');
    // Confirmou: a nota acende e o índice passa a ligá-la.
    expect(aposConfirmar.teia.nos.find((n) => n.id === 'negocio')?.estado).toBe('pronta');
    expect(aposConfirmar.teia.nos.find((n) => n.id === 'indice')?.ligacoes).toContain('negocio');
    await link.confirmar(tokenBCD, 'cliente-ideal', 'Marcos');
    // ATÉ O BOTÃO FINAL, TUDO SE REFAZ: quem confirmou corrige (a procedência fica), quem corrigiu volta ao que ouvimos.
    const corrigidoDepois = await link.corrigir(tokenBCD, 'cliente-ideal', 'Dá certo com transportadora de dez veículos ou mais.', 'Marcos');
    const ci = corrigidoDepois.itens.find((i) => i.temaId === 'cliente-ideal');
    expect(ci).toMatchObject({ status: 'corrigido', modo: 'feito' });
    expect(ci?.fonte).toContain('Da reunião de 30/09');
    expect(ci?.respondidoEm).toBeTruthy();
    const voltou = await link.confirmar(tokenBCD, 'cliente-ideal', 'Marcos');
    expect(voltou.itens.find((i) => i.temaId === 'cliente-ideal')).toMatchObject({ status: 'confirmado' });
    // Resposta LIVRE num tema com proposta apaga a procedência da reunião.
    const livre = await link.responder(tokenBCD, 'oferta-e-preco', 'Cobramos por peça e o contrato é mensal.', 'Marcos');
    const oferta = livre.itens.find((i) => i.temaId === 'oferta-e-preco');
    expect(oferta).toMatchObject({ status: 'respondido', fonte: null });
    // Respondeu livre: confirmar não vale mais (a procedência já foi embora), mas responder de novo vale.
    await expect(link.confirmar(tokenBCD, 'oferta-e-preco', 'Marcos')).rejects.toThrow(/não há proposta/);
    const deNovo = await link.responder(tokenBCD, 'oferta-e-preco', 'Cobramos por peça; contrato mensal para os grandes.', 'Marcos');
    expect(deNovo.itens.find((i) => i.temaId === 'oferta-e-preco')?.textoFinal).toContain('contrato mensal');
    await link.confirmar(tokenBCD, 'numeros-que-importam', 'Marcos');
    await link.corrigir(tokenBCD, 'vocabulario', '"Giro" são 60 peças, não 40. O resto está certo.', 'Marcos');
    await link.confirmar(tokenBCD, 'canais', 'Marcos');
    await link.confirmar(tokenBCD, 'd-dupla', 'Marcos');
    await link.confirmar(tokenBCD, 'd-acessos', 'Marcos');
    await expect(link.confirmar(tokenBCD, 'regras-da-casa', 'Marcos')).rejects.toThrow(/não há proposta/);

    const audio = await link.responderPorAudio(tokenBCD, 'regras-da-casa', Buffer.from('fake'), 'audio/webm', 'Marcos');
    expect(audio.texto).toContain('oito por cento');
    expect(audio.estado.itens.find((i) => i.temaId === 'regras-da-casa')).toMatchObject({ status: 'respondido', respondidoVia: 'audio' });

    await expect(link.concluir(tokenBCD, 'Marcos')).rejects.toMatchObject({
      response: { faltando: expect.arrayContaining(['A pergunta da primeira semana']) },
    });
    await link.responder(tokenBCD, 'c-desejo', 'Saber o aberto por cliente sem abrir planilha.', 'Marcos');
    await link.responder(tokenBCD, 'd-linha-de-base', 'Hoje: 6 horas por semana conferindo o aberto. Medi eu, semana passada.', 'Marcos');
    await link.responder(tokenBCD, 'd-ambiente', 'Windows 11, o Júnior é admin, antivírus da empresa.', 'Marcos');
    await link.responder(tokenBCD, 'd-primeira-pergunta', 'Quais clientes com contrato estão com títulos no aberto há mais de 15 dias?', 'Marcos');
    await link.responder(tokenBCD, 'd-status', 'No grupo, toda sexta.', 'Marcos');

    const fim = await link.concluir(tokenBCD, 'Marcos');
    expect(fim.retrato).not.toBeNull();
    expect(fim.retrato?.partes.map((p) => p.temaId)).toContain('negocio');
    expect(fim.retrato?.partes.find((p) => p.temaId === 'vocabulario')?.fonte).toContain('corrigido por Marcos');
    expect(fim.retrato?.partes.find((p) => p.temaId === 'regras-da-casa')?.fonte).toContain('por áudio');
    expect(fim.retrato?.primeiraPergunta.resposta).toContain('Ainda não consigo responder');

    const t = await naRoot(() => trilhos.obter(rootId, trilhoId));
    expect(t.convites.find((c) => c.blocos === 'BCD')?.estado).toBe('concluido');
    expect(t.marcos.map((m) => m.tipo)).toContain('convite.concluido');
  });

  it('a bancada não mexe no que o cliente já respondeu; ler a ata de novo preserva', async () => {
    await expect(naRoot(() => trilhos.decidirItem(rootId, trilhoId, 'negocio', 'descartar', null, quem))).rejects.toThrow(/já respondeu/);
    const r = await naRoot(() => leitura.lerAta(rootId, trilhoId, { tipo: 'texto', texto: ATA }, quem));
    expect(r.preservadas).toContain('negocio');
    const t = await naRoot(() => trilhos.obter(rootId, trilhoId));
    expect(t.itens_.find((i) => i.temaId === 'negocio')?.status).toBe('confirmado');
  });

  it('a empresa do cliente é provisionada e a memória dela recebe as notas com chave estável e procedência', async () => {
    const t = await naRoot(() => trilhos.provisionarEmpresa(rootId, trilhoId, quem));
    expect(t.empresaId).toBeTruthy();
    criadas.push(t.empresaId!);

    const carga = await naRoot(() => trilhos.carregarMemoria(rootId, trilhoId, quem));
    expect(carga.carregados).toBeGreaterThanOrEqual(13);

    const notas = await prisma.contextItem.findMany({ where: { orgId: t.empresaId! }, select: { chave: true, body: true, sourceType: true, sourceRef: true, kind: true } });
    const negocio = notas.find((n) => n.chave === 'onboarding:negocio');
    expect(negocio?.body).toContain('frota pesada');
    // A resposta livre não cita o kickoff na procedência.
    expect(notas.find((n) => n.chave === 'onboarding:oferta-e-preco')?.sourceRef).not.toContain('kickoff');
    expect(negocio?.sourceType).toBe('operador');
    expect(negocio?.sourceRef).toContain('kickoff 2026-09-30 00:04:12');
    expect(negocio?.sourceRef).toContain('confirmado por Marcos');
    expect(negocio?.kind).toBe('fato');
    expect(notas.find((n) => n.chave === 'onboarding:regras-da-casa')?.kind).toBe('regra');
    expect(notas.find((n) => n.chave === 'onboarding:retrato')).toBeTruthy();
    // A nota da conversa (marco `ata.notas`) também entrou, com o minuto na procedência.
    const daConversa = notas.find((n) => n.chave === 'onboarding:ata:frota-pesada');
    expect(daConversa?.body).toContain('Caminhão e ônibus');
    expect(daConversa?.kind).toBe('nota');
    expect(daConversa?.sourceRef).toContain('ata 2026-09-30 00:04:12');
    // A linha de base do bloco D entrou como fato na memória do cliente.
    expect(notas.find((n) => n.chave === 'onboarding:d-linha-de-base')?.body).toContain('6 horas');

    // Idempotente: rodar de novo não regrava.
    const segunda = await naRoot(() => trilhos.carregarMemoria(rootId, trilhoId, quem));
    expect(segunda.carregados).toBe(0);
  });

  it('o portão da fase 2 exige entrada, dupla, linha de base e ambiente — e aí avança para a imersão', async () => {
    const antes = await naRoot(() => trilhos.obter(rootId, trilhoId));
    expect(antes.faltando).toContain('entrada compensada (card 02)');
    await naRoot(() =>
      trilhos.atualizar(rootId, trilhoId, {
        portoes: {
          entradaCompensadaEm: '2026-10-09',
          dupla: { donoPerguntas: { nome: 'Marcos', papel: 'sócio' }, guardiaoAcesso: { nome: 'Júnior', papel: 'TI' } },
          linhaDeBase: { metrica: 'horas por semana conferindo o aberto', valor: 6, unidade: 'h', medidoEm: '2026-10-01', quemMediu: 'Marcos' },
          ambienteOkEm: '2026-10-14',
        },
        proximoPasso: 'imersão dia 1',
        proximoPassoDono: 'Pedro',
        proximoPassoEm: '2026-10-15',
        imersaoEm: '2026-10-15',
      }, quem),
    );
    const t = await naRoot(() => trilhos.avancar(rootId, trilhoId, quem));
    expect(t.fase).toBe('imersao');
    expect(t.portoesNaTela.map((p) => p.chave)).toEqual(['criterio', 'proximo-passo']);
  });

  it('o relógio acha o lembrete no dia 3 e grava o marco com a mensagem pronta', async () => {
    const outro = await naRoot(() => trilhos.criar(rootId, { cliente: `Curral ${MARCA}`, contatoNome: 'Ana' }, quem));
    const c = await naRoot(() => trilhos.gerarConvite(rootId, outro.id, 'A', quem));
    await naRoot(() => trilhos.marcarEnviado(rootId, outro.id, c.conviteId, quem));
    const daqui4Dias = new Date(Date.now() + 4 * 86_400_000);
    const pend = await naRoot(() => trilhos.pendencias(rootId, 7, daqui4Dias));
    const lembrete = pend.find((p) => p.trilhoId === outro.id && p.tipo === 'convite.lembrete');
    expect(lembrete).toBeTruthy();
    expect(pend.find((p) => p.trilhoId === outro.id && p.tipo === 'sem-proximo-passo')).toBeTruthy();

    await naRoot(() => trilhos.registrarPendencia(rootId, lembrete!));
    const depois = await naRoot(() => trilhos.obter(rootId, outro.id));
    expect(depois.convites[0].lembradoEm).toBeTruthy();
    const marco = depois.marcos.find((m) => m.tipo === 'convite.lembrete');
    expect(marco?.quem).toBe('relógio do onboarding');
    // O marco NUNCA carrega a mensagem (ela leva o link vivo, e o rastro é append-only).
    expect(marco?.dados.mensagem).toBeUndefined();
    // Sem chave no ambiente, o marco diz que o link não pôde ser reescrito.
    if (!process.env.ENCRYPTION_KEY) expect(marco?.dados.aviso).toContain('ENCRYPTION_KEY');

    // No dia seguinte o mesmo lembrete não repete (marco recente).
    const pend2 = await naRoot(() => trilhos.pendencias(rootId, 7, daqui4Dias));
    expect(pend2.find((p) => p.trilhoId === outro.id && p.tipo === 'convite.lembrete')).toBeUndefined();
  });

  it('encerrar exige motivo e tira o trilho do relógio', async () => {
    const t = await naRoot(() => trilhos.encerrar(rootId, trilhoId, 'teste encerrado', quem));
    expect(t.fase).toBe('encerrado');
    await expect(link.estado(tokenBCD)).rejects.toThrow(/não encontrado/);
  });
});
