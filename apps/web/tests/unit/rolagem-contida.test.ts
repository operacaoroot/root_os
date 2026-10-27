/**
 * @vitest-environment jsdom
 *
 * A trava da roda do mouse do popup do Chat (leva 5, L7). O jsdom não calcula
 * layout: as medidas (`scrollHeight`, `clientHeight`, `scrollTop`) são postas à
 * mão em cada elemento, e o que se prova é a REGRA: a roda só segue para o
 * navegador quando algum container entre o alvo e a raiz consegue consumi-la
 * na direção pedida; senão o evento morre dentro do popup.
 */
import { describe, expect, it } from 'vitest';
import { algoRolaDentro, conterRodaDoMouse, rolavelNaDirecao } from '@/components/whatsapp/rolagem-contida';

function elemento(o: { overflowY?: string; scrollHeight: number; clientHeight: number; scrollTop?: number }): HTMLDivElement {
  const el = document.createElement('div');
  if (o.overflowY) el.style.overflowY = o.overflowY;
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => o.scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => o.clientHeight });
  let topo = o.scrollTop ?? 0;
  Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => topo, set: (v: number) => { topo = v; } });
  return el;
}

describe('rolavelNaDirecao', () => {
  it('container que não transborda não rola, mesmo com overflow auto', () => {
    const el = elemento({ overflowY: 'auto', scrollHeight: 300, clientHeight: 300 });
    expect(rolavelNaDirecao(el, 10)).toBe(false);
    expect(rolavelNaDirecao(el, -10)).toBe(false);
  });

  it('no topo só rola para baixo; no fim só rola para cima; no meio, os dois', () => {
    const noTopo = elemento({ overflowY: 'auto', scrollHeight: 1000, clientHeight: 300, scrollTop: 0 });
    expect(rolavelNaDirecao(noTopo, 10)).toBe(true);
    expect(rolavelNaDirecao(noTopo, -10)).toBe(false);
    const noFim = elemento({ overflowY: 'auto', scrollHeight: 1000, clientHeight: 300, scrollTop: 700 });
    expect(rolavelNaDirecao(noFim, 10)).toBe(false);
    expect(rolavelNaDirecao(noFim, -10)).toBe(true);
    const noMeio = elemento({ overflowY: 'scroll', scrollHeight: 1000, clientHeight: 300, scrollTop: 200 });
    expect(rolavelNaDirecao(noMeio, 10)).toBe(true);
    expect(rolavelNaDirecao(noMeio, -10)).toBe(true);
  });

  it('elemento sem overflow vertical nunca conta', () => {
    const el = elemento({ scrollHeight: 1000, clientHeight: 300 });
    expect(rolavelNaDirecao(el, 10)).toBe(false);
  });
});

describe('algoRolaDentro e conterRodaDoMouse', () => {
  function popup() {
    const raiz = elemento({ scrollHeight: 600, clientHeight: 600 });
    const lista = elemento({ overflowY: 'auto', scrollHeight: 2000, clientHeight: 400, scrollTop: 0 });
    const balao = elemento({ scrollHeight: 40, clientHeight: 40 });
    lista.appendChild(balao);
    raiz.appendChild(lista);
    document.body.appendChild(raiz);
    return { raiz, lista, balao };
  }

  it('sobe do alvo até a raiz procurando quem consegue rolar na direção', () => {
    const { raiz, lista, balao } = popup();
    expect(algoRolaDentro(balao, raiz, 10)).toBe(true);
    expect(algoRolaDentro(balao, raiz, -10)).toBe(false);
    lista.scrollTop = 1600;
    expect(algoRolaDentro(balao, raiz, 10)).toBe(false);
    expect(algoRolaDentro(balao, raiz, -10)).toBe(true);
  });

  it('alvo fora da raiz não conta (a trava só olha para dentro do popup)', () => {
    const { raiz } = popup();
    const fora = elemento({ overflowY: 'auto', scrollHeight: 2000, clientHeight: 400 });
    document.body.appendChild(fora);
    expect(algoRolaDentro(fora, raiz, 10)).toBe(false);
  });

  it('a roda que ninguém consome dentro do popup é cancelada; a que a lista consome, não', () => {
    const { raiz, lista, balao } = popup();
    const soltar = conterRodaDoMouse(raiz);
    const rodar = (deltaY: number) => {
      const e = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true });
      balao.dispatchEvent(e);
      return e.defaultPrevented;
    };
    // No topo: descer rola a lista (segue); subir não tem para onde ir (cancelada).
    expect(rodar(10)).toBe(false);
    expect(rodar(-10)).toBe(true);
    // No fim: o contrário.
    lista.scrollTop = 1600;
    expect(rodar(10)).toBe(true);
    expect(rodar(-10)).toBe(false);
    // Zoom (Ctrl) e roda horizontal não são da nossa conta.
    const zoom = new WheelEvent('wheel', { deltaY: 10, ctrlKey: true, bubbles: true, cancelable: true });
    balao.dispatchEvent(zoom);
    expect(zoom.defaultPrevented).toBe(false);
    soltar();
    expect(rodar(-10)).toBe(false);
  });

  it('sem raiz, não faz nada e devolve uma função que também não faz nada', () => {
    expect(() => conterRodaDoMouse(null)()).not.toThrow();
  });
});
