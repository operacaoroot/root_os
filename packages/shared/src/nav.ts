import type { Permission } from './permissions.js';

// A navegação agrupa destinos pela intenção do operador. A posição de uma rota
// não altera a permissão nem o módulo que governa seu acesso.
//
// AS CHAVES SÃO PUBLICADAS. `area:<chave>` é a tag que as notas do vault usam
// para cair numa área do mapa de /contexto (apps/web/src/app/contexto/grafo.ts
// deriva as áreas daqui). Por isso as oito chaves de antes (dia, empresa,
// trabalho, conteudo, comercial, resultados, automacoes, controle) continuam
// existindo e só mudaram de rótulo, de ordem e de tipo; o que entrou de novo
// (financeiro, registros, conta; e `whatsapp` em 20/10/2026) soma chaves. Trocar ou tirar uma chave deixa a
// nota com a tag antiga sem área, calada: o teste de nav.test.ts cobra a lista.
//
// A ORDEM é desenho e pode mudar (18/10/2026: Contexto desceu para depois do
// Motor de IA, docs/comercial/RODADA-PAINEL-20261018.md P0); a CHAVE não.
//
// `dentroDe` é só desenho: a seção aparece recuada sob a outra. Não muda
// permissão, módulo nem o filtro por área.
export const SECOES = [
  { key: 'dia', label: 'Dia a dia', hint: 'pendências, decisões e agenda', tipo: 'principal' },
  { key: 'trabalho', label: 'Trabalho', hint: 'tarefas, quadro e implantação', tipo: 'principal' },
  { key: 'conteudo', label: 'Motor de Marketing', hint: 'conteúdo, campanhas e medição', tipo: 'principal' },
  { key: 'comercial', label: 'Motor Comercial', hint: 'leads e funil de vendas', tipo: 'principal' },
  // 20/10/2026 (rodada da interface, U1): o WhatsApp vira área própria, logo depois do
  // Comercial. Chave nova, somada; nenhuma chave antiga mudou.
  { key: 'whatsapp', label: 'WhatsApp', hint: 'conversas com leads e clientes', tipo: 'principal' },
  { key: 'financeiro', label: 'Motor Financeiro', hint: 'ferramentas e contratos financeiros', tipo: 'principal' },
  { key: 'automacoes', label: 'Motor de IA', hint: 'agentes, rotinas, sessões e custos', tipo: 'principal' },
  // 27/10/2026: a Frota (os servidores de cliente que a ROOT opera) vira área própria. Chave nova,
  // somada; o item é da plataforma (ITENS_DA_ROOT no web), por isso o NAV não o lista.
  { key: 'frota', label: 'Frota', hint: 'servidores de cliente, acessos e políticas', tipo: 'principal' },
  { key: 'empresa', label: 'Contexto', hint: 'mapa, conhecimento e marca', tipo: 'principal' },
  { key: 'resultados', label: 'Resultados', hint: 'relatórios e metas', tipo: 'principal' },
  { key: 'controle', label: 'Configurações da empresa', hint: 'equipe, ferramentas, integrações e regras', tipo: 'apoio' },
  { key: 'registros', label: 'Registros', hint: 'registro de ações e atividade', tipo: 'apoio', dentroDe: 'controle' },
  { key: 'conta', label: 'Configurações da conta', hint: 'perfil e preferências', tipo: 'apoio' },
] as const;

export type SecaoKey = (typeof SECOES)[number]['key'];
export type SecaoTipo = 'principal' | 'apoio';
export interface Secao {
  key: SecaoKey;
  label: string;
  hint: string;
  tipo: SecaoTipo;
  /** Seção que abriga esta no desenho. Ausente = seção de primeiro nível. */
  dentroDe?: SecaoKey;
}

// Módulos habilitáveis por empresa. A chave é o que a tela de Ferramentas
// liga/desliga, o que a coluna `Org.modulos` guarda e o que o gate da API
// consulta a cada requisição (apps/api/src/tenants/). FONTE ÚNICA: quem
// precisar da lista importa daqui. Uma segunda lista em outro arquivo é como a
// contagem de ferramentas do MCP passou anos dizendo 10 quando eram 35.
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

/**
 * O módulo que governa uma rota do WEB, ou `null` quando a rota é espinha do OS
 * (e portanto nunca desliga) ou desconhecida do menu.
 *
 * Casa por href do NAV — item exato ou prefixo de subrota (`/leads/abc` cai em
 * `/leads`) — do href MAIS LONGO para o mais curto, porque um dia dois itens vão
 * compartilhar prefixo com módulos diferentes e o mais específico é quem manda.
 *
 * `null` PARA ROTA DESCONHECIDA É DE PROPÓSITO. A alternativa (desconhecido =
 * bloqueado) transformaria toda tela nova, e o placeholder de
 * `app/[...slug]/page.tsx`, em tela morta até alguém lembrar de declarar o
 * módulo — exatamente o "rota inalcançável por engano" que este mecanismo
 * existe para evitar. O gate que REALMENTE decide é o da API, que trabalha com
 * a lista fechada de prefixos de rota; aqui em cima o papel é não mostrar porta
 * que não abre.
 */
export function moduloDaRotaDoWeb(pathname: string): ModuloKey | null {
  const limpo = pathname.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  const candidatos = [...NAV].sort((a, b) => b.href.length - a.href.length);
  for (const item of candidatos) {
    if (limpo === item.href || limpo.startsWith(`${item.href}/`)) return item.modulo ?? null;
  }
  return null;
}

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: string; // nome do ícone (lucide)
  permission: Permission;
  secao: SecaoKey;
  /**
   * A `key` do item que abriga este no menu. Ausente = item de primeiro nível.
   *
   * O SUBMENU É FORMA, NÃO PERMISSÃO. Pai e filho continuam sendo itens do NAV
   * como qualquer outro: cada um com a sua permissão e o seu módulo, cada um
   * filtrado por conta própria. Aninhar não dá nem tira acesso a nada — e é por
   * isso que `navEmArvore` PROMOVE o filho cujo pai foi filtrado em vez de
   * deixá-lo cair junto (ver o cabeçalho de lá). O caso não é hipotético:
   * `funil` pede `dashboard.ver` e o pai dele, `leads`, pede `leads.ver`.
   *
   * Pai em OUTRA seção não existe: o filho é desenhado dentro da seção do pai,
   * então um pai de outra seção o faria aparecer fora do lugar. Quem cobra isso
   * é `navEmArvore`, que trata esse filho como órfão.
   */
  pai?: string;
  /** Ausente = espinha do OS, não desliga. Presente = gate do módulo. */
  modulo?: ModuloKey;
  /**
   * 'parcial' substitui o antigo `phase`. Número de fase mente depois que a
   * tela existe; o que ajuda é dizer O QUE falta, e é isso que vai no title.
   */
  estado?: 'pleno' | 'parcial';
  parcial?: string;
  /**
   * Fora da sidebar e da paleta, mas dentro do NAV. O item continua sendo o
   * dono da rota: o título da Topbar, `moduloDaRotaDoWeb` e os testes que leem
   * o NAV por chave seguem enxergando-o. Esconder a entrada não muda cobrança,
   * permissão nem dado (documento 38, "Organização da plataforma").
   */
  oculto?: boolean;
}

export const NAV: NavItem[] = [
  // Versão final (19/10/2026, roteiro F3): Visão geral · Pendências · Aprovações ·
  // Agenda · Painel geral da empresa. A Visão geral é o dash das tarefas do Lucas,
  // lendo as pastas e listas do Trabalho, e é a entrada do Dia a dia. A lista de
  // todas as tarefas que morava em /dia-a-dia virou "Todas" no Trabalho; o
  // Calendário, uma visão de Minhas tarefas. A chave `tarefas-todas` não muda.
  { key: 'tarefas-todas', label: 'Visão geral', href: '/dia-a-dia', icon: 'LayoutDashboard', permission: 'tarefas.ver', secao: 'dia', modulo: 'trabalho' },
  // A produção tirou Pendências do menu em 19/10; o roteiro da versão final a mantém
  // (Atividade · Minhas tarefas · Decisões), decisão do Rodrigo.
  { key: 'caixa', label: 'Pendências', href: '/caixa', icon: 'Inbox', permission: 'dashboard.ver', secao: 'dia' },
  { key: 'atendimento', label: 'Aprovações', href: '/atendimento', icon: 'MessagesSquare', permission: 'aprovacoes.ver', secao: 'dia', estado: 'parcial', parcial: 'a fila de aprovação funciona; a caixa de entrada por WhatsApp ainda não está disponível' },
  { key: 'agenda', label: 'Agenda', href: '/agenda', icon: 'CalendarDays', permission: 'dashboard.ver', secao: 'dia' },
  // 20/10/2026 (rodada da interface, U1, item 4 da ata): o Painel geral sai do menu. A
  // Visão geral é a entrada do dia; `/painel` segue viva pela rota (ROTAS_ABSORVIDAS).
  { key: 'console', label: 'Painel geral da empresa', href: '/painel', icon: 'SquareTerminal', permission: 'dashboard.ver', secao: 'dia', oculto: true },

  { key: 'contexto', label: 'Conhecimento da empresa', href: '/contexto', icon: 'Network', permission: 'obsidian.ver', secao: 'empresa', estado: 'parcial', parcial: 'o mapa e a página de Marca estão disponíveis; a aba Identidade ainda não está disponível' },
  { key: 'marca', label: 'Marca e pilares', href: '/contexto/marca', icon: 'Fingerprint', permission: 'pauta.ver', secao: 'empresa', modulo: 'pauta', pai: 'contexto' },

  // As duas listas têm fontes e ações próprias; nenhuma é submenu da outra.
  // Ideias e Estratégia do mês entram aqui e abrem os editores atuais (documento 38).
  // 18/10/2026 (Rodrigo, rodada do painel P0): Temas do ClickUp, Banco de ideias e
  // Estratégia do mês saem do menu por enquanto. Os itens continuam no NAV, ocultos:
  // as telas seguem vivas e a rota segue com dono (ROTAS_ABSORVIDAS diz por quê).
  // 18/10/2026 (rodada do painel P2): quadro e lista viraram uma tela só. `/trabalho`
  // tem a troca Quadro · Lista sobre a mesma fonte (WorkTask) e as pastas no topo;
  // o rótulo virou "Tarefas" (a chave não muda). `/tarefas` sai do menu, oculto, e a
  // página redireciona para `/trabalho?visao=lista`. A Implantação de clientes fica
  // pendurada no Trabalho (só forma: mesma seção, mesma rota, mesmo módulo).
  { key: 'tarefas', label: 'Lista de tarefas', href: '/tarefas', icon: 'CheckSquare', permission: 'tarefas.ver', secao: 'trabalho', modulo: 'trabalho', oculto: true },
  { key: 'trabalho', label: 'Tarefas', href: '/trabalho', icon: 'KanbanSquare', permission: 'tarefas.ver', secao: 'trabalho', modulo: 'trabalho' },
  // 20/10/2026 (rodada da interface, U1/U3): as tarefas de todas as pastas e listas numa
  // tela só, com os segmentos por pasta de topo. Por dentro é o `?pasta=todas` do Trabalho.
  // 20/10/2026 (noite, pedido do Rodrigo): "o Todas é uma opção dentro de Tarefas, não uma
  // subseção". O item sai do menu, oculto e dono da rota; `/trabalho/todas` redireciona
  // para o chip Todas de `/trabalho` com a mesma query (ROTAS_ABSORVIDAS).
  { key: 'trabalho-todas', label: 'Todas as tarefas', href: '/trabalho/todas', icon: 'ListChecks', permission: 'tarefas.ver', secao: 'trabalho', modulo: 'trabalho', pai: 'trabalho', oculto: true },
  // 19/10/2026 (rodada do trabalho T1): "Implantação de clientes" abre o kanban denso da
  // lista "Onboarding de cliente" (pasta Clientes), com rolagem lateral. A bancada antiga
  // `/onboarding` deixa de ser porta: o item fica oculto e a rota redireciona para o kanban;
  // o trilho de cada cliente virou a aba "Trilho" do pop-up do cartão.
  // Leva 5, L3 (27/10/2026, decisão do Rodrigo em 26/10): a subseção Implantação sai do menu e do
  // Dia a dia "por enquanto"; os clientes ficam na lista "Onboarding de cliente" (pasta Clientes, de
  // volta à árvore do Trabalho, recolhida). O item fica oculto e dono da rota: `/trabalho/implantacao`
  // continua respondendo pelo link (ROTAS_ABSORVIDAS). O módulo volta quando os contratos tiverem padrão.
  { key: 'implantacao', label: 'Implantação de clientes', href: '/trabalho/implantacao', icon: 'DoorOpen', permission: 'tarefas.ver', secao: 'trabalho', modulo: 'trabalho', pai: 'trabalho', oculto: true },
  { key: 'onboarding', label: 'Bancada de onboarding', href: '/onboarding', icon: 'DoorOpen', permission: 'tarefas.ver', secao: 'trabalho', modulo: 'trabalho', pai: 'trabalho', oculto: true },
  // 18/10/2026 (rodada do painel P3): o banco de atas da operação, pendurado no Trabalho.
  // As atas do vault e as coladas na tela, e as sugestões de tarefa que cada uma rende.
  { key: 'trabalho-atas', label: 'Atas', href: '/trabalho/atas', icon: 'NotebookText', permission: 'tarefas.ver', secao: 'trabalho', modulo: 'trabalho', pai: 'trabalho' },
  // 22/10/2026 (rodada de produção 3, I2): a Lixeira do Trabalho. Fora do menu de propósito:
  // abre pela engrenagem do topo. O item é o dono da rota (módulo Trabalho, a permissão de apagar).
  { key: 'lixeira', label: 'Lixeira', href: '/lixeira', icon: 'Trash2', permission: 'tarefas.editar', secao: 'trabalho', modulo: 'trabalho', oculto: true },
  // Layout 26/10: "Temas do ClickUp" (`/conteudo`, o espelho ContentItem) foi aposentado. O item
  // sai do NAV e a rota redireciona para o Marketing (`rotas-antigas.mjs`). A API e a tabela ficam.
  // Aba Marketing no jeito do ROOT Estúdio (26/10/2026, decisão do Lucas): o menu mostra só as
  // seções, na ordem dele (Início, Memória, Ideias, Produção, Performance, Página de links,
  // Campanhas, Eventos do site, Tarefas). O resto vira aba dentro da seção (`ABAS_DO_MARKETING`,
  // em `marketing-abas.ts`): oculto aqui, vivo pela rota, com o `pai` dizendo de que seção é.
  // Nenhuma tela foi apagada; a Pauta do Rodrigo (/pauta, episódios e rodadas) segue igual.
  { key: 'marketing', label: 'Início', href: '/marketing', icon: 'Megaphone', permission: 'pauta.ver', secao: 'conteudo', modulo: 'pauta' },
  { key: 'marketing-memoria', label: 'Memória', href: '/marketing/memoria', icon: 'Brain', permission: 'pauta.ver', secao: 'conteudo', modulo: 'pauta' },
  { key: 'marketing-triagem', label: 'Ideias de conteúdo', href: '/marketing/triagem', icon: 'Lightbulb', permission: 'pauta.ver', secao: 'conteudo', modulo: 'pauta' },
  { key: 'marketing-base', label: 'Base', href: '/marketing/base', icon: 'Library', permission: 'pauta.ver', secao: 'conteudo', modulo: 'pauta', pai: 'marketing-triagem', oculto: true },
  { key: 'marketing-fontes', label: 'Fontes', href: '/marketing/fontes', icon: 'Rss', permission: 'pauta.ver', secao: 'conteudo', modulo: 'pauta', pai: 'marketing-triagem', oculto: true },
  { key: 'marketing-estrategia', label: 'Estratégia do mês', href: '/marketing/estrategia', icon: 'Compass', permission: 'pauta.ver', secao: 'conteudo', modulo: 'pauta', pai: 'marketing-triagem', oculto: true },
  { key: 'referencias', label: 'Referências', href: '/referencias', icon: 'Library', permission: 'pauta.ver', secao: 'conteudo', modulo: 'pauta', pai: 'marketing-triagem', oculto: true },
  { key: 'marketing-ideias', label: 'Ideias da pauta', href: '/marketing/ideias', icon: 'Lightbulb', permission: 'pauta.ver', secao: 'conteudo', modulo: 'pauta', pai: 'marketing-triagem', oculto: true },
  { key: 'maquina-producao', label: 'Produção', href: '/marketing/producao', icon: 'Clapperboard', permission: 'pauta.ver', secao: 'conteudo', modulo: 'pauta' },
  { key: 'maquina-banco', label: 'Banco de ideias', href: '/marketing/banco', icon: 'Lightbulb', permission: 'pauta.ver', secao: 'conteudo', modulo: 'pauta', pai: 'maquina-producao', oculto: true },
  { key: 'maquina-agendar', label: 'Agendar', href: '/marketing/agendar', icon: 'CalendarPlus', permission: 'pauta.ver', secao: 'conteudo', modulo: 'pauta', pai: 'maquina-producao', oculto: true },
  { key: 'maquina-calendario', label: 'Calendário', href: '/marketing/calendario', icon: 'CalendarDays', permission: 'pauta.ver', secao: 'conteudo', modulo: 'pauta', pai: 'maquina-producao', oculto: true },
  { key: 'marketing-formatos', label: 'Formatos', href: '/marketing/formatos', icon: 'Ruler', permission: 'pauta.ver', secao: 'conteudo', modulo: 'pauta', pai: 'maquina-producao', oculto: true },
  { key: 'pauta', label: 'Pauta (episódios)', href: '/pauta', icon: 'CalendarClock', permission: 'pauta.ver', secao: 'conteudo', modulo: 'pauta', pai: 'maquina-producao', oculto: true },
  { key: 'marketing-performance', label: 'Performance', href: '/marketing/performance', icon: 'TrendingUp', permission: 'pauta.ver', secao: 'conteudo', modulo: 'pauta' },
  { key: 'maquina-analise', label: 'Análise dos posts', href: '/marketing/analise', icon: 'BarChart3', permission: 'pauta.ver', secao: 'conteudo', modulo: 'pauta', pai: 'marketing-performance', oculto: true },
  { key: 'marketing-relatorio', label: 'Relatório do mês', href: '/marketing/relatorio', icon: 'FileBarChart', permission: 'pauta.ver', secao: 'conteudo', modulo: 'pauta', pai: 'marketing-performance', oculto: true },
  { key: 'instagram', label: 'Instagram', href: '/instagram', icon: 'Instagram', permission: 'instagram.ver', secao: 'conteudo', modulo: 'instagram', pai: 'marketing-performance', oculto: true },
  { key: 'bio', label: 'Página de links', href: '/bio', icon: 'Link2', permission: 'bio.ver', secao: 'conteudo', modulo: 'bio' },
  { key: 'campanhas', label: 'Campanhas', href: '/campanhas', icon: 'Megaphone', permission: 'campanhas.ver', secao: 'conteudo', modulo: 'campanhas' },
  { key: 'pixels', label: 'Eventos do site', href: '/pixels', icon: 'Activity', permission: 'dashboard.ver', secao: 'conteudo', modulo: 'pixels' },
  // A aba Tarefas de cada área é a visão "Todas" do Trabalho filtrada pela área: a mesma tarefa, nunca cópia (19/10/2026).
  { key: 'marketing-tarefas', label: 'Tarefas', href: '/marketing/tarefas', icon: 'CheckSquare', permission: 'tarefas.ver', secao: 'conteudo', modulo: 'trabalho' },

  // Versão final (19/10/2026, roteiro F2): Painel geral · Funil vivo · Propostas ·
  // Lista de leads · Contratos vivos · Torre das automações · Relatório da semana (o
  // Simulador de WhatsApp virou a área WhatsApp em 20/10/2026, e a Rodada da semana entra
  // depois dos Contratos vivos só para a sessão da plataforma, fora do NAV). O Painel geral é o dash do Lucas (layout dele) lendo os
  // dados do cockpit; Propostas lê as do serviço da ROOT e as publicadas pela sala;
  // a Lista de leads lê a tabela `Lead`. Saem do Comercial (ocultos, vivos): o funil
  // antigo, Clientes e Tarefas (duplicados do Funil vivo, da Implantação e do Trabalho).
  { key: 'comercial-painel', label: 'Painel geral', href: '/comercial', icon: 'TrendingUp', permission: 'leads.ver', secao: 'comercial', modulo: 'leads' },
  { key: 'comercial-funil', label: 'Funil de vendas', href: '/comercial/funil', icon: 'Columns3', permission: 'leads.ver', secao: 'comercial', modulo: 'leads' },
  { key: 'propostas', label: 'Propostas', href: '/propostas', icon: 'Handshake', permission: 'leads.ver', secao: 'comercial', modulo: 'leads' },
  { key: 'leads', label: 'Lista de leads', href: '/leads', icon: 'UserPlus', permission: 'leads.ver', secao: 'comercial', modulo: 'leads' },
  { key: 'comercial-contratos', label: 'Contratos vivos', href: '/comercial/contratos', icon: 'FileSignature', permission: 'leads.ver', secao: 'comercial', modulo: 'leads' },
  // Cockpit do lead (lane B, 13/10/2026): os celulares simulados do lead e da mesa, provedor `simulado`.
  // 20/10/2026 (rodada da interface, U1, item 18 da ata): a tela mudou para a área
  // WhatsApp (`/whatsapp`). O item fica oculto e a rota redireciona, preservando a query.
  { key: 'comercial-simulador', label: 'Simulador de WhatsApp', href: '/comercial/simulador', icon: 'Smartphone', permission: 'leads.ver', secao: 'comercial', modulo: 'leads', oculto: true },
  { key: 'comercial-torre', label: 'Torre das automações', href: '/comercial/torre', icon: 'RadioTower', permission: 'leads.ver', secao: 'comercial', modulo: 'leads' },
  { key: 'comercial-relatorio', label: 'Relatório da semana', href: '/comercial/relatorio', icon: 'FileBarChart', permission: 'leads.ver', secao: 'comercial', modulo: 'leads' },
  { key: 'funil', label: 'Funil de vendas', href: '/funil', icon: 'Filter', permission: 'dashboard.ver', secao: 'comercial', modulo: 'leads', pai: 'leads', oculto: true },
  { key: 'clientes', label: 'Clientes', href: '/clientes', icon: 'HeartHandshake', permission: 'tarefas.ver', secao: 'comercial', modulo: 'trabalho', oculto: true },
  { key: 'comercial-tarefas', label: 'Tarefas', href: '/comercial/tarefas', icon: 'CheckSquare', permission: 'tarefas.ver', secao: 'comercial', modulo: 'trabalho', oculto: true },
  // A fila de decisões (lane C, 13/10/2026) sai do menu em 19/10/2026: oculta, viva,
  // em `/comercial/decisoes` (`/comercial` voltou a ser o Painel geral).
  { key: 'comercial-decisoes', label: 'Decisões do comercial', href: '/comercial/decisoes', icon: 'Inbox', permission: 'leads.ver', secao: 'comercial', modulo: 'leads', oculto: true },

  // 20/10/2026 (rodada da interface, U1): a tela de conversas do WhatsApp, o celular do
  // lead e o da mesa no provedor configurado. Mesma permissão e mesmo módulo de antes.
  { key: 'whatsapp', label: 'WhatsApp', href: '/whatsapp', icon: 'MessageCircle', permission: 'leads.ver', secao: 'whatsapp', modulo: 'leads' },

  { key: 'financeiro', label: 'Financeiro', href: '/financeiro', icon: 'Wallet', permission: 'financeiro.ver', secao: 'financeiro', modulo: 'financeiro' },
  { key: 'financeiro-tarefas', label: 'Tarefas', href: '/financeiro/tarefas', icon: 'CheckSquare', permission: 'tarefas.ver', secao: 'financeiro', modulo: 'trabalho' },

  { key: 'agentes', label: 'Agentes de IA', href: '/agentes', icon: 'Users', permission: 'mcp.ver', secao: 'automacoes' },
  { key: 'rotinas', label: 'Rotinas automáticas', href: '/rotinas', icon: 'Repeat', permission: 'automacoes.ver', secao: 'automacoes' },
  { key: 'sessoes', label: 'Sessões de IA', href: '/sessoes', icon: 'Bot', permission: 'mcp.ver', secao: 'automacoes' },
  { key: 'fluxos', label: 'Processos', href: '/fluxos', icon: 'Workflow', permission: 'automacoes.ver', secao: 'automacoes', estado: 'parcial', parcial: 'em preparação: esta rota ainda não oferece um editor de processos' },
  { key: 'custo-ia', label: 'Custos de IA', href: '/painel/custo-ia', icon: 'DollarSign', permission: 'dashboard.ver', secao: 'automacoes' },

  { key: 'relatorios', label: 'Relatórios', href: '/relatorios', icon: 'BarChart3', permission: 'relatorios.ver', secao: 'resultados', modulo: 'relatorios' },
  { key: 'metas', label: 'Metas', href: '/metas', icon: 'Target', permission: 'dashboard.ver', secao: 'resultados', modulo: 'metas' },

  { key: 'organograma', label: 'Equipe', href: '/organograma', icon: 'Share2', permission: 'dashboard.ver', secao: 'controle' },
  { key: 'ferramentas', label: 'Ferramentas disponíveis', href: '/ferramentas', icon: 'Wrench', permission: 'mcp.ver', secao: 'controle', estado: 'parcial', parcial: 'o catálogo completo de ferramentas ainda não está disponível nesta tela' },
  { key: 'conexoes', label: 'Integrações', href: '/conexoes', icon: 'Cable', permission: 'dashboard.ver', secao: 'controle' },
  { key: 'regua', label: 'Regras e permissões', href: '/regua', icon: 'Shield', permission: 'mcp.ver', secao: 'controle' },
  // Senhas, dados e documentos dos sócios, atrás de uma senha própria. Fora do alcance da IA.
  { key: 'cofre', label: 'Cofre', href: '/cofre', icon: 'LockKeyhole', permission: 'cofre.ver', secao: 'controle' },
  { key: 'assinatura', label: 'Plano e assinatura', href: '/assinatura', icon: 'CreditCard', permission: 'dashboard.ver', secao: 'controle', oculto: true },

  { key: 'rastro', label: 'Registro de ações', href: '/rastro', icon: 'Footprints', permission: 'auditoria.ver', secao: 'registros' },
  { key: 'linha-do-tempo', label: 'Atividade', href: '/linha-do-tempo', icon: 'History', permission: 'auditoria.ver', secao: 'registros', pai: 'rastro' },

  { key: 'config', label: 'Configurações da conta', href: '/config', icon: 'Settings', permission: 'dashboard.ver', secao: 'conta' },
  // Produção 22B (I6): o perfil da pessoa (foto, cadastro, nome no vault). A entrada é a
  // engrenagem do topo; o item fica oculto e dono da rota (título da Topbar, módulo).
  { key: 'perfil', label: 'Perfil', href: '/perfil', icon: 'UserCircle', permission: 'dashboard.ver', secao: 'conta', oculto: true },
];

// Páginas que saíram do menu e CONTINUAM VIVAS. Não são rotas mortas: a demo do
// pixel usa /vendas, e /google é o destino do callback OAuth. O destino aqui é
// onde a funcionalidade delas passa a ser alcançada pelo menu.
// Nenhum destino abaixo pode ser /conteudo (espelho ContentItem do ClickUp) nem
// /tarefas: a fonte migrada do ClickUp é o Trabalho (/trabalho, WorkTask). Desde
// 18/10/2026 /conteudo (P0) e /tarefas (P2, que redireciona para a visão Lista do
// Trabalho) entram aqui como ORIGEM, itens ocultos. A tabela `Task` antiga não é
// apagada; apagar telas e tabela é decisão do Pedro (ROOT-10, MK7 §3.1).
export const ROTAS_ABSORVIDAS: { href: string; destino: string; porque: string }[] = [
  { href: '/vendas', destino: '/pixels', porque: 'é o manual de instalação do pixel.js mais uma página demo, não um módulo' },
  { href: '/google', destino: '/conexoes', porque: 'gerencia o OAuth do Google — é uma conexão; segue viva como destino do callback' },
  // 18/10/2026, rodada do painel P0: itens OCULTOS do NAV (continuam donos da rota e
  // do módulo). Apagar de vez é decisão do Pedro (ROOT-10, MK7-telas-repetidas §3.1).
  { href: '/funil', destino: '/comercial/funil', porque: 'o cockpit absorve o MVP: o Funil vivo substitui o funil de antes; a tela segue viva' },
  // Layout 26/10: `/conteudo` saiu daqui. A tela foi aposentada e a rota redireciona para
  // `/marketing` (`apps/web/rotas-antigas.mjs`).
  // 18/10/2026, rodada do painel P2: a lista de tarefas virou a visão Lista do Trabalho.
  { href: '/tarefas', destino: '/trabalho', porque: 'quadro e lista viraram uma tela só em 18/10/2026; /tarefas abre a visão de lista' },
  // 19/10/2026, rodada do trabalho T6: a fila de decisões do comercial virou a aba
  // Decisões de Pendências; a tela antiga mora em `/comercial/decisoes`. Na versão
  // final `/comercial` é o Painel geral do Comercial (o dash do Lucas), não um redirect.
  { href: '/comercial/decisoes', destino: '/caixa', porque: 'as decisões do comercial passaram a Pendências em 19/10/2026; a tela segue viva' },
  // 19/10/2026, rodada do trabalho T1: a implantação numa tela só.
  { href: '/onboarding', destino: '/trabalho/implantacao', porque: 'a implantação de clientes virou o kanban da lista Onboarding de cliente em 19/10/2026; /onboarding redireciona e o trilho é a aba do pop-up do cartão' },
  // Versão final (19/10/2026): o que a produção criou e a versão final absorve.
  { href: '/clientes', destino: '/trabalho/implantacao', porque: 'onboarding e sucesso do cliente são a Implantação e os Contratos vivos na versão final; a tela segue viva' },
  { href: '/comercial/tarefas', destino: '/trabalho', porque: 'as tarefas do comercial estão no Trabalho (pasta Gestão) na versão final; a tela segue viva' },
  // 20/10/2026, rodada da interface (U1).
  { href: '/painel', destino: '/dia-a-dia', porque: 'a Visão geral é a entrada do dia; o painel antigo segue vivo pela rota' },
  // Produção 22C (22/10/2026, W2): `/whatsapp` virou a caixa de conversas e os celulares do comercial foram para
  // `/whatsapp/simulador`, dentro da mesma área. O destino aqui é o ITEM do menu que ficou com a função (a área
  // WhatsApp); a página de `/comercial/simulador` redireciona para `/whatsapp/simulador` (`destinoDoSimulador`).
  { href: '/comercial/simulador', destino: '/whatsapp', porque: 'o WhatsApp virou área própria em 20/10/2026 e, desde 22/10/2026, /whatsapp é a caixa; /comercial/simulador redireciona para /whatsapp/simulador (os celulares do comercial) com a mesma query' },
  // 20/10/2026 (noite, pedido do Rodrigo): o destino leva a query do chip, e o item é `/trabalho`.
  { href: '/trabalho/todas', destino: '/trabalho?pasta=todas', porque: 'o Todas é uma opção dentro de Tarefas, não uma subseção (20/10/2026); /trabalho/todas redireciona para o chip Todas com a mesma query' },
  // Leva 5, L3 (27/10/2026): a Implantação sai do menu e do Dia a dia "por enquanto". Os clientes ficam na
  // lista "Onboarding de cliente" (pasta Clientes), que volta à árvore de /trabalho recolhida; a rota do
  // kanban continua respondendo pelo link. O id da lista é de cada empresa, por isso o destino é a árvore.
  { href: '/trabalho/implantacao', destino: '/trabalho', porque: 'a Implantação de clientes saiu do menu em 27/10/2026 (decisão de 26/10): os clientes ficam na lista Onboarding de cliente, na pasta Clientes da árvore do Trabalho; o kanban segue vivo pelo link e o módulo volta quando os contratos tiverem padrão' },
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
 * `modulosLigados` omitido = todos ligados. Desde 11/09/2026 isso NÃO é mais o
 * estado normal do sistema e sim o estado "ainda não sei": o registro por
 * empresa existe (`Org.modulos`) e chega ao web por `GET /api/tenants/modulos`.
 * Enquanto a resposta não chega — ou se ela falhar —, o menu aparece inteiro de
 * propósito: esconder por falta de informação é sumir com tela que a pessoa tem
 * direito de ver, e quem REALMENTE recusa é a API (apps/api/src/tenants/), que
 * não depende desta chamada. Item com `modulo` desligado sai do menu, e a rota
 * correspondente responde 404 — sem as duas metades, o esconderijo seria só
 * fachada.
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
        !n.oculto &&
        perms.has(n.permission) &&
        (!mods || !n.modulo || mods.has(n.modulo)),
    ),
  })).filter((g) => g.itens.length > 0);
}

/** Um item do menu com o que ele abriga. `filhos` vazio = item sem submenu. */
export interface NoDeNav {
  item: NavItem;
  filhos: NavItem[];
}

/*
 * O MENU EM DOIS NÍVEIS — a forma do painel do Paperclip trazida para cá
 * (docs/PLANO-CONTROLE-DE-AGENTES.md, fatia A1).
 *
 * ----------------------------------------------------------------------------
 * POR QUE É UMA FUNÇÃO NOVA, E NÃO O `navPorSecao` COM OUTRO FORMATO
 * ----------------------------------------------------------------------------
 * O `navPorSecao` devolve a lista PLANA e tem três consumidores que dependem
 * disso: a paleta de comandos (que quer tudo alcançável por busca, sem
 * hierarquia), a suíte `nav.test.ts` e a trava de módulos por tenant na API
 * (`apps/api/test/modulos-por-tenant.test.ts`). Trocar o formato dele para
 * ganhar o submenu quebraria os três para servir a um. Aqui em cima o que muda
 * é só o DESENHO, então o desenho é que ganha função própria.
 *
 * ----------------------------------------------------------------------------
 * O ÓRFÃO SOBE — e este é o ponto que custa acesso se for esquecido
 * ----------------------------------------------------------------------------
 * Filho cujo pai não passou pelo filtro (permissão que a pessoa não tem, módulo
 * que a empresa não contratou) ou cujo pai vive em outra seção NÃO desaparece:
 * ele vira item de primeiro nível, no lugar em que o NAV o põe. A alternativa
 * — sumir junto com o pai — tiraria da pessoa uma tela que ela tem, calada, e é
 * caso real e não hipótese: `funil` pede `dashboard.ver` e `leads` pede
 * `leads.ver`, então quem opera sem `leads.ver` continua vendo o Funil.
 *
 * A soma dos itens da árvore é sempre igual à da lista plana. A suíte cobra.
 */
export function navEmArvore(
  permissoes: Iterable<string>,
  modulosLigados?: Iterable<string>,
): { secao: Secao; itens: NoDeNav[] }[] {
  return navPorSecao(permissoes, modulosLigados)
    .map(({ secao, itens }) => {
      const presentes = new Map(itens.map((n) => [n.key, n]));
      const nos: NoDeNav[] = [];
      const porChave = new Map<string, NoDeNav>();

      // Primeira passada: quem é de primeiro nível. Inclui o órfão — filho cujo
      // pai não está NESTA seção, seja porque foi filtrado, seja porque o pai
      // mora em outra.
      for (const item of itens) {
        if (item.pai && presentes.has(item.pai)) continue;
        const no = { item, filhos: [] as NavItem[] };
        nos.push(no);
        porChave.set(item.key, no);
      }

      // Segunda passada: pendura cada filho no pai, na ordem do NAV. Só há um
      // nível para manter a navegação legível também na gaveta móvel.
      for (const item of itens) {
        if (!item.pai) continue;
        const pai = porChave.get(item.pai) ?? porChave.get(presentes.get(item.pai)?.pai ?? '');
        if (pai) pai.filhos.push(item);
      }

      return { secao, itens: nos };
    })
    .filter((g) => g.itens.length > 0);
}
