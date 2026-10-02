import { Injectable, Logger } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventLogService } from '../gateway/event-log.service';
import { contextoAtual } from '../common/contexto-execucao';
import { estimarCustoUsd, type EstimativaDeCusto, type TamanhoDaEntrada } from './estimativa';
import { RecusaDeCustoDeIaError } from './recusa-de-custo';

/*
 * ============================================================================
 * ORÇAMENTO MENSAL DE IA POR AGENTE (fatia A3) — o quarto nível
 * ============================================================================
 *
 * OS TRÊS QUE JÁ EXISTIAM, e que este NÃO reescreve:
 *   · por EXECUÇÃO — `Agent.tetoCustoUsd`, imposto no laço de
 *     `agents/agent-runtime.service.ts`, passo a passo, com o custo real;
 *   · por TEMPO de execução — `Agent.tetoSegundos`, no mesmo laço;
 *   · por EMPRESA e por DIA — `TetoDeCustoIa`/`GastoDeIaNoDia`, com reserva,
 *     liquidação e coletor de reserva presa (`teto-diario.service.ts`).
 *
 * O que faltava é a pergunta que um dono de negócio faz, e que nenhum dos três
 * responde: **quanto este agente me custa por mês, e onde eu paro?**
 *
 * ----------------------------------------------------------------------------
 * POR QUE NÃO HÁ RESERVA NEM LIVRO-CAIXA AQUI
 * ----------------------------------------------------------------------------
 * O teto da empresa precisou de tabela própria por três razões. A PRIMEIRA é a
 * que sustentava a decisão: ALCANCE — nem toda chamada de modelo nasce de
 * sessão de agente (relatório, curadoria e pauta chamam `complete()` e não
 * deixam passo nenhum), então somar `SessionStep` deixaria de fora justamente o
 * gasto não vigiado.
 *
 * Essa razão não vale no eixo do AGENTE, e é o que muda o desenho: uma chamada
 * de um agente é, por definição, uma chamada dentro de uma sessão de agente — e
 * cada uma delas grava um `SessionStep` com o custo REAL informado pelo
 * provedor (`agent-runtime.service.ts`, "o passo do modelo é gravado SEMPRE").
 * O log de passos JÁ É o livro-caixa por agente: é dele que a tela de Custos
 * tira `porAgente` desde a fatia 6.4. Inventar uma segunda tabela contando o
 * mesmo dinheiro criaria duas respostas para a mesma pergunta — a doença que a
 * outra metade desta fatia foi consertar nas horas devolvidas.
 *
 * O QUE SE PERDE, DITO NA CARA:
 *
 *   1. O corte é "o mês JÁ estourou (ou estoura com esta chamada)" e não uma
 *      reserva atômica. Chamadas simultâneas podem passar juntas, cada uma
 *      somando o excesso dela. Contra um orçamento MENSAL — três ou quatro
 *      ordens de grandeza acima do custo de uma chamada — isso é ruído; contra
 *      um teto diário apertado seria buraco, e é por isso que o teto do DIA
 *      continua tendo reserva e continua valendo por cima deste.
 *   2. Não há contador de cortes em coluna. "Quantas vezes o orçamento deste
 *      agente barrou alguém" é pergunta para o RASTRO (`ia.recusada_por_orcamento`),
 *      que é onde cada recusa entra inteira, com causa própria.
 *
 * Como o teto do dia, ESTE É UMA LINHA DE PARADA, não um contrato financeiro: o
 * excesso possível é o de uma chamada sobre a própria estimativa.
 *
 * ----------------------------------------------------------------------------
 * O QUE ELE NÃO ALCANÇA (e não finge alcançar)
 * ----------------------------------------------------------------------------
 * VETORIZAÇÃO (embeddings) passa FORA do `LlmProvider`: `obsidian.service.ts` e
 * `pauta.service.ts` falam com `/embeddings` por `fetch` próprio. Aquele gasto
 * é real, é cobrado à parte pela OpenAI e não entra em nenhum número daqui —
 * exatamente como a tela de Custos já declara em `NAO_COBERTO`. Um orçamento
 * "por agente" que somasse embedding precisaria saber de qual agente é o
 * embedding, e ninguém sabe: quem reindexa vault é rotina, não agente.
 *
 * E PASSO COM MODELO SEM PREÇO não soma dinheiro nenhum (o custo é 0 por falta
 * de preço, não por ser grátis). Por isso, com o orçamento VALENDO, modelo fora
 * de `preco.ts` é RECUSADO — mesma doutrina do teto da empresa: controle que
 * não sabe medir não é controle. `passosNaoMedidos` viaja no consumo para a
 * tela poder dizer quantos passos ficaram invisíveis ao orçamento.
 */

/** As causas de corte deste eixo. Rótulo estável — vai para o RASTRO. */
export type CausaDoCorteDoAgente =
  /** Orçamento valendo e em zero: decisão de que este agente não chama modelo. */
  | 'orcamento_zerado'
  /** Modelo fora da tabela de preço com orçamento valendo. Falha fechada. */
  | 'modelo_sem_preco'
  /** Uma única chamada custaria mais que o mês inteiro. */
  | 'chamada_maior_que_o_mes'
  /** O mês já comprometeu o orçamento. Volta na virada do mês. */
  | 'mes_no_teto';

export interface DetalheDoCorteDoAgente {
  orgId: string;
  agentSlug: string;
  /** `AAAA-MM` no fuso do agente. */
  mes: string;
  causa: CausaDoCorteDoAgente;
  orcamentoUsd: number;
  gastoUsd: number;
  estimativaUsd: number;
  modelo: string;
}

/**
 * A recusa por orçamento do agente.
 *
 * Herda de `RecusaDeCustoDeIaError` para ser tratada pela FAMÍLIA — o laço do
 * agente e o controlador precisam dar o mesmo desfecho que dão ao teto do dia
 * (encerrar a sessão como `recusada` e responder 429), e não um erro cru que
 * deixa a sessão pendurada. Ver `recusa-de-custo.ts`.
 */
export class OrcamentoDoAgenteEstouradoError extends RecusaDeCustoDeIaError {
  readonly nome = 'OrcamentoDoAgenteEstouradoError';
  readonly causa: string;
  constructor(
    motivo: string,
    readonly detalhe: DetalheDoCorteDoAgente,
  ) {
    super(detalhe.orgId, motivo);
    this.name = 'OrcamentoDoAgenteEstouradoError';
    // Prefixo `agente_` para não colidir com as causas do teto do dia: quem
    // agrupar o RASTRO precisa saber QUAL dos dois cortes barrou a chamada.
    this.causa = `agente_${detalhe.causa}`;
  }
}

/**
 * NÃO DEU PARA LER O ORÇAMENTO — que é coisa diferente de "este agente não tem
 * orçamento".
 *
 * Depois da virada para o papel restrito, uma consulta feita sem a empresa na
 * SESSÃO do banco não devolve erro: devolve VAZIO (`prisma/sessao-de-banco.ts`).
 * Entender esse vazio como "sem orçamento configurado" desliga o controle em
 * silêncio, que é o pior desfecho possível para um controle de gasto. É o mesmo
 * raciocínio — e o mesmo desenho — de `TetoIlegivelError`.
 */
export class OrcamentoIlegivelError extends Error {
  readonly nome = 'OrcamentoIlegivelError';
  constructor(
    readonly orgId: string,
    readonly agentSlug: string,
    readonly orgDaSessao: string | null,
  ) {
    super(
      `não dá para saber o orçamento mensal do agente "${agentSlug}" de "${orgId}": a sessão do ` +
        `banco está ${orgDaSessao ? `na empresa "${orgDaSessao}"` : 'sem empresa resolvida'} e o ` +
        'isolamento por linha esconderia a configuração. Abra o contexto de execução da empresa ' +
        '(`comContexto({ orgId, … })`) antes de chamar o modelo (RF-T-04).',
    );
    this.name = 'OrcamentoIlegivelError';
  }
}

/** O mês de um agente, como a tela e o corte precisam ler. */
export interface ConsumoDoMesDoAgente {
  agentSlug: string;
  nome: string;
  iniciais: string;
  /** `AAAA-MM` no fuso do agente. */
  mes: string;
  fusoHorario: string;
  /** `false` = ninguém definiu orçamento. Não é orçamento zero. */
  configurado: boolean;
  /** `false` = em observação: soma, mostra e NÃO corta. */
  ativo: boolean;
  orcamentoUsd: number;
  /** Custo REAL do provedor, somado dos passos do mês. */
  gastoUsd: number;
  passos: number;
  /** Passos cujo modelo servido não tem preço: não medido, não zero. */
  passosNaoMedidos: number;
  sessoes: number;
  /** `null` quando não há orçamento contra o qual comparar. */
  restanteUsd: number | null;
  /** 0..100+, arredondado. `null` sem orçamento, ou com orçamento zerado. */
  percentual: number | null;
  ultimoEm: string | null;
  definidoEm: string | null;
  definidoPor: string | null;
  motivo: string | null;
}

const FUSO_PADRAO = 'America/Sao_Paulo';
const DIA_MS = 24 * 60 * 60 * 1000;

/** Quatro casas — a mesma precisão da coluna `Decimal(10,4)` do orçamento. */
function arredondar(v: number): number {
  return Number((Number.isFinite(v) ? v : 0).toFixed(6));
}

/** `US$ 1,2345` — vírgula decimal, que é como se lê em português. */
function usd(v: number): string {
  return `US$ ${v.toFixed(4).replace('.', ',')}`;
}

/** `2026-09` -> `09/2026`. */
function mesBr(mes: string): string {
  const [a, m] = mes.split('-');
  return m ? `${m}/${a}` : mes;
}

interface LinhaDoMes {
  gastoUsd: number;
  passos: number;
  passosNaoMedidos: number;
  sessoes: number;
  ultimoEm: Date | null;
}

interface AgenteComOrcamento {
  id: string;
  slug: string;
  nome: string;
  iniciais: string;
  tz: string;
  orcamentoMensalUsd: unknown;
  orcamentoAtivo: boolean;
  orcamentoPorId: string | null;
  orcamentoEm: Date | null;
  orcamentoMotivo: string | null;
}

@Injectable()
export class OrcamentoDeAgenteService {
  private readonly log = new Logger('OrcamentoDeAgente');
  /** Fusos já reclamados — o aviso é uma vez por valor, não por chamada. */
  private readonly fusosInvalidos = new Set<string>();
  /** Agentes já reclamados por contexto divergente. Mesma regra. */
  private readonly contextosDivergentes = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: EventLogService,
  ) {}

  /** O mês do agente, em `AAAA-MM`, no fuso dele. */
  mesDoAgente(fusoHorario: string, agora: Date = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: this.fusoDe(fusoHorario),
      year: 'numeric',
      month: '2-digit',
    })
      .format(agora)
      .replace('/', '-')
      .slice(0, 7);
  }

  /**
   * CONFERE SE ESTE AGENTE PODE GASTAR — e recusa ANTES de o modelo ser chamado.
   *
   * Chamada pelo envelope (`provider-com-teto.ts`) em todo passo de agente.
   * Volta calada quando não há o que impor, que é o estado de todo agente antes
   * de alguém definir um valor.
   *
   * O CUSTO DESTA CONFERÊNCIA, medido em consultas: UMA leitura da linha do
   * agente (índice único `orgId+slug`) para quem não tem orçamento VALENDO — ou
   * seja, todo mundo hoje. A soma do mês, que é a consulta cara, só acontece
   * quando alguém ligou o orçamento daquele agente. Pôr a soma antes da
   * verificação de `ativo` faria o caminho mais quente do sistema pagar por um
   * controle que ninguém contratou.
   *
   * @throws OrcamentoDoAgenteEstouradoError quando não cabe.
   * @throws OrcamentoIlegivelError quando a sessão do banco não é da empresa.
   */
  async conferir(p: {
    orgId: string;
    agentSlug: string;
    modelo: string;
    entrada: TamanhoDaEntrada;
    tokensSaida: number;
  }): Promise<void> {
    const agente = await this.agente(p.orgId, p.agentSlug);
    // Agente que não existe nesta empresa não tem orçamento a impor. Quem
    // recusa passagem de agente inexistente é o laço, antes de chegar aqui.
    if (!agente || !agente.orcamentoAtivo) return;

    const fuso = this.fusoDe(agente.tz);
    const agora = new Date();
    const mes = this.mesDoAgente(fuso, agora);
    const orcamento = Number(agente.orcamentoMensalUsd);
    const est = estimarCustoUsd(p.modelo, { entrada: p.entrada, tokensSaida: p.tokensSaida });

    /*
     * ORÇAMENTO VALENDO E EM ZERO vem PRIMEIRO, antes até do modelo sem preço.
     * É a recusa mais específica que existe aqui — alguém decidiu que este
     * agente não chama modelo — e dizer "o modelo não tem preço" a quem
     * desligou o agente de propósito mandaria a pessoa cadastrar preço para um
     * agente que não vai rodar de qualquer jeito.
     */
    if (orcamento <= 0) {
      await this.recusar(p, agente, mes, orcamento, 0, est, 'orcamento_zerado');
    }

    /*
     * MODELO FORA DA TABELA DE PREÇO, COM ORÇAMENTO VALENDO: RECUSA.
     *
     * A alternativa era deixar passar, e ela não fecha: passo sem preço grava
     * custo 0 (por falta de dado, não por ser grátis), então um agente cujo
     * tráfego seja TODO de modelo fora da tabela nunca somaria nada e passaria
     * para sempre. O modelo padrão do `openrouter`
     * (`anthropic/claude-sonnet-5.5`) está na tabela e passa; a recusa vale só
     * para quem sobrescreve o modelo por um fora de `preco.ts`. Falha fechada,
     * com o mesmo argumento da régua para capacidade sem classificação.
     */
    if (!est.medivel) {
      await this.recusar(p, agente, mes, orcamento, 0, est, 'modelo_sem_preco');
    }

    if (est.usd > orcamento) {
      await this.recusar(p, agente, mes, orcamento, 0, est, 'chamada_maior_que_o_mes');
    }

    const linha = await this.somaDoMes(p.orgId, agente.id, fuso, mes, agora);
    const gasto = arredondar(linha.gastoUsd);

    /*
     * A SEGUNDA CONDIÇÃO (`gasto >= orcamento`) fecha o caso da estimativa
     * zero, que sem ela deixaria passar para sempre quem já encostou no
     * orçamento. É a mesma cláusula dupla da reserva do teto do dia.
     */
    if (gasto + est.usd > orcamento || gasto >= orcamento) {
      await this.recusar(p, agente, mes, orcamento, gasto, est, 'mes_no_teto');
    }
  }

  /**
   * O consumo do mês de UM agente. `null` = agente não existe nesta empresa.
   *
   * Só LÊ. Nunca recusa, nunca escreve — é o que a tela de Custos consome.
   */
  async consumo(orgId: string, agentSlug: string): Promise<ConsumoDoMesDoAgente | null> {
    const agente = await this.agente(orgId, agentSlug);
    if (!agente) return null;
    const fuso = this.fusoDe(agente.tz);
    const agora = new Date();
    const mes = this.mesDoAgente(fuso, agora);
    const linha = await this.somaDoMes(orgId, agente.id, fuso, mes, agora);
    return this.montar(agente, mes, linha, null);
  }

  /**
   * O PANORAMA — todos os agentes da empresa, com orçamento e gasto do mês.
   *
   * UMA consulta de agentes e UMA de soma, agrupada por agente; não N+1. A
   * tela de Custos mostra a lista inteira, e não só quem tem orçamento: agente
   * que gasta e não tem orçamento definido é justamente o que alguém precisa
   * ver para decidir um valor.
   *
   * Fusos DIFERENTES entre agentes são tratados um por um. Parece exagero para
   * uma empresa só, e não é: `Agent.tz` é por agente e já nasce com padrão
   * próprio, então dois agentes da mesma empresa podem estar em meses
   * diferentes na virada — e um deles somaria o mês errado se a consulta
   * assumisse um fuso único.
   */
  async panorama(orgId: string): Promise<ConsumoDoMesDoAgente[]> {
    const agentes = (await this.prisma.agent.findMany({
      where: { orgId },
      orderBy: [{ nome: 'asc' }],
      select: {
        id: true,
        slug: true,
        nome: true,
        iniciais: true,
        tz: true,
        orcamentoMensalUsd: true,
        orcamentoAtivo: true,
        orcamentoPorId: true,
        orcamentoEm: true,
        orcamentoMotivo: true,
      },
    })) as unknown as AgenteComOrcamento[];
    if (agentes.length === 0) return [];

    const agora = new Date();
    const porAgente = await this.somaDoMesPorAgente(orgId, agentes, agora);
    const donos = await this.nomesDeQuemDefiniu(
      orgId,
      agentes.map((a) => a.orcamentoPorId),
    );

    return agentes
      .map((a) => {
        const mes = this.mesDoAgente(this.fusoDe(a.tz), agora);
        return this.montar(
          a,
          mes,
          porAgente.get(`${a.id}|${mes}`) ?? {
            gastoUsd: 0,
            passos: 0,
            passosNaoMedidos: 0,
            sessoes: 0,
            ultimoEm: null,
          },
          a.orcamentoPorId ? (donos.get(a.orcamentoPorId) ?? null) : null,
        );
      })
      /*
       * Quem tem orçamento primeiro, e dentro de cada grupo o maior gasto. É a
       * ordem da pergunta que a tela responde: "quem está perto do limite?"
       * vem antes de "quem gasta sem limite nenhum?".
       */
      .sort((x, y) => {
        if (x.configurado !== y.configurado) return x.configurado ? -1 : 1;
        return y.gastoUsd - x.gastoUsd;
      });
  }

  // -------------------------------------------------------------------------

  private montar(
    a: AgenteComOrcamento,
    mes: string,
    linha: LinhaDoMes,
    definidoPor: string | null,
  ): ConsumoDoMesDoAgente {
    const orcamento = Number(a.orcamentoMensalUsd);
    const configurado = orcamento > 0 || a.orcamentoAtivo;
    const gasto = arredondar(linha.gastoUsd);
    return {
      agentSlug: a.slug,
      nome: a.nome,
      iniciais: a.iniciais,
      mes,
      fusoHorario: a.tz,
      configurado,
      ativo: a.orcamentoAtivo,
      orcamentoUsd: arredondar(orcamento),
      gastoUsd: gasto,
      passos: linha.passos,
      passosNaoMedidos: linha.passosNaoMedidos,
      sessoes: linha.sessoes,
      restanteUsd: configurado ? arredondar(Math.max(orcamento - gasto, 0)) : null,
      // Orçamento zerado não tem percentual: dividir por zero daria Infinity, e
      // "100% de US$ 0,00" descreveria como consumo o que é um agente parado.
      percentual: configurado && orcamento > 0 ? Math.round((gasto / orcamento) * 100) : null,
      ultimoEm: linha.ultimoEm?.toISOString() ?? null,
      definidoEm: a.orcamentoEm?.toISOString() ?? null,
      definidoPor,
      motivo: a.orcamentoMotivo,
    };
  }

  /**
   * A linha do agente — e a distinção entre "não existe" e "não consegui ler".
   * Ver `OrcamentoIlegivelError`. Mesmo desenho de `TetoDeCustoIa.configuracao`.
   */
  private async agente(orgId: string, slug: string): Promise<AgenteComOrcamento | null> {
    const a = (await this.prisma.agent.findFirst({
      where: { orgId, slug },
      select: {
        id: true,
        slug: true,
        nome: true,
        iniciais: true,
        tz: true,
        orcamentoMensalUsd: true,
        orcamentoAtivo: true,
        orcamentoPorId: true,
        orcamentoEm: true,
        orcamentoMotivo: true,
      },
    })) as unknown as AgenteComOrcamento | null;

    const daSessao = contextoAtual()?.orgId?.trim() || null;
    if (daSessao === orgId) return a;

    if (a) {
      const chave = `${orgId}|${slug}`;
      if (!this.contextosDivergentes.has(chave)) {
        this.contextosDivergentes.add(chave);
        this.log.warn(
          `orçamento do agente "${slug}" de "${orgId}" lido com a sessão do banco ` +
            `${daSessao ? `em "${daSessao}"` : 'sem empresa'}: hoje funciona porque a conexão é a ` +
            'dona das tabelas; sob o papel restrito devolveria vazio, em silêncio. Abra o contexto ' +
            'de execução da empresa antes de chamar o modelo.',
        );
      }
      return a;
    }
    throw new OrcamentoIlegivelError(orgId, slug, daSessao);
  }

  /** O fuso do agente, ou o padrão quando o configurado não existe. */
  private fusoDe(fusoHorario: string): string {
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: fusoHorario });
      return fusoHorario;
    } catch {
      if (!this.fusosInvalidos.has(fusoHorario)) {
        this.fusosInvalidos.add(fusoHorario);
        this.log.warn(
          `fuso "${fusoHorario}" não existe (Agent.tz). O mês do orçamento está sendo calculado ` +
            `em ${FUSO_PADRAO}.`,
        );
      }
      return FUSO_PADRAO;
    }
  }

  /**
   * A soma do mês de UM agente, direto do log de passos.
   *
   * `custoUsd IS NOT NULL` separa passo de MODELO de passo de ferramenta:
   * ferramenta nunca grava custo. `FILTER (WHERE "custoEstimado")` é o que
   * mantém a procedência do número — a coluna diz o CONTRÁRIO do que o nome
   * sugere (`true` = o modelo servido ESTÁ na tabela de preço; ver `preco.ts` e
   * o comentário de `Session.custoEstimado`), então com ela falsa o `custoUsd`
   * é 0 por falta de preço e somá-lo daria a chamada de graça.
   *
   * O CORTE EM UTC COM UM DIA DE FOLGA para trás, e nenhuma para frente: o
   * rótulo do mês sai do fuso do agente e o `criadoEm` do passo é UTC; um corte
   * exato deixaria de fora as primeiras horas do dia 1º em qualquer fuso a
   * oeste. A folga traz passo do mês anterior, e o `to_char` o joga fora — o
   * pré-filtro existe só para o índice `(orgId, criadoEm)` poder ser usado.
   */
  private async somaDoMes(
    orgId: string,
    agentId: string,
    fuso: string,
    mes: string,
    agora: Date,
  ): Promise<LinhaDoMes> {
    const desdeUtc = this.inicioAproximadoDoMes(mes, agora);
    const linhas = await this.prisma.$queryRaw<
      Array<{
        gastoUsd: number;
        passos: number;
        passosNaoMedidos: number;
        sessoes: number;
        ultimoEm: Date | null;
      }>
    >`
      SELECT COALESCE(SUM("p"."custoUsd") FILTER (WHERE "p"."custoEstimado"), 0)::float8 AS "gastoUsd",
             COUNT(*)::int AS "passos",
             COUNT(*) FILTER (WHERE NOT "p"."custoEstimado")::int AS "passosNaoMedidos",
             COUNT(DISTINCT "p"."sessionId")::int AS "sessoes",
             MAX("p"."criadoEm") AS "ultimoEm"
        FROM "SessionStep" "p"
        JOIN "Session" "s" ON "s"."id" = "p"."sessionId"
       WHERE "p"."orgId" = ${orgId}
         AND "s"."agentId" = ${agentId}
         AND "p"."custoUsd" IS NOT NULL
         AND "p"."criadoEm" >= ${desdeUtc}
         AND to_char(("p"."criadoEm" AT TIME ZONE 'UTC') AT TIME ZONE ${fuso}, 'YYYY-MM') = ${mes}
    `;
    const l = linhas[0];
    return {
      gastoUsd: Number(l?.gastoUsd ?? 0),
      passos: Number(l?.passos ?? 0),
      passosNaoMedidos: Number(l?.passosNaoMedidos ?? 0),
      sessoes: Number(l?.sessoes ?? 0),
      ultimoEm: l?.ultimoEm ?? null,
    };
  }

  /**
   * A mesma soma, para TODOS os agentes de uma vez — o panorama.
   *
   * A chave do mapa é `agentId|mes` porque agentes da mesma empresa podem estar
   * em fusos diferentes e, na virada, em meses diferentes: agrupar só por
   * agente faria um deles receber a soma do mês do vizinho.
   */
  private async somaDoMesPorAgente(
    orgId: string,
    agentes: readonly AgenteComOrcamento[],
    agora: Date,
  ): Promise<Map<string, LinhaDoMes>> {
    const meses = [...new Set(agentes.map((a) => this.mesDoAgente(this.fusoDe(a.tz), agora)))];
    const desdeUtc = new Date(
      Math.min(...meses.map((m) => this.inicioAproximadoDoMes(m, agora).getTime())),
    );

    const mapa = new Map<string, LinhaDoMes>();
    // Uma consulta por FUSO distinto, e não por agente: numa empresa normal é
    // uma só. O `to_char` precisa do fuso como literal da consulta, então não
    // há como cruzar fusos diferentes numa passada sem um `CASE` por agente.
    for (const fuso of new Set(agentes.map((a) => this.fusoDe(a.tz)))) {
      const ids = agentes.filter((a) => this.fusoDe(a.tz) === fuso).map((a) => a.id);
      const linhas = await this.prisma.$queryRaw<
        Array<{
          agentId: string;
          mes: string;
          gastoUsd: number;
          passos: number;
          passosNaoMedidos: number;
          sessoes: number;
          ultimoEm: Date | null;
        }>
      >`
        SELECT "s"."agentId" AS "agentId",
               to_char(("p"."criadoEm" AT TIME ZONE 'UTC') AT TIME ZONE ${fuso}, 'YYYY-MM') AS "mes",
               COALESCE(SUM("p"."custoUsd") FILTER (WHERE "p"."custoEstimado"), 0)::float8 AS "gastoUsd",
               COUNT(*)::int AS "passos",
               COUNT(*) FILTER (WHERE NOT "p"."custoEstimado")::int AS "passosNaoMedidos",
               COUNT(DISTINCT "p"."sessionId")::int AS "sessoes",
               MAX("p"."criadoEm") AS "ultimoEm"
          FROM "SessionStep" "p"
          JOIN "Session" "s" ON "s"."id" = "p"."sessionId"
         WHERE "p"."orgId" = ${orgId}
           AND "s"."agentId" = ANY(${ids})
           AND "p"."custoUsd" IS NOT NULL
           AND "p"."criadoEm" >= ${desdeUtc}
         GROUP BY 1, 2
      `;
      for (const l of linhas) {
        mapa.set(`${l.agentId}|${l.mes}`, {
          gastoUsd: Number(l.gastoUsd),
          passos: Number(l.passos),
          passosNaoMedidos: Number(l.passosNaoMedidos),
          sessoes: Number(l.sessoes),
          ultimoEm: l.ultimoEm,
        });
      }
    }
    return mapa;
  }

  /**
   * O começo do mês em UTC, com um dia de folga para trás. Ver `somaDoMes`.
   *
   * `mes` é rótulo (`AAAA-MM`), não instante: a conta é feita em UTC de
   * propósito, e a folga cobre a diferença de fuso em qualquer direção.
   */
  private inicioAproximadoDoMes(mes: string, agora: Date): Date {
    const base = new Date(`${mes}-01T00:00:00Z`);
    if (Number.isNaN(base.getTime())) return new Date(agora.getTime() - 31 * DIA_MS);
    return new Date(base.getTime() - DIA_MS);
  }

  /**
   * O nome de quem definiu cada orçamento, conferido contra ESTA empresa.
   *
   * Nunca por relação do Prisma: `include: { … }` traz usuário de qualquer
   * empresa — é a regra dos quatro lugares (`agents/donos-da-casa.ts`).
   * Ponteiro que não resolve sai NULO, nunca como identificador cru.
   */
  private async nomesDeQuemDefiniu(
    orgId: string,
    ids: readonly (string | null)[],
  ): Promise<Map<string, string>> {
    const limpos = [...new Set(ids.filter((i): i is string => !!i))];
    if (limpos.length === 0) return new Map();
    const gente = await this.prisma.user.findMany({
      where: { orgId, id: { in: limpos } },
      select: { id: true, name: true },
    });
    return new Map(gente.map((g) => [g.id, g.name]));
  }

  /**
   * Conta o corte no RASTRO e LANÇA. Nunca volta.
   *
   * O evento é gravado em melhor esforço: aqui a chamada já NÃO vai acontecer, e
   * uma falha ao escrever o registro não pode transformar uma recusa em
   * permissão. A pré-condição do RF-R-02 vale para o caminho que EXECUTA; este
   * é o que barra. Mesmo desenho de `TetoDeCustoIaService.recusar`.
   */
  private async recusar(
    p: { orgId: string; agentSlug: string; modelo: string },
    agente: AgenteComOrcamento,
    mes: string,
    orcamentoUsd: number,
    gastoUsd: number,
    est: EstimativaDeCusto,
    causa: CausaDoCorteDoAgente,
  ): Promise<never> {
    const motivo = this.texto(agente.nome, mes, orcamentoUsd, gastoUsd, causa, est.usd, p.modelo);
    const ctx = contextoAtual();

    await this.eventos
      .registrar({
        orgId: p.orgId,
        tipo: 'ia.recusada_por_orcamento',
        actorType: ctx?.actorType ?? ActorType.ai,
        actorId: ctx?.actorId ?? null,
        agentSlug: p.agentSlug,
        correlationId: ctx?.correlationId ?? null,
        payload: {
          causa,
          mes,
          agente: p.agentSlug,
          modelo: p.modelo,
          orcamentoUsd,
          gastoUsd,
          estimativaUsd: est.usd,
          estimativaMedivel: est.medivel,
        },
        /*
         * As palavras da política (RF-R-03). `custo` aqui é o número que DECIDIU
         * a recusa — o gasto do mês contra o orçamento —, e não o gasto desta
         * chamada, que não aconteceu. `motivo` vai SÓ no `conteudo`: repetido no
         * payload, ele sobreviveria só enquanto as duas frases fossem idênticas
         * letra por letra (ver `EventLogService.montar`).
         */
        conteudo: {
          argumentos: { agente: p.agentSlug, modelo: p.modelo, mes, estimativaUsd: est.usd },
          custo: { gastoUsd, orcamentoUsd, estimativaUsd: est.usd, moeda: 'USD' },
          motivo,
          resultado: { recusado: true, causa },
          fontes: [{ tipo: 'orcamento-de-agente', id: `${p.orgId}/${p.agentSlug}/${mes}` }],
        },
        sensibilidade: 'interna',
      })
      .catch((e: unknown) =>
        this.log.error(
          `o corte por orçamento do agente NÃO entrou no RASTRO (${(e as Error).message}). ` +
            'A recusa vale assim mesmo.',
        ),
      );

    this.log.warn(`[orcamento] ${p.orgId}/${p.agentSlug}: ${motivo}`);
    throw new OrcamentoDoAgenteEstouradoError(motivo, {
      orgId: p.orgId,
      agentSlug: p.agentSlug,
      mes,
      causa,
      orcamentoUsd,
      gastoUsd,
      estimativaUsd: est.usd,
      modelo: p.modelo,
    });
  }

  /**
   * O motivo, em português, para quem opera — não para quem programou.
   *
   * Ele vai para três lugares ao mesmo tempo (a exceção que a sessão mostra, o
   * payload do evento e o log), escrito uma vez só. E NENHUM texto manda mexer
   * em tela que não existe: o orçamento do agente se define em `/agentes`, no
   * botão do próprio agente, e é isso que a frase diz.
   */
  private texto(
    nome: string,
    mes: string,
    orcamentoUsd: number,
    gastoUsd: number,
    causa: CausaDoCorteDoAgente,
    estimativaUsd: number,
    modelo: string,
  ): string {
    const orc = usd(orcamentoUsd);
    if (causa === 'orcamento_zerado') {
      return (
        `O orçamento mensal de IA do agente "${nome}" está em ${orc}: nenhuma chamada de modelo ` +
        'é permitida para ele. Quem administra o OS define o valor em Agentes, no cartão do agente.'
      );
    }
    if (causa === 'modelo_sem_preco') {
      return (
        `O modelo "${modelo}" não está na tabela de preço do OS, então não dá para saber quanto ` +
        `esta chamada custaria — e com o orçamento de "${nome}" valendo (${orc} por mês) o OS não ` +
        'deixa passar o que não sabe medir. Cadastre o preço do modelo ou desligue o orçamento deste agente.'
      );
    }
    if (causa === 'chamada_maior_que_o_mes') {
      return (
        `Esta única chamada custaria cerca de ${usd(estimativaUsd)}, acima do orçamento de ${orc} ` +
        `para o mês inteiro do agente "${nome}". Reduza o tamanho do pedido; para mudar o orçamento, ` +
        'fale com quem administra o OS.'
      );
    }
    return (
      `Orçamento mensal de IA do agente "${nome}" atingido em ${mesBr(mes)}: ${usd(gastoUsd)} de ` +
      `${orc} já gastos. As execuções voltam sozinhas na virada do mês; para liberar antes, fale ` +
      'com quem administra o OS.'
    );
  }
}
