import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ActorType, ApprovalState, RiskLevel, ToolCallStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { comContexto, correlacaoAtual, exigirTenant } from '../common/contexto-execucao';
import {
  conectorDaCapacidade,
  corpoDaRecusa,
  type RecusaDeConector,
} from '../integrations/conectores';
import { PolicyService } from '../policy/policy.service';
import { ContextoDoEfeito } from './efeitos.registry';
import { ToolGateway } from './tool-gateway.service';
import {
  EventLogService,
  type ConteudoDoEvento,
  type SensibilidadeDoEvento,
} from './event-log.service';
import { InterruptoresRegistry } from './interruptores.registry';

/*
 * O que acontece DEPOIS de a pessoa aprovar.
 *
 * Sem isto a fila era um museu: a ação ficava retida, alguém confirmava, e
 * nada saía. O ciclo do produto só fecha quando aprovar EXECUTA.
 *
 * A execução usa os argumentos GRAVADOS na passagem pela porta, nunca os que
 * chegam na requisição de confirmação. É o que impede trocar o texto entre a
 * aprovação e o envio — o mesmo motivo pelo qual a aprovação é presa ao hash
 * do conteúdo.
 *
 * ESTE É O SEGUNDO CAMINHO DE EXECUÇÃO, e o que ele carrega mudou (RF-T-04,
 * RNF-09). Até 10/09/2026 o efeito era chamado com `(args, orgId)` e nada mais:
 * o conector no fim da linha recebia a ação sem saber por conta de quem agia
 * nem a que história ela pertencia. O RASTRO sabia — o evento `acao.executada`
 * já saía com ator e correlação —, mas o efeito, não, e o efeito é quem fala
 * com o mundo. Agora ele recebe o contexto inteiro, e o ator dele é quem
 * APROVOU: nesta rota o proponente e o executor são pessoas diferentes por
 * desenho, e é o executor que responde pelo que saiu.
 *
 * O QUE MUDOU NA FATIA 3.3: quem DISPARA o efeito passou a ser a porta.
 *
 * Este serviço não conhece mais o `EfeitosRegistry`. Ele continua fazendo o que
 * só ele sabe fazer — conferir o estado da aprovação, queimar o uso único,
 * escrever `acao.executada`/`acao.falhou` — e pede à porta que confira e depois
 * dispare. A diferença não é de estilo: enquanto este arquivo alcançava o
 * registro sozinho, existiam DOIS pontos do programa capazes de chegar num
 * conector, e só um deles era a porta. Agora a régua de HOJE é conferida de novo
 * antes de a ação de ONTEM sair (RF-G-01).
 *
 * SÃO DUAS CHAMADAS À PORTA, E A ORDEM É O DESENHO INTEIRO:
 *
 *   1. `conferirAprovado` — ANTES de a aprovação virar `consumida`, ao lado da
 *      pergunta do interruptor. Ela não toca em nada: reclassifica, confere se
 *      a capacidade ainda está no catálogo e revalida os argumentos gravados.
 *      Recusando, a aprovação continua `confirmada` e NÃO consumida.
 *   2. `dispararAprovado` — depois do uso único queimado. É só o efeito.
 *
 * A primeira versão desta fatia tinha um método só, que conferia e disparava
 * junto, e por isso era chamado DEPOIS de consumir. Uma reclassificação para
 * bloqueio, uma capacidade que saísse do catálogo ou um `argsSchema` apertado
 * deixavam a aprovação `consumida` sem nada ter saído — estado terminal que se
 * lê como "executada", de onde não se reexecuta nem se repropõe. Foi o defeito
 * que reprovou a fatia; a ordem acima é o conserto, e ela está travada por teste.
 */
@Injectable()
export class AcoesService {
  private readonly log = new Logger('Acoes');

  constructor(
    private readonly prisma: PrismaService,
    /*
     * A PORTA. Substituiu o `EfeitosRegistry` que morava aqui — ver o cabeçalho.
     * É ela que resolve a capacidade, reclassifica, revalida os argumentos
     * gravados e chama o efeito.
     */
    private readonly gateway: ToolGateway,
    private readonly eventos: EventLogService,
    /*
     * O INTERRUPTOR DE CONECTOR (RF-G-06) TAMBÉM VALE AQUI — e sem isto o
     * desligamento tem um buraco do tamanho da fila de aprovação: uma ação
     * proposta ANTES de alguém desligar o conector continuaria saindo DEPOIS,
     * que é exatamente o caso de emergência para o qual o botão existe.
     *
     * SÃO DUAS PERGUNTAS, e a ordem entre elas é o desenho inteiro:
     *   · `conectorDesligado()` — a que o controlador faz ANTES de confirmar. É
     *     a que o operador encontra, e é a que mantém a aprovação PENDENTE e na
     *     fila quando a resposta é "desligado";
     *   · a de dentro de `executarAprovada` — último portão antes do efeito,
     *     para a janela entre uma e outra e para quem não perguntou.
     *
     * `@Optional()` porque as suítes constroem este serviço à mão; o registro
     * devolve `null` quando ninguém se inscreveu (ver `interruptores.registry.ts`).
     */
    @Optional() private readonly interruptores?: InterruptoresRegistry,
    /*
     * A POLÍTICA, só para duas perguntas sobre a capacidade: qual a
     * SENSIBILIDADE do efeito e COMO SE DESFAZ.
     *
     * A primeira não é conforto: sem ela, o conteúdo que este serviço passou a
     * registrar (argumentos, resultado, entrega) iria CRU para o RASTRO, e o
     * único efeito de escrita ligado hoje — a mensagem de WhatsApp — é
     * `confidencial`. É o `EventLogService` que troca conteúdo sensível por
     * resumo criptográfico, mas só quando alguém diz a ele que é sensível
     * (RF-R-04). A segunda é o campo `desfazer`, que a política cobra em R2.
     *
     * `@Optional()` pelo mesmo motivo dos outros: as suítes constroem à mão.
     * Sem ela, este serviço volta a NÃO registrar conteúdo — falha fechada, e
     * não conteúdo sensível gravado em claro.
     */
    @Optional() private readonly policy?: PolicyService,
  ) {}

  /**
   * O CONECTOR DESTA APROVAÇÃO ESTÁ DESLIGADO? — a pergunta que vem ANTES de
   * confirmar (RF-G-06).
   *
   * ------------------------------------------------------------------------
   * POR QUE NO CONTROLADOR, E NÃO SÓ ANTES DO EFEITO
   * ------------------------------------------------------------------------
   * A primeira versão do gancho perguntava só dentro de `executarAprovada`, que
   * o controlador chama DEPOIS de `approvals.confirm`. O roteiro era:
   * confirmar (a aprovação vira `confirmada`) → perguntar → recusar. Resultado:
   * a aprovação ficava `confirmada` e NÃO consumida, e nesse estado ela some da
   * fila — `listar` devolve as pendentes — enquanto `confirm` recusa tudo o que
   * não está pendente. A ação parava até expirar, e ninguém ficava sabendo.
   *
   * Pior: a frase que o operador lê ao ser recusado diz que "religar em Conexões
   * restabelece o uso sem nova autorização". Com a pergunta depois do confirm,
   * não restabelecia — não havia superfície que executasse uma aprovação já
   * confirmada.
   *
   * Perguntando AQUI, antes de confirmar, a promessa volta a ser verdadeira: a
   * aprovação continua PENDENTE, continua na fila, e o mesmo botão funciona de
   * novo assim que o conector voltar. Nada foi gasto — nem o estado da
   * aprovação, nem o token.
   *
   * ------------------------------------------------------------------------
   * O QUE ELA CUSTA
   * ------------------------------------------------------------------------
   * Uma leitura da aprovação (por id + empresa, índice primário) e uma do
   * desligamento (menos de 1 ms — ver o cabeçalho de `ConectoresService`) por
   * clique em "confirmar". Confirmar já faz meia dúzia de idas ao banco.
   *
   * Devolve a recusa em vez de lançar: é o CONTROLADOR quem decide o transporte
   * (403 com a frase), e assim este método serve também ao script de terminal,
   * que imprime em vez de responder HTTP.
   */
  async conectorDesligado(
    orgId: string,
    approvalId: string,
    actorId: string,
  ): Promise<RecusaDeConector | null> {
    exigirTenant(orgId, 'AcoesService.conectorDesligado');
    if (!this.interruptores) return null;

    const ap = await this.prisma.approval.findFirst({
      where: { id: approvalId, orgId },
      select: { capabilityId: true, toolCallId: true },
    });
    // Aprovação inexistente, ou da superfície antiga (sem ação retida): não há
    // capacidade para consultar. Quem reclama do id errado é `confirm`, logo
    // adiante — antecipar o erro aqui seria dar duas mensagens para o mesmo
    // engano.
    if (!ap?.capabilityId || !ap.toolCallId) return null;

    return this.interruptores.consultar({
      orgId,
      capabilityId: ap.capabilityId,
      correlationId: correlacaoAtual() ?? null,
      actorType: ActorType.user,
      actorId,
    });
  }

  async executarAprovada(
    orgId: string,
    approvalId: string,
    actorId: string,
  ): Promise<
    | { status: 'executado'; resultado: unknown }
    | { status: 'sem_efeito'; motivo: string }
    | { status: 'nada_a_executar' }
  > {
    // Empresa vem antes de qualquer consulta: `findFirst({ where: { orgId:
    // undefined } })` é um filtro que o Prisma simplesmente ignora, e o que
    // sobra é "a primeira aprovação de qualquer empresa". RF-T-04 — ausência de
    // tenant é erro, nunca "todos".
    exigirTenant(orgId, 'AcoesService.executarAprovada');

    const ap = await this.prisma.approval.findFirst({ where: { id: approvalId, orgId } });
    if (!ap) throw new NotFoundException('Aprovação não encontrada');

    // Aprovação sem ação retida é a superfície antiga (as 5 rotas com
    // @SensitiveWrite): lá quem executa é a própria rota, com o token.
    if (!ap.toolCallId || !ap.capabilityId) return { status: 'nada_a_executar' };
    // Cópia local porque o efeito é chamado de dentro de um callback, e o
    // TypeScript esquece o estreitamento de propriedade ao entrar numa função.
    const capabilityId = ap.capabilityId;

    /*
     * A capacidade, só pelos dois campos que o RASTRO precisa dela
     * (`efeito.sensibilidade` e `desfazer`). Leitura em memória — o catálogo já
     * está resolvido pelo `PolicyService`, não há ida ao banco aqui.
     *
     * `null` quando a política não foi injetada (suíte construindo à mão) ou
     * quando a capacidade não está no catálogo daquela empresa. Nos dois casos o
     * conteúdo REDIGÍVEL fica de fora da linha — ver `conteudoDaAcao`.
     */
    const cap = this.policy?.resolverCapacidade(orgId, capabilityId) ?? null;
    const sensibilidade = cap?.efeito.sensibilidade as SensibilidadeDoEvento | undefined;

    // Dois cliques no botão de aprovar é o caso REAL, não a exceção. Quem cai
    // aqui precisa entender que já saiu — "está consumida, não confirmada"
    // manda a pessoa procurar um problema que não existe.
    if (ap.status === ApprovalState.consumida) {
      throw new BadRequestException('Esta ação já foi executada (uso único).');
    }
    if (ap.status !== ApprovalState.confirmada) {
      throw new BadRequestException(`Aprovação está ${ap.status}, não confirmada.`);
    }
    if (ap.expiraEm < new Date()) throw new BadRequestException('Aprovação expirada.');

    const chamada = await this.prisma.toolCall.findFirst({
      where: { id: ap.toolCallId, orgId },
      select: { id: true, args: true, capabilityId: true, agentSlug: true, correlationId: true },
    });
    if (!chamada) throw new NotFoundException('A ação retida não existe mais.');

    if (!this.gateway.temEfeito(ap.capabilityId)) {
      return {
        status: 'sem_efeito',
        motivo: `"${ap.capabilityId}" está classificada e aprovada, mas o efeito não está ligado nesta versão.`,
      };
    }

    /*
     * O CONECTOR AINDA ESTÁ LIGADO? — RF-G-06, o segundo ponto do gancho, ÚLTIMO
     * PORTÃO antes do efeito.
     *
     * Esta NÃO é a conferência que o operador encontra. Quem a encontra é a de
     * `conectorDesligado()`, chamada pelo controlador ANTES de `confirm` — ver
     * o cabeçalho daquele método para o porquê. Esta aqui cobre dois casos que
     * aquela não cobre:
     *
     *   · o desligamento que acontece na janela entre a pergunta do controlador
     *     e esta linha (milissegundos, mas existe);
     *   · qualquer chamador de `executarAprovada` que não tenha perguntado antes.
     *
     * ANTES DE CONSUMIR A APROVAÇÃO, de propósito: o token é de uso único, e
     * queimá-lo numa recusa obrigaria a pessoa a refazer todo o ciclo depois de
     * religar. Recusada aqui, a aprovação continua `confirmada` e NÃO foi
     * consumida — `executarAprovada` aceita exatamente esse estado, então chamar
     * de novo depois de religar executa. O que o operador não tem é um botão que
     * faça isso pela tela: quem chega aqui vindo do `confirm` já passou por uma
     * confirmação que o deixou `confirmada`, e `confirm` recusa o que não está
     * pendente. É dívida declarada, e está no relatório da estabilização; o
     * caminho normal não passa por ela porque a pergunta do controlador vem antes.
     *
     * LANÇA em vez de devolver, ao contrário da porta: quem chama aqui é uma
     * rota HTTP, e a recusa vira 403 com a frase em português. O
     * `ForbiddenException` é levantado daqui, e não importado de
     * `integrations/`, para não fechar o ciclo de módulo que o registro de
     * interruptores existe para evitar.
     */
    const desligado = await this.interruptores?.consultar({
      orgId,
      capabilityId,
      correlationId: correlacaoAtual() ?? null,
      actorType: ActorType.user,
      actorId,
      agentSlug: chamada.agentSlug,
    });
    if (desligado) {
      this.log.warn(
        `aprovação ${approvalId} NÃO executada: ${desligado.conector} está desligado para a ` +
          `empresa ${orgId}. A aprovação está CONFIRMADA e NÃO foi consumida — religar o ` +
          'conector e chamar executarAprovada de novo executa, sem nova autorização.',
      );
      throw new ForbiddenException(corpoDaRecusa(desligado));
    }

    /*
     * A RÉGUA DE HOJE, PERGUNTADA ANTES DE QUEIMAR A APROVAÇÃO — RF-G-01.
     *
     * Aqui, ao lado do interruptor, e pela MESMA razão que o interruptor está
     * aqui: recusa não pode custar a aprovação. A porta reclassifica com o
     * catálogo de hoje (a proposta pode ser de ontem e a capacidade pode ter
     * subido para R5), trata capacidade fora do catálogo como bloqueio e
     * revalida os argumentos GRAVADOS contra o `argsSchema` atual.
     *
     * Na primeira versão desta fatia as três conferências moravam dentro do
     * disparo, que só era chamado DEPOIS do `updateMany` abaixo. Qualquer uma
     * delas recusando deixava a aprovação `consumida` — estado terminal que se
     * lê como "executada": some da fila, `confirm` recusa o que não está
     * pendente, `executarAprovada` recusa o que não está `confirmada`. A ação
     * não saía, ninguém reexecutava, ninguém repropunha, e a mensagem ainda
     * dizia que a aprovação "continua registrada". Era o limbo da onda 6 de
     * volta, invertido — ver o bloco de comentário em `tool-gateway.service.ts`
     * sobre por que o método foi partido em dois.
     *
     * LANÇA, e quem chama é a rota de confirmação: vira 403/400 com o motivo em
     * português, com a aprovação intacta.
     */
    const args = (chamada.args ?? {}) as Record<string, unknown>;
    this.gateway.conferirAprovado({ capabilityId, args, orgId });

    // Uso único, mesmo aqui: dois cliques no botão de aprovar não podem
    // executar duas vezes. Quem garante é a escrita condicional, não um if.
    const { count } = await this.prisma.approval.updateMany({
      where: { id: approvalId, orgId, status: ApprovalState.confirmada },
      data: { status: ApprovalState.consumida, consumidoEm: new Date() },
    });
    if (count !== 1) throw new BadRequestException('Aprovação já utilizada (uso único).');

    /*
     * A CORRELAÇÃO É A DA PROPOSTA, não uma nova.
     *
     * É o que amarra a execução ao evento original: `tool.proposta` (o agente
     * pediu), `acao.executada` (a pessoa aprovou e saiu) e tudo que veio no
     * meio compartilham o mesmo identificador, e a jornada inteira se lê com um
     * filtro só. Uma correlação nova aqui quebraria exatamente esse fio.
     *
     * Só quando a chamada retida não tem correlação — proposta antiga, gravada
     * antes de o campo existir — é que se deriva uma do próprio `approvalId`.
     * Deriva, não sorteia: assim continua sendo a MESMA para as duas linhas que
     * esta execução escreve, e ainda aponta para a aprovação que a originou.
     */
    const correlationId = chamada.correlationId ?? `aprovacao-${approvalId}`;

    /*
     * O ator do efeito é QUEM APROVOU. A proposta é da IA; a execução é de
     * gente, e o conector precisa saber disso — é a diferença entre "o agente
     * mandou" e "o Pedro mandou, depois de ler".
     */
    const ctxEfeito: ContextoDoEfeito & { correlationId: string } = {
      orgId,
      actorType: ActorType.user,
      actorId,
      agentSlug: chamada.agentSlug,
      correlationId,
    };

    /*
     * A correlação da REQUISIÇÃO de confirmação é outra história (o clique na
     * tela) e vai para o payload, não para o campo: o campo é o fio da ação.
     *
     * E ela é a única coisa aqui que QUEM APROVA escolhe: basta mandar um
     * cabeçalho de correlação na confirmação. Como o destino é o RASTRO
     * append-only, um insider poderia plantar ali o fio de outra ação e ninguém
     * apagaria depois. Por isso o interceptor marca o que vem de fora com
     * `ext-` antes de adotar (ver `marcarCorrelacaoExterna`): o valor continua
     * sendo registrado — é informação —, mas nunca se passa por um
     * identificador cunhado por nós.
     */
    const daRequisicao = correlacaoAtual();
    const correlacaoDaConfirmacao = daRequisicao && daRequisicao !== correlationId ? daRequisicao : undefined;

    const inicio = Date.now();
    try {
      // Os argumentos são os do REGISTRO da proposta, não os da requisição — e
      // são os MESMOS que `conferirAprovado` acabou de revalidar, lá em cima.
      const resultado = await comContexto({ ...ctxEfeito, origem: 'aprovacao' }, () =>
        this.gateway.dispararAprovado({ capabilityId, args, ctx: ctxEfeito }),
      );

      await this.prisma.toolCall.update({
        where: { id: chamada.id },
        data: { status: ToolCallStatus.executado, duracaoMs: Date.now() - inicio },
      });
      await this.eventos.registrar({
        orgId,
        tipo: 'acao.executada',
        actorType: ActorType.user,
        actorId,
        agentSlug: chamada.agentSlug,
        capabilityId: ap.capabilityId,
        toolCallId: chamada.id,
        nivel: ap.nivelExigido as RiskLevel,
        correlationId,
        /*
         * `approvalId` e `duracaoMs` continuam AQUI: são metadado da operação,
         * não palavra da política. O que era `aprovadoPor` mudou de lugar e de
         * nome — ver o `conteudo` abaixo.
         */
        payload: {
          approvalId,
          duracaoMs: Date.now() - inicio,
          ...(correlacaoDaConfirmacao ? { correlacaoDaConfirmacao } : {}),
        },
        // O hash que amarrou a aprovação ao conteúdo exato é o `hashConteudo`
        // que a política cobra em R3 e R4. Ele já está na linha da aprovação.
        contentHash: ap.contentHash,
        /*
         * A ARMADILHA, resolvida por RENOMEAR e não por registrar de novo.
         *
         * Até aqui o aprovador ia em `payload.aprovadoPor`. A conferência de
         * nível procura a palavra da POLÍTICA (`aprovador`), então ela acusava
         * "aprovador faltando" numa linha que o continha — dívida contada duas
         * vezes e nenhuma delas verdadeira. O conserto é este: a mesma
         * informação, com o nome que o documento normativo usa.
         */
        conteudo: this.conteudoDaAcao(ap, capabilityId, cap, inicio, { args, resultado }),
        sensibilidade,
      });
      this.log.log(`${ap.capabilityId} executada após aprovação de ${ap.aprovadoPorId}`);
      return { status: 'executado', resultado };
    } catch (e) {
      const erro = (e as Error).message;
      await this.prisma.toolCall.update({
        where: { id: chamada.id },
        data: { status: ToolCallStatus.erro, erro: erro.slice(0, 500), duracaoMs: Date.now() - inicio },
      });
      await this.eventos.registrar({
        orgId,
        tipo: 'acao.falhou',
        actorType: ActorType.user,
        actorId,
        // A falha carrega o mesmo ator, o mesmo agente e o mesmo nível da
        // execução: quem lê o RASTRO procurando "o que aconteceu com aquela
        // ação" não pode achar metade dos campos só porque ela deu errado.
        agentSlug: chamada.agentSlug,
        capabilityId: ap.capabilityId,
        toolCallId: chamada.id,
        nivel: ap.nivelExigido as RiskLevel,
        correlationId,
        payload: {
          approvalId,
          erro: erro.slice(0, 300),
          ...(correlacaoDaConfirmacao ? { correlacaoDaConfirmacao } : {}),
        },
        contentHash: ap.contentHash,
        // A falha carrega o MESMO vocabulário do sucesso, pelo mesmo motivo do
        // comentário acima: `entrega` aqui é o que o outro lado respondeu, e
        // "não deu" é uma resposta.
        conteudo: this.conteudoDaAcao(ap, capabilityId, cap, inicio, {
          args,
          resultado: { ok: false, erro: erro.slice(0, 300) },
        }),
        sensibilidade,
      });
      throw e;
    }
  }

  /**
   * O vocabulário do RASTRO para as duas linhas que este serviço escreve.
   *
   * UMA função para `acao.executada` e `acao.falhou` de propósito: os dois
   * eventos descrevem a MESMA ação e a política cobra deles os mesmos campos.
   * Duas listas seriam duas listas para divergir.
   *
   * O QUE DEPENDE DA POLÍTICA ESTAR INJETADA: só o conteúdo REDIGÍVEL
   * (`argumentos`, `resultado`, `entrega`). Sem a capacidade resolvida não há
   * como saber a sensibilidade do efeito, e gravar o texto de uma mensagem
   * `confidencial` em claro seria trocar um campo faltando por um vazamento
   * (RF-R-04). O resto — aprovador, canal, custo — é metadado: nunca é
   * redigido, então entra sempre.
   */
  private conteudoDaAcao(
    ap: {
      aprovadoPorId: string | null;
      aprovadoEm: Date | null;
      canal: string | null;
      capabilityId: string | null;
      resumo: string;
      motivo: string | null;
    },
    capabilityId: string,
    cap: { desfazer?: string } | null,
    inicio: number,
    conteudo: { args: Record<string, unknown>; resultado: unknown },
  ): ConteudoDoEvento {
    const redigivel: ConteudoDoEvento = cap
      ? { argumentos: conteudo.args, resultado: conteudo.resultado, entrega: conteudo.resultado }
      : {};
    return {
      aprovador: ap.aprovadoPorId,
      aprovadoEm: ap.aprovadoEm,
      // O canal veio gravado na aprovação (a porta o escreve ao propor). A volta
      // pelo mapa cobre as aprovações criadas antes de a porta passar a gravá-lo.
      canal: ap.canal ?? conectorDaCapacidade(ap.capabilityId),
      resumo: ap.resumo,
      motivo: ap.motivo,
      desfazer: cap?.desfazer,
      // A fonte desta linha é a ferramenta, e o caminho é a fila de aprovação —
      // não o laço do agente. Quem lê a auditoria precisa distinguir os dois.
      fontes: [{ tipo: 'ferramenta', id: capabilityId, origem: 'aprovacao' }],
      // Tempo, não dinheiro: o gasto com modelo é apurado em `GastoDeIaNoDia`, e
      // esta execução não chama modelo nenhum.
      custo: { duracaoMs: Date.now() - inicio, apuracaoDeGasto: 'GastoDeIaNoDia' },
      ...redigivel,
    };
  }
}
