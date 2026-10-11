/**
 * A BUSCA DO QUIOSQUE — toda no aparelho, sem rede.
 *
 * O cliente digita de pé, num teclado de tela, com pressa: acento, maiúscula e
 * uma letra errada não podem esconder o produto. Palavra curta precisa vir
 * certa, senão "pai" acharia "pão". E quem casa pelo nome vem antes de quem
 * casa só pelo selo ou pela categoria.
 */
import { describe, expect, it } from 'vitest';

import {
  buscarProdutos,
  categoriasDoCatalogo,
  distanciaDeEdicao,
  indexarProdutos,
  produtosEmOrdem,
  termosDaConsulta,
} from '@/components/totem/quiosque/busca';
import { produtoDeExemplo } from '../totem-quiosque-dados';

const produtos = [
  produtoDeExemplo({ nome: 'Castanha-do-pará', categoria: 'Castanhas e nozes' }),
  produtoDeExemplo({ nome: 'Granola tradicional', categoria: 'Cereais', selos: ['integral'] }),
  produtoDeExemplo({ nome: 'Açúcar mascavo', categoria: 'Açúcares' }),
  produtoDeExemplo({ nome: 'Pão de queijo', categoria: 'Congelados' }),
  produtoDeExemplo({ nome: 'Farinha de amêndoas', categoria: 'Farinhas', selos: ['sem_gluten'] }),
  produtoDeExemplo({ nome: 'Arroz integral', categoria: 'Cereais' }),
  produtoDeExemplo({ nome: 'Amendoim torrado', categoria: 'Castanhas e nozes' }),
];
const indice = indexarProdutos(produtos);
const nomes = (consulta: string) => buscarProdutos(indice, consulta).map((p) => p.nome);

describe('buscarProdutos', () => {
  it('ignora acento dos dois lados', () => {
    expect(nomes('acucar')).toEqual(['Açúcar mascavo']);
    expect(nomes('amêndoas')[0]).toBe('Farinha de amêndoas');
    expect(nomes('pao')).toEqual(['Pão de queijo']);
  });

  it('ignora maiúscula e minúscula', () => {
    expect(nomes('CASTANHA')[0]).toBe('Castanha-do-pará');
    expect(nomes('GrAnOlA')).toEqual(['Granola tradicional']);
  });

  it('acha com uma letra trocada, faltando ou sobrando', () => {
    expect(nomes('granila')).toEqual(['Granola tradicional']);
    expect(nomes('castnha')[0]).toBe('Castanha-do-pará');
    expect(nomes('mascavvo')).toEqual(['Açúcar mascavo']);
  });

  it('acha com duas letras vizinhas trocadas de lugar', () => {
    expect(nomes('granloa')).toEqual(['Granola tradicional']);
  });

  it('acha pelo começo da palavra, ainda pela metade', () => {
    expect(nomes('cast')[0]).toBe('Castanha-do-pará');
    expect(nomes('amend')).toEqual(['Amendoim torrado', 'Farinha de amêndoas']);
  });

  it('acha palavra pela metade e com erro', () => {
    expect(nomes('grabol')).toEqual(['Granola tradicional']);
  });

  it('exige palavra curta escrita certa', () => {
    expect(nomes('pai')).toEqual([]);
  });

  it('exige que toda palavra digitada case, ignorando "de", "do" e afins', () => {
    expect(nomes('farinha de amendoa')).toEqual(['Farinha de amêndoas']);
    expect(nomes('pao de queijo')).toEqual(['Pão de queijo']);
    expect(nomes('farinha castanha')).toEqual([]);
  });

  it('põe quem casa pelo nome antes de quem casa só pelo selo ou pela categoria', () => {
    expect(nomes('integral')).toEqual(['Arroz integral', 'Granola tradicional']);
    // O amendoim está na categoria "Castanhas e nozes": aparece, mas depois.
    expect(nomes('castanha')).toEqual(['Castanha-do-pará', 'Amendoim torrado']);
  });

  it('acha pela categoria e pelo selo', () => {
    expect(nomes('sem gluten')).toEqual(['Farinha de amêndoas']);
    expect(nomes('nozes')).toEqual(['Amendoim torrado', 'Castanha-do-pará']);
  });

  it('não acha nada com consulta vazia ou sem sentido', () => {
    expect(nomes('')).toEqual([]);
    expect(nomes('   ')).toEqual([]);
    expect(nomes('xyzwq')).toEqual([]);
  });
});

describe('peças da busca', () => {
  it('distanciaDeEdicao conta a troca de vizinhas como um erro só', () => {
    expect(distanciaDeEdicao('granola', 'granola')).toBe(0);
    expect(distanciaDeEdicao('granloa', 'granola')).toBe(1);
    expect(distanciaDeEdicao('granila', 'granola')).toBe(1);
    expect(distanciaDeEdicao('abc', 'xyz')).toBe(3);
    expect(distanciaDeEdicao('castanha', 'c', 1)).toBe(2);
  });

  it('termosDaConsulta tira as palavras vazias, a não ser que só sobrem elas', () => {
    expect(termosDaConsulta('Pão de Queijo')).toEqual(['pao', 'queijo']);
    expect(termosDaConsulta('de')).toEqual(['de']);
  });

  it('lista as categorias em ordem e filtra os produtos por uma delas', () => {
    expect(categoriasDoCatalogo(produtos)).toEqual([
      'Açúcares',
      'Castanhas e nozes',
      'Cereais',
      'Congelados',
      'Farinhas',
    ]);
    expect(produtosEmOrdem(produtos, 'Cereais').map((p) => p.nome)).toEqual(['Arroz integral', 'Granola tradicional']);
    expect(produtosEmOrdem(produtos, null)).toHaveLength(produtos.length);
  });
});
