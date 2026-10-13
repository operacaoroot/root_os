import {
  TABELA_DE_PRECO,
  TABELA_DE_PRECO_DATA,
  formatarReais,
  precoNaTabela,
  type ComercialFormaDePagamento,
  type ComercialProduto,
} from '@mktos/shared';

import { hashDoConteudo } from './eventos';

/*
 * O CONSTRUTOR E O REVISOR DE PROPOSTA — a parte pura (lane E, 13/10/2026).
 *
 * O construtor monta a versão a partir do produto, do diagnóstico e da tabela
 * de 04/10 (`TABELA_DE_PRECO`). NADA de número vem do modelo: valor, parcelas
 * e formas são da linha da tabela; desconto só entra quando uma DECISÃO o
 * aprovou (`descontoAprovado`); a validade é `validadePropostaDias` da config;
 * o quadro de custos de terceiros é o que alguém escreveu (em homologação, o
 * exemplo do mapa, marcado como tal). "O que ouvimos" são as dores do
 * diagnóstico, que o parser já conferiu contra a ata.
 *
 * O revisor confere o que o mapa pede (C04, E6): as parcelas fecham o total,
 * o preço bate a tabela (ou o desconto foi aprovado), o quadro está presente,
 * a validade está escrita. Laudo com apontamento NÃO vai à porta: vira a
 * decisão `proposta_fora_da_tabela`.
 */

export interface QuadroDeCustos {
  mesNormalCentavos: number | null;
  piorMesCentavos: number | null;
  /** true = valor de exemplo de homologação (o mapa), não dado do cliente. */
  exemplo: boolean;
  origem: string;
}

export interface VersaoDaProposta {
  leadId: string;
  versao: number;
  produto: ComercialProduto;
  rotulo: string;
  valorCentavos: number;
  parcelas: number;
  parcelaCentavos: number;
  /** A última parcela, quando o arredondamento do desconto não divide igual. */
  ultimaParcelaCentavos: number;
  formas: ComercialFormaDePagamento[];
  descricao: string;
  descontoPct: number | null;
  /** O id da decisão que aprovou o desconto. */
  descontoDecisaoId: string | null;
  alternativa: ComercialProduto | null;
  ouvimos: string[];
  comoEDiferente: string | null;
  quadroDeCustos: QuadroDeCustos | null;
  validaAte: string | null;
  tabelaData: string;
}

export interface Laudo {
  ok: boolean;
  apontamentos: string[];
  /** O que o revisor conferiu e passou, ou o que avisa sem barrar. */
  notas: string[];
}

/** As parcelas de um valor: iguais, e a última absorve o que o arredondamento deixou. */
export function parcelasDoValor(valorCentavos: number, parcelas: number): { parcelaCentavos: number; ultimaParcelaCentavos: number } {
  const n = Math.max(1, Math.trunc(parcelas));
  const parcela = Math.floor(valorCentavos / n);
  return { parcelaCentavos: parcela, ultimaParcelaCentavos: valorCentavos - parcela * (n - 1) };
}

/** As parcelas fecham o total, contando a última? */
export function parcelasFechamComUltima(v: Pick<VersaoDaProposta, 'valorCentavos' | 'parcelas' | 'parcelaCentavos' | 'ultimaParcelaCentavos'>): boolean {
  return v.parcelas > 0 && v.parcelaCentavos * (v.parcelas - 1) + v.ultimaParcelaCentavos === v.valorCentavos;
}

/** O valor com desconto, em centavos, arredondado ao centavo. */
export function valorComDesconto(valorCentavos: number, pct: number): number {
  return Math.round((valorCentavos * (100 - pct)) / 100);
}

/** A data da validade: o fim do dia em São Paulo, `dias` depois de `agora`. */
export function validadeAte(agora: Date, dias: number | null): string | null {
  if (!dias || dias < 1) return null;
  const sp = new Date(agora.getTime() - 3 * 3_600_000);
  const alvo = new Date(Date.UTC(sp.getUTCFullYear(), sp.getUTCMonth(), sp.getUTCDate() + dias));
  return `${alvo.toISOString().slice(0, 10)}T23:59:59-03:00`;
}

/** A alternativa da tela 07: quem recebe a Operação vê a Imersão; o resto não tem alternativa. */
export function alternativaDe(produto: ComercialProduto): ComercialProduto | null {
  return produto === 'operacao' && TABELA_DE_PRECO.imersao ? 'imersao' : null;
}

export interface MontarProposta {
  leadId: string;
  versao: number;
  produto: ComercialProduto;
  dores: string[];
  comoEDiferente: string | null;
  quadro: QuadroDeCustos | null;
  validadeDias: number | null;
  agora: Date;
  descontoAprovado?: { pct: number; decisaoId: string } | null;
}

export function montarProposta(m: MontarProposta): VersaoDaProposta {
  const linha = TABELA_DE_PRECO[m.produto];
  const base = linha?.valorCentavos ?? 0;
  const parcelas = linha?.parcelas ?? 1;
  const pct = m.descontoAprovado && m.descontoAprovado.pct > 0 ? m.descontoAprovado.pct : null;
  const valor = pct ? valorComDesconto(base, pct) : base;
  const { parcelaCentavos, ultimaParcelaCentavos } = pct ? parcelasDoValor(valor, parcelas) : { parcelaCentavos: linha?.parcelaCentavos ?? 0, ultimaParcelaCentavos: linha?.parcelaCentavos ?? 0 };
  return {
    leadId: m.leadId,
    versao: m.versao,
    produto: m.produto,
    rotulo: linha?.rotulo ?? m.produto,
    valorCentavos: valor,
    parcelas,
    parcelaCentavos,
    ultimaParcelaCentavos,
    formas: linha ? [...linha.formas] : [],
    descricao: linha?.descricao ?? '',
    descontoPct: pct,
    descontoDecisaoId: pct ? m.descontoAprovado!.decisaoId : null,
    alternativa: alternativaDe(m.produto),
    ouvimos: m.dores.filter((d) => d.trim()).slice(0, 6),
    comoEDiferente: m.comoEDiferente,
    quadroDeCustos: m.quadro,
    validaAte: validadeAte(m.agora, m.validadeDias),
    tabelaData: TABELA_DE_PRECO_DATA,
  };
}

/** O hash do conteúdo exato da versão: é ele que a aprovação R3 prende. */
export function hashDaVersao(v: VersaoDaProposta): string {
  return hashDoConteudo(v);
}

export function revisarProposta(v: VersaoDaProposta): Laudo {
  const apontamentos: string[] = [];
  const notas: string[] = [];
  const linha = TABELA_DE_PRECO[v.produto];

  if (!linha) apontamentos.push(`o produto "${v.produto}" não tem preço na tabela de ${TABELA_DE_PRECO_DATA} ([a decidir] pela mesa)`);

  if (!parcelasFechamComUltima(v)) {
    apontamentos.push(`as parcelas não fecham o total: ${v.parcelas}× de ${formatarReais(v.parcelaCentavos)} não dá ${formatarReais(v.valorCentavos)}`);
  } else if (v.ultimaParcelaCentavos !== v.parcelaCentavos) {
    notas.push(`parcelas fecham o total: ${v.parcelas - 1}× de ${formatarReais(v.parcelaCentavos)} e a última de ${formatarReais(v.ultimaParcelaCentavos)} (a última absorve o arredondamento do desconto)`);
  } else {
    notas.push(`parcelas fecham o total: ${v.parcelas}× de ${formatarReais(v.parcelaCentavos)} = ${formatarReais(v.valorCentavos)}`);
  }

  if (linha) {
    if (precoNaTabela(v.produto, v.valorCentavos)) notas.push(`preço bate a tabela de ${TABELA_DE_PRECO_DATA}`);
    else if (v.descontoPct && v.descontoDecisaoId && v.valorCentavos === valorComDesconto(linha.valorCentavos, v.descontoPct)) {
      notas.push(`preço fora da tabela por desconto de ${v.descontoPct}% aprovado na decisão ${v.descontoDecisaoId}`);
    } else apontamentos.push(`preço ${formatarReais(v.valorCentavos)} fora da tabela de ${TABELA_DE_PRECO_DATA} (${formatarReais(linha.valorCentavos)}) sem desconto aprovado`);
    if (v.parcelas !== linha.parcelas) apontamentos.push(`parcelas (${v.parcelas}) diferentes da tabela (${linha.parcelas})`);
    const fora = v.formas.filter((f) => !linha.formas.includes(f));
    if (!v.formas.length || fora.length) apontamentos.push(`formas de pagamento fora da tabela: ${fora.join(', ') || 'nenhuma'}`);
  }

  if (!v.quadroDeCustos || (v.quadroDeCustos.mesNormalCentavos == null && v.quadroDeCustos.piorMesCentavos == null)) {
    apontamentos.push('quadro de custos de terceiros ausente');
  } else if (v.quadroDeCustos.exemplo) {
    notas.push(`quadro de custos presente com VALORES DE EXEMPLO (${v.quadroDeCustos.origem}): [a decidir] com o dado real do cliente`);
  } else notas.push('quadro de custos presente');

  if (!v.validaAte) apontamentos.push('validade não escrita (validadePropostaDias está [a decidir] na config)');
  else notas.push(`validade escrita: até ${v.validaAte.slice(0, 10)}`);

  if (!v.ouvimos.length) notas.push('"o que ouvimos" vazio: o diagnóstico não trouxe dor conferida');

  return { ok: apontamentos.length === 0, apontamentos, notas };
}

/** Dentro da tabela = o preço é exatamente o da linha (desconto aprovado é fora da tabela, autorizado). */
export function dentroDaTabela(v: VersaoDaProposta): boolean {
  return precoNaTabela(v.produto, v.valorCentavos);
}

/**
 * A regra da casa para o produto sugerido (provisória, [a decidir] pela mesa):
 * com base organizada E sistema em uso, a Operação; sem base, a Imersão; sem
 * saber da base, nenhum (a proposta espera o formulário). É a mesma regra do
 * qualificador (`pontuacao.ts`, `produtoAlvo`).
 */
export const REGRA_DO_PRODUTO = 'regra provisória: base organizada e sistema = Operação ROOT; sem base = Imersão ([a decidir] pela mesa)';
