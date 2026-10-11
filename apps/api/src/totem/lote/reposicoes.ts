import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  totemLoteDataDoDia,
  type TotemReposicaoDoPainel,
  type TotemReposicaoNova,
} from '@mktos/shared';

import { exigirLojaNoEscopo, type UsuarioDoEscopo } from '../comum/escopo';
import { totemNaoEncontrado } from '../comum/modulo';
import { exigirAlgumaPermissao, filtroDeLoja, lojasDaConsulta, type BancoDoLote } from './acesso';
import { ehCodigoRepetido, produtoDaEmpresa, validadeDoLoteNovo } from './lotes';

/*
 * Reposição: a loja diz qual lote foi para a prateleira. É o caso 1 da regra do
 * lote vigente, o único que não é presumido. Lote que chegou fora da remessa do
 * CD nasce aqui, com origem `manual_loja` e a loja que o registrou.
 */

const CAMPOS_DA_REPOSICAO = {
  id: true,
  lojaId: true,
  produtoId: true,
  loteId: true,
  repostoEm: true,
  origem: true,
  loja: { select: { nome: true } },
  produto: { select: { codigo: true, nome: true } },
  lote: { select: { codigo: true, validadeEm: true } },
} satisfies Prisma.TotemReposicaoSelect;

type ReposicaoDoBanco = Prisma.TotemReposicaoGetPayload<{ select: typeof CAMPOS_DA_REPOSICAO }>;

export function paraReposicaoDoPainel(r: ReposicaoDoBanco): TotemReposicaoDoPainel {
  return {
    id: r.id,
    lojaId: r.lojaId,
    lojaNome: r.loja.nome,
    produtoId: r.produtoId,
    produtoCodigo: r.produto.codigo,
    produtoNome: r.produto.nome,
    loteId: r.loteId,
    loteCodigo: r.lote.codigo,
    validadeEm: r.lote.validadeEm.toISOString().slice(0, 10),
    repostoEm: r.repostoEm.toISOString(),
    origem: r.origem === 'manual' ? 'manual' : 'remessa',
  };
}

export async function listarReposicoes(
  db: BancoDoLote,
  user: UsuarioDoEscopo,
  filtro: { lojaId?: string },
): Promise<TotemReposicaoDoPainel[]> {
  exigirAlgumaPermissao(user, ['totem.reposicao', 'totem.lotes']);
  const lojas = await lojasDaConsulta(db, user, filtro.lojaId);
  const reposicoes = await db.totemReposicao.findMany({
    where: { orgId: user.orgId, ...filtroDeLoja(lojas) },
    orderBy: [{ repostoEm: 'desc' }, { criadoEm: 'desc' }],
    take: 100,
    select: CAMPOS_DA_REPOSICAO,
  });
  return reposicoes.map(paraReposicaoDoPainel);
}

export async function registrarReposicao(
  db: BancoDoLote,
  user: UsuarioDoEscopo,
  entrada: TotemReposicaoNova,
  agora = new Date(),
): Promise<TotemReposicaoDoPainel> {
  try {
    const reposicao = await db.$transaction(async (tx) => {
      await exigirLojaNoEscopo(tx, user, entrada.lojaId);
      const produto = await produtoDaEmpresa(tx, user.orgId, entrada.produtoId);

      let loteId: string;
      if (entrada.loteId) {
        const lote = await tx.totemLote.findFirst({
          where: { id: entrada.loteId, orgId: user.orgId },
          select: { id: true, produtoId: true, origem: true, lojaOrigemId: true },
        });
        if (!lote) throw totemNaoEncontrado();
        if (lote.produtoId !== produto.id) throw new BadRequestException('Esse lote é de outro produto.');
        if (lote.origem === 'manual_loja' && lote.lojaOrigemId !== entrada.lojaId) {
          throw new BadRequestException('Esse lote foi registrado por outra loja.');
        }
        loteId = lote.id;
      } else {
        const manual = entrada.loteManual;
        if (!manual) throw new BadRequestException('Escolha um lote da lista ou informe um lote manual.');
        const validadeEm = validadeDoLoteNovo(manual, produto.validadeDiasPadrao);
        const lote = await tx.totemLote.create({
          data: {
            orgId: user.orgId,
            produtoId: produto.id,
            codigo: manual.codigo,
            fabricadoEm: manual.fabricadoEm ? totemLoteDataDoDia(manual.fabricadoEm) : null,
            validadeEm,
            origem: 'manual_loja',
            lojaOrigemId: entrada.lojaId,
            criadoPor: user.sub,
          },
          select: { id: true },
        });
        loteId = lote.id;
      }

      return tx.totemReposicao.create({
        data: {
          orgId: user.orgId,
          lojaId: entrada.lojaId,
          produtoId: produto.id,
          loteId,
          repostoEm: agora,
          origem: entrada.loteId ? 'remessa' : 'manual',
          registradoPor: user.sub,
        },
        select: CAMPOS_DA_REPOSICAO,
      });
    });
    return paraReposicaoDoPainel(reposicao);
  } catch (e) {
    if (ehCodigoRepetido(e)) {
      throw new ConflictException('Já existe um lote com esse código para este produto. Escolha-o na lista de lotes.');
    }
    throw e;
  }
}
