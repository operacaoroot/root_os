import { ForbiddenException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';

import { escopoDeLojas, exigirLojaNoEscopo, type UsuarioDoEscopo } from '../comum/escopo';

/*
 * O que as rotas de lote, remessa, reposição e etiqueta repetem: a permissão
 * "uma ou outra" e o filtro de lojas.
 *
 * O `PermissionsGuard` exige TODAS as permissões que a rota declara. Remessa e
 * reposição são lidas pelo CD (`totem.lotes`) e pela loja (`totem.reposicao`),
 * então essas rotas declaram `totem.ver` e conferem a alternativa aqui.
 */

/** O banco que as operações recebem: o `PrismaService` no Nest, um `PrismaClient` no teste. */
export type BancoDoLote = PrismaClient;
export type TransacaoDoLote = Prisma.TransactionClient;

export function exigirAlgumaPermissao(user: UsuarioDoEscopo, permissoes: readonly string[]): void {
  if (!permissoes.some((p) => user.permissions.includes(p))) {
    throw new ForbiddenException('Seu acesso não permite esta operação.');
  }
}

/**
 * As lojas que a consulta pode ver. Com `lojaId`, confere o escopo (404 fora
 * dele) e devolve só ela; sem, devolve o escopo inteiro do usuário.
 */
export async function lojasDaConsulta(
  tx: Pick<TransacaoDoLote, 'totemUsuarioLoja' | 'totemLoja'>,
  user: UsuarioDoEscopo,
  lojaId?: string,
): Promise<'todas' | string[]> {
  if (lojaId) {
    await exigirLojaNoEscopo(tx, user, lojaId);
    return [lojaId];
  }
  return escopoDeLojas(tx, user);
}

/** O filtro Prisma de `lojaId` para o resultado de `lojasDaConsulta`. */
export function filtroDeLoja(lojas: 'todas' | string[]): { lojaId?: { in: string[] } } {
  return lojas === 'todas' ? {} : { lojaId: { in: lojas } };
}

/** `AAAA-MM-DD` ou nulo. */
export function diaOuNulo(data: Date | null | undefined): string | null {
  return data ? data.toISOString().slice(0, 10) : null;
}
