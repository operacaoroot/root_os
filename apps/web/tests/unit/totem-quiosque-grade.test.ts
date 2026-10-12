/**
 * A GRADE DE PRODUTOS COM O CATÁLOGO DE VERDADE: perto de mil produtos, quase
 * todos sem foto. A grade monta um lote por vez, volta ao primeiro lote quando
 * a lista é outra e o cartão sem foto mostra o nome e a categoria por extenso.
 */
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import { CartaoDoProduto } from '@/components/totem/quiosque/CartaoDoProduto';
import { GradeDeProdutos, LOTE_DA_GRADE } from '@/components/totem/quiosque/GradeDeProdutos';
import { produtoDeExemplo } from '../totem-quiosque-dados';

afterEach(cleanup);

const CATALOGO = Array.from({ length: 980 }, (_, i) =>
  produtoDeExemplo({ nome: `Produto ${String(i + 1).padStart(3, '0')}`, codigo: String(1000 + i), categoria: 'Grãos' }),
);

function cartoes() {
  return screen.getAllByRole('button', { name: /Cód\./ });
}

describe('GradeDeProdutos', () => {
  it('monta um lote por vez e o botão do pé traz o próximo', () => {
    render(createElement(GradeDeProdutos, { produtos: CATALOGO, chave: 'todos', aoAbrir: () => {} }));
    expect(cartoes()).toHaveLength(LOTE_DA_GRADE);

    fireEvent.click(screen.getByRole('button', { name: `Mostrar mais (faltam ${980 - LOTE_DA_GRADE})` }));
    expect(cartoes()).toHaveLength(LOTE_DA_GRADE * 2);
  });

  it('lista curta não ganha botão, e lista nova volta ao primeiro lote', () => {
    const { rerender } = render(
      createElement(GradeDeProdutos, { produtos: CATALOGO, chave: 'todos', aoAbrir: () => {} }),
    );
    fireEvent.click(screen.getByRole('button', { name: /Mostrar mais/ }));
    expect(cartoes()).toHaveLength(LOTE_DA_GRADE * 2);

    rerender(createElement(GradeDeProdutos, { produtos: CATALOGO, chave: 'busca:pro', aoAbrir: () => {} }));
    expect(cartoes()).toHaveLength(LOTE_DA_GRADE);

    rerender(createElement(GradeDeProdutos, { produtos: CATALOGO.slice(0, 5), chave: 'busca:produto 00', aoAbrir: () => {} }));
    expect(cartoes()).toHaveLength(5);
    expect(screen.queryByRole('button', { name: /Mostrar mais/ })).not.toBeInTheDocument();
  });

  it('a sincronia que troca o catálogo com a mesma chave não encolhe a grade', () => {
    const { rerender } = render(
      createElement(GradeDeProdutos, { produtos: CATALOGO, chave: 'todos', aoAbrir: () => {} }),
    );
    fireEvent.click(screen.getByRole('button', { name: /Mostrar mais/ }));
    rerender(createElement(GradeDeProdutos, { produtos: [...CATALOGO], chave: 'todos', aoAbrir: () => {} }));
    expect(cartoes()).toHaveLength(LOTE_DA_GRADE * 2);
  });

  it('o toque no cartão entrega o produto', () => {
    const aoAbrir = vi.fn();
    render(createElement(GradeDeProdutos, { produtos: CATALOGO.slice(0, 3), chave: 'x', aoAbrir }));
    fireEvent.click(screen.getByRole('button', { name: /Produto 002/ }));
    expect(aoAbrir).toHaveBeenCalledExactlyOnceWith(CATALOGO[1]);
  });
});

describe('CartaoDoProduto', () => {
  it('sem foto, vira etiqueta com categoria e nome por extenso', () => {
    const produto = produtoDeExemplo({
      nome: 'Castanha-do-pará',
      codigo: '0042',
      categoria: 'Castanhas',
      imagemUrl: null,
      selos: ['vegano', 'sem_gluten'],
    });
    render(createElement(CartaoDoProduto, { produto, aoAbrir: () => {} }));
    const cartao = screen.getByRole('button');
    expect(within(cartao).getByText('Castanha-do-pará')).toBeInTheDocument();
    expect(within(cartao).getByText('Castanhas')).toBeInTheDocument();
    expect(within(cartao).getByText('Cód. 0042')).toBeInTheDocument();
    expect(cartao.querySelector('img')).toBeNull();
  });

  it('foto que não carrega cai na etiqueta', () => {
    const produto = produtoDeExemplo({ nome: 'Granola', categoria: 'Cereais', imagemUrl: 'https://exemplo.test/g.jpg' });
    render(createElement(CartaoDoProduto, { produto, aoAbrir: () => {} }));
    const foto = screen.getByRole('button').querySelector('img');
    expect(foto).not.toBeNull();
    fireEvent.error(foto!);
    expect(screen.getByRole('button').querySelector('img')).toBeNull();
    expect(screen.getByText('Cereais')).toBeInTheDocument();
  });
});
