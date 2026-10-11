import type { Prisma } from '@prisma/client';
import type { TotemGestaoEventosPagina, TotemGestaoEventosQuery } from '@mktos/shared';

import { escopoDeLojas, exigirLojaNoEscopo, type UsuarioDoEscopo } from '../comum/escopo';
import { totemGestaoInicioDoDia, totemGestaoSomarDias } from './regras';

/*
 * O registro de uso dos totens. `TotemEvento` não tem relação com loja,
 * aparelho nem produto (ele chega aos milhares e não pode travar exclusão), então
 * os nomes saem de três consultas à parte, todas presas ao `orgId`.
 */

export type ClienteDosEventos = Pick<
  Prisma.TransactionClient,
  'totemEvento' | 'totemLoja' | 'totemDispositivo' | 'totemProduto' | 'totemUsuarioLoja'
>;

/** Filtro de datas em dias de São Paulo: `ate` inclui o dia inteiro. */
export function totemGestaoPeriodoDosEventos(
  de: string | undefined,
  ate: string | undefined,
): Prisma.DateTimeFilter | undefined {
  if (!de && !ate) return undefined;
  return {
    ...(de ? { gte: totemGestaoInicioDoDia(de) } : {}),
    ...(ate ? { lt: totemGestaoSomarDias(totemGestaoInicioDoDia(ate), 1) } : {}),
  };
}

function idsPresentes(valores: (string | null)[]): string[] {
  return [...new Set(valores.filter((v): v is string => !!v))];
}

export async function totemGestaoListarEventos(
  tx: ClienteDosEventos,
  user: UsuarioDoEscopo,
  q: TotemGestaoEventosQuery,
): Promise<TotemGestaoEventosPagina> {
  let filtroDeLoja: Prisma.TotemEventoWhereInput;
  if (q.lojaId) {
    await exigirLojaNoEscopo(tx, user, q.lojaId);
    filtroDeLoja = { lojaId: q.lojaId };
  } else {
    const escopo = await escopoDeLojas(tx, user);
    filtroDeLoja = escopo === 'todas' ? {} : { lojaId: { in: escopo } };
  }
  const periodo = totemGestaoPeriodoDosEventos(q.de, q.ate);
  const where: Prisma.TotemEventoWhereInput = {
    orgId: user.orgId,
    ...filtroDeLoja,
    ...(q.tipo ? { tipo: q.tipo } : {}),
    ...(periodo ? { ocorridoEm: periodo } : {}),
  };

  const [total, linhas] = await Promise.all([
    tx.totemEvento.count({ where }),
    tx.totemEvento.findMany({
      where,
      orderBy: [{ ocorridoEm: 'desc' }, { id: 'asc' }],
      skip: (q.pagina - 1) * q.porPagina,
      take: q.porPagina,
    }),
  ]);

  const lojaIds = idsPresentes(linhas.map((l) => l.lojaId));
  const dispositivoIds = idsPresentes(linhas.map((l) => l.dispositivoId));
  const produtoIds = idsPresentes(linhas.map((l) => l.produtoId));
  const [lojas, dispositivos, produtos] = await Promise.all([
    lojaIds.length
      ? tx.totemLoja.findMany({ where: { orgId: user.orgId, id: { in: lojaIds } }, select: { id: true, nome: true } })
      : [],
    dispositivoIds.length
      ? tx.totemDispositivo.findMany({
          where: { orgId: user.orgId, id: { in: dispositivoIds } },
          select: { id: true, nome: true },
        })
      : [],
    produtoIds.length
      ? tx.totemProduto.findMany({
          where: { orgId: user.orgId, id: { in: produtoIds } },
          select: { id: true, nome: true },
        })
      : [],
  ]);
  const nomeDaLoja = new Map(lojas.map((l) => [l.id, l.nome]));
  const nomeDoDispositivo = new Map(dispositivos.map((d) => [d.id, d.nome]));
  const nomeDoProduto = new Map(produtos.map((p) => [p.id, p.nome]));

  return {
    itens: linhas.map((l) => ({
      id: l.id,
      tipo: l.tipo,
      lojaId: l.lojaId,
      lojaNome: l.lojaId ? (nomeDaLoja.get(l.lojaId) ?? null) : null,
      dispositivoId: l.dispositivoId,
      dispositivoNome: l.dispositivoId ? (nomeDoDispositivo.get(l.dispositivoId) ?? null) : null,
      produtoId: l.produtoId,
      produtoNome: l.produtoId ? (nomeDoProduto.get(l.produtoId) ?? null) : null,
      termo: l.termo,
      ocorridoEm: l.ocorridoEm.toISOString(),
    })),
    total,
    pagina: q.pagina,
    porPagina: q.porPagina,
  };
}
