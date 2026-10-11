import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  totemLoteDataDoDia,
  totemLoteHoje,
  totemSituacaoDaValidade,
  type TotemLojaDoLote,
  type TotemLoteDoPainel,
  type TotemLoteEdicao,
  type TotemLoteNovo,
  type TotemProdutoDoLote,
} from '@mktos/shared';

import { escopoDeLojas, type UsuarioDoEscopo } from '../comum/escopo';
import { totemNaoEncontrado } from '../comum/modulo';
import { diaOuNulo, exigirAlgumaPermissao, type BancoDoLote, type TransacaoDoLote } from './acesso';

/*
 * Lotes no painel: o CD cria e corrige; CD e loja leem para montar remessa e
 * reposição. Lote manual (o que a loja recebeu fora da remessa) aparece só
 * para quem enxerga a loja que o registrou.
 */

const DIA_MS = 86_400_000;

/**
 * A validade de um lote novo: a informada, ou a fabricação mais a validade
 * padrão do produto. Sem nenhuma das duas, 400: lote sem validade é o que o
 * fiscal multa.
 */
export function validadeDoLoteNovo(
  entrada: { fabricadoEm?: string | null; validadeEm?: string | null },
  validadeDiasPadrao: number | null,
): Date {
  const fabricado = entrada.fabricadoEm ? totemLoteDataDoDia(entrada.fabricadoEm) : null;
  let validade: Date;
  if (entrada.validadeEm) {
    validade = totemLoteDataDoDia(entrada.validadeEm);
  } else if (fabricado && validadeDiasPadrao && validadeDiasPadrao > 0) {
    validade = new Date(fabricado.getTime() + validadeDiasPadrao * DIA_MS);
  } else {
    throw new BadRequestException(
      fabricado
        ? 'Informe a validade do lote. O produto não tem validade padrão para calcular a partir da fabricação.'
        : 'Informe a validade do lote, ou a data de fabricação para calcular pela validade padrão do produto.',
    );
  }
  if (fabricado && validade.getTime() < fabricado.getTime()) {
    throw new BadRequestException('A validade não pode ser anterior à fabricação.');
  }
  return validade;
}

export function ehCodigoRepetido(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

export const LOTE_REPETIDO = 'Já existe um lote com esse código para este produto.';

const CAMPOS_DO_LOTE = {
  id: true,
  produtoId: true,
  codigo: true,
  fabricadoEm: true,
  validadeEm: true,
  origem: true,
  lojaOrigemId: true,
  observacao: true,
} as const;

type LoteDoBanco = Prisma.TotemLoteGetPayload<{ select: typeof CAMPOS_DO_LOTE }>;

export function paraLoteDoPainel(lote: LoteDoBanco, hoje: Date): TotemLoteDoPainel {
  return {
    id: lote.id,
    produtoId: lote.produtoId,
    codigo: lote.codigo,
    fabricadoEm: diaOuNulo(lote.fabricadoEm),
    validadeEm: lote.validadeEm.toISOString().slice(0, 10),
    origem: lote.origem === 'manual_loja' ? 'manual_loja' : 'producao_central',
    lojaOrigemId: lote.lojaOrigemId,
    observacao: lote.observacao,
    situacao: totemSituacaoDaValidade(lote.validadeEm, hoje),
  };
}

/** O produto pelo id dentro da empresa; 404 quando não aparece. */
export async function produtoDaEmpresa(
  tx: Pick<TransacaoDoLote, 'totemProduto'>,
  orgId: string,
  produtoId: string,
): Promise<{ id: string; validadeDiasPadrao: number | null }> {
  const produto = await tx.totemProduto.findFirst({
    where: { id: produtoId, orgId },
    select: { id: true, validadeDiasPadrao: true },
  });
  if (!produto) throw totemNaoEncontrado();
  return produto;
}

export async function listarLojasDoLote(db: BancoDoLote, user: UsuarioDoEscopo): Promise<TotemLojaDoLote[]> {
  const escopo = await escopoDeLojas(db, user);
  return db.totemLoja.findMany({
    where: { orgId: user.orgId, ...(escopo === 'todas' ? {} : { id: { in: escopo } }) },
    orderBy: [{ ativa: 'desc' }, { codigo: 'asc' }],
    select: { id: true, codigo: true, nome: true, ativa: true },
  });
}

export async function listarProdutosDoLote(db: BancoDoLote, user: UsuarioDoEscopo): Promise<TotemProdutoDoLote[]> {
  return db.totemProduto.findMany({
    where: { orgId: user.orgId, ativo: true },
    orderBy: { codigo: 'asc' },
    select: { id: true, codigo: true, nome: true, validadeDiasPadrao: true, ativo: true },
  });
}

export async function listarLotes(
  db: BancoDoLote,
  user: UsuarioDoEscopo,
  produtoId: string,
  agora = new Date(),
): Promise<TotemLoteDoPainel[]> {
  exigirAlgumaPermissao(user, ['totem.lotes', 'totem.reposicao']);
  const escopo = await escopoDeLojas(db, user);
  const visiveis: Prisma.TotemLoteWhereInput =
    escopo === 'todas' ? {} : { OR: [{ origem: { not: 'manual_loja' } }, { lojaOrigemId: { in: escopo } }] };
  const lotes = await db.totemLote.findMany({
    where: { orgId: user.orgId, produtoId, ...visiveis },
    orderBy: [{ validadeEm: 'desc' }, { criadoEm: 'desc' }],
    take: 200,
    select: CAMPOS_DO_LOTE,
  });
  const hoje = totemLoteHoje(agora);
  return lotes.map((l) => paraLoteDoPainel(l, hoje));
}

export async function criarLote(
  db: BancoDoLote,
  user: UsuarioDoEscopo,
  entrada: TotemLoteNovo,
  agora = new Date(),
): Promise<TotemLoteDoPainel> {
  try {
    const lote = await db.$transaction(async (tx) => {
      const produto = await produtoDaEmpresa(tx, user.orgId, entrada.produtoId);
      const validadeEm = validadeDoLoteNovo(entrada, produto.validadeDiasPadrao);
      return tx.totemLote.create({
        data: {
          orgId: user.orgId,
          produtoId: produto.id,
          codigo: entrada.codigo,
          fabricadoEm: entrada.fabricadoEm ? totemLoteDataDoDia(entrada.fabricadoEm) : null,
          validadeEm,
          origem: 'producao_central',
          observacao: entrada.observacao ?? null,
          criadoPor: user.sub,
        },
        select: CAMPOS_DO_LOTE,
      });
    });
    return paraLoteDoPainel(lote, totemLoteHoje(agora));
  } catch (e) {
    if (ehCodigoRepetido(e)) throw new ConflictException(LOTE_REPETIDO);
    throw e;
  }
}

export async function editarLote(
  db: BancoDoLote,
  user: UsuarioDoEscopo,
  loteId: string,
  entrada: TotemLoteEdicao,
  agora = new Date(),
): Promise<TotemLoteDoPainel> {
  try {
    const lote = await db.$transaction(async (tx) => {
      const atual = await tx.totemLote.findFirst({ where: { id: loteId, orgId: user.orgId }, select: CAMPOS_DO_LOTE });
      if (!atual) throw totemNaoEncontrado();
      if (atual.origem === 'manual_loja' && atual.lojaOrigemId) {
        const escopo = await escopoDeLojas(tx, user);
        if (escopo !== 'todas' && !escopo.includes(atual.lojaOrigemId)) throw totemNaoEncontrado();
      }
      const fabricadoEm =
        entrada.fabricadoEm === undefined
          ? atual.fabricadoEm
          : entrada.fabricadoEm
            ? totemLoteDataDoDia(entrada.fabricadoEm)
            : null;
      const validadeEm = entrada.validadeEm ? totemLoteDataDoDia(entrada.validadeEm) : atual.validadeEm;
      if (fabricadoEm && validadeEm.getTime() < fabricadoEm.getTime()) {
        throw new BadRequestException('A validade não pode ser anterior à fabricação.');
      }
      return tx.totemLote.update({
        where: { id: atual.id },
        data: {
          codigo: entrada.codigo ?? atual.codigo,
          fabricadoEm,
          validadeEm,
          ...(entrada.observacao !== undefined ? { observacao: entrada.observacao ?? null } : {}),
        },
        select: CAMPOS_DO_LOTE,
      });
    });
    return paraLoteDoPainel(lote, totemLoteHoje(agora));
  } catch (e) {
    if (ehCodigoRepetido(e)) throw new ConflictException(LOTE_REPETIDO);
    throw e;
  }
}
