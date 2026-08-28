'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { NAV, SECOES } from '@mktos/shared';
import { Search, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth';

/*
 * A busca global continua sendo o stub da Fase 5: o campo nasce desabilitado,
 * como antes. Virar `true` aqui liga junto o atalho ⌘K / Ctrl+K — enquanto
 * estiver desligado o listener nem é registrado, para não sequestrar o atalho
 * do navegador em cima de um campo que não responde.
 * Tipado como boolean (e não pelo literal) de propósito: sem isso o TS estreita
 * para `false` e marca o corpo do efeito como inalcançável.
 */
const BUSCA_ATIVA: boolean = false;

/*
 * Subtítulo por módulo, na chave do NAV (packages/shared/src/nav.ts:43) — e não
 * no rótulo, que a migração renomeou (Painel→Console, Obsidian→Contexto,
 * WhatsApp→Atendimento, Auditoria→Rastro...). Os módulos que herdaram um slot
 * do protótipo herdaram junto a linha dele (root-os.html:1322-1327).
 * Módulo que entrar no NAV sem verbete aqui cai no hint da própria seção.
 */
const SUBTITULOS: Record<string, string> = {
  // a espinha do OS
  console: 'o pulso da operação',
  contexto: 'o mapa do que a empresa sabe',
  sessoes: 'as trocas, organizadas',
  agentes: 'quem trabalha na central',
  rotinas: 'o que roda sozinho',
  fluxos: 'onde o trabalho vaza',
  organograma: 'gente e agentes',
  atendimento: 'o que precisa de gente',
  regua: 'o que a IA pode fazer, e quem define',
  rastro: 'tudo que aconteceu',
  ferramentas: 'o que a central já sabe fazer',
  conexoes: 'o que alimenta a central',
  // os módulos de domínio
  trabalho: 'o quadro de quem faz',
  tarefas: 'o que está aberto',
  relatorios: 'o que dá para mandar pra fora',
  leads: 'quem chegou e em que pé está',
  funil: 'onde o lead trava',
  campanhas: 'o que está no ar e quanto custa',
  pixels: 'o que o site registra',
  conteudo: 'o que já foi publicado',
  pauta: 'o que entra na fila',
  referencias: 'o que serve de modelo',
  instagram: 'o que a conta devolve',
  bio: 'a página que recebe o clique',
  metas: 'onde está a régua do mês',
  financeiro: 'entra, sai e o que sobra',
  // a conta
  config: 'como o sistema se comporta',
};

const HINT_DA_SECAO = new Map<string, string>(SECOES.map((s) => [s.key, s.hint]));

/*
 * Resolve título e subtítulo pela rota. Usa o NAV inteiro, e não a lista
 * filtrada por permissão: a barra só rotula a tela em que o usuário já está,
 * e quem barra o acesso é a rota, não o cabeçalho.
 * Casa pelo href mais longo para que /leads/[id] continue lendo "Leads" e uma
 * futura sub-rota registrada no NAV ganhe o próprio nome.
 */
function rotuloDaRota(pathname: string): { titulo: string; subtitulo: string } {
  const item = NAV.filter((n) =>
    n.href === '/' ? pathname === '/' : pathname === n.href || pathname.startsWith(n.href + '/'),
  ).sort((a, b) => b.href.length - a.href.length)[0];

  if (item) {
    return {
      titulo: item.label,
      subtitulo: SUBTITULOS[item.key] ?? HINT_DA_SECAO.get(item.secao) ?? '',
    };
  }

  const seg = pathname.split('/').filter(Boolean)[0];
  return {
    titulo: seg ? seg.charAt(0).toUpperCase() + seg.slice(1) : 'ROOT OS',
    subtitulo: '',
  };
}

export function Topbar({ titulo, subtitulo }: { titulo?: string; subtitulo?: string } = {}) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const busca = useRef<HTMLInputElement>(null);

  const rotulo = rotuloDaRota(pathname);
  const h1 = titulo ?? rotulo.titulo;
  const sub = subtitulo ?? rotulo.subtitulo;

  const initials = (user?.name ?? '?')
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  useEffect(() => {
    if (!BUSCA_ATIVA) return;
    function atalho(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        busca.current?.focus();
      }
    }
    window.addEventListener('keydown', atalho);
    return () => window.removeEventListener('keydown', atalho);
  }, []);

  return (
    <header className="flex h-[46px] flex-none items-center gap-[13px] border-b border-border bg-bg2 px-4 font-os-mono">
      <h1 className="m-0 truncate text-[12.5px] font-bold uppercase tracking-[0.02em] text-text">
        {h1}
      </h1>
      {sub && (
        <span className="hidden truncate text-[10px] uppercase tracking-[0.12em] text-muted min-[900px]:inline">
          {sub}
        </span>
      )}

      <span className="flex-1" />

      {/* Busca global (stub — Fase 5) */}
      <div className="relative hidden w-[220px] min-[900px]:block">
        <Search
          size={13}
          className="pointer-events-none absolute left-[10px] top-1/2 -translate-y-1/2 text-dim"
        />
        <input
          ref={busca}
          disabled={!BUSCA_ATIVA}
          placeholder="Buscar leads, campanhas, tarefas… (Fase 5)"
          title="Busca global chega na Fase 5"
          className="w-full border border-border bg-surface py-[5px] pl-[28px] pr-[34px] font-os-mono text-[10.5px] text-muted outline-none transition-colors placeholder:text-dim hover:border-brand/40 focus:border-brand/40 disabled:cursor-not-allowed"
        />
        <kbd
          aria-hidden
          className="pointer-events-none absolute right-[8px] top-1/2 -translate-y-1/2 border border-border-strong px-1 font-os-mono text-[9.5px] leading-[1.4] text-dim"
        >
          ⌘K
        </kbd>
      </div>

      {/* indicador à direita — herdou a marca de estágio que ficava no pé da lateral */}
      <span className="hidden whitespace-nowrap text-[10px] uppercase tracking-[0.1em] text-muted min-[1100px]:inline">
        fase 1 · <b className="font-medium text-brand">stack isolado</b>
      </span>

      <div className="flex items-center gap-[10px]">
        <div className="hidden text-right leading-[1.25] min-[560px]:block">
          <div className="text-[11px] text-text">{user?.name}</div>
          <div className="text-[9px] uppercase tracking-[0.12em] text-muted">
            {user?.roles.join(', ')}
          </div>
        </div>
        <div className="grid h-[26px] w-[26px] flex-none place-items-center rounded-root border border-brand/30 bg-brand/10 text-[10px] font-bold text-brand">
          {initials}
        </div>
        <button
          type="button"
          onClick={logout}
          title="Sair"
          aria-label="Sair"
          className="grid h-[26px] w-[26px] flex-none place-items-center border border-border text-muted transition-colors hover:border-border-strong hover:bg-surface-2 hover:text-text"
        >
          <LogOut size={13} />
        </button>
      </div>
    </header>
  );
}
