import { Logger } from '@nestjs/common';
import type {
  ChamadaParaTeto,
  LlmEffort,
  LlmMessage,
  LlmProvider,
  LlmStepInput,
  LlmStepOutput,
} from './llm.provider';
import {
  caracteresDaConversa,
  estimarCustoDaResposta,
  tamanhoDeTexto,
  type TamanhoDaEntrada,
} from './estimativa';
import type { ReservaDeCusto, TetoDeCustoIaService } from './teto-diario.service';
import { OrcamentoIlegivelError, type OrcamentoDeAgenteService } from './orcamento-de-agente.service';
import type { GastoPorFuncaoService } from './gasto-por-funcao.service';
import { slugDaChamada } from './modelo-da-chamada';
import { contextoAtual } from '../common/contexto-execucao';

/*
 * O TETO DE CUSTO POR EMPRESA E POR DIA, POSTO NO CAMINHO (RF-G-05, RNF-05).
 *
 * POR QUE AQUI, E NÃO NO LAÇO DO AGENTE
 * O laço (`agents/agent-runtime.service.ts`) já impõe os tetos POR AGENTE e POR
 * EXECUÇÃO, e ele é o lugar certo para esses dois. Só que ele não é o único
 * caminho até o modelo: relatório, curadoria e pauta chamam `complete()` sem
 * passar por sessão de agente nenhuma. Um teto de EMPRESA posto no laço deixaria
 * de fora justamente o gasto que roda sozinho, de madrugada, por cron.
 *
 * Este envelope é o ponto por onde TODA chamada de modelo passa — é o objeto que
 * o token `LLM_PROVIDER` entrega a quem injeta. E ele é o último ponto antes da
 * ida à rede: cortar aqui é cortar ANTES, no sentido literal.
 *
 * A ORDEM É INEGOCIÁVEL, e é o que o teste da fatia mede:
 *   0. conferir o ORÇAMENTO MENSAL DO AGENTE, quando há agente (fatia A3) —
 *      leitura pura, recusa ou volta calada
 *   1. reservar   (pode recusar — e aí nada mais acontece)
 *   2. chamar o modelo
 *   3. liquidar com o custo real, ou soltar a reserva se a chamada falhou
 *
 * Inverter 1 e 2 seria exatamente "cortar depois", que é o defeito que esta
 * fatia existe para consertar. Inverter 0 e 1 deixaria reserva pendurada
 * segurando o teto da empresa por uma chamada que o orçamento do agente já
 * havia barrado — o porquê está no bloco de `step()`.
 *
 * MODELO POR FUNÇÃO E GASTO POR FUNÇÃO (rodada dos agentes, 21/10/2026, A1):
 *  · a reserva usa o modelo que o provedor VAI mandar (`modeloDaChamada`: o
 *    explícito, senão o da função no cadastro, senão o padrão), e não mais o
 *    padrão do provedor — reservar Opus para uma chamada de Haiku cortaria a
 *    empresa com 40 vezes o que ela gasta;
 *  · o agente da chamada é o `agentSlug`, senão o slug da `funcao` no cadastro,
 *    senão o do contexto. O orçamento mensal passa a valer também para
 *    `complete()` com função. Função sem registro `Agent` (as novas) não tem
 *    orçamento e NUNCA é recusada por isso: quando o slug veio da função, a
 *    leitura ilegível do orçamento é aviso, não recusa;
 *  · toda chamada soma no livro por função (`GastoPorFuncaoService`), com ou sem
 *    teto, em melhor esforço — é de onde a tela de Agentes lê o gasto do mês.
 *
 * EMPRESA SEM TETO CONFIGURADO passa direto: `reservar()` devolve `null`,
 * nenhuma linha é escrita e nada muda para quem nunca configurou. Ligar o teto é
 * uma decisão por empresa, não um regime novo imposto a todas.
 *
 * ----------------------------------------------------------------------------
 * CHAMADA SEM EMPRESA RESOLVIDA
 * ----------------------------------------------------------------------------
 * Sem empresa não há teto que se aplique — não dá para cobrar de quem não se
 * sabe quem é. Isso ERA falha aberta e silenciosa no caminho que mais importa: o
 * agendador da pauta chamava o modelo fora de requisição, sem empresa, e o aviso
 * saía uma vez por processo. Os chamadores foram consertados (o agendador abre o
 * contexto de execução da empresa da rotina; relatório, ficha e rodada informam a
 * empresa explicitamente), e o que sobra aqui é a rede de proteção: passa, e
 * BERRA no log a cada 100 chamadas em vez de uma vez na vida.
 *
 * Recusar toda chamada sem empresa continua sendo tentador e continua errado:
 * derrubaria caminho legítimo ainda não mapeado, e o lugar que falha fechado por
 * não-saber é o serviço do teto (`TetoIlegivelError`, quando a empresa existe mas
 * a sessão do banco não a enxerga).
 */

/** De quantas em quantas chamadas sem empresa o aviso se repete. */
const AVISO_A_CADA = 100;

export class ProviderComTeto implements LlmProvider {
  private readonly log = new Logger('ProviderComTeto');
  private readonly semEmpresa = new Map<string, number>();

  constructor(
    private readonly interno: LlmProvider,
    private readonly teto: TetoDeCustoIaService,
    /*
     * O ORÇAMENTO MENSAL POR AGENTE (fatia A3). `@Optional` na prática: há suíte
     * que constrói este envelope com dois argumentos, e o que se perde sem ele é
     * o eixo do agente — o teto da empresa continua valendo igual. Em produção
     * quem o injeta é a fábrica de `llm.module.ts`, sempre.
     */
    private readonly orcamentoDoAgente?: OrcamentoDeAgenteService,
    /** O livro do gasto por função (A1). Opcional pelo mesmo motivo do orçamento. */
    private readonly gastoPorFuncao?: GastoPorFuncaoService,
  ) {}

  /** Avisos de orçamento ilegível para slug vindo da função: uma vez por slug. */
  private readonly avisadosSemOrcamento = new Set<string>();

  get name(): string {
    return this.interno.name;
  }
  get model(): string {
    return this.interno.model;
  }
  get configured(): boolean {
    return this.interno.configured;
  }
  get supportsTools(): boolean {
    return this.interno.supportsTools;
  }

  get leAnexos(): boolean {
    return this.interno.leAnexos ?? false;
  }

  get buscaNaWeb(): boolean {
    return this.interno.buscaNaWeb ?? false;
  }

  /** O modelo que o provedor de dentro vai mandar. Ver `LlmProvider.modeloDaChamada`. */
  modeloDaChamada(input: { funcao?: string; model?: string; effort?: LlmEffort }): {
    modelo: string;
    esforco?: LlmEffort;
  } {
    return (
      this.interno.modeloDaChamada?.(input) ?? { modelo: input.model ?? this.interno.model, esforco: input.effort }
    );
  }

  tetoDeSaida(chamada: ChamadaParaTeto): number {
    return this.interno.tetoDeSaida(chamada);
  }

  /**
   * Uma pergunta, uma resposta.
   *
   * `complete()` devolve texto e não uso, então não há custo real para liquidar.
   * A RESERVA usa o `max_tokens` do pedido, que é o limite superior de verdade; a
   * LIQUIDAÇÃO usa o tamanho do texto que voltou, que é fato observado e fica na
   * ordem do custo que aconteceu. Gravar a reserva no lugar — o que este arquivo
   * fazia até 11/09/2026 — cortava a empresa com uma fração do orçamento que ela
   * de fato gastou. Ver o cabeçalho de `teto-diario.service.ts`.
   */
  async complete(input: LlmMessage): Promise<string> {
    const orgId = this.empresaDe(input.orgId, 'complete');
    const modelo = this.modeloDaChamada(input).modelo;
    const entrada = tamanhoDeTexto(input.system, input.user);
    const tokensSaida = this.interno.tetoDeSaida({ tipo: 'completa', maxTokens: input.maxTokens });
    const quem = this.agenteDe(input);
    if (orgId && quem.slug) await this.conferirOrcamento({ orgId, quem, modelo, entrada, tokensSaida });
    const reserva = orgId ? await this.teto.reservar({ orgId, modelo, entrada, tokensSaida }) : null;

    let resposta: string | null = null;
    try {
      resposta = await this.interno.complete(input);
      return resposta;
    } finally {
      // No `finally` de propósito: chamada que estoura (rede, 4xx, recusa do
      // provider) tem de DEVOLVER a reserva. Deixar reserva pendurada é cortar
      // a empresa por um gasto que não existiu.
      await this.encerrar(
        reserva,
        resposta === null
          ? { falhou: true }
          : { observado: this.custoObservado(reserva, entrada, resposta) },
      );
      if (orgId && resposta !== null) {
        const observado = estimarCustoDaResposta(modelo, { entrada, resposta });
        await this.gastoPorFuncao?.registrar({
          orgId,
          funcao: input.funcao,
          agentSlug: quem.slug,
          modelo,
          estimadoUsd: observado.medivel ? observado.usd : 0,
          naoMedida: !observado.medivel,
        });
      }
    }
  }

  /** UM passo da conversa com ferramentas. O laço continua sendo do runtime. */
  async step(input: LlmStepInput): Promise<LlmStepOutput> {
    const orgId = this.empresaDe(input.orgId, 'step');
    const modelo = this.modeloDaChamada(input).modelo;
    // Os esquemas das ferramentas entram: eles sobem INTEIROS a cada passo e num
    // agente com catálogo grande são o maior bloco fixo da chamada.
    const entrada = caracteresDaConversa(input.system, input.turns, input.tools);
    const tokensSaida = this.interno.tetoDeSaida({
      tipo: 'passo',
      maxTokens: input.maxTokens,
      streaming: Boolean(input.onTextDelta),
    });

    /*
     * O ORÇAMENTO MENSAL DO AGENTE VEM ANTES DA RESERVA DO DIA (fatia A3), e a
     * ordem não é estética.
     *
     * `conferir()` é leitura PURA: ela recusa ou volta calada, sem escrever
     * linha nenhuma. `reservar()` ESCREVE — ela soma a estimativa em
     * `reservadoUsd`. Se a reserva viesse primeiro e o orçamento do agente
     * recusasse depois, a reserva ficaria pendurada segurando teto da empresa
     * até o coletor de reserva presa passar (até 30 min), por uma chamada que
     * nunca aconteceu. Invertendo, a recusa por orçamento não deixa resíduo.
     *
     * SÓ VALE PARA PASSO DE AGENTE. `complete()` não tem agente: relatório,
     * curadoria e ficha chamam o modelo em nome da empresa, não de ninguém — e
     * atribuir esse gasto a um agente qualquer seria inventar procedência.
     */
    const quem = this.agenteDe(input);
    if (orgId && quem.slug) await this.conferirOrcamento({ orgId, quem, modelo, entrada, tokensSaida });

    const reserva = orgId
      ? await this.teto.reservar({ orgId, modelo, entrada, tokensSaida })
      : null;

    let usoReal: { custoUsd: number; custoEstimado: boolean } | null = null;
    let modeloServido = modelo;
    try {
      const saida = await this.interno.step(input);
      modeloServido = saida.usage.modeloServido || modelo;
      /*
       * O custo REAL vem do provedor — é ele que a liquidação grava, e é por
       * isso que a estimativa some por inteiro. Vale inclusive quando o modelo
       * RECUSOU: a recusa custou tokens, e um custo que aconteceu tem de entrar
       * no dia (é a mesma regra que o laço do agente já segue ao gravar o passo).
       */
      usoReal = { custoUsd: saida.usage.custoUsd, custoEstimado: saida.usage.custoEstimado };
      return saida;
    } finally {
      await this.encerrar(reserva, usoReal ? { real: usoReal } : { falhou: true });
      if (orgId && usoReal) {
        await this.gastoPorFuncao?.registrar({
          orgId,
          funcao: input.funcao,
          agentSlug: quem.slug,
          modelo: modeloServido,
          gastoUsd: usoReal.custoEstimado ? usoReal.custoUsd : 0,
          naoMedida: !usoReal.custoEstimado,
        });
      }
    }
  }

  /**
   * Em nome de quem é a chamada: o `agentSlug` informado, senão o slug da
   * `funcao` no cadastro, senão o do contexto de execução. `daFuncao` diz se o
   * slug foi deduzido da função (aí a falta de orçamento legível não recusa).
   */
  private agenteDe(input: { agentSlug?: string; funcao?: string }): { slug: string; daFuncao: boolean } {
    const explicito = input.agentSlug?.trim();
    if (explicito) return { slug: explicito, daFuncao: false };
    const daFuncao = slugDaChamada({ funcao: input.funcao });
    if (daFuncao) return { slug: daFuncao, daFuncao: true };
    return { slug: contextoAtual()?.agentSlug?.trim() || '', daFuncao: false };
  }

  /**
   * O orçamento MENSAL do agente, antes da reserva (ver o bloco em `step()`).
   *
   * As funções novas do cadastro não têm registro `Agent`, e portanto não têm
   * orçamento: o serviço volta calado quando lê a linha e ela não existe. A
   * única recusa que sobraria por falta de registro é a leitura ILEGÍVEL (o
   * contexto da sessão não é o da empresa). Para slug deduzido da função, isso
   * vira aviso no log, nunca recusa: errar o contexto não pode derrubar uma
   * função que nem orçamento tem. Para slug explícito, a regra de sempre vale.
   */
  private async conferirOrcamento(p: {
    orgId: string;
    quem: { slug: string; daFuncao: boolean };
    modelo: string;
    entrada: TamanhoDaEntrada;
    tokensSaida: number;
  }): Promise<void> {
    if (!this.orcamentoDoAgente) return;
    try {
      await this.orcamentoDoAgente.conferir({
        orgId: p.orgId,
        agentSlug: p.quem.slug,
        modelo: p.modelo,
        entrada: p.entrada,
        tokensSaida: p.tokensSaida,
      });
    } catch (e) {
      if (!(p.quem.daFuncao && e instanceof OrcamentoIlegivelError)) throw e;
      if (!this.avisadosSemOrcamento.has(p.quem.slug)) {
        this.avisadosSemOrcamento.add(p.quem.slug);
        this.log.warn(
          `orçamento de "${p.quem.slug}" (slug da função) ilegível fora do contexto da empresa: ` +
            'a chamada seguiu sem o eixo do agente; o teto da empresa continua valendo.',
        );
      }
    }
  }

  // -------------------------------------------------------------------------

  /** O custo estimado da chamada que ACONTECEU, com a resposta já na mão. */
  private custoObservado(
    reserva: ReservaDeCusto | null,
    entrada: TamanhoDaEntrada,
    resposta: string,
  ): number {
    if (!reserva) return 0;
    return estimarCustoDaResposta(reserva.modelo, { entrada, resposta }).usd;
  }

  /**
   * De quem é o gasto: o que o chamador informou vence; senão, o contexto de
   * execução.
   *
   * O `orgId` INFORMADO DIZ DE QUEM É O TETO, E NÃO SUBSTITUI O CONTEXTO.
   * Enquanto a aplicação conectar ao banco como DONA das tabelas (o estado de
   * hoje, ver `prisma/sessao-de-banco.ts`), o isolamento por linha é inerte e o
   * livro-caixa é escrito do mesmo jeito. Depois da virada para o papel restrito,
   * NÃO SERÁ: a policy recorta pela empresa da SESSÃO, e uma chamada que informe
   * `orgId` sem abrir o contexto de execução não enxerga a configuração — é por
   * isso que o serviço do teto LANÇA (`TetoIlegivelError`) em vez de entender o
   * vazio como "empresa sem teto".
   */
  private empresaDe(informado: string | undefined, onde: string): string | null {
    const org = informado?.trim() || contextoAtual()?.orgId?.trim() || '';
    if (org) return org;

    const n = (this.semEmpresa.get(onde) ?? 0) + 1;
    this.semEmpresa.set(onde, n);
    if (n === 1 || n % AVISO_A_CADA === 0) {
      this.log.error(
        `chamada de modelo em ${onde}() SEM empresa resolvida (${n}ª vez): o teto de custo por ` +
          'empresa e por dia não se aplica a ela e o gasto não entra em conta nenhuma (RF-G-05). ' +
          'Informe `orgId` na chamada ou abra o contexto de execução antes.',
      );
    }
    return null;
  }

  /**
   * Fecha a reserva. Nunca deixa escapar exceção: um erro ao liquidar não pode
   * apagar nem substituir o resultado (ou o erro) da chamada ao modelo — o pior
   * que a falha aqui causa é uma reserva pendurada, e para essa existe o coletor
   * (ver `TetoDeCustoIaService.liberarReservasPresas`).
   */
  private async encerrar(
    reserva: ReservaDeCusto | null,
    desfecho:
      | { falhou: true }
      | { observado: number }
      | { real: { custoUsd: number; custoEstimado: boolean } },
  ): Promise<void> {
    if (!reserva) return;
    try {
      if ('falhou' in desfecho) await this.teto.soltar(reserva);
      else if ('observado' in desfecho)
        await this.teto.liquidarPeloObservado(reserva, desfecho.observado);
      else await this.teto.liquidar(reserva, desfecho.real);
    } catch (e) {
      this.log.error(
        `reserva de ${reserva.valorUsd} USD não liquidou em ${reserva.orgId}/${reserva.dia}: ` +
          `${(e as Error).message}. O coletor de reserva presa a solta em até 30 min.`,
      );
    }
  }
}
