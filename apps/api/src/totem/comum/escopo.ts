import type { Prisma } from '@prisma/client';

import type { JwtUser } from '../../auth/current-user.decorator';
import { totemNaoEncontrado } from './modulo';

/*
 * O ESCOPO DE LOJAS DO PAINEL (CONTRATO.md, seção 4).
 *
 * Quem tem `totem.rede` vê todas as lojas da empresa. Os demais (gerente,
 * operador) veem só as lojas a que estão vinculados em `TotemUsuarioLoja`.
 * Todo endpoint que recebe `lojaId` passa por `exigirLojaNoEscopo`, que
 * responde 404 e não 403: 403 confirmaria que a loja existe.
 */

export type TotemEscopoDeLojas = 'todas' | string[];

/** O que do token decide o escopo. */
export type UsuarioDoEscopo = Pick<JwtUser, 'sub' | 'orgId' | 'permissions'>;

type ClienteDoEscopo = Pick<Prisma.TransactionClient, 'totemUsuarioLoja' | 'totemLoja'>;

export async function escopoDeLojas(
  tx: Pick<ClienteDoEscopo, 'totemUsuarioLoja'>,
  user: UsuarioDoEscopo,
): Promise<TotemEscopoDeLojas> {
  if (user.permissions.includes('totem.rede')) return 'todas';
  const vinculos = await tx.totemUsuarioLoja.findMany({
    where: { orgId: user.orgId, userId: user.sub },
    select: { lojaId: true },
  });
  return [...new Set(vinculos.map((v) => v.lojaId))];
}

/**
 * Confere que a loja existe NA EMPRESA do usuário e está no escopo dele. A
 * leitura da loja é o "pai conferido no serviço" do contrato: a FK sozinha
 * aceitaria uma loja de outra empresa.
 */
export async function exigirLojaNoEscopo(tx: ClienteDoEscopo, user: UsuarioDoEscopo, lojaId: string): Promise<void> {
  const escopo = await escopoDeLojas(tx, user);
  if (escopo !== 'todas' && !escopo.includes(lojaId)) throw totemNaoEncontrado();
  const loja = await tx.totemLoja.findFirst({ where: { id: lojaId, orgId: user.orgId }, select: { id: true } });
  if (!loja) throw totemNaoEncontrado();
}
