import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ActorType, ApprovalState, RiskLevel, ToolCallStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EfeitosRegistry } from './efeitos.registry';
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
    const ap = await this.prisma.approval.findFirst({ where: { id: approvalId, orgId } });
    if (!ap) throw new NotFoundException('Aprovação não encontrada');

    // Aprovação sem ação retida é a superfície antiga (as 5 rotas com
    // @SensitiveWrite): lá quem executa é a própria rota, com o token.
    if (!ap.toolCallId || !ap.capabilityId) return { status: 'nada_a_executar' };

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

    const inicio = Date.now();
    try {
      // Os argumentos vêm do REGISTRO da proposta, não da requisição.
      const args = (chamada.args ?? {}) as Record<string, unknown>;
      const resultado = await this.efeitos.executar(ap.capabilityId, args, orgId);

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
        correlationId: chamada.correlationId,
        payload: { approvalId, aprovadoPor: ap.aprovadoPorId, duracaoMs: Date.now() - inicio },
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
        capabilityId: ap.capabilityId,
        toolCallId: chamada.id,
        correlationId: chamada.correlationId,
        payload: { approvalId, erro: erro.slice(0, 300) },
      });
      throw e;
    }
  }
}
