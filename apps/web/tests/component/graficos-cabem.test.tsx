import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { Barras, LARGURA_MINIMA_DA_COLUNA, posicaoDoBalao, type Fatia } from '@/components/tarefas/graficos';

/*
 * P1 da rodada de produção 1 (21/10/2026): "Carga por prazo" e "Tarefas por
 * lista" cabem sempre na caixa, de 390 a 1920 px, sem rolagem lateral, e o
 * balão do hover fica dentro da caixa, inclusive na primeira e na última coluna.
 *
 * O jsdom não faz layout. A geometria é dublada a partir dos atributos que o
 * componente expõe: a caixa tem a largura da tela de teste; cada coluna ocupa
 * a fatia dela; o balão tem 200 x 56. `scrollWidth` da caixa é a largura
 * mínima do conteúdo: n colunas legíveis no modo de colunas, nada a mais nas
 * barras horizontais (cada linha é a largura da caixa).
 */

const BALAO = { width: 200, height: 56 };
const ALTURA = 176;
let LARGURA = 1440;

function itens(n: number, onClick?: (chave: string) => void): Fatia[] {
  return Array.from({ length: n }, (_, k) => ({
    chave: `c${k}`,
    rotulo: k === n - 1 ? 'Uma lista com um nome bem comprido que não cabe embaixo da coluna' : `Lista ${k + 1}`,
    valor: k === 0 ? 9 : k + 1,
    cor: '#000',
    dica: '2 atrasadas',
    onClick: onClick ? () => onClick(`c${k}`) : undefined,
  }));
}

function caixaDe(el: Element): HTMLElement | null {
  return (el as HTMLElement).closest('[data-grafico-caixa]');
}

function geometria(el: Element): DOMRect {
  const r = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
  const h = el as HTMLElement;
  if (h.hasAttribute('data-grafico-caixa')) {
    const n = h.querySelectorAll('[data-chave]').length;
    const altura = h.dataset.orientacao === 'colunas' ? ALTURA + 30 : n * 30;
    return r(0, 0, LARGURA, altura);
  }
  if (h.hasAttribute('data-balao')) return r(0, 0, Math.min(BALAO.width, LARGURA), BALAO.height);
  const botao = h.closest('[data-chave]') as HTMLElement | null;
  const caixa = caixaDe(h);
  if (botao && caixa) {
    const todos = [...caixa.querySelectorAll('[data-chave]')];
    const k = todos.indexOf(botao);
    if (caixa.dataset.orientacao === 'colunas') {
      const w = LARGURA / todos.length;
      // A primeira coluna é a mais alta (encosta no topo): o balão não cabe em cima.
      const topo = k === 0 ? 0 : 120;
      return r(k * w, topo, w, ALTURA - topo);
    }
    return r(0, k * 30, LARGURA, 28);
  }
  return r(0, 0, 0, 0);
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return geometria(this);
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.hasAttribute('data-grafico-caixa') ? LARGURA : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement) {
      if (!this.hasAttribute('data-grafico-caixa')) return 0;
      const n = Number(this.dataset.colunas ?? 0);
      return this.dataset.orientacao === 'colunas' ? Math.max(LARGURA, n * LARGURA_MINIMA_DA_COLUNA) : LARGURA;
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollWidth;
});

/** O retângulo do balão, nas coordenadas da caixa, pelo que o componente escreveu no estilo. */
function retanguloDoBalao() {
  const b = screen.getByRole('tooltip') as HTMLElement;
  expect(b.style.visibility).toBe('visible');
  const left = parseFloat(b.style.left);
  const top = parseFloat(b.style.top);
  return { left, top, right: left + Math.min(BALAO.width, LARGURA), bottom: top + BALAO.height };
}

function dentroDaCaixa() {
  const caixa = document.querySelector('[data-grafico-caixa]') as HTMLElement;
  const c = geometria(caixa);
  const b = retanguloDoBalao();
  expect(b.left).toBeGreaterThanOrEqual(0);
  expect(b.top).toBeGreaterThanOrEqual(0);
  expect(b.right).toBeLessThanOrEqual(c.width);
  expect(b.bottom).toBeLessThanOrEqual(c.height);
}

describe('P1 · os gráficos cabem na caixa em qualquer largura', () => {
  for (const largura of [390, 768, 1440]) {
    for (const n of [5, 13]) {
      it(`${n} itens em ${largura} px: sem rolagem lateral`, () => {
        LARGURA = largura;
        render(<Barras itens={itens(n)} />);
        const caixa = document.querySelector('[data-grafico-caixa]') as HTMLElement;
        expect(caixa.scrollWidth).toBeLessThanOrEqual(caixa.clientWidth);
        // Nada no gráfico pede rolagem nem impede a quebra do nome.
        expect(caixa.querySelector('.overflow-x-auto, .whitespace-nowrap')).toBeNull();
      });
    }
  }

  it('muitas listas no celular viram barras horizontais (cresce para baixo)', () => {
    LARGURA = 390;
    render(<Barras itens={itens(13)} />);
    expect(document.querySelector('[data-grafico-caixa]')?.getAttribute('data-orientacao')).toBe('horizontal');
  });

  it('a carga por prazo no celular continua em colunas', () => {
    LARGURA = 390;
    render(<Barras itens={itens(5)} />);
    expect(document.querySelector('[data-grafico-caixa]')?.getAttribute('data-orientacao')).toBe('colunas');
  });

  it('o nome comprido quebra (e o inteiro vai para o balão)', () => {
    LARGURA = 1440;
    render(<Barras itens={itens(5)} />);
    const nome = screen.getByTitle(/nome bem comprido/);
    expect(nome.className).toContain('line-clamp-2');
    fireEvent.mouseEnter(screen.getByRole('button', { name: /nome bem comprido/ }));
    expect(screen.getByRole('tooltip').textContent).toContain('Uma lista com um nome bem comprido que não cabe embaixo da coluna');
  });
});

describe('P1 · o balão fica dentro da caixa', () => {
  for (const largura of [390, 768, 1440]) {
    it(`primeira e última coluna em ${largura} px`, () => {
      LARGURA = largura;
      render(<Barras itens={itens(5)} />);
      const botoes = screen.getAllByRole('button');
      fireEvent.mouseEnter(botoes[0]);
      dentroDaCaixa();
      fireEvent.mouseLeave(botoes[0]);
      expect(screen.queryByRole('tooltip')).toBeNull();
      fireEvent.mouseEnter(botoes[botoes.length - 1]);
      dentroDaCaixa();
    });
  }

  it('primeira e última linha das barras horizontais', () => {
    LARGURA = 390;
    render(<Barras itens={itens(13)} />);
    const botoes = screen.getAllByRole('button');
    fireEvent.mouseEnter(botoes[0]);
    dentroDaCaixa();
    fireEvent.mouseLeave(botoes[0]);
    fireEvent.mouseEnter(botoes[botoes.length - 1]);
    dentroDaCaixa();
  });

  it('a conta escolhe o lado: em cima quando cabe, ao lado quando não, e nunca sai da caixa', () => {
    const caixa = { left: 0, top: 0, width: 300, height: 200 };
    const balao = { width: 120, height: 50 };
    expect(posicaoDoBalao(caixa, { left: 100, top: 120, width: 40, height: 80 }, balao).lado).toBe('cima');
    expect(posicaoDoBalao(caixa, { left: 0, top: 0, width: 40, height: 200 }, balao).lado).toBe('direita');
    expect(posicaoDoBalao(caixa, { left: 260, top: 0, width: 40, height: 200 }, balao).lado).toBe('esquerda');
    const apertada = posicaoDoBalao({ left: 0, top: 0, width: 100, height: 60 }, { left: 0, top: 0, width: 100, height: 60 }, { width: 140, height: 50 });
    expect(apertada.left).toBeGreaterThanOrEqual(0);
    expect(apertada.top).toBeGreaterThanOrEqual(0);
  });
});

describe('P1 · toque e teclado', () => {
  it('no toque: o primeiro toque abre sem navegar, tocar fora fecha, o segundo toque navega', () => {
    LARGURA = 390;
    const clicou = vi.fn();
    render(<Barras itens={itens(5, clicou)} />);
    const ultimo = screen.getAllByRole('button').at(-1)!;
    fireEvent.touchStart(ultimo);
    fireEvent.click(ultimo);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    expect(clicou).not.toHaveBeenCalled();
    dentroDaCaixa();

    act(() => {
      fireEvent.touchStart(document.body);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.touchStart(ultimo);
    fireEvent.click(ultimo);
    fireEvent.touchStart(ultimo);
    fireEvent.click(ultimo);
    expect(clicou).toHaveBeenCalledWith('c4');
  });

  it('o foco do teclado abre o balão e o Esc fecha', () => {
    LARGURA = 1440;
    render(<Barras itens={itens(5)} />);
    const b = screen.getAllByRole('button')[0];
    fireEvent.focus(b);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    expect(b.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('o mouse num item clicável navega no primeiro clique', () => {
    LARGURA = 1440;
    const clicou = vi.fn();
    render(<Barras itens={itens(5, clicou)} />);
    fireEvent.click(screen.getAllByRole('button')[1]);
    expect(clicou).toHaveBeenCalledWith('c1');
  });
});
