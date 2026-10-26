'use client';

import { AvatarDaPessoa } from '@/components/AvatarDaPessoa';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { areaDoDestino, destinoDaRota, rotuloDoDestino } from './navegacao-modulos';
import { useEhPlataforma } from '@/lib/plataforma';
import { Search, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { Paleta } from './Paleta';
import { EngrenagemDoUsuario } from './EngrenagemDoUsuario';

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
  'tarefas-todas': 'as tarefas das pastas e listas do Trabalho',
  contexto: 'regras, fontes e decisões da empresa',
  marca: 'quem a empresa é e sobre o que fala',
  organograma: 'pessoas e agentes da empresa',
  tarefas: 'tarefas da lista selecionada',
  trabalho: 'quadro de tarefas nativo do OS',
  'trabalho-todas': 'tarefas de todas as pastas e listas',
  onboarding: 'esteira de clientes em cinco fases',
  conteudo: 'espelho dos temas do ClickUp',
  pauta: 'curadoria, episódios e semana de posts',
  referencias: 'repertório para a produção',
  marketing: 'onde cada parte do marketing mora',
  'marketing-ideias': 'ideias da casa antes de virar peça',
  'marketing-estrategia': 'pilares, cadência e metas do mês',
  'marketing-performance': 'números da conta contra a própria mediana',
  'marketing-relatorio': 'fechamento do mês',
  instagram: 'dados da conta',
  bio: 'links da página pública',
  leads: 'contatos comerciais',
  funil: 'etapas dos leads',
  'comercial-rodada': 'a rodada semanal do painel da operação',
  whatsapp: 'as conversas do número da empresa com leads, clientes e equipe',
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

function rotuloDaRota(pathname: string, ehPlataforma: boolean): { titulo: string; subtitulo: string } {
  const item = destinoDaRota(pathname, ehPlataforma);
  if (item) {
    const area = areaDoDestino(item);
    const nome = rotuloDoDestino(item);
    // Área de um item só com o mesmo nome (WhatsApp): o título não repete a palavra.
    return { titulo: area && area.label !== nome ? `${area.label} / ${nome}` : nome,
      subtitulo: SUBTITULOS[item.key] ?? '' };
  }
  const seg = pathname.split('/').filter(Boolean)[0];
  return { titulo: seg ? seg.charAt(0).toUpperCase() + seg.slice(1) : 'ROOT OS', subtitulo: '' };
}

export function Topbar({ titulo, subtitulo }: { titulo?: string; subtitulo?: string } = {}) {
  const { user, logout } = useAuth();
  const pathname = usePathname();
  const busca = useRef<HTMLInputElement>(null);
  const lupa = useRef<HTMLButtonElement>(null);
  const abertaPelaLupa = useRef(false);
  const [paleta, setPaleta] = useState(false);

  const ehPlataforma = useEhPlataforma();
  const rotulo = rotuloDaRota(pathname, ehPlataforma);
  const h1 = titulo ?? rotulo.titulo;
  const sub = subtitulo ?? rotulo.subtitulo;

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
    <header className="flex h-[52px] flex-none items-center gap-[13px] border-b border-border bg-bg2 pl-14 pr-4 font-os-sans min-[820px]:h-[46px] min-[820px]:pl-4">
      <h1 className="m-0 truncate text-[15px] font-semibold tracking-[-0.01em] text-text">
        {h1}
      </h1>
      {sub && (
        <span className="hidden truncate text-[13px] text-muted min-[1280px]:inline">
          {sub}
        </span>
      )}

      <span className="flex-1" />

      {/* Busca global (stub — Fase 5) */}
      <button
        ref={lupa}
        type="button"
        onClick={() => {
          abertaPelaLupa.current = true;
          setPaleta(true);
        }}
        aria-label="Buscar no menu"
        title="Buscar no menu"
        className="grid h-[26px] w-[26px] flex-none place-items-center border border-border text-muted transition-colors hover:border-border-strong hover:bg-surface-2 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand min-[1024px]:hidden"
      >
        <Search size={13} />
      </button>

      <div className="relative hidden w-[220px] min-[1024px]:block">
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
          <div className="text-[13px] text-text">{user?.name}</div>
          <div className="font-os-mono text-[9px] uppercase tracking-[0.12em] text-muted">
            {user?.roles.join(', ')}
          </div>
        </div>
        {/* A foto do perfil (22B, I6); sem foto, as iniciais. O nome já está ao lado: o avatar não repete. */}
        {user ? <AvatarDaPessoa nome={user.name ?? '?'} pessoaId={user.id} tamanho="m" decorativo /> : null}
        {/* A engrenagem ao lado da identificação (22B, I1): Perfil, Lixeira, Registro de ações, Configurações. */}
        <EngrenagemDoUsuario />
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
      <Paleta
        aberto={paleta}
        fechar={() => {
          setPaleta(false);
          // devolve o foco só a quem abriu pela lupa; o campo "ir para…" reabriria a paleta ao receber foco
          if (abertaPelaLupa.current) {
            abertaPelaLupa.current = false;
            lupa.current?.focus();
          }
        }}
      />
    </header>
  );
}
