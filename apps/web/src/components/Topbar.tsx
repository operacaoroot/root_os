'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { NAV, SECOES } from '@mktos/shared';
import { Search, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Paleta } from './Paleta';

/*
 * O ⌘K estava atrás deste booleano desde a Fase 5, com o campo desabilitado e
 * o placeholder prometendo "buscar leads, campanhas, tarefas". Agora ele abre a
 * paleta e NAVEGA — e o placeholder diz isso, porque prometer busca e entregar
 * navegação é o tipo de mentira pequena que corrói a confiança no resto da tela.
 */
const BUSCA_ATIVA: boolean = true;

/* O subtítulo descreve a função atual da tela, sem prometer uma integração futura. */
const SUBTITULOS: Record<string, string> = {
  caixa: 'aprovações e tarefas do quadro que pedem sua atenção',
  atendimento: 'fila de decisões que exigem aprovação',
  agenda: 'compromissos e reuniões',
  console: 'indicadores da operação',
  contexto: 'regras, fontes e decisões da empresa',
  organograma: 'pessoas e agentes da empresa',
  tarefas: 'lista separada do quadro interno',
  trabalho: 'quadro de tarefas nativo do OS',
  onboarding: 'esteira de clientes em cinco fases',
  conteudo: 'temas da lista Gestão de Temas',
  pauta: 'curadoria, episódios e semana de posts',
  referencias: 'repertório para a produção',
  instagram: 'dados da conta',
  bio: 'links da página pública',
  leads: 'contatos comerciais',
  funil: 'etapas dos leads',
  campanhas: 'campanhas e gastos',
  pixels: 'eventos registrados pelo site',
  relatorios: 'relatórios disponíveis',
  metas: 'metas do período',
  financeiro: 'entradas, saídas e saldos',
  'custo-ia': 'uso e orçamento por agente',
  agentes: 'agentes configurados',
  rotinas: 'rotinas e execuções',
  sessoes: 'registro das conversas com a IA',
  fluxos: 'em preparação; sem editor de processos',
  ferramentas: 'capacidades disponíveis nesta empresa',
  conexoes: 'conectores e estado das integrações',
  regua: 'níveis de risco e quem pode autorizar',
  rastro: 'eventos registrados e verificação',
  'linha-do-tempo': 'eventos em ordem cronológica',
  assinatura: 'situação do plano',
  config: 'organização, perfil e integrações',
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
  const [paleta, setPaleta] = useState(false);

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
        setPaleta((v) => !v);
      }
    }
    window.addEventListener('keydown', atalho);
    return () => window.removeEventListener('keydown', atalho);
  }, []);

  return (
    <header className="flex h-[52px] flex-none items-center gap-[13px] border-b border-border bg-bg2 pl-14 pr-4 font-os-mono min-[820px]:h-[46px] min-[820px]:pl-4">
      <h1 className="m-0 truncate text-[12.5px] font-bold uppercase tracking-[0.02em] text-text">
        {h1}
      </h1>
      {sub && (
        <span className="hidden truncate text-[10px] uppercase tracking-[0.12em] text-muted min-[1280px]:inline">
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
          readOnly
          onFocus={() => setPaleta(true)}
          onClick={() => setPaleta(true)}
          placeholder="ir para…"
          title="Atalho: ⌘K / Ctrl+K"
          className="w-full border border-border bg-surface py-[5px] pl-[28px] pr-[34px] font-os-mono text-[10.5px] text-muted outline-none transition-colors placeholder:text-dim hover:border-brand/40 focus:border-brand/40 disabled:cursor-not-allowed"
        />
        <kbd
          aria-hidden
          className="pointer-events-none absolute right-[8px] top-1/2 -translate-y-1/2 border border-border-strong px-1 font-os-mono text-[9.5px] leading-[1.4] text-dim"
        >
          ⌘K
        </kbd>
      </div>

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
      <Paleta aberto={paleta} fechar={() => setPaleta(false)} />
    </header>
  );
}
