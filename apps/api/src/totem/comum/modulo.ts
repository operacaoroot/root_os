import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/*
 * O GATE DE MÓDULO DAS ROTAS PÚBLICAS DO TOTEM.
 *
 * O `ModulosInterceptor` deixa requisição anônima passar (ela não tem empresa
 * quando chega). O quiosque e o QR da etiqueta são anônimos, então a conferência
 * de que a empresa contratou o Totem acontece aqui, no serviço, depois de o
 * resolver de `common/tenant-publico.ts` descobrir a empresa.
 *
 * A resposta é a MESMA 404 de "não existe": distinguir "existe, mas o módulo
 * está desligado" contaria a quem sonda códigos que acertou um.
 */

/** O corpo único da 404 pública do Totem. Toda rota pública usa este. */
export const TOTEM_NAO_ENCONTRADO = 'Não encontramos o que você procurou.';

export function totemNaoEncontrado(): NotFoundException {
  return new NotFoundException(TOTEM_NAO_ENCONTRADO);
}

type ClienteDoModulo = Pick<Prisma.TransactionClient, 'org'>;

/** Lança 404 quando a empresa não existe, está inativa ou não tem o módulo `totem`. */
export async function exigirModuloTotem(tx: ClienteDoModulo, orgId: string): Promise<void> {
  const org = await tx.org.findUnique({ where: { id: orgId }, select: { modulos: true, isActive: true } });
  if (!org || !org.isActive || !org.modulos.includes('totem')) throw totemNaoEncontrado();
}
