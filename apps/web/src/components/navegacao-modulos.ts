import { NAV, navPorSecao, type NavItem } from '@mktos/shared';

/**
 * Somente apresentação: permissões, módulos e URLs continuam no NAV.
 * A ordem segue a de `SECOES` (o Contexto desceu para depois do Motor de IA em
 * 18/10/2026; o WhatsApp entrou depois do Comercial em 20/10/2026). `principal`
 * é a entrada da área: Dia a dia abre na Visão geral e o Comercial no Painel geral.
 */
export const AREAS_DE_NAVEGACAO = [
  { key: 'dia', label: 'Dia a dia', icon: 'Inbox', secoes: ['dia'], principal: 'tarefas-todas' },
  { key: 'trabalho', label: 'Trabalho', icon: 'KanbanSquare', secoes: ['trabalho'], principal: 'trabalho' },
  { key: 'conteudo', label: 'Marketing', icon: 'Megaphone', secoes: ['conteudo'], principal: 'marketing' },
  { key: 'comercial', label: 'Comercial', icon: 'Handshake', secoes: ['comercial'], principal: 'comercial-painel' },
  { key: 'whatsapp', label: 'WhatsApp', icon: 'MessageCircle', secoes: ['whatsapp'], principal: 'whatsapp' },
  { key: 'financeiro', label: 'Financeiro', icon: 'Wallet', secoes: ['financeiro'], principal: 'financeiro' },
  { key: 'automacoes', label: 'IA e automações', icon: 'Bot', secoes: ['automacoes'], principal: 'agentes' },
  { key: 'frota', label: 'Frota', icon: 'Server', secoes: ['frota'], principal: 'frota' },
  { key: 'empresa', label: 'Contexto', icon: 'Network', secoes: ['empresa'], principal: 'contexto' },
  { key: 'resultados', label: 'Resultados', icon: 'BarChart3', secoes: ['resultados'], principal: 'relatorios' },
  { key: 'configuracoes', label: 'Configurações', icon: 'Settings', secoes: ['controle', 'registros', 'conta'], principal: 'config' },
] as const;

export type AreaDeNavegacao = (typeof AREAS_DE_NAVEGACAO)[number];

export const OPERACAO_DA_ROOT: NavItem = {
  key: 'operacao', label: 'Operação da Root', href: '/operacao', icon: 'Radar',
  permission: 'dashboard.ver', secao: 'dia',
};

/**
 * A Rodada da semana do Pedro (a tela de `/operacao`) mora no Comercial desde
 * 20/10/2026 (rodada da interface, U1, item 10 da ata), em `/comercial/rodada`.
 * É tela da ROOT: só a sessão da plataforma a vê, e a API do painel recusa as
 * outras sessões de qualquer jeito. A permissão abaixo não é usada para mostrar o
 * item (o que decide é `ehPlataforma`); ela é a do Comercial, para a rota ter dono.
 */
export const RODADA_DA_SEMANA: NavItem = {
  key: 'comercial-rodada', label: 'Rodada da semana', href: '/comercial/rodada', icon: 'Radar',
  permission: 'leads.ver', secao: 'comercial', modulo: 'leads',
};

/**
 * Telas da ROOT: fora do NAV, porque o NAV filtra por permissão e não por "ser a
 * plataforma". `depoisDe` diz onde o item entra na área (a chave do item do NAV que
 * vem antes dele); sem o vizinho visível, ele vai para o fim da área.
 * Propostas saiu daqui na versão final: virou item do NAV (Comercial, `leads.ver`).
 */
/**
 * A Frota (27/10/2026): os servidores de cliente que a ROOT opera — estado, apps,
 * acessos com revogação, políticas/LGPD e registro. Tela da ROOT: só a sessão da
 * plataforma a vê, e a API recusa as outras. Área própria no menu.
 */
export const FROTA: NavItem = {
  key: 'frota', label: 'Servidores', href: '/frota', icon: 'Server',
  permission: 'dashboard.ver', secao: 'frota',
};

/**
 * O fluxo do cliente (30/10/2026): o caminho da proposta aceita até a continuidade ou o
 * fim, com dono e "feito quando" em cada tarefa (reunião de sócios de 29/10). É o
 * contexto da operação da ROOT, ao lado da Marca. Tela da ROOT: a API recusa as outras.
 */
export const FLUXO_DO_CLIENTE: NavItem = {
  key: 'fluxo-do-cliente', label: 'Fluxo do cliente', href: '/contexto/fluxo-do-cliente', icon: 'Route',
  permission: 'dashboard.ver', secao: 'empresa', pai: 'contexto',
};

export const ITENS_DA_ROOT: readonly (NavItem & { depoisDe?: string })[] = [
  { ...RODADA_DA_SEMANA, depoisDe: 'comercial-contratos' },
  FROTA,
  { ...FLUXO_DO_CLIENTE, depoisDe: 'marca' },
];

export function rotuloDoDestino(item: NavItem): string {
  if (item.key === 'contexto') return 'Mapa da empresa';
  if (item.key === 'marca') return 'Marca e brandbook';
  return item.label;
}
export function areaDoDestino(item: NavItem) {
  return AREAS_DE_NAVEGACAO.find((area) => (area.secoes as readonly string[]).includes(item.secao));
}
export function destinoDaRota(pathname: string, ehPlataforma = false): NavItem | undefined {
  const caminho = pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  return [...NAV, ...(ehPlataforma ? ITENS_DA_ROOT : [])]
    .filter((item) => caminho === item.href || caminho.startsWith(`${item.href}/`))
    .sort((a, b) => b.href.length - a.href.length)[0];
}
export function modulosDeNavegacao(permissoes: Iterable<string>, modulos?: Iterable<string>, ehPlataforma = false) {
  const permitidos: NavItem[] = navPorSecao(permissoes, modulos).flatMap((grupo) => grupo.itens);
  // A API de plataforma confirma o acesso às telas da ROOT. Permissões comuns não o substituem.
  if (ehPlataforma) {
    const ligados = modulos ? new Set(modulos) : null;
    for (const { depoisDe, ...item } of ITENS_DA_ROOT) {
      // Módulo desligado tira também a tela da ROOT: a rota responderia "não contratado".
      if (ligados && item.modulo && !ligados.has(item.modulo)) continue;
      const vizinho = depoisDe ? permitidos.findIndex((n) => n.key === depoisDe) : -1;
      if (vizinho >= 0) permitidos.splice(vizinho + 1, 0, item);
      else permitidos.push(item);
    }
  }
  return AREAS_DE_NAVEGACAO.map((area) => {
    const itens = permitidos.filter((item) => (area.secoes as readonly string[]).includes(item.secao));
    const entrada = itens.find((item) => item.key === area.principal) ?? itens[0];
    return { ...area, itens, entrada };
  }).filter((area) => area.itens.length > 0);
}
