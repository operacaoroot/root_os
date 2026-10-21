'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

/*
 * As colunas do resumo de tarefas, no molde do ClickUp (número em cima, nome
 * embaixo) e na paleta da casa: um acento só (o lima, cheio, médio ou fraco) e
 * vermelho apenas para problema (atrasada). Clicar vira filtro da lista.
 *
 * Rodada de produção 1 (21/10/2026, P1): o gráfico CABE NA CAIXA em qualquer
 * largura e o balão fica DENTRO dela.
 *
 *  · Sem rolagem lateral: as colunas dividem a largura (flex-1, min-w-0) e o
 *    nome quebra em até duas linhas; o nome inteiro está no balão. Quando a
 *    largura não comporta uma coluna legível por item (`LARGURA_MINIMA_DA_COLUNA`),
 *    o gráfico vira BARRAS HORIZONTAIS, uma linha por item: muitas listas fazem
 *    o gráfico crescer para baixo, nunca para o lado.
 *  · O balão é um só por gráfico, posicionado por conta (`posicaoDoBalao`) a
 *    partir do retângulo da caixa, do alvo e do próprio balão: tenta em cima,
 *    depois à direita, à esquerda, embaixo e, sem espaço nenhum, dentro, preso
 *    às bordas. Vale para a primeira e a última coluna.
 *  · Mouse abre no hover; teclado abre no foco; no toque, o primeiro toque abre
 *    o balão (sem navegar), o segundo no mesmo item navega, e tocar fora fecha.
 */

export interface Fatia {
  chave: string;
  rotulo: string;
  valor: number;
  cor: string;
  dica?: string;
  onClick?: () => void;
}

/** A largura, em px, que uma coluna precisa para o número e duas linhas de nome. */
export const LARGURA_MINIMA_DA_COLUNA = 64;

export type Orientacao = 'auto' | 'colunas' | 'horizontal';

/** As colunas cabem nesta largura? Largura desconhecida (0) cabe até seis itens. */
export function cabemColunas(largura: number, itens: number): boolean {
  if (!largura) return itens <= 6;
  return itens * LARGURA_MINIMA_DA_COLUNA <= largura;
}

export interface Retangulo {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type LadoDoBalao = 'cima' | 'direita' | 'esquerda' | 'baixo' | 'dentro';

const limitar = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));

/**
 * Onde o balão fica, em coordenadas DA CAIXA (left/top relativos a ela), para
 * que o retângulo dele caiba inteiro no retângulo da caixa. O balão maior que a
 * caixa é encolhido à largura dela (quem renderiza põe `max-width: 100%`).
 */
export function posicaoDoBalao(caixa: Retangulo, alvo: Retangulo, balao: { width: number; height: number }, margem = 6): { left: number; top: number; lado: LadoDoBalao } {
  const w = Math.min(balao.width, caixa.width);
  const h = Math.min(balao.height, caixa.height);
  const aLeft = alvo.left - caixa.left;
  const aTop = alvo.top - caixa.top;
  const aRight = aLeft + alvo.width;
  const aBottom = aTop + alvo.height;
  const centroX = limitar(aLeft + alvo.width / 2 - w / 2, 0, Math.max(0, caixa.width - w));
  const topoAoLado = limitar(aTop, 0, Math.max(0, caixa.height - h));

  if (aTop - margem - h >= 0) return { left: centroX, top: aTop - margem - h, lado: 'cima' };
  if (aRight + margem + w <= caixa.width) return { left: aRight + margem, top: topoAoLado, lado: 'direita' };
  if (aLeft - margem - w >= 0) return { left: aLeft - margem - w, top: topoAoLado, lado: 'esquerda' };
  if (aBottom + margem + h <= caixa.height) return { left: centroX, top: aBottom + margem, lado: 'baixo' };
  return { left: centroX, top: limitar(aTop, 0, Math.max(0, caixa.height - h)), lado: 'dentro' };
}

function retanguloDe(el: Element): Retangulo {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/** A largura da caixa, medida agora e a cada mudança de tamanho. */
function useLargura(ref: React.RefObject<HTMLElement | null>): number {
  const [largura, setLargura] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => setLargura(el.clientWidth || 0);
    medir();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(medir);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', medir);
    return () => window.removeEventListener('resize', medir);
  }, [ref]);
  return largura;
}

/** Colunas (ou barras horizontais) com o número, o nome, o balão dentro da caixa e o clique. */
export function Barras({
  itens,
  altura = 176,
  chamada = 'clique para ver as tarefas',
  orientacao = 'auto',
}: {
  itens: Fatia[];
  altura?: number;
  chamada?: string;
  orientacao?: Orientacao;
}) {
  const max = Math.max(1, ...itens.map((i) => i.valor));
  const caixaRef = useRef<HTMLDivElement | null>(null);
  const balaoRef = useRef<HTMLDivElement | null>(null);
  const alvos = useRef(new Map<string, HTMLElement>());
  const largura = useLargura(caixaRef);
  const [aberto, setAberto] = useState<{ chave: string; porToque: boolean } | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; lado: LadoDoBalao } | null>(null);
  const toque = useRef(false);
  const idDoBalao = useId();

  const modo: 'colunas' | 'horizontal' = orientacao === 'auto' ? (cabemColunas(largura, itens.length) ? 'colunas' : 'horizontal') : orientacao;
  const item = aberto ? itens.find((i) => i.chave === aberto.chave) ?? null : null;

  const abrir = useCallback((chave: string, porToque = false) => setAberto({ chave, porToque }), []);
  const fechar = useCallback(() => {
    setAberto(null);
    setPos(null);
  }, []);

  // Mede depois de o balão existir (invisível) e põe-no dentro da caixa.
  useLayoutEffect(() => {
    if (!aberto) return;
    const caixa = caixaRef.current;
    const alvo = alvos.current.get(aberto.chave);
    const balao = balaoRef.current;
    if (!caixa || !alvo || !balao) return;
    const b = retanguloDe(balao);
    setPos(posicaoDoBalao(retanguloDe(caixa), retanguloDe(alvo), { width: b.width, height: b.height }));
  }, [aberto, modo, largura]);

  // Aberto pelo toque: tocar fora fecha. Esc fecha sempre.
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: Event) => {
      if (caixaRef.current && e.target instanceof Node && caixaRef.current.contains(e.target)) return;
      fechar();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') fechar();
    };
    document.addEventListener('pointerdown', fora);
    document.addEventListener('touchstart', fora);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', fora);
      document.removeEventListener('touchstart', fora);
      document.removeEventListener('keydown', esc);
    };
  }, [aberto, fechar]);

  const marcarToque = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') toque.current = true;
  };

  const propsDoItem = (i: Fatia) => ({
    onClick: (e: React.MouseEvent) => {
      const veioDoToque = toque.current;
      toque.current = false;
      // O primeiro toque só mostra o balão; o segundo, no mesmo item, navega.
      if (veioDoToque && aberto?.chave !== i.chave) {
        e.preventDefault();
        abrir(i.chave, true);
        return;
      }
      if (i.onClick && i.valor > 0) i.onClick();
    },
    onPointerDown: marcarToque,
    onTouchStart: () => {
      toque.current = true;
    },
    onMouseEnter: () => {
      if (!aberto?.porToque) abrir(i.chave);
    },
    onMouseLeave: () => {
      if (!aberto?.porToque) fechar();
    },
    onFocus: () => {
      if (!aberto?.porToque) abrir(i.chave);
    },
    onBlur: () => {
      if (!aberto?.porToque) fechar();
    },
    'aria-label': `${i.rotulo}: ${i.valor}`,
    'aria-describedby': aberto?.chave === i.chave ? idDoBalao : undefined,
    'aria-disabled': !i.onClick || i.valor === 0 ? true : undefined,
    'data-chave': i.chave,
  });

  const guardarAlvo = (chave: string) => (el: HTMLElement | null) => {
    if (el) alvos.current.set(chave, el);
    else alvos.current.delete(chave);
  };

  return (
    <div ref={caixaRef} className="relative min-w-0" data-grafico-caixa="" data-orientacao={modo} data-colunas={modo === 'colunas' ? itens.length : undefined}>
      {modo === 'colunas' ? (
        <>
          <div className="flex items-end gap-2 border-b border-border sm:gap-3" style={{ height: altura }}>
            {itens.map((i) => (
              <button
                key={i.chave}
                type="button"
                {...propsDoItem(i)}
                className={`relative flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1 rounded-t-sm ${i.onClick && i.valor > 0 ? 'hover:bg-surface-2' : 'cursor-default'}`}
              >
                <span ref={guardarAlvo(i.chave)} className="flex w-full flex-col items-center gap-1">
                  <span className="com-num text-[0.8rem] font-bold">{i.valor}</span>
                  <span
                    className="w-full max-w-[64px] rounded-t-[4px]"
                    style={{ height: `${(i.valor / max) * (altura - 28)}px`, minHeight: i.valor ? 3 : 0, background: i.cor }}
                  />
                </span>
              </button>
            ))}
          </div>
          <div className="mt-1.5 flex gap-2 sm:gap-3">
            {itens.map((i) => (
              <span
                key={i.chave}
                className="line-clamp-2 min-w-0 flex-1 text-center text-xs leading-tight text-muted [overflow-wrap:anywhere]"
                title={i.rotulo}
              >
                {i.rotulo}
              </span>
            ))}
          </div>
        </>
      ) : (
        <ul className="space-y-1.5">
          {itens.map((i) => (
            <li key={i.chave}>
              <button
                type="button"
                {...propsDoItem(i)}
                ref={guardarAlvo(i.chave) as React.Ref<HTMLButtonElement>}
                className={`grid w-full min-w-0 grid-cols-[minmax(0,38%)_minmax(0,1fr)_auto] items-center gap-2 rounded-sm px-1 py-1 text-left ${i.onClick && i.valor > 0 ? 'hover:bg-surface-2' : 'cursor-default'}`}
              >
                <span className="line-clamp-2 min-w-0 text-xs leading-tight text-muted [overflow-wrap:anywhere]" title={i.rotulo}>
                  {i.rotulo}
                </span>
                <span className="block h-3 min-w-0">
                  <span
                    className="block h-full rounded-r-[4px]"
                    style={{ width: `${(i.valor / max) * 100}%`, minWidth: i.valor ? 3 : 0, background: i.cor }}
                  />
                </span>
                <span className="com-num text-right text-[0.8rem] font-bold">{i.valor}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {item && (
        <div
          ref={balaoRef}
          id={idDoBalao}
          role="tooltip"
          data-balao=""
          data-lado={pos?.lado}
          className="pointer-events-none absolute z-20 w-max max-w-[16rem] rounded-md border border-border bg-surface-3 px-3 py-1.5 text-left text-xs shadow-lg"
          style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, maxWidth: '100%', visibility: pos ? 'visible' : 'hidden' }}
        >
          <span className="block font-semibold text-text [overflow-wrap:anywhere]">
            {item.rotulo}: {item.valor}
          </span>
          {item.dica && <span className="block text-muted">{item.dica}</span>}
          {item.onClick && item.valor > 0 && (
            <span className="mt-0.5 block text-brand">{aberto?.porToque ? 'toque de novo para ver as tarefas' : chamada}</span>
          )}
        </div>
      )}
    </div>
  );
}
