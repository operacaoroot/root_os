import { BadRequestException, ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type {
  TotemGestaoConfig,
  TotemGestaoConfigEntrada,
  TotemGestaoProdutoCriar,
  TotemGestaoProdutoEditar,
  TotemGestaoProdutoResposta,
  TotemGestaoProdutosPagina,
  TotemGestaoProdutosQuery,
} from '@mktos/shared';
import { TOTEM_POLITICA_VERSAO } from '@mktos/shared';

import { totemNaoEncontrado } from '../comum/modulo';
import {
  totemGestaoAvisoDePreco,
  totemGestaoConfigPadrao,
  totemGestaoDadosDoProduto,
  totemGestaoEhDuplicado,
  totemGestaoPalavrasDaBusca,
  totemGestaoProblemaDePreco,
  totemGestaoProdutoParaTela,
} from './regras';

/*
 * Catálogo e configuração do totem. Os dois são da empresa inteira, sem loja:
 * o pai conferido é a própria empresa, pelo `orgId` em todo `where`. Toda
 * resposta de produto leva o aviso de preço quando a configuração esconde o
 * preço do totem, para ninguém cadastrar preço achando que ele já aparece.
 */

export type ClienteDosProdutos = Pick<Prisma.TransactionClient, 'totemProduto' | 'totemConfig'>;

async function precoLigado(tx: ClienteDosProdutos, orgId: string): Promise<boolean> {
  const config = await tx.totemConfig.findFirst({ where: { orgId }, select: { precoLigado: true } });
  return config?.precoLigado ?? false;
}

function conflitoDeCodigo(e: unknown, codigo: string | undefined): unknown {
  return totemGestaoEhDuplicado(e)
    ? new ConflictException(`Já existe um produto com o código ${codigo ?? ''}.`.trim())
    : e;
}

function exigirPrecoComUnidade(preco: number | null | undefined, unidade: string | null | undefined): void {
  const problema = totemGestaoProblemaDePreco(preco, unidade);
  if (problema) throw new BadRequestException(problema);
}

export async function totemGestaoListarProdutos(
  tx: ClienteDosProdutos,
  orgId: string,
  q: TotemGestaoProdutosQuery,
): Promise<TotemGestaoProdutosPagina> {
  const palavras = totemGestaoPalavrasDaBusca(q.busca);
  const where: Prisma.TotemProdutoWhereInput = {
    orgId,
    ...(q.situacao === 'ativos' ? { ativo: true } : q.situacao === 'inativos' ? { ativo: false } : {}),
    ...(q.falta === 'foto' ? { imagemUrl: null } : q.falta === 'tabela' ? { nutricional: { equals: [] } } : {}),
    ...(palavras.length
      ? {
          OR: [
            { AND: palavras.map((p) => ({ nomeBusca: { contains: p } })) },
            { codigo: { contains: q.busca!.trim(), mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
  const [total, linhas, ligado] = await Promise.all([
    tx.totemProduto.count({ where }),
    tx.totemProduto.findMany({
      where,
      orderBy: [{ ativo: 'desc' }, { nomeBusca: 'asc' }],
      skip: (q.pagina - 1) * q.porPagina,
      take: q.porPagina,
    }),
    precoLigado(tx, orgId),
  ]);
  return {
    itens: linhas.map(totemGestaoProdutoParaTela),
    total,
    pagina: q.pagina,
    porPagina: q.porPagina,
    ...totemGestaoAvisoDePreco(ligado),
  };
}

export async function totemGestaoObterProduto(
  tx: ClienteDosProdutos,
  orgId: string,
  id: string,
): Promise<TotemGestaoProdutoResposta> {
  const produto = await tx.totemProduto.findFirst({ where: { id, orgId } });
  if (!produto) throw totemNaoEncontrado();
  return { produto: totemGestaoProdutoParaTela(produto), ...totemGestaoAvisoDePreco(await precoLigado(tx, orgId)) };
}

export async function totemGestaoCriarProduto(
  tx: ClienteDosProdutos,
  orgId: string,
  dados: TotemGestaoProdutoCriar,
): Promise<TotemGestaoProdutoResposta> {
  exigirPrecoComUnidade(dados.precoCentavos, dados.unidadePreco);
  const campos = totemGestaoDadosDoProduto(dados);
  let produto;
  try {
    produto = await tx.totemProduto.create({
      data: { ...campos, orgId, codigo: dados.codigo, nome: dados.nome, nomeBusca: campos.nomeBusca! },
    });
  } catch (e) {
    throw conflitoDeCodigo(e, dados.codigo);
  }
  return { produto: totemGestaoProdutoParaTela(produto), ...totemGestaoAvisoDePreco(await precoLigado(tx, orgId)) };
}

export async function totemGestaoEditarProduto(
  tx: ClienteDosProdutos,
  orgId: string,
  id: string,
  dados: TotemGestaoProdutoEditar,
): Promise<TotemGestaoProdutoResposta> {
  const atual = await tx.totemProduto.findFirst({
    where: { id, orgId },
    select: { precoCentavos: true, unidadePreco: true },
  });
  if (!atual) throw totemNaoEncontrado();
  exigirPrecoComUnidade(
    dados.precoCentavos !== undefined ? dados.precoCentavos : atual.precoCentavos,
    dados.unidadePreco !== undefined ? dados.unidadePreco : atual.unidadePreco,
  );
  let produto;
  try {
    produto = await tx.totemProduto.update({ where: { id, orgId }, data: totemGestaoDadosDoProduto(dados) });
  } catch (e) {
    throw conflitoDeCodigo(e, dados.codigo);
  }
  return { produto: totemGestaoProdutoParaTela(produto), ...totemGestaoAvisoDePreco(await precoLigado(tx, orgId)) };
}

// --- Configuração ---

export async function totemGestaoObterConfig(tx: ClienteDosProdutos, orgId: string): Promise<TotemGestaoConfig> {
  const c = await tx.totemConfig.findFirst({ where: { orgId } });
  if (!c) return totemGestaoConfigPadrao();
  return {
    existe: true,
    nomeExibicao: c.nomeExibicao,
    corPrimaria: c.corPrimaria,
    corFundo: c.corFundo,
    logoUrl: c.logoUrl,
    precoLigado: c.precoLigado,
    cadastroLigado: c.cadastroLigado,
    tempoOciosoSeg: c.tempoOciosoSeg,
    controladorNome: c.controladorNome,
    controladorDocumento: c.controladorDocumento,
    controladorEndereco: c.controladorEndereco,
    encarregadoNome: c.encarregadoNome,
    encarregadoContato: c.encarregadoContato,
    politicaVersao: c.politicaVersao,
    mensagemBoasVindas: c.mensagemBoasVindas,
    alergenicosPadrao: c.alergenicosPadrao,
    atualizadoEm: c.atualizadoEm.toISOString(),
  };
}

/**
 * A versão da política não muda por aqui: ela é do texto da política (frente
 * D), e a configuração só a carimba quando nasce.
 */
export async function totemGestaoSalvarConfig(
  tx: ClienteDosProdutos,
  orgId: string,
  dados: TotemGestaoConfigEntrada,
): Promise<TotemGestaoConfig> {
  const campos = {
    nomeExibicao: dados.nomeExibicao,
    corPrimaria: dados.corPrimaria,
    corFundo: dados.corFundo,
    logoUrl: dados.logoUrl ?? null,
    precoLigado: dados.precoLigado,
    cadastroLigado: dados.cadastroLigado,
    tempoOciosoSeg: dados.tempoOciosoSeg,
    controladorNome: dados.controladorNome,
    controladorDocumento: dados.controladorDocumento ?? null,
    controladorEndereco: dados.controladorEndereco ?? null,
    encarregadoNome: dados.encarregadoNome ?? null,
    encarregadoContato: dados.encarregadoContato ?? null,
    mensagemBoasVindas: dados.mensagemBoasVindas ?? null,
    alergenicosPadrao: dados.alergenicosPadrao ?? null,
  };
  await tx.totemConfig.upsert({
    where: { orgId },
    create: { ...campos, orgId, politicaVersao: TOTEM_POLITICA_VERSAO },
    update: campos,
  });
  return totemGestaoObterConfig(tx, orgId);
}
