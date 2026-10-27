'use client';

import { useEffect, useRef } from 'react';
import type { MemoriaGrafo } from '@mktos/shared';

/*
 * O grafo da Memória (portado do ROOT Estúdio): layout de forças feito à mão em
 * SVG, sem biblioteca. Arrasta nó, arrasta fundo, roda do mouse aproxima, clique abre.
 */

export const COR_DO_TIPO: Record<string, { cor: string; nome: string }> = {
  video: { cor: '#1F9E6E', nome: 'vídeo' },
  link: { cor: '#7FA61C', nome: 'link' },
  ideia: { cor: '#D9446F', nome: 'ideia' },
  nota: { cor: '#4D6B8A', nome: 'nota' },
  tag: { cor: '#A7AE9C', nome: 'tag' },
};

const NS = 'http://www.w3.org/2000/svg';
const el = (tag: string, attrs: Record<string, string | number> = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

interface No { id: string; label: string; type: string; x: number; y: number; vx: number; vy: number; r: number }

export function GrafoDaMemoria(props: { grafo: MemoriaGrafo; onNota: (id: string) => void; onTag: (tag: string) => void }) {
  const caixa = useRef<HTMLDivElement>(null);
  const onNota = useRef(props.onNota);
  const onTag = useRef(props.onTag);
  onNota.current = props.onNota;
  onTag.current = props.onTag;

  useEffect(() => {
    const box = caixa.current;
    if (!box) return;
    const g = props.grafo;
    const W = Math.max(320, box.clientWidth || 800);
    const H = Math.max(420, Math.min(680, Math.round(W * 0.62)));
    const grau: Record<string, number> = {};
    g.links.forEach((l) => {
      grau[l.source] = (grau[l.source] ?? 0) + 1;
      grau[l.target] = (grau[l.target] ?? 0) + 1;
    });
    const porId = new Map<string, No>();
    const nos: No[] = g.nodes.map((n, i) => {
      const a = i * 2.399963;
      const r = 50 + 24 * Math.sqrt(i);
      const d = grau[n.id] ?? 0;
      const o = { ...n, x: W / 2 + r * Math.cos(a), y: H / 2 + r * Math.sin(a), vx: 0, vy: 0, r: n.type === 'tag' ? 4 + Math.min(5, d) : 7 + Math.min(8, 2.4 * Math.sqrt(d)) };
      porId.set(n.id, o);
      return o;
    });
    const ligacoes = g.links.map((l) => ({ s: porId.get(l.source)!, t: porId.get(l.target)! })).filter((l) => l.s && l.t);

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'w-full touch-none select-none', role: 'img', 'aria-label': 'Grafo das notas' }) as SVGSVGElement;
    const raiz = el('g');
    const gl = el('g');
    const gn = el('g');
    raiz.append(gl, gn);
    svg.append(raiz);
    box.innerHTML = '';
    box.append(svg);
    const linhas = ligacoes.map((l) => {
      const e = el('line', { stroke: 'currentColor', 'stroke-opacity': l.s.type === 'tag' || l.t.type === 'tag' ? 0.18 : 0.35, 'stroke-width': 1 });
      gl.append(e);
      return e;
    });
    const grupos = nos.map((n) => {
      const grp = el('g', { class: 'cursor-pointer' });
      grp.append(el('circle', { r: n.r, fill: COR_DO_TIPO[n.type]?.cor ?? '#888' }));
      const t = el('text', { x: n.r + 4, y: 4, 'font-size': 11, fill: 'currentColor', 'fill-opacity': n.type === 'tag' ? 0.55 : 0.85 });
      t.textContent = n.label.length > 30 ? n.label.slice(0, 28) + '…' : n.label;
      grp.append(t);
      const titulo = el('title');
      titulo.textContent = n.label;
      grp.append(titulo);
      gn.append(grp);
      return grp;
    });

    const vista = { k: 1, x: 0, y: 0 };
    const aplicarVista = () => raiz.setAttribute('transform', `translate(${vista.x} ${vista.y}) scale(${vista.k})`);
    const pintar = () => {
      ligacoes.forEach((l, i) => {
        linhas[i].setAttribute('x1', String(l.s.x));
        linhas[i].setAttribute('y1', String(l.s.y));
        linhas[i].setAttribute('x2', String(l.t.x));
        linhas[i].setAttribute('y2', String(l.t.y));
      });
      nos.forEach((n, i) => grupos[i].setAttribute('transform', `translate(${n.x.toFixed(1)} ${n.y.toFixed(1)})`));
    };

    let alfa = 1;
    let raf = 0;
    let arraste: { no?: No; pan?: boolean; x0: number; y0: number; vx?: number; vy?: number; mexeu: boolean } | null = null;
    const passo = () => {
      for (let i = 0; i < nos.length; i++) for (let j = i + 1; j < nos.length; j++) {
        const a = nos[i];
        const b = nos[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const d2 = dx * dx + dy * dy || 0.01;
        if (d2 > 160000) continue;
        const f = (12000 / d2) * alfa;
        const d = Math.sqrt(d2);
        dx /= d;
        dy /= d;
        a.vx -= dx * f;
        a.vy -= dy * f;
        b.vx += dx * f;
        b.vy += dy * f;
      }
      for (const l of ligacoes) {
        const repouso = l.s.type === 'tag' || l.t.type === 'tag' ? 85 : 130;
        let dx = l.t.x - l.s.x;
        let dy = l.t.y - l.s.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const f = (d - repouso) * 0.014 * alfa;
        dx /= d;
        dy /= d;
        l.s.vx += dx * f;
        l.s.vy += dy * f;
        l.t.vx -= dx * f;
        l.t.vy -= dy * f;
      }
      for (const n of nos) {
        n.vx += (W / 2 - n.x) * 0.003 * alfa;
        n.vy += (H / 2 - n.y) * 0.007 * alfa;
        if (n === arraste?.no) {
          n.vx = n.vy = 0;
          continue;
        }
        n.vx *= 0.7;
        n.vy *= 0.7;
        n.x = Math.min(W - 24, Math.max(24, n.x + n.vx));
        n.y = Math.min(H - 18, Math.max(18, n.y + n.vy));
      }
      pintar();
      alfa = Math.max(arraste?.no ? 0.3 : 0, alfa * 0.993);
      if ((alfa > 0.01 || arraste?.no) && svg.isConnected) raf = requestAnimationFrame(passo);
    };
    const aquecer = (a = 0.5) => {
      alfa = Math.max(alfa, a);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(passo);
    };
    const escala = () => W / svg.getBoundingClientRect().width;
    const local = (e: PointerEvent) => {
      const p = svg.getBoundingClientRect();
      const sx = W / p.width;
      return { x: ((e.clientX - p.left) * sx - vista.x) / vista.k, y: ((e.clientY - p.top) * sx - vista.y) / vista.k };
    };
    grupos.forEach((grp, i) =>
      grp.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        svg.setPointerCapture((e as PointerEvent).pointerId);
        arraste = { no: nos[i], x0: (e as PointerEvent).clientX, y0: (e as PointerEvent).clientY, mexeu: false };
        aquecer(0.3);
      }),
    );
    svg.addEventListener('pointerdown', (e) => {
      if (arraste) return;
      svg.setPointerCapture(e.pointerId);
      arraste = { pan: true, x0: e.clientX, y0: e.clientY, vx: vista.x, vy: vista.y, mexeu: false };
    });
    svg.addEventListener('pointermove', (e) => {
      if (!arraste) return;
      if (Math.abs(e.clientX - arraste.x0) + Math.abs(e.clientY - arraste.y0) > 4) arraste.mexeu = true;
      if (arraste.pan) {
        const sx = escala();
        vista.x = arraste.vx! + (e.clientX - arraste.x0) * sx;
        vista.y = arraste.vy! + (e.clientY - arraste.y0) * sx;
        aplicarVista();
      } else if (arraste.no) {
        const p = local(e);
        arraste.no.x = p.x;
        arraste.no.y = p.y;
        pintar();
      }
    });
    svg.addEventListener('pointerup', () => {
      const d = arraste;
      arraste = null;
      if (d?.no && !d.mexeu) {
        if (d.no.type === 'tag') onTag.current(d.no.id.slice(4));
        else onNota.current(d.no.id);
      }
    });
    svg.addEventListener('pointercancel', () => {
      arraste = null;
    });
    svg.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const p = svg.getBoundingClientRect();
        const sx = W / p.width;
        const mx = (e.clientX - p.left) * sx;
        const my = (e.clientY - p.top) * sx;
        const k = Math.min(4, Math.max(0.3, vista.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        vista.x = mx - (mx - vista.x) * (k / vista.k);
        vista.y = my - (my - vista.y) * (k / vista.k);
        vista.k = k;
        aplicarVista();
      },
      { passive: false },
    );
    aplicarVista();
    aquecer(1);
    return () => {
      cancelAnimationFrame(raf);
      box.innerHTML = '';
    };
  }, [props.grafo]);

  return <div ref={caixa} className="rounded border border-border bg-surface text-text" />;
}
