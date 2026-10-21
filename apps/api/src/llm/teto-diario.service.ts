import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EventLogService } from '../gateway/event-log.service';
import { comContexto, contextoAtual, novaCorrelacao } from '../common/contexto-execucao';
import { estimarCustoUsd, type EstimativaDeCusto, type TamanhoDaEntrada } from './estimativa';
import { RecusaDeCustoDeIaError } from './recusa-de-custo';

/*
 * TETO DE CUSTO DE IA POR EMPRESA E POR DIA (RF-G-05, RNF-05) — o terceiro nível.
 *
 * OS DOIS QUE JÁ EXISTIAM, e que este NÃO reescreve:
 *   · por AGENTE e por EXECUÇÃO — `Agent.tetoCustoUsd`, imposto no laço de
 *     `agents/agent-runtime.service.ts` com o custo real de cada passo;
 *   · o custo REAL em si, que vem do provedor e é gravado passo a passo em
 *     `SessionStep.custoUsd`.
 *
 * O que faltava é o nível de cima: a EMPRESA, somada no DIA. Ele é diferente dos
 * outros dois em três coisas, e é por isso que precisa de tabela própria em vez
 * de uma conta sobre `SessionStep`:
 *
 *   1. ALCANCE. Nem toda chamada de modelo nasce de sessão de agente. Relatório,
 *      curadoria e pauta chamam `complete()` e não deixam passo nenhum — somar
 *      `SessionStep` deixaria de fora justamente o gasto não vigiado.
 *   2. MOMENTO. Somar o passado não corta antes; reservar corta. Ver
 *      `estimativa.ts`.
 *   3. CONCORRÊNCIA. Duas execuções simultâneas que apenas LEEM o total gastam o
 *      dobro do teto sem que nenhuma das duas tenha errado.
 *
 * ----------------------------------------------------------------------------
 * O CICLO DE UMA CHAMADA
 * ----------------------------------------------------------------------------
 *   reservar()  soma a ESTIMATIVA em `reservadoUsd`, numa única instrução que só
 *               grava se o total couber no teto. Não coube: recusa com motivo em
 *               português, conta o corte e registra o evento no RASTRO. A chamada
 *               ao modelo nunca acontece.
 *   liquidar()  devolve a reserva e grava o custo REAL no lugar dela.
 *   liquidarPeloObservado()  devolve a reserva e grava uma estimativa feita com
 *               o TAMANHO DA RESPOSTA — é o caso de `complete()`, que não devolve
 *               uso. Ver a seção "o que entra no livro-caixa", abaixo.
 *   soltar()    devolve a reserva sem gravar gasto — a chamada falhou.
 *
 * A reserva é a peça que faz "antes" significar alguma coisa. Ela é PESSIMISTA
 * de propósito: enquanto a chamada está em voo, a empresa tem menos saldo do que
 * vai ter no instante seguinte. O preço disso é vazão, por segundos; o preço do
 * contrário é gasto sem teto.
 *
 * ----------------------------------------------------------------------------
 * O QUE ENTRA NO LIVRO-CAIXA — e por que a estimativa CONTINUA na soma que corta
 * ----------------------------------------------------------------------------
 * Havia uma escolha a fazer, e ela está feita: LIQUIDAR POR UM VALOR
 * CONSERVADOR DE SAÍDA, em vez de tirar a estimativa da soma que corta.
 *
 * Até 11/09/2026 a liquidação de `complete()` gravava a RESERVA — isto é, o
 * `max_tokens` do pedido, cerca de sete vezes o custo típico de uma resposta de
 * texto. Estava em coluna própria (`gastoEstimadoUsd`), mas entrava na soma que
 * decide o corte: a empresa era cortada com uma fração do orçamento que de fato
 * gastou, e o livro-caixa mostrava um número que não era gasto.
 *
 * Agora a liquidação de `complete()` usa o TAMANHO DO TEXTO QUE VOLTOU
 * (`estimarCustoDaResposta`). Continua sendo estimativa — e por isso continua em
 * coluna própria, que é o que preserva a procedência do número —, mas é uma
 * estimativa da chamada que aconteceu, não do teto que ela poderia ter usado.
 * Com ela na ordem do custo real, mantê-la na soma que corta é o certo: tirá-la
 * cegaria o teto justamente para o caminho que roda sozinho, de madrugada.
 *
 * ----------------------------------------------------------------------------
 * O QUE ESTE TETO NÃO PROMETE
 * ----------------------------------------------------------------------------
 * Não é um contrato financeiro: é uma LINHA DE PARADA. Se a estimativa errar
 * para baixo, a chamada acontece, a liquidação grava o custo real e o dia fecha
 * acima do teto — e a próxima chamada é recusada. O excesso possível é o de UMA
 * chamada sobre a própria estimativa, nunca o de um dia.
 *
 * Também não alcança o que não passa por `LlmProvider`: embedding (que é da
 * OpenAI e é cobrado à parte) e qualquer chamada que um conector faça por conta
 * própria. Está no relatório da fatia.
 */

/** Uma reserva aberta. Quem reserva DEVE liquidar ou soltar. */
export interface ReservaDeCusto {
  orgId: string;
  /** `AAAA-MM-DD` no fuso da empresa. */
  dia: string;
  modelo: string;
  /** O que foi somado em `reservadoUsd`. */
  valorUsd: number;
  /**
   * false ⇒ o modelo PEDIDO está fora da tabela de preço. Só acontece com o teto
   * desligado: com ele valendo, a chamada é recusada antes (ver `reservar`).
   */
  medivel: boolean;
  /** O tamanho da entrada que gerou a reserva — a liquidação reaproveita. */
  entrada: TamanhoDaEntrada;
}

export type CausaDoCorte = 'zerado' | 'chamada_maior_que_o_teto' | 'dia_no_teto' | 'modelo_sem_preco';

/**
 * A recusa por teto. Erro próprio para que o chamador possa distingui-la de
 * falha de rede sem ler o texto da mensagem — e para que a mensagem seja escrita
 * uma vez só, em português, para quem opera.
 */
export class TetoDiarioEstouradoError extends RecusaDeCustoDeIaError {
  readonly nome = 'TetoDiarioEstouradoError';
  /**
   * O rótulo estável, exigido pela família (`recusa-de-custo.ts`). Prefixado
   * com `teto_dia_` para não colidir com a causa homônima do orçamento do
   * agente — `dia_no_teto` e `mes_no_teto` são cortes diferentes, e quem
   * agrupar o RASTRO precisa saber qual dos dois barrou.
   */
  readonly causa: string;
  constructor(
    motivo: string,
    readonly detalhe: {
      orgId: string;
      dia: string;
      causa: CausaDoCorte;
      tetoUsd: number;
      gastoUsd: number;
      gastoEstimadoUsd: number;
      reservadoUsd: number;
      estimativaUsd: number;
      modelo: string;
    },
  ) {
    super(detalhe.orgId, motivo);
    this.name = 'TetoDiarioEstouradoError';
    this.causa = `teto_dia_${detalhe.causa}`;
  }
}

/**
 * NÃO DEU PARA LER O TETO — que é coisa diferente de "esta empresa não tem teto".
 *
 * Depois da virada para o papel restrito, uma consulta feita sem a empresa na
 * SESSÃO do banco não devolve erro: devolve VAZIO (ver `prisma/sessao-de-banco.ts`).
 * Entender esse vazio como "empresa sem teto configurado" desliga o teto em
 * silêncio, que é o pior desfecho possível para um controle de gasto. Quando a
 * empresa de quem se cobra não é a da sessão, este erro sobe e a chamada ao
 * modelo não acontece.
 */
export class TetoIlegivelError extends Error {
  readonly nome = 'TetoIlegivelError';
  constructor(
    readonly orgId: string,
    readonly orgDaSessao: string | null,
  ) {
    super(
      `não dá para saber o teto de custo de IA de "${orgId}": a sessão do banco está ` +
        `${orgDaSessao ? `na empresa "${orgDaSessao}"` : 'sem empresa resolvida'} e o isolamento por ` +
        'linha esconderia a configuração. Abra o contexto de execução da empresa ' +
        '(`comContexto({ orgId, … })`) antes de chamar o modelo (RF-T-04, RF-G-05).',
    );
    this.name = 'TetoIlegivelError';
  }
}

/** O consumo de um dia, como a tela e a porta precisam ler. */
export interface ConsumoDoDia {
  dia: string;
  fusoHorario: string;
  ativo: boolean;
  tetoUsd: number;
  gastoUsd: number;
  gastoEstimadoUsd: number;
  reservadoUsd: number;
  /** Comprometido em linha de OUTRO dia que ainda conta hoje — ver `arrasto`. */
  arrastoUsd: number;
  comprometidoUsd: number;
  restanteUsd: number;
  chamadas: number;
  chamadasSemPreco: number;
  cortes: number;
}

const FUSO_PADRAO = 'America/Sao_Paulo';

/**
 * Quanto tempo uma reserva pode ficar aberta antes de ser dada por morta.
 *
 * Nenhuma chamada de modelo dura tanto: o maior teto de saída do repositório é o
 * do streaming da Anthropic, e mesmo ele termina em minutos. Reserva mais velha
 * que isto é chamada que nunca liquidou — processo morto no meio.
 */
export const RESERVA_EXPIRA_MS = 30 * 60_000;

/** De quanto em quanto tempo a varredura procura reserva presa. */
const VARREDURA_MS = 10 * 60_000;

/**
 * Tolerância depois da virada do dia para o ARRASTO (ver `arrasto`). Uma chamada
 * que começou às 23h59 liquida na linha de ontem alguns segundos depois da
 * meia-noite; isso é normal e não pode ser lido como troca de fuso.
 */
const TOLERANCIA_DA_VIRADA_MS = 60 * 60_000;

interface LinhaDoDia {
  dia: string;
  gastoUsd: string | number;
  gastoEstimadoUsd: string | number;
  reservadoUsd: string | number;
  chamadas: number;
  chamadasSemPreco: number;
  cortes: number;
  criadoEm: Date;
  atualizadoEm: Date;
}

/** O que uma leitura da janela de três dias devolve. */
interface JanelaDoDia {
  linha: LinhaDoDia | null;
  arrastoUsd: number;
}

@Injectable()
export class TetoDeCustoIaService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('TetoDeCustoIa');
  /** Fusos já reclamados — o aviso é uma vez por valor, não por chamada. */
  private readonly fusosInvalidos = new Set<string>();
  /** Empresas já reclamadas por contexto divergente. Mesma regra. */
  private readonly contextosDivergentes = new Set<string>();
  /**
   * As reservas que ESTE processo tem em voo, por `empresa|dia`.
   *
   * Existe para a varredura saber o que é reserva viva e o que é fantasma: o que
   * está aqui pertence a uma chamada que ainda vai liquidar; o que está no banco
   * e não está aqui é de um processo que morreu. Sobe ANTES da instrução de
   * reserva e desce na liquidação — na ordem contrária, uma chamada concorrente
   * poderia ver a própria reserva da colega como fantasma.
   */
  private readonly abertas = new Map<string, number>();
  private varredura?: ReturnType<typeof setInterval>;
  /** A varredura já reclamou que não enxerga as empresas? (uma vez, não a cada 10 min) */
  private varreduraAvisada = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: EventLogService,
  ) {}

  /*
   * O COLETOR DE RESERVA PRESA (ver `RESERVA_EXPIRA_MS`).
   *
   * Reserva só fica pendurada de um jeito: o processo morrer entre reservar e
   * liquidar — o `finally` do envelope cobre todo o resto. E processo morto no
   * meio não é exceção: todo deploy recria o container. Por isso a varredura de
   * ARRANQUE não pede idade nenhuma: nada que este processo acabou de nascer
   * encontrar aberto pode pertencer a ele.
   *
   * `onModuleInit` e não o construtor: as suítes constroem este serviço à mão e
   * um temporizador no construtor as deixaria penduradas.
   */
  async onModuleInit(): Promise<void> {
    // Script que sobe o AppModule ao lado da API viva (o importador do CRM, 21/10/2026) não é
    // "processo que acabou de nascer no lugar do outro": as reservas abertas são da API em voo.
    // `sem-tarefas-de-fundo.ts` desliga só a varredura de ARRANQUE; a periódica tem idade mínima.
    if (process.env.TETO_VARREDURA_DE_ARRANQUE !== 'off') {
      await this.liberarReservasPresas('arranque').catch((e: unknown) =>
        this.log.error(`varredura de arranque falhou: ${(e as Error).message}`),
      );
    }
    this.varredura = setInterval(() => {
      void this.liberarReservasPresas('varredura').catch((e: unknown) =>
        this.log.error(`varredura falhou: ${(e as Error).message}`),
      );
    }, VARREDURA_MS);
    this.varredura.unref?.();
  }

  onModuleDestroy(): void {
    if (this.varredura) clearInterval(this.varredura);
  }

  /**
   * O dia da EMPRESA, em `AAAA-MM-DD`.
   *
   * `Intl.DateTimeFormat` com `en-CA` devolve exatamente esse formato, e o Node
   * 22 traz ICU completo — nenhuma dependência nova entrou por causa disto
   * (02-CONSTRAINTS). Fuso inválido não derruba a chamada de modelo: cai no
   * padrão e avisa uma vez. Cortar a operação por causa de uma string errada de
   * configuração trocaria um problema pequeno por um grande.
   */
  diaDaEmpresa(fusoHorario: string, agora: Date = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: this.fusoDe(fusoHorario) }).format(agora);
  }

  /**
   * Reserva o custo desta chamada, ou recusa.
   *
   * Devolve `null` quando a empresa NÃO tem teto configurado: nesse caso não há
   * o que impor nem o que contar, e a chamada segue como sempre seguiu. É o
   * estado de toda empresa antes de alguém definir um valor.
   *
   * @throws TetoDiarioEstouradoError quando não cabe. A chamada ao modelo não
   * deve acontecer — o corte é ANTES.
   * @throws TetoIlegivelError quando a sessão do banco não é da empresa cobrada.
   */
  async reservar(p: {
    orgId: string;
    modelo: string;
    entrada: TamanhoDaEntrada;
    tokensSaida: number;
  }): Promise<ReservaDeCusto | null> {
    const cfg = await this.configuracao(p.orgId);
    if (!cfg) return null;

    const fuso = this.fusoDe(cfg.fusoHorario);
    const agora = new Date();
    const dia = this.diaDaEmpresa(fuso, agora);
    const teto = Number(cfg.tetoDiarioUsd);
    const est = estimarCustoUsd(p.modelo, { entrada: p.entrada, tokensSaida: p.tokensSaida });
    const impor = cfg.ativo;

    const janela = await this.lerJanela(p.orgId, dia, this.inicioDoDia(fuso, agora));

    // As recusas que a instrução de reserva não sabe dar, porque valem antes de
    // existir linha do dia — ou porque não são sobre saldo.
    if (impor) {
      if (teto <= 0) await this.recusar(p, dia, teto, est, janela, 'zerado');

      /*
       * MODELO FORA DA TABELA DE PREÇO, COM TETO VALENDO: RECUSA.
       *
       * A alternativa era deixar passar, e ela não fecha: chamada sem preço não
       * soma nada, então uma empresa cujo tráfego seja TODO de modelo fora da
       * tabela passaria para sempre — e esse é o risco do provider
       * `openrouter`, que aceita qualquer modelo em `OPENROUTER_MODEL`: o
       * padrão (`anthropic/claude-sonnet-5.5`) está em `preco.ts`, mas um
       * override para modelo fora da tabela cai aqui. A segunda condição da
       * cláusula de reserva não salva: ela só morde depois de o dia ter sido
       * fechado por gasto MEDIDO, e aqui nunca há gasto medido.
       *
       * Então falha fechada, com o mesmo argumento que a régua usa para
       * capacidade sem classificação: controle que não sabe medir não é
       * controle. Empresa SEM teto e empresa com teto DESLIGADO seguem passando
       * — isto não é um regime novo imposto a todo mundo, é o preço de ter
       * ligado o teto.
       */
      if (!est.medivel) await this.recusar(p, dia, teto, est, janela, 'modelo_sem_preco');

      if (est.usd > teto) await this.recusar(p, dia, teto, est, janela, 'chamada_maior_que_o_teto');

      /*
       * O ARRASTO precisa ser conferido AQUI e não só na instrução: quando a
       * linha do dia ainda não existe, o `INSERT` não avalia cláusula nenhuma —
       * e a linha nova nasceria com saldo cheio, que é exatamente o furo da
       * troca de fuso.
       */
      if (janela.arrastoUsd + est.usd > teto || janela.arrastoUsd >= teto) {
        await this.recusar(p, dia, teto, est, janela, 'dia_no_teto');
      }
    }

    const reserva: ReservaDeCusto = {
      orgId: p.orgId,
      dia,
      modelo: p.modelo,
      valorUsd: est.usd,
      medivel: est.medivel,
      entrada: p.entrada,
    };

    if (await this.tentarReservar(reserva, { teto, impor, arrasto: janela.arrastoUsd, est })) {
      return reserva;
    }

    /*
     * NÃO COUBE — e antes de recusar, a saída para a reserva presa.
     *
     * Uma reserva de chamada morta segura saldo até a virada do dia, e na rota da
     * tela (streaming) a reserva por chamada é alta: poucas chamadas mortas
     * travariam a empresa pelo dia inteiro. Aqui, dentro do contexto da empresa,
     * é o único ponto em que dá para soltá-las sem depender de a varredura
     * enxergar a empresa.
     */
    const liberado = await this.liberarPresasDaLinha(p.orgId, dia, 'recusa');
    if (
      liberado > 0 &&
      (await this.tentarReservar(reserva, { teto, impor, arrasto: janela.arrastoUsd, est }))
    ) {
      return reserva;
    }

    // A janela é relida: entre a primeira leitura e agora, a reserva presa pode
    // ter saído — e o número que o operador vê na recusa tem de ser o de agora.
    const depois = await this.lerJanela(p.orgId, dia, this.inicioDoDia(fuso, agora));
    await this.recusar(p, dia, teto, est, depois, 'dia_no_teto');
    // `recusar` nunca volta; o `throw` é só para o TypeScript enxergar isso.
    throw new Error('inalcançável');
  }

  /**
   * A reserva vira gasto REAL. É o número do provedor que entra — a estimativa
   * some inteira.
   *
   * `custoEstimado: false` no retorno do provider quer dizer "o modelo SERVIDO
   * está fora da tabela de preço" — o que pode acontecer mesmo quando o pedido
   * foi de um modelo com preço (fallback do provedor). Aí não há custo medido a
   * gravar, e a chamada é liquidada pela estimativa da reserva, que é o número
   * conservador que existe: gravar zero seria dar a chamada de graça.
   */
  async liquidar(
    reserva: ReservaDeCusto | null,
    real: { custoUsd: number; custoEstimado: boolean },
  ): Promise<void> {
    if (!reserva) return;
    const medido = real.custoEstimado && Number.isFinite(real.custoUsd);
    await this.ajustar(reserva, {
      gasto: medido ? Math.max(real.custoUsd, 0) : 0,
      estimado: medido ? 0 : reserva.valorUsd,
      // A chamada já foi contada como "sem preço" na reserva quando o PEDIDO era
      // de modelo sem preço; contar de novo aqui era a mesma chamada aparecendo
      // duas vezes. Só conta quando a surpresa aconteceu na volta.
      semPreco: !medido && reserva.medivel ? 1 : 0,
    });
  }

  /**
   * A reserva vira gasto ESTIMADO pelo que foi OBSERVADO — é o caso de
   * `complete()`, que devolve texto e não uso.
   *
   * Quem calcula o valor é o envelope (`provider-com-teto.ts`), com o tamanho da
   * resposta que voltou. Ver a seção "o que entra no livro-caixa" no cabeçalho.
   */
  async liquidarPeloObservado(reserva: ReservaDeCusto | null, custoUsd: number): Promise<void> {
    if (!reserva) return;
    await this.ajustar(reserva, {
      gasto: 0,
      estimado: Math.max(Number.isFinite(custoUsd) ? custoUsd : 0, 0),
      semPreco: 0,
    });
  }

  /** A chamada falhou: devolve a reserva e não grava gasto nenhum. */
  async soltar(reserva: ReservaDeCusto | null): Promise<void> {
    if (!reserva) return;
    await this.ajustar(reserva, { gasto: 0, estimado: 0, semPreco: 0 });
  }

  /**
   * O motivo do corte, ou `null` quando a empresa pode gastar.
   *
   * Consulta de leitura pura, para quem precisa SABER sem reservar — é o que a
   * porta usa. Empresa sem teto configurado devolve `null`.
   *
   * ESTA NUNCA LANÇA, e é a única do serviço que não lança. Quem chama é a porta,
   * que devolve resultado e não estoura — um erro escapando daqui derrubaria a
   * sessão inteira do agente em vez de recusar uma ação. E não abre buraco:
   * quando o teto é ilegível, quem falha fechado é `reservar()`, que está ANTES
   * na ordem — sem chamada de modelo não há ação de agente para a porta barrar.
   * O log sai como erro para o caso não sumir.
   */
  async motivoDeCorte(orgId: string): Promise<string | null> {
    const c = await this.consumo(orgId).catch((e: unknown) => {
      if (!(e instanceof TetoIlegivelError)) throw e;
      this.log.error(`[teto] a porta não conseguiu ler o teto de "${orgId}": ${e.message}`);
      return null;
    });
    if (!c || !c.ativo) return null;
    // Teto zerado tem motivo PRÓPRIO: dizer "teto atingido: US$ 0,00 de US$
    // 0,00" seria descrever como consumo o que é uma empresa desligada.
    if (c.tetoUsd <= 0) return this.texto(c.dia, c.tetoUsd, c.comprometidoUsd, 'zerado');
    if (c.comprometidoUsd < c.tetoUsd) return null;
    return this.texto(c.dia, c.tetoUsd, c.comprometidoUsd, 'dia_no_teto');
  }

  /** O consumo do dia corrente. `null` = empresa sem teto configurado. */
  async consumo(orgId: string): Promise<ConsumoDoDia | null> {
    const cfg = await this.configuracao(orgId);
    if (!cfg) return null;

    const fuso = this.fusoDe(cfg.fusoHorario);
    const agora = new Date();
    const dia = this.diaDaEmpresa(fuso, agora);
    const { linha, arrastoUsd } = await this.lerJanela(orgId, dia, this.inicioDoDia(fuso, agora));
    const teto = Number(cfg.tetoDiarioUsd);
    const gasto = Number(linha?.gastoUsd ?? 0);
    const estimado = Number(linha?.gastoEstimadoUsd ?? 0);
    const reservado = Number(linha?.reservadoUsd ?? 0);
    const comprometido = arredondar(gasto + estimado + reservado + arrastoUsd);

    return {
      dia,
      fusoHorario: cfg.fusoHorario,
      ativo: cfg.ativo,
      tetoUsd: teto,
      gastoUsd: gasto,
      gastoEstimadoUsd: estimado,
      reservadoUsd: reservado,
      arrastoUsd,
      comprometidoUsd: comprometido,
      restanteUsd: arredondar(Math.max(teto - comprometido, 0)),
      chamadas: linha?.chamadas ?? 0,
      chamadasSemPreco: linha?.chamadasSemPreco ?? 0,
      cortes: linha?.cortes ?? 0,
    };
  }

  /**
   * Solta as reservas que nenhuma chamada viva reclama.
   *
   * `arranque` solta TUDO o que estiver aberto: o processo acabou de nascer e
   * nenhuma reserva do anterior pode liquidar. `varredura` solta só o que passou
   * de `RESERVA_EXPIRA_MS` e excede o que este processo tem em voo.
   *
   * A DESCOBERTA de quais empresas têm reserva aberta roda SEM empresa na sessão
   * — é a única consulta aqui que não tem como ter — e por isso levanta o aviso
   * de inventário do gancho de sessão. Sob o papel restrito ela devolve vazio, e
   * aí quem vale é a liberação sob demanda, que roda dentro do contexto da
   * empresa quando a recusa acontece. Declarar este arquivo na lista de
   * chamadores de plataforma resolveria de vez — a lista é de outra fatia e está
   * em FORA DO ESCOPO no relatório.
   */
  async liberarReservasPresas(motivo: 'arranque' | 'varredura'): Promise<number> {
    /*
     * ARRANQUE NÃO PERGUNTA IDADE — e esta consulta precisa dizer isso do mesmo
     * jeito que `liberarPresasDaLinha` já dizia.
     *
     * A versão anterior escrevia o arranque como "corte = agora" e mantinha
     * `"atualizadoEm" < corte` nos dois modos. Parece a mesma coisa e não é:
     * `<` é estrito, então a reserva carimbada NO MESMO INSTANTE do corte não
     * entra. No processo de verdade isso quase nunca aparece (a linha é de
     * antes do boot), o que é exatamente o que torna o defeito perigoso — ele
     * só se mostra quando os dois carimbos coincidem: relógio parado em teste,
     * relógio do banco um fio à frente do relógio do processo, dois arranques
     * no mesmo milissegundo.
     *
     * E o efeito é o pior possível para o arranque: a reserva de uma chamada
     * cujo processo morreu fica de pé, ocupando o teto da empresa até a virada
     * do dia. Era justamente disso que o coletor de arranque existia para
     * salvar. A regra agora é uma só, escrita igual nas duas consultas.
     */
    const paradaDesde = new Date(Date.now() - RESERVA_EXPIRA_MS);
    const semIdade = motivo === 'arranque';
    const linhas = await this.prisma
      .$queryRaw<{ orgId: string; dia: string }[]>`
      SELECT "orgId", "dia"
        FROM "GastoDeIaNoDia"
       WHERE "reservadoUsd" > 0
         AND ( ${semIdade}::boolean OR "atualizadoEm" < ${paradaDesde} )
       ORDER BY "orgId", "dia"`
      .catch((e: unknown) => {
        // Sob `TENANT_MODO=impor` esta consulta LANÇA (é o guarda de "consulta
        // sem empresa"), e sob o papel restrito ela devolveria vazio. Nos dois
        // casos a varredura é o que se perde, não o teto: quem solta a reserva
        // presa no regime restrito é a liberação sob demanda, dentro do contexto
        // da empresa. Avisa uma vez e segue.
        if (!this.varreduraAvisada) {
          this.varreduraAvisada = true;
          this.log.warn(
            `a varredura de reserva presa não consegue descobrir as empresas (${(e as Error).message}). ` +
              'A liberação sob demanda continua valendo; para a varredura valer também, este arquivo ' +
              'precisa entrar na lista de chamadores de plataforma (fora do escopo desta fatia).',
          );
        }
        return [] as { orgId: string; dia: string }[];
      });

    let total = 0;
    for (const l of linhas) {
      // Uma de cada vez, e cada uma no contexto dela: é o que mantém o
      // isolamento valendo durante a operação e o que faz o evento nascer com o
      // dono certo (mesmo desenho do expurgo por retenção).
      total += await comContexto(
        {
          orgId: l.orgId,
          actorType: ActorType.system,
          actorId: null,
          correlationId: novaCorrelacao('teto'),
          origem: 'cron',
        },
        () => this.liberarPresasDaLinha(l.orgId, l.dia, motivo),
      );
    }
    return arredondar(total);
  }

  // -------------------------------------------------------------------------

  /**
   * A configuração da empresa — e a distinção entre "não tem teto" e "não
   * consegui ler o teto". Ver `TetoIlegivelError`.
   */
  private async configuracao(
    orgId: string,
  ): Promise<{ tetoDiarioUsd: unknown; fusoHorario: string; ativo: boolean } | null> {
    const cfg = await this.prisma.tetoDeCustoIa.findUnique({ where: { orgId } });
    const daSessao = contextoAtual()?.orgId?.trim() || null;
    if (daSessao === orgId) return cfg;

    // A empresa do contexto é a que viaja para a sessão do banco
    // (`prisma/sessao-de-banco.ts`). Divergente, a leitura só funcionou porque a
    // conexão ainda é a DONA das tabelas — e vai parar de funcionar na virada.
    if (cfg) {
      if (!this.contextosDivergentes.has(orgId)) {
        this.contextosDivergentes.add(orgId);
        this.log.warn(
          `teto de custo de "${orgId}" lido com a sessão do banco ${daSessao ? `em "${daSessao}"` : 'sem empresa'}: ` +
            'hoje funciona porque a conexão é a dona das tabelas; sob o papel restrito devolveria ' +
            'vazio, em silêncio. Abra o contexto de execução da empresa antes de chamar o modelo.',
        );
      }
      return cfg;
    }
    throw new TetoIlegivelError(orgId, daSessao);
  }

  /** O fuso da empresa, ou o padrão quando o configurado não existe. */
  private fusoDe(fusoHorario: string): string {
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: fusoHorario });
      return fusoHorario;
    } catch {
      if (!this.fusosInvalidos.has(fusoHorario)) {
        this.fusosInvalidos.add(fusoHorario);
        this.log.warn(
          `fuso "${fusoHorario}" não existe (TetoDeCustoIa.fusoHorario). ` +
            `O dia do teto está sendo calculado em ${FUSO_PADRAO}.`,
        );
      }
      return FUSO_PADRAO;
    }
  }

  /** O instante em que o dia corrente começou, no fuso da empresa. */
  private inicioDoDia(fuso: string, agora: Date): Date {
    const partes = new Intl.DateTimeFormat('en-GB', {
      timeZone: fuso,
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(agora);
    const campo = (t: string) => Number(partes.find((p) => p.type === t)?.value ?? '0');
    // `en-GB` devolve 24 à meia-noite em algumas versões de ICU.
    const hora = campo('hour') % 24;
    const decorrido =
      ((hora * 60 + campo('minute')) * 60 + campo('second')) * 1000 + agora.getMilliseconds();
    return new Date(agora.getTime() - decorrido);
  }

  /**
   * A linha do dia e o ARRASTO — o que sobrou de outra linha e ainda conta hoje.
   *
   * POR QUE O ARRASTO EXISTE. O rótulo do dia sai do fuso da empresa, e o fuso é
   * configuração: trocá-lo no meio do dia muda o rótulo, abre linha nova com
   * saldo zero e renova o orçamento — um teto que se contorna editando um campo
   * de texto não é teto. Então a conta olha a janela de três dias e soma também o
   * que estiver comprometido numa linha de OUTRO rótulo que tenha nascido, ou se
   * mexido, DEPOIS do começo do dia corrente.
   *
   * A tolerância de uma hora depois da virada é o que separa isso do normal: a
   * chamada que começou às 23h59 liquida na linha de ontem alguns segundos depois
   * da meia-noite, e ontem não pode passar a contar por causa disso.
   *
   * O que ela não pega: troca de fuso feita na primeira hora do dia novo. É o
   * preço de distinguir os dois casos sem uma coluna a mais, e está em RISCOS no
   * relatório.
   */
  private async lerJanela(orgId: string, dia: string, inicioDoDia: Date): Promise<JanelaDoDia> {
    const linhas = (await this.prisma.gastoDeIaNoDia.findMany({
      where: { orgId, dia: { in: [diaVizinho(dia, -1), dia, diaVizinho(dia, 1)] } },
      select: {
        dia: true,
        gastoUsd: true,
        gastoEstimadoUsd: true,
        reservadoUsd: true,
        chamadas: true,
        chamadasSemPreco: true,
        cortes: true,
        criadoEm: true,
        atualizadoEm: true,
      },
    })) as unknown as LinhaDoDia[];

    const limiteDeToque = new Date(inicioDoDia.getTime() + TOLERANCIA_DA_VIRADA_MS);
    let arrasto = 0;
    let linha: LinhaDoDia | null = null;
    for (const l of linhas) {
      if (l.dia === dia) {
        linha = l;
        continue;
      }
      if (l.criadoEm >= inicioDoDia || l.atualizadoEm >= limiteDeToque) {
        arrasto += comprometidoDe(l);
      }
    }
    return { linha, arrastoUsd: arredondar(arrasto) };
  }

  /**
   * A RESERVA, EM UMA INSTRUÇÃO SÓ.
   *
   * `INSERT ... ON CONFLICT DO UPDATE ... WHERE` é o compare-and-set do
   * Postgres: a linha do dia é travada pelo próprio índice único, a soma vê o
   * que a chamada concorrente acabou de reservar, e a cláusula `WHERE` decide se
   * grava. Zero linha devolvida = não coube.
   *
   * A SEGUNDA CONDIÇÃO (`... < teto`) fecha o caso em que a estimativa é zero,
   * que sem ela deixaria passar para sempre quem já encostou no teto.
   *
   * `$executeRaw`/`$queryRaw` passam pela extensão que declara a empresa à
   * conexão (`prisma/sessao-de-banco.ts`), então a policy de linha vale aqui
   * como vale em qualquer consulta de modelo.
   */
  private async tentarReservar(
    r: ReservaDeCusto,
    p: { teto: number; impor: boolean; arrasto: number; est: EstimativaDeCusto },
  ): Promise<boolean> {
    const chave = this.chave(r.orgId, r.dia);
    const semPreco = p.est.medivel ? 0 : 1;
    // Sobe ANTES da instrução: a varredura não pode confundir a reserva de uma
    // chamada em voo com fantasma de processo morto.
    this.somarAberta(chave, r.valorUsd);
    try {
      const gravadas = await this.prisma.$queryRaw<Array<{ ok: boolean }>>`
        INSERT INTO "GastoDeIaNoDia" (
          "id", "orgId", "dia", "gastoUsd", "gastoEstimadoUsd", "reservadoUsd",
          "chamadas", "chamadasSemPreco", "cortes", "criadoEm", "atualizadoEm"
        )
        VALUES (
          ${randomUUID()}, ${r.orgId}, ${r.dia}, 0, 0, ${r.valorUsd}::decimal,
          1, ${semPreco}::int, 0, now(), now()
        )
        ON CONFLICT ("orgId", "dia") DO UPDATE
          SET "reservadoUsd"     = "GastoDeIaNoDia"."reservadoUsd" + ${r.valorUsd}::decimal,
              "chamadas"         = "GastoDeIaNoDia"."chamadas" + 1,
              "chamadasSemPreco" = "GastoDeIaNoDia"."chamadasSemPreco" + ${semPreco}::int,
              "atualizadoEm"     = now()
          WHERE ${!p.impor}::boolean
             OR ( "GastoDeIaNoDia"."gastoUsd" + "GastoDeIaNoDia"."gastoEstimadoUsd"
                    + "GastoDeIaNoDia"."reservadoUsd" + ${p.arrasto}::decimal
                    + ${r.valorUsd}::decimal <= ${p.teto}::decimal
                  AND "GastoDeIaNoDia"."gastoUsd" + "GastoDeIaNoDia"."gastoEstimadoUsd"
                    + "GastoDeIaNoDia"."reservadoUsd" + ${p.arrasto}::decimal < ${p.teto}::decimal )
        RETURNING true AS ok
      `;
      if (gravadas.length > 0) return true;
      this.somarAberta(chave, -r.valorUsd);
      return false;
    } catch (e) {
      this.somarAberta(chave, -r.valorUsd);
      throw e;
    }
  }

  /**
   * Uma só instrução para as três liquidações. `GREATEST(..., 0)` porque reserva
   * devolvida duas vezes (retentativa malfeita, processo reiniciado no meio) não
   * pode deixar a coluna negativa e virar saldo de graça.
   */
  private async ajustar(
    r: ReservaDeCusto,
    d: { gasto: number; estimado: number; semPreco: number },
  ): Promise<void> {
    this.somarAberta(this.chave(r.orgId, r.dia), -r.valorUsd);
    await this.prisma.$executeRaw`
      UPDATE "GastoDeIaNoDia"
         SET "reservadoUsd"     = GREATEST("reservadoUsd" - ${r.valorUsd}::decimal, 0),
             "gastoUsd"         = "gastoUsd" + ${d.gasto}::decimal,
             "gastoEstimadoUsd" = "gastoEstimadoUsd" + ${d.estimado}::decimal,
             "chamadasSemPreco" = "chamadasSemPreco" + ${d.semPreco}::int,
             "atualizadoEm"     = now()
       WHERE "orgId" = ${r.orgId} AND "dia" = ${r.dia}
    `;
  }

  /**
   * Solta a reserva presa de UMA linha, dentro do contexto da empresa.
   *
   * O que este processo tem em voo fica de pé: só o excedente sai. E o excedente
   * só sai se a linha estiver parada há mais que `RESERVA_EXPIRA_MS` — sem isso,
   * uma segunda réplica soltaria a reserva viva da primeira.
   */
  private async liberarPresasDaLinha(
    orgId: string,
    dia: string,
    motivo: 'arranque' | 'varredura' | 'recusa',
  ): Promise<number> {
    const manter = motivo === 'arranque' ? 0 : this.abertas.get(this.chave(orgId, dia)) ?? 0;
    const paradaDesde = new Date(Date.now() - RESERVA_EXPIRA_MS);
    const linhas = await this.prisma.$queryRaw<{ liberado: number }[]>`
      WITH alvo AS (
        SELECT "id", "reservadoUsd"
          FROM "GastoDeIaNoDia"
         WHERE "orgId" = ${orgId}
           AND "dia" = ${dia}
           AND "reservadoUsd" > ${manter}::decimal
           AND ( ${motivo === 'arranque'}::boolean OR "atualizadoEm" < ${paradaDesde} )
      )
      UPDATE "GastoDeIaNoDia" g
         SET "reservadoUsd" = ${manter}::decimal,
             "atualizadoEm" = now()
        FROM alvo
       WHERE g."id" = alvo."id"
      RETURNING (alvo."reservadoUsd" - g."reservadoUsd")::float8 AS liberado
    `;

    const liberado = arredondar(Number(linhas[0]?.liberado ?? 0));
    if (liberado <= 0) return 0;

    this.log.warn(
      `[teto] ${orgId}/${dia}: soltei US$ ${liberado.toFixed(6)} de reserva presa (${motivo}). ` +
        'Reserva presa é chamada de modelo cujo processo morreu antes de liquidar.',
    );
    await this.eventos
      .registrar({
        orgId,
        tipo: 'ia.reserva_liberada',
        actorType: ActorType.system,
        correlationId: contextoAtual()?.correlationId ?? null,
        payload: { dia, liberadoUsd: liberado },
        /*
         * As palavras da política (RF-R-03): `custo` é dinheiro de verdade aqui —
         * é a única coisa que esta linha conta —, e `motivo` diz quem soltou.
         *
         * `motivo` SÓ AQUI, e não também no payload. `EventLogService.montar`
         * espalha o `conteudo` por cima do payload, então a chave repetida nos
         * dois lados só sobreviveria enquanto os dois valores fossem idênticos
         * letra por letra — e uma frase mais bonita de um lado apagaria a palavra
         * do outro em silêncio. A montagem passou a AVISAR nessa divergência;
         * escrever uma vez só dispensa o aviso. O valor final no payload é o
         * mesmo de sempre ('arranque' | 'varredura' | 'recusa'), que é o que a
         * suíte e quem lê o RASTRO procuram.
         */
        conteudo: {
          argumentos: { dia },
          custo: { liberadoUsd: liberado, moeda: 'USD' },
          motivo,
          resultado: { liberadoUsd: liberado },
          fontes: [{ tipo: 'teto-de-custo', id: `${orgId}/${dia}` }],
        },
        sensibilidade: 'interna',
      })
      .catch((e: unknown) =>
        this.log.error(`a liberação de reserva NÃO entrou no RASTRO: ${(e as Error).message}`),
      );
    return liberado;
  }

  /**
   * Conta o corte, registra no RASTRO e LANÇA. Nunca volta.
   *
   * O evento é gravado em melhor esforço: aqui a ação já NÃO vai acontecer, e uma
   * falha ao escrever o registro não pode transformar uma recusa em uma
   * permissão. A pré-condição do RF-R-02 vale para o caminho que EXECUTA; este é
   * o que barra.
   */
  private async recusar(
    p: { orgId: string; modelo: string },
    dia: string,
    tetoUsd: number,
    est: EstimativaDeCusto,
    janela: JanelaDoDia,
    causa: CausaDoCorte,
  ): Promise<never> {
    const linha = janela.linha;
    const gasto = Number(linha?.gastoUsd ?? 0);
    const estimado = Number(linha?.gastoEstimadoUsd ?? 0);
    const reservado = Number(linha?.reservadoUsd ?? 0);
    const comprometido = arredondar(gasto + estimado + reservado + janela.arrastoUsd);
    const motivo = this.texto(dia, tetoUsd, comprometido, causa, est.usd, p.modelo);

    /*
     * O CORTE É CONTADO MESMO QUANDO A LINHA DO DIA AINDA NÃO EXISTE — e ela não
     * existe justamente nas recusas que acontecem antes de qualquer reserva
     * (teto zerado, modelo sem preço, chamada maior que o dia). Antes, o UPDATE
     * não achava linha e o contador ficava em zero exatamente nos casos que mais
     * interessam a quem for calibrar o valor.
     *
     * `atualizadoEm` NÃO é tocado de propósito: ele é a marca de "a última vez
     * que dinheiro se mexeu nesta linha", e é dela que a varredura tira a idade
     * de uma reserva presa. Uma recusa que a atualizasse manteria a linha sempre
     * fresca e a reserva morta viveria para sempre.
     */
    await this.prisma
      .$executeRaw`
        INSERT INTO "GastoDeIaNoDia" (
          "id", "orgId", "dia", "gastoUsd", "gastoEstimadoUsd", "reservadoUsd",
          "chamadas", "chamadasSemPreco", "cortes", "criadoEm", "atualizadoEm"
        )
        VALUES (${randomUUID()}, ${p.orgId}, ${dia}, 0, 0, 0, 0, 0, 1, now(), now())
        ON CONFLICT ("orgId", "dia") DO UPDATE
          SET "cortes" = "GastoDeIaNoDia"."cortes" + 1
      `
      .catch((e: unknown) => this.log.error(`falhou contar o corte: ${(e as Error).message}`));

    const ctx = contextoAtual();
    await this.eventos
      .registrar({
        orgId: p.orgId,
        tipo: 'ia.recusada_por_teto',
        actorType: ctx?.actorType ?? ActorType.ai,
        actorId: ctx?.actorId ?? null,
        agentSlug: ctx?.agentSlug ?? null,
        correlationId: ctx?.correlationId ?? null,
        // `motivo` vai no `conteudo`, uma vez só — mesmo raciocínio da linha de
        // `ia.reserva_liberada`, acima.
        payload: {
          causa,
          dia,
          modelo: p.modelo,
          tetoUsd,
          gastoUsd: gasto,
          gastoEstimadoUsd: estimado,
          reservadoUsd: reservado,
          arrastoUsd: janela.arrastoUsd,
          comprometidoUsd: comprometido,
          estimativaUsd: est.usd,
          estimativaMedivel: est.medivel,
        },
        /*
         * As palavras da política. `custo` aqui é o número que DECIDIU a recusa —
         * o comprometido do dia contra o teto —, e não o gasto desta chamada, que
         * não aconteceu. `resultado` diz o desfecho em uma palavra, para quem
         * agrupa o RASTRO sem abrir payload.
         */
        conteudo: {
          argumentos: { modelo: p.modelo, dia, estimativaUsd: est.usd },
          custo: {
            comprometidoUsd: comprometido,
            tetoUsd,
            estimativaUsd: est.usd,
            moeda: 'USD',
          },
          motivo,
          resultado: { recusado: true, causa },
          fontes: [{ tipo: 'teto-de-custo', id: `${p.orgId}/${dia}` }],
        },
        sensibilidade: 'interna',
      })
      .catch((e: unknown) =>
        this.log.error(
          `o corte por teto NÃO entrou no RASTRO (${(e as Error).message}). A recusa vale assim mesmo.`,
        ),
      );

    this.log.warn(`[teto] ${p.orgId}: ${motivo}`);
    throw new TetoDiarioEstouradoError(motivo, {
      orgId: p.orgId,
      dia,
      causa,
      tetoUsd,
      gastoUsd: gasto,
      gastoEstimadoUsd: estimado,
      reservadoUsd: reservado,
      estimativaUsd: est.usd,
      modelo: p.modelo,
    });
  }

  /**
   * O motivo, em português, para quem opera — não para quem programou.
   *
   * Ele vai para três lugares ao mesmo tempo: a exceção (que a sessão mostra ao
   * operador), o payload do evento e o log. Um texto só, escrito uma vez.
   *
   * NENHUM DELES MANDA MEXER EM TELA QUE NÃO EXISTE. A versão anterior mandava
   * "aumente o teto em Controle", e a tela de Controle não tem esse campo: o
   * operador ficava procurando. Enquanto a rota de configuração não existir
   * (está em PERGUNTAS do relatório), o texto diz o que dá para fazer hoje.
   */
  private texto(
    dia: string,
    tetoUsd: number,
    comprometidoUsd: number,
    causa: CausaDoCorte,
    estimativaUsd = 0,
    modelo = '',
  ): string {
    const teto = usd(tetoUsd);
    if (causa === 'zerado') {
      return (
        `O teto de custo de IA desta empresa está em ${teto} por dia: nenhuma chamada de modelo ` +
        'é permitida. Quem administra o OS precisa definir um valor para a empresa — ainda não há ' +
        'tela para isso.'
      );
    }
    if (causa === 'modelo_sem_preco') {
      return (
        `O modelo "${modelo}" não está na tabela de preço do OS, então não dá para saber quanto ` +
        `esta chamada custaria — e com teto de custo valendo (${teto} por dia) o OS não deixa ` +
        'passar o que não sabe medir. Cadastre o preço do modelo ou desligue o teto desta empresa.'
      );
    }
    if (causa === 'chamada_maior_que_o_teto') {
      return (
        `Esta única chamada custaria cerca de ${usd(estimativaUsd)}, acima do teto de ${teto} para ` +
        `o dia inteiro (${dataBr(dia)}). Reduza o tamanho do pedido; para mudar o teto, fale com ` +
        'quem administra o OS.'
      );
    }
    return (
      `Teto de custo de IA do dia ${dataBr(dia)} atingido: ${usd(comprometidoUsd)} de ${teto} ` +
      'já comprometidos. As execuções voltam sozinhas na virada do dia; para liberar antes, fale ' +
      'com quem administra o OS.'
    );
  }

  private chave(orgId: string, dia: string): string {
    return `${orgId}|${dia}`;
  }

  private somarAberta(chave: string, delta: number): void {
    const atual = (this.abertas.get(chave) ?? 0) + delta;
    if (atual <= 0) this.abertas.delete(chave);
    else this.abertas.set(chave, atual);
  }
}

/** `US$ 1,2345` — vírgula decimal, que é como se lê em português. */
function usd(v: number): string {
  return `US$ ${v.toFixed(4).replace('.', ',')}`;
}

/** `2026-09-11` -> `11/09/2026`. */
function dataBr(dia: string): string {
  const [a, m, d] = dia.split('-');
  return d ? `${d}/${m}/${a}` : dia;
}

/** O rótulo do dia vizinho, em UTC — rótulo é texto, não instante. */
function diaVizinho(dia: string, deslocamento: number): string {
  const base = new Date(`${dia}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return dia;
  base.setUTCDate(base.getUTCDate() + deslocamento);
  return base.toISOString().slice(0, 10);
}

function comprometidoDe(l: LinhaDoDia): number {
  return Number(l.gastoUsd) + Number(l.gastoEstimadoUsd) + Number(l.reservadoUsd);
}

/** Seis casas, a mesma precisão da coluna — soma de float não pode inventar dígito. */
function arredondar(v: number): number {
  return Number(v.toFixed(6));
}
