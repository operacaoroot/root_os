import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ActorType, Prisma, RiskLevel, ToolCallStatus } from '@prisma/client';
import type { Capacidade, Decisao } from '@mktos/policy';
import { PrismaService } from '../prisma/prisma.service';
import { comContexto } from '../common/contexto-execucao';
import { PolicyService } from '../policy/policy.service';
import {
  SinaisService,
  type ProcedenciaExterna,
  type ProcedenciaSerializada,
} from '../policy/sinais.service';
import {
  ApprovalsService,
  canonicalHash,
  type AprovacaoConsumida,
} from '../approvals/approvals.service';
import { TetoDeCustoIaService } from '../llm/teto-diario.service';
import { ROTULO_CONECTOR_DESLIGADO, conectorDaCapacidade } from '../integrations/conectores';
import { EventLogService, type ConteudoDoEvento } from './event-log.service';
import { EfeitosRegistry, type ContextoDoEfeito } from './efeitos.registry';
import { InterruptoresRegistry } from './interruptores.registry';
import { mensagemDeErro, validarArgs } from './validacao';

export interface ExecCtx {
  orgId: string;
  actorType: ActorType;
  actorId?: string | null;
  agentSlug?: string | null;
  correlationId: string;
  /**
   * Mão única: o runtime marca quando o pedido veio de mensagem, documento ou
   * página. Não existe desmarcar — conteúdo externo só ELEVA nível (RF-G-07).
   *
   * ATÉ 11/09/2026 ESTE CAMPO ERA SÓ `boolean`, E ERA ISSO QUE MANTINHA A
   * TERCEIRA CAMADA DA DEFESA DESLIGADA. `ContextBuilder.montar` já devolvia a
   * marca de mão única (`ProcedenciaExterna`), mas nenhum chamador conseguia
   * passá-la adiante: o tipo aqui só aceitava o booleano, então o runtime
   * descartava o campo e `SinaisService` nunca via `fonte_nao_confiavel`. A
   * cerca e a neutralização funcionavam; o FREIO — a marca que eleva o nível da
   * ação derivada — não acendia em caminho nenhum de produção.
   *
   * O TIPO É O DA MARCA, E O BOOLEANO CONTINUA ACEITO porque `SinaisService`
   * já normaliza os três (`ProcedenciaExterna.de`). `false` aqui significa
   * "ninguém marcou", jamais "desmarque".
   *
   * A MARCA É MUTÁVEL DE PROPÓSITO, e é disso que o runtime depende: o `ExecCtx`
   * nasce no começo da sessão, antes de existir contexto e antes do primeiro
   * resultado de ferramenta. Quem marca depois — o construtor de contexto, cada
   * resultado que volta ao modelo — mexe no MESMO objeto, e a porta lê o estado
   * de agora a cada passagem. Trocar o campo por um booleano recalculado
   * perderia exatamente as marcas que aparecem no meio do laço.
   */
  procedenciaExterna?: boolean | ProcedenciaExterna | ProcedenciaSerializada;
  /** Capacidades que o agente DECLAROU. Fora desta lista, a porta recusa. */
  capacidadesDeclaradas?: string[];
}

export interface ToolCallRequest<A = Record<string, unknown>> {
  capabilityId: string | null;
  args: A;
  ctx: ExecCtx;
  approvalToken?: string;
  resource?: { type: string; id: string };
  /** Em centavos, quando a ação move dinheiro — alimenta o sinal de valor. */
  valorCentavos?: number | null;
}

export type ToolCallResult<R = unknown> =
  | { status: 'executado'; resultado: R; toolCallId: string; decisao: Decisao }
  | {
      status: 'aguardando_aprovacao';
      approvalId: string;
      resumo: string;
      expiraEm: string;
      toolCallId: string;
      decisao: Decisao;
    }
  | { status: 'recusado'; motivo: string; preparo?: unknown; toolCallId: string; decisao: Decisao }
  | { status: 'erro'; mensagem: string; toolCallId: string };

/**
 * As duas recusas que a porta faz ANTES de classificar. São as mais frequentes
 * de um agente novo, e o relatório de calibragem precisa distinguir uma da
 * outra — e as duas de um bloqueio por R5, que é outra conversa.
 */
type CausaDeRecusa =
  | 'fora_da_declaracao'
  | 'argumento_invalido'
  | 'teto_de_custo'
  | 'conector_desligado';

/*
 * O que fica gravado em `PolicyDecision.motivo`. É texto ESTÁVEL de propósito:
 * o relatório agrupa por essa string ("motivo mais frequente" por capacidade),
 * e enfiar o nome do campo que faltou ali dentro espalharia a mesma recusa em
 * dezenas de linhas de contagem 1. O detalhe — qual campo, qual capacidade —
 * vai para `ToolCall.erro` e para o payload do evento.
 */
const ROTULO_DA_RECUSA: Record<CausaDeRecusa, string> = {
  fora_da_declaracao: 'recusado na porta: capacidade fora da declaração do agente',
  argumento_invalido: 'recusado na porta: argumentos inválidos',
  teto_de_custo: 'recusado na porta: teto de custo de IA da empresa estourado no dia',
  // O rótulo do desligamento de conector é o MESMO do caminho direto
  // (`integrations/conectores.ts`), e não uma segunda frase parecida: o
  // relatório de calibragem agrupa por esta string, e duas grafias da mesma
  // recusa virariam duas linhas de meia contagem.
  conector_desligado: ROTULO_CONECTOR_DESLIGADO,
};

/*
 * A PORTA. Nenhuma ação de agente chega num conector, numa API externa ou no
 * banco sem passar por aqui.
 *
 * O callback `efeito` é a peça que faz isto caber no código que já existe: a
 * porta não sabe mandar e-mail nem escrever no ClickUp. Ela é o sanduíche
 * decidir → registrar → impor, e quem chama entrega o efeito.
 *
 * MODO OBSERVAR (GATEWAY_MODO=observar) — e o que ele NÃO afrouxa.
 *
 * Observar existe para calibrar o CATÁLOGO sem parar a operação: a porta
 * classifica tudo, grava cada decisão com `modo=observar` e é dessa tabela que
 * sai o relatório que diz se a régua está apertada ou frouxa demais antes de
 * alguém virar a chave para `impor` (scripts/relatorio-observar.ts).
 *
 * O que observar afrouxa é o REGISTRO, não o EFEITO. Os dois freios da porta
 * valem igual nos dois modos:
 *
 * - RETENÇÃO POR APROVAÇÃO (R3 para cima, e R2 enquanto a aprovação
 *   configurável estiver ligada). Existe porque a ação sai da empresa — manda
 *   mensagem, publica, assume obrigação — e o que a segura não é a régua estar
 *   calibrada, é uma pessoa ter dito sim. Até 10/09/2026 esta porta criava a
 *   aprovação, escrevia "TERIA RETIDO" e chamava o efeito assim mesmo: mandava
 *   a mensagem no nome de alguém que nunca aprovou. Não é observação, é
 *   publicação sem consentimento — contra RF-G-03 e RNF-08.
 *
 * - BLOQUEIO (R5, e capacidade sem classificação, que vale R5). R5 é o degrau
 *   em que o OS PREPARA, REGISTRA E ENCAMINHA para uma pessoa executar na
 *   origem — nunca executa. Até 10/09/2026 observar chamava o efeito de R5
 *   depois de logar "TERIA BLOQUEADO": era a régua agindo no lugar de gente,
 *   que é o que as constraints proíbem. Hoje nenhuma capacidade R5 tem efeito
 *   ligado e a exposição prática era zero; o dia em que alguém ligasse um,
 *   viraria incidente. Passou a falhar fechado — decisão desta fatia, anotada
 *   em docs/AUDITORIA-SEGURANCA.md para revisão.
 *
 * Regra, então: observar afrouxa o que a porta REGISTRA, nunca o que ela DEIXA
 * ACONTECER.
 */
@Injectable()
export class ToolGateway implements OnModuleInit {
  private readonly log = new Logger('ToolGateway');
  private readonly modo = (process.env.GATEWAY_MODO ?? 'observar') as 'impor' | 'observar';

  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: PolicyService,
    private readonly sinais: SinaisService,
    private readonly approvals: ApprovalsService,
    private readonly eventos: EventLogService,
    /*
     * O teto de custo de IA por empresa e por dia (fatia 3.6, RF-G-05).
     *
     * Quem impõe o teto é o envelope do provider de modelo
     * (`llm/provider-com-teto.ts`), que corta ANTES da chamada — este aqui é o
     * segundo cinto: depois que o dia fecha, a empresa também para de DISPARAR
     * AÇÃO por conta de agente, e não fica gastando conector com o resto de um
     * plano que já não pode ser continuado.
     *
     * `@Optional()` NO CONSTRUTOR, OBRIGATÓRIO NO ARRANQUE. Quatro suítes
     * constroem esta porta à mão (test/porta.test.ts, test/runtime.test.ts,
     * test/alcada-reautenticacao.test.ts, test/contexto-aprovacao.test.ts) e um
     * sexto argumento obrigatório as quebraria sem que o assunto delas tivesse
     * mudado — uma delas, inclusive, é de outra fatia desta onda. Mas
     * conveniência de teste não pode virar falha aberta em produção: o
     * `onModuleInit` abaixo RECUSA SUBIR sem o teto. Quem constrói a porta é o
     * Nest, e para o Nest a dependência é obrigatória de fato.
     */
    @Optional() private readonly teto?: TetoDeCustoIaService,
    /*
     * O INTERRUPTOR DE CONECTOR POR EMPRESA (fatia 3.7, RF-G-06).
     *
     * Registro e não import: `ConectoresService` importa `EventLogService`, que
     * é daqui, e a porta importá-lo fecharia o ciclo de módulo. Quem preenche a
     * consulta é o serviço de integrações, no arranque dele — ver
     * `interruptores.registry.ts`.
     *
     * `@Optional()` pelo mesmo motivo do teto: cinco suítes constroem esta porta
     * à mão. A diferença é que aqui a ausência NÃO precisa derrubar o arranque —
     * o registro devolve `null` quando ninguém se inscreveu, e `null` é
     * exatamente o comportamento de antes do gancho. O que denuncia a ausência
     * é a linha de log de `InterruptoresRegistry.registrar`.
     */
    @Optional() private readonly interruptores?: InterruptoresRegistry,
    /*
     * O REGISTRO DE EFEITOS — desde a fatia 3.3 a porta é quem o dispara, nos
     * DOIS caminhos de execução.
     *
     * No caminho do agente o efeito continua chegando por callback (`executar`),
     * porque quem chama sabe montar a chamada e o registro é só um dos destinos
     * possíveis. No caminho PÓS-APROVAÇÃO (`executarAprovado`, chamado por
     * `AcoesService`) não há callback nenhum: a ação foi proposta há minutos ou
     * horas, ninguém segurou função na mão, e o que existe é o id da capacidade
     * e os argumentos gravados. Até 11/09/2026 quem ia buscar a função nesse caso
     * era a própria `AcoesService` — um SEGUNDO ponto do código disparando efeito
     * sem passar pela porta. Agora ela pede à porta.
     *
     * `@Optional()` pelo mesmo motivo dos dois de cima: as suítes constroem esta
     * classe à mão. Sem o registro, `executarAprovado` LANÇA com a frase inteira
     * em vez de deixar a ação sumir — falha fechada.
     */
    @Optional() private readonly efeitos?: EfeitosRegistry,
  ) {
    this.log.log(`porta em modo ${this.modo.toUpperCase()}`);
  }

  /**
   * A asserção de arranque. Sem o teto injetado, a porta deixaria passar toda
   * ação de agente de uma empresa com o orçamento de IA estourado — e o silêncio
   * disso é o problema: nada no log diria que o segundo cinto não está afivelado.
   *
   * O REGISTRO DE EFEITOS ENTROU AQUI NA CORREÇÃO DA FATIA 3.3, e o motivo é o
   * mesmo silêncio. Ele é `@Optional()` no construtor por causa das suítes que
   * montam esta classe à mão, e sem ele nada estoura: `temEfeito` responde
   * `false` para TODA capacidade, e a fila de aprovação passa a devolver "o
   * efeito não está ligado nesta versão" para ações que têm efeito ligado desde
   * sempre. Não é falha aberta — nada sai indevidamente —, mas é uma frase
   * FALSA numa tela, que manda quem opera procurar um defeito de catálogo que
   * não existe. Falha fechada que mente é dívida igual.
   */
  onModuleInit(): void {
    if (!this.teto) {
      throw new Error(
        'ToolGateway subiu sem TetoDeCustoIaService: o teto de custo de IA por empresa não seria ' +
          'imposto às ações de agente (RF-G-05). O serviço vem do LlmModule, que é global — se ele ' +
          'não estiver importado, a porta não pode subir.',
      );
    }
    if (!this.efeitos) {
      throw new Error(
        'ToolGateway subiu sem EfeitosRegistry: a porta não conseguiria disparar efeito nenhum no ' +
          'caminho pós-aprovação, e a fila responderia "o efeito não está ligado nesta versão" ' +
          'sobre capacidades que TÊM efeito — uma frase falsa em vez de um erro. O registro vem do ' +
          'próprio GatewayModule; se ele não estiver nos providers, a porta não pode subir.',
      );
    }
  }

  get modoAtual(): 'impor' | 'observar' {
    return this.modo;
  }

  async executar<A extends Record<string, unknown>, R>(
    req: ToolCallRequest<A>,
    efeito: (args: A, ctx: ExecCtx) => Promise<R>,
  ): Promise<ToolCallResult<R>> {
    const inicio = Date.now();
    const { ctx } = req;
    const cap = req.capabilityId ? this.policy.resolverCapacidade(ctx.orgId, req.capabilityId) : null;

    // 1-2. Escopo do agente ANTES da política: capacidade fora da declaração é
    // recusada pelo gateway (RF-N-03), e isso não depende de nível nenhum.
    if (
      ctx.capacidadesDeclaradas &&
      req.capabilityId &&
      !ctx.capacidadesDeclaradas.includes(req.capabilityId)
    ) {
      return this.recusar(
        req,
        cap,
        'fora_da_declaracao',
        `"${req.capabilityId}" não está nas capacidades declaradas deste agente`,
        inicio,
      );
    }

    /*
     * 1-bis. O INTERRUPTOR DE CONECTOR DA EMPRESA (RF-G-06).
     *
     * Logo depois do escopo do agente, e antes de tudo o mais, porque é um botão
     * de EMERGÊNCIA: quem clicou em "desligar o WhatsApp" mandou a máquina parar,
     * e a ordem não pode depender de a chamada ter passado por mais nenhuma
     * conferência. Uma ida ao banco (medida em menos de 1 ms — ver o cabeçalho de
     * `ConectoresService`) num caminho que já faz cinco escritas.
     *
     * A consulta REGISTRA a recusa no RASTRO por conta própria (`verificar`), e
     * por isso não devolve exceção: a porta devolve resultado, ela não estoura.
     *
     * O QUE ESSA POSIÇÃO CUSTA, e a conta foi feita antes de escolher: vindo
     * ANTES da validação de argumentos, uma chamada MALFORMADA para um conector
     * desligado grava linha no RASTRO — que é append-only e tem retenção de
     * cinco anos (`RASTRO_RETENCAO_DIAS`, hoje 1825). Um agente que reinsista no
     * mesmo erro multiplica isso: cada tentativa deixa uma `conector.recusado` e
     * uma `tool.recusado` que ninguém apaga. A troca é deliberada — validar
     * primeiro faria o botão de emergência depender de o modelo ter acertado o
     * nome de um campo, e "parei a máquina, menos para quem digitou errado" não
     * é parar a máquina. Se um dia o volume incomodar, o lugar de mexer é a
     * retenção por tipo de evento, não esta ordem.
     */
    if (this.interruptores && req.capabilityId) {
      const desligado = await this.interruptores
        .consultar({
          orgId: ctx.orgId,
          capabilityId: req.capabilityId,
          correlationId: ctx.correlationId,
          actorType: ctx.actorType,
          actorId: ctx.actorId,
          agentSlug: ctx.agentSlug,
        })
        /*
         * NÃO CONSEGUIR PERGUNTAR TAMBÉM RECUSA — e o `catch` existe para isso,
         * não para engolir a falha. O interruptor falha fechado de propósito
         * (`EmpresaDivergenteError`: sem provar que a leitura enxerga a linha
         * certa, ele não responde "ligado"), e a porta não pode desfazer essa
         * decisão. O que ela faz é trocar o THROW por uma recusa: um erro
         * escapando daqui derrubaria o laço do agente inteiro em vez de virar uma
         * linha "recusado" com motivo.
         *
         * O ALCANCE DESSA FALHA FECHADA, medido e não estimado: ela atinge as
         * capacidades que TÊM CONECTOR no mapa — 17 das 62 do catálogo
         * resolvido (a conta está travada em `test/conector-desligado.test.ts`).
         * Nas outras 45, `ConectoresService.recusaDe` devolve `null` ANTES de
         * tocar no contexto de execução, e um esquecimento de `comContexto` não
         * as alcança. Não é "toda ferramenta de agente para": é toda ferramenta
         * que sai da casa por um conector conhecido.
         */
        .catch((e: unknown) => {
          this.log.error(
            `[conector] não deu para conferir o interruptor de "${req.capabilityId}" na empresa ` +
              `${ctx.orgId}: ${(e as Error).message} — a chamada foi RECUSADA (falha fechada).`,
          );
          return {
            motivo:
              'Não foi possível conferir se o conector desta ferramenta está ligado para esta ' +
              'empresa, e o OS não age sem essa resposta. Nada foi enviado. Tente de novo; se ' +
              'persistir, fale com quem administra o OS.',
          };
        });
      if (desligado) {
        return this.recusar(req, cap, 'conector_desligado', desligado.motivo, inicio);
      }
    }

    // 1. Argumentos ANTES de classificar. Recusar aqui é o que permite ao
    // modelo corrigir o nome do campo — recusar lá no efeito já custou uma
    // aprovação queimada.
    if (cap) {
      const erros = validarArgs((cap as { argsSchema?: unknown }).argsSchema, req.args);
      if (erros.length) {
        return this.recusar(req, cap, 'argumento_invalido', mensagemDeErro(erros), inicio);
      }
    }

    /*
     * 2-bis. O TETO DE CUSTO DE IA DA EMPRESA, NO DIA (RF-G-05) — primeira metade.
     *
     * Vem depois das duas conferências locais (que não custam consulta e dão ao
     * modelo o retorno de que ele precisa para se corrigir) e ANTES do cálculo
     * de sinais, que são quatro idas ao banco. É a posição mais barata em que a
     * resposta ainda muda o que acontece.
     *
     * SÓ PARA AÇÃO DE AGENTE. Ator humano passa direto — o teto é do gasto com
     * modelo, não do trabalho das pessoas.
     *
     * AQUI SÓ ENTRA QUEM NÃO APRESENTOU TOKEN NENHUM, e a diferença não é de
     * estilo. Uma ação que uma pessoa JÁ APROVOU não pode ser barrada por
     * orçamento de modelo — foi decidida por gente. Só que "apresentou um token"
     * não é "uma pessoa aprovou": o token pode ser inválido, expirado, de outro
     * conteúdo — ou, quando a capacidade NÃO exige aprovação, uma string
     * qualquer que ninguém jamais confere. Testar `!req.approvalToken` aqui e
     * parar por aí era guardar o teto com uma condição que o próprio chamador
     * escolhe. A outra metade da conferência está depois do CONSUMO do token,
     * onde já se sabe se houve gente no caminho.
     */
    const semTokenNenhum = !req.approvalToken;
    if (this.teto && ctx.actorType === ActorType.ai && semTokenNenhum) {
      const corte = await this.teto.motivoDeCorte(ctx.orgId);
      if (corte) return this.recusar(req, cap, 'teto_de_custo', corte, inicio);
    }

    // 3-4. Sinais do momento + decisão.
    const sinais = cap
      ? await this.sinais.calcular({
          orgId: ctx.orgId,
          capabilityId: cap.id,
          agentSlug: ctx.agentSlug,
          valorCentavos: req.valorCentavos,
          procedenciaExterna: ctx.procedenciaExterna,
        })
      : [];

    const { decisao, decisionId } = await this.policy.avaliarERegistrar({
      orgId: ctx.orgId,
      capabilityId: req.capabilityId,
      ctx: { sinais },
      modo: this.modo,
    });

    // 5-6. O REGISTRO VEM ANTES DA DECISÃO, não antes só da execução: assim a
    // recusa também fica gravada, e é dela que sai a prova de que a régua agiu.
    const toolCall = await this.prisma.toolCall.create({
      data: {
        orgId: ctx.orgId,
        capabilityId: cap?.id ?? null,
        decisionId,
        agentSlug: ctx.agentSlug ?? null,
        actorType: ctx.actorType,
        actorId: ctx.actorId ?? null,
        status: ToolCallStatus.erro, // sobrescrito no fim; nunca fica assim
        args: this.redigir(req.args, cap?.efeito.sensibilidade),
        nivel: decisao.nivel as RiskLevel,
        correlationId: ctx.correlationId,
      },
      select: { id: true },
    });

    await this.eventos.registrar({
      orgId: ctx.orgId,
      tipo: 'tool.proposta',
      actorType: ctx.actorType,
      actorId: ctx.actorId,
      agentSlug: ctx.agentSlug,
      capabilityId: cap?.id ?? null,
      toolCallId: toolCall.id,
      decisionId,
      nivel: decisao.nivel as RiskLevel,
      correlationId: ctx.correlationId,
      payload: {
        capacidade: req.capabilityId,
        nivel: decisao.nivel,
        motivo: decisao.motivo,
        sinais: decisao.sinaisAcionados,
      },
      // O hash que vai amarrar a aprovação já é conhecido aqui: é o mesmo
      // conteúdo que a pessoa vai ver e assinar.
      contentHash: this.hashDaAprovacao(req, cap),
      /*
       * A PROPOSTA é o que o agente PEDIU, e o que ela tem é o que ela tem.
       *
       * `aprovador`, `aprovadoEm` e `entrega` FALTAM NESTA LINHA POR CONSTRUÇÃO:
       * ninguém aprovou nada ainda e nada saiu ainda. `payload.rastro.faltando`
       * declara os três, e é assim que tem de ser — preenchê-los aqui seria
       * escrever no RASTRO que houve gente antes de haver, que é a única coisa
       * pior do que um campo em branco. Quem fecha esses três é a linha de
       * execução (`tool.resultado` ou `acao.executada`), amarrada a esta pela
       * correlação.
       */
      conteudo: {
        argumentos: req.args,
        fontes: this.fontesDa(req.capabilityId),
        custo: this.custoAteAqui(inicio),
        ...(conectorDaCapacidade(req.capabilityId)
          ? { canal: conectorDaCapacidade(req.capabilityId) }
          : {}),
      },
      sensibilidade: cap?.efeito.sensibilidade,
    });

    // 7. Decide. São DOIS caminhos, e confundi-los foi o furo: o BLOQUEIO diz
    // o que o OS não faz de jeito nenhum; a RETENÇÃO diz o que ele só faz
    // depois de uma pessoa assinar. Nenhum dos dois afrouxa em observar.
    const observando = this.modo === 'observar';

    /*
     * CAMINHO A — BLOQUEIO, e ele NÃO chama o efeito em modo nenhum.
     *
     * Hoje `permitido: false` é exatamente R5 (`permitido: nivel !== 'R5'` na
     * escada), e R5 é o degrau em que o OS prepara, registra e encaminha para
     * uma pessoa executar na origem. Executar em observar era a régua agindo
     * no lugar de gente.
     *
     * A condição é `!decisao.permitido` e desemboca SEMPRE em recusa: se um
     * dia `permitido` virar false por outro motivo — killswitch por empresa,
     * agente rebaixado, catálogo bloqueado — ele cai aqui, em falha fechada.
     * O atalho que existia (pular a retenção e seguir para o efeito) foi
     * removido justamente para isso: NENHUM motivo novo de `permitido: false`
     * pode herdar em silêncio um bypass de aprovação. O que é específico de R5
     * — devolver o PREPARO — segue chaveado em `decisao.nivel === 'R5'`,
     * dentro de `concluirRecusa`.
     */
    if (!decisao.permitido) {
      if (observando) {
        /*
         * O propósito do modo continua atendido: o que a porta barrou fica
         * registrado na PolicyDecision com `modo=observar` e no evento
         * `tool.recusado` — é dali que sai o relatório de calibragem. O log
         * diz BLOQUEADO e não "teria bloqueado" de propósito: ele bloqueou
         * mesmo, e quem lê precisa saber que a ação não aconteceu.
         */
        this.log.warn(
          `[observar] BLOQUEADO ${req.capabilityId} (${decisao.nivel}): ${decisao.motivo} — ` +
            'em observar o bloqueio também vale; o efeito não foi chamado',
        );
      }
      return this.concluirRecusa(req, cap, toolCall.id, decisao, decisionId, inicio);
    }

    /*
     * CAMINHO B — retenção por aprovação. Vale nos DOIS modos. Sem token, a
     * ação para aqui e vira item na fila; quem executa depois é
     * AcoesService.executarAprovada, com os argumentos GRAVADOS na proposta.
     */
    if (decisao.exigeAprovacao && !req.approvalToken) {
      const pendente = await this.approvals.propor({
        orgId: ctx.orgId,
        propostoPorId: ctx.actorId ?? 'agente',
        propostoPorTipo: ctx.actorType,
        capabilityId: cap?.id ?? null,
        decisionId,
        toolCallId: toolCall.id,
        resourceType: req.resource?.type ?? cap?.id ?? 'acao',
        resourceId: req.resource?.id ?? '-',
        args: req.args,
        hashKeys: cap ? this.hashKeysDe(cap.id, ctx.orgId) : [],
        decisao,
        /*
         * O CANAL viaja com a aprovação, e não é enfeite: quem executa depois é
         * `AcoesService`, que não conhece o catálogo de capacidades e precisa do
         * canal para registrar "por qual canal saiu" (RF-R-03, R3). Gravá-lo
         * aqui é o jeito de a informação atravessar a fila sem um segundo mapa
         * do outro lado.
         */
        canal: conectorDaCapacidade(req.capabilityId) ?? undefined,
      });

      if (observando) {
        // Deixa rastro de que a porta reteve MESMO observando — quem lê o log
        // para calibrar a régua precisa distinguir isto de um bloqueio.
        this.log.warn(
          `[observar] RETIDO ${req.capabilityId} (${decisao.nivel}) — aprovação ${pendente.approvalId}; ` +
            'observar não dispensa aprovação humana',
        );
      }
      await this.prisma.toolCall.update({
        where: { id: toolCall.id },
        data: {
          status: ToolCallStatus.aguardando_aprovacao,
          approvalId: pendente.approvalId,
          duracaoMs: Date.now() - inicio,
        },
      });
      return {
        status: 'aguardando_aprovacao',
        approvalId: pendente.approvalId,
        resumo: pendente.resumo,
        expiraEm: pendente.expiraEm,
        toolCallId: toolCall.id,
        decisao,
      };
    }

    /*
     * A APROVAÇÃO QUE FOI QUEIMADA NESTA CHAMADA, quando houve uma.
     *
     * Guardada porque a LINHA DE DESFECHO precisa dela: a política cobra de um
     * R3 `aprovador` e `aprovadoEm`, e de um R4 também `motivo`. Até 11/09/2026
     * `consumir` devolvia `void` — os três eram lidos, conferidos e jogados
     * fora, e `tool.resultado` saía declarando lacuna numa ação que teve gente
     * no caminho. Ver o bloco "OS PONTOS DE CHAMADA" em `event-log.service.ts`.
     *
     * `null` quando ninguém aprovou nada: capacidade que não exige aprovação
     * segue com os campos ausentes, que é a verdade sobre ela.
     */
    let aprovacao: AprovacaoConsumida | null = null;

    if (decisao.exigeAprovacao && req.approvalToken) {
      /*
       * Token inválido, expirado, já usado ou casando com outro conteúdo NÃO
       * pode virar exceção que escapa daqui: quem chama é o laço do agente, e
       * um throw derrubaria a sessão inteira em vez de registrar "a aprovação
       * não valia". A porta devolve resultado; ela não estoura.
       */
      try {
        aprovacao = await this.approvals.consumir({
          orgId: ctx.orgId,
          token: req.approvalToken,
          resourceType: req.resource?.type ?? cap?.id ?? 'acao',
          resourceId: req.resource?.id ?? '-',
          args: req.args,
          hashKeys: cap ? this.hashKeysDe(cap.id, ctx.orgId) : [],
          actorId: ctx.actorId ?? 'agente',
        });
      } catch (e) {
        const motivo = (e as Error).message;
        await this.prisma.toolCall.update({
          where: { id: toolCall.id },
          data: { status: ToolCallStatus.recusado, erro: motivo.slice(0, 500), duracaoMs: Date.now() - inicio },
        });
        await this.eventos.registrar({
          orgId: ctx.orgId,
          tipo: 'aprovacao.invalida',
          actorType: ctx.actorType,
          actorId: ctx.actorId,
          agentSlug: ctx.agentSlug,
          capabilityId: cap?.id ?? null,
          toolCallId: toolCall.id,
          decisionId,
          nivel: decisao.nivel as RiskLevel,
          correlationId: ctx.correlationId,
          payload: { motivo },
          conteudo: {
            argumentos: req.args,
            fontes: this.fontesDa(req.capabilityId),
            custo: this.custoAteAqui(inicio),
            ...this.canalDa(req.capabilityId),
          },
          sensibilidade: cap?.efeito.sensibilidade,
        });
        return { status: 'recusado', motivo, toolCallId: toolCall.id, decisao };
      }
    }

    /*
     * 7-bis. O TETO DE CUSTO — segunda metade, DEPOIS do consumo do token.
     *
     * Chega aqui com token na mão em dois estados, e eles são opostos:
     *
     *   · a capacidade EXIGIA aprovação e o token foi CONSUMIDO logo acima —
     *     houve gente, a ação passa por cima do orçamento de modelo, é o
     *     comportamento desejado;
     *   · a capacidade NÃO exigia aprovação, e então o bloco acima nem rodou: o
     *     token nunca foi olhado por ninguém. Aceitar isso como "uma pessoa
     *     aprovou" é o desvio — basta mandar `approvalToken: "x"` para pular o
     *     teto, hoje e sempre, sem nunca ser conferido.
     *
     * É por isso que a conferência é aqui e não lá em cima: neste ponto a
     * pergunta deixou de ser "veio texto no campo?" e passou a ser "alguém
     * aprovou?". A recusa fecha o MESMO ToolCall e a MESMA decisão já abertos —
     * `recusar()` criaria um segundo par e a linha do relatório de calibragem
     * contaria a mesma tentativa duas vezes.
     */
    if (this.teto && ctx.actorType === ActorType.ai && !semTokenNenhum && !decisao.exigeAprovacao) {
      const corte = await this.teto.motivoDeCorte(ctx.orgId);
      if (corte) {
        return this.recusarDepoisDeRegistrar(
          req,
          toolCall.id,
          decisao,
          decisionId,
          'teto_de_custo',
          corte,
          inicio,
        );
      }
    }

    // 8. Executa e registra o que saiu.
    try {
      /*
       * O efeito roda DENTRO do contexto de execução (RF-T-04, RNF-09). O
       * `ExecCtx` já carregava tenant, ator e correlação; o que faltava era
       * eles alcançarem quem o efeito chama — o registro de efeitos, o
       * conector, o log. Nenhum parâmetro novo atravessa a cadeia inteira:
       * quem precisar lê de `contextoAtual()`.
       */
      const resultado = await comContexto({ ...ctx, origem: 'agente' }, () => efeito(req.args, ctx));
      await this.prisma.toolCall.update({
        where: { id: toolCall.id },
        data: {
          status: ToolCallStatus.executado,
          resultado: this.resumirResultado(resultado),
          duracaoMs: Date.now() - inicio,
        },
      });
      /*
       * O QUE SAIU. `resultado` é o que a ferramenta devolveu (R2); `entrega` é
       * o que o OUTRO LADO respondeu (R3) — e as duas só são a mesma coisa
       * quando a ação sai da casa, que é exatamente quando a capacidade tem
       * conector. Sem conector não há "outro lado", e `entrega` fica de fora em
       * vez de virar uma cópia do campo vizinho com nome de promessa.
       */
      const canal = conectorDaCapacidade(req.capabilityId);
      const oQueVoltou = this.resumirResultado(resultado);
      await this.eventos.registrar({
        orgId: ctx.orgId,
        tipo: 'tool.resultado',
        actorType: ctx.actorType,
        actorId: ctx.actorId,
        agentSlug: ctx.agentSlug,
        capabilityId: cap?.id ?? null,
        toolCallId: toolCall.id,
        decisionId,
        nivel: decisao.nivel as RiskLevel,
        correlationId: ctx.correlationId,
        payload: { duracaoMs: Date.now() - inicio, ok: true },
        // O mesmo hash que amarra a aprovação ao conteúdo exato.
        contentHash: this.hashDaAprovacao(req, cap),
        conteudo: {
          argumentos: req.args,
          resultado: oQueVoltou,
          fontes: this.fontesDa(req.capabilityId),
          custo: this.custoAteAqui(inicio),
          desfazer: cap?.desfazer,
          ...(canal ? { canal, entrega: oQueVoltou } : {}),
          ...this.deQuemAprovou(aprovacao),
        },
        sensibilidade: cap?.efeito.sensibilidade,
      });
      return { status: 'executado', resultado, toolCallId: toolCall.id, decisao };
    } catch (e) {
      const mensagem = (e as Error).message;
      await this.prisma.toolCall.update({
        where: { id: toolCall.id },
        data: { status: ToolCallStatus.erro, erro: mensagem.slice(0, 500), duracaoMs: Date.now() - inicio },
      });
      await this.eventos.registrar({
        orgId: ctx.orgId,
        tipo: 'tool.erro',
        actorType: ctx.actorType,
        actorId: ctx.actorId,
        agentSlug: ctx.agentSlug,
        capabilityId: cap?.id ?? null,
        toolCallId: toolCall.id,
        decisionId,
        correlationId: ctx.correlationId,
        payload: { erro: mensagem.slice(0, 300) },
        /*
         * A FALHA CARREGA O MESMO VOCABULÁRIO DO SUCESSO — mesma disciplina de
         * `acao.falhou` em `acoes.service.ts`. Quem lê o RASTRO procurando "o
         * que aconteceu com aquela ação" não pode achar metade dos campos só
         * porque ela deu errado; e "quem tinha aprovado" é justamente a pergunta
         * que uma falha levanta.
         */
        conteudo: {
          argumentos: req.args,
          fontes: this.fontesDa(req.capabilityId),
          custo: this.custoAteAqui(inicio),
          ...(conectorDaCapacidade(req.capabilityId)
            ? { canal: conectorDaCapacidade(req.capabilityId), entrega: { ok: false, erro: mensagem.slice(0, 300) } }
            : {}),
          ...this.deQuemAprovou(aprovacao),
        },
        sensibilidade: cap?.efeito.sensibilidade,
      });
      return { status: 'erro', mensagem, toolCallId: toolCall.id };
    }
  }

  // ==========================================================================
  // O SEGUNDO CAMINHO DE EXECUÇÃO — a ação que uma pessoa já aprovou
  // ==========================================================================
  //
  // Ele existe porque aprovar TEM de executar: sem ele a fila é um museu. O que
  // mudou na fatia 3.3 é o DONO do disparo. Antes `AcoesService` ia buscar a
  // função no `EfeitosRegistry` por conta própria — o código compilava, o RASTRO
  // saía completo, e mesmo assim havia dois lugares no programa capazes de
  // alcançar um conector. Um deles não era a porta.
  //
  // O que a porta acrescenta aqui, e que não é cerimônia:
  //
  //   · RECLASSIFICA. A decisão de política aconteceu na PROPOSTA, que pode ter
  //     sido ontem. Entre uma coisa e outra o catálogo da empresa pode ter
  //     subido a capacidade para R5 (sobrescrita por tenant é suportada), e R5 é
  //     o degrau em que o OS nunca executa — prepara e encaminha. Sem esta
  //     conferência, aprovar uma proposta velha furaria a régua nova.
  //   · CAPACIDADE DESCONHECIDA VALE R5. Capacidade que saiu do catálogo (ou que
  //     nunca esteve nele) não tem classificação, e sem classificação o nível é o
  //     máximo, que é bloqueio. Falha fechada.
  //   · REVALIDA OS ARGUMENTOS contra o `argsSchema` de HOJE. Os argumentos são
  //     os gravados na proposta; o schema pode ter apertado desde então.
  //
  // O que ela NÃO faz aqui, e é de propósito: não abre `ToolCall` nem
  // `PolicyDecision` novos, e não escreve evento. O par já existe desde a
  // proposta, e `AcoesService` fecha os dois com `acao.executada`/`acao.falhou`.
  // Abrir um segundo par faria o relatório de calibragem contar a mesma ação
  // duas vezes.
  //
  // ==========================================================================
  // POR QUE SÃO DOIS MÉTODOS, E NÃO UM — o limbo da onda 6, invertido
  // ==========================================================================
  //
  // A primeira versão desta fatia tinha um método só, `executarAprovado`, que
  // CONFERIA e DISPARAVA na mesma chamada. `AcoesService` marcava a aprovação
  // como `consumida` e só então chamava — porque o efeito vinha junto, e não
  // havia como perguntar antes sem disparar.
  //
  // O preço era exato, e é o mesmo limbo que a onda 6 pagou com o interruptor,
  // só que de cabeça para baixo: se QUALQUER uma das três conferências abaixo
  // recusasse — a régua de hoje reclassificou para bloqueio, a capacidade saiu
  // do catálogo, o `argsSchema` apertou —, a ação não saía e a aprovação já
  // estava `consumida`. `consumida` é estado TERMINAL e se lê como "executada":
  // some da fila (`listar` devolve as pendentes), `confirm` recusa o que não
  // está pendente, e `executarAprovada` recusa o que não está `confirmada`.
  // Ninguém reexecuta, ninguém repropõe, e a mensagem de erro ainda afirmava
  // que "a aprovação continua registrada" — verdade sobre a LINHA, falsa sobre
  // o ESTADO em que ela ficou.
  //
  // Partido em dois, `AcoesService` pergunta ANTES de queimar o uso único, no
  // mesmo lugar em que já pergunta pelo interruptor de conector e pela mesma
  // razão: recusa não pode custar a aprovação. Depois de `conferirAprovado`
  // passar, o que sobra em `dispararAprovado` é o efeito — e um efeito que
  // estoura é falha de execução de verdade, que a aprovação consumida descreve
  // corretamente.

  /** A capacidade tem efeito ligado nesta versão? */
  temEfeito(capabilityId: string): boolean {
    return this.efeitos?.tem(capabilityId) ?? false;
  }

  /**
   * A régua de HOJE ainda deixa esta ação sair? — a METADE QUE NÃO EXECUTA.
   *
   * NÃO TOCA EM NADA: não chama efeito, não escreve no banco, não registra
   * evento. Existe para ser chamada ANTES de a aprovação virar `consumida` —
   * ver o bloco acima. Lança quando a resposta é não, e lançar é o certo neste
   * caminho (ao contrário de `executar`): quem chama é uma rota HTTP de
   * confirmação, não o laço do agente, e a exceção vira resposta com motivo em
   * vez de um "executado" mentiroso.
   *
   * As frases dizem, com todas as letras, que a aprovação NÃO foi consumida.
   * Isso só é verdade porque quem chama respeita a ordem; se alguém inverter,
   * a mensagem volta a mentir — e é por isso que a ordem está escrita aqui e
   * travada por teste em `test/escritas-pela-porta.test.ts`.
   */
  conferirAprovado(entrada: {
    capabilityId: string;
    args: Record<string, unknown>;
    orgId: string;
  }): void {
    const { capabilityId, args, orgId } = entrada;

    /*
     * Sem registro não há como disparar coisa nenhuma — e esta conferência
     * mora AQUI, e não em `dispararAprovado`, justamente para que a ausência
     * seja descoberta antes de a aprovação ser queimada. Em produção isto não
     * acontece: `onModuleInit` recusa subir sem o registro.
     */
    if (!this.efeitos) {
      throw new Error(
        'ToolGateway sem EfeitosRegistry: a porta não tem como disparar o efeito de uma ação ' +
          'aprovada. O registro vem do GatewayModule — se ele não estiver injetado, a fila de ' +
          'aprovação não pode executar nada. A aprovação NÃO foi consumida.',
      );
    }

    const cap = this.policy.resolverCapacidade(orgId, capabilityId);
    if (!cap) {
      throw new ForbiddenException(
        `"${capabilityId}" não está no catálogo desta empresa. Capacidade sem classificação vale ` +
          'o nível máximo (R5): o OS prepara e encaminha, nunca executa. A aprovação NÃO foi ' +
          'consumida — ela continua confirmada, e volta a executar se a capacidade retornar ao ' +
          'catálogo.',
      );
    }

    /*
     * A QUINTA ENTRADA PARA A GAVETA SEM SAÍDA — 11/09/2026.
     *
     * "Esta capacidade tem efeito ligado nesta versão?" era a única das cinco
     * causas de recusa da execução que a conferência da fila NÃO antecipava,
     * porque a pergunta não fazia parte dela: `AcoesService.executarAprovada`
     * perguntava sozinho, mais adiante, e devolvia `sem_efeito`.
     *
     * O estado em que isso deixava a aprovação é o defeito, não a recusa. O
     * roteiro do controlador é conferir (passo 2) → confirmar (passo 3) →
     * executar (passo 4). Como a pergunta não estava no passo 2, ela só
     * acontecia no 4 — com a aprovação já `confirmada`. E `confirmada`-e-não-
     * consumida é a gaveta: some de `listar` (que devolve as pendentes),
     * `confirm` recusa o que não está pendente, e não existe superfície na tela
     * que chame `executarAprovada` de novo. A ação ficava lá até expirar.
     *
     * A ALTERNATIVA — "deixar o desfecho de ser terminal" — seria dar à tela um
     * botão de reexecutar aprovação confirmada. Ela foi recusada por duas
     * razões: (1) esse botão é uma SEGUNDA porta para executar uma aprovação,
     * e o produto passou três ondas reduzindo o número de caminhos até o efeito;
     * (2) ele não resolveria nada aqui — efeito não ligado não volta a ligar
     * sozinho, é falta de CÓDIGO nesta versão, então reexecutar recusaria de
     * novo, para sempre. As outras quatro causas são transitórias (religar o
     * conector, mudar a régua, repropor com o formato de hoje); esta não é.
     *
     * Perguntando AQUI, a recusa custa zero: a aprovação continua PENDENTE, a
     * fila continua mostrando o item, e `porQueNao` já traduz a frase para a
     * tela — porque ela chama esta mesma conferência (`impedimentoDaPorta`).
     *
     * A pergunta de `executarAprovada` FICA onde está, como último portão: ela
     * cobre quem chama sem ter perguntado antes (o script de terminal) e
     * mantém o desfecho `sem_efeito`, que a tela de Atendimento já sabe ler.
     */
    if (!this.efeitos.tem(capabilityId)) {
      throw new ForbiddenException(
        `"${capabilityId}" está classificada no catálogo e aprovada, mas o efeito dela não está ` +
          'ligado nesta versão do OS: não há o que executar. Nada foi enviado e a aprovação NÃO ' +
          'foi consumida — ela continua pendente na fila. Diferente das outras recusas, esta não ' +
          'se conserta religando nem repropondo: falta código, e o caminho é abrir a pendência.',
      );
    }

    const decisao = this.policy.simular(orgId, capabilityId);
    if (!decisao.permitido) {
      throw new ForbiddenException(
        `A régua desta empresa hoje classifica "${capabilityId}" como ${decisao.nivel} e não ` +
          `executa: ${decisao.motivo}. Nada foi enviado e a aprovação NÃO foi consumida: ela ` +
          'continua confirmada, e sai assim que a classificação voltar a permitir.',
      );
    }

    const erros = validarArgs((cap as { argsSchema?: unknown }).argsSchema, args);
    if (erros.length) {
      throw new BadRequestException(
        `Os argumentos gravados na proposta não casam mais com o formato de "${capabilityId}": ` +
          `${mensagemDeErro(erros)}. Nada foi enviado e a aprovação NÃO foi consumida — o caminho ` +
          'é propor de novo com os argumentos no formato de hoje.',
      );
    }
  }

  /**
   * Dispara o efeito de uma ação JÁ APROVADA E JÁ CONFERIDA — a METADE QUE AGE.
   *
   * Só chame depois de `conferirAprovado` ter passado. Ela repete a conferência
   * de registro porque o tipo não consegue provar que a outra rodou, mas NÃO
   * repete a de política: repetir faria a mesma decisão duas vezes e daria a
   * falsa impressão de que a ordem entre as duas metades não importa.
   */
  async dispararAprovado(entrada: {
    capabilityId: string;
    args: Record<string, unknown>;
    ctx: ContextoDoEfeito;
  }): Promise<unknown> {
    if (!this.efeitos) {
      throw new Error(
        'ToolGateway sem EfeitosRegistry: dispararAprovado foi chamado sem o registro. ' +
          'Chame conferirAprovado antes — é ela que recusa sem custar a aprovação.',
      );
    }
    return this.efeitos.executar(entrada.capabilityId, entrada.args, entrada.ctx);
  }

  private async concluirRecusa<A extends Record<string, unknown>, R>(
    req: ToolCallRequest<A>,
    cap: Capacidade | null,
    toolCallId: string,
    decisao: Decisao,
    decisionId: string,
    inicio: number,
  ): Promise<ToolCallResult<R>> {
    await this.prisma.toolCall.update({
      where: { id: toolCallId },
      data: { status: ToolCallStatus.recusado, duracaoMs: Date.now() - inicio },
    });

    /*
     * R5 é o único degrau que PREPARA e ENCAMINHA em vez de executar, e a
     * política cobra isso por escrito: `preparo`, `encaminhadoPara`,
     * `encaminhadoEm` e `desfechoInformado`.
     *
     * Os três primeiros a porta sabe: o preparo é o que ela devolve, e quem o
     * recebe é quem chamou, agora. `desfechoInformado` NÃO tem fonte neste
     * repositório — ninguém volta para dizer ao OS o que a pessoa fez com o
     * preparo —, e por isso ele continua aparecendo em `rastro.faltando`. É
     * dívida declarada, não esquecimento.
     */
    const doR5: ConteudoDoEvento =
      decisao.nivel === 'R5'
        ? {
            preparo: { capacidade: req.capabilityId, argumentos: req.args },
            encaminhadoPara: req.ctx.actorId ?? req.ctx.agentSlug ?? null,
            encaminhadoEm: new Date(),
          }
        : {};

    await this.eventos.registrar({
      orgId: req.ctx.orgId,
      tipo: 'tool.recusado',
      actorType: req.ctx.actorType,
      actorId: req.ctx.actorId,
      agentSlug: req.ctx.agentSlug,
      capabilityId: req.capabilityId,
      toolCallId,
      decisionId,
      nivel: decisao.nivel as RiskLevel,
      correlationId: req.ctx.correlationId,
      // `modo` no payload diz com que porta a linha foi escrita — observar ou
      // impor. O bloqueio é o mesmo nos dois, mas quem lê para calibrar precisa
      // saber qual estava valendo, e o log do processo não sobrevive ao
      // container; o RASTRO sobrevive.
      payload: { motivo: decisao.motivo, nivel: decisao.nivel, modo: this.modo },
      conteudo: {
        argumentos: req.args,
        fontes: this.fontesDa(req.capabilityId),
        custo: this.custoAteAqui(inicio),
        ...this.canalDa(req.capabilityId),
        ...doR5,
      },
      sensibilidade: cap?.efeito.sensibilidade,
    });
    return {
      status: 'recusado',
      motivo: decisao.motivo,
      // R5 não é "não pode": é preparado e devolvido para a pessoa executar
      // na origem. O preparo é o que ela leva junto.
      preparo: decisao.nivel === 'R5' ? { capacidade: req.capabilityId, argumentos: req.args } : undefined,
      toolCallId,
      decisao,
    };
  }

  /**
   * Recusa da PORTA depois de a proposta já estar registrada.
   *
   * Mesma forma de `recusar()` — mesmo rótulo estável na decisão, mesmo detalhe
   * no `ToolCall.erro` e no evento —, só que fechando o par ToolCall/decisão que
   * já existe em vez de abrir outro. Usada pela segunda metade da conferência de
   * teto, que só pode acontecer depois do consumo do token.
   */
  private async recusarDepoisDeRegistrar<R>(
    req: ToolCallRequest<Record<string, unknown>>,
    toolCallId: string,
    decisao: Decisao,
    decisionId: string,
    causa: CausaDeRecusa,
    motivo: string,
    inicio: number,
  ): Promise<ToolCallResult<R>> {
    const { ctx } = req;
    const rotulo = ROTULO_DA_RECUSA[causa];

    await this.prisma.policyDecision.update({
      where: { id: decisionId },
      data: { permitido: false, exigeAprovacao: false, motivo: rotulo },
    });
    await this.prisma.toolCall.update({
      where: { id: toolCallId },
      data: {
        status: ToolCallStatus.recusado,
        erro: motivo.slice(0, 500),
        duracaoMs: Date.now() - inicio,
      },
    });
    await this.eventos.registrar({
      orgId: ctx.orgId,
      tipo: 'tool.recusado',
      actorType: ctx.actorType,
      actorId: ctx.actorId,
      agentSlug: ctx.agentSlug,
      capabilityId: req.capabilityId,
      toolCallId,
      decisionId,
      nivel: decisao.nivel as RiskLevel,
      correlationId: ctx.correlationId,
      payload: { causa, motivo, capacidade: req.capabilityId, nivel: decisao.nivel, modo: this.modo },
      conteudo: {
        argumentos: req.args,
        fontes: this.fontesDa(req.capabilityId),
        custo: this.custoAteAqui(inicio),
        ...this.canalDa(req.capabilityId),
      },
    });
    return {
      status: 'recusado',
      motivo,
      toolCallId,
      decisao: { ...decisao, permitido: false, exigeAprovacao: false, motivo: rotulo },
    };
  }

  /**
   * Recusa da PORTA, antes da régua decidir qualquer coisa: capacidade que o
   * agente não declarou (RF-N-03) e argumento que não casa com o schema.
   */
  private async recusar<A extends Record<string, unknown>, R>(
    req: ToolCallRequest<A>,
    cap: Capacidade | null,
    causa: CausaDeRecusa,
    motivo: string,
    inicio: number,
  ): Promise<ToolCallResult<R>> {
    const { ctx } = req;

    /*
     * A DECISÃO ENTRA NO RASTRO ANTES DA RECUSA (RF-P-03).
     *
     * Até 10/09/2026 este caminho criava ToolCall e evento e pulava
     * `avaliarERegistrar`. Resultado: as duas recusas mais frequentes de um
     * agente novo — capacidade não declarada e argumento com o nome errado —
     * não existiam em `PolicyDecision`, e o relatório de calibragem, que lê
     * exatamente essa tabela, não as enxergava. Quem fosse decidir a virada de
     * `observar` para `impor` decidiria sem os dois números que mais importam.
     */
    const { decisao, decisionId } = await this.policy.avaliarERegistrar({
      orgId: ctx.orgId,
      capabilityId: req.capabilityId,
      // Sem sinais, de propósito: a porta recusa ANTES de calculá-los (são
      // quatro consultas ao banco), então o nível gravado aqui é o de base.
      ctx: {},
      modo: this.modo,
    });

    /*
     * `avaliar()` só devolve `permitido: false` em R5 — para a régua, uma
     * leitura R0 pedida por um agente que não a declarou continua permitida.
     * Quem recusou foi a PORTA, e a linha precisa dizer isso, senão o
     * relatório conta a recusa como decisão liberada. `exigeAprovacao` cai
     * junto pelo mesmo motivo: nada foi retido, nada chegou à fila de ninguém.
     *
     * Isto é UMA ESCRITA A MAIS num caminho raro. O certo seria
     * `avaliarERegistrar` aceitar a recusa da porta e o motivo dela —
     * `apps/api/src/policy/policy.service.ts` é de outra fatia desta onda, e a
     * mudança está anotada no relatório.
     */
    const rotulo = ROTULO_DA_RECUSA[causa];
    await this.prisma.policyDecision.update({
      where: { id: decisionId },
      data: { permitido: false, exigeAprovacao: false, motivo: rotulo },
    });

    const toolCall = await this.prisma.toolCall.create({
      data: {
        orgId: ctx.orgId,
        capabilityId: cap?.id ?? null,
        decisionId,
        agentSlug: ctx.agentSlug ?? null,
        actorType: ctx.actorType,
        actorId: ctx.actorId ?? null,
        status: ToolCallStatus.recusado,
        args: this.redigir(req.args, cap?.efeito.sensibilidade),
        nivel: decisao.nivel as RiskLevel,
        // O detalhe fica aqui e no evento: qual campo faltou, qual capacidade
        // o agente tentou. No `motivo` da decisão vai só o rótulo, que é o que
        // o relatório agrupa.
        erro: motivo.slice(0, 500),
        correlationId: ctx.correlationId,
        duracaoMs: Date.now() - inicio,
      },
      select: { id: true },
    });
    await this.eventos.registrar({
      orgId: ctx.orgId,
      tipo: 'tool.recusado',
      actorType: ctx.actorType,
      actorId: ctx.actorId,
      agentSlug: ctx.agentSlug,
      capabilityId: cap?.id ?? null,
      toolCallId: toolCall.id,
      decisionId,
      nivel: decisao.nivel as RiskLevel,
      correlationId: ctx.correlationId,
      payload: { causa, motivo, capacidade: req.capabilityId, nivel: decisao.nivel },
      conteudo: {
        argumentos: req.args,
        fontes: this.fontesDa(req.capabilityId),
        custo: this.custoAteAqui(inicio),
        ...this.canalDa(req.capabilityId),
      },
      sensibilidade: cap?.efeito.sensibilidade,
    });
    return {
      status: 'recusado',
      // Para o MODELO vai o detalhe — é com ele que ele corrige o nome do
      // campo. Para o RASTRO vai o rótulo, no `decisao.motivo`, igualzinho ao
      // que ficou gravado na linha da decisão.
      motivo,
      toolCallId: toolCall.id,
      decisao: { ...decisao, permitido: false, exigeAprovacao: false, motivo: rotulo },
    };
  }

  // ==========================================================================
  // O VOCABULÁRIO DO RASTRO — os campos que `niveis.<R>.rastro` nomeia
  // ==========================================================================
  //
  // Os trechos abaixo existem para que as cinco chamadas a `eventos.registrar`
  // deste arquivo digam a MESMA coisa do mesmo jeito. O mapa campo a campo está
  // no cabeçalho de `event-log.service.ts`, no bloco "OS PONTOS DE CHAMADA";
  // aqui fica só o que a porta sabe responder.
  //
  // E O QUE ELA **NÃO** SABE, dito por escrito para ninguém procurar defeito
  // onde não há — cada um com dono:
  //
  //   · `artefato` e `versaoPrompt` (R1) são do RUNTIME DO AGENTE
  //     (`agents/agent-runtime.service.ts`): quem gerou o texto sabe com qual
  //     versão de prompt gerou. A porta vê uma chamada de ferramenta, não a
  //     geração — inventar aqui seria plantar no RASTRO um dado não apurado.
  //   · `estadoAnterior` e `estadoNovo` (R4) são do EFEITO/CONECTOR: só ele
  //     enxerga o registro antes e depois. A porta recebe o retorno, e retorno
  //     não é "o antes".
  //   · `desfechoInformado` (R5) não tem dono neste repositório: ninguém volta
  //     para contar ao OS o que a pessoa fez com o preparo.
  //   · `agente`, quando quem dispara é gente — não existe agente para nomear.
  //
  // Por isso a conferência não vai a zero, e não deve ir: ver "A FRONTEIRA" no
  // mesmo bloco de `event-log.service.ts`.

  /**
   * Os campos que só existem porque uma PESSOA aprovou — `aprovador`,
   * `aprovadoEm` e, em R4, `motivo`.
   *
   * Vêm do retorno de `ApprovalsService.consumir`, e não de uma segunda leitura
   * por id: assim a linha do RASTRO fala da MESMA aprovação que foi queimada.
   *
   * Objeto VAZIO quando não houve aprovação nenhuma. `montar` já descarta chave
   * com valor nulo, mas devolver `{}` diz a coisa certa em voz alta: numa
   * capacidade que não exige aprovação, a ausência desses campos é a verdade
   * sobre ela, não uma lacuna.
   */
  /**
   * O CANAL — por onde a ação sai, ou SAIRIA.
   *
   * Vale também nas linhas de RECUSA, e é de propósito: quem audita um "não"
   * precisa saber de que porta de saída se está falando. `entrega` é que não
   * entra ali — nada foi entregue —, e a diferença entre os dois campos é
   * exatamente essa.
   */
  private canalDa(capabilityId: string | null): ConteudoDoEvento {
    const canal = conectorDaCapacidade(capabilityId);
    return canal ? { canal } : {};
  }

  private deQuemAprovou(ap: AprovacaoConsumida | null): ConteudoDoEvento {
    if (!ap) return {};
    return {
      aprovador: ap.aprovadoPorId,
      aprovadoEm: ap.aprovadoEm,
      ...(ap.motivo ? { motivo: ap.motivo } : {}),
    };
  }

  /**
   * As FONTES de uma passagem pela porta: a própria ferramenta.
   *
   * A política pergunta "de onde veio o que o modelo leu". Numa chamada de
   * ferramenta a resposta é a ferramenta — e, quando ela sai da casa, o conector
   * por onde saiu. As fontes de CONTEXTO (as notas, o espelho, a pauta que o
   * runtime montou antes de propor) não passam por aqui e continuam no bloco 02
   * do traço da sessão; declarar aqui uma lista que a porta não tem seria pior
   * do que declarar a que ela tem.
   */
  private fontesDa(capabilityId: string | null): Array<Record<string, unknown>> {
    if (!capabilityId) return [];
    const conector = conectorDaCapacidade(capabilityId);
    return [{ tipo: 'ferramenta', id: capabilityId, ...(conector ? { conector } : {}) }];
  }

  /**
   * O CUSTO que a porta mede: tempo.
   *
   * Dinheiro não passa por aqui. O gasto com modelo é medido em
   * `SessionStep.custoUsd` (por passo) e somado em `GastoDeIaNoDia` (por empresa
   * e dia) — inventar um valor em centavos nesta linha seria plantar no RASTRO
   * um número que ninguém apurou. O que a porta sabe, e que é custo de verdade
   * para quem audita uma ação, é quanto ela demorou.
   */
  private custoAteAqui(inicio: number): Record<string, unknown> {
    return { duracaoMs: Date.now() - inicio, apuracaoDeGasto: 'GastoDeIaNoDia' };
  }

  /**
   * O `hashConteudo` da linha — o MESMO que amarra a aprovação.
   *
   * Calculado com a mesma função e os mesmos argumentos de
   * `ApprovalsService.consumir`, para que a linha do RASTRO e a linha da
   * aprovação apontem para o mesmo conteúdo. Recalcular em vez de receber de
   * volta é o que evita mexer em `approvals.service.ts` (arquivo de outra
   * fatia): `canonicalHash` é função pura e exportada justamente para isso.
   */
  private hashDaAprovacao(req: ToolCallRequest<Record<string, unknown>>, cap: Capacidade | null): string | null {
    if (!cap) return null;
    return canonicalHash(
      req.resource?.type ?? cap.id,
      req.args ?? {},
      this.hashKeysDe(cap.id, req.ctx.orgId),
    );
  }

  private hashKeysDe(capabilityId: string, orgId: string): string[] {
    const cap = this.policy.resolverCapacidade(orgId, capabilityId);
    // Sem hashKeys declarado, o corpo INTEIRO entra no hash. Falha fechada:
    // capacidade que esqueceu de declarar prende a aprovação a tudo.
    return (cap as unknown as { hashKeys?: string[] })?.hashKeys ?? [];
  }

  /** Segredo nunca vai cru para o registro (RF-R-04). */
  private redigir(args: unknown, sensibilidade?: string): Prisma.InputJsonValue {
    if (sensibilidade === 'restrita') {
      return { redigido: true, chaves: Object.keys((args as object) ?? {}) };
    }
    return (args ?? {}) as Prisma.InputJsonValue;
  }

  // O resultado inteiro pode ser enorme (uma listagem de 500 tarefas). O
  // registro guarda o suficiente para auditar, não uma segunda cópia do banco.
  //
  // ==========================================================================
  // O CORTE NÃO PODE PARTIR UM PAR SUBSTITUTO — medido em 11/09/2026
  // ==========================================================================
  //
  // `texto.slice(0, 4000)` corta em UNIDADES DE 16 BITS, não em caracteres. Um
  // resultado com qualquer caractere fora do plano básico — emoji, etiqueta
  // Unicode, ideograma raro — tem chance de cair com a fronteira dos 4000 no
  // MEIO de um par substituto. O que sobra é meio caractere, e meio caractere
  // não é texto válido: o Postgres recusa o `jsonb`, o `toolCall.update` falha,
  // e a porta transforma uma execução BEM-SUCEDIDA em `erro` — a ferramenta já
  // tinha rodado, o efeito já tinha acontecido, e o RASTRO registra o contrário.
  //
  // Foi descoberto pelo caminho de propósito: um documento envenenado controla
  // o conteúdo que a busca de memória devolve, então quem escreve o documento
  // escolhe onde cai o caractere 4000. Fazer o registro da própria ação falhar
  // é um jeito barato de sumir do RASTRO.
  //
  // `Array.from` corta em PONTOS DE CÓDIGO: cada elemento é um caractere
  // inteiro, e nenhum par nasce partido. O teto continua sendo 4000 unidades de
  // 16 bits (o `while` desconta), então o tamanho gravado não cresce.
  private resumirResultado(r: unknown): Prisma.InputJsonValue {
    const texto = typeof r === 'string' ? r : JSON.stringify(r ?? null);
    if (texto.length > 4000) return { resumo: cortarSemPartirCaractere(texto, 4000), truncado: true };
    return (r ?? {}) as Prisma.InputJsonValue;
  }
}

/** Corta em ponto de código, nunca no meio de um par substituto. Ver `resumirResultado`. */
export function cortarSemPartirCaractere(texto: string, limite: number): string {
  if (texto.length <= limite) return texto;
  const pontos = Array.from(texto);
  let usado = 0;
  let i = 0;
  while (i < pontos.length && usado + pontos[i].length <= limite) {
    usado += pontos[i].length;
    i++;
  }
  return pontos.slice(0, i).join('');
}
