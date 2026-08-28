import type { Permission } from './permissions.js';

// Navegação do ROOT OS. Fonte única da sidebar do web e do placeholder de
// módulo em apps/web/src/app/[...slug]/page.tsx.
//
// A organização tem DOIS EIXOS, e é isso que resolve a confusão antiga de
// "27 módulos de um sistema de marketing":
//
//   ESPINHA (tipo 'os')     — fala do sistema: o que ele sabe, quem trabalha,
//                             o que ele pode fazer, o que aconteceu, o que
//                             está ligado, quem autoriza. Sempre presente.
//   MÓDULOS (tipo 'modulo') — falam do negócio: leads, dinheiro, conteúdo.
//                             Habilitáveis por empresa (o gate na API entra
//                             junto com o catálogo de capacidades).
//
// Nenhum dos dois substitui o outro. O protótipo já dizia isso e ninguém
// reparou: root-os.html:1435 lista 14 módulos liga/desliga que são exatamente
// os módulos de domínio deste painel, vistos de dentro da lógica do OS.
//
// REGRA: nenhum módulo pode ficar inalcançável. Página que sai do menu tem
// destino declarado em ROTAS_ABSORVIDAS e redirect em apps/web/rotas-antigas.mjs.

export const SECOES = [
  // ── espinha do OS ────────────────────────────────────────────────────────
  { key: 'central', label: 'A central', hint: 'o pulso e o contexto', tipo: 'os' },
  { key: 'trabalha', label: 'Quem trabalha', hint: 'agentes, rotinas e processos', tipo: 'os' },
  { key: 'controle', label: 'O controle', hint: 'o que precisa de gente e a régua', tipo: 'os' },
  { key: 'existe', label: 'O que existe', hint: 'ferramentas e conexões ligadas', tipo: 'os' },
  // ── módulos de domínio ───────────────────────────────────────────────────
  { key: 'execucao', label: 'A execução', hint: 'quadro, tarefas e entregas', tipo: 'modulo' },
  { key: 'entra', label: 'O que entra', hint: 'demanda, tráfego e conversão', tipo: 'modulo' },
  { key: 'sai', label: 'O que sai', hint: 'conteúdo publicado e presença', tipo: 'modulo' },
  { key: 'dinheiro', label: 'O dinheiro', hint: 'caixa, resultado e conciliação', tipo: 'modulo' },
  // ── a conta ──────────────────────────────────────────────────────────────
  { key: 'conta', label: 'A conta', hint: 'organização e preferências', tipo: 'os' },
] as const;

export type Secao = (typeof SECOES)[number];
export type SecaoKey = Secao['key'];
export type SecaoTipo = Secao['tipo'];

// Módulos habilitáveis por empresa. A chave é o que a tela de Ferramentas
// liga/desliga e o que o guard da API vai consultar — hoje o filtro é só
// visual, e a tela precisa dizer isso enquanto o guard não existir.
export const MODULOS = [
  'trabalho',
  'relatorios',
  'leads',
  'campanhas',
  'pixels',
  'conteudo',
  'pauta',
  'instagram',
  'bio',
  'metas',
  'financeiro',
] as const;
export type ModuloKey = (typeof MODULOS)[number];

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: string; // nome do ícone (lucide)
  permission: Permission;
  secao: SecaoKey;
  /** Ausente = espinha do OS, não desliga. Presente = gate do módulo. */
  modulo?: ModuloKey;
  /**
   * 'parcial' substitui o antigo `phase`. Número de fase mente depois que a
   * tela existe; o que ajuda é dizer O QUE falta, e é isso que vai no title.
   */
  estado?: 'pleno' | 'parcial';
  parcial?: string;
}

export const NAV: NavItem[] = [
  // ── A central ────────────────────────────────────────────────────────────
  { key: 'console', label: 'Console', href: '/painel', icon: 'SquareTerminal', permission: 'dashboard.ver', secao: 'central' },
  { key: 'contexto', label: 'Contexto', href: '/contexto', icon: 'Network', permission: 'obsidian.ver', secao: 'central', estado: 'parcial', parcial: 'o mapa e as abas Marca e Identidade entram nas próximas fatias' },
  { key: 'sessoes', label: 'Sessões', href: '/sessoes', icon: 'Bot', permission: 'mcp.ver', secao: 'central', estado: 'parcial', parcial: 'o traço completo entra com a porta' },

  // ── Quem trabalha ────────────────────────────────────────────────────────
  { key: 'agentes', label: 'Agentes', href: '/agentes', icon: 'Users', permission: 'mcp.ver', secao: 'trabalha', estado: 'parcial', parcial: 'o roster entra quando o runtime nascer' },
  { key: 'rotinas', label: 'Rotinas', href: '/rotinas', icon: 'Repeat', permission: 'automacoes.ver', secao: 'trabalha', estado: 'parcial', parcial: 'as 8 rotinas passam a registrar execução' },
  { key: 'fluxos', label: 'Fluxos', href: '/fluxos', icon: 'Workflow', permission: 'automacoes.ver', secao: 'trabalha', estado: 'parcial', parcial: 'editor de processo, com o vazamento declarado' },
  { key: 'organograma', label: 'Organograma', href: '/organograma', icon: 'Share2', permission: 'dashboard.ver', secao: 'trabalha', estado: 'parcial', parcial: 'depende do roster de agentes' },

  // ── O controle ───────────────────────────────────────────────────────────
  { key: 'atendimento', label: 'Atendimento', href: '/atendimento', icon: 'MessagesSquare', permission: 'whatsapp.enviar', secao: 'controle', estado: 'parcial', parcial: 'a fila de aprovação entra com a porta; a entrada por WhatsApp vem do FinOps depois' },
  { key: 'regua', label: 'Régua', href: '/regua', icon: 'Shield', permission: 'admin.usuarios', secao: 'controle', estado: 'parcial', parcial: 'níveis, sinais e capacidades entram com o motor de política' },
  { key: 'rastro', label: 'Rastro', href: '/rastro', icon: 'Footprints', permission: 'auditoria.ver', secao: 'controle' },

  // ── O que existe ─────────────────────────────────────────────────────────
  { key: 'ferramentas', label: 'Ferramentas', href: '/ferramentas', icon: 'Wrench', permission: 'mcp.ver', secao: 'existe', estado: 'parcial', parcial: 'o catálogo das 35 ferramentas entra na fatia 7' },
  { key: 'conexoes', label: 'Conexões', href: '/conexoes', icon: 'Cable', permission: 'dashboard.ver', secao: 'existe' },

  // ── A execução ───────────────────────────────────────────────────────────
  { key: 'trabalho', label: 'Trabalho', href: '/trabalho', icon: 'KanbanSquare', permission: 'tarefas.ver', secao: 'execucao', modulo: 'trabalho' },
  { key: 'tarefas', label: 'Tarefas', href: '/tarefas', icon: 'CheckSquare', permission: 'tarefas.ver', secao: 'execucao', modulo: 'trabalho' },
  { key: 'relatorios', label: 'Relatórios', href: '/relatorios', icon: 'BarChart3', permission: 'relatorios.ver', secao: 'execucao', modulo: 'relatorios' },

  // ── O que entra ──────────────────────────────────────────────────────────
  { key: 'leads', label: 'Leads', href: '/leads', icon: 'UserPlus', permission: 'leads.ver', secao: 'entra', modulo: 'leads' },
  { key: 'funil', label: 'Funil', href: '/funil', icon: 'Filter', permission: 'dashboard.ver', secao: 'entra', modulo: 'leads' },
  { key: 'campanhas', label: 'Campanhas', href: '/campanhas', icon: 'Megaphone', permission: 'campanhas.ver', secao: 'entra', modulo: 'campanhas' },
  { key: 'pixels', label: 'Pixels e eventos', href: '/pixels', icon: 'Activity', permission: 'dashboard.ver', secao: 'entra', modulo: 'pixels' },

  // ── O que sai ────────────────────────────────────────────────────────────
  { key: 'conteudo', label: 'Conteúdo', href: '/conteudo', icon: 'FileText', permission: 'dashboard.ver', secao: 'sai', modulo: 'conteudo' },
  { key: 'pauta', label: 'Pauta', href: '/pauta', icon: 'CalendarClock', permission: 'pauta.ver', secao: 'sai', modulo: 'pauta' },
  { key: 'referencias', label: 'Referências', href: '/referencias', icon: 'Library', permission: 'pauta.ver', secao: 'sai', modulo: 'pauta' },
  { key: 'instagram', label: 'Instagram', href: '/instagram', icon: 'Instagram', permission: 'instagram.ver', secao: 'sai', modulo: 'instagram' },
  { key: 'bio', label: 'Link na bio', href: '/bio', icon: 'Link2', permission: 'bio.ver', secao: 'sai', modulo: 'bio' },
  { key: 'metas', label: 'Metas', href: '/metas', icon: 'Target', permission: 'dashboard.ver', secao: 'sai', modulo: 'metas' },

  // ── O dinheiro ───────────────────────────────────────────────────────────
  { key: 'financeiro', label: 'Financeiro', href: '/financeiro', icon: 'Wallet', permission: 'financeiro.ver', secao: 'dinheiro', modulo: 'financeiro' },

  // ── A conta ──────────────────────────────────────────────────────────────
  { key: 'config', label: 'Configurações', href: '/config', icon: 'Settings', permission: 'dashboard.ver', secao: 'conta' },
];

// Páginas que saíram do menu e CONTINUAM VIVAS. Não são rotas mortas: a demo do
// pixel usa /vendas, e /google é o destino do callback OAuth. O destino aqui é
// onde a funcionalidade delas passa a ser alcançada pelo menu.
export const ROTAS_ABSORVIDAS: { href: string; destino: string; porque: string }[] = [
  { href: '/vendas', destino: '/pixels', porque: 'é o manual de instalação do pixel.js mais uma página demo, não um módulo' },
  { href: '/google', destino: '/conexoes', porque: 'gerencia o OAuth do Google — é uma conexão; segue viva como destino do callback' },
];

// Rotas de detalhe que NÃO entram no menu: herdam o módulo pai e são protegidas
// pela permissão dele na API — /leads/:id por leads.ver (leads.controller.ts:27)
// e /campanhas/:id por campanhas.ver (campaigns.controller.ts:23). A sidebar já
// as marca como ativas pelo prefixo do href.
export const NAV_DETALHE: { href: string; parentKey: string; permission: Permission }[] = [
  { href: '/leads/[id]', parentKey: 'leads', permission: 'leads.ver' },
  { href: '/campanhas/[id]', parentKey: 'campanhas', permission: 'campanhas.ver' },
];

/**
 * Agrupa o menu por seção já filtrado pelas permissões do usuário, descartando
 * seções vazias. A sidebar renderiza o retorno na ordem recebida.
 *
 * `modulosLigados` omitido = todos ligados (é o estado de hoje: o registro de
 * módulo por empresa ainda não existe). Quando existir, item com `modulo`
 * desligado sai do menu — e o guard da API precisa sair junto, senão a rota
 * continua respondendo e o esconderijo vira vazamento com fachada.
 */
export function navPorSecao(
  permissoes: Iterable<string>,
  modulosLigados?: Iterable<string>,
): { secao: Secao; itens: NavItem[] }[] {
  const perms = permissoes instanceof Set ? permissoes : new Set(permissoes);
  const mods = modulosLigados
    ? modulosLigados instanceof Set
      ? modulosLigados
      : new Set(modulosLigados)
    : null;

  return SECOES.map((secao) => ({
    secao,
    itens: NAV.filter(
      (n) =>
        n.secao === secao.key &&
        perms.has(n.permission) &&
        (!mods || !n.modulo || mods.has(n.modulo)),
    ),
  })).filter((g) => g.itens.length > 0);
}
