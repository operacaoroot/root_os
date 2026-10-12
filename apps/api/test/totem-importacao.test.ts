import { describe, it, expect } from 'vitest';
import {
  TOTEM_FONTE_DO_SISTEMA_ANTERIOR,
  TotemProdutoAntigoSchema,
  totemCodigoDoSistemaAnterior,
  totemPorcaoDoSistemaAnterior,
  totemProdutoDoSistemaAnterior,
  type TotemProdutoAntigo,
} from '../src/totem/gestao/importacao';

const ZERADO = {
  energetic: 0,
  energeticvd: 0,
  carbohydrates: 0,
  carbohydratesvd: 0,
  proteins: 0,
  proteinsvd: 0,
  totalfat: 0,
  totalfatvd: 0,
  saturatedfat: 0,
  saturatedfatvd: 0,
  transfat: 0,
  fiber: 0,
  fibervd: 0,
  sodium: 0,
  sodiumvd: 0,
};

function antigo(dados: Partial<TotemProdutoAntigo> = {}): TotemProdutoAntigo {
  return TotemProdutoAntigoSchema.parse({
    id: 492,
    name: 'Abacaxi Cristalizado',
    productcode: '103',
    composition: 'Abacaxi, açúcar e conservantes.',
    benefits: '',
    suggestions: 'Pode ser consumido como sobremesa.',
    portion: 'Porção de 30g (1/2 fatia media)',
    gluten: 1,
    lactose: 1,
    transgenic: 1,
    conservants: 0,
    sugar: 0,
    vegan: 1,
    ...ZERADO,
    energetic: 106,
    energeticvd: 5.3,
    carbohydrates: 25.7,
    carbohydratesvd: 8.5,
    sodium: 0.3,
    ...dados,
  });
}

describe('importação do catálogo do sistema anterior', () => {
  it('leva os textos, os selos marcados com 1 e a tabela por porção', () => {
    const p = totemProdutoDoSistemaAnterior(antigo());
    expect(p).toMatchObject({
      codigo: '103',
      nome: 'Abacaxi Cristalizado',
      composicao: 'Abacaxi, açúcar e conservantes.',
      beneficios: null,
      sugestoes: 'Pode ser consumido como sobremesa.',
      porcaoG: 30,
      porcaoDescricao: '1/2 fatia media',
      selos: ['sem_gluten', 'sem_lactose', 'nao_transgenico', 'vegano'],
      fonteNutricional: TOTEM_FONTE_DO_SISTEMA_ANTERIOR,
      ativo: true,
    });
    expect(p.nutricional).toHaveLength(8);
    expect(p.nutricional![0]).toEqual({ nutriente: 'Valor energético', quantidade: 106, unidade: 'kcal', vd: 5.3 });
    expect(p.nutricional!.find((n) => n.nutriente === 'Gorduras trans')!.vd).toBeNull();
    expect(p.nutricional!.find((n) => n.nutriente === 'Sódio')).toMatchObject({ quantidade: 0.3, unidade: 'mg' });
  });

  it('tabela toda zerada entra como produto sem ficha e sem fonte', () => {
    const p = totemProdutoDoSistemaAnterior(antigo(ZERADO));
    expect(p.nutricional).toEqual([]);
    expect(p.fonteNutricional).toBeNull();
  });

  it('produto sem código ganha um código fixo pelo id antigo', () => {
    expect(totemCodigoDoSistemaAnterior({ id: 77, productcode: null })).toBe('SC-77');
    expect(totemCodigoDoSistemaAnterior({ id: 77, productcode: '  ' })).toBe('SC-77');
    expect(totemCodigoDoSistemaAnterior({ id: 77, productcode: ' 0412 ' })).toBe('0412');
  });

  it('espaços sobrando saem dos textos', () => {
    const p = totemProdutoDoSistemaAnterior(antigo({ name: '  Bombom vegano  s/ açúcar ', composition: '   ' }));
    expect(p.nome).toBe('Bombom vegano s/ açúcar');
    expect(p.composicao).toBeNull();
  });

  it.each([
    ['Porção de 30g (1/2 fatia media)', 30, '1/2 fatia media'],
    ['Porção de 40 g (2 colheres de sopa)', 40, '2 colheres de sopa'],
    ['25 gramas (1 colher de sopa)', 25, '1 colher de sopa'],
    ['20 g (2 UNIDADES)', 20, '2 unidades'],
    ['30 g', 30, null],
    ['12,5g', 12.5, null],
    ['1 grama', 1, null],
    ['50 (3 colheres de sopa)', 50, '3 colheres de sopa'],
    ['100', 100, null],
    ['15 ml (1 colher de sopa)', null, '15 ml (1 colher de sopa)'],
    ['Porção de 200 ml (1 copo)', null, '200 ml (1 copo)'],
    ['0', null, null],
    ['Porção de g ( colher de )', null, null],
    ['', null, null],
  ])('porção "%s"', (texto, porcaoG, porcaoDescricao) => {
    expect(totemPorcaoDoSistemaAnterior(texto)).toEqual({ porcaoG, porcaoDescricao });
  });

  it('não confunde "grãos" com gramas', () => {
    expect(totemPorcaoDoSistemaAnterior('30 grãos')).toEqual({ porcaoG: null, porcaoDescricao: '30 grãos' });
  });

  it('recusa item que não tem a forma do sistema anterior', () => {
    expect(TotemProdutoAntigoSchema.safeParse({ id: 1, name: 'X' }).success).toBe(false);
    expect(TotemProdutoAntigoSchema.safeParse({ ...antigo(), energetic: -1 }).success).toBe(false);
  });
});
