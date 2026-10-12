import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { totemStatusEfetivoDoCupom } from '@mktos/shared';

import type { TotemEscopoDeLojas } from '../comum/escopo';

/*
 * O CUPOM NO CAIXA E A CAMPANHA NO ESCOPO, sem Nest.
 *
 * A campanha guarda as lojas em que vale (`lojaIds`, vazia = todas). Daí saem
 * três perguntas, cada uma numa função:
 *   · o usuário VÊ a campanha (e os cupons dela)? Basta uma loja em comum;
 *   · o usuário pode MEXER na campanha? Todas as lojas dela têm de estar no
 *     escopo dele, e "todas as lojas" só para quem tem a rede inteira;
 *   · o cupom VALE nesta loja?
 */

type Tx = Prisma.TransactionClient;

export const MENSAGEM_CUPOM_NAO_ENCONTRADO = 'Não encontramos um cupom com este código.';

export function campanhaVisivel(escopo: TotemEscopoDeLojas, lojaIds: string[]): boolean {
  return escopo === 'todas' || lojaIds.length === 0 || lojaIds.some((id) => escopo.includes(id));
}

export function campanhaGerenciavel(escopo: TotemEscopoDeLojas, lojaIds: string[]): boolean {
  if (escopo === 'todas') return true;
  return lojaIds.length > 0 && lojaIds.every((id) => escopo.includes(id));
}

export function campanhaValeNaLoja(lojaIds: string[], lojaId: string): boolean {
  return lojaIds.length === 0 || lojaIds.includes(lojaId);
}

/** DD/MM/AAAA no fuso de Brasília. */
export function dataBR(d: Date): string {
  return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function recusaDoStatus(status: string, cupom: { validoAte: Date; usadoEm: Date | null }): ConflictException {
  if (status === 'usado') {
    return new ConflictException(
      cupom.usadoEm ? `Este cupom já foi usado em ${dataBR(cupom.usadoEm)}.` : 'Este cupom já foi usado.',
    );
  }
  if (status === 'expirado') return new ConflictException(`Este cupom venceu em ${dataBR(cupom.validoAte)} e não vale mais.`);
  return new ConflictException('Este cupom foi cancelado e não vale mais.');
}

export interface PedidoDeBaixa {
  orgId: string;
  /** Já normalizado (`TotemCodigoCupomSchema`). */
  codigo: string;
  lojaId: string;
  usuarioId: string;
  escopo: TotemEscopoDeLojas;
  agora?: Date;
}

/**
 * Dá baixa no cupom na loja do caixa. A loja já foi conferida contra o escopo
 * por quem chama (`exigirLojaNoEscopo`). A troca de status é condicional
 * (`status = 'emitido'` e ainda no prazo), então dois caixas com o mesmo
 * código ao mesmo tempo não dão baixa duas vezes.
 */
export async function darBaixaNoCupom(tx: Pick<Tx, 'totemCupom'>, p: PedidoDeBaixa): Promise<void> {
  const agora = p.agora ?? new Date();
  const cupom = await tx.totemCupom.findUnique({
    where: { orgId_codigo: { orgId: p.orgId, codigo: p.codigo } },
    select: { id: true, status: true, validoAte: true, usadoEm: true, campanha: { select: { lojaIds: true } } },
  });
  if (!cupom || !campanhaVisivel(p.escopo, cupom.campanha.lojaIds)) {
    throw new NotFoundException(MENSAGEM_CUPOM_NAO_ENCONTRADO);
  }
  const status = totemStatusEfetivoDoCupom(cupom.status, cupom.validoAte, agora);
  if (status !== 'emitido') throw recusaDoStatus(status, cupom);
  if (!campanhaValeNaLoja(cupom.campanha.lojaIds, p.lojaId)) {
    throw new ConflictException('Este cupom não vale nesta loja.');
  }
  const r = await tx.totemCupom.updateMany({
    where: { id: cupom.id, orgId: p.orgId, status: 'emitido', validoAte: { gte: agora } },
    data: { status: 'usado', usadoEm: agora, usadoLojaId: p.lojaId, usadoPor: p.usuarioId },
  });
  if (r.count === 0) throw new ConflictException('Este cupom acabou de ser usado em outro caixa.');
}

/**
 * Cancela um cupom que ainda vale. Usado, vencido ou já cancelado responde 409.
 * Cancelar é mexer na campanha: quem só vê a campanha consulta e dá baixa, mas
 * não cancela.
 */
export async function cancelarCupom(
  tx: Pick<Tx, 'totemCupom'>,
  p: Omit<PedidoDeBaixa, 'lojaId' | 'usuarioId'>,
): Promise<void> {
  const agora = p.agora ?? new Date();
  const cupom = await tx.totemCupom.findUnique({
    where: { orgId_codigo: { orgId: p.orgId, codigo: p.codigo } },
    select: { id: true, status: true, validoAte: true, usadoEm: true, campanha: { select: { lojaIds: true } } },
  });
  if (!cupom || !campanhaVisivel(p.escopo, cupom.campanha.lojaIds)) {
    throw new NotFoundException(MENSAGEM_CUPOM_NAO_ENCONTRADO);
  }
  if (!campanhaGerenciavel(p.escopo, cupom.campanha.lojaIds)) {
    throw new ForbiddenException('Só quem gerencia a campanha pode cancelar um cupom dela.');
  }
  const status = totemStatusEfetivoDoCupom(cupom.status, cupom.validoAte, agora);
  if (status !== 'emitido') throw recusaDoStatus(status, cupom);
  const r = await tx.totemCupom.updateMany({
    where: { id: cupom.id, orgId: p.orgId, status: 'emitido' },
    data: { status: 'cancelado' },
  });
  if (r.count === 0) throw new ConflictException('Este cupom acabou de mudar. Consulte de novo.');
}
