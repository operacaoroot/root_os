'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { modulosDeNavegacao, destinoDaRota, areaDoDestino } from './navegacao-modulos';
import * as Icons from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useEhPlataforma } from '@/lib/plataforma';
import { useModulos } from './modulos';
import { textoDoSelo, tituloDoSelo, useCaixa } from './caixa';

type IconName = keyof typeof Icons;

export type TemaOs = 'dark' | 'light' | 'mono';

export const CHAVE_TEMA = 'root-os:tema';
// Menu lateral recolhido no desktop (só ícones). Preferência deste navegador.
const CHAVE_RECOLHIDO = 'root-os:menu-recolhido';

// Mantida para não quebrar importações; o menu por áreas não usa o estado antigo.
export const CHAVE_MENU = 'root-os:menu-fechado';

const TEMAS: { id: TemaOs; rotulo: string }[] = [
  { id: 'dark', rotulo: 'escuro' },
  { id: 'light', rotulo: 'papel' },
  { id: 'mono', rotulo: 'claro' },
];

export function lerTema(): TemaOs {
  try {
    const v = localStorage.getItem(CHAVE_TEMA);
    if (v === 'dark' || v === 'light' || v === 'mono') return v;
  } catch {
    /* localStorage bloqueado (janela privada, cookies off) — cai no escuro */
  }
  return 'dark';
}

export function Sidebar() {
  const { user } = useAuth();
  const { modulos } = useModulos();
  const caixa = useCaixa();
  const pathname = usePathname();
  const [tema, setTema] = useState<TemaOs>('dark');
  const [abertaNoMovel, setAbertaNoMovel] = useState(false);
  const [recolhida, setRecolhida] = useState(false);
  const botaoAbrir = useRef<HTMLButtonElement>(null);
  const botaoFechar = useRef<HTMLButtonElement>(null);
  // O primeiro efeito de tema roda com o estado inicial 'dark', antes do
  // estado lido do localStorage chegar. Sem esta guarda ele gravaria 'dark'
  // por cima da escolha do usuário se o componente desmontasse no meio.
  const primeiraPintura = useRef(true);

  const ehPlataforma = useEhPlataforma();
  const destino = destinoDaRota(pathname, ehPlataforma);
  const areaAtiva = destino && areaDoDestino(destino)?.key;
  const areas = modulosDeNavegacao(user?.permissions ?? [], modulos ?? undefined, ehPlataforma);
  const seloDaCaixa = { texto: textoDoSelo(caixa), titulo: tituloDoSelo(caixa) };

  useEffect(() => { setTema(lerTema()); }, []);
  useEffect(() => {
    try { setRecolhida(localStorage.getItem(CHAVE_RECOLHIDO) === '1'); } catch { /* sem persistência */ }
  }, []);
  function alternarRecolhida() {
    setRecolhida((r) => {
      try { localStorage.setItem(CHAVE_RECOLHIDO, r ? '0' : '1'); } catch { /* sem persistência */ }
      return !r;
    });
  }
  // No celular a barra abre inteira; recolher só vale de 820px para cima.
  const compacta = recolhida && !abertaNoMovel;

  useEffect(() => {
    setAbertaNoMovel(false);
  }, [pathname]);

  useEffect(() => {
    if (!abertaNoMovel) return;
    const overflowBody = document.body.style.overflow;
    const overflowHtml = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    // A barra parte de visibility:hidden. Em movimento reduzido, focar logo
    // após o clique pode ocorrer antes de ela ficar visível e o foco falha.
    let timerDoFoco: number;
    function focarQuandoVisivel() {
      const botao = botaoFechar.current;
      if (botao && getComputedStyle(botao).visibility === 'visible') botao.focus();
      else timerDoFoco = window.setTimeout(focarQuandoVisivel, 16);
    }
    timerDoFoco = window.setTimeout(focarQuandoVisivel, 0);
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setAbertaNoMovel(false);
        botaoAbrir.current?.focus();
      } else if (e.key === 'Tab') {
        const dialogo = document.getElementById('root-os-nav');
        const controles = Array.from(
          dialogo?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [],
        ).filter((el) => el.getClientRects().length > 0);
        if (!controles.length) return;
        const primeiro = controles[0];
        const ultimo = controles[controles.length - 1];
        if (e.shiftKey && document.activeElement === primeiro) {
          e.preventDefault();
          ultimo.focus();
        } else if (!e.shiftKey && document.activeElement === ultimo) {
          e.preventDefault();
          primeiro.focus();
        }
      }
    }
    window.addEventListener('keydown', aoTeclar);
    return () => {
      window.removeEventListener('keydown', aoTeclar);
      window.clearTimeout(timerDoFoco);
      document.body.style.overflow = overflowBody;
      document.documentElement.style.overflow = overflowHtml;
    };
  }, [abertaNoMovel]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const desktop = window.matchMedia('(min-width: 820px)');
    function aoMudarLargura(e: MediaQueryListEvent) {
      const focoNaBarra = document.getElementById('root-os-nav')?.contains(document.activeElement);
      setAbertaNoMovel(false);
      if (abertaNoMovel || focoNaBarra) {
        if (e.matches) document.getElementById('root-os-main')?.focus();
        else botaoAbrir.current?.focus();
      }
    }
    desktop.addEventListener('change', aoMudarLargura);
    return () => desktop.removeEventListener('change', aoMudarLargura);
  }, [abertaNoMovel]);

  function aoNavegar() {
    if (!abertaNoMovel) return;
    setAbertaNoMovel(false);
    requestAnimationFrame(() => document.getElementById('root-os-main')?.focus());
  }

  useEffect(() => {
    document.documentElement.setAttribute('data-os-theme', tema);
    if (primeiraPintura.current) {
      primeiraPintura.current = false;
      return;
    }
    try {
      localStorage.setItem(CHAVE_TEMA, tema);
    } catch {
      /* sem persistência: o tema vale só para esta aba */
    }
  }, [tema]);

  return (
    <>
      <button
        ref={botaoAbrir}
        type="button"
        aria-label="Abrir navegação"
        aria-controls="root-os-nav"
        aria-expanded={abertaNoMovel}
        onClick={() => setAbertaNoMovel(true)}
        className="fixed left-1 top-1 z-40 grid h-11 w-11 place-items-center text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand min-[820px]:hidden"
      >
        <Icons.Menu size={20} aria-hidden />
      </button>
      {abertaNoMovel && (
        <button
          type="button"
          aria-label="Fechar navegação"
          onClick={() => { setAbertaNoMovel(false); botaoAbrir.current?.focus(); }}
          className="fixed inset-0 z-[45] bg-black/70 min-[820px]:hidden"
        />
      )}
      <aside
        id="root-os-nav"
        role={abertaNoMovel ? 'dialog' : undefined}
        aria-modal={abertaNoMovel ? true : undefined}
        aria-label="Navegação do ROOT OS"
        className={[
          'fixed inset-y-0 left-0 z-50 flex h-dvh w-[min(288px,calc(100vw-48px))] flex-col border-r border-border bg-bg2 font-os-mono transition-transform duration-200 min-[820px]:sticky min-[820px]:h-screen min-[820px]:shrink-0 min-[820px]:translate-x-0 min-[820px]:transition-[width]',
          compacta ? 'min-[820px]:w-[64px]' : 'min-[820px]:w-[252px]',
          abertaNoMovel ? 'translate-x-0 visible' : '-translate-x-full invisible min-[820px]:visible',
        ].join(' ')}
      >
      {/* marca */}
      <div className="flex min-h-[56px] items-center gap-[10px] border-b border-border px-[14px]">
        <span
          aria-hidden
          className="inline-block text-[16px] font-extrabold italic leading-none tracking-[-0.05em] text-brand"
          style={{ transform: 'skewX(-10deg)', textShadow: 'var(--os-logo-shadow, none)' }}
        >
          R
        </span>
        <span className={`min-w-0 flex-1 leading-[1.25] ${compacta ? 'min-[820px]:hidden' : ''}`}>
          <span className="block text-[12px] font-bold tracking-[-0.02em] text-text">
            ROOT OS
          </span>
          <span className="block truncate text-[9px] uppercase tracking-[0.15em] text-muted">
            operação root
          </span>
        </span>
        <button
          type="button"
          onClick={alternarRecolhida}
          aria-label={compacta ? 'Expandir menu' : 'Recolher menu'}
          aria-pressed={compacta}
          title={compacta ? 'Expandir menu' : 'Recolher menu'}
          className="hidden h-8 w-8 shrink-0 place-items-center text-muted hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand min-[820px]:grid"
        >
          {compacta ? <Icons.ChevronsRight size={16} aria-hidden /> : <Icons.ChevronsLeft size={16} aria-hidden />}
        </button>
        <button ref={botaoFechar} type="button" aria-label="Fechar navegação" onClick={() => { setAbertaNoMovel(false); botaoAbrir.current?.focus(); }} className="grid h-11 w-11 place-items-center text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand min-[820px]:hidden"><Icons.X size={18} aria-hidden /></button>
      </div>

      <nav aria-label="Destinos" className="min-h-0 flex-1 overflow-y-auto px-2 py-4">
        <p className={`px-3 pb-3 text-[10px] uppercase tracking-[0.14em] text-muted ${compacta ? 'min-[820px]:sr-only' : ''}`}>Áreas da empresa</p>
        {areas.map((area) => {
          const Icon = (Icons[area.icon as IconName] ?? Icons.Circle) as React.ElementType;
          const ativo = area.key === areaAtiva;
          return <Link key={area.key} href={area.entrada.href} onClick={aoNavegar}
            aria-current={ativo ? 'true' : undefined}
            title={compacta ? area.label : undefined}
            className={`relative mb-1 flex min-h-11 items-center gap-3 rounded-root px-3 py-3 text-[12px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${ativo ? 'bg-brand/10 font-semibold text-brand' : 'text-muted hover:bg-surface-2 hover:text-text'}`}>
            <Icon size={18} aria-hidden className="shrink-0" />
            <span className={`flex-1 ${compacta ? 'min-[820px]:sr-only' : ''}`}>{area.label}</span>
            {/* O selo do que espera por você (Pendências) fica na área Dia a dia, cuja entrada é a Visão geral (versão final, 19/10/2026). */}
            {area.key === 'dia' && seloDaCaixa.texto &&
              // Recolhido (só ícones, 64 px), o selo sobe para o canto do ícone em vez de empurrar para fora da barra.
              <span aria-label={seloDaCaixa.titulo} title={seloDaCaixa.titulo} className={`bg-brand px-1.5 py-0.5 text-[10px] font-bold text-ink ${compacta ? 'min-[820px]:absolute min-[820px]:right-1 min-[820px]:top-1 min-[820px]:px-1 min-[820px]:py-0 min-[820px]:text-[9px]' : ''}`}>{seloDaCaixa.texto}</span>}
            {ativo && !compacta && <Icons.ChevronRight size={14} aria-hidden />}
          </Link>;
        })}
      </nav>

      {/* rodapé: os três temas */}
      <div
        role="group"
        aria-label="Tema da interface"
        className={`flex flex-row items-center gap-[6px] border-t border-border px-3 py-[9px] ${compacta ? 'min-[820px]:hidden' : ''}`}
      >
        {TEMAS.map((t) => {
          const on = tema === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTema(t.id)}
              aria-pressed={on}
              className={[
                'min-h-11 flex-1 cursor-pointer border py-[5px] font-os-mono text-[9px] uppercase tracking-[0.12em] transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand min-[820px]:min-h-0',
                on
                  ? 'border-brand bg-brand text-ink'
                  : 'border-border text-muted hover:border-border-strong hover:text-text',
              ].join(' ')}
            >
              {t.rotulo}
            </button>
          );
        })}
      </div>
      </aside>
    </>
  );
}
