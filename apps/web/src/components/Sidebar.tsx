'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV, SECOES, navPorSecao } from '@mktos/shared';
import * as Icons from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useModulos } from './modulos';

type IconName = keyof typeof Icons;

export type TemaOs = 'dark' | 'light' | 'mono';

export const CHAVE_TEMA = 'root-os:tema';

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

export function Sidebar() {
  const { user } = useAuth();
  const { modulos, ligado } = useModulos();
  const pathname = usePathname();
  const [tema, setTema] = useState<TemaOs>('dark');
  // O primeiro efeito de tema roda com o estado inicial 'dark', antes do
  // estado lido do localStorage chegar. Sem esta guarda ele gravaria 'dark'
  // por cima da escolha do usuário se o componente desmontasse no meio.
  const primeiraPintura = useRef(true);

  const perms = new Set(user?.permissions ?? []);

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
  const grupos: { chave: string; titulo: string; dica?: string; tipo: string; itens: typeof NAV }[] =
    navPorSecao(perms, modulos ?? undefined).map((g) => ({
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
    grupos.push({ chave: '__avulsos', titulo: 'Outros', tipo: 'modulo', itens: avulsos });

  // A régua de 1px separa a espinha do OS dos módulos de domínio. É a única
  // pista visual de que são dois eixos e não uma lista de 27 coisas.
  const primeiroModulo = grupos.findIndex((g) => g.tipo === 'modulo');

  useEffect(() => {
    setTema(lerTema());
  }, []);

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
    <aside className="sticky top-0 flex h-screen w-[60px] shrink-0 flex-col border-r border-border bg-bg2 font-os-mono min-[820px]:w-[216px]">
      {/* marca */}
      <div className="flex items-center justify-center gap-[10px] border-b border-border px-[14px] pb-[13px] pt-[15px] min-[820px]:justify-start">
        <span
          aria-hidden
          className="inline-block text-[16px] font-extrabold italic leading-none tracking-[-0.05em] text-brand"
          style={{ transform: 'skewX(-10deg)', textShadow: 'var(--os-logo-shadow, none)' }}
        >
          R
        </span>
        <span className="hidden min-w-0 leading-[1.25] min-[820px]:block">
          <span className="block text-[12px] font-bold tracking-[-0.02em] text-text">
            ROOT OS
          </span>
          <span className="block truncate text-[9px] uppercase tracking-[0.15em] text-muted">
            operação root
          </span>
        </span>
      </div>

      {/* módulos, agrupados por seção — a lista já vem filtrada por permissão */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 py-[7px]">
        {grupos.map((g, i) => (
          <section key={g.chave} aria-label={g.titulo}>
            {i === primeiroModulo && i > 0 && (
              <div aria-hidden className="mx-2 mb-1 mt-4 border-t border-border" />
            )}
            <h2
              title={g.dica}
              className="hidden px-2 pb-[5px] pt-3 text-[9px] font-normal uppercase tracking-[0.2em] text-dim min-[820px]:block"
            >
              {g.titulo}
            </h2>
            {g.itens.map((n) => {
              const Icon = (Icons[n.icon as IconName] ?? Icons.Circle) as React.ElementType;
              const active =
                n.href === '/'
                  ? pathname === '/'
                  : pathname === n.href || pathname.startsWith(n.href + '/');
              return (
                <Link
                  key={n.key}
                  href={n.href}
                  title={n.label}
                  aria-current={active ? 'page' : undefined}
                  className={[
                    'group relative flex w-full items-center gap-[10px] px-[9px] py-[7px] text-[11.5px] transition-colors duration-150',
                    'justify-center min-[820px]:justify-start',
                    active
                      ? 'bg-brand/10 text-brand'
                      : 'text-muted hover:bg-surface-2 hover:text-text',
                  ].join(' ')}
                >
                  {/* barra de 2px à esquerda do item ativo — .nav.on::before do protótipo */}
                  {active && (
                    <span aria-hidden className="absolute bottom-0 left-0 top-0 w-[2px] bg-brand" />
                  )}
                  <Icon size={13} className="shrink-0" />
                  <span className="hidden flex-1 truncate min-[820px]:block">{n.label}</span>
                  {n.estado === 'parcial' && (
                    <span
                      title={n.parcial ?? 'esta tela ainda está incompleta'}
                      className="ml-auto hidden bg-surface-3 px-[5px] py-px text-[9px] font-bold uppercase tracking-[0.08em] text-muted min-[820px]:block"
                    >
                      parcial
                    </span>
                  )}
                </Link>
              );
            })}
          </section>
        ))}
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
                'flex-1 border py-[5px] font-os-mono text-[9px] uppercase tracking-[0.12em] transition-colors duration-150',
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
  );
}
