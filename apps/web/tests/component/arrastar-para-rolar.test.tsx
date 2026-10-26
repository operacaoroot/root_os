import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ArrastarParaRolar } from '@/components/ArrastarParaRolar';

// No jsdom nada tem largura: a área "larga" é simulada (rola de lado, 1000px dentro de 300px).
function Quadro({ onAbrir }: { onAbrir: () => void }) {
  return (
    <div data-testid="area" style={{ overflowX: 'auto' }}>
      <div data-testid="vazio">coluna</div>
      <div data-testid="cartao" draggable="true" onClick={onAbrir}>cartão</div>
      <button type="button" onClick={onAbrir}>abrir</button>
    </div>
  );
}

function montar() {
  const onAbrir = vi.fn();
  render(<><ArrastarParaRolar /><Quadro onAbrir={onAbrir} /></>);
  const area = screen.getByTestId('area');
  Object.defineProperty(area, 'scrollWidth', { configurable: true, value: 1000 });
  Object.defineProperty(area, 'clientWidth', { configurable: true, value: 300 });
  area.scrollLeft = 200;
  return { area, onAbrir };
}

describe('a mãozinha: arrastar um espaço livre rola a área larga', () => {
  it('arrastar o espaço vazio para a esquerda leva a área para a direita', () => {
    const { area } = montar();
    fireEvent.mouseOver(screen.getByTestId('vazio'));
    expect(area.hasAttribute('data-arrastavel')).toBe(true);
    fireEvent.mouseDown(screen.getByTestId('vazio'), { button: 0, clientX: 500, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 380, clientY: 100 });
    expect(area.scrollLeft).toBe(320);
    expect(document.documentElement.hasAttribute('data-arrastando')).toBe(true);
    fireEvent.mouseUp(window);
    expect(document.documentElement.hasAttribute('data-arrastando')).toBe(false);
  });

  it('cartão que se arrasta e botão continuam como eram', () => {
    const { area, onAbrir } = montar();
    fireEvent.mouseDown(screen.getByTestId('cartao'), { button: 0, clientX: 500, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 300, clientY: 100 });
    fireEvent.mouseUp(window);
    expect(area.scrollLeft).toBe(200);
    fireEvent.click(screen.getByRole('button', { name: 'abrir' }));
    expect(onAbrir).toHaveBeenCalledTimes(1);
  });

  it('o clique que vem ao soltar um arrasto não abre nada', () => {
    const { onAbrir } = montar();
    fireEvent.mouseDown(screen.getByTestId('vazio'), { button: 0, clientX: 500, clientY: 100 });
    fireEvent.mouseMove(window, { clientX: 400, clientY: 100 });
    fireEvent.mouseUp(window);
    fireEvent.click(screen.getByRole('button', { name: 'abrir' }));
    expect(onAbrir).not.toHaveBeenCalled();
  });
});
