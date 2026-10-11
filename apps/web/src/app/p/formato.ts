import {
  totemLoteDataBR,
  totemLoteDiasParaVencer,
  totemLoteHoje,
  type TotemNutriente,
  type TotemSituacaoValidade,
  type TotemUnidadePreco,
} from '@mktos/shared';

/*
 * Os textos da ficha da etiqueta (`/p/<codigo>`) e da etiqueta impressa, em
 * funções puras para o teste não depender da tela.
 */

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const numero = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

const POR_UNIDADE: Record<TotemUnidadePreco, string> = {
  kg: 'o quilo',
  '100g': 'a cada 100 g',
  un: 'a unidade',
};

/** `R$ 89,90 o quilo`. Sem preço, `null`: a ficha não mostra a linha. */
export function precoDaFicha(centavos: number | null | undefined, unidade: TotemUnidadePreco | null | undefined): string | null {
  if (centavos == null) return null;
  // O Intl separa "R$" do valor com espaço sem quebra; na etiqueta e no teste vale o espaço comum.
  const valor = moeda.format(centavos / 100).replace(/ /g, ' ');
  return unidade ? `${valor} ${POR_UNIDADE[unidade]}` : valor;
}

/** `ABCDE-12345`: o código da etiqueta em dois blocos, mais fácil de ditar. */
export function codigoLegivel(codigo: string): string {
  return codigo.length === 10 ? `${codigo.slice(0, 5)}-${codigo.slice(5)}` : codigo;
}

/** O endereço que o QR abre. `origem` é a do painel que imprime (`window.location.origin`). */
export function urlDaEtiqueta(origem: string, codigo: string): string {
  return `${origem.replace(/\/+$/, '')}/p/${codigo}`;
}

/** O endereço impresso embaixo do QR, sem `https://`, para quem prefere digitar. */
export function urlCurtaDaEtiqueta(origem: string, codigo: string): string {
  return urlDaEtiqueta(origem, codigo).replace(/^https?:\/\//, '');
}

/** A frase da validade do lote, no tom da situação que a API calculou. */
export function textoDaValidade(
  situacao: TotemSituacaoValidade,
  validadeEm: string,
  hoje: Date = totemLoteHoje(),
): string {
  const data = totemLoteDataBR(validadeEm);
  if (situacao === 'vencido') return `Lote vencido em ${data}. Avise a equipe da loja.`;
  if (situacao === 'ok') return `Dentro da validade, que vai até ${data}.`;
  const dias = totemLoteDiasParaVencer(validadeEm, hoje);
  if (dias <= 0) return `Vence hoje, ${data}.`;
  if (dias === 1) return `Vence amanhã, ${data}.`;
  return `Vence em ${dias} dias, em ${data}.`;
}

/** `Porção de 40 g (2 colheres de sopa)`. Sem porção, `null`. */
export function textoDaPorcao(porcaoG: number | null, descricao: string | null): string | null {
  if (porcaoG == null && !descricao) return null;
  if (porcaoG == null) return `Porção: ${descricao}`;
  const gramas = `Porção de ${numero.format(porcaoG)} g`;
  return descricao ? `${gramas} (${descricao})` : gramas;
}

/** `12,5 g` e `6%` de uma linha da tabela nutricional. */
export function linhaNutricional(n: TotemNutriente): { quantidade: string; vd: string } {
  return {
    quantidade: `${numero.format(n.quantidade)} ${n.unidade}`,
    vd: n.vd == null ? '—' : `${numero.format(n.vd)}%`,
  };
}
