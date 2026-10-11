import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  TOTEM_TAMANHO_CODIGO_ETIQUETA,
  type TotemEtiquetaDoPainel,
  type TotemEtiquetasNovas,
} from '@mktos/shared';

import { exigirLojaNoEscopo, type UsuarioDoEscopo } from '../comum/escopo';
import { totemNaoEncontrado } from '../comum/modulo';
import { gerarCodigo } from '../comum/segredos';
import { filtroDeLoja, lojasDaConsulta, type BancoDoLote } from './acesso';
import { produtoDaEmpresa } from './lotes';

/*
 * Etiquetas com QR. Cada etiqueta é um código aleatório de 10 caracteres
 * (único no banco inteiro, não só na empresa: é ele que acha a empresa na rota
 * pública). Etiqueta sem lote é a da gôndola, e o QR mostra o lote vigente da
 * loja; com lote, é a do pacote e mostra aquele lote.
 */

const CAMPOS_DA_ETIQUETA = {
  id: true,
  codigo: true,
  lojaId: true,
  produtoId: true,
  loteId: true,
  impressaEm: true,
  revogadaEm: true,
  criadoEm: true,
  loja: { select: { nome: true } },
  produto: { select: { codigo: true, nome: true } },
  lote: { select: { codigo: true, validadeEm: true } },
} satisfies Prisma.TotemEtiquetaSelect;

type EtiquetaDoBanco = Prisma.TotemEtiquetaGetPayload<{ select: typeof CAMPOS_DA_ETIQUETA }>;

export function paraEtiquetaDoPainel(e: EtiquetaDoBanco): TotemEtiquetaDoPainel {
  return {
    id: e.id,
    codigo: e.codigo,
    lojaId: e.lojaId,
    lojaNome: e.loja.nome,
    produtoId: e.produtoId,
    produtoCodigo: e.produto.codigo,
    produtoNome: e.produto.nome,
    loteId: e.loteId,
    loteCodigo: e.lote?.codigo ?? null,
    validadeEm: e.lote ? e.lote.validadeEm.toISOString().slice(0, 10) : null,
    impressaEm: e.impressaEm ? e.impressaEm.toISOString() : null,
    revogadaEm: e.revogadaEm ? e.revogadaEm.toISOString() : null,
    criadoEm: e.criadoEm.toISOString(),
  };
}

export async function listarEtiquetas(
  db: BancoDoLote,
  user: UsuarioDoEscopo,
  filtro: { lojaId?: string; produtoId?: string; ids?: string[]; revogadas?: '0' | '1' },
): Promise<TotemEtiquetaDoPainel[]> {
  const lojas = await lojasDaConsulta(db, user, filtro.lojaId);
  const etiquetas = await db.totemEtiqueta.findMany({
    where: {
      orgId: user.orgId,
      ...filtroDeLoja(lojas),
      ...(filtro.produtoId ? { produtoId: filtro.produtoId } : {}),
      ...(filtro.ids ? { id: { in: filtro.ids } } : {}),
      ...(filtro.revogadas === '1' ? {} : { revogadaEm: null }),
    },
    orderBy: [{ criadoEm: 'desc' }, { codigo: 'asc' }],
    take: 500,
    select: CAMPOS_DA_ETIQUETA,
  });
  return etiquetas.map(paraEtiquetaDoPainel);
}

/**
 * Gera `quantidade` códigos novos. A colisão é improvável (32^10 códigos), mas
 * o índice único é global e a etiqueta de outra empresa não aparece sob RLS:
 * por isso a inserção pula duplicata e sorteia de novo o que faltar.
 */
export async function gerarEtiquetas(
  db: BancoDoLote,
  user: UsuarioDoEscopo,
  entrada: TotemEtiquetasNovas,
  sortear: (n: number) => string = gerarCodigo,
): Promise<TotemEtiquetaDoPainel[]> {
  const etiquetas = await db.$transaction(async (tx) => {
    await exigirLojaNoEscopo(tx, user, entrada.lojaId);
    const produto = await produtoDaEmpresa(tx, user.orgId, entrada.produtoId);
    if (entrada.loteId) {
      const lote = await tx.totemLote.findFirst({
        where: { id: entrada.loteId, orgId: user.orgId },
        select: { produtoId: true },
      });
      if (!lote) throw totemNaoEncontrado();
      if (lote.produtoId !== produto.id) throw new BadRequestException('Esse lote é de outro produto.');
    }

    const gerados: string[] = [];
    for (let tentativa = 0; tentativa < 5 && gerados.length < entrada.quantidade; tentativa += 1) {
      const novos = new Set<string>();
      while (novos.size < entrada.quantidade - gerados.length) novos.add(sortear(TOTEM_TAMANHO_CODIGO_ETIQUETA));
      const existentes = await tx.totemEtiqueta.findMany({
        where: { codigo: { in: [...novos] } },
        select: { codigo: true },
      });
      for (const e of existentes) novos.delete(e.codigo);
      if (novos.size === 0) continue;
      await tx.totemEtiqueta.createMany({
        data: [...novos].map((codigo) => ({
          orgId: user.orgId,
          lojaId: entrada.lojaId,
          produtoId: produto.id,
          loteId: entrada.loteId ?? null,
          codigo,
        })),
        skipDuplicates: true,
      });
      const gravados = await tx.totemEtiqueta.findMany({
        where: { orgId: user.orgId, codigo: { in: [...novos] } },
        select: { codigo: true },
      });
      gerados.push(...gravados.map((g) => g.codigo));
    }
    if (gerados.length < entrada.quantidade) {
      throw new InternalServerErrorException('Não foi possível gerar códigos únicos. Tente de novo.');
    }
    return tx.totemEtiqueta.findMany({
      where: { orgId: user.orgId, codigo: { in: gerados } },
      orderBy: { codigo: 'asc' },
      select: CAMPOS_DA_ETIQUETA,
    });
  });
  return etiquetas.map(paraEtiquetaDoPainel);
}

export async function marcarEtiquetasImpressas(
  db: BancoDoLote,
  user: UsuarioDoEscopo,
  ids: string[],
  agora = new Date(),
): Promise<{ atualizadas: number }> {
  const lojas = await lojasDaConsulta(db, user);
  const { count } = await db.totemEtiqueta.updateMany({
    where: { orgId: user.orgId, id: { in: ids }, revogadaEm: null, ...filtroDeLoja(lojas) },
    data: { impressaEm: agora },
  });
  return { atualizadas: count };
}

export async function revogarEtiqueta(
  db: BancoDoLote,
  user: UsuarioDoEscopo,
  etiquetaId: string,
  agora = new Date(),
): Promise<TotemEtiquetaDoPainel> {
  const etiqueta = await db.$transaction(async (tx) => {
    const atual = await tx.totemEtiqueta.findFirst({
      where: { id: etiquetaId, orgId: user.orgId },
      select: { id: true, lojaId: true, revogadaEm: true },
    });
    if (!atual) throw totemNaoEncontrado();
    await exigirLojaNoEscopo(tx, user, atual.lojaId);
    if (!atual.revogadaEm) {
      await tx.totemEtiqueta.update({ where: { id: atual.id }, data: { revogadaEm: agora } });
    }
    return tx.totemEtiqueta.findUniqueOrThrow({ where: { id: atual.id }, select: CAMPOS_DA_ETIQUETA });
  });
  return paraEtiquetaDoPainel(etiqueta);
}
