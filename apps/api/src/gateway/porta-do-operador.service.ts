import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { correlacaoAtual, novaCorrelacao } from '../common/contexto-execucao';
import { EfeitosRegistry } from './efeitos.registry';
import { FILA_DE_APROVACAO } from './fila-de-aprovacao';
import type { ProcedenciaExterna } from '../policy/sinais.service';
import { ToolGateway, type ExecCtx } from './tool-gateway.service';

/*
 * ============================================================================
 * A PORTA, PARA QUEM CLICA NA TELA — RF-G-01, RF-A-01 (fatia 3.3)
 * ============================================================================
 *
 * O Tool Gateway nasceu para o laço do agente, e por isso durante meses ele
 * guardou METADE do produto. A outra metade — a pessoa que abre o painel e
 * clica em "enviar e-mail", "criar evento", "criar documento" — chegava no
 * conector por HTTP direto, autenticada só por JWT e por permissão de papel.
 * Sem classificação de risco, sem retenção por aprovação, sem RASTRO, sem o
 * interruptor de conector: quatro escritas externas vivas em produção que a
 * régua nunca viu.
 *
 * Não é assimetria defensável. A régua R0–R5 classifica O QUE A AÇÃO FAZ, não
 * quem a pediu: mandar e-mail em nome da empresa é R3 porque não existe
 * desenviar, e isso não muda porque quem apertou o botão foi gente. O que muda
 * com o ator é outra coisa, e a porta já trata: o teto de custo de IA só vale
 * para ação de agente (`actorType === ai`), e a declaração de capacidades só
 * existe para agente.
 *
 * ----------------------------------------------------------------------------
 * O QUE ESTE SERVIÇO É, E O QUE ELE NÃO É
 * ----------------------------------------------------------------------------
 * Ele é fino de propósito: monta o `ExecCtx` de um ator HUMANO, chama
 * `ToolGateway.executar` com o efeito que o REGISTRO já conhece, e traduz o
 * resultado da porta em resposta HTTP. Não decide nada — quem decide é a
 * política — e não conhece conector nenhum.
 *
 * O EFEITO VEM DO REGISTRO, e não por callback do controlador. É o que faz os
 * dois caminhos convergirem: a MESMA função que a porta chama agora é a que
 * `AcoesService` vai chamar depois, se a ação for retida para aprovação. Um
 * controlador que passasse o seu próprio callback executaria uma coisa na hora
 * e outra depois da aprovação — que é exatamente o defeito que esta fatia fecha.
 *
 * ----------------------------------------------------------------------------
 * O QUE ACONTECE COM CADA DESFECHO
 * ----------------------------------------------------------------------------
 *   · `executado`             — devolve o resultado, como a rota devolvia antes.
 *   · `aguardando_aprovacao`  — devolve o bilhete da fila (approvalId, resumo,
 *                               expiraEm). A rota responde 200 com esse corpo e
 *                               a tela manda a pessoa para a fila; quem executa
 *                               é `POST /approvals/:id/confirm`. NÃO é erro: a
 *                               ação foi aceita e está retida, que é o
 *                               comportamento correto de um R3.
 *
 * ----------------------------------------------------------------------------
 * A CONSEQUÊNCIA QUE A TELA TEM DE DIZER: PRECISA DE OUTRA PESSOA
 * ----------------------------------------------------------------------------
 * Neste caminho o PROPONENTE é quem clicou — é o `actorId` que a porta grava na
 * aprovação. E `ApprovalsService.confirm` recusa quando o proponente é o mesmo
 * que confirma (invariante 7 da escada). Somadas, as duas coisas significam que
 * as quatro escritas do Google, que antes saíam no clique, agora esperam uma
 * SEGUNDA pessoa com alçada suficiente (R3 pede `responsavel`).
 *
 * Isso é de propósito e não se afrouxa: a separação de funções é o que impede
 * alguém de assinar o próprio pedido, e rebaixá-la para "sair no clique" seria
 * desfazer a fatia inteira com outro nome. O que o bilhete acrescenta é
 * honestidade — `precisaDeOutraPessoa` e `fila` existem para a tela dizer o que
 * de fato aconteceu, em vez de um "✅ enviado" falso ou de uma caixa vermelha.
 *
 * O QUE ISSO CUSTA NUMA EMPRESA DE OPERADOR ÚNICO: as quatro ficam retidas até
 * existir um segundo usuário com alçada. Não há conserto técnico honesto para
 * isso — é decisão de operação (criar o segundo usuário em `POST /users`), e
 * está registrada no relatório da fatia.
 *   · `recusado`              — 403 com o motivo em português. Inclui o R5, em
 *                               que o `preparo` volta junto para a pessoa
 *                               executar na origem.
 *   · `erro`                  — 400 com a mensagem do efeito. O conector já
 *                               lança exceção do Nest com o texto certo; aqui
 *                               ela é reconstruída porque a porta a converteu em
 *                               resultado para não derrubar o laço do agente.
 */

// Onde a fila de aprovação mora na web: um lugar só (`fila-de-aprovacao.ts`), também lido pelo aviso do canal.
export { FILA_DE_APROVACAO };

/** O bilhete que a tela recebe quando a ação foi retida para aprovação. */
export interface AcaoRetida {
  status: 'aguardando_aprovacao';
  approvalId: string;
  resumo: string;
  expiraEm: string;
  nivel: string;
  /** O que a tela mostra em vez de um erro: a ação está na fila, não falhou. */
  mensagem: string;
  /**
   * QUEM CONFIRMA TEM DE SER OUTRA PESSOA — e a tela precisa dizer isso.
   *
   * Não é detalhe de implementação: é a consequência mais visível de a escrita
   * passar a ir pela porta. `ApprovalsService.confirm` recusa quando
   * `propostoPorId === actorId` (invariante 7 da escada: quem propôs a ação não
   * pode aprová-la), e neste caminho o proponente é QUEM CLICOU. Antes da
   * fatia, as quatro escritas do Google saíam no clique; agora elas esperam uma
   * segunda pessoa com alçada suficiente.
   *
   * A separação de funções NÃO foi afrouxada — ela é o que impede alguém de
   * assinar o próprio pedido. O que mudou foi a tela deixar de mentir sobre
   * ela. Numa instalação com um operador só, estas ações ficam retidas até
   * existir um segundo usuário com alçada; está dito no relatório da fatia.
   */
  precisaDeOutraPessoa: true;
  /** Onde a fila mora, para a tela poder levar a pessoa até lá. */
  fila: string;
}

@Injectable()
export class PortaDoOperador {
  private readonly log = new Logger('PortaDoOperador');

  constructor(
    private readonly gateway: ToolGateway,
    private readonly efeitos: EfeitosRegistry,
  ) {}

  /**
   * Executa uma capacidade por conta de uma PESSOA, pela porta.
   *
   * `resource` existe porque é ele que amarra a aprovação ao objeto concreto —
   * o documento que vai receber o texto, a peça que vai ser publicada. Quando
   * não vem, a porta usa o id da capacidade, que é o comportamento do laço do
   * agente.
   */
  async executar<R = unknown>(entrada: {
    orgId: string;
    actorId: string;
    /**
     * `system` quando não há pessoa por trás — a coleta da rotina da pauta lê o
     * Gmail (R0) de madrugada, e o RASTRO não pode dizer que alguém clicou.
     */
    actorType?: ActorType;
    capabilityId: string;
    args: Record<string, unknown>;
    resource?: { type: string; id: string };
    valorCentavos?: number | null;
    /** Só quando a rota recebeu um `x-approval-token` já confirmado. */
    approvalToken?: string;
    /**
     * A marca de conteúdo de fora (RF-G-07), de mão única: quem monta o pedido a
     * partir do que um estranho escreveu (a DM automática responde a um
     * comentário, MD11) marca, e o sinal `fonte_nao_confiavel` sobe um degrau.
     */
    procedenciaExterna?: ProcedenciaExterna;
  }): Promise<R | AcaoRetida> {
    const { capabilityId } = entrada;

    /*
     * Capacidade sem efeito ligado é erro de PROGRAMAÇÃO, não de uso, e por isso
     * estoura antes de qualquer escrita: deixar a porta classificar, registrar e
     * criar uma aprovação para uma ação que nunca vai poder sair produziria uma
     * linha na fila que ninguém consegue executar — e a pessoa só descobriria ao
     * confirmar.
     */
    if (!this.efeitos.tem(capabilityId)) {
      throw new BadRequestException(
        `"${capabilityId}" está classificada no catálogo mas não tem efeito ligado nesta versão. ` +
          'Nada foi enviado.',
      );
    }

    const ctx: ExecCtx = {
      orgId: entrada.orgId,
      actorType: entrada.actorType ?? ActorType.user,
      actorId: entrada.actorId,
      agentSlug: null,
      /*
       * A correlação da REQUISIÇÃO, quando o interceptor abriu uma. É ela que
       * amarra o clique, a proposta e a execução depois da aprovação numa
       * história só. Sem contexto aberto (script de terminal, cron) cunha-se uma.
       */
      correlationId: correlacaoAtual() ?? novaCorrelacao('operador'),
      ...(entrada.procedenciaExterna ? { procedenciaExterna: entrada.procedenciaExterna } : {}),
      /*
       * `capacidadesDeclaradas` fica de fora DE PROPÓSITO. A declaração é o
       * escopo de um AGENTE (RF-N-03); uma pessoa é limitada pela permissão de
       * papel, que o guard da rota já conferiu antes daqui. Mandar uma lista
       * vazia aqui recusaria toda ação humana.
       */
    };

    /*
     * SEM ARGUMENTO DE TIPO EXPLÍCITO, de propósito, e não é preciosismo: a
     * catraca de arquitetura (frente 3) reconhece quem passa pela porta
     * procurando a chamada `this.<prop>.executar(` no código. Escrever
     * `executar<A, R>(` insere os parâmetros de tipo entre o nome e o parêntese,
     * o casamento falha, e este arquivo — que É o caminho legítimo — apareceria
     * como violação. A inferência dá o mesmo tipo.
     */
    const r = await this.gateway.executar(
      {
        capabilityId,
        args: entrada.args,
        ctx,
        approvalToken: entrada.approvalToken,
        resource: entrada.resource,
        valorCentavos: entrada.valorCentavos ?? null,
      },
      (args, contexto) => this.efeitos.executar(capabilityId, args, contexto) as Promise<R>,
    );

    if (r.status === 'executado') return r.resultado;

    if (r.status === 'aguardando_aprovacao') {
      this.log.log(
        `${capabilityId} retida para aprovação (${r.decisao.nivel}) — aprovação ${r.approvalId}`,
      );
      return {
        status: 'aguardando_aprovacao',
        approvalId: r.approvalId,
        resumo: r.resumo,
        expiraEm: r.expiraEm,
        nivel: r.decisao.nivel,
        mensagem:
          `Esta ação é ${r.decisao.nivel} e não sai no clique: ela foi para a fila de aprovações ` +
          'e precisa da confirmação de OUTRA pessoa com alçada suficiente — quem propõe não pode ' +
          'aprovar. Nada foi enviado ainda.',
        precisaDeOutraPessoa: true,
        fila: FILA_DE_APROVACAO,
      };
    }

    if (r.status === 'recusado') {
      /*
       * `preparo` só existe em R5, e é o ponto inteiro daquele degrau: o OS
       * preparou a ação e a devolve para a pessoa executar na origem. Vai no
       * corpo do 403 para a tela poder mostrar o que copiar.
       */
      throw new ForbiddenException({
        statusCode: 403,
        error: 'recusado_pela_politica',
        message: r.motivo,
        ...(r.preparo ? { preparo: r.preparo } : {}),
      });
    }

    throw new BadRequestException(r.mensagem);
  }
}
