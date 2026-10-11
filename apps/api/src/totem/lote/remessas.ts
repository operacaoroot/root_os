import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  TotemRemessaDoPainel,
  TotemRemessaNova,
  TotemRemessaRecebimento,
  TotemStatusRemessa,
} from '@mktos/shared';

import { exigirLojaNoEscopo, type UsuarioDoEscopo } from '../comum/escopo';
import { totemNaoEncontrado } from '../comum/modulo';
import {
  exigirAlgumaPermissao,
  filtroDeLoja,
  lojasDaConsulta,
  type BancoDoLote,
  type TransacaoDoLote,
} from './acesso';

/*
 * Remessas: o CD (`totem.lotes`) manda lotes para uma loja; a loja
 * (`totem.reposicao`) confirma o recebimento na loja dela. Enquanto a remessa
 * está `enviada`, os lotes dela são o lote vigente presumido da loja.
 */

const CAMPOS_DA_REMESSA = {
  id: true,
  lojaId: true,
  status: true,
  enviadaEm: true,
  recebidaEm: true,
  observacao: true,
  loja: { select: { nome: true } },
  itens: {
    orderBy: { criadoEm: 'asc' },
    select: {
      id: true,
      produtoId: true,
      loteId: true,
      quantidade: true,
      unidade: true,
      produto: { select: { codigo: true, nome: true } },
      lote: { select: { codigo: true, validadeEm: true } },
    },
  },
} satisfies Prisma.TotemRemessaSelect;

type RemessaDoBanco = Prisma.TotemRemessaGetPayload<{ select: typeof CAMPOS_DA_REMESSA }>;

function statusDa(s: string): TotemStatusRemessa {
  return s === 'recebida' || s === 'cancelada' ? s : 'enviada';
}

export function paraRemessaDoPainel(r: RemessaDoBanco): TotemRemessaDoPainel {
  return {
    id: r.id,
    lojaId: r.lojaId,
    lojaNome: r.loja.nome,
    status: statusDa(r.status),
    enviadaEm: r.enviadaEm.toISOString(),
    recebidaEm: r.recebidaEm ? r.recebidaEm.toISOString() : null,
    observacao: r.observacao,
    itens: r.itens.map((i) => ({
      id: i.id,
      produtoId: i.produtoId,
      produtoCodigo: i.produto.codigo,
      produtoNome: i.produto.nome,
      loteId: i.loteId,
      loteCodigo: i.lote.codigo,
      validadeEm: i.lote.validadeEm.toISOString().slice(0, 10),
      quantidade: i.quantidade === null ? null : Number(i.quantidade.toString()),
      unidade: i.unidade,
    })),
  };
}

export async function listarRemessas(
  db: BancoDoLote,
  user: UsuarioDoEscopo,
  filtro: { lojaId?: string; status?: TotemStatusRemessa },
): Promise<TotemRemessaDoPainel[]> {
  exigirAlgumaPermissao(user, ['totem.lotes', 'totem.reposicao']);
  const lojas = await lojasDaConsulta(db, user, filtro.lojaId);
  const remessas = await db.totemRemessa.findMany({
    where: { orgId: user.orgId, ...filtroDeLoja(lojas), ...(filtro.status ? { status: filtro.status } : {}) },
    orderBy: [{ enviadaEm: 'desc' }, { id: 'desc' }],
    take: 100,
    select: CAMPOS_DA_REMESSA,
  });
  return remessas.map(paraRemessaDoPainel);
}

export async function criarRemessa(
  db: BancoDoLote,
  user: UsuarioDoEscopo,
  entrada: TotemRemessaNova,
): Promise<TotemRemessaDoPainel> {
  const remessa = await db.$transaction(async (tx) => {
    await exigirLojaNoEscopo(tx, user, entrada.lojaId);
    const loteIds = entrada.itens.map((i) => i.loteId);
    const lotes = await tx.totemLote.findMany({
      where: { id: { in: loteIds }, orgId: user.orgId },
      select: { id: true, produtoId: true },
    });
    if (lotes.length !== new Set(loteIds).size) throw totemNaoEncontrado();
    const produtoDoLote = new Map(lotes.map((l) => [l.id, l.produtoId]));

    const criada = await tx.totemRemessa.create({
      data: {
        orgId: user.orgId,
        lojaId: entrada.lojaId,
        observacao: entrada.observacao ?? null,
        criadoPor: user.sub,
      },
      select: { id: true },
    });
    await tx.totemRemessaItem.createMany({
      data: entrada.itens.map((i) => ({
        orgId: user.orgId,
        remessaId: criada.id,
        loteId: i.loteId,
        produtoId: produtoDoLote.get(i.loteId) as string,
        quantidade: i.quantidade ?? null,
        unidade: i.unidade ?? null,
      })),
    });
    return tx.totemRemessa.findUniqueOrThrow({ where: { id: criada.id }, select: CAMPOS_DA_REMESSA });
  });
  return paraRemessaDoPainel(remessa);
}

/**
 * Lê a remessa pelo id DENTRO da empresa e confere a loja dela no escopo de
 * quem pede. As duas falhas são a mesma 404: o gerente da loja 1 não fica
 * sabendo que a remessa da loja 2 existe.
 */
async function remessaNoEscopo(
  tx: TransacaoDoLote,
  user: UsuarioDoEscopo,
  remessaId: string,
): Promise<{ id: string; lojaId: string; status: string }> {
  const remessa = await tx.totemRemessa.findFirst({
    where: { id: remessaId, orgId: user.orgId },
    select: { id: true, lojaId: true, status: true },
  });
  if (!remessa) throw totemNaoEncontrado();
  await exigirLojaNoEscopo(tx, user, remessa.lojaId);
  return remessa;
}

function conflitoDeStatus(status: string): ConflictException {
  return new ConflictException(
    status === 'cancelada' ? 'Esta remessa foi cancelada.' : 'Esta remessa já foi recebida.',
  );
}

export async function receberRemessa(
  db: BancoDoLote,
  user: UsuarioDoEscopo,
  remessaId: string,
  entrada: TotemRemessaRecebimento,
  agora = new Date(),
): Promise<TotemRemessaDoPainel> {
  const remessa = await db.$transaction(async (tx) => {
    const atual = await remessaNoEscopo(tx, user, remessaId);
    if (atual.status !== 'enviada') throw conflitoDeStatus(atual.status);
    const { count } = await tx.totemRemessa.updateMany({
      where: { id: atual.id, orgId: user.orgId, status: 'enviada' },
      data: { status: 'recebida', recebidaEm: agora, recebidaPor: user.sub },
    });
    if (count === 0) throw conflitoDeStatus('recebida');

    if (entrada.registrarReposicao) {
      const itens = await tx.totemRemessaItem.findMany({
        where: { remessaId: atual.id, orgId: user.orgId },
        select: { produtoId: true, loteId: true, lote: { select: { validadeEm: true } } },
        orderBy: { lote: { validadeEm: 'asc' } },
      });
      const porProduto = new Map<string, string>();
      for (const i of itens) if (!porProduto.has(i.produtoId)) porProduto.set(i.produtoId, i.loteId);
      await tx.totemReposicao.createMany({
        data: [...porProduto].map(([produtoId, loteId]) => ({
          orgId: user.orgId,
          lojaId: atual.lojaId,
          produtoId,
          loteId,
          repostoEm: agora,
          origem: 'remessa',
          registradoPor: user.sub,
        })),
      });
    }
    return tx.totemRemessa.findUniqueOrThrow({ where: { id: atual.id }, select: CAMPOS_DA_REMESSA });
  });
  return paraRemessaDoPainel(remessa);
}

export async function cancelarRemessa(
  db: BancoDoLote,
  user: UsuarioDoEscopo,
  remessaId: string,
): Promise<TotemRemessaDoPainel> {
  const remessa = await db.$transaction(async (tx) => {
    const atual = await remessaNoEscopo(tx, user, remessaId);
    if (atual.status !== 'enviada') throw conflitoDeStatus(atual.status);
    const { count } = await tx.totemRemessa.updateMany({
      where: { id: atual.id, orgId: user.orgId, status: 'enviada' },
      data: { status: 'cancelada' },
    });
    if (count === 0) throw conflitoDeStatus('recebida');
    return tx.totemRemessa.findUniqueOrThrow({ where: { id: atual.id }, select: CAMPOS_DA_REMESSA });
  });
  return paraRemessaDoPainel(remessa);
}
