import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ActorType, ApprovalState, RiskLevel, ToolCallStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { comContexto, correlacaoAtual, exigirTenant } from '../common/contexto-execucao';
import { ContextoDoEfeito, EfeitosRegistry } from './efeitos.registry';
import { EventLogService } from './event-log.service';

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
 */
@Injectable()
export class AcoesService {
  private readonly log = new Logger('Acoes');

  constructor(
    private readonly prisma: PrismaService,
    private readonly efeitos: EfeitosRegistry,
    private readonly eventos: EventLogService,
  ) {}

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

    if (!this.efeitos.tem(ap.capabilityId)) {
      return {
        status: 'sem_efeito',
        motivo: `"${ap.capabilityId}" está classificada e aprovada, mas o efeito não está ligado nesta versão.`,
      };
    }

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
      // Os argumentos vêm do REGISTRO da proposta, não da requisição.
      const args = (chamada.args ?? {}) as Record<string, unknown>;
      const resultado = await comContexto({ ...ctxEfeito, origem: 'aprovacao' }, () =>
        this.efeitos.executar(capabilityId, args, ctxEfeito),
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
        payload: {
          approvalId,
          aprovadoPor: ap.aprovadoPorId,
          duracaoMs: Date.now() - inicio,
          ...(correlacaoDaConfirmacao ? { correlacaoDaConfirmacao } : {}),
        },
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
      });
      throw e;
    }
  }
}
