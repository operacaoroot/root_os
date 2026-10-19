import { NAV, navPorSecao, type NavItem } from '@mktos/shared';

/**
 * Somente apresentação: permissões, módulos e URLs continuam no NAV.
 * A ordem segue a de `SECOES` (o Contexto desceu para depois do Motor de IA em
 * 18/10/2026). `principal` é a entrada da área: Dia a dia abre na Visão geral e
 * o Comercial no Painel geral (versão final, 19/10/2026).
 */
export const AREAS_DE_NAVEGACAO = [
  { key: 'dia', label: 'Dia a dia', icon: 'Inbox', secoes: ['dia'], principal: 'tarefas-todas' },
  { key: 'trabalho', label: 'Trabalho', icon: 'KanbanSquare', secoes: ['trabalho'], principal: 'trabalho' },
  { key: 'conteudo', label: 'Marketing', icon: 'Megaphone', secoes: ['conteudo'], principal: 'marketing' },
  { key: 'comercial', label: 'Comercial', icon: 'Handshake', secoes: ['comercial'], principal: 'comercial-painel' },
  { key: 'financeiro', label: 'Financeiro', icon: 'Wallet', secoes: ['financeiro'], principal: 'financeiro' },
  { key: 'automacoes', label: 'IA e automações', icon: 'Bot', secoes: ['automacoes'], principal: 'agentes' },
  { key: 'empresa', label: 'Contexto', icon: 'Network', secoes: ['empresa'], principal: 'contexto' },
  { key: 'resultados', label: 'Resultados', icon: 'BarChart3', secoes: ['resultados'], principal: 'relatorios' },
  { key: 'configuracoes', label: 'Configurações', icon: 'Settings', secoes: ['controle', 'registros', 'conta'], principal: 'config' },
] as const;

export const OPERACAO_DA_ROOT: NavItem = {
  key: 'operacao', label: 'Operação da Root', href: '/operacao', icon: 'Radar',
  permission: 'dashboard.ver', secao: 'dia',
};
/**
 * Telas da ROOT: fora do NAV, porque o NAV filtra por permissão e não por "ser a plataforma".
 * A Operação da Root (rodada semanal) mora dentro da Implantação desde 19/10/2026;
 * a rota /operacao segue viva. Propostas saiu daqui na versão final: virou item do
 * NAV (Comercial, `leads.ver`), e listá-la aqui de novo a mostraria duas vezes.
 */
export const ITENS_DA_ROOT: readonly NavItem[] = [];
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
  const permitidos = navPorSecao(permissoes, modulos).flatMap((grupo) => grupo.itens);
  // A API de plataforma confirma o acesso às telas da ROOT. Permissões comuns não o substituem.
  if (ehPlataforma) permitidos.push(...ITENS_DA_ROOT);
  return AREAS_DE_NAVEGACAO.map((area) => {
    const itens = permitidos.filter((item) => (area.secoes as readonly string[]).includes(item.secao));
    const entrada = itens.find((item) => item.key === area.principal) ?? itens[0];
    return { ...area, itens, entrada };
  }).filter((area) => area.itens.length > 0);
}
