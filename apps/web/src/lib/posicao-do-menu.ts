/*
 * ONDE UM MENU FLUTUANTE ABRE (produção 22B, I1, 22/10/2026).
 *
 * "A caixa do menu é maior que a coluna e corta o texto." O menu do "⋯" da
 * árvore abre por portal, fixo na janela, e a conta de onde ele cabe é esta,
 * pura, para o teste medir nas três larguras (390, 768 e 1440 px):
 *  · a largura é a pedida, mas nunca mais larga que a janela menos as margens;
 *  · alinha a borda direita do menu com a do botão (o "⋯" fica na ponta direita
 *    da linha); sem espaço à esquerda, alinha pela esquerda do botão; e sempre
 *    fica dentro da janela;
 *  · abre para baixo; sem espaço embaixo, abre para cima; sem espaço nos dois,
 *    fica do lado que tem mais e ganha altura máxima com rolagem própria.
 * O resultado sempre cabe: `left >= margem`, `left + largura <= janela - margem`,
 * `top >= margem` e `top + altura <= janela - margem` (com `maxAltura` quando
 * a altura foi cortada).
 */

export interface Retangulo { top: number; left: number; right: number; bottom: number }
export interface Janela { largura: number; altura: number }

export interface PosicaoDoMenu {
  top: number;
  left: number;
  largura: number;
  /** Só quando o menu não cabe inteiro: a altura com rolagem. */
  maxAltura: number | null;
  lado: 'baixo' | 'cima';
}

export const MARGEM_DO_MENU = 8;
const DISTANCIA = 4;

export function posicaoDoMenu(
  ancora: Retangulo,
  menu: { largura: number; altura: number },
  janela: Janela,
  margem = MARGEM_DO_MENU,
): PosicaoDoMenu {
  const largura = Math.max(0, Math.min(menu.largura, janela.largura - 2 * margem));
  const maxLeft = janela.largura - margem - largura;
  let left = ancora.right - largura;
  if (left < margem) left = ancora.left;
  left = Math.min(Math.max(left, margem), Math.max(margem, maxLeft));

  const embaixo = janela.altura - margem - (ancora.bottom + DISTANCIA);
  const emCima = ancora.top - DISTANCIA - margem;
  if (menu.altura <= embaixo) return { top: ancora.bottom + DISTANCIA, left, largura, maxAltura: null, lado: 'baixo' };
  if (menu.altura <= emCima) return { top: ancora.top - DISTANCIA - menu.altura, left, largura, maxAltura: null, lado: 'cima' };
  if (embaixo >= emCima) {
    const top = Math.min(ancora.bottom + DISTANCIA, janela.altura - margem);
    return { top, left, largura, maxAltura: Math.max(0, janela.altura - margem - top), lado: 'baixo' };
  }
  return { top: margem, left, largura, maxAltura: Math.max(0, emCima), lado: 'cima' };
}
