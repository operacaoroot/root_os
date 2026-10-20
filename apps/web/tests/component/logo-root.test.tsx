import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import {
  ALTURA_DA_LOGO,
  LARGURA_DA_LOGO_ABERTA,
  LARGURA_DA_LOGO_RECOLHIDA,
  LogoRoot,
} from '@/components/LogoRoot';

/*
 * A logo do menu (rodada da interface, 20/10/2026, U1, item 1 da ata): a logo oficial,
 * nunca redigitada em fonte. Recolhida, só o R; aberta, a palavra ROOT, com o R no mesmo
 * lugar. Cores pelo tema; nada escrito ao lado.
 */

const ORIGEM = readFileSync(join(__dirname, '..', '..', 'public', 'marca', 'ROOT-logo-principal-TRANSPARENTE.svg'), 'utf8');
const caminhosDaOrigem = (cor: string) =>
  [...ORIGEM.matchAll(/<path fill="(#[0-9a-f]+)" fill-rule="evenodd" d="([^"]+)"/g)]
    .filter(([, fill]) => fill === cor)
    .flatMap(([, , d]) => ('M' + d.replace(/\s+/g, ' ')).split('M').filter((s) => s.trim()).map((s) => `M${s.trim()}`));

function renderizar(recolhida: boolean) {
  const { container } = render(<LogoRoot recolhida={recolhida} />);
  const raiz = container.querySelector<HTMLElement>('[data-logo-root]')!;
  return { container, raiz, svg: raiz.querySelector('svg')! };
}

describe('LogoRoot', () => {
  it('é desenho, não texto: nenhuma letra escrita, nada de "ROOT OS"', () => {
    for (const recolhida of [false, true]) {
      const { container, svg } = renderizar(recolhida);
      expect(container.textContent).toBe('');
      expect(container.querySelector('text')).toBeNull();
      expect(svg.querySelectorAll('path').length).toBeGreaterThan(0);
    }
  });

  it('é decorativa: o nome acessível fica no link que a envolve', () => {
    const { raiz, svg } = renderizar(false);
    expect(raiz).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('focusable', 'false');
  });

  it('os caminhos são os do arquivo oficial da marca, separados em R e resto', () => {
    const { svg } = renderizar(false);
    const doDesenho = (parte: string, camada: string) =>
      svg.querySelector(`[data-parte="${parte}"] [data-camada="${camada}"]`)!.getAttribute('d')!;
    for (const [camada, cor] of [['verde', '#9bdb1f'], ['magenta', '#ff1f6b'], ['ciano', '#1fffa8']] as const) {
      const r = doDesenho('r', camada);
      const resto = doDesenho('resto', camada);
      const juntos = `${r} ${resto}`.replace(/\s+/g, ' ');
      for (const sub of caminhosDaOrigem(cor)) expect(juntos, `${camada}: caminho do arquivo oficial ausente`).toContain(sub);
      expect(r.length, `${camada}: o R tem desenho próprio`).toBeGreaterThan(0);
    }
    // A palavra pequena "OPERAÇÃO" (cor #dfffe8) fica de fora: no menu ela não se lê.
    expect(svg.innerHTML).not.toContain(caminhosDaOrigem('#dfffe8')[0]);
  });

  it('aberta: a palavra inteira; recolhida: a moldura encolhe ao R e o resto apaga (só de 820 px para cima)', () => {
    const aberta = renderizar(false);
    expect(aberta.raiz).toHaveAttribute('data-forma', 'aberta');
    expect(aberta.raiz.className).toContain(`w-[${LARGURA_DA_LOGO_ABERTA}px]`);
    expect(aberta.raiz.className).not.toContain('min-[820px]:w-');
    expect(aberta.svg.querySelector('[data-parte="resto"]')!.getAttribute('class')).not.toContain('opacity-0');

    const recolhida = renderizar(true);
    expect(recolhida.raiz).toHaveAttribute('data-forma', 'recolhida');
    expect(recolhida.raiz.className).toContain(`min-[820px]:w-[${LARGURA_DA_LOGO_RECOLHIDA}px]`);
    expect(recolhida.svg.querySelector('[data-parte="resto"]')!.getAttribute('class')).toContain('min-[820px]:opacity-0');
  });

  it('o R fica no mesmo lugar nas duas formas: mesmo desenho, mesma escala, mesma origem', () => {
    const a = renderizar(false).svg;
    const r = renderizar(true).svg;
    expect(r.getAttribute('viewBox')).toBe(a.getAttribute('viewBox'));
    expect(r.getAttribute('width')).toBe(a.getAttribute('width'));
    expect(r.getAttribute('height')).toBe(String(ALTURA_DA_LOGO));
    // 28 a 32 px de altura, e o R recolhido cabe centrado nos 64 px do menu.
    expect(ALTURA_DA_LOGO).toBeGreaterThanOrEqual(28);
    expect(ALTURA_DA_LOGO).toBeLessThanOrEqual(32);
    expect(LARGURA_DA_LOGO_RECOLHIDA).toBeLessThan(64);
    // As classes literais batem com os números: a moldura recolhida mostra o R inteiro.
    const [, , largura, altura] = a.getAttribute('viewBox')!.split(' ').map(Number);
    expect(Math.round((largura * ALTURA_DA_LOGO) / altura)).toBe(LARGURA_DA_LOGO_ABERTA);
  });

  it('as cores vêm do tema: verde por currentColor, glitch pelas variáveis do tema', () => {
    const { svg } = renderizar(false);
    for (const verde of svg.querySelectorAll('[data-camada="verde"]')) expect(verde).toHaveAttribute('fill', 'currentColor');
    for (const m of svg.querySelectorAll<SVGPathElement>('[data-camada="magenta"]')) {
      expect(m.style.fill).toContain('--os-mag');
      // papel (light) sem glitch, como o --os-logo-shadow: none do tema
      expect(m.getAttribute('class')).toContain("[[data-os-theme='light']_&]:hidden");
    }
    for (const c of svg.querySelectorAll<SVGPathElement>('[data-camada="ciano"]')) {
      expect(c.style.fill).toContain('--os-cy');
      // contraste (mono) só com a magenta, como o --os-logo-shadow dele
      expect(c.getAttribute('class')).toContain("[[data-os-theme='mono']_&]:hidden");
    }
    expect(svg.innerHTML).not.toMatch(/#9bdb1f|#ff1f6b|#1fffa8/i);
  });
});
