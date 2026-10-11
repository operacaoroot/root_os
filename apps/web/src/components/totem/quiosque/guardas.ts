'use client';

import { useEffect, useRef } from 'react';

import { ehLinkDaPrivacidade, linkPermitido } from './formato';

/*
 * O QUE FAZ DO NAVEGADOR UM QUIOSQUE. O travamento de verdade é do sistema
 * (docs/totem/TRAVAMENTO.md); estas guardas cobrem o que a página alcança:
 * tela cheia, menu de contexto, seleção, zoom, links para fora de `/totem`,
 * volta ao início por inatividade e o gesto escondido da manutenção.
 */

const CANTO_PX = 64;
const TOQUES_DA_MANUTENCAO = 5;
const JANELA_DOS_TOQUES_MS = 3000;

function ehCampoDeTexto(alvo: EventTarget | null): boolean {
  return alvo instanceof HTMLElement && (alvo.tagName === 'INPUT' || alvo.tagName === 'TEXTAREA' || alvo.isContentEditable);
}

/** Toques no canto superior esquerdo, em sequência curta. Puro para o teste. */
export function contarToquesNoCanto(toques: number[], agora: number): { toques: number[]; abrir: boolean } {
  const recentes = [...toques.filter((t) => agora - t <= JANELA_DOS_TOQUES_MS), agora];
  if (recentes.length >= TOQUES_DA_MANUTENCAO) return { toques: [], abrir: true };
  return { toques: recentes, abrir: false };
}

export function aplicarGuardas(alvo: Document | Window, aoPrivacidade: (url: string) => void): () => void {
  const opcoesAtivas: AddEventListenerOptions = { passive: false };
  const bloquear = (e: Event) => e.preventDefault();
  const selecao = (e: Event) => {
    if (!ehCampoDeTexto(e.target)) e.preventDefault();
  };
  const toqueComDoisDedos = (e: Event) => {
    if ((e as TouchEvent).touches?.length > 1) e.preventDefault();
  };
  const rodaComCtrl = (e: Event) => {
    if ((e as WheelEvent).ctrlKey) e.preventDefault();
  };
  const atalhoDeZoom = (e: Event) => {
    const k = e as KeyboardEvent;
    if ((k.ctrlKey || k.metaKey) && ['+', '-', '=', '0'].includes(k.key)) k.preventDefault();
  };
  const clique = (e: Event) => {
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a) return;
    const href = a.getAttribute('href') ?? '';
    const origem = window.location.origin;
    if (ehLinkDaPrivacidade(href, origem)) {
      e.preventDefault();
      aoPrivacidade(new URL(href, origem).href);
      return;
    }
    if (!linkPermitido(href, origem) || (a.target && a.target !== '_self')) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const ouvintes: [string, EventListener, AddEventListenerOptions | boolean][] = [
    ['contextmenu', bloquear, false],
    ['dragstart', bloquear, false],
    ['gesturestart', bloquear, opcoesAtivas],
    ['selectstart', selecao, false],
    ['touchmove', toqueComDoisDedos, opcoesAtivas],
    ['wheel', rodaComCtrl, opcoesAtivas],
    ['keydown', atalhoDeZoom, false],
    ['click', clique, true],
  ];
  for (const [tipo, fn, op] of ouvintes) alvo.addEventListener(tipo, fn, op);
  return () => {
    for (const [tipo, fn, op] of ouvintes) alvo.removeEventListener(tipo, fn, op);
  };
}

export function useGuardasDoQuiosque(opcoes: {
  aoPrivacidade: (url: string) => void;
  aoManutencao: () => void;
  aoAtividade: () => void;
}) {
  const ref = useRef(opcoes);
  ref.current = opcoes;

  useEffect(() => {
    const desfazer = aplicarGuardas(document, (url) => ref.current.aoPrivacidade(url));
    let toques: number[] = [];

    const tocou = (e: PointerEvent) => {
      ref.current.aoAtividade();
      if (e.clientX > CANTO_PX || e.clientY > CANTO_PX) return;
      const r = contarToquesNoCanto(toques, Date.now());
      toques = r.toques;
      if (r.abrir) ref.current.aoManutencao();
    };
    // Tela cheia precisa de gesto do usuário; no toque, o gesto que vale é o
    // soltar do dedo, não o encostar.
    const telaCheia = () => {
      if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
      document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
    };
    const tecla = () => ref.current.aoAtividade();

    document.addEventListener('pointerdown', tocou, true);
    document.addEventListener('pointerup', telaCheia, true);
    document.addEventListener('keydown', tecla, true);
    return () => {
      desfazer();
      document.removeEventListener('pointerdown', tocou, true);
      document.removeEventListener('pointerup', telaCheia, true);
      document.removeEventListener('keydown', tecla, true);
    };
  }, []);
}

/** Chama `aoOcioso` uma vez depois de `ms` sem atividade; `tocar` rearma. */
export function useOciosidade(ms: number, aoOcioso: () => void, ligado: boolean) {
  const ref = useRef(aoOcioso);
  ref.current = aoOcioso;
  const relogio = useRef<ReturnType<typeof setTimeout> | null>(null);
  const msRef = useRef(ms);
  msRef.current = ms;
  const ligadoRef = useRef(ligado);
  ligadoRef.current = ligado;

  const tocar = useRef(() => {
    if (relogio.current) clearTimeout(relogio.current);
    relogio.current = null;
    if (!ligadoRef.current) return;
    relogio.current = setTimeout(() => {
      relogio.current = null;
      ref.current();
    }, msRef.current);
  }).current;

  useEffect(() => {
    tocar();
    return () => {
      if (relogio.current) clearTimeout(relogio.current);
    };
  }, [ligado, ms, tocar]);

  return tocar;
}

/**
 * Registra o service worker do quiosque (só no build de produção: em
 * desenvolvimento ele guardaria os pedaços do hot reload) e manda para ele os
 * arquivos de `/_next/static` que esta página já carregou, que vieram antes
 * de ele existir.
 */
export function useServiceWorkerDoQuiosque() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    let cancelado = false;
    void (async () => {
      try {
        await navigator.serviceWorker.register('/totem/sw.js', { scope: '/totem/' });
        const registro = await navigator.serviceWorker.ready;
        if (cancelado) return;
        const urls = performance
          .getEntriesByType('resource')
          .map((r) => r.name)
          .filter((u) => {
            try {
              const url = new URL(u);
              return url.origin === window.location.origin && url.pathname.startsWith('/_next/static/');
            } catch {
              return false;
            }
          });
        registro.active?.postMessage({ tipo: 'guardar', urls });
      } catch {
        /* sem service worker o quiosque funciona igual enquanto houver rede */
      }
    })();
    return () => {
      cancelado = true;
    };
  }, []);
}
