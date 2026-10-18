import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { contextoAtual } from '../common/contexto-execucao';

export function leitorDoContexto(): string | null {
  const c = contextoAtual();
  return c?.actorType === 'user' ? c.actorId ?? null : null;
}

/** Sem identidade declarada, somente fontes abertas da empresa entram na leitura. */
export function filtroDeLeitura(solicitanteId?: string | null): Prisma.ContextItemWhereInput {
  return { OR: [{ acessoRestrito: false }, ...(solicitanteId
    ? [{ acessoRestrito: true, leitores: { has: solicitanteId } }] : [])] };
}

export function podeLerFonte(item: { acessoRestrito?: boolean; leitores?: string[] }, solicitanteId?: string | null): boolean {
  return !item.acessoRestrito || !!solicitanteId && (item.leitores ?? []).includes(solicitanteId);
}

export async function exigirAcessoAtual(
  db: Pick<Prisma.TransactionClient, 'user'>,
  orgId: string, solicitanteId: string | null | undefined, permissoes: string[],
): Promise<void> {
  if (!solicitanteId || !orgId) throw new ForbiddenException('Acesso insuficiente.');
  const pessoa = await db.user.findFirst({
    where: { id: solicitanteId, orgId, isActive: true },
    select: { roles: { where: { orgId }, select: { permissions: { select: { key: true } } } } },
  });
  const atuais = new Set(pessoa?.roles.flatMap((r) => r.permissions.map((p) => p.key)) ?? []);
  if (!pessoa || !permissoes.every((p) => atuais.has(p))) throw new ForbiddenException('Acesso insuficiente.');
}

export async function leitorAutorizado(db: Pick<Prisma.TransactionClient, 'user'>, orgId: string, solicitanteId?: string | null): Promise<string | null> {
  if (!solicitanteId) return null;
  try { await exigirAcessoAtual(db, orgId, solicitanteId, ['obsidian.ver']); return solicitanteId; }
  catch (e) { if (e instanceof ForbiddenException) return null; throw e; }
}
