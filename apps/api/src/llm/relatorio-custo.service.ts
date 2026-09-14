import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { contextoAtual } from '../common/contexto-execucao';
import { envNumero } from './env';
import { TetoDeCustoIaService, type ConsumoDoDia } from './teto-diario.service';
import {
  OrcamentoDeAgenteService,
  type ConsumoDoMesDoAgente,
} from './orcamento-de-agente.service';

/*
 * O RELATÓRIO DE CUSTO DE IA — por empresa, por agente e por dia (RF-B-03).
 *
 * Este arquivo LÊ. Não reserva, não liquida, não corta: quem faz isso é
 * `teto-diario.service.ts`, e mexer nele a partir daqui seria refazer em leitura
 * uma decisão que já está tomada na escrita.
 *
 * ----------------------------------------------------------------------------
 * DE ONDE VEM CADA NÚMERO — e por que eles NÃO são o mesmo número
 * ----------------------------------------------------------------------------
 * Há duas fontes, e elas medem coisas diferentes. Somá-las daria um total maior
 * que o gasto; escolher uma só daria um total menor. As duas aparecem, cada uma
 * com o nome do que é:
 *
 *   1. O LIVRO-CAIXA (`GastoDeIaNoDia`) — a linha por (empresa, dia) que o teto
 *      escreve. Responde o eixo EMPRESA × DIA, e é contra ela que o corte
 *      acontece.
 *
 *   2. OS PASSOS (`SessionStep`) — uma linha por passo de modelo dentro de uma
 *      sessão de agente, com `custoUsd` do provedor. É a única fonte que sabe DE
 *      QUEM foi o gasto, e por isso é ela que responde o eixo AGENTE.
 *
 * ----------------------------------------------------------------------------
 * O LIVRO-CAIXA SÓ EXISTE PARA EMPRESA COM TETO CONFIGURADO — E HOJE NENHUMA TEM
 * ----------------------------------------------------------------------------
 * `TetoDeCustoIaService.reservar()` devolve `null` quando a empresa não tem linha
 * em `TetoDeCustoIa`, e nesse caso NENHUMA linha de `GastoDeIaNoDia` é escrita.
 * E nada no produto cria a linha de configuração: não há rota, não há semente,
 * não há provisionamento, não há `INSERT` em migração — o próprio texto de recusa
 * do teto admite que "ainda não há tela para isso".
 *
 * O efeito, para toda empresa de hoje: `porDia` vem VAZIO, a conferência vem
 * zerada, e um painel ingênuo imprimiria "custo medido US$ 0,00 · conferido com o
 * banco" enquanto a tabela por agente mostra centenas de dólares logo acima. É o
 * desfecho mais caro que um painel de custo pode entregar, e é o desfecho que
 * este arquivo existe para impedir.
 *
 * Por isso o relatório DETECTA a ausência e RECUSA o total (`livroCaixa`):
 * quando há passo de modelo com custo na janela e nenhuma linha no livro-caixa,
 * `livroCaixa.totalConfiavel` vem `false` com o motivo escrito, e a tela é
 * obrigada a mostrar a recusa no lugar do número. O conserto de raiz — escrever
 * o livro-caixa mesmo sem teto configurado — é em `teto-diario.service.ts`, que
 * é arquivo de outra fatia (está em FORA DO ESCOPO no relatório).
 *
 * ----------------------------------------------------------------------------
 * MEDIDO E ESTIMADO SÃO COLUNAS DIFERENTES, E CONTINUAM DIFERENTES AQUI
 * ----------------------------------------------------------------------------
 * `gastoUsd` é o custo que o provedor informou. `gastoEstimadoUsd` é conta nossa
 * — e são DOIS métodos diferentes debaixo do mesmo nome, o que a tela é obrigada
 * a dizer:
 *
 *   · `liquidarPeloObservado()` — o tamanho do texto que voltou. É o caso de
 *     `complete()`, que não devolve uso. Fica na ordem do custo real.
 *   · `liquidar()` com `custoEstimado: false` — a RESERVA, isto é, o teto de
 *     saída do pedido. Acontece quando o modelo SERVIDO saiu da tabela de preço
 *     no meio da chamada, e é cerca de SETE VEZES o custo típico de uma resposta
 *     de texto (ver o cabeçalho de `teto-diario.service.ts`).
 *
 * O livro-caixa separa medido de estimado DE PROPÓSITO, e o relatório não os
 * funde: somar os dois e chamar o resultado de "custo real medido" apagaria a
 * procedência do número.
 *
 * ----------------------------------------------------------------------------
 * QUEM RECEBE O GASTO MEDIDO — e por que "sem agente" NÃO é lixeira de dinheiro
 * ----------------------------------------------------------------------------
 * `gastoUsd` (medido) só é escrito por `liquidar()`, e `liquidar()` tem UM
 * chamador: `ProviderComTeto.step()`. E `step()` também tem um chamador só —
 * `agents/agent-runtime.service.ts` —, que grava um `SessionStep` de tipo
 * `modelo` para TODO passo, com o mesmo `custoUsd` e o mesmo `custoEstimado`.
 *
 * Consequência, e é ela que derruba a leitura antiga desta tela: o dinheiro de
 * relatório, curadoria, pauta e ficha — que passam por `complete()` — NUNCA
 * aparece no medido. Ele é ESTIMADO por construção. A diferença entre o medido
 * do livro-caixa e a soma dos passos, portanto, tende a ZERO: ela é resíduo (um
 * passo liquidado do outro lado da virada do dia, uma sessão apagada), e não a
 * conta de `complete()`. Por isso a linha se chama NÃO ATRIBUÍDO, e por isso
 * `estimadoUsd` viaja junto: sem ele, o "total" da tabela por agente seria uma
 * fração do gasto — o revisor mediu vinte e dois por cento.
 *
 * ----------------------------------------------------------------------------
 * MODELO FORA DA TABELA DE PREÇO NÃO É GASTO ZERO
 * ----------------------------------------------------------------------------
 * `chamadasSemPreco` (no livro-caixa) e `passosNaoMedidos` (nos passos) contam
 * as chamadas em que o modelo SERVIDO não está em `preco.ts`. Nesses casos não
 * há custo a medir — e gravar R$ 0,00 faria uma empresa que gastou muito
 * aparecer barata. Eles viajam como contagem, nunca como dinheiro, e a regra
 * vale LINHA A LINHA e TAMBÉM NO AGREGADO (ver `tudoSemPreco` na tela: janela
 * inteiramente sem preço não imprime "US$ 0,00").
 *
 * ----------------------------------------------------------------------------
 * O QUE ESTE RELATÓRIO NÃO ENXERGA (`naoCoberto`)
 * ----------------------------------------------------------------------------
 * A vetorização não passa pelo envelope do teto: `obsidian/obsidian.service.ts`
 * e `pauta/pauta.service.ts` falam com `/embeddings` por `fetch` próprio, fora
 * do `LlmProvider`. Esse gasto é real, é cobrado pela OpenAI e NÃO aparece em
 * nenhum número deste relatório.
 *
 * A EXISTÊNCIA do buraco tem procedência (a catraca de arquitetura o declara,
 * arquivo por arquivo). A GRANDEZA não tem: não há medição dele em arquivo
 * nenhum deste repositório, e por isso `ordemDeGrandeza` diz "não medido" em vez
 * de um intervalo de dólares. Número de dinheiro sem fonte é invenção, inclusive
 * quando a intenção é alertar.
 */

/** Quantos dias o relatório cobre quando ninguém pede nada. */
export const DIAS_PADRAO = 30;
/** Teto da janela. Mais que isso é análise, não painel — e é varredura cara. */
export const DIAS_MAXIMO = 90;

/**
 * A rota que a tela consome: `GET /api/dashboard/custo-ia?dias=30`.
 *
 * O prefixo `dashboard` é de propósito: ele JÁ está declarado como espinha do OS
 * em `tenants/modulos.ts`, e prefixo novo não declarado falha em tempo de
 * execução (`PrefixoNaoDeclaradoError`). Custo de IA é espinha — não é módulo de
 * negócio que se contrata à parte.
 *
 * Quem publica a rota é `dashboard/dashboard.controller.ts`.
 */
export const CAMINHO_DO_RELATORIO = 'dashboard/custo-ia';

/** Percentual do teto a partir do qual a tela alerta. Ver `percentualAlerta`. */
export const PERCENTUAL_ALERTA_PADRAO = 80;

/**
 * O RELATÓRIO FOI PEDIDO FORA DO CONTEXTO DE EXECUÇÃO DA EMPRESA.
 *
 * Guarda PRÓPRIA, e não emprestada. O relatório também chama `consumo()`, que
 * lança `TetoIlegivelError` no mesmo caso — mas aquele ramo é INALCANÇÁVEL por
 * quem chega pela rota: o `ContextoInterceptor` abre o contexto com o `orgId` do
 * token antes de o controlador rodar, então a comparação nunca falha ali. Uma
 * defesa que só fecha para um chamador que não existe é teatro (é o padrão que
 * esta execução encontrou doze vezes).
 *
 * Os chamadores para quem esta guarda FECHA de verdade são os que virão: script
 * compilado, laço de cron, ferramenta de MCP — tudo que pede o relatório sem
 * requisição HTTP por trás. Sob o papel restrito, esses caminhos não receberiam
 * erro do banco: receberiam VAZIO, e o painel imprimiria "US$ 0,00" para uma
 * empresa que pode ter gasto o dia inteiro.
 */
export class RelatorioForaDoContextoError extends Error {
  readonly nome = 'RelatorioForaDoContextoError';
  constructor(
    readonly orgId: string,
    readonly orgDoContexto: string | null,
  ) {
    super(
      `o relatório de custo de IA de "${orgId}" foi pedido ` +
        `${orgDoContexto ? `com o contexto da empresa "${orgDoContexto}"` : 'sem contexto de execução'}. ` +
        'Sob isolamento por linha a leitura devolveria vazio em silêncio, e um painel de custo ' +
        'zerado tem a mesma cara de uma empresa que não gastou nada. Abra o contexto da empresa ' +
        '(`comContexto({ orgId, … })`) antes de pedir o relatório (RF-T-04, RF-B-03).',
    );
    this.name = 'RelatorioForaDoContextoError';
  }
}

export interface DiaDeCusto {
  /** `AAAA-MM-DD` no fuso da empresa. */
  dia: string;
  /** Custo REAL informado pelo provedor. */
  medidoUsd: number;
  /** Conta nossa — dois métodos, ver o cabeçalho. NUNCA somado como medido. */
  estimadoUsd: number;
  /** Chamadas em voo no instante da leitura (só faz sentido no dia corrente). */
  reservadoUsd: number;
  chamadas: number;
  /** Chamadas cujo modelo servido não tem preço: não medido, não zero. */
  chamadasSemPreco: number;
  /** Quantas chamadas o teto recusou neste dia. */
  cortes: number;
}

export interface AgenteDeCusto {
  slug: string;
  nome: string;
  iniciais: string;
  medidoUsd: number;
  passos: number;
  passosNaoMedidos: number;
  sessoes: number;
  /** ISO do passo mais recente deste agente na janela. */
  ultimoEm: string | null;
}

/** Uma célula do cruzamento agente × dia — é o que desenha a série por agente. */
export interface AgenteNoDia {
  dia: string;
  slug: string;
  medidoUsd: number;
  passos: number;
  passosNaoMedidos: number;
}

export interface TetoDaEmpresa {
  /** `false` = ninguém definiu teto para esta empresa. Não é teto zero. */
  configurado: boolean;
  /** `false` = teto em observação: soma, não corta. */
  ativo: boolean;
  tetoDiarioUsd: number | null;
  /** Percentual do teto que aciona o alerta na tela (1..100). */
  percentualAlerta: number;
  definidoEm: string | null;
  motivo: string | null;
}

/**
 * O ESTADO DO LIVRO-CAIXA NA JANELA — a peça que decide se há total a mostrar.
 *
 * Ver "O LIVRO-CAIXA SÓ EXISTE PARA EMPRESA COM TETO CONFIGURADO" no cabeçalho.
 */
export interface LivroCaixa {
  /** Linhas de `GastoDeIaNoDia` encontradas na janela. */
  linhas: number;
  /** A empresa tem linha em `TetoDeCustoIa`? Sem ela, nada é escrito. */
  tetoConfigurado: boolean;
  /** Passos de modelo COM custo medido na janela — a prova de que houve gasto. */
  passosComCusto: number;
  /** Quanto esses passos custaram, medido pelo provedor. */
  gastoDosPassosUsd: number;
  /**
   * `false` ⇒ A TELA NÃO PODE MOSTRAR TOTAL. Há gasto medido na janela e o
   * livro-caixa não tem uma linha sequer: qualquer soma sobre ele seria zero, e
   * um zero apresentado como total é pior que a ausência do número.
   */
  totalConfiavel: boolean;
  /** Por que não é confiável, em português, para quem opera. `null` quando é. */
  motivo: string | null;
}

/** Uma parcela de gasto que este relatório sabe que existe e não consegue medir. */
export interface ForaDoRelatorio {
  oQue: string;
  onde: string;
  /** "não medido" quando não há medição — nunca um número sem fonte. */
  ordemDeGrandeza: string;
  procedencia: string;
}

export interface RelatorioDeCustoIa {
  orgId: string;
  fusoHorario: string;
  /** Primeiro e último dia da janela, `AAAA-MM-DD` no fuso da empresa. */
  de: string;
  ate: string;
  dias: number;
  teto: TetoDaEmpresa;
  /**
   * O consumo de HOJE, lido pelo MESMO serviço que corta (`TetoDeCustoIa`).
   *
   * Não é recalculado aqui, e a razão é a pílula: um número no topo da tela que
   * discordasse do número que recusa a chamada seria pior que nenhum número.
   * `null` quando a empresa não tem teto configurado.
   *
   * É TAMBÉM A ÚNICA FONTE DOS NÚMEROS DO TETO. `teto.ativo` e
   * `teto.tetoDiarioUsd` saem daqui quando `hoje` existe — antes eles vinham de
   * uma segunda leitura da configuração, feita num instante diferente, e a tela
   * usava as duas ao mesmo tempo.
   */
  hoje: ConsumoDoDia | null;
  porDia: DiaDeCusto[];
  porAgente: AgenteDeCusto[];
  porAgenteEDia: AgenteNoDia[];
  livroCaixa: LivroCaixa;
  /**
   * A CONFERÊNCIA — o `SUM()`/`COUNT()` do banco sobre as MESMAS linhas que
   * viajaram em `porDia`, lido DENTRO DA MESMA TRANSAÇÃO e no mesmo instantâneo
   * (`REPEATABLE READ`).
   *
   * O que ela prova, e o que NÃO prova. Não são dois caminhos independentes:
   * duas consultas soltas sobre uma tabela viva divergiriam a cada liquidação
   * que caísse no meio, e a tela pintaria a tarja vermelha num sistema são. Sob
   * o mesmo instantâneo ela vira uma afirmação determinística e estreita: as
   * linhas que a tela recebeu são TODAS as linhas da janela, na mesma ordem de
   * grandeza, sem perda na conversão `Decimal` → número nem corte de página.
   *
   * Por isso ela confere QUATRO campos, e não dois. Comparar só dinheiro deixa
   * passar um payload com contagem de chamadas absurda — foi assim que o revisor
   * a aprovou com um número inventado.
   */
  conferencia: {
    medidoUsd: number;
    estimadoUsd: number;
    chamadas: number;
    linhas: number;
  };
  /** Soma dos passos atribuídos a agente, para a tela comparar com o livro-caixa. */
  atribuidoAAgenteUsd: number;
  /**
   * O ORÇAMENTO MENSAL DE CADA AGENTE, com o gasto do MÊS ao lado (fatia A3).
   *
   * NÃO É A JANELA. O resto deste relatório fala dos últimos `dias` dias; isto
   * fala do mês corrente no fuso de cada agente, porque é esse o recorte do
   * orçamento e é ele que corta. Somar os dois números como se fossem do mesmo
   * período seria inventar um total — a tela mostra os dois com o rótulo do
   * período em cada um.
   *
   * Lista TODOS os agentes, inclusive quem não tem orçamento definido
   * (`configurado: false`): agente que gasta e não tem limite é exatamente o
   * que alguém precisa ver para decidir um valor.
   */
  orcamentoDeAgentes: ConsumoDoMesDoAgente[];
  naoCoberto: readonly ForaDoRelatorio[];
  geradoEm: string;
}

interface LinhaPorAgenteEDia {
  dia: string;
  slug: string;
  nome: string;
  iniciais: string;
  medidoUsd: number;
  passos: number;
  passosNaoMedidos: number;
  sessoes: number;
  ultimoEm: Date | null;
}

const FUSO_PADRAO = 'America/Sao_Paulo';
const DIA_MS = 24 * 60 * 60 * 1000;

/** Seis casas — a mesma precisão da coluna `Decimal(12,6)` do livro-caixa. */
function arredondar(n: number): number {
  return Number((Number.isFinite(n) ? n : 0).toFixed(6));
}

function fusoValido(fuso: string): string {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: fuso });
    return fuso;
  } catch {
    return FUSO_PADRAO;
  }
}

/** O cliente de dentro da transação — só o que este arquivo lê. */
type ClienteDaJanela = Pick<Prisma.TransactionClient, 'gastoDeIaNoDia' | '$queryRaw'>;

@Injectable()
export class RelatorioDeCustoIaService {
  private readonly log = new Logger('RelatorioDeCustoIa');

  constructor(
    private readonly prisma: PrismaService,
    private readonly teto: TetoDeCustoIaService,
    /*
     * O eixo do ORÇAMENTO POR AGENTE (fatia A3) vem de quem o IMPÕE, nunca
     * recalculado aqui. Mesma razão de `hoje` sair de `TetoDeCustoIa.consumo`:
     * um número no painel que discordasse do número que recusa a chamada seria
     * pior que nenhum número.
     */
    private readonly orcamentos: OrcamentoDeAgenteService,
  ) {}

  /**
   * O relatório da empresa na janela pedida.
   *
   * @throws RelatorioForaDoContextoError quando a empresa pedida não é a do
   * contexto de execução. Ver a classe: é a guarda própria deste arquivo, e ela
   * fecha para o chamador que não passa por HTTP.
   */
  async relatorio(orgId: string, diasPedidos?: number): Promise<RelatorioDeCustoIa> {
    const doContexto = contextoAtual()?.orgId?.trim() || null;
    if (doContexto !== orgId) throw new RelatorioForaDoContextoError(orgId, doContexto);

    const dias = Math.min(
      Math.max(Math.trunc(Number(diasPedidos) || DIAS_PADRAO), 1),
      DIAS_MAXIMO,
    );

    /*
     * A ORDEM É SEQUENCIAL DE PROPÓSITO, e custa um par de idas ao banco.
     *
     * `hoje` vem primeiro porque ele é a AUTORIDADE dos números do teto: é a
     * mesma leitura que a porta usa para recusar a chamada. A configuração é
     * relida logo abaixo só pelo que `ConsumoDoDia` não carrega — a data em que
     * o teto foi definido e o motivo escrito por quem o definiu. Texto e data
     * podem envelhecer um milissegundo sem que a tela minta; número não pode, e
     * era exatamente isso que acontecia quando os dois lados vinham de leituras
     * diferentes e a tela usava os dois.
     */
    const hoje = await this.consumoDeHoje(orgId);
    const cfg = await this.prisma.tetoDeCustoIa.findUnique({ where: { orgId } });

    const fuso = fusoValido(hoje?.fusoHorario ?? cfg?.fusoHorario ?? FUSO_PADRAO);
    const agora = new Date();
    const ate = this.teto.diaDaEmpresa(fuso, agora);
    const de = this.teto.diaDaEmpresa(fuso, new Date(agora.getTime() - (dias - 1) * DIA_MS));

    /*
     * O corte em UTC para a varredura dos passos.
     *
     * Um dia inteiro de folga para trás, e nenhuma para frente: o rótulo do dia
     * sai do fuso da empresa e o `criadoEm` do passo é UTC; um corte exato em
     * UTC deixaria de fora as primeiras horas do primeiro dia em qualquer fuso a
     * oeste. A folga entra passos a mais na consulta, e o agrupamento por rótulo
     * os joga fora — sobra-lhes nada a inflar.
     */
    const desdeUtc = new Date(agora.getTime() - dias * DIA_MS);

    /*
     * AS TRÊS LEITURAS DA JANELA, NO MESMO INSTANTÂNEO.
     *
     * `REPEATABLE READ` é o que faz a conferência significar alguma coisa: sem
     * ele, uma liquidação entre a lista e o `SUM()` faria os dois discordarem num
     * sistema perfeitamente são, e a tela acusaria divergência todo dia de
     * movimento. Com ele, discordar passa a ser defeito de verdade.
     *
     * A transação é somente-leitura: `REPEATABLE READ` no Postgres só aborta por
     * conflito de ESCRITA, então não há retentativa a prever aqui.
     */
    const janela = await this.prisma.$transaction(
      async (tx) => {
        const linhasDoDia = await tx.gastoDeIaNoDia.findMany({
          where: { orgId, dia: { gte: de, lte: ate } },
          orderBy: { dia: 'asc' },
          select: {
            dia: true,
            gastoUsd: true,
            gastoEstimadoUsd: true,
            reservadoUsd: true,
            chamadas: true,
            chamadasSemPreco: true,
            cortes: true,
          },
        });
        const soma = await tx.gastoDeIaNoDia.aggregate({
          where: { orgId, dia: { gte: de, lte: ate } },
          _sum: { gastoUsd: true, gastoEstimadoUsd: true, chamadas: true },
          _count: { _all: true },
        });
        const porAgenteEDia = await this.lerPassosPorAgenteEDia(tx, orgId, fuso, desdeUtc, de, ate);
        return { linhasDoDia, soma, porAgenteEDia };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    const porDia: DiaDeCusto[] = janela.linhasDoDia.map((l) => ({
      dia: l.dia,
      medidoUsd: arredondar(Number(l.gastoUsd)),
      estimadoUsd: arredondar(Number(l.gastoEstimadoUsd)),
      reservadoUsd: arredondar(Number(l.reservadoUsd)),
      chamadas: l.chamadas,
      chamadasSemPreco: l.chamadasSemPreco,
      cortes: l.cortes,
    }));

    const porAgente = this.consolidarPorAgente(janela.porAgenteEDia);
    const atribuido = arredondar(porAgente.reduce((t, a) => t + a.medidoUsd, 0));
    const passosComCusto = janela.porAgenteEDia.reduce((t, l) => t + l.passos, 0);

    return {
      orgId,
      fusoHorario: hoje?.fusoHorario ?? cfg?.fusoHorario ?? FUSO_PADRAO,
      de,
      ate,
      dias,
      teto: {
        // `hoje` manda em tudo que é número; `cfg` só completa o que é texto.
        configurado: hoje !== null || cfg !== null,
        ativo: hoje?.ativo ?? cfg?.ativo ?? false,
        tetoDiarioUsd: hoje
          ? arredondar(hoje.tetoUsd)
          : cfg
            ? arredondar(Number(cfg.tetoDiarioUsd))
            : null,
        percentualAlerta: percentualDeAlerta(),
        definidoEm: cfg?.definidoEm?.toISOString() ?? null,
        motivo: cfg?.motivo ?? null,
      },
      hoje,
      porDia,
      porAgente,
      porAgenteEDia: janela.porAgenteEDia.map((l) => ({
        dia: l.dia,
        slug: l.slug,
        medidoUsd: l.medidoUsd,
        passos: l.passos,
        passosNaoMedidos: l.passosNaoMedidos,
      })),
      livroCaixa: this.estadoDoLivroCaixa({
        linhas: janela.soma._count._all,
        tetoConfigurado: hoje !== null || cfg !== null,
        passosComCusto,
        gastoDosPassosUsd: atribuido,
        de,
        ate,
      }),
      conferencia: {
        medidoUsd: arredondar(Number(janela.soma._sum.gastoUsd ?? 0)),
        estimadoUsd: arredondar(Number(janela.soma._sum.gastoEstimadoUsd ?? 0)),
        chamadas: Number(janela.soma._sum.chamadas ?? 0),
        linhas: janela.soma._count._all,
      },
      atribuidoAAgenteUsd: atribuido,
      /*
       * FORA da transação de propósito. Ela existe para a CONFERÊNCIA — o
       * `SUM()` contra a lista, no mesmo instantâneo — e o orçamento não entra
       * naquela comparação: é outro recorte (mês, não janela) e outra pergunta.
       * Arrastá-lo para dentro prenderia o instantâneo por mais tempo sem
       * provar nada a mais.
       */
      orcamentoDeAgentes: await this.orcamentos.panorama(orgId),
      naoCoberto: NAO_COBERTO,
      geradoEm: agora.toISOString(),
    };
  }

  /**
   * O livro-caixa está escrito? E, se não está, dá para mostrar total?
   *
   * A condição de recusa é estreita de propósito: GASTO MEDIDO NA JANELA e
   * NENHUMA LINHA no livro-caixa. Janela sem gasto nenhum continua sendo zero
   * legítimo — recusar ali faria o painel dizer "não sei" para toda empresa
   * parada, e a tela perderia a única coisa que ela tem a dizer nesse caso.
   */
  private estadoDoLivroCaixa(p: {
    linhas: number;
    tetoConfigurado: boolean;
    passosComCusto: number;
    gastoDosPassosUsd: number;
    de: string;
    ate: string;
  }): LivroCaixa {
    const vazio = p.linhas === 0;
    const houveGasto = p.passosComCusto > 0;
    const confiavel = !(vazio && houveGasto);

    if (confiavel) {
      return {
        linhas: p.linhas,
        tetoConfigurado: p.tetoConfigurado,
        passosComCusto: p.passosComCusto,
        gastoDosPassosUsd: p.gastoDosPassosUsd,
        totalConfiavel: true,
        motivo: null,
      };
    }

    const motivo =
      `Entre ${p.de} e ${p.ate} houve ${p.passosComCusto} passo(s) de modelo com custo medido, ` +
      'e o livro-caixa do teto não tem uma linha sequer para esta empresa. ' +
      (p.tetoConfigurado
        ? 'A empresa TEM teto configurado, então a ausência é anormal: alguém apagou as linhas ' +
          'do período, ou as chamadas aconteceram por um caminho que não passa pelo envelope do teto.'
        : 'A empresa NÃO tem teto configurado, e o livro-caixa só é escrito para quem tem: ' +
          '`reservar()` devolve `null` e nenhuma linha nasce. Nada no produto cria essa ' +
          'configuração hoje — não há rota, semente, provisionamento nem inserção em migração.') +
      ' Enquanto isso valer, o total do período não pode ser mostrado: ele daria US$ 0,00, ' +
      'que é o mesmo número de uma empresa que não gastou nada.';

    this.log.warn(`[custo-ia] total recusado: ${motivo}`);

    return {
      linhas: p.linhas,
      tetoConfigurado: p.tetoConfigurado,
      passosComCusto: p.passosComCusto,
      gastoDosPassosUsd: p.gastoDosPassosUsd,
      totalConfiavel: false,
      motivo,
    };
  }

  /**
   * O consumo de hoje pelo serviço do teto — nunca recalculado aqui.
   *
   * `consumo()` também lança `TetoIlegivelError` quando a sessão do banco não é
   * da empresa cobrada. Esse ramo é inalcançável aqui: a guarda de `relatorio()`
   * já barrou o caso antes. Continua sendo o certo deixá-lo subir se um dia
   * acontecer — mas a defesa deste arquivo é a de cima, não esta.
   */
  private async consumoDeHoje(orgId: string): Promise<ConsumoDoDia | null> {
    return this.teto.consumo(orgId);
  }

  /**
   * O eixo AGENTE, direto dos passos.
   *
   * `custoUsd IS NOT NULL` é o filtro que separa passo de MODELO de passo de
   * ferramenta: passo de ferramenta nunca grava custo, e contá-lo diluiria a
   * média de "passos não medidos" com passos que nunca tiveram custo a medir.
   *
   * `custoEstimado` é `true` quando o modelo servido ESTÁ na tabela de preço —
   * o nome da coluna diz o contrário do que ela significa, e é assim desde a
   * onda 8 (ver `preco.ts` e o comentário de `Session.custoEstimado`). Por isso
   * a soma de dinheiro só aceita a linha quando ele é verdadeiro: com ele falso,
   * `custoUsd` é 0 por falta de preço, não por a chamada ter sido de graça.
   *
   * Recebe o cliente da transação: esta consulta tem de enxergar o MESMO
   * instantâneo do livro-caixa, senão a comparação entre os dois eixos compara
   * dois momentos.
   */
  private async lerPassosPorAgenteEDia(
    cliente: ClienteDaJanela,
    orgId: string,
    fuso: string,
    desdeUtc: Date,
    de: string,
    ate: string,
  ): Promise<LinhaPorAgenteEDia[]> {
    const linhas = await cliente.$queryRaw<
      Array<{
        dia: string;
        slug: string;
        nome: string;
        iniciais: string;
        medidoUsd: number;
        passos: number;
        passosNaoMedidos: number;
        sessoes: number;
        ultimoEm: Date | null;
      }>
    >`
      SELECT to_char(("p"."criadoEm" AT TIME ZONE 'UTC') AT TIME ZONE ${fuso}, 'YYYY-MM-DD') AS "dia",
             "a"."slug"     AS "slug",
             "a"."nome"     AS "nome",
             "a"."iniciais" AS "iniciais",
             COALESCE(SUM("p"."custoUsd") FILTER (WHERE "p"."custoEstimado"), 0)::float8 AS "medidoUsd",
             COUNT(*)::int AS "passos",
             COUNT(*) FILTER (WHERE NOT "p"."custoEstimado")::int AS "passosNaoMedidos",
             COUNT(DISTINCT "p"."sessionId")::int AS "sessoes",
             MAX("p"."criadoEm") AS "ultimoEm"
        FROM "SessionStep" "p"
        JOIN "Session" "s" ON "s"."id" = "p"."sessionId"
        JOIN "Agent"   "a" ON "a"."id" = "s"."agentId"
       WHERE "p"."orgId" = ${orgId}
         AND "p"."criadoEm" >= ${desdeUtc}
         AND "p"."custoUsd" IS NOT NULL
       GROUP BY 1, 2, 3, 4
       ORDER BY 1 ASC, 5 DESC
    `;

    /*
     * O recorte da janela acontece AQUI, e não num `HAVING`, porque a folga de um
     * dia em UTC (ver `desdeUtc`) é o que garante que o primeiro dia do fuso da
     * empresa venha inteiro. O que a folga traz a mais é rótulo anterior a `de` —
     * e ele sai por comparação de texto, que em `AAAA-MM-DD` é comparação de data.
     */
    return linhas
      .filter((l) => l.dia >= de && l.dia <= ate)
      .map((l) => ({
        dia: l.dia,
        slug: l.slug,
        nome: l.nome,
        iniciais: l.iniciais,
        medidoUsd: arredondar(Number(l.medidoUsd)),
        passos: Number(l.passos),
        passosNaoMedidos: Number(l.passosNaoMedidos),
        sessoes: Number(l.sessoes),
        ultimoEm: l.ultimoEm,
      }));
  }

  /**
   * Agente × dia -> agente.
   *
   * `sessoes` é SOMADO, e não distinto: a consulta conta sessões distintas
   * DENTRO de cada dia, e uma sessão que atravessa a meia-noite apareceria nos
   * dois. É a imprecisão que sobra de não guardar a sessão inteira em memória, e
   * ela é para cima (nunca esconde trabalho). O número que decide dinheiro é
   * `medidoUsd`, que soma passo a passo e não tem esse problema.
   */
  private consolidarPorAgente(linhas: LinhaPorAgenteEDia[]): AgenteDeCusto[] {
    const mapa = new Map<string, AgenteDeCusto>();
    for (const l of linhas) {
      const atual = mapa.get(l.slug);
      if (!atual) {
        mapa.set(l.slug, {
          slug: l.slug,
          nome: l.nome,
          iniciais: l.iniciais,
          medidoUsd: l.medidoUsd,
          passos: l.passos,
          passosNaoMedidos: l.passosNaoMedidos,
          sessoes: l.sessoes,
          ultimoEm: l.ultimoEm?.toISOString() ?? null,
        });
        continue;
      }
      atual.medidoUsd = arredondar(atual.medidoUsd + l.medidoUsd);
      atual.passos += l.passos;
      atual.passosNaoMedidos += l.passosNaoMedidos;
      atual.sessoes += l.sessoes;
      const novo = l.ultimoEm?.toISOString() ?? null;
      if (novo && (!atual.ultimoEm || novo > atual.ultimoEm)) atual.ultimoEm = novo;
    }
    return [...mapa.values()].sort((a, b) => b.medidoUsd - a.medidoUsd);
  }
}

/**
 * O percentual do teto que aciona o alerta.
 *
 * Vem de `TETO_IA_ALERTA_PERCENT`, e é GLOBAL — não por empresa. Por empresa
 * exigiria coluna nova em `TetoDeCustoIa`, que é mudança de schema e está fora
 * do escopo desta fatia (ver o relatório). Enquanto for global, o valor viaja no
 * payload para que a tela nunca tenha um segundo número escrito em outro lugar.
 *
 * A variável ESTÁ no bloco `environment:` do `docker-compose.yml` — sem isso ela
 * não chega ao container (o container não lê o `.env`) e o percentual "configurado"
 * seria uma constante de 80 em produção, com uma tela dizendo o contrário.
 *
 * Valor fora de 1..100 cai no padrão em vez de virar um alerta que nunca dispara
 * (0%) ou que dispara sempre (negativo).
 */
export function percentualDeAlerta(): number {
  const n = envNumero('TETO_IA_ALERTA_PERCENT', PERCENTUAL_ALERTA_PADRAO);
  return n >= 1 && n <= 100 ? n : PERCENTUAL_ALERTA_PADRAO;
}

/**
 * O que este painel NÃO mede, declarado com nome, lugar e procedência.
 *
 * `ordemDeGrandeza` NÃO É ESTIMATIVA DE CASA. Ele diz "não medido" quando não há
 * medição, e é o caso dos dois itens de hoje. A versão anterior deste arquivo
 * imprimia "US$ 50 a 60 por mês" com a procedência "medido fora deste painel, na
 * fatura do provedor" — e não existe, em arquivo nenhum deste repositório, essa
 * medição. Era número de dinheiro inventado com procedência fabricada, num
 * painel cuja única razão de existir é não deixar isso acontecer.
 *
 * O que TEM procedência é a EXISTÊNCIA do buraco: a catraca de arquitetura
 * (`apps/api/test/arquitetura.test.ts`, `EXCECOES_MODELO`) declara arquivo por
 * arquivo quem fala com provedor de modelo fora de `src/llm/`, e diz com todas as
 * letras que essa chamada não entra no teto de custo por empresa e por dia.
 *
 * É lista fechada e viaja em todo relatório. Item que sair daqui porque passou a
 * ser medido tem de sair junto com o código que o mede — e item novo que entre
 * no sistema sem passar pelo envelope do teto tem de entrar aqui no mesmo
 * commit, senão o painel volta a prometer um total que não é total.
 */
export const NAO_COBERTO: readonly ForaDoRelatorio[] = [
  {
    oQue: 'Vetorização (embeddings)',
    onde: 'obsidian/obsidian.service.ts e pauta/pauta.service.ts chamam /embeddings da OpenAI por fetch próprio, fora do LlmProvider — nenhuma dessas chamadas reserva, liquida ou aparece no livro-caixa',
    ordemDeGrandeza: 'não medido',
    procedencia:
      'a EXISTÊNCIA do gasto está declarada em apps/api/test/arquitetura.test.ts (EXCECOES_MODELO), com os dois arquivos nomeados; a GRANDEZA não tem medição em arquivo nenhum deste repositório — só a fatura do provedor responde',
  },
  {
    oQue: 'Chamada de modelo feita por um conector por conta própria',
    onde: 'qualquer integração que fale com um provedor sem passar por LlmProvider',
    ordemDeGrandeza: 'não medido',
    procedencia:
      'não há medição — a catraca de arquitetura impede casos novos, os antigos seriam achados só na fatura',
  },
] as const;
