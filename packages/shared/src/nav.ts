import type { Permission } from './permissions.js';

// Navegação dos módulos (ver docs/ARCHITECTURE.md). Fonte única da sidebar do web
// e do placeholder de módulo em apps/web/src/app/[...slug]/page.tsx.
//
// A organização segue o protótipo ROOT OS (apps/web/public/root-os.html:848-863),
// que agrupa o menu em blocos nomeados em português direto:
//   A central · Quem trabalha · O controle · O que existe
// O painel real tem módulos que o protótipo não desenhou (aquisição, conteúdo,
// financeiro, conta). Em vez de espremer tudo num balde "Módulos", esses itens
// ganharam blocos na mesma voz — "o que entra", "o que sai", "o dinheiro",
// "a conta" — inseridos sem quebrar a ordem relativa dos blocos do protótipo.
// REGRA: nenhum módulo pode ficar fora do menu. Toda página do painel está aqui.

export const SECOES = [
  { key: 'central', label: 'A central', hint: 'o pulso e o contexto' },
  { key: 'trabalho', label: 'Quem trabalha', hint: 'o que está em execução' },
  { key: 'entra', label: 'O que entra', hint: 'demanda, tráfego e conversão' },
  { key: 'sai', label: 'O que sai', hint: 'conteúdo publicado e presença' },
  { key: 'dinheiro', label: 'O dinheiro', hint: 'caixa, resultado e conciliação' },
  { key: 'controle', label: 'O controle', hint: 'quem pode o quê, e o que aconteceu' },
  { key: 'existe', label: 'O que existe', hint: 'ferramentas e conexões ligadas' },
  { key: 'conta', label: 'A conta', hint: 'organização e preferências' },
] as const;

export type Secao = (typeof SECOES)[number];
export type SecaoKey = Secao['key'];

// Módulos do menu. Usado pela sidebar do web.
export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: string; // nome do ícone (lucide)
  permission: Permission;
  phase: number; // fase do roadmap em que fica funcional
  secao: SecaoKey; // bloco da sidebar (ver SECOES)
}

// A ordem do array é a ordem de render: itens agrupados por seção, seções na
// ordem de SECOES. As permissões e as fases são as mesmas de antes da migração —
// nenhuma foi afrouxada nem endurecida aqui.
export const NAV: NavItem[] = [
  // ── A central ────────────────────────────────────────────────────────────
  // "Painel" → "Console": mesmo nome do protótipo (root-os.html:849).
  { key: 'dashboard', label: 'Console', href: '/painel', icon: 'SquareTerminal', permission: 'dashboard.ver', phase: 1, secao: 'central' },
  // "Obsidian" (nome do fornecedor) → "Contexto": é o slot do protótipo para
  // "o mapa do que a empresa sabe" (root-os.html:850). A rota e a permissão
  // obsidian.ver seguem intactas.
  { key: 'obsidian', label: 'Contexto', href: '/obsidian', icon: 'Network', permission: 'obsidian.ver', phase: 2, secao: 'central' },
  { key: 'documentos', label: 'Documentos', href: '/documentos', icon: 'FolderOpen', permission: 'drive.ver', phase: 5, secao: 'central' },
  // "IA / Assistente" → "Sessões": no protótipo, Sessões é o registro das trocas
  // com a central — a superfície de conversa (root-os.html:851, 907-918).
  { key: 'ia', label: 'Sessões', href: '/ia', icon: 'Bot', permission: 'mcp.ver', phase: 7, secao: 'central' },
  { key: 'relatorios', label: 'Relatórios', href: '/relatorios', icon: 'BarChart3', permission: 'relatorios.ver', phase: 2, secao: 'central' },

  // ── Quem trabalha ────────────────────────────────────────────────────────
  { key: 'trabalho', label: 'Trabalho', href: '/trabalho', icon: 'KanbanSquare', permission: 'tarefas.ver', phase: 2, secao: 'trabalho' },
  { key: 'tarefas', label: 'Tarefas', href: '/tarefas', icon: 'CheckSquare', permission: 'tarefas.ver', phase: 3, secao: 'trabalho' },
  // Ocupa o slot "Rotinas" do protótipo (o que roda sozinho). Rótulo mantido:
  // "Automações" já é claro.
  { key: 'automacoes', label: 'Automações', href: '/automacoes', icon: 'Zap', permission: 'automacoes.ver', phase: 3, secao: 'trabalho' },

  // ── O que entra ──────────────────────────────────────────────────────────
  { key: 'leads', label: 'Leads', href: '/leads', icon: 'Users', permission: 'leads.ver', phase: 2, secao: 'entra' },
  { key: 'funil', label: 'Funil', href: '/funil', icon: 'Filter', permission: 'dashboard.ver', phase: 2, secao: 'entra' },
  { key: 'campanhas', label: 'Campanhas', href: '/campanhas', icon: 'Megaphone', permission: 'campanhas.ver', phase: 2, secao: 'entra' },
  { key: 'pixels', label: 'Pixels e eventos', href: '/pixels', icon: 'Activity', permission: 'dashboard.ver', phase: 2, secao: 'entra' },
  { key: 'vendas', label: 'Página de vendas', href: '/vendas', icon: 'ShoppingCart', permission: 'dashboard.ver', phase: 2, secao: 'entra' },

  // ── O que sai ────────────────────────────────────────────────────────────
  { key: 'conteudo', label: 'Conteúdo', href: '/conteudo', icon: 'FileText', permission: 'dashboard.ver', phase: 2, secao: 'sai' },
  { key: 'pauta', label: 'Pauta', href: '/pauta', icon: 'CalendarClock', permission: 'pauta.ver', phase: 4, secao: 'sai' },
  { key: 'referencias', label: 'Referências', href: '/referencias', icon: 'Library', permission: 'pauta.ver', phase: 4, secao: 'sai' },
  { key: 'instagram', label: 'Instagram', href: '/instagram', icon: 'Instagram', permission: 'instagram.ver', phase: 4, secao: 'sai' },
  { key: 'bio', label: 'Link na bio', href: '/bio', icon: 'Link2', permission: 'bio.ver', phase: 4, secao: 'sai' },
  { key: 'metas', label: 'Metas', href: '/metas', icon: 'Target', permission: 'dashboard.ver', phase: 4, secao: 'sai' },

  // ── O dinheiro ───────────────────────────────────────────────────────────
  { key: 'financeiro', label: 'Financeiro', href: '/financeiro', icon: 'Wallet', permission: 'financeiro.ver', phase: 2, secao: 'dinheiro' },

  // ── O controle ───────────────────────────────────────────────────────────
  // "WhatsApp" (nome do canal) → "Atendimento": slot do protótipo para
  // "o que precisa de gente" (root-os.html:858). Permissão whatsapp.enviar mantida.
  { key: 'whatsapp', label: 'Atendimento', href: '/whatsapp', icon: 'MessagesSquare', permission: 'whatsapp.enviar', phase: 6, secao: 'controle' },
  // Ocupa o slot "Régua" do protótipo: é aqui que se define quem — pessoa ou IA —
  // pode o quê. Rótulo mantido porque já é claro.
  { key: 'usuarios', label: 'Usuários e permissões', href: '/usuarios', icon: 'Shield', permission: 'admin.usuarios', phase: 1, secao: 'controle' },
  // "Auditoria" → "Rastro" (root-os.html:860).
  { key: 'auditoria', label: 'Rastro', href: '/auditoria', icon: 'Footprints', permission: 'auditoria.ver', phase: 1, secao: 'controle' },

  // ── O que existe ─────────────────────────────────────────────────────────
  // "MCP / Ferramentas" → "Ferramentas" (root-os.html:862).
  { key: 'mcp', label: 'Ferramentas', href: '/mcp', icon: 'Wrench', permission: 'mcp.ver', phase: 7, secao: 'existe' },
  // "Integrações" → "Conexões" (root-os.html:863).
  { key: 'integracoes', label: 'Conexões', href: '/integracoes', icon: 'Cable', permission: 'dashboard.ver', phase: 2, secao: 'existe' },
  { key: 'google', label: 'Google', href: '/google', icon: 'Mail', permission: 'dashboard.ver', phase: 2, secao: 'existe' },

  // ── A conta ──────────────────────────────────────────────────────────────
  { key: 'config', label: 'Configurações', href: '/config', icon: 'Settings', permission: 'dashboard.ver', phase: 1, secao: 'conta' },
];

// Rotas de detalhe que NÃO entram no menu: herdam o módulo pai e são protegidas
// pela permissão dele na API — /leads/:id por leads.ver (leads.controller.ts:27)
// e /campanhas/:id por campanhas.ver (campaigns.controller.ts:23). A sidebar já
// as marca como ativas pelo prefixo do href (Sidebar.tsx:32-35).
export const NAV_DETALHE: { href: string; parentKey: string; permission: Permission }[] = [
  { href: '/leads/[id]', parentKey: 'leads', permission: 'leads.ver' },
  { href: '/campanhas/[id]', parentKey: 'campanhas', permission: 'campanhas.ver' },
];

// Agrupa o menu por seção já filtrado pelas permissões do usuário, descartando
// seções que ficariam vazias. A sidebar renderiza o retorno na ordem recebida.
export function navPorSecao(permissoes: Iterable<string>): { secao: Secao; itens: NavItem[] }[] {
  const perms = permissoes instanceof Set ? permissoes : new Set(permissoes);
  return SECOES.map((secao) => ({
    secao,
    itens: NAV.filter((n) => n.secao === secao.key && perms.has(n.permission)),
  })).filter((g) => g.itens.length > 0);
}
