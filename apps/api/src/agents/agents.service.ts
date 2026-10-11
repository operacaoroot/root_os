import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ActorType, EstadoDeAgente, Prisma, SessionStatus } from '@prisma/client';
import { AgentSopEdicaoSchema, AgentSopSalvaSchema, DIAS_DA_JANELA, emHorasDecimais, totalDaSemana } from '@mktos/shared';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { AgendaLocalService } from './agenda-local.service';
import { AgentEstadoHumanoSchema, AgendaLocalReciboSchema, AgentEstadoHumanoPainelSchema } from '@mktos/shared';
import { EVENTO_DO_CHECKOUT } from '../work/checkout-de-tarefa';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EventLogService } from '../gateway/event-log.service';
import { contextoAtual } from '../common/contexto-execucao';
import { exigirAcessoAtual } from '../memory/acesso-memoria';
import { donosDaCasa } from './donos-da-casa';
import { CheckoutDeTarefaService } from '../work/checkout-de-tarefa.service';
import { soltarPorCausaDoEstado } from '../work/checkout-de-tarefa';
import {
  EVENTO_DA_TRANSICAO,
  MARGEM_DA_SESSAO_VIVA_MS,
  TRANSICOES,
  estadoTrabalha,
  exigeMotivo,
  postoNaTela,
  situacaoDoAgente,
  transicaoPermitida,
  type SessaoEmCurso,
} from './estado-do-agente';
import {
  DESFECHO_BOM_DE_SESSAO,
  horasDoAgente,
  inicioDaJanela,
  janelaContada,
} from './horas-do-agente';
import {
  CAMPOS_DO_PROCEDIMENTO,
  FormatoDaSopInvalido,
  ONDE_MORA_O_CAMPO,
  ROTULO_DO_CAMPO,
  camposFaltando,
  escalacaoPara,
  validarProcedimento,
  vetoDeCabecalhoFixo,
} from './sop';

/*
 * A LISTA BRANCA DE CAMPOS DO AGENTE (item 18 da auditoria, `AUDITORIA-SEGURANCA.md`).
 *
 * `atualizar` recebia `Prisma.AgentUpdateInput` CRU. Era método morto, e a
 * auditoria registrou exatamente o risco que isso guarda: "no dia em que alguém
 * ligar uma tela de agente nela, o item sai de 'caminho não existe' para
 * 'caminho aberto sem validação' sem que nada no código denuncie". Esta fatia é
 * esse dia — a tela de Agentes passa a escrever —, então o recorte vem antes.
 *
 * O QUE FICA DE FORA, E POR QUÊ:
 *
 *   · `capacidades` — é a declaração de menor privilégio do agente. A porta
 *     recusa capacidade fora dela (`tool-gateway.service.ts`, ramo
 *     `fora_da_declaracao`), então editar a lista É ALARGAR O ALCANCE de quem
 *     chega a conector. Isso não pode virar caixa de seleção numa tela guardada
 *     só por permissão de papel;
 *   · `autonomiaAte` — o teto de risco declarado. Mesmo argumento;
 *   · `contextoFixo` — vira o bloco "O QUE VALE NESTA EMPRESA" no prompt de
 *     sistema. É o item da auditoria "contexto do cliente virando regra da casa";
 *   · `modelo`, `effort`, `maxPassos`, `tetoCustoUsd`, `tetoSegundos` — governam
 *     gasto de IA e pertencem à fatia do teto, não a esta;
 *   · `cron`, `tz`, `ativo`, `estado` — são a superfície de ROTINAS (fatia 5.1),
 *     que está sendo escrita em paralelo. Fora daqui para não haver dois donos.
 *
 * O que sobra é a IDENTIFICAÇÃO do agente: quem ele é, o que faz, de quem é e
 * em que pilar mora — que é o que o organograma e os sete campos precisam.
 *
 * E O QUE ENTRA NOS CAMPOS QUE SOBRARAM (correção de 11/09/2026). Lista branca
 * fecha QUAIS campos entram; não fecha O QUE entra neles. `nome`, `missao` e
 * `pilar` são texto livre e viram as três primeiras linhas do prompt de sistema
 * (`montarSop`): escrever `ESCALAÇÃO\n…` na missão abria ali o mesmo bloco
 * rival que o procedimento recusava num passo. Os três passam pelo veto de
 * cabeçalho — o MESMO de `sop.ts`, não uma segunda regra.
 */
export const AgenteIdentidadeSchema = z
  .object({
    nome: z
      .string()
      .trim()
      .min(2, 'nome: curto demais')
      .max(80, 'nome: longo demais')
      .superRefine(vetoDeCabecalhoFixo('nome')),
    missao: z
      .string()
      .trim()
      .min(10, 'missão: curta demais')
      .max(400, 'missão: longa demais')
      .superRefine(vetoDeCabecalhoFixo('missão')),
    pilar: z
      .string()
      .trim()
      .min(2, 'pilar: curto demais')
      .max(60, 'pilar: longo demais')
      .superRefine(vetoDeCabecalhoFixo('pilar')),
    /*
     * Sem `.uuid()`: identificador de usuário é uuid por padrão, mas semente e
     * suíte gravam ids legíveis ("pedro-do-contexto"), e recusar por FORMATO
     * daria a impressão de trava onde não há. A trava de verdade é a consulta
     * logo abaixo, que exige o usuário existir NESTA empresa.
     */
    donoId: z.string().trim().min(1, 'dono: obrigatório').max(64, 'dono: identificador longo demais'),
  })
  .strict()
  .partial();

export type AgenteIdentidade = z.infer<typeof AgenteIdentidadeSchema>;

@Injectable()
export class AgentsService {
  private readonly log = new Logger('AgentsService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    /*
     * O CHECKOUT DE TAREFA (fatia A4). Obrigatório, e NÃO `@Optional()`: pausar
     * ou encerrar um agente TEM de soltar as tarefas dele, e um serviço que
     * subisse sem isso faria a pausa deixar trabalho preso em silêncio — o
     * defeito exato que a A4 veio consertar. Opcional aqui seria uma defesa que
     * se desliga sozinha em qualquer contexto que esquecesse de injetá-la.
     *
     * A dependência vai de `agents` para `work` porque quem conhece `WorkTask` é
     * o módulo de trabalho; não há ciclo (ver o cabeçalho de
     * `work/work.module.ts`). Ela entrou ANTES de `eventos` de propósito: as
     * três suítes que constroem este serviço na mão passaram a ser obrigadas a
     * informá-la, em vez de herdarem `undefined` em silêncio.
     */
    private readonly checkout: CheckoutDeTarefaService,
    /*
     * `@Optional()` pelo mesmo motivo do laço: há suíte que constrói este
     * serviço sem o rastro. Sem ele, mudar estado continua mudando estado e a
     * auditoria administrativa continua registrando — o que se perde é a linha
     * na cadeia de hash, e o log grita quando isso acontece.
     */
    @Optional() private readonly eventos?: EventLogService,
    @Optional() private readonly agenda?: AgendaLocalService,
  ) {}

  /* ======================================================================== *
   * O DONO, CONFERIDO CONTRA A EMPRESA — a regra dos QUATRO lugares
   * ======================================================================== *
   *
   * A resolução em si mora em `donos-da-casa.ts`, e o porquê de ela morar lá
   * está no cabeçalho daquele arquivo: eram QUATRO lugares expondo o nome do
   * dono, e o quarto (`AgentRuntime.executar`, o caminho real de execução) não
   * é deste serviço. Método privado de um dos dois donos daria o quinto.
   *
   * O organograma já fazia o cruzamento (contra o mapa de gente que ele
   * carrega inteiro); `roster` e `detalhe` continuavam por relação e vazavam
   * nome da empresa vizinha — inclusive para dentro do prompt de sistema, pelo
   * `escalacaoPara` do detalhe. Correção de 11/09/2026.
   *
   * E A CONSEQUÊNCIA SOBRE OS SETE CAMPOS. Se o ponteiro atravessado não
   * resolve em nome, ele também não conta como DONO: `camposFaltando` e
   * `validarProcedimento` recebem o id JÁ CRUZADO, e não a coluna crua. Sem
   * isso a tela dizia "sem dono" ao lado de uma lista de faltantes que não
   * citava o dono, e a gravação aceitava um procedimento cuja escalação sairia
   * apontando para "o responsável pelo agente" — sete campos completos no
   * papel, seis na prática.
   */
  private donosDesta(orgId: string, ids: (string | null)[]) {
    return donosDaCasa(this.prisma, orgId, ids);
  }

  async roster(orgId: string) {
    /*
     * A ORDEM DO ESTADO SAIU DO `ORDER BY` — ver `ORDEM_NA_TELA`.
     *
     * `orderBy: { estado: 'asc' }` ordena pela ordem de DECLARAÇÃO do enum, e o
     * enum novo está declarado na ordem do ciclo de vida (planejado primeiro).
     * A lista passaria a abrir com os agentes que nunca foram ligados. O banco
     * ordena por nome; o posto do estado é aplicado aqui, onde está escrito o
     * que a tela quer.
     */
    const agentes = await this.prisma.agent.findMany({
      where: { orgId },
      orderBy: [{ nome: 'asc' }],
      include: {
        // Os quatro campos do procedimento, e não só `proposito`: é o que
        // `camposFaltando` precisa para dizer a verdade sobre cada agente.
        sop: {
          select: {
            proposito: true,
            gatilho: true,
            passos: true,
            definicaoDePronto: true,
            versao: true,
            atualizadoEm: true,
          },
        },
      },
    });

    /*
     * `estadoPorId` ENTRA NO MESMO CRUZAMENTO que o dono, e não numa consulta à
     * parte: quem declarou o estado é gente, e gente se resolve contra ESTA
     * empresa (o cabeçalho de `donosDesta` conta por quê — `include` de relação
     * traz usuário de qualquer tenant). Sem isto, o nome de quem pausou o agente
     * sairia de outra empresa, ou apareceria como identificador cru.
     */
    const donos = await this.donosDesta(
      orgId,
      // `orcamentoPorId` entra no MESMO cruzamento (fatia A3): quem definiu o
      // orçamento também é gente, e gente que não é desta empresa não tem nome
      // a publicar aqui.
      agentes.flatMap((a) => [a.donoId, a.estadoPorId, a.orcamentoPorId]),
    );
    const emCurso = await this.sessoesEmCurso(orgId, agentes);
    const agora = new Date();
    /*
     * AS HORAS PASSARAM A SAIR DO LOG DE PASSAGENS (fatia A3) — ver
     * `horas-do-agente.ts`. Até aqui elas saíam de `Agent.execucoes`, contador
     * de vida inteira com as falhas dentro, publicado como "por semana".
     */
    const inicio = inicioDaJanela(agora);
    const passagens = await this.passagensDaSemana(orgId, inicio);
    const medicao = new Map(
      agentes.map((a) => [
        a.id,
        horasDoAgente(a, passagens ? janelaContada(passagens.get(a.id) ?? 0, inicio) : null),
      ]),
    );
    /* Os que trabalham primeiro; entre iguais, a ordem de nome que o banco deu. */
    const emOrdem = [...agentes].sort((a, b) => postoNaTela(a.estado) - postoNaTela(b.estado));

    return {
      items: emOrdem.map((a) => ({
        slug: a.slug,
        nome: a.nome,
        iniciais: a.iniciais,
        missao: a.missao,
        pilar: a.pilar,
        dono: (a.donoId && donos.get(a.donoId)) || null,
        tipo: a.tipo,
        /* O eixo da DECISÃO (fatia A2): o que o dono mandou. */
        estado: a.estado,
        /*
         * O eixo do que ESTÁ ACONTECENDO, derivado aqui e nunca gravado — ver
         * `estado-do-agente.ts`. Os dois viajam juntos porque a tela mostra os
         * dois: "ativo · ocioso" e "ativo · erro" são estados diferentes do
         * mesmo agente, e um selo só esconderia um deles.
         */
        situacao: situacaoDoAgente(a, emCurso, agora),
        /*
         * Quem mandou, quando e por quê. Nulo = nunca foi declarado por gente
         * (semente, ou a conversão da migração).
         *
         * Ponteiro que não resolve sai NULO, e nunca como identificador cru: é a
         * mesma doutrina do dono em `donos-da-casa.ts` — "não sei quem" é a
         * única resposta segura, porque a alternativa é devolver o id de alguém
         * de outra empresa para quem ler o JSON.
         */
        estadoPor: a.estadoPorId ? (donos.get(a.estadoPorId)?.nome ?? null) : null,
        estadoEm: a.estadoEm?.toISOString() ?? null,
        estadoMotivo: a.estadoMotivo,
        /*
         * Para onde ESTE agente pode ir a partir daqui. Vem do servidor porque a
         * regra é do servidor: uma tela que deduzisse "encerrado não volta" teria
         * a segunda cópia da regra, e um dia divergiria da que recusa de verdade.
         */
        transicoes: [...TRANSICOES[a.estado]],
        autonomiaAte: a.autonomiaAte,
        rebaixadoAte: a.rebaixadoAte?.toISOString() ?? null,
        capacidades: a.capacidades,
        cron: a.cron,
        ultimaExecucaoEm: a.ultimaExecucaoEm?.toISOString() ?? null,
        ultimoStatus: a.ultimoStatus,
        execucoes: a.execucoes,
        falhas: a.falhas,
        /*
         * AS HORAS, COM A PROCEDÊNCIA JUNTO (fatia A3).
         *
         * `horas` é a MEDIÇÃO da semana — passagens com bom desfecho nos
         * últimos sete dias × linha de base — e vem com o estado da medição ao
         * lado, para a tela dizer se o travessão é por falta de base declarada
         * ou por falta de log. `horasAcumuladas` é o número de vida inteira, com
         * esse nome, e nunca ocupa o lugar do semanal.
         *
         * O campo `horasDevolvidas` de antes SAIU. Ele era o acumulado com as
         * falhas dentro, e quem o lesse continuaria publicando a mesma mentira
         * com um nome que não avisa nada.
         */
        horas: {
          estado: medicao.get(a.id)!.estado,
          naSemana:
            medicao.get(a.id)!.minutosNaSemana === null
              ? null
              : emHorasDecimais(medicao.get(a.id)!.minutosNaSemana!),
          passagensNaSemana: medicao.get(a.id)!.execucoesNaSemana,
          diasDaJanela: DIAS_DA_JANELA,
          janelaCoberta: medicao.get(a.id)!.janelaCoberta,
          cobreDesde: medicao.get(a.id)!.cobreDesde,
        },
        horasAcumuladas:
          medicao.get(a.id)!.minutosAcumulados === null
            ? null
            : emHorasDecimais(medicao.get(a.id)!.minutosAcumulados!),
        passagensBemSucedidas: medicao.get(a.id)!.execucoesBemSucedidas,
        linhaDeBase:
          a.minutosPorExecucao > 0
            ? {
                minutosPorExecucao: a.minutosPorExecucao,
                informadaEm: a.baselineEm?.toISOString() ?? null,
                informadaPor: a.baselinePorId,
              }
            : null,
        /*
         * O ORÇAMENTO MENSAL DE IA (fatia A3). `null` = ninguém definiu, e é o
         * estado de todo agente antes de alguém decidir um valor. `ativo: false`
         * com valor é observação: soma e não corta, igual ao teto da empresa.
         */
        orcamento:
          Number(a.orcamentoMensalUsd) > 0 || a.orcamentoAtivo
            ? {
                mensalUsd: Number(a.orcamentoMensalUsd),
                ativo: a.orcamentoAtivo,
                definidoEm: a.orcamentoEm?.toISOString() ?? null,
                definidoPor: a.orcamentoPorId ? (donos.get(a.orcamentoPorId)?.nome ?? null) : null,
                motivo: a.orcamentoMotivo,
              }
            : null,
        temProcedimento: !!a.sop,
        procedimento: a.sop
          ? { versao: a.sop.versao, atualizadoEm: a.sop.atualizadoEm.toISOString() }
          : null,
        /*
         * Dos sete campos do formato fixo, quais faltam NESTE agente. A tela usa
         * para dizer o que impede o procedimento de ser aceito antes de a pessoa
         * escrever uma linha — e para não oferecer "salvar" sabendo que a API vai
         * recusar por falta de dono ou de pilar.
         */
        faltando: camposFaltando({ donoId: donos.get(a.donoId ?? '')?.id ?? null, pilar: a.pilar, sop: a.sop }),
      })),
      kpis: {
        /*
         * DOIS NÚMEROS ONDE HAVIA UM, e a separação é o conserto de uma tela
         * que mentia baixinho: o KPI chamava-se "Rodando" e contava
         * `estado === 'rodando'`, que era o estado DECLARADO — ou seja, contava
         * agente em operação e parado há três semanas como se estivesse
         * trabalhando naquele instante. Agora:
         *   · `ativos`       — quantos o dono deixou em operação (decisão);
         *   · `rodandoAgora` — quantos têm sessão viva neste momento (medição).
         */
        ativos: agentes.filter((a) => estadoTrabalha(a.estado)).length,
        rodandoAgora: agentes.filter((a) => situacaoDoAgente(a, emCurso, agora) === 'rodando')
          .length,
        comErro: agentes.filter((a) => situacaoDoAgente(a, emCurso, agora) === 'erro').length,
        pausados: agentes.filter((a) => a.estado === EstadoDeAgente.pausado).length,
        encerrados: agentes.filter((a) => a.estado === EstadoDeAgente.encerrado).length,
        /*
         * O TOTAL DA SEMANA, MEDIDO — e o que ficou de fora dele (fatia A3).
         *
         * Era `minutosPorExecucao × execucoes` somado por todos os agentes:
         * acumulado de vida inteira, com as passagens que falharam dentro,
         * publicado num cartão chamado "Horas devolvidas" ao lado do de
         * `/rotinas`, que diz "por semana". As duas telas davam números
         * diferentes para a mesma pergunta e a errada era esta.
         *
         * Agora quem soma é `totalDaSemana` — o mesmo código de `/rotinas` —, e
         * ele devolve junto quantos agentes ficaram fora e por quê. `vazio` é
         * diferente de zero: zero medido é medição, vazio é ausência dela, e o
         * campo `horasSemana` só vira número quando houve o que medir.
         */
        ...(() => {
          const t = totalDaSemana([...medicao.values()]);
          return {
            horasSemana: t.vazio ? null : emHorasDecimais(t.minutos),
            horasSemanaDe: {
              agentesContados: t.contadas,
              semLinhaDeBase: t.semLinhaDeBase,
              semHistorico: t.semHistorico,
              parciais: t.parciais,
              diasDaJanela: DIAS_DA_JANELA,
            },
          };
        })(),
        semLinhaDeBase: agentes.filter((a) => a.minutosPorExecucao === 0).length,
        /** Quantos agentes têm orçamento mensal VALENDO (soma e corta). */
        comOrcamento: agentes.filter(
          (a) => a.orcamentoAtivo && Number(a.orcamentoMensalUsd) >= 0,
        ).length,
        semProcedimento: agentes.filter((a) => !a.sop).length,
      },
    };
  }

  /**
   * O agente com o procedimento inteiro — e com o texto de escalação JÁ
   * RESOLVIDO, vindo da constante do código.
   *
   * A escalação viaja na resposta de propósito: a tela precisa mostrá-la (ela é
   * um dos sete campos), e a alternativa seria uma segunda cópia do texto dentro
   * do web, que um dia diverge. Vem com `escalacaoEditavel: false` ao lado para
   * que o front não precise deduzir isso de lugar nenhum.
   *
   * O DONO SAI COMO `{ id, nome }`, igual ao roster. Vinha como `{ id, name }`
   * — o campo cru do Prisma, porque o método devolvia `...a` com a relação
   * dentro —, e a tela (`apps/web/src/app/agentes/Procedimento.tsx`) lê `nome`:
   * o campo aparecia em branco e a conferência de tipos não pegava, porque a
   * leitura no web é convertida à força pelo genérico do `apiGet`. Correção de
   * 11/09/2026.
   */
  async detalheParaPessoa(orgId: string, slug: string, userId: string) {
    await exigirAcessoAtual(this.prisma, orgId, userId, ['mcp.ver']);
    const detalhe = await this.detalhe(orgId, slug);
    await exigirAcessoAtual(this.prisma, orgId, userId, ['mcp.ver']);
    return detalhe;
  }

  async detalhe(orgId: string, slug: string) {
    const a = await this.prisma.agent.findFirst({
      where: { orgId, slug },
      include: { sop: true },
    });
    if (!a) return null;

    const donos = await this.donosDesta(orgId, [a.donoId, a.estadoPorId]);
    const dono = (a.donoId && donos.get(a.donoId)) || null;
    const emCurso = await this.sessoesEmCurso(orgId, [a]);

    return {
      ...a,
      /*
       * O eixo derivado também aqui, e pelo motivo que já custou caro neste
       * repositório: duas superfícies que mostram o mesmo agente não podem
       * responder coisas diferentes sobre ele. Mesma função, mesma resposta.
       */
      situacao: situacaoDoAgente(a, emCurso),
      estadoPor: a.estadoPorId ? (donos.get(a.estadoPorId)?.nome ?? null) : null,
      transicoes: [...TRANSICOES[a.estado]],
      /*
       * `donoId` SOBRESCRITO com o id cruzado, e não deixado como veio do
       * banco. O nome já não vaza; a coluna crua ainda entregava o
       * identificador de um usuário da empresa vizinha para quem lesse o JSON,
       * e deixava a resposta contradizendo a si mesma (`dono: null` ao lado de
       * um `donoId` preenchido). A tela não usa o campo; a verdade, sim.
       */
      donoId: dono?.id ?? null,
      dono,
      escalacao: escalacaoPara(dono?.nome),
      escalacaoEditavel: false as const,
      formato: {
        campos: CAMPOS_DO_PROCEDIMENTO.map((c) => ({
          campo: c,
          rotulo: ROTULO_DO_CAMPO[c],
          onde: ONDE_MORA_O_CAMPO[c],
        })),
        faltando: camposFaltando({ donoId: dono?.id ?? null, pilar: a.pilar, sop: a.sop }),
      },
    };
  }

  /* ======================================================================== *
   * O ESTADO DECLARADO — pausar, retomar, encerrar (fatia A2)
   * ======================================================================== *
   *
   * ESTA É UMA AÇÃO DE OPERADOR PELA HTTP, e não uma capacidade do catálogo que
   * passa pela porta. A decisão é a mais importante da fatia, então está escrita
   * aqui inteira:
   *
   * O PRECEDENTE MAIS PRÓXIMO É O INTERRUPTOR DE CONECTOR (RF-G-06). Lá,
   * `conector.desligar` e `conector.religar` EXISTEM no catálogo, com nível R3 e
   * R4 — para o dia em que um agente peça para desligar um conector —, e ainda
   * assim a TELA não passa pela porta: `POST /integrations/:chave/desligamento`
   * é rota com permissão de papel (`admin.usuarios`) e rastro. O motivo está
   * escrito lá e vale igual aqui: é botão de emergência.
   *
   * POR QUE A PORTA SERIA ERRADA, concretamente. Qualquer coisa acima de R2 fica
   * RETIDA aguardando aprovação, e R3+ exige uma SEGUNDA PESSOA (invariante 7).
   * Então pausar um agente que está fazendo besteira entraria na fila de
   * `/atendimento` e ficaria lá — numa empresa de operador único, PARA SEMPRE.
   * Um freio que precisa de duas assinaturas não é freio. E o risco está
   * invertido em relação a tudo o que a porta guarda: pausar e encerrar só
   * DIMINUEM o alcance do OS; o pior desfecho de um clique errado é um agente
   * parado, que a tela mostra em vermelho e qualquer pessoa com a mesma
   * permissão desfaz.
   *
   * RETOMAR DEVOLVE ALCANCE, e é o único dos três que aumenta — mesma natureza
   * de `conector.religar`, que na régua é R4. Ele fica na mesma rota e na mesma
   * permissão por coerência com aquele precedente, e o que o protege é a
   * PROCEDÊNCIA: autor, data e motivo gravados, mais o evento `agente.retomado`
   * na cadeia de hash. Pôr retomar na porta e deixar pausar fora é uma opção
   * defensável e é DECISÃO DO PEDRO — está no relatório da fatia, não decidida
   * aqui.
   *
   * O QUE **NÃO** MUDA: nada disto afrouxa a régua. O agente retomado continua
   * passando pela porta a cada chamada de ferramenta, continua preso às
   * capacidades declaradas e ao teto de autonomia, e continua rebaixado se
   * estava rebaixado — o relógio do RF-N-07 não olha para o estado.
   */
  private agendaLocal(): AgendaLocalService {
    if (!this.agenda) throw new ConflictException('O serviço de operações locais está indisponível.');
    return this.agenda;
  }

  async estadoHumano(orgId: string, actorId: string, slug: string) {
    return this.agendaLocal().estadoHumano(orgId, actorId, slug);
  }

  async definirEstado(orgId: string, slug: string, destino: EstadoDeAgente,
    quem: { userId: string; requestId: string; marcaEsperada: string; motivo: string | null }) {
    const input = AgentEstadoHumanoSchema.parse({ requestId: quem.requestId, marcaEsperada: quem.marcaEsperada, motivo: quem.motivo });
    const agenda = this.agendaLocal();
    if (!this.eventos) throw new ConflictException('O serviço de rastro está indisponível.');
    const eventos = this.eventos;
    await exigirAcessoAtual(this.prisma, orgId, quem.userId, ['admin.usuarios']);
    const tipo = EVENTO_DA_TRANSICAO[destino];
    const preparo = await eventos.prepararContextoParaTx({ orgId, tipo, nivel: null });
    const causa = soltarPorCausaDoEstado(destino);
    const preparoSoltura = causa ? await eventos.prepararContextoParaTx({ orgId, tipo: EVENTO_DO_CHECKOUT.soltada, nivel: null }) : null;
    await this.prisma.$transaction(async (tx) => {
      await agenda.travarClaimNoTx(tx, orgId, input.requestId);
      const look = await agenda.lookupNoTx(tx, orgId, input.requestId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`memoria:${orgId}`}))`;
      const agente = await agenda.travarAgenteNoTx(tx, orgId, slug);
      const scope = agenda.escopo(orgId, quem.userId, agente);
      const assinatura = await agenda.assinaturaNoTx(tx, scope, input.requestId, 'agente_estado', { destino, marcaEsperada: input.marcaEsperada, motivo: input.motivo });
      const existing = agenda.conferirCausa(look, scope, input.requestId, 'agente_estado', assinatura);
      await agenda.travarAutoridadeHumanaNoTx(tx, orgId, quem.userId, 'COMANDAR');
      if (existing) { await agenda.recuperarNoTx(tx, scope, agente, existing); return; }
      const anterior = await agenda.marcaNoTx(tx, scope, agente);
      if (anterior.marca !== input.marcaEsperada) throw new ConflictException('O estado do agente mudou. Confira a marca escolhida antes de enviar.');
      if (agente.estado === destino) throw new ConflictException('O agente já está nesse estado. Nada foi alterado.');
      if (!transicaoPermitida(agente.estado, destino)) throw new BadRequestException('Esta transição não é permitida para o estado atual do agente.');
      if (exigeMotivo(destino) && !input.motivo) throw new BadRequestException('Informe o motivo para encerrar o agente.');
      const presas = causa ? await this.checkout.travarTarefasDoAgenteNoTx(tx, orgId, agente.id) : [];
      await agenda.orcamentoEstadoHumanoNoTx(tx, scope, input.requestId, anterior, presas, { estado: destino, ativo: estadoTrabalha(destino), estadoMotivo: input.motivo });
      const agora = new Date();
      const { count } = await tx.agent.updateMany({ where: { id: agente.id, orgId, slug, estado: agente.estado, ativo: agente.ativo,
        donoId: agente.donoId, estadoPorId: agente.estadoPorId, estadoEm: agente.estadoEm, estadoMotivo: agente.estadoMotivo, atualizadoEm: agente.atualizadoEm },
        data: { estado: destino, ativo: estadoTrabalha(destino), estadoPorId: quem.userId, estadoEm: agora, estadoMotivo: input.motivo } });
      if (count !== 1) throw new ConflictException('O estado do agente mudou antes da gravação.');
      const soltas = causa ? await this.checkout.soltarTodasDoAgenteNoTx(tx, orgId, agente.id, causa) : [];
      if (soltas.length !== presas.length || soltas.some((t, i) => t.id !== presas[i].id || t.title !== presas[i].title || t.desde?.getTime() !== presas[i].desde?.getTime()))
        throw new ConflictException('As tarefas soltas não correspondem à base conferida.');
      const solturas = causa && preparoSoltura ? await this.checkout.registrarSolturasNoTx(tx, orgId, soltas, agente, causa, quem.userId, preparoSoltura)
        : { auditIds: [], eventSnapshot: [] };
      const novo = await tx.agent.findFirst({ where: { id: agente.id, orgId } });
      if (!novo) throw new ConflictException('O estado gravado não pôde ser conferido.');
      const posterior = await agenda.marcaNoTx(tx, scope, novo);
      const audit = await this.audit.logComRecibo({ orgId, actorId: quem.userId, action: tipo, entityType: 'agent', entityId: agente.id,
        before: { estado: agente.estado }, after: { estado: destino, motivo: input.motivo }, metadata: { slug, requestId: input.requestId } }, tx);
      const e = await eventos.registrarNoTx(tx, { orgId, tipo, actorType: ActorType.user, actorId: quem.userId, agentSlug: slug,
        correlationId: input.requestId, payload: { slug, de: agente.estado, para: destino }, conteudo: { motivo: input.motivo,
          estadoAnterior: { estado: agente.estado }, estadoNovo: { estado: destino }, desfazer: destino === EstadoDeAgente.encerrado
            ? 'não tem volta: encerrar é definitivo' : transicaoPermitida(destino, agente.estado) ? `voltar para "${agente.estado}"` : `não existe caminho de volta para "${agente.estado}"` }, sensibilidade: 'interna' }, preparo);
      const receipt = AgendaLocalReciboSchema.parse({ schemaVersion: 1, tipo: 'agente_estado', escopo: scope, requestId: input.requestId,
        operationId: randomUUID(), confirmadoEm: agora.toISOString(), marcaAnterior: anterior.marca, marcaNova: posterior.marca, anterior, posterior,
        tarefasSoltas: soltas.map((t) => ({ id: t.id, titulo: t.title, desde: t.desde?.toISOString() ?? null })),
        auditIds: [...solturas.auditIds, audit.id], eventSnapshot: [...solturas.eventSnapshot.map((x) => ({ ...x, seq: x.seq.toString(), ocorreuEm: x.ocorreuEm.toISOString() })),
          { id: e.id, seq: e.seq.toString(), hash: e.hash, tipo, ocorreuEm: e.ocorreuEm.toISOString() }] });
      const op = await agenda.registrarOperacaoDeEstadoDoAgenteNoTx(tx, scope, assinatura, receipt);
      await agenda.recuperarNoTx(tx, scope, novo, op);
      const painel = AgentEstadoHumanoPainelSchema.parse({ ...posterior, autoridade: { comandar: true, verificadaEm: new Date().toISOString() }, transicoes: [...TRANSICOES[novo.estado]] });
      await agenda.conferirTamanhoNoTx(tx, painel);
      await exigirAcessoAtual(tx, orgId, quem.userId, ['admin.usuarios']);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    return agenda.porOperacao(orgId, quem.userId, slug, input.requestId, 'agente_estado');
  }

  private async registrarSoltura(
    orgId: string,
    agente: { id: string; slug: string; nome: string },
    soltas: Array<{ id: string; title: string; desde: Date | null }>,
    causa: string,
    actorId: string,
  ): Promise<void> {
    for (const tarefa of soltas) {
      await this.checkout.registrarSolturaAutomatica(orgId, tarefa, agente, causa, actorId);
    }
  }

  /**
   * A mudança de estado nos DOIS registros — o rastro (cadeia de hash) e a
   * auditoria administrativa.
   *
   * Os dois são tentados de forma independente, como em
   * `ConectoresService.registrarMudanca`: o rastro falhar não pode levar a
   * auditoria junto. E nenhum dos dois decide nada — a mudança já valeu no banco
   * quando esta função é chamada. Log alto quando falha, porque uma mudança de
   * estado sem registro é exatamente o que a fatia existe para não ter.
   */
  private async registrarMudancaDeEstado(
    orgId: string,
    antes: { id: string; slug: string; estado: EstadoDeAgente },
    destino: EstadoDeAgente,
    motivo: string | null,
    actorId: string,
  ): Promise<void> {
    const tipo = EVENTO_DA_TRANSICAO[destino];
    const aviso = (onde: string, e: unknown) =>
      this.log.error(
        `${tipo} do agente "${antes.slug}" (empresa ${orgId}) NÃO foi registrado em ${onde}: ` +
          `${(e as Error).message} — a mudança JÁ VALE no banco.`,
      );

    try {
      await this.eventos?.registrar({
        orgId,
        tipo,
        actorType: ActorType.user,
        actorId,
        agentSlug: antes.slug,
        correlationId: contextoAtual()?.correlationId ?? null,
        payload: { slug: antes.slug, de: antes.estado, para: destino },
        conteudo: {
          motivo,
          estadoAnterior: { estado: antes.estado },
          estadoNovo: { estado: destino },
          /*
           * O caminho de volta, nas palavras da política — e ele é CALCULADO
           * contra as transições, não escrito de cabeça. `encerrado` não tem
           * volta; `planejado` também não (nenhum verbo devolve um agente para
           * "nunca foi ligado"). Escrever um verbo que não existe faria o rastro
           * prometer um desfazimento impossível, que é pior do que dizer "não
           * dá".
           */
          desfazer:
            destino === EstadoDeAgente.encerrado
              ? 'não tem volta: encerrar é definitivo'
              : transicaoPermitida(destino, antes.estado)
                ? `voltar para "${antes.estado}"`
                : `não existe caminho de volta para "${antes.estado}"`,
        },
        sensibilidade: 'interna',
      });
      if (!this.eventos) {
        this.log.warn(
          `${tipo} do agente "${antes.slug}" (empresa ${orgId}) ficou FORA do rastro: o serviço ` +
            'subiu sem EventLogService.',
        );
      }
    } catch (e) {
      aviso('o rastro', e);
    }

    try {
      await this.audit.log({
        orgId,
        actorId,
        action: tipo,
        entityType: 'agent',
        entityId: antes.id,
        before: { estado: antes.estado },
        after: { estado: destino, motivo },
        metadata: { slug: antes.slug },
      });
    } catch (e) {
      aviso('a auditoria', e);
    }
  }

  /**
   * As sessões que AINDA CONTAM como sessão viva, para derivar `rodando`.
   *
   * UMA consulta para o roster inteiro, e não uma por agente: a tela do Pedro
   * tem dezenas de agentes e a alternativa é o problema N+1 num caminho que já
   * faz três consultas.
   *
   * O corte usa o MAIOR teto de tempo entre os agentes desta empresa e a filtragem
   * fina é por agente, dentro de `situacaoDoAgente` — porque cada agente tem o
   * seu `tetoSegundos`, e usar um corte único faria o selo de um agente depender
   * da configuração de outro. Aqui só se evita trazer sessão pendurada de meses.
   */
  private async sessoesEmCurso(
    orgId: string,
    agentes: readonly { tetoSegundos: number }[],
  ): Promise<SessaoEmCurso[]> {
    if (agentes.length === 0) return [];
    const maiorTeto = Math.max(...agentes.map((a) => a.tetoSegundos));
    const limite = new Date(Date.now() - (maiorTeto * 1000 + MARGEM_DA_SESSAO_VIVA_MS));
    return this.prisma.session.findMany({
      where: { orgId, status: SessionStatus.rodando, ultimaAtividadeEm: { gte: limite } },
      select: { agentId: true, status: true, ultimaAtividadeEm: true },
    });
  }

  /**
   * QUANTAS PASSAGENS DERAM BOM DESFECHO NA SEMANA, por agente (fatia A3).
   *
   * Um `groupBy` sobre `Session`, que é o log de passagens do agente — a
   * contrapartida de `RotinaExecucao` no lado das rotinas. `criadaEm` e não
   * `encerradaEm`: é quando a passagem COMEÇOU, igual ao `inicioEm` que
   * `/rotinas` usa, e é o que faz as duas telas medirem a mesma janela.
   *
   * DEVOLVE `null` QUANDO A CONTAGEM FALHA, e a diferença não é detalhe: `null`
   * viaja para a medição como `sem-historico` e a tela mostra travessão; um
   * `Map` vazio significaria "nenhuma passagem esta semana", que é uma
   * afirmação. Falhar contando não pode publicar zero hora como se fosse
   * medição — é o mesmo defeito que esta fatia existe para consertar, só com
   * outra causa.
   */
  private async passagensDaSemana(
    orgId: string,
    inicio: Date,
  ): Promise<Map<string, number> | null> {
    try {
      const linhas = await this.prisma.session.groupBy({
        by: ['agentId'],
        where: {
          orgId,
          criadaEm: { gte: inicio },
          status: { in: [...DESFECHO_BOM_DE_SESSAO] },
        },
        _count: { _all: true },
      });
      return new Map(linhas.map((l) => [l.agentId, l._count._all]));
    } catch (e) {
      this.log.error(
        `empresa ${orgId}: não deu para contar as passagens da semana (${(e as Error).message}). ` +
          'As horas devolvidas saem como "sem histórico" — nunca como zero medido.',
      );
      return null;
    }
  }

  /* ======================================================================== *
   * O ORÇAMENTO MENSAL DE IA DO AGENTE — fatia A3
   * ======================================================================== *
   *
   * POR QUE NÃO ENTROU NA LISTA BRANCA DE `atualizar`. Aquela lista é a
   * IDENTIFICAÇÃO do agente (nome, missão, pilar, dono) e o cabeçalho dela diz,
   * com todas as letras, que `tetoCustoUsd` e companhia "governam gasto de IA e
   * pertencem à fatia do teto, não a esta". Esta é a fatia do teto, e o
   * orçamento entra por caminho PRÓPRIO em vez de virar um campo a mais num
   * `PATCH` de identidade — porque definir quanto um agente pode gastar é uma
   * DECISÃO, com autor, data e motivo, e não a correção de um rótulo.
   *
   * DESLIGAR É UM VALOR, NÃO UM DELETE. `ativo: false` mantém o valor e para de
   * cortar (modo de observação, igual a `TetoDeCustoIa.ativo`); `mensalUsd: 0`
   * com `ativo: true` é a decisão explícita "este agente não chama modelo". Não
   * existe rota de apagar orçamento: apagar não deixa registro de quem apagou.
   *
   * NÃO PASSA PELA PORTA, pelo mesmo argumento de `definirEstado`: é ação de
   * operador pela HTTP sobre a configuração da própria casa, não capacidade do
   * catálogo que um agente pede. Um agente que pudesse mexer no próprio
   * orçamento é o gato tomando conta do peixe — e essa capacidade não existe no
   * catálogo de propósito.
   */
  async definirOrcamento(
    orgId: string,
    slug: string,
    p: { mensalUsd: number; ativo: boolean; motivo?: string },
    userId: string,
  ) {
    if (!Number.isFinite(p.mensalUsd) || p.mensalUsd < 0) {
      throw new BadRequestException('o orçamento mensal não pode ser negativo');
    }
    /*
     * QUATRO CASAS, e o arredondamento acontece AQUI e não no banco. A coluna é
     * `Decimal(10,4)`: mandar mais casas faria o Postgres arredondar sozinho e a
     * tela mostraria um número diferente do que a pessoa digitou, sem que nada
     * avisasse. Arredondar antes é dizer o que foi gravado.
     */
    const mensalUsd = Number(p.mensalUsd.toFixed(4));
    const motivo = p.motivo?.trim() || null;

    /*
     * LIGAR UM ORÇAMENTO DE ZERO PEDE MOTIVO ESCRITO.
     *
     * É a única combinação que PARA o agente na hora — toda chamada de modelo
     * dele passa a ser recusada —, e parada de produção sem motivo escrito é
     * parada que ninguém sabe se pode desfazer. A mesma régua que `encerrar`
     * aplica (`exigeMotivo`), pelo mesmo motivo.
     */
    if (p.ativo && mensalUsd === 0 && !motivo) {
      throw new BadRequestException(
        'orçamento de US$ 0,00 valendo PARA o agente: toda chamada de modelo dele passa a ser ' +
          'recusada. Escreva o motivo para que quem abrir a tela depois saiba se pode religar.',
      );
    }

    const antes = await this.prisma.agent.findFirst({
      where: { orgId, slug },
      select: { id: true, nome: true, orcamentoMensalUsd: true, orcamentoAtivo: true },
    });
    if (!antes) throw new NotFoundException(`agente "${slug}" não existe`);

    await this.prisma.agent.updateMany({
      where: { orgId, slug },
      data: {
        orcamentoMensalUsd: mensalUsd,
        orcamentoAtivo: p.ativo,
        orcamentoPorId: userId,
        orcamentoEm: new Date(),
        orcamentoMotivo: motivo,
      },
    });

    /*
     * O RASTRO. Orçamento é dinheiro, e mudança de dinheiro sem registro é a
     * coisa que o produto inteiro existe para não deixar acontecer. Falha ao
     * registrar NÃO desfaz a gravação — grita no log, como em `definirEstado`.
     */
    await this.eventos
      ?.registrar({
        orgId,
        tipo: 'agente.orcamento_definido',
        actorType: ActorType.user,
        actorId: userId,
        agentSlug: slug,
        correlationId: contextoAtual()?.correlationId ?? null,
        payload: {
          agente: slug,
          deUsd: Number(antes.orcamentoMensalUsd),
          paraUsd: mensalUsd,
          deAtivo: antes.orcamentoAtivo,
          paraAtivo: p.ativo,
        },
        conteudo: {
          argumentos: { agente: slug, mensalUsd, ativo: p.ativo },
          custo: { orcamentoUsd: mensalUsd, moeda: 'USD' },
          motivo: motivo ?? `orçamento mensal do agente "${antes.nome}" definido`,
          resultado: { mensalUsd, ativo: p.ativo },
          fontes: [{ tipo: 'agente', id: slug }],
        },
        sensibilidade: 'interna',
      })
      .catch((e: unknown) =>
        this.log.error(
          `empresa ${orgId}: o orçamento do agente "${slug}" foi gravado e NÃO entrou no rastro: ` +
            `${(e as Error).message}`,
        ),
      );

    return { ok: true as const, mensalUsd, ativo: p.ativo, motivo };
  }

  /** A linha de base é DECLARADA por uma pessoa, com nome e data. */
  async declararLinhaDeBase(orgId: string, slug: string, minutos: number, userId: string) {
    if (minutos <= 0) throw new Error('a linha de base precisa ser maior que zero');
    const a = await this.prisma.agent.updateMany({
      where: { orgId, slug },
      data: { minutosPorExecucao: minutos, baselinePorId: userId, baselineEm: new Date() },
    });
    if (a.count === 0) throw new Error(`agente "${slug}" não existe`);
    return { ok: true as const };
  }

  /**
   * Grava pela versão lida, com validação dos sete campos e dos textos fixos.
   * SOP e auditoria usam a mesma transação; conflito conserva a versão atual.
   */
  async salvarSop(orgId: string, slug: string, entrada: unknown, userId: string) {
    const input = AgentSopEdicaoSchema.parse(entrada);
    const permissoes = ['automacoes.executar', 'admin.usuarios'];
    await exigirAcessoAtual(this.prisma, orgId, userId, permissoes);
    return this.prisma.$transaction(async tx => {
      await exigirAcessoAtual(tx, orgId, userId, permissoes);
      const ids = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Agent"
        WHERE "orgId"=${orgId} AND "slug"=${slug} FOR UPDATE`;
      if (!ids[0]) throw new NotFoundException(`agente "${slug}" não existe`);
      const agentId = ids[0].id;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agent-sop:${orgId}:${agentId}`}))`;
      const agente = await tx.agent.findFirst({ where: { orgId, id: agentId, slug },
        select: { id: true, donoId: true, pilar: true, sop: true } });
      if (!agente) throw new NotFoundException(`agente "${slug}" não existe`);
      const antes = agente.sop;
      if (antes && (antes.orgId !== orgId || antes.agentId !== agente.id)) {
        throw new ConflictException('O vínculo do procedimento precisa ser conferido.');
      }
      if ((antes?.versao ?? null) !== input.expectedSopVersion) {
        throw new ConflictException('O procedimento mudou. Recarregue a versão atual e confira seu rascunho.');
      }
      // O bloqueio da pessoa conserva o dono ativo até o compromisso da escrita.
      const donos = agente.donoId ? await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "User"
        WHERE "orgId"=${orgId} AND "id"=${agente.donoId} AND "isActive"=true FOR SHARE` : [];
      const donoDaCasa = donos[0]?.id ?? null;
      let dados;
      try {
        dados = validarProcedimento(input.procedimento, { donoId: donoDaCasa, pilar: agente.pilar });
      } catch (e) {
        if (e instanceof FormatoDaSopInvalido) throw new BadRequestException({
          error: 'ValidationError', message: e.message,
          issues: e.problemas.map(p => ({ path: p.campo, message: p.motivo })),
        });
        throw e;
      }
      if (!donoDaCasa) throw new BadRequestException('O dono do agente deve continuar ativo nesta empresa.');
      const comum = { proposito: dados.proposito, gatilho: dados.gatilho, passos: dados.passos,
        definicaoDePronto: dados.definicaoDePronto, observacoes: dados.observacoes ?? null,
        atualizadoPor: userId };
      let versao: number;
      if (antes) {
        const esperada = input.expectedSopVersion;
        if (esperada === null) throw new ConflictException('O procedimento já possui uma versão. Recarregue e confira seu rascunho.');
        const atualizada = await tx.sop.updateMany({
          where: { id: antes.id, orgId, agentId: agente.id, versao: esperada },
          data: { ...comum, versao: { increment: 1 } },
        });
        if (atualizada.count !== 1) throw new ConflictException('O procedimento mudou. Recarregue a versão atual e confira seu rascunho.');
        const atual = await tx.sop.findFirst({ where: { id: antes.id, orgId, agentId: agente.id }, select: { versao: true } });
        if (!atual || atual.versao !== antes.versao + 1) throw new ConflictException('A versão gravada do procedimento precisa ser conferida.');
        versao = atual.versao;
      } else {
        try {
          const criada = await tx.sop.create({ data: { orgId, agentId: agente.id, ...comum }, select: { versao: true } });
          versao = criada.versao;
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            throw new ConflictException('O procedimento mudou. Recarregue a versão atual e confira seu rascunho.');
          }
          throw e;
        }
      }
      await this.audit.log({ orgId, actorId: userId,
        action: antes ? 'agent.sop.update' : 'agent.sop.create', entityType: 'agent', entityId: agente.id,
        before: antes ? { proposito: antes.proposito, gatilho: antes.gatilho, passos: antes.passos,
          definicaoDePronto: antes.definicaoDePronto, observacoes: antes.observacoes, versao: antes.versao } : undefined,
        after: { ...comum, versao }, metadata: { slug, expectedSopVersion: input.expectedSopVersion },
      }, tx);
      await exigirAcessoAtual(tx, orgId, userId, permissoes);
      const donoAtual = await tx.user.findFirst({ where: { id: donoDaCasa, orgId, isActive: true }, select: { id: true } });
      if (!donoAtual) throw new BadRequestException('O dono do agente deve continuar ativo nesta empresa.');
      return AgentSopSalvaSchema.parse({ ok: true, versao });
    }, { timeout: 20000 });
  }

  /**
   * Identificação do agente: nome, missão, pilar e dono. NADA de capacidade,
   * autonomia ou contexto fixo — ver o cabeçalho de `AgenteIdentidadeSchema`.
   */
  async atualizar(orgId: string, slug: string, entrada: unknown, userId: string) {
    const dados = AgenteIdentidadeSchema.parse(entrada);
    if (Object.keys(dados).length === 0) {
      throw new BadRequestException('nada a atualizar');
    }

    /*
     * O DONO PRECISA SER GENTE DESTA EMPRESA.
     *
     * Sem esta conferência, `donoId` aceitaria o identificador de um usuário de
     * OUTRO tenant: o nome dele apareceria no organograma e no prompt do agente
     * ("DONO HUMANO: ..."), que é vazamento de gente entre empresas pela porta
     * dos fundos. O `updateMany` abaixo escopa o AGENTE; o dono é o outro lado.
     */
    if (dados.donoId) {
      const dono = await this.prisma.user.findFirst({
        where: { id: dados.donoId, orgId },
        select: { id: true },
      });
      if (!dono) throw new BadRequestException('dono: não é um usuário desta empresa');
    }

    const r = await this.prisma.agent.updateMany({ where: { orgId, slug }, data: dados });
    if (r.count === 0) throw new NotFoundException(`agente "${slug}" não existe`);

    await this.audit.log({
      orgId,
      actorId: userId,
      action: 'agent.update',
      entityType: 'agent',
      entityId: slug,
      after: dados,
    });

    return { ok: true as const };
  }

  /* ======================================================================== *
   * O ORGANOGRAMA (RF-N-06) — gente e agentes lado a lado, por pilar
   * ======================================================================== *
   *
   * DUAS CONSULTAS ESCOPADAS POR EMPRESA, e o cruzamento feito na memória — é
   * a mesma regra de `donosDesta` (ver o cabeçalho dela), aplicada aqui contra
   * o mapa de gente que esta tela já carrega inteiro, porque o organograma
   * precisa mostrar também quem não é dono de agente nenhum.
   *
   * O E-MAIL NÃO ENTRA. O organograma responde "quem trabalha aqui e no quê";
   * endereço de e-mail é dado pessoal que a pergunta não precisa, e esta tela é
   * a mais aberta das três de gente (`dashboard.ver`, contra `admin.usuarios`
   * de /config). Menos dado, mesmo desenho.
   */
  async organograma(orgId: string) {
    const [pessoas, agentes] = await Promise.all([
      this.prisma.user.findMany({
        where: { orgId },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          isActive: true,
          roles: { select: { key: true, name: true } },
        },
      }),
      this.prisma.agent.findMany({
        where: { orgId },
        orderBy: [{ pilar: 'asc' }, { nome: 'asc' }],
        select: {
          slug: true,
          nome: true,
          iniciais: true,
          missao: true,
          pilar: true,
          donoId: true,
          tipo: true,
          estado: true,
          autonomiaAte: true,
          cron: true,
        },
      }),
    ]);

    const gente = new Map(pessoas.map((p) => [p.id, p]));

    const agentesDto = agentes.map((a) => {
      const dono = a.donoId ? gente.get(a.donoId) : undefined;
      return {
        slug: a.slug,
        nome: a.nome,
        iniciais: a.iniciais,
        missao: a.missao,
        pilar: a.pilar,
        tipo: a.tipo,
        estado: a.estado,
        autonomiaAte: a.autonomiaAte,
        cron: a.cron,
        dono: dono ? { id: dono.id, nome: dono.name } : null,
      };
    });

    /*
     * O PILAR DE UMA PESSOA É DERIVADO, e isso é procedência, não invenção:
     * `User` não tem coluna de pilar, então o pilar de alguém é o dos agentes de
     * que ela é dona. Quem não é dona de nenhum cai em "sem pilar ainda" — que é
     * informação verdadeira e acionável, diferente de chutá-la num quadrado.
     */
    const pilaresDaPessoa = new Map<string, Set<string>>();
    for (const a of agentes) {
      if (!a.donoId || !a.pilar || !gente.has(a.donoId)) continue;
      const atual = pilaresDaPessoa.get(a.donoId) ?? new Set<string>();
      atual.add(a.pilar);
      pilaresDaPessoa.set(a.donoId, atual);
    }

    const pessoasDto = pessoas.map((p) => ({
      id: p.id,
      nome: p.name,
      ativo: p.isActive,
      papeis: p.roles.map((r) => r.name),
      pilares: [...(pilaresDaPessoa.get(p.id) ?? [])].sort(),
      agentes: agentesDto.filter((a) => a.dono?.id === p.id).map((a) => a.slug),
    }));

    const nomesDePilar = [
      ...new Set(agentes.map((a) => a.pilar).filter((p): p is string => !!p)),
    ].sort((a, b) => a.localeCompare(b, 'pt-BR'));

    const pilares = nomesDePilar.map((nome) => ({
      pilar: nome,
      pessoas: pessoasDto.filter((p) => p.pilares.includes(nome)),
      agentes: agentesDto.filter((a) => a.pilar === nome),
    }));

    return {
      pilares,
      semPilar: {
        pessoas: pessoasDto.filter((p) => p.pilares.length === 0),
        agentes: agentesDto.filter((a) => !a.pilar),
      },
      totais: {
        pessoas: pessoasDto.length,
        agentes: agentesDto.length,
        agentesSemDono: agentesDto.filter((a) => !a.dono).length,
        pilares: nomesDePilar.length,
      },
      fonte: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }
}
