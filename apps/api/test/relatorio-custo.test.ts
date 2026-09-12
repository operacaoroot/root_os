import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  ActorType,
  AgentEstado,
  AgentTipo,
  PrismaClient,
  SessionCanal,
  SessionStatus,
  SessionStepTipo,
} from '@prisma/client';

import { EventLogService } from '../src/gateway/event-log.service';
import { TetoDeCustoIaService } from '../src/llm/teto-diario.service';
import {
  DIAS_MAXIMO,
  DIAS_PADRAO,
  NAO_COBERTO,
  PERCENTUAL_ALERTA_PADRAO,
  RelatorioDeCustoIaService,
  RelatorioForaDoContextoError,
  percentualDeAlerta,
} from '../src/llm/relatorio-custo.service';
import { comContexto, novaCorrelacao } from '../src/common/contexto-execucao';
import type { PrismaService } from '../src/prisma/prisma.service';

/* ==========================================================================
 * O RELATÓRIO DE CUSTO DE IA — fatia 6.4 (RF-B-03)
 * ==========================================================================
 *
 * POR QUE ESTE ARQUIVO EXISTE, e por que ele precisa de banco de verdade.
 *
 * O eixo por AGENTE sai de uma CONSULTA BRUTA — `to_char(... AT TIME ZONE ...)`,
 * `FILTER (WHERE ...)`, três junções e nomes de coluna entre aspas. Nada disso é
 * conferido pelo TypeScript: um nome errado, um `FILTER` mal posto ou um fuso
 * que o Postgres não conheça só aparecem quando a instrução roda. E até a
 * correção desta fatia ela NUNCA tinha rodado — nem em produção (o serviço não
 * estava declarado em módulo nenhum e nenhuma rota o alcançava), nem em teste (a
 * pasta de teste da API não era da fatia).
 *
 * O que cada bloco prova:
 *
 *  1. A CONSULTA BRUTA RODA e devolve o que promete — agrupada por agente e por
 *     dia, com o dinheiro filtrado por `custoEstimado`.
 *  2. O RÓTULO DO DIA SAI DO FUSO DA EMPRESA, conferido dígito a dígito contra a
 *     mesma resposta calculada pelo ICU do Node — duas implementações
 *     independentes (tzdata do Postgres × ICU) sobre os mesmos instantes,
 *     incluindo leste do meridiano e virada de horário de verão.
 *  3. SEM LIVRO-CAIXA, O RELATÓRIO RECUSA O TOTAL. É o defeito que reprovou a
 *     fatia: toda empresa de hoje cai nesse caso.
 *  4. A GUARDA PRÓPRIA fecha para quem chega sem contexto de execução.
 *  5. A CONFERÊNCIA bate sobre as mesmas linhas, no mesmo instantâneo.
 *
 * Pede `TEST_DATABASE_URL` e se pula sem ela — a mesma regra de `porta.test.ts`.
 * Rodado no Postgres descartável do host durante a correção.
 * ========================================================================== */

const URL = process.env.TEST_DATABASE_URL;

const ORG_COM_LIVRO = 'org-custo-ia-com-livro';
const ORG_SEM_LIVRO = 'org-custo-ia-sem-livro';
const FUSO = 'America/Sao_Paulo';

/** O rótulo do dia, pelo ICU do Node — a segunda implementação da conferência. */
function diaPorIntl(fuso: string, quando: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso }).format(quando);
}

/* ---------------------------------------------------------------------------
 * O que roda SEM banco: a procedência declarada e o limiar do alerta.
 * ------------------------------------------------------------------------ */

describe('o que este painel não mede — procedência, não chute', () => {
  /*
   * CONTROLE NEGATIVO. A versão anterior deste arquivo imprimia "US$ 50 a 60 por
   * mês" como ordem de grandeza do embedding, com a procedência "medido fora
   * deste painel, na fatura do provedor". Essa medição não existe em arquivo
   * nenhum do repositório: era número de dinheiro inventado com procedência
   * fabricada, num painel cuja razão de existir é não deixar isso acontecer.
   */
  it('CONTROLE NEGATIVO: nenhuma ordem de grandeza carrega valor em dinheiro', () => {
    expect(NAO_COBERTO.length).toBeGreaterThan(0);
    for (const item of NAO_COBERTO) {
      expect(item.ordemDeGrandeza).toBe('não medido');
      expect(item.procedencia).not.toMatch(/US\$|\bUSD\b/);
    }
  });

  it('a EXISTÊNCIA do buraco continua declarada, com o lugar', () => {
    const embedding = NAO_COBERTO.find((n) => n.oQue.includes('Vetorização'));
    expect(embedding).toBeDefined();
    expect(embedding!.onde).toContain('obsidian');
    expect(embedding!.onde).toContain('pauta');
    // a fonte da afirmação é a catraca de arquitetura, e ela é citada por nome
    expect(embedding!.procedencia).toContain('arquitetura.test.ts');
  });
});

describe('o limiar do alerta vem do ambiente', () => {
  const original = process.env.TETO_IA_ALERTA_PERCENT;
  const repor = () => {
    if (original === undefined) delete process.env.TETO_IA_ALERTA_PERCENT;
    else process.env.TETO_IA_ALERTA_PERCENT = original;
  };

  it('valor válido vale; inválido cai no padrão em vez de virar alerta morto', () => {
    process.env.TETO_IA_ALERTA_PERCENT = '65';
    expect(percentualDeAlerta()).toBe(65);

    // 0% nunca dispararia; negativo dispararia sempre. Os dois viram padrão.
    process.env.TETO_IA_ALERTA_PERCENT = '0';
    expect(percentualDeAlerta()).toBe(PERCENTUAL_ALERTA_PADRAO);
    process.env.TETO_IA_ALERTA_PERCENT = '-5';
    expect(percentualDeAlerta()).toBe(PERCENTUAL_ALERTA_PADRAO);
    process.env.TETO_IA_ALERTA_PERCENT = 'muito';
    expect(percentualDeAlerta()).toBe(PERCENTUAL_ALERTA_PADRAO);
    // string vazia é o que o compose entrega para variável não preenchida
    process.env.TETO_IA_ALERTA_PERCENT = '';
    expect(percentualDeAlerta()).toBe(PERCENTUAL_ALERTA_PADRAO);

    repor();
  });
});

/* ---------------------------------------------------------------------------
 * O que precisa de banco.
 * ------------------------------------------------------------------------ */

describe.skipIf(!URL)('o relatório de custo de IA, contra um Postgres de verdade', () => {
  let prisma: PrismaClient;
  let p: PrismaService;
  let svc: RelatorioDeCustoIaService;

  const noContexto = <T>(orgId: string, fn: () => Promise<T>): Promise<T> =>
    comContexto(
      {
        orgId,
        actorType: ActorType.user,
        actorId: 'teste',
        correlationId: novaCorrelacao('teste'),
        origem: 'script',
      },
      fn,
    );

  /** Um passo de MODELO, com custo, na sessão do agente. */
  async function passoDeModelo(p2: {
    orgId: string;
    sessionId: string;
    ordem: number;
    custoUsd: number;
    custoEstimado: boolean;
    quando: Date;
  }): Promise<void> {
    await prisma.sessionStep.create({
      data: {
        orgId: p2.orgId,
        sessionId: p2.sessionId,
        ordem: p2.ordem,
        tipo: SessionStepTipo.modelo,
        custoUsd: p2.custoUsd,
        custoEstimado: p2.custoEstimado,
        criadoEm: p2.quando,
      },
    });
  }

  async function semear(orgId: string, comLivroCaixa: boolean): Promise<string> {
    await prisma.org.upsert({
      where: { id: orgId },
      create: { id: orgId, name: orgId, slug: orgId },
      update: {},
    });
    const agente = await prisma.agent.upsert({
      where: { orgId_slug: { orgId, slug: 'analista' } },
      create: {
        orgId,
        slug: 'analista',
        nome: 'Analista',
        iniciais: 'AN',
        missao: 'medir custo',
        tipo: AgentTipo.llm,
        estado: AgentEstado.rodando,
        capacidades: [],
      },
      update: {},
    });
    const sessao = await prisma.session.create({
      data: {
        orgId,
        agentId: agente.id,
        canal: SessionCanal.web,
        solicitanteRotulo: 'teste',
        pedido: 'quanto custou',
        status: SessionStatus.respondida,
      },
    });

    const agora = new Date();
    // Dois passos MEDIDOS (US$ 3,00) e um NÃO MEDIDO (modelo servido fora da
    // tabela de preço: `custoEstimado` falso, custo 0 por falta de preço).
    await passoDeModelo({ orgId, sessionId: sessao.id, ordem: 1, custoUsd: 2, custoEstimado: true, quando: agora });
    await passoDeModelo({ orgId, sessionId: sessao.id, ordem: 2, custoUsd: 1, custoEstimado: true, quando: agora });
    await passoDeModelo({ orgId, sessionId: sessao.id, ordem: 3, custoUsd: 0, custoEstimado: false, quando: agora });
    // Um passo de FERRAMENTA: sem custo, e não pode ser contado como passo de
    // modelo não medido — ele nunca teve custo a medir.
    await prisma.sessionStep.create({
      data: {
        orgId,
        sessionId: sessao.id,
        ordem: 4,
        tipo: SessionStepTipo.ferramenta,
        capacidade: 'clickup.tarefa.listar',
        criadoEm: agora,
      },
    });

    if (comLivroCaixa) {
      await prisma.tetoDeCustoIa.upsert({
        where: { orgId },
        create: { orgId, tetoDiarioUsd: 25, fusoHorario: FUSO, motivo: 'teste da fatia 6.4' },
        update: { tetoDiarioUsd: 25, ativo: true, fusoHorario: FUSO },
      });
      const hoje = diaPorIntl(FUSO, agora);
      await prisma.gastoDeIaNoDia.upsert({
        where: { orgId_dia: { orgId, dia: hoje } },
        create: {
          orgId,
          dia: hoje,
          gastoUsd: 3,
          gastoEstimadoUsd: 7.5,
          chamadas: 4,
          chamadasSemPreco: 1,
          cortes: 2,
        },
        update: { gastoUsd: 3, gastoEstimadoUsd: 7.5, chamadas: 4, chamadasSemPreco: 1, cortes: 2 },
      });
    }
    return sessao.id;
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    p = prisma as unknown as PrismaService;
    svc = new RelatorioDeCustoIaService(p, new TetoDeCustoIaService(p, new EventLogService(p)));
    await limpar();
    await semear(ORG_COM_LIVRO, true);
    await semear(ORG_SEM_LIVRO, false);
  });

  afterAll(async () => {
    await limpar();
    await prisma.$disconnect();
  });

  async function limpar(): Promise<void> {
    const orgs = [ORG_COM_LIVRO, ORG_SEM_LIVRO];
    await prisma.sessionStep.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.session.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.agent.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.gastoDeIaNoDia.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.tetoDeCustoIa.deleteMany({ where: { orgId: { in: orgs } } });
    await prisma.org.deleteMany({ where: { id: { in: orgs } } });
  }

  // -------------------------------------------------------------------------
  // 1. A CONSULTA BRUTA — a que nunca tinha rodado
  // -------------------------------------------------------------------------

  it('a consulta bruta do eixo por agente EXECUTA e devolve o agente', async () => {
    const r = await noContexto(ORG_COM_LIVRO, () => svc.relatorio(ORG_COM_LIVRO, 7));

    expect(r.porAgente).toHaveLength(1);
    const a = r.porAgente[0];
    expect(a.slug).toBe('analista');
    expect(a.nome).toBe('Analista');
    expect(a.iniciais).toBe('AN');
    expect(a.sessoes).toBe(1);
    expect(a.ultimoEm).not.toBeNull();
  });

  it('o dinheiro do eixo por agente respeita o filtro de `custoEstimado`', async () => {
    const r = await noContexto(ORG_COM_LIVRO, () => svc.relatorio(ORG_COM_LIVRO, 7));
    const a = r.porAgente[0];

    // 2 + 1 medidos; o terceiro passo não tem preço e NÃO entra como zero.
    expect(a.medidoUsd).toBe(3);
    expect(a.passos).toBe(3);
    expect(a.passosNaoMedidos).toBe(1);
    expect(r.atribuidoAAgenteUsd).toBe(3);
  });

  /*
   * CONTROLE NEGATIVO do filtro `custoUsd IS NOT NULL`. O passo de FERRAMENTA
   * está na mesma sessão e no mesmo instante. Tirar o filtro o traria para a
   * conta e `passosNaoMedidos` passaria de 1 para 2 — diluindo a medida de
   * "quanto do gasto não pôde ser medido" com passos que nunca tiveram custo.
   */
  it('CONTROLE NEGATIVO: passo de ferramenta não entra no eixo de custo', async () => {
    const r = await noContexto(ORG_COM_LIVRO, () => svc.relatorio(ORG_COM_LIVRO, 7));
    const naSessao = await prisma.sessionStep.count({ where: { orgId: ORG_COM_LIVRO } });
    expect(naSessao).toBe(4);
    expect(r.porAgente[0].passos).toBe(3);
    expect(r.porAgente[0].passosNaoMedidos).toBe(1);
  });

  it('o cruzamento agente × dia sai com o mesmo dinheiro do eixo por agente', async () => {
    const r = await noContexto(ORG_COM_LIVRO, () => svc.relatorio(ORG_COM_LIVRO, 7));
    const soma = r.porAgenteEDia.reduce((t, l) => t + l.medidoUsd, 0);
    expect(Number(soma.toFixed(6))).toBe(r.atribuidoAAgenteUsd);
    for (const l of r.porAgenteEDia) expect(l.dia).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // -------------------------------------------------------------------------
  // 2. O FUSO — Postgres contra ICU, dígito a dígito
  // -------------------------------------------------------------------------

  it('o rótulo do dia sai do fuso da empresa, e bate com o ICU do Node', async () => {
    const casos: Array<{ fuso: string; instante: string; esperado: string; porque: string }> = [
      { fuso: 'America/Sao_Paulo', instante: '2026-09-11T02:30:00Z', esperado: '2026-09-10', porque: 'UTC-3: ainda é ontem às 23h30' },
      { fuso: 'America/Sao_Paulo', instante: '2026-09-11T03:00:00Z', esperado: '2026-09-11', porque: 'a virada exata do dia em SP' },
      { fuso: 'UTC', instante: '2026-09-11T23:59:59Z', esperado: '2026-09-11', porque: 'o último segundo do dia em UTC' },
      { fuso: 'Asia/Tokyo', instante: '2026-09-11T15:00:00Z', esperado: '2026-09-12', porque: 'leste do meridiano: já é amanhã' },
      { fuso: 'Pacific/Kiritimati', instante: '2026-09-11T10:00:00Z', esperado: '2026-09-12', porque: 'UTC+14, o fuso mais adiantado que existe' },
      { fuso: 'America/Los_Angeles', instante: '2026-11-01T08:30:00Z', esperado: '2026-11-01', porque: '01h30 PDT, antes de o horário de verão acabar' },
      { fuso: 'America/Los_Angeles', instante: '2026-11-01T09:30:00Z', esperado: '2026-11-01', porque: '01h30 PST, a MESMA hora de parede com outro deslocamento' },
      { fuso: 'Pacific/Auckland', instante: '2026-09-27T12:30:00Z', esperado: '2026-09-28', porque: 'já em horário de verão (+13), vira o dia' },
    ];

    /*
     * O `::timestamptz AT TIME ZONE 'UTC'` DE DENTRO não é parte da expressão de
     * produção: ele reproduz o que o Prisma GRAVA na coluna. `SessionStep.criadoEm`
     * é `timestamp WITHOUT time zone` (o padrão do Prisma no Postgres), isto é,
     * hora de parede em UTC, sem deslocamento. As duas conversões de FORA —
     * `AT TIME ZONE 'UTC'` e `AT TIME ZONE <fuso>` — são a expressão do relatório,
     * letra por letra. Alimentar a expressão com um `timestamptz` cru daria outra
     * resposta e o teste estaria medindo uma consulta que não existe.
     */
    for (const c of casos) {
      const [linha] = await prisma.$queryRaw<Array<{ dia: string }>>`
        SELECT to_char(
                 ((${new Date(c.instante)}::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
                   AT TIME ZONE ${c.fuso},
                 'YYYY-MM-DD') AS "dia"
      `;
      expect(linha.dia, `${c.fuso} @ ${c.instante} — ${c.porque}`).toBe(c.esperado);
      // e a mesma resposta pela outra implementação: tzdata do Postgres × ICU
      expect(diaPorIntl(c.fuso, new Date(c.instante)), `ICU discorda em ${c.fuso}`).toBe(
        c.esperado,
      );
    }
  });

  /*
   * E a mesma pergunta pelo CAMINHO DE VERDADE: passo gravado pelo Prisma,
   * relatório montado pelo serviço, fuso lido da configuração da empresa. A
   * conferência de cima prova a expressão; esta prova que a expressão está ligada
   * ao fuso CERTO — o da empresa, e não o do processo nem o do banco.
   */
  it('o rótulo do dia do serviço sai no fuso da EMPRESA, e não no do processo', async () => {
    const ORG_FUSO = 'org-custo-ia-fuso';
    await semear(ORG_FUSO, true);
    const agora = new Date();
    try {
      for (const fuso of ['America/Sao_Paulo', 'Pacific/Kiritimati', 'Asia/Tokyo', 'UTC']) {
        await prisma.tetoDeCustoIa.update({
          where: { orgId: ORG_FUSO },
          data: { fusoHorario: fuso },
        });
        const r = await noContexto(ORG_FUSO, () => svc.relatorio(ORG_FUSO, 7));
        const esperado = diaPorIntl(fuso, agora);
        expect(r.fusoHorario, fuso).toBe(fuso);
        expect(r.ate, `o fim da janela em ${fuso}`).toBe(esperado);
        expect(r.porAgenteEDia.length, `nenhum passo em ${fuso}`).toBeGreaterThan(0);
        for (const l of r.porAgenteEDia) expect(l.dia, `passo em ${fuso}`).toBe(esperado);
      }
    } finally {
      await prisma.sessionStep.deleteMany({ where: { orgId: ORG_FUSO } });
      await prisma.session.deleteMany({ where: { orgId: ORG_FUSO } });
      await prisma.agent.deleteMany({ where: { orgId: ORG_FUSO } });
      await prisma.gastoDeIaNoDia.deleteMany({ where: { orgId: ORG_FUSO } });
      await prisma.tetoDeCustoIa.deleteMany({ where: { orgId: ORG_FUSO } });
      await prisma.org.deleteMany({ where: { id: ORG_FUSO } });
    }
  });

  // -------------------------------------------------------------------------
  // 3. SEM LIVRO-CAIXA, SEM TOTAL — o defeito que reprovou a fatia
  // -------------------------------------------------------------------------

  /*
   * CONTROLE NEGATIVO, e é o caso de TODA empresa do produto hoje: nada cria a
   * linha de `TetoDeCustoIa`, então `reservar()` devolve `null` e nenhuma linha
   * de `GastoDeIaNoDia` nasce. Sem a recusa, este relatório devolveria
   * `conferencia.medidoUsd = 0` com `linhas = 0`, e a tela imprimiria
   * "custo medido US$ 0,00 · conferido com o banco" com US$ 3,00 na tabela por
   * agente logo acima.
   */
  it('CONTROLE NEGATIVO: empresa sem teto tem gasto medido e NENHUMA linha no livro-caixa', async () => {
    const r = await noContexto(ORG_SEM_LIVRO, () => svc.relatorio(ORG_SEM_LIVRO, 7));

    expect(r.teto.configurado).toBe(false);
    expect(r.hoje).toBeNull();
    expect(r.porDia).toEqual([]);
    expect(r.conferencia).toEqual({ medidoUsd: 0, estimadoUsd: 0, chamadas: 0, linhas: 0 });

    // o gasto existe, e está provado pelos passos
    expect(r.atribuidoAAgenteUsd).toBe(3);
    expect(r.livroCaixa.passosComCusto).toBe(3);
    expect(r.livroCaixa.gastoDosPassosUsd).toBe(3);

    // e por isso o total é RECUSADO, com o motivo escrito
    expect(r.livroCaixa.totalConfiavel).toBe(false);
    expect(r.livroCaixa.motivo).toContain('NÃO tem teto configurado');
    expect(r.livroCaixa.motivo).toContain('não pode ser mostrado');
  });

  it('empresa sem gasto nenhum continua tendo total: zero de verdade é zero', async () => {
    const ORG_PARADA = 'org-custo-ia-parada';
    await prisma.org.upsert({
      where: { id: ORG_PARADA },
      create: { id: ORG_PARADA, name: ORG_PARADA, slug: ORG_PARADA },
      update: {},
    });
    try {
      const r = await noContexto(ORG_PARADA, () => svc.relatorio(ORG_PARADA, 7));
      expect(r.livroCaixa.passosComCusto).toBe(0);
      expect(r.livroCaixa.totalConfiavel).toBe(true);
      expect(r.livroCaixa.motivo).toBeNull();
    } finally {
      await prisma.org.deleteMany({ where: { id: ORG_PARADA } });
    }
  });

  it('com livro-caixa escrito, o total volta a existir e a conferência bate', async () => {
    const r = await noContexto(ORG_COM_LIVRO, () => svc.relatorio(ORG_COM_LIVRO, 7));

    expect(r.livroCaixa.totalConfiavel).toBe(true);
    expect(r.livroCaixa.linhas).toBe(1);
    expect(r.porDia).toHaveLength(1);
    expect(r.porDia[0].medidoUsd).toBe(3);
    expect(r.porDia[0].estimadoUsd).toBe(7.5);
    expect(r.porDia[0].chamadasSemPreco).toBe(1);
    expect(r.porDia[0].cortes).toBe(2);

    // a soma linha a linha contra o SUM()/COUNT() do banco, nos quatro campos
    expect(r.conferencia.medidoUsd).toBe(3);
    expect(r.conferencia.estimadoUsd).toBe(7.5);
    expect(r.conferencia.chamadas).toBe(4);
    expect(r.conferencia.linhas).toBe(r.porDia.length);
  });

  it('os números do teto vêm de UMA leitura só — a mesma que a porta usa', async () => {
    const r = await noContexto(ORG_COM_LIVRO, () => svc.relatorio(ORG_COM_LIVRO, 7));
    expect(r.hoje).not.toBeNull();
    expect(r.teto.tetoDiarioUsd).toBe(r.hoje!.tetoUsd);
    expect(r.teto.ativo).toBe(r.hoje!.ativo);
    expect(r.fusoHorario).toBe(r.hoje!.fusoHorario);
    // o que sobra da segunda leitura é só texto e data
    expect(r.teto.motivo).toBe('teste da fatia 6.4');
  });

  // -------------------------------------------------------------------------
  // 4. A GUARDA PRÓPRIA
  // -------------------------------------------------------------------------

  /*
   * CONTROLE NEGATIVO da falha fechada. O relatório também chama `consumo()`,
   * que lança no mesmo caso — mas aquele ramo é inalcançável por quem chega pela
   * rota, porque o interceptor abre o contexto antes do controlador. Os dois
   * casos abaixo são os chamadores que virão: script, cron, ferramenta de MCP.
   */
  it('CONTROLE NEGATIVO: sem contexto de execução, o relatório RECUSA em vez de zerar', async () => {
    await expect(svc.relatorio(ORG_COM_LIVRO, 7)).rejects.toBeInstanceOf(
      RelatorioForaDoContextoError,
    );
  });

  it('CONTROLE NEGATIVO: contexto de OUTRA empresa também recusa', async () => {
    await expect(
      noContexto(ORG_SEM_LIVRO, () => svc.relatorio(ORG_COM_LIVRO, 7)),
    ).rejects.toBeInstanceOf(RelatorioForaDoContextoError);
  });

  // -------------------------------------------------------------------------
  // 5. A JANELA
  // -------------------------------------------------------------------------

  it('a janela é aparada: padrão, mínimo e teto', async () => {
    const padrao = await noContexto(ORG_COM_LIVRO, () => svc.relatorio(ORG_COM_LIVRO));
    expect(padrao.dias).toBe(DIAS_PADRAO);

    const gigante = await noContexto(ORG_COM_LIVRO, () => svc.relatorio(ORG_COM_LIVRO, 5000));
    expect(gigante.dias).toBe(DIAS_MAXIMO);

    const negativo = await noContexto(ORG_COM_LIVRO, () => svc.relatorio(ORG_COM_LIVRO, -3));
    expect(negativo.dias).toBe(1);

    const lixo = await noContexto(ORG_COM_LIVRO, () =>
      svc.relatorio(ORG_COM_LIVRO, Number('trinta')),
    );
    expect(lixo.dias).toBe(DIAS_PADRAO);
  });

  it('uma empresa não enxerga o gasto da outra', async () => {
    const a = await noContexto(ORG_COM_LIVRO, () => svc.relatorio(ORG_COM_LIVRO, 7));
    const b = await noContexto(ORG_SEM_LIVRO, () => svc.relatorio(ORG_SEM_LIVRO, 7));
    expect(a.porDia).toHaveLength(1);
    expect(b.porDia).toHaveLength(0);
    expect(a.porAgente[0].medidoUsd).toBe(3);
    expect(b.porAgente[0].medidoUsd).toBe(3);
    expect(a.orgId).not.toBe(b.orgId);
  });
});
