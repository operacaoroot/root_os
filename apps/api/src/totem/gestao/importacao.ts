import { z } from 'zod';
import {
  TotemGestaoProdutoCriarSchema,
  type TotemGestaoProdutoCriar,
  type TotemNutriente,
  type TotemSelo,
} from '@mktos/shared';

/*
 * O CATÁLOGO DO SISTEMA ANTERIOR (sragranel.com) convertido em produto do
 * totem. O arquivo é a lista que a API antiga devolve, um objeto por produto,
 * com os nomes de campo em inglês. Ele vem de fora: cada item passa por
 * `TotemProdutoAntigoSchema` antes da conversão, e o produto convertido passa
 * pela mesma validação do painel.
 *
 * O que o sistema antigo não tem: foto, categoria, preço e alergênicos por
 * produto. A foto entra depois pelo painel, com o filtro "Só os sem foto".
 */

export const TOTEM_FONTE_DO_SISTEMA_ANTERIOR = 'Sistema anterior (sragranel.com), importado em 12/10/2026';

/** O aviso que o sistema anterior mostrava em todo produto, sem o rótulo: a ficha e a etiqueta já escrevem "Alergênicos:". */
export const TOTEM_ALERGENICOS_DO_SISTEMA_ANTERIOR =
  'Pode conter trigo, centeio, cevada, aveia, amendoim, soja, amêndoa, avelã, nozes, ' +
  'castanha de caju, castanha-do-pará, macadâmia, pistache, noz-pecã e leite.';

const numero = z.number().finite().nonnegative();
const sinal = z.number().int();
const texto = z.string().nullable().optional();

export const TotemProdutoAntigoSchema = z.object({
  id: z.number().int().nonnegative(),
  name: z.string(),
  productcode: z.string().nullable().optional(),
  composition: texto,
  benefits: texto,
  suggestions: texto,
  portion: texto,
  gluten: sinal,
  lactose: sinal,
  transgenic: sinal,
  conservants: sinal,
  sugar: sinal,
  vegan: sinal,
  energetic: numero,
  energeticvd: numero,
  carbohydrates: numero,
  carbohydratesvd: numero,
  proteins: numero,
  proteinsvd: numero,
  totalfat: numero,
  totalfatvd: numero,
  saturatedfat: numero,
  saturatedfatvd: numero,
  transfat: numero,
  fiber: numero,
  fibervd: numero,
  sodium: numero,
  sodiumvd: numero,
});
export type TotemProdutoAntigo = z.infer<typeof TotemProdutoAntigoSchema>;

/** No sistema anterior, 1 quer dizer "não contém" (glúten, lactose, açúcar...) ou "é vegano". */
const SELOS: [keyof TotemProdutoAntigo, TotemSelo][] = [
  ['gluten', 'sem_gluten'],
  ['lactose', 'sem_lactose'],
  ['transgenic', 'nao_transgenico'],
  ['conservants', 'sem_conservantes'],
  ['sugar', 'sem_acucar'],
  ['vegan', 'vegano'],
];

/** Os valores do sistema anterior são por porção, com %VD da RDC 360/2003. Gordura trans não tem VD. */
function fichaNutricional(a: TotemProdutoAntigo): TotemNutriente[] {
  const linhas: TotemNutriente[] = [
    { nutriente: 'Valor energético', quantidade: a.energetic, unidade: 'kcal', vd: a.energeticvd },
    { nutriente: 'Carboidratos', quantidade: a.carbohydrates, unidade: 'g', vd: a.carbohydratesvd },
    { nutriente: 'Proteínas', quantidade: a.proteins, unidade: 'g', vd: a.proteinsvd },
    { nutriente: 'Gorduras totais', quantidade: a.totalfat, unidade: 'g', vd: a.totalfatvd },
    { nutriente: 'Gorduras saturadas', quantidade: a.saturatedfat, unidade: 'g', vd: a.saturatedfatvd },
    { nutriente: 'Gorduras trans', quantidade: a.transfat, unidade: 'g', vd: null },
    { nutriente: 'Fibra alimentar', quantidade: a.fiber, unidade: 'g', vd: a.fibervd },
    { nutriente: 'Sódio', quantidade: a.sodium, unidade: 'mg', vd: a.sodiumvd },
  ];
  // Tabela toda zerada é produto que nunca teve a ficha preenchida.
  return linhas.every((l) => l.quantidade === 0) ? [] : linhas;
}

function limpo(valor: string | null | undefined, maximo: number): string | null {
  const t = (valor ?? '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, maximo) : null;
}

const GRAMAS = /(\d+(?:[.,]\d+)?)\s*(?:gramas?|grs?|g)(?!\p{L})/iu;
const SEM_UNIDADE = /^(?:porção de\s*)?(\d+(?:[.,]\d+)?)\s*(?:\(|$)/iu;
const MEDIDA_CASEIRA = /\(([^)]*\d[^)]*)\)/u;

/**
 * "Porção de 30g (1/2 fatia média)" vira 30 g e "1/2 fatia média", que é como
 * a etiqueta e o totem montam "Porção de 30 g (1/2 fatia média)"; a medida
 * caseira vai em minúsculas, porque parte do cadastro está em caixa alta. O número sem
 * unidade conta como gramas; porção em ml, ou num formato que não dá para ler,
 * fica inteira na descrição. Texto sem número é modelo não preenchido.
 */
export function totemPorcaoDoSistemaAnterior(texto: string | null | undefined): {
  porcaoG: number | null;
  porcaoDescricao: string | null;
} {
  const t = limpo(texto, 200);
  if (!t || !/\d/.test(t)) return { porcaoG: null, porcaoDescricao: null };

  const achado = GRAMAS.exec(t) ?? SEM_UNIDADE.exec(t);
  const gramas = achado ? Number(achado[1]!.replace(',', '.')) : NaN;
  if (Number.isFinite(gramas) && gramas > 0) {
    const caseira = MEDIDA_CASEIRA.exec(t);
    return { porcaoG: gramas, porcaoDescricao: caseira ? limpo(caseira[1]!.toLocaleLowerCase('pt-BR'), 120) : null };
  }
  if (achado) return { porcaoG: null, porcaoDescricao: null };
  return { porcaoG: null, porcaoDescricao: limpo(t.replace(/^porção de\s*/iu, ''), 120) };
}

/** Código para o produto que o sistema anterior guardou sem código; o id antigo o mantém igual a cada importação. */
export function totemCodigoDoSistemaAnterior(a: Pick<TotemProdutoAntigo, 'id' | 'productcode'>): string {
  return limpo(a.productcode, 40) ?? `SC-${a.id}`;
}

export function totemProdutoDoSistemaAnterior(a: TotemProdutoAntigo): TotemGestaoProdutoCriar {
  const nutricional = fichaNutricional(a);
  return TotemGestaoProdutoCriarSchema.parse({
    codigo: totemCodigoDoSistemaAnterior(a),
    nome: limpo(a.name, 160),
    composicao: limpo(a.composition, 2000),
    beneficios: limpo(a.benefits, 2000),
    sugestoes: limpo(a.suggestions, 2000),
    ...totemPorcaoDoSistemaAnterior(a.portion),
    nutricional,
    selos: SELOS.filter(([campo]) => a[campo] === 1).map(([, selo]) => selo),
    fonteNutricional: nutricional.length > 0 ? TOTEM_FONTE_DO_SISTEMA_ANTERIOR : null,
    ativo: true,
  });
}
