import type { Prisma, PrismaClient } from '@prisma/client';
import {
  TotemNutricionalSchema,
  TotemSeloSchema,
  TotemUnidadePrecoSchema,
  totemLoteHoje,
  totemSituacaoDaValidade,
  type TotemFichaDaEtiqueta,
  type TotemLoteDaEtiqueta,
  type TotemProdutoDaEtiqueta,
  type TotemSelo,
} from '@mktos/shared';

import { comTenantPublico, resolverTenantDaEtiqueta } from '../../common/tenant-publico';
import { exigirModuloTotem, totemNaoEncontrado } from '../comum/modulo';
import { loteVigentePorProduto, type TotemLoteVigente } from '../lote/lote-vigente';

/*
 * A FICHA PÚBLICA DA ETIQUETA (`GET /api/totem-etiqueta/:codigo`, página `/p`).
 *
 * Quem lê é o celular de qualquer cliente que apontou a câmera para o QR. Por
 * isso a resposta é montada numa função pura com lista FECHADA de campos:
 * produto, lote, loja (nome e cidade), cores e a chamada da campanha. Preço só
 * entra com `precoLigado` (CONTRATO.md, seção 4); com a chave desligada, as
 * chaves `precoCentavos` e `unidadePreco` nem aparecem no JSON.
 */

export const CAMPOS_DO_PRODUTO_PUBLICO = {
  codigo: true,
  nome: true,
  categoria: true,
  composicao: true,
  beneficios: true,
  alergenicos: true,
  porcaoG: true,
  porcaoDescricao: true,
  nutricional: true,
  selos: true,
  imagemUrl: true,
  fonteNutricional: true,
  precoCentavos: true,
  unidadePreco: true,
  ativo: true,
} satisfies Prisma.TotemProdutoSelect;

const CAMPOS_DO_LOTE = { id: true, codigo: true, fabricadoEm: true, validadeEm: true } as const;

export type ProdutoDaFicha = Prisma.TotemProdutoGetPayload<{ select: typeof CAMPOS_DO_PRODUTO_PUBLICO }>;

export interface EntradaDaFicha {
  codigo: string;
  loja: { nome: string; cidade: string | null };
  produto: ProdutoDaFicha;
  /** O lote que a etiqueta mostra: o fixado nela ou o vigente da loja. */
  lote: { id: string; codigo: string; fabricadoEm: Date | null; validadeEm: Date } | null;
  vigente: TotemLoteVigente | undefined;
  config: {
    nomeExibicao: string;
    corPrimaria: string;
    corFundo: string;
    logoUrl: string | null;
    precoLigado: boolean;
    cadastroLigado: boolean;
  };
  campanha: { chamada: string; descricaoBeneficio: string | null } | null;
  hoje: Date;
}

/** Sem `TotemConfig` gravada: o nome da empresa, as cores do Sr. aGranel, preço e cadastro desligados. */
export function configPadraoDaFicha(nomeDaEmpresa: string): EntradaDaFicha['config'] {
  return {
    nomeExibicao: nomeDaEmpresa,
    corPrimaria: '#28371D',
    corFundo: '#F5F3EC',
    logoUrl: null,
    precoLigado: false,
    cadastroLigado: false,
  };
}

function dia(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

export function montarFichaDaEtiqueta(e: EntradaDaFicha): TotemFichaDaEtiqueta {
  const p = e.produto;
  const nutricional = TotemNutricionalSchema.safeParse(p.nutricional);
  const produto: TotemProdutoDaEtiqueta = {
    codigo: p.codigo,
    nome: p.nome,
    categoria: p.categoria,
    composicao: p.composicao,
    beneficios: p.beneficios,
    alergenicos: p.alergenicos,
    porcaoG: p.porcaoG === null ? null : Number(p.porcaoG.toString()),
    porcaoDescricao: p.porcaoDescricao,
    nutricional: nutricional.success ? nutricional.data : [],
    selos: p.selos.filter((s): s is TotemSelo => TotemSeloSchema.safeParse(s).success),
    imagemUrl: p.imagemUrl,
    fonteNutricional: p.fonteNutricional,
  };
  if (e.config.precoLigado) {
    const unidade = TotemUnidadePrecoSchema.safeParse(p.unidadePreco);
    produto.precoCentavos = p.precoCentavos;
    produto.unidadePreco = unidade.success ? unidade.data : null;
  }

  let lote: TotemLoteDaEtiqueta | null = null;
  if (e.lote) {
    const mesmoDoVigente = e.vigente?.loteId === e.lote.id;
    lote = {
      codigo: e.lote.codigo,
      fabricadoEm: dia(e.lote.fabricadoEm),
      validadeEm: e.lote.validadeEm.toISOString().slice(0, 10),
      repostoEm: mesmoDoVigente && e.vigente ? e.vigente.repostoEm.toISOString() : null,
      presumido: mesmoDoVigente && e.vigente ? e.vigente.presumido : false,
      situacao: totemSituacaoDaValidade(e.lote.validadeEm, e.hoje),
    };
  }

  return {
    codigo: e.codigo,
    loja: { nome: e.loja.nome, cidade: e.loja.cidade },
    produto,
    lote,
    config: {
      nomeExibicao: e.config.nomeExibicao,
      corPrimaria: e.config.corPrimaria,
      corFundo: e.config.corFundo,
      logoUrl: e.config.logoUrl,
      cadastroLigado: e.config.cadastroLigado,
    },
    campanha: e.config.cadastroLigado && e.campanha ? { ...e.campanha } : null,
  };
}

/**
 * O fluxo inteiro da rota pública, fora do Nest para o teste chamar com o
 * client: resolve a empresa pela etiqueta, confere o módulo, monta a ficha e
 * conta a abertura do QR (`qr_aberto`). Etiqueta revogada, produto inativo e
 * empresa sem o módulo respondem a mesma 404.
 *
 * `codigo` chega já normalizado pelo `TotemCodigoEtiquetaSchema` no controller.
 */
export async function fichaDaEtiqueta(
  prisma: PrismaClient,
  codigo: string,
  agora = new Date(),
): Promise<TotemFichaDaEtiqueta> {
  const etiqueta = await resolverTenantDaEtiqueta(prisma, codigo);
  if (!etiqueta || etiqueta.revogadaEm) throw totemNaoEncontrado();
  const { orgId, lojaId, produtoId } = etiqueta;

  return comTenantPublico(orgId, () =>
    prisma.$transaction(async (tx) => {
      await exigirModuloTotem(tx, orgId);
      const produto = await tx.totemProduto.findFirst({
        where: { id: produtoId, orgId },
        select: CAMPOS_DO_PRODUTO_PUBLICO,
      });
      const loja = await tx.totemLoja.findFirst({
        where: { id: lojaId, orgId, ativa: true },
        select: { nome: true, cidade: true },
      });
      if (!produto || !produto.ativo || !loja) throw totemNaoEncontrado();

      const config = await tx.totemConfig.findUnique({
        where: { orgId },
        select: {
          nomeExibicao: true,
          corPrimaria: true,
          corFundo: true,
          logoUrl: true,
          precoLigado: true,
          cadastroLigado: true,
        },
      });
      const org = config ? null : await tx.org.findUnique({ where: { id: orgId }, select: { name: true } });

      const vigente = (await loteVigentePorProduto(tx, lojaId, [produtoId])).get(produtoId);
      let lote: EntradaDaFicha['lote'] = null;
      if (etiqueta.loteId) {
        lote = await tx.totemLote.findFirst({
          where: { id: etiqueta.loteId, orgId, produtoId },
          select: CAMPOS_DO_LOTE,
        });
      } else if (vigente) {
        lote = { id: vigente.loteId, codigo: vigente.codigo, fabricadoEm: vigente.fabricadoEm, validadeEm: vigente.validadeEm };
      }

      const campanha = await tx.totemCampanha.findFirst({
        where: {
          orgId,
          ativa: true,
          inicioEm: { lte: agora },
          AND: [
            { OR: [{ fimEm: null }, { fimEm: { gt: agora } }] },
            { OR: [{ lojaIds: { isEmpty: true } }, { lojaIds: { has: lojaId } }] },
          ],
        },
        orderBy: { inicioEm: 'desc' },
        select: { chamada: true, descricaoBeneficio: true },
      });

      await tx.totemEvento.create({
        data: { orgId, lojaId, tipo: 'qr_aberto', produtoId, ocorridoEm: agora },
      });

      return montarFichaDaEtiqueta({
        codigo,
        loja,
        produto,
        lote,
        vigente,
        config: config ?? configPadraoDaFicha(org?.name ?? ''),
        campanha,
        hoje: totemLoteHoje(agora),
      });
    }),
  );
}
