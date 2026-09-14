import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ActorType, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EventLogService } from '../gateway/event-log.service';
import { contextoAtual } from '../common/contexto-execucao';
import { agenteDaCasa } from './agentes-da-casa';
import {
  CAUSA_DO_CHECKOUT,
  EVENTO_DO_CHECKOUT,
  MOTIVO_DA_SOLTURA,
  agentePodeAssumir,
  mensagemDeCorridaPerdida,
  mensagemDeTarefaArquivada,
  mensagemDeTarefaLivre,
  recusaDeAssumirPorEstado,
  type MotivoDaSoltura,
} from './checkout-de-tarefa';

/**
 * ============================================================================
 * ASSUMIR E SOLTAR TAREFA — fatia A4
 * ============================================================================
 *
 * Um serviço só para dois verbos, e é de propósito: o checkout é a única escrita
 * deste módulo que tem CORRIDA. Todo o resto de `WorkService` é edição de campo
 * — dois usuários mexendo no mesmo título, o último vence, e ninguém se importa.
 * Aqui o "último vence" é o defeito: dois agentes fazendo o mesmo trabalho.
 * Misturar isso com os trinta métodos de CRUD do quadro faria a regra
 * desaparecer no meio deles.
 *
 * ----------------------------------------------------------------------------
 * POR QUE NÃO PASSA PELA PORTA
 * ----------------------------------------------------------------------------
 * Pela mesma decisão que o módulo inteiro já tomou e que está escrita em
 * `work.controller.ts`: escrita de quadro é INTERNA ao OS, sem efeito em sistema
 * de ninguém, então o guarda é o RBAC (`tarefas.editar`) e não a régua. Assumir
 * uma tarefa não manda mensagem, não gasta dinheiro, não toca conector — ela
 * move uma coluna de uma tabela nossa.
 *
 * E o desfecho de errar é pequeno e reversível nos dois sentidos: travou a
 * tarefa errada, solta; soltou por engano, assume de novo. Retenção por aprovação
 * (R3+) exigiria SEGUNDA PESSOA (invariante 7) para um agente começar a
 * trabalhar — numa empresa de operador único, todo checkout ficaria na fila para
 * sempre e o painel de agentes voltaria a ser vitrine, que é exatamente o que
 * este plano existe para desfazer.
 *
 * O QUE ISSO **NÃO** SIGNIFICA: nada aqui afrouxa a régua. O agente que assumiu
 * a tarefa continua passando pela porta a cada chamada de ferramenta, preso às
 * capacidades declaradas, ao teto de autonomia, ao orçamento da A3 e ao
 * rebaixamento por erro. Ter a tarefa na mão não dá alcance nenhum — dá
 * EXCLUSIVIDADE, que é outra coisa.
 *
 * DECISÃO DO PEDRO, DECLARADA E NÃO TOMADA AQUI: se um dia o próprio agente
 * puder pedir "assumo esta tarefa" de dentro do laço, isso vira capacidade de
 * catálogo e passa pela porta como tudo o mais. Hoje quem chama é gente, pela
 * tela, e o agente é o DESTINO do trabalho, não o requerente.
 */
@Injectable()
export class CheckoutDeTarefaService {
  private readonly log = new Logger('CheckoutDeTarefa');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    /*
     * `@Optional()` pelo mesmo motivo de `AgentsService`: há suíte que constrói
     * este serviço sem o rastro. Sem ele o checkout continua sendo atômico e a
     * auditoria administrativa continua registrando — o que se perde é a linha
     * na cadeia de hash, e o log grita quando isso acontece.
     */
    @Optional() private readonly eventos?: EventLogService,
  ) {}

  /* ====================================================================== *
   * ASSUMIR
   * ====================================================================== */

  /**
   * Entrega a tarefa a um agente — e só a um.
   *
   * `statusId` opcional move a tarefa NA MESMA INSTRUÇÃO do checkout. É o
   * "a transição para em andamento exige um checkout atômico" do plano, ao pé da
   * letra: sem isso, mover para "Em andamento" e travar seriam duas escritas, e
   * entre elas existiria uma tarefa em andamento sem dono — o estado que faz o
   * segundo agente pensar que o trabalho está sobrando.
   */
  async assumir(
    orgId: string,
    taskId: string,
    slugDoAgente: string,
    quem: { actorId: string | null; actorType?: ActorType },
    statusId?: string | null,
  ) {
    /*
     * AS TRÊS LEITURAS DE ANTES NÃO SÃO O CHECKOUT.
     *
     * Elas respondem perguntas que não têm corrida: este agente existe nesta
     * empresa? ele trabalha? este status é da lista desta tarefa? Nenhuma delas
     * muda por causa de outro agente assumindo a tarefa ao mesmo tempo. O que
     * tem corrida é UMA coisa — a tarefa estar livre — e essa pergunta NÃO é
     * feita aqui: ela é feita dentro do `WHERE` do `updateMany`, que é o único
     * lugar onde a resposta não pode envelhecer entre a leitura e a escrita.
     */
    const agente = await this.prisma.agent.findFirst({
      where: { orgId, slug: slugDoAgente },
      select: { id: true, slug: true, nome: true, estado: true },
    });
    if (!agente) {
      throw new NotFoundException(
        `Não existe agente "${slugDoAgente}" nesta empresa. Confira em /agentes.`,
      );
    }

    if (!agentePodeAssumir(agente.estado)) {
      const recusa = recusaDeAssumirPorEstado(agente.estado);
      await this.registrarRecusa(orgId, taskId, quem, {
        causa: recusa?.causa ?? CAUSA_DO_CHECKOUT.agenteNaoTrabalha,
        motivo: recusa?.motivo ?? 'Agente não está em estado de trabalhar.',
        agente: agente.slug,
      });
      throw new ConflictException(
        `O agente "${agente.nome}" não pode assumir tarefa: ${recusa?.motivo ?? ''}`.trim(),
      );
    }

    /*
     * A TAREFA É LIDA PARA VALIDAR O STATUS, e a leitura carrega o `listId` que
     * entra no `WHERE` do checkout mais abaixo. Ver o comentário de lá: é o que
     * impede o status de uma lista pousar numa tarefa que já foi movida para
     * outra enquanto esta chamada acontecia.
     */
    const antes = await this.prisma.workTask.findFirst({
      where: { id: taskId, orgId },
      select: { id: true, listId: true, statusId: true, title: true, archived: true, agenteId: true },
    });
    if (!antes) throw new NotFoundException('Tarefa não encontrada');
    if (antes.archived) {
      await this.registrarRecusa(orgId, taskId, quem, {
        causa: CAUSA_DO_CHECKOUT.arquivada,
        motivo: mensagemDeTarefaArquivada(),
        agente: agente.slug,
      });
      throw new ConflictException(mensagemDeTarefaArquivada());
    }

    if (statusId) {
      const ok = await this.prisma.workStatus.findFirst({
        where: { id: statusId, orgId, listId: antes.listId },
        select: { id: true },
      });
      if (!ok) throw new ConflictException('Status não pertence à lista desta tarefa.');
    }

    const agora = new Date();

    /*
     * ================== O CHECKOUT ATÔMICO — UMA INSTRUÇÃO ==================
     *
     * `updateMany` e não `update`, porque `update` acha a linha pela chave
     * primária e IGNORA qualquer outra condição: ele grava por cima do dono
     * atual e devolve sucesso. O que decide aqui é a CONTAGEM: `agenteId: null`
     * no `WHERE` faz o Postgres afetar 1 linha para quem chegou primeiro e 0
     * para todos os outros, porque a segunda transação espera o bloqueio de
     * linha e reavalia a condição depois do commit da primeira.
     *
     * `listId` entra no `WHERE` só quando há mudança de status: se a tarefa foi
     * movida de lista no meio desta chamada, o checkout falha em vez de gravar
     * um status que não pertence mais à lista dela. Sem isso, a validação de
     * status acima seria uma leitura que envelhece — o mesmo tipo de furo que
     * esta fatia existe para fechar, um nível abaixo.
     *
     * NÃO TROQUE ISTO POR `findFirst` + `update`. A suíte
     * `test/checkout-de-tarefa.test.ts` dispara duas chamadas concorrentes de
     * verdade contra o banco e exige que exatamente uma vença; e um caso dela
     * confere que este caminho nunca chama `workTask.update`.
     */
    const { count } = await this.prisma.workTask.updateMany({
      where: {
        id: taskId,
        orgId,
        agenteId: null,
        archived: false,
        ...(statusId ? { listId: antes.listId } : {}),
      },
      data: {
        agenteId: agente.id,
        agenteEm: agora,
        ...(statusId ? { statusId } : {}),
      },
    });

    if (count === 0) {
      /*
       * PERDEU A CORRIDA — ou a tarefa mudou debaixo da chamada. A leitura de
       * agora é DIAGNÓSTICO, não decisão: ela só existe para a mensagem dizer
       * quem ganhou. Se ela voltar dizendo "livre" (alguém soltou entre o
       * `updateMany` e este `findFirst`), a resposta ainda é 409 — esta chamada
       * não travou nada, e mentir "ok" faria o agente trabalhar numa tarefa que
       * não é dele.
       */
      const depois = await this.prisma.workTask.findFirst({
        where: { id: taskId, orgId },
        select: { agenteId: true, agenteEm: true, archived: true },
      });
      if (!depois) throw new NotFoundException('Tarefa não encontrada');
      if (depois.archived) throw new ConflictException(mensagemDeTarefaArquivada());

      const dono = await agenteDaCasa(this.prisma, orgId, depois.agenteId);
      const frase = mensagemDeCorridaPerdida({
        nome: dono?.nome ?? null,
        desde: depois.agenteEm,
      });
      await this.registrarRecusa(orgId, taskId, quem, {
        causa: CAUSA_DO_CHECKOUT.jaAssumida,
        motivo: frase,
        agente: agente.slug,
        donoAtual: dono?.slug ?? null,
      });
      throw new ConflictException(frase);
    }

    await this.registrar(orgId, EVENTO_DO_CHECKOUT.assumida, taskId, quem, {
      titulo: antes.title,
      agente: agente.slug,
      agenteNome: agente.nome,
      desde: agora.toISOString(),
      statusAnterior: antes.statusId,
      statusNovo: statusId ?? antes.statusId,
    });

    return {
      ok: true as const,
      taskId,
      agente: { id: agente.id, slug: agente.slug, nome: agente.nome },
      desde: agora.toISOString(),
      statusId: statusId ?? antes.statusId,
    };
  }

  /* ====================================================================== *
   * SOLTAR
   * ====================================================================== */

  /**
   * Devolve a tarefa para a fila.
   *
   * QUALQUER PESSOA COM `tarefas.editar` SOLTA, não só quem travou — e essa é a
   * decisão central deste verbo. Um agente que travou a tarefa e morreu no meio
   * (deploy, erro, teto de tempo) não vai soltar nada; se a devolução dependesse
   * dele, a tarefa ficaria presa para sempre e o quadro do cliente só acumularia
   * trabalho intocável. Quem solta e de quem fica no RASTRO, que é onde essa
   * pergunta pertence.
   */
  async soltar(
    orgId: string,
    taskId: string,
    quem: { actorId: string | null; actorType?: ActorType },
    motivo?: string | null,
  ) {
    const antes = await this.prisma.workTask.findFirst({
      where: { id: taskId, orgId },
      select: { id: true, title: true, agenteId: true, agenteEm: true },
    });
    if (!antes) throw new NotFoundException('Tarefa não encontrada');
    if (!antes.agenteId) throw new ConflictException(mensagemDeTarefaLivre());

    /*
     * SOLTAR TAMBÉM É CONDICIONAL, pelo mesmo motivo de assumir: entre a leitura
     * acima e a escrita cabe uma soltura seguida de outro checkout. O `WHERE`
     * cobra o agenteId ESPECÍFICO que a leitura viu — sem isso, esta chamada
     * soltaria o agente que assumiu DEPOIS dela, tirando da mão de quem acabou
     * de ganhar a corrida uma tarefa que ninguém pediu para soltar. Uma
     * condição `{ not: null }` genérica não protegeria disso: ela casaria com o
     * dono novo.
     */
    const { count } = await this.prisma.workTask.updateMany({
      where: { id: taskId, orgId, agenteId: antes.agenteId },
      data: { agenteId: null, agenteEm: null },
    });

    if (count === 0) {
      /*
       * A tarefa trocou de dono entre a leitura e a escrita. A frase NÃO pode
       * ser "não está na mão de ninguém" — ela está, só não de quem esta
       * chamada viu. Dizer "livre" aqui faria a pessoa achar que soltou e ir
       * embora, com a tarefa travada por outro agente.
       */
      const agora = await this.prisma.workTask.findFirst({
        where: { id: taskId, orgId },
        select: { agenteId: true, agenteEm: true },
      });
      if (!agora?.agenteId) throw new ConflictException(mensagemDeTarefaLivre());
      const novo = await agenteDaCasa(this.prisma, orgId, agora.agenteId);
      throw new ConflictException(
        `Esta tarefa mudou de mão enquanto você soltava: agora está com ${
          novo?.nome ? `o agente "${novo.nome}"` : 'outro agente'
        }. Nada foi alterado — solte de novo se era isso mesmo que você queria.`,
      );
    }

    const dono = await agenteDaCasa(this.prisma, orgId, antes.agenteId);
    await this.registrar(orgId, EVENTO_DO_CHECKOUT.soltada, taskId, quem, {
      titulo: antes.title,
      agente: dono?.slug ?? null,
      agenteNome: dono?.nome ?? null,
      desde: antes.agenteEm?.toISOString() ?? null,
      causa: MOTIVO_DA_SOLTURA.pedido,
      motivo: motivo?.trim()?.slice(0, 500) || null,
    });

    return { ok: true as const, taskId, soltaDe: dono?.slug ?? null };
  }

  /* ====================================================================== *
   * O AGENTE SAIU DE CIRCULAÇÃO — E AS TAREFAS DELE?
   * ====================================================================== */

  /**
   * Solta TODAS as tarefas de um agente que deixou de trabalhar.
   *
   * ESTE É O CAMINHO DE VOLTA QUE A FATIA A2 NÃO TINHA. Pausar e encerrar já
   * impediam o agente de rodar, mas nada olhava para o que ele tinha na mão: um
   * agente pausado no meio de uma tarefa a deixava travada com um dono que, por
   * decisão declarada de uma pessoa, nunca mais vai voltar para terminá-la.
   * Encerrar era pior — `TRANSICOES.encerrado` é vazio, então aquela tarefa
   * ficaria presa até alguém descobrir e soltar na mão.
   *
   * Roda DENTRO da mesma transação da mudança de estado (o `tx` vem de fora), e
   * isso é o ponto: não existe instante em que o agente está pausado e a tarefa
   * continua travada. Se a soltura falhar, a mudança de estado volta atrás junto
   * — "pausado com tarefa presa" é um estado que a fatia se recusa a produzir,
   * mesmo por meio segundo.
   *
   * O RASTRO fica FORA da transação de propósito, como em
   * `AgentsService.registrarMudancaDeEstado`: registrar dentro faria uma falha de
   * rastro desfazer uma mudança de estado que já é legítima. Quem chama registra
   * depois do commit, com os ids que esta função devolve.
   *
   * RETOMAR NÃO DEVOLVE NADA. As tarefas foram soltas e podem estar com outro
   * agente agora; reatribuí-las automaticamente criaria a segunda corrida, fora
   * do checkout. Quem retoma escolhe de novo na tela.
   */
  async soltarTodasDoAgente(
    tx: Prisma.TransactionClient,
    orgId: string,
    agenteId: string,
    causa: MotivoDaSoltura,
  ): Promise<Array<{ id: string; title: string; desde: Date | null }>> {
    const presas = await tx.workTask.findMany({
      where: { orgId, agenteId },
      select: { id: true, title: true, agenteEm: true },
    });
    if (presas.length === 0) return [];

    const { count } = await tx.workTask.updateMany({
      where: { orgId, agenteId },
      data: { agenteId: null, agenteEm: null },
    });

    /*
     * A contagem tem de bater com o que foi lido. Não bater significa que outra
     * transação mexeu nas mesmas linhas no meio — e, como o que interessa aqui é
     * "nenhuma tarefa sobrou travada", a divergência é AVISO e não erro: o
     * `updateMany` já garantiu que nenhuma linha deste agente restou. Lançar
     * desfaria a pausa do agente por causa de uma tarefa que alguém soltou
     * primeiro.
     */
    if (count !== presas.length) {
      this.log.warn(
        `Soltura por "${causa}" do agente ${agenteId} (empresa ${orgId}): li ${presas.length} ` +
          `tarefa(s) e soltei ${count}. Alguém mexeu nas mesmas linhas — nenhuma sobrou travada.`,
      );
    }

    return presas.map((t) => ({ id: t.id, title: t.title, desde: t.agenteEm }));
  }

  /* ====================================================================== *
   * O QUE CADA AGENTE TEM NA MÃO
   * ====================================================================== */

  /**
   * Quantas tarefas cada agente desta empresa tem travadas.
   *
   * `groupBy` e não uma contagem por agente: a tela de Trabalho mostra a lista
   * inteira de agentes, e uma consulta por linha seria N+1 sobre um catálogo que
   * cresce. Agentes sem tarefa simplesmente não aparecem no mapa — quem lê
   * resolve com `?? 0`.
   */
  async tarefasPorAgente(orgId: string): Promise<Map<string, number>> {
    const grupos = await this.prisma.workTask.groupBy({
      by: ['agenteId'],
      where: { orgId, archived: false, agenteId: { not: null } },
      _count: true,
    });
    const mapa = new Map<string, number>();
    for (const g of grupos) if (g.agenteId) mapa.set(g.agenteId, g._count);
    return mapa;
  }

  /** Os agentes desta empresa, para a tela oferecer a quem entregar a tarefa. */
  async agentesParaEscolher(orgId: string) {
    const agentes = await this.prisma.agent.findMany({
      where: { orgId },
      orderBy: [{ nome: 'asc' }],
      select: { id: true, slug: true, nome: true, iniciais: true, estado: true },
    });
    const carga = await this.tarefasPorAgente(orgId);
    return agentes.map((a) => ({
      ...a,
      /*
       * A TELA DIZ ANTES DO CLIQUE quem pode receber trabalho — mesma disciplina
       * de `/atendimento`, que mostra a alçada antes de alguém tentar assinar.
       * Oferecer um agente pausado e devolver 409 depois seria fazer a pessoa
       * descobrir a regra pelo erro.
       */
      podeAssumir: agentePodeAssumir(a.estado),
      tarefas: carga.get(a.id) ?? 0,
    }));
  }

  /* ====================================================================== *
   * REGISTRO
   * ====================================================================== */

  /**
   * O rastro de UMA tarefa solta pela mudança de estado do agente.
   *
   * Público porque quem chama é `AgentsService.definirEstado`, DEPOIS do commit
   * da transação que soltou — registrar dentro dela faria uma falha de rastro
   * desfazer uma pausa legítima. O ator é a PESSOA que pausou, não o agente: foi
   * ela quem tirou a tarefa da mão dele, e é o nome dela que responde por isso.
   */
  registrarSolturaAutomatica(
    orgId: string,
    tarefa: { id: string; title: string; desde: Date | null },
    agente: { slug: string; nome: string },
    causa: string,
    actorId: string,
  ): Promise<void> {
    return this.registrar(orgId, EVENTO_DO_CHECKOUT.soltada, tarefa.id, { actorId }, {
      titulo: tarefa.title,
      agente: agente.slug,
      agenteNome: agente.nome,
      desde: tarefa.desde?.toISOString() ?? null,
      causa,
      motivo:
        `Tarefa devolvida à fila porque o agente "${agente.nome}" deixou de trabalhar ` +
        `(${causa}). Ninguém a assumiu no lugar — ela está livre.`,
    });
  }

  /**
   * O evento no rastro e a linha na auditoria administrativa, cada um por conta
   * própria — o rastro falhar não leva a auditoria junto, como em
   * `ConectoresService.registrarMudanca`. Nenhum dos dois decide nada: quando
   * esta função é chamada, a escrita já valeu no banco.
   */
  private async registrar(
    orgId: string,
    tipo: string,
    taskId: string,
    quem: { actorId: string | null; actorType?: ActorType },
    conteudo: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.eventos?.registrar({
        orgId,
        tipo,
        actorType: quem.actorType ?? ActorType.user,
        actorId: quem.actorId,
        agentSlug: typeof conteudo.agente === 'string' ? conteudo.agente : null,
        correlationId: contextoAtual()?.correlationId ?? null,
        payload: { taskId, agente: (conteudo.agente as string) ?? null },
        conteudo: {
          /*
           * `argumentos` e não `resumo`: o que este evento guarda é o PEDIDO
           * (qual tarefa, para qual agente), e ele é interno — nada aqui é
           * conteúdo de cliente nem segredo. Sensibilidade `interna` mantém o
           * texto legível no rastro, que é o que faz a linha responder "quem
           * estava com esta tarefa em tal dia" sem precisar de outra consulta.
           */
          argumentos: { taskId, ...conteudo },
          resultado: { taskId },
        },
        sensibilidade: 'interna',
      });
      if (!this.eventos) {
        this.log.warn(
          `${tipo} da tarefa ${taskId} (empresa ${orgId}) ficou FORA do rastro: o serviço subiu ` +
            'sem EventLogService.',
        );
      }
    } catch (e) {
      this.log.error(
        `${tipo} da tarefa ${taskId} (empresa ${orgId}) NÃO entrou no rastro: ` +
          `${(e as Error).message} — a mudança JÁ VALE no banco.`,
      );
    }

    try {
      await this.audit.log({
        orgId,
        actorId: quem.actorId ?? undefined,
        actorType: quem.actorType ?? ActorType.user,
        action: tipo,
        entityType: 'work_task',
        entityId: taskId,
        after: conteudo as Prisma.InputJsonValue,
      });
    } catch (e) {
      this.log.error(
        `${tipo} da tarefa ${taskId} (empresa ${orgId}) NÃO entrou na auditoria: ` +
          `${(e as Error).message}`,
      );
    }
  }

  /**
   * A RECUSA TAMBÉM ENTRA NO RASTRO, com causa própria.
   *
   * Mesma escolha que a A2 fez com `agente.passagem_recusada` e que a porta fez
   * com `agente_rebaixado`: antes disso a recusa acontecia em silêncio, e dava
   * para ver um agente parado sem dar para contar quantas vezes ele tentou nem
   * por quê. Duas tentativas perdidas por minuto na mesma tarefa é o sinal de
   * que dois agentes estão apontados para o mesmo trabalho — e é uma pergunta
   * que só o rastro responde.
   */
  private registrarRecusa(
    orgId: string,
    taskId: string,
    quem: { actorId: string | null; actorType?: ActorType },
    recusa: { causa: string; motivo: string; agente: string; donoAtual?: string | null },
  ): Promise<void> {
    return this.registrar(orgId, EVENTO_DO_CHECKOUT.recusada, taskId, quem, {
      ...recusa,
      recusado: true,
    });
  }
}
