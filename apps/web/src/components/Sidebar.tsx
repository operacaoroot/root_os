'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV, SECOES, navEmArvore, type NavItem, type NoDeNav } from '@mktos/shared';
import * as Icons from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useModulos } from './modulos';
import { textoDoSelo, tituloDoSelo, useCaixa } from './caixa';

type IconName = keyof typeof Icons;

export type TemaOs = 'dark' | 'light' | 'mono';

export const CHAVE_TEMA = 'root-os:tema';

/** As seções que a pessoa fechou. Preferência de desenho, por navegador. */
export const CHAVE_MENU = 'root-os:menu-fechado';

const CHAVES_DE_SECAO = new Set<string>(SECOES.map((s) => s.key));

const TEMAS: { id: TemaOs; rotulo: string }[] = [
  { id: 'dark', rotulo: 'escuro' },
  { id: 'light', rotulo: 'papel' },
  { id: 'mono', rotulo: 'mono' },
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

function lerFechadas(): Set<string> {
  try {
    const v = localStorage.getItem(CHAVE_MENU);
    if (v) {
      const lista = JSON.parse(v);
      if (Array.isArray(lista)) return new Set(lista.filter((x) => typeof x === 'string'));
    }
  } catch {
    /* localStorage bloqueado ou JSON estragado: começa com tudo aberto */
  }
  return new Set(['automacoes', 'controle']);
}

function ehAtivo(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/');
}

/** Filho recua visualmente; permissão, módulo e destino continuam individuais. */
function ItemDoMenu({
  n,
  ativo,
  filho,
  selo,
  aoNavegar,
}: {
  n: NavItem;
  ativo: boolean;
  filho?: boolean;
  /**
   * O contador da CAIXA (fatia A7). Genérico de propósito — o item não sabe que
   * é a caixa, sabe que tem um número e uma frase que o explica. `texto` nulo
   * não desenha nada, e nulo inclui o "ainda não sei" e o zero: zero é vitória,
   * e vitória não precisa de selo (a tela diz "nada esperando por você").
   */
  selo?: { texto: string | null; titulo: string };
  aoNavegar?: () => void;
}) {
  const Icon = (Icons[n.icon as IconName] ?? Icons.Circle) as React.ElementType;
  return (
    <Link
      href={n.href}
      title={n.label}
      aria-current={ativo ? 'page' : undefined}
      onClick={aoNavegar}
      className={[
        'group relative flex min-h-11 w-full items-center gap-[10px] py-2 text-[12px] transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-brand',
        filho ? 'pl-[28px] pr-[9px]' : 'px-[9px]',
        ativo ? 'bg-brand/10 text-brand' : 'text-muted hover:bg-surface-2 hover:text-text',
      ].join(' ')}
    >
      {/* barra de 2px à esquerda do item ativo — .nav.on::before do protótipo */}
      {ativo && <span aria-hidden className="absolute bottom-0 left-0 top-0 w-[2px] bg-brand" />}
      <Icon size={16} aria-hidden className="shrink-0" />
      <span className="min-w-0 flex-1 leading-snug">{n.label}</span>
      {selo?.texto && (
        <span
          title={selo.titulo}
          aria-label={selo.titulo}
          className="ml-auto min-w-[16px] bg-brand px-[4px] py-px text-center text-[9px] font-bold leading-[1.5] text-ink"
        >
          {selo.texto}
        </span>
      )}
      {n.estado === 'parcial' && (
        <span
          title={n.parcial ?? 'esta tela ainda está incompleta'}
          className="ml-auto bg-surface-3 px-[5px] py-px text-[9px] font-bold uppercase tracking-[0.08em] text-muted"
        >
          {n.key === 'fluxos' ? 'em preparação' : 'parcial'}
        </span>
      )}
    </Link>
  );
}

export function Sidebar() {
  const { user } = useAuth();
  const { modulos, ligado } = useModulos();
  const caixa = useCaixa();
  const pathname = usePathname();
  const [tema, setTema] = useState<TemaOs>('dark');
  const [fechadas, setFechadas] = useState<Set<string>>(new Set(['automacoes', 'controle']));
  const [abertaNoMovel, setAbertaNoMovel] = useState(false);
  const botaoAbrir = useRef<HTMLButtonElement>(null);
  const botaoFechar = useRef<HTMLButtonElement>(null);
  // O primeiro efeito de tema roda com o estado inicial 'dark', antes do
  // estado lido do localStorage chegar. Sem esta guarda ele gravaria 'dark'
  // por cima da escolha do usuário se o componente desmontasse no meio.
  const primeiraPintura = useRef(true);

  const perms = new Set(user?.permissions ?? []);
  // /painel/custo-ia pertence a Resultados; /painel não deve ficar ativo junto.
  const itemAtivo = NAV.filter((n) => ehAtivo(pathname, n.href))
    .sort((a, b) => b.href.length - a.href.length)[0];

  /*
   * O agrupamento e os DOIS filtros — permissão e módulo contratado — vêm do
   * pacote compartilhado (packages/shared/src/nav.ts): a sidebar só desenha o
   * que ele devolve, na ordem em que devolve.
   *
   * `modulos ?? undefined` traduz o "ainda não sei" do provedor no "todos
   * ligados" que o navPorSecao entende. Quem de fato recusa a rota é a API
   * (apps/api/src/tenants/); esconder aqui é para não mostrar porta que não
   * abre, e esconder por FALTA de resposta seria sumir com tela que a pessoa
   * tem — ver o cabeçalho de `modulos.tsx`.
   *
   * O "avulsos" abaixo é rede de segurança: se um módulo entrar no NAV
   * apontando para uma seção que não existe em SECOES, ele aparece no fim do
   * menu em vez de sumir calado. O tipo `secao` impede isso em compilação, mas
   * o NAV também é lido por JS não tipado (testes, scripts).
   */
  const grupos: { chave: string; titulo: string; dica?: string; tipo: string; itens: NoDeNav[] }[] =
    navEmArvore(perms, modulos ?? undefined).map((g) => ({
      chave: g.secao.key,
      titulo: g.secao.label,
      dica: g.secao.hint,
      tipo: g.secao.tipo,
      itens: g.itens,
    }));

  const avulsos = NAV.filter(
    (n) => perms.has(n.permission) && ligado(n.modulo) && !CHAVES_DE_SECAO.has(n.secao),
  );
  if (avulsos.length > 0)
    grupos.push({
      chave: '__avulsos',
      titulo: 'Outros',
      tipo: 'modulo',
      // Sem aninhar de propósito: item que caiu aqui é item cuja seção não
      // existe, e adivinhar hierarquia para ele seria inventar desenho em cima
      // de um defeito que este bloco existe para DENUNCIAR.
      itens: avulsos.map((item) => ({ item, filhos: [] })),
    });

  const primeiroApoio = grupos.findIndex((g) => g.tipo === 'apoio');

  /*
   * O selo da CAIXA, calculado UMA vez e entregue ao item cuja chave é `caixa`
   * — inclusive quando ele aparecer como filho de alguém, porque o menu pode
   * mudar de forma e um selo que só existe no primeiro nível somiria em
   * silêncio. As duas frases (o número e o title) moram em `caixa.tsx`: é lá que
   * está escrito por que "não sei" não pode virar zero.
   */
  const seloDaCaixa = { texto: textoDoSelo(caixa), titulo: tituloDoSelo(caixa) };

  useEffect(() => {
    setTema(lerTema());
    setFechadas(lerFechadas());
  }, []);

  function alternarSecao(chave: string) {
    setFechadas((antes) => {
      const depois = new Set(antes);
      if (depois.has(chave)) depois.delete(chave);
      else depois.add(chave);
      try {
        localStorage.setItem(CHAVE_MENU, JSON.stringify([...depois]));
      } catch {
        /* sem persistência: vale só para esta aba */
      }
      return depois;
    });
  }

  useEffect(() => {
    setAbertaNoMovel(false);
  }, [pathname]);

  useEffect(() => {
    if (!abertaNoMovel) return;
    botaoFechar.current?.focus();
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setAbertaNoMovel(false);
        botaoAbrir.current?.focus();
      } else if (e.key === 'Tab') {
        const dialogo = document.getElementById('root-os-nav');
        const controles = dialogo?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
        if (!controles?.length) return;
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
    return () => window.removeEventListener('keydown', aoTeclar);
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
          className="fixed inset-0 z-40 bg-black/70 min-[820px]:hidden"
        />
      )}
      <aside
        id="root-os-nav"
        role={abertaNoMovel ? 'dialog' : undefined}
        aria-modal={abertaNoMovel ? true : undefined}
        aria-label="Navegação do ROOT OS"
        className={[
          'fixed inset-y-0 left-0 z-50 flex h-dvh w-[min(288px,calc(100vw-48px))] flex-col border-r border-border bg-bg2 font-os-mono transition-transform duration-200 min-[820px]:sticky min-[820px]:h-screen min-[820px]:w-[252px] min-[820px]:shrink-0 min-[820px]:translate-x-0',
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
        <span className="min-w-0 flex-1 leading-[1.25]">
          <span className="block text-[12px] font-bold tracking-[-0.02em] text-text">
            ROOT OS
          </span>
          <span className="block truncate text-[9px] uppercase tracking-[0.15em] text-muted">
            operação root
          </span>
        </span>
        <button ref={botaoFechar} type="button" aria-label="Fechar navegação" onClick={() => { setAbertaNoMovel(false); botaoAbrir.current?.focus(); }} className="grid h-11 w-11 place-items-center text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand min-[820px]:hidden"><Icons.X size={18} aria-hidden /></button>
      </div>

      {/* módulos, agrupados por seção — a lista já vem filtrada por permissão */}
      <nav aria-label="Destinos" className="min-h-0 flex-1 overflow-y-auto px-2 py-[7px]">
        {grupos.map((g, i) => {
          // A seção que contém a tela aberta fica ABERTA, mesmo que a pessoa a
          // tenha fechado antes: menu que esconde onde você está não orienta,
          // desorienta. A preferência dela continua guardada e volta a valer
          // quando sair daqui.
          const temAtivo = g.itens.some((no) =>
            no.item.key === itemAtivo?.key || no.filhos.some((f) => f.key === itemAtivo?.key),
          );
          const fechada = fechadas.has(g.chave) && !temAtivo;
          return (
            <section key={g.chave} aria-label={g.titulo}>
              {i === primeiroApoio && i > 0 && (
                <div aria-hidden className="mx-2 mb-1 mt-4 border-t border-border" />
              )}
              <h2>
                <button
                  type="button"
                  onClick={() => alternarSecao(g.chave)}
                  aria-expanded={!fechada}
                  aria-controls={`nav-grupo-${g.chave}`}
                  title={g.dica}
                  className="flex min-h-11 w-full cursor-pointer items-center gap-[5px] px-2 pt-2 text-left text-[10px] font-normal uppercase tracking-[0.14em] text-muted transition-colors duration-150 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                >
                  <Icons.ChevronRight
                    size={9}
                    aria-hidden
                    className={['shrink-0 transition-transform', fechada ? '' : 'rotate-90'].join(
                      ' ',
                    )}
                  />
                  <span className="truncate">{g.titulo}</span>
                </button>
              </h2>
              <div id={`nav-grupo-${g.chave}`} className={fechada ? 'hidden' : undefined}>
                {g.itens.map((no) => (
                  <div key={no.item.key}>
                    <ItemDoMenu
                      n={no.item}
                      ativo={no.item.key === itemAtivo?.key}
                      selo={no.item.key === 'caixa' ? seloDaCaixa : undefined}
                      aoNavegar={aoNavegar}
                    />
                    {no.filhos.map((f) => (
                      <ItemDoMenu
                        key={f.key}
                        n={f}
                        ativo={f.key === itemAtivo?.key}
                        filho
                        selo={f.key === 'caixa' ? seloDaCaixa : undefined}
                        aoNavegar={aoNavegar}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </nav>

      {/* rodapé: os três temas */}
      <div
        role="group"
        aria-label="Tema da interface"
        className="flex flex-col items-stretch gap-[6px] border-t border-border px-3 py-[9px] min-[820px]:flex-row min-[820px]:items-center"
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
