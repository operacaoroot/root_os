import type { Prisma } from '@prisma/client';

import { cardIdDoLead } from './card-da-implantacao';

type Banco = Pick<Prisma.TransactionClient, 'onboardingTrilho'>;

/** A ficha aponta o trilho e o cartão de implantação canônico do mesmo lead. */
export function trilhoDaSala<S extends Prisma.OnboardingTrilhoSelect>(
  db: Banco,
  orgId: string,
  leadId: string,
  ficha: { trilhoId: string | null; cardId: string | null; partnerId: string | null } | null,
  select: S,
) {
  if (!ficha?.trilhoId || !ficha.partnerId || ficha.cardId !== cardIdDoLead(orgId, leadId)) return null;
  return db.onboardingTrilho.findFirst({
    where: {
      orgId,
      id: ficha.trilhoId,
      cardId: ficha.cardId,
      card: {
        orgId,
        clienteId: ficha.partnerId,
        cliente: { orgId, isCliente: true, ativo: true, principalId: null },
        archived: false,
        excluidaEm: null,
        OR: [{ leadId }, { leadId: null }],
      },
    },
    select,
  });
}
