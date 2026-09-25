import { ConflictException, ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { ApprovalState, LoteEstado } from '@prisma/client';
import { CAPACIDADE_DE_APROVAR_A_SEMANA } from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { EfeitosRegistry, type ContextoDoEfeito } from '../gateway/efeitos.registry';
import { PortaDoOperador, type AcaoRetida } from '../gateway/porta-do-operador.service';
import { LotesService } from './lotes.service';

/*
 * O PEDIDO DE ASSINATURA DO LOTE e o EFEITO que o ativa (MD7).
 *
 * Separado de `LotesService` por uma razão de fiação: este serviço fala com a
 * PORTA (o pedido vai a `PortaDoOperador`, que o retém como R4 até outra pessoa
 * assinar), e a porta fala com `LotesService` (o consumo contado). Juntos, os
 * dois fechariam um ciclo de injeção.
 *
 * As capacidades `modo: lote` do catálogo que têm efeito ligado aqui. Hoje uma
 * só; o YouTube (MD10) e a DM (MD11) entram como ITENS do mesmo lote, não como
 * lotes novos.
 */
export const CAPACIDADES_DE_LOTE = [CAPACIDADE_DE_APROVAR_A_SEMANA] as const;

const ESTADOS_QUE_PEDEM: readonly LoteEstado[] = [LoteEstado.proposta, LoteEstado.aguardando];

@Injectable()
export class AssinaturaDeLoteService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lotes: LotesService,
    private readonly efeitos: EfeitosRegistry,
    private readonly porta: PortaDoOperador,
  ) {}

  onModuleInit(): void {
    this.efeitos.registrar(
      Object.fromEntries(
        CAPACIDADES_DE_LOTE.map((id) => [
          id,
          (a: Record<string, unknown>, org: string, ctx: ContextoDoEfeito) => this.lotes.ativar(a, org, ctx),
        ]),
      ),
      'AssinaturaDeLoteService',
    );
  }

  /**
   * Entrega o lote à porta para a assinatura. R4 (o alcance da lista): a porta
   * devolve `aguardando_aprovacao` e o lote passa a `aguardando` com a
   * aprovação nova. "Pedir de novo" (a anterior venceu ou foi recusada) cria
   * outra aprovação com o MESMO hash — a lista não é remontada.
   *
   * Quem pede é quem montou: é o que faz a trava "quem propôs não assina" da
   * fila valer para o lote inteiro antes de qualquer aprovação ser queimada.
   */
  async pedirAssinatura(orgId: string, loteId: string, actorId: string): Promise<AcaoRetida | unknown> {
    const { args, lote } = await this.lotes.argsDaAssinatura(orgId, loteId);
    if (lote.propostoPorId !== actorId) {
      throw new ForbiddenException('Quem pede a assinatura do lote é quem o montou.');
    }
    if (!ESTADOS_QUE_PEDEM.includes(lote.estado)) {
      throw new ConflictException(`O lote está ${lote.estado}: não há o que assinar.`);
    }
    // O estado gravado não sabe do prazo (ninguém roda o expirador): sem esta
    // conferência a titular gastaria senha e motivo num lote que `ativar` recusa.
    if (lote.validaAte.getTime() <= Date.now()) {
      throw new ConflictException('O prazo do lote passou: monte outro. Nada foi para a fila.');
    }
    if (lote.estado === LoteEstado.aguardando && lote.approvalId) {
      const ap = await this.prisma.approval.findFirst({
        where: { id: lote.approvalId, orgId },
        select: { status: true, expiraEm: true },
      });
      // Confirmada e vencida não se consome mais (`consumir` confere o prazo):
      // não segura o lote.
      const viva =
        !!ap &&
        (ap.status === ApprovalState.pendente || ap.status === ApprovalState.confirmada) &&
        ap.expiraEm.getTime() > Date.now();
      if (viva) throw new ConflictException('Este lote já está na fila, esperando a assinatura de outra pessoa.');
    }

    const r = await this.porta.executar({
      orgId,
      actorId,
      capabilityId: lote.capabilityId,
      args,
      resource: { type: lote.capabilityId, id: loteId },
    });
    if (ehRetida(r)) {
      const marcou = await this.lotes.marcarAguardando(orgId, loteId, r.approvalId, lote.estado, lote.approvalId);
      if (!marcou) {
        throw new ConflictException(
          'O lote mudou enquanto o pedido saía (outro pedido o levou): recarregue. Esta aprovação não ativa o lote.',
        );
      }
    }
    return r;
  }
}

function ehRetida(r: unknown): r is AcaoRetida {
  return !!r && typeof r === 'object' && (r as { status?: unknown }).status === 'aguardando_aprovacao';
}
