'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { modulosDeNavegacao, destinoDaRota, areaDoDestino, rotuloDoDestino } from './navegacao-modulos';
import * as Icons from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useEhPlataforma } from '@/lib/plataforma';
import { useModulos } from './modulos';
import { textoDoSelo, tituloDoSelo, useCaixa } from './caixa';
import { LogoRoot } from './LogoRoot';
import { BalaoDaArea } from './BalaoDaArea';

type IconName = keyof typeof Icons;

export type TemaOs = 'dark' | 'light' | 'mono';

export const CHAVE_TEMA = 'root-os:tema';
// Menu lateral recolhido no desktop (só ícones). Preferência deste navegador.
const CHAVE_RECOLHIDO = 'root-os:menu-recolhido';

// Mantida para não quebrar importações; o menu por áreas não usa o estado antigo.
export const CHAVE_MENU = 'root-os:menu-fechado';

/** A ponte de hover: o tempo que o balão espera antes de fechar quando o mouse sai do ícone. */
export const PONTE_DO_BALAO_MS = 150;

const TEMAS: { id: TemaOs; rotulo: string }[] = [
  { id: 'dark', rotulo: 'escuro' },
  { id: 'light', rotulo: 'papel' },
  { id: 'mono', rotulo: 'claro' },
];

/** O ícone de uma área no menu: âncora do balão e destino do foco quando ele fecha pelo Esc. */
function iconeDaArea(chave: string): HTMLAnchorElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector<HTMLAnchorElement>(`#root-os-nav a[data-area="${chave}"]`);
}

/**
 * O que o clique na área faz no menu aberto (I1, 22/10/2026). `fechar`: a área está
 * aberta e recolhe. `abrir`: é a área da tela atual, recolhida, e reabre sem sair da
 * tela. `navegar`: vai para a entrada da área (que abre o grupo dela e fecha o outro).
 * Área de um item só e o menu recolhido sempre navegam.
 */
export function passoDoAcordeao(a: { compacta: boolean; temLista: boolean; aberta: boolean; ativa: boolean }): 'fechar' | 'abrir' | 'navegar' {
  if (a.compacta || !a.temLista) return 'navegar';
  if (a.aberta) return 'fechar';
  if (a.ativa) return 'abrir';
  return 'navegar';
}

export function lerTema(): TemaOs {
  try {
    const v = localStorage.getItem(CHAVE_TEMA);
    if (v === 'dark' || v === 'light' || v === 'mono') return v;
  } catch {
    /* localStorage bloqueado (janela privada, cookies off) — cai no escuro */
  }
  return 'dark';
}

/*
 * O MENU LATERAL (rodada da interface, 20/10/2026, U1).
 *
 * As subseções saíram do campo principal (as abas de `NavegacaoDoModulo`) e moram só
 * aqui. Menu ABERTO: cada área é um grupo, e só a área aberta mostra as subseções,
 * indentadas, com a da rota atual em `aria-current="page"` (acordeão de uma aberta só;
 * clicar na área navega para a entrada dela e abre o grupo). Área com uma subseção só
 * não mostra lista. Menu RECOLHIDO (64 px, só de 820 px para cima): o ícone da área
 * abre o `BalaoDaArea` ao lado, por hover, foco ou toque, um balão por vez.
 *
 * No topo, a logo oficial (`LogoRoot`): só o R no recolhido, a palavra inteira no
 * aberto. Ela é o link para a entrada do Dia a dia.
 *
 * Produção 22B, I1 (22/10/2026), pedidos do Rodrigo:
 *  · o botão de recolher saiu do rodapé e fica logo à frente da logo, no topo
 *    esquerdo; no recolhido, o R e o botão ficam lado a lado;
 *  · o acordeão também FECHA: clicar de novo na área aberta recolhe as
 *    subseções, sem navegar; clicar na área da tela atual que estava recolhida
 *    reabre, sem navegar; clicar noutra área navega, abre a dela e fecha a
 *    anterior, como antes. A subseção da rota segue com `aria-current="page"`.
 */
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
  const inicio = areas.find((area) => area.key === 'dia')?.entrada.href ?? '/dia-a-dia';

  // O grupo aberto no menu aberto. Segue a rota; o clique na área abre na hora.
  const [areaAberta, setAreaAberta] = useState<string | undefined>(areaAtiva);
  useEffect(() => { setAreaAberta(areaAtiva); }, [areaAtiva]);

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

  // ---- O balão do menu recolhido: um por vez. ----
  const [balao, setBalao] = useState<string | null>(null);
  const balaoAberto = useRef<string | null>(null);
  balaoAberto.current = balao;
  const timerDoBalao = useRef<number | undefined>(undefined);
  const mouseNoBalao = useRef(false);
  // O foco que o Esc devolve ao ícone não reabre o balão.
  const focoDevolvido = useRef(false);
  // Veio de toque? No toque, o primeiro toque abre o balão em vez de navegar, e os eventos
  // de mouse e de foco que o navegador emula depois do toque não abrem nem navegam sozinhos.
  // Ponteiro de mouse ou tecla devolvem ao normal.
  const toque = useRef(false);

  const abrirBalao = useCallback((chave: string) => {
    window.clearTimeout(timerDoBalao.current);
    setBalao(chave);
  }, []);
  const fecharBalao = useCallback((devolverFoco = false) => {
    window.clearTimeout(timerDoBalao.current);
    const atual = balaoAberto.current;
    setBalao(null);
    if (devolverFoco && atual) {
      // O foco que volta ao ícone dispara o onFocus dele na hora (é síncrono), e a marca
      // impede que ele reabra o balão. Zerada logo depois: com o foco já no ícone (Esc
      // no próprio ícone) não há evento de foco, e a marca presa engoliria a abertura
      // do próximo ícone que recebesse foco.
      focoDevolvido.current = true;
      iconeDaArea(atual)?.focus();
      focoDevolvido.current = false;
    }
  }, []);
  // A ponte de hover: sair do ícone não fecha na hora, para dar tempo de entrar no balão.
  function fecharDepois() {
    window.clearTimeout(timerDoBalao.current);
    timerDoBalao.current = window.setTimeout(() => setBalao(null), PONTE_DO_BALAO_MS);
  }

  useEffect(() => { if (!compacta) setBalao(null); }, [compacta]);
  useEffect(() => { setBalao(null); }, [pathname]);
  useEffect(() => () => window.clearTimeout(timerDoBalao.current), []);
  useEffect(() => {
    if (!balao) return;
    // Toque ou clique fora do ícone e do balão fecha. Rolar o menu ou mudar a janela
    // também fecha: o balão é fixo na tela e ficaria longe do ícone.
    function aoTocarFora(e: PointerEvent) {
      const alvo = e.target as Element | null;
      if (alvo?.closest?.(`[data-grupo-da-area="${balao}"]`)) return;
      setBalao(null);
    }
    function aoMudarJanela() { setBalao(null); }
    // Esc fecha o balão aberto também com o foco fora dele (aberto pelo hover, com o foco
    // no conteúdo): dispensável sem mover o ponteiro (WCAG 1.4.13). O foco fica onde está.
    // Dentro do ícone ou do balão, quem trata o Esc são eles, e devolvem o foco ao ícone.
    function aoTeclarEsc(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      const alvo = e.target as Element | null;
      if (alvo?.closest?.(`[data-grupo-da-area="${balao}"]`)) return;
      window.clearTimeout(timerDoBalao.current);
      setBalao(null);
    }
    document.addEventListener('pointerdown', aoTocarFora);
    document.addEventListener('keydown', aoTeclarEsc);
    window.addEventListener('resize', aoMudarJanela);
    const nav = document.getElementById('root-os-destinos');
    nav?.addEventListener('scroll', aoMudarJanela);
    return () => {
      document.removeEventListener('pointerdown', aoTocarFora);
      document.removeEventListener('keydown', aoTeclarEsc);
      window.removeEventListener('resize', aoMudarJanela);
      nav?.removeEventListener('scroll', aoMudarJanela);
    };
  }, [balao]);

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
    setBalao(null);
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
          // `transform-none` no desktop: com `transform` o menu viraria a referência do
          // `position: fixed` e o balão da área sairia do lugar.
          'fixed inset-y-0 left-0 z-50 flex h-dvh w-[min(288px,calc(100vw-48px))] flex-col border-r border-border bg-bg2 font-os-mono transition-transform duration-200 min-[820px]:sticky min-[820px]:h-screen min-[820px]:shrink-0 min-[820px]:transform-none min-[820px]:transition-[width]',
          compacta ? 'min-[820px]:w-[64px]' : 'min-[820px]:w-[252px]',
          abertaNoMovel ? 'translate-x-0 visible' : '-translate-x-full invisible min-[820px]:visible',
        ].join(' ')}
      >
      {/* marca: a logo oficial, link para a entrada do Dia a dia, e logo à frente o botão de recolher (I1) */}
      <div className={`flex min-h-[56px] items-center gap-2 border-b border-border pl-[17px] pr-2 ${compacta ? 'min-[820px]:gap-[3px] min-[820px]:pl-[6px] min-[820px]:pr-0' : ''}`}>
        <Link
          href={inicio}
          onClick={aoNavegar}
          aria-label="ROOT OS, início"
          title="ROOT OS · operação root"
          data-logo-do-menu
          className="block rounded-root text-brand focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <LogoRoot recolhida={compacta} />
        </Link>
        <button
          type="button"
          onClick={alternarRecolhida}
          aria-label={compacta ? 'Expandir menu' : 'Recolher menu'}
          aria-pressed={compacta}
          aria-controls="root-os-destinos"
          title={compacta ? 'Expandir menu' : 'Recolher menu'}
          data-testid="menu-recolher"
          className="hidden h-8 w-6 shrink-0 place-items-center rounded-root text-muted hover:bg-surface-2 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand min-[820px]:grid"
        >
          {compacta ? <Icons.ChevronsRight size={16} aria-hidden /> : <Icons.ChevronsLeft size={16} aria-hidden />}
        </button>
        <span className="flex-1" />
        <button ref={botaoFechar} type="button" aria-label="Fechar navegação" onClick={() => { setAbertaNoMovel(false); botaoAbrir.current?.focus(); }} className="grid h-11 w-11 place-items-center text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand min-[820px]:hidden"><Icons.X size={18} aria-hidden /></button>
      </div>

      <nav id="root-os-destinos" aria-label="Destinos" onKeyDownCapture={() => { toque.current = false; }} className="min-h-0 flex-1 overflow-y-auto px-2 py-4">
        <p className={`px-3 pb-3 text-[10px] uppercase tracking-[0.14em] text-muted ${compacta ? 'min-[820px]:sr-only' : ''}`}>Áreas da empresa</p>
        {areas.map((area) => {
          const Icon = (Icons[area.icon as IconName] ?? Icons.Circle) as React.ElementType;
          const ativo = area.key === areaAtiva;
          const temLista = area.itens.length > 1;
          const aberta = !compacta && temLista && areaAberta === area.key;
          const comBalao = compacta && balao === area.key;
          const idDaLista = `root-os-area-${area.key}`;
          return (
            <div
              key={area.key}
              data-grupo-da-area={area.key}
              className="mb-1"
              onMouseEnter={compacta ? () => { if (toque.current) return; mouseNoBalao.current = true; abrirBalao(area.key); } : undefined}
              onMouseLeave={compacta ? () => { mouseNoBalao.current = false; fecharDepois(); } : undefined}
              onBlur={compacta ? (e) => {
                // O foco saiu do ícone e do balão (Tab para a próxima área, clique fora): fecha.
                const para = e.relatedTarget as Node | null;
                if (para && e.currentTarget.contains(para)) return;
                if (!mouseNoBalao.current) setBalao((atual) => (atual === area.key ? null : atual));
              } : undefined}
            >
              <Link
                href={area.entrada.href}
                data-area={area.key}
                aria-current={ativo ? 'true' : undefined}
                aria-expanded={compacta ? comBalao : temLista ? aberta : undefined}
                aria-controls={compacta ? (comBalao ? `root-os-balao-${area.key}` : undefined) : aberta ? idDaLista : undefined}
                onPointerDown={(e: React.PointerEvent) => { toque.current = e.pointerType === 'touch'; }}
                onTouchStart={() => { toque.current = true; }}
                onFocus={compacta ? () => {
                  if (focoDevolvido.current) { focoDevolvido.current = false; return; }
                  if (toque.current) return;
                  abrirBalao(area.key);
                } : undefined}
                onKeyDown={compacta ? (e: React.KeyboardEvent) => {
                  if (e.key === 'Escape' && balao === area.key) {
                    e.preventDefault();
                    fecharBalao(true);
                  } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                    e.preventDefault();
                    abrirBalao(area.key);
                    requestAnimationFrame(() => document.querySelector<HTMLAnchorElement>(`#root-os-balao-${area.key} a[href]`)?.focus());
                  }
                } : undefined}
                onClick={(e: React.MouseEvent) => {
                  // No toque, com o menu recolhido, o primeiro toque abre o balão; o segundo navega.
                  if (compacta && toque.current && balao !== area.key) {
                    e.preventDefault();
                    abrirBalao(area.key);
                    return;
                  }
                  // O acordeão que fecha (I1): a área aberta recolhe; a da tela atual, recolhida, reabre. Sem navegar.
                  const passo = passoDoAcordeao({ compacta, temLista, aberta, ativa: ativo });
                  if (passo !== 'navegar') {
                    e.preventDefault();
                    setAreaAberta(passo === 'fechar' ? undefined : area.key);
                    return;
                  }
                  setAreaAberta(area.key);
                  aoNavegar();
                }}
                className={`relative flex min-h-11 items-center gap-3 rounded-root px-3 py-3 text-[12px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand ${ativo ? 'bg-brand/10 font-semibold text-brand' : 'text-muted hover:bg-surface-2 hover:text-text'}`}
              >
                <Icon size={18} aria-hidden className="shrink-0" />
                <span className={`flex-1 ${compacta ? 'min-[820px]:sr-only' : ''}`}>{area.label}</span>
                {/* O selo do que espera por você (Pendências) fica na área Dia a dia, aberto e recolhido. */}
                {area.key === 'dia' && seloDaCaixa.texto &&
                  // Recolhido (só ícones, 64 px), o selo sobe para o canto do ícone em vez de empurrar para fora da barra.
                  <span aria-label={seloDaCaixa.titulo} title={seloDaCaixa.titulo} className={`bg-brand px-1.5 py-0.5 text-[10px] font-bold text-ink ${compacta ? 'min-[820px]:absolute min-[820px]:right-1 min-[820px]:top-1 min-[820px]:px-1 min-[820px]:py-0 min-[820px]:text-[9px]' : ''}`}>{seloDaCaixa.texto}</span>}
                {!compacta && temLista && (aberta ? <Icons.ChevronDown size={14} aria-hidden /> : <Icons.ChevronRight size={14} aria-hidden />)}
              </Link>
              {aberta && (
                <ul id={idDaLista} aria-label={`Subseções de ${area.label}`} className="m-0 mb-2 ml-[21px] mt-1 list-none border-l border-border p-0 pl-2">
                  {area.itens.map((item) => {
                    const aqui = destino?.key === item.key;
                    return (
                      <li key={item.key}>
                        <Link
                          href={item.href}
                          onClick={aoNavegar}
                          aria-current={aqui ? 'page' : undefined}
                          title={item.key === 'fluxos' ? 'Processos: em preparação' : undefined}
                          className={`flex min-h-9 items-center gap-2 rounded-root px-3 py-2 text-[12px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand max-[819px]:min-h-11 ${aqui ? 'font-semibold text-brand' : 'text-muted hover:bg-surface-2 hover:text-text'}`}
                        >
                          {rotuloDoDestino(item)}
                          {item.key === 'fluxos' && <span className="text-[10px]">em preparação</span>}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
              {comBalao && (
                <BalaoDaArea
                  id={`root-os-balao-${area.key}`}
                  titulo={area.label}
                  itens={area.itens}
                  atual={destino?.key}
                  ancora={iconeDaArea(area.key)}
                  aoFechar={(devolver) => fecharBalao(devolver)}
                  aoNavegar={aoNavegar}
                />
              )}
            </div>
          );
        })}
      </nav>

      {/* rodapé: os três temas (o botão de recolher subiu para perto da logo em 22/10/2026; no recolhido, o rodapé some) */}
      <div className={`flex items-center gap-[6px] border-t border-border px-3 py-[9px] ${compacta ? 'min-[820px]:hidden' : ''}`}>
        <div
          role="group"
          aria-label="Tema da interface"
          className={`flex min-w-0 flex-1 flex-row items-center gap-[6px] ${compacta ? 'min-[820px]:hidden' : ''}`}
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
      </div>
      </aside>
    </>
  );
}
