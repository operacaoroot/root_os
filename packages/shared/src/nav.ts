import type { Permission } from './permissions.js';

// A navegação agrupa destinos pela intenção do operador. A posição de uma rota
// não altera a permissão nem o módulo que governa seu acesso.
//
// AS CHAVES SÃO PUBLICADAS. `area:<chave>` é a tag que as notas do vault usam
// para cair numa área do mapa de /contexto (apps/web/src/app/contexto/grafo.ts
// deriva as áreas daqui). Por isso as oito chaves de antes (dia, empresa,
// trabalho, conteudo, comercial, resultados, automacoes, controle) continuam
// existindo e só mudaram de rótulo, de ordem e de tipo; o que entrou de novo
// (financeiro, registros, conta) soma chaves. Trocar ou tirar uma chave deixa a
// nota com a tag antiga sem área, calada: o teste de nav.test.ts cobra a lista.
//
// `dentroDe` é só desenho: a seção aparece recuada sob a outra. Não muda
// permissão, módulo nem o filtro por área.
export const SECOES = [
  { key: 'dia', label: 'Dia a dia', hint: 'pendências, decisões e agenda', tipo: 'principal' },
  { key: 'empresa', label: 'Contexto', hint: 'mapa, conhecimento e marca', tipo: 'principal' },
  { key: 'trabalho', label: 'Trabalho', hint: 'tarefas, quadro, ideias e implantação', tipo: 'principal' },
  { key: 'conteudo', label: 'Motor de Marketing', hint: 'conteúdo, campanhas e medição', tipo: 'principal' },
  { key: 'comercial', label: 'Motor Comercial', hint: 'leads e funil de vendas', tipo: 'principal' },
  { key: 'financeiro', label: 'Motor Financeiro', hint: 'ferramentas e contratos financeiros', tipo: 'principal' },
  { key: 'automacoes', label: 'Motor de IA', hint: 'agentes, rotinas, sessões e custos', tipo: 'principal' },
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
  // O trabalho do dia: /caixa continua lendo o quadro interno e não vira a entrada padrão.
  { key: 'caixa', label: 'Pendências', href: '/caixa', icon: 'Inbox', permission: 'dashboard.ver', secao: 'dia' },
  { key: 'atendimento', label: 'Aprovações', href: '/atendimento', icon: 'MessagesSquare', permission: 'aprovacoes.ver', secao: 'dia', estado: 'parcial', parcial: 'a fila de aprovação funciona; a caixa de entrada por WhatsApp ainda não está disponível' },
  { key: 'agenda', label: 'Agenda', href: '/agenda', icon: 'CalendarDays', permission: 'dashboard.ver', secao: 'dia' },
  { key: 'console', label: 'Visão geral da empresa', href: '/painel', icon: 'SquareTerminal', permission: 'dashboard.ver', secao: 'dia' },

  { key: 'contexto', label: 'Conhecimento da empresa', href: '/contexto', icon: 'Network', permission: 'obsidian.ver', secao: 'empresa', estado: 'parcial', parcial: 'o mapa e a página de Marca estão disponíveis; a aba Identidade ainda não está disponível' },
  { key: 'marca', label: 'Marca e pilares', href: '/contexto/marca', icon: 'Fingerprint', permission: 'pauta.ver', secao: 'empresa', modulo: 'pauta', pai: 'contexto' },

  // As duas listas têm fontes e ações próprias; nenhuma é submenu da outra.
  // Ideias e Estratégia do mês entram aqui e abrem os editores atuais (documento 38).
  { key: 'tarefas', label: 'Lista de tarefas', href: '/tarefas', icon: 'CheckSquare', permission: 'tarefas.ver', secao: 'trabalho', modulo: 'trabalho' },
  { key: 'trabalho', label: 'Quadro interno', href: '/trabalho', icon: 'KanbanSquare', permission: 'tarefas.ver', secao: 'trabalho', modulo: 'trabalho' },
  { key: 'onboarding', label: 'Implantação de clientes', href: '/onboarding', icon: 'DoorOpen', permission: 'tarefas.ver', secao: 'trabalho', modulo: 'trabalho' },
  { key: 'conteudo', label: 'Temas do ClickUp', href: '/conteudo', icon: 'FileText', permission: 'dashboard.ver', secao: 'trabalho', modulo: 'conteudo' },
  { key: 'marketing-ideias', label: 'Banco de ideias', href: '/marketing/ideias', icon: 'Lightbulb', permission: 'pauta.ver', secao: 'trabalho', modulo: 'pauta' },
  { key: 'marketing-estrategia', label: 'Estratégia do mês', href: '/marketing/estrategia', icon: 'Compass', permission: 'pauta.ver', secao: 'trabalho', modulo: 'pauta' },

  { key: 'pauta', label: 'Produção de conteúdo', href: '/pauta', icon: 'CalendarClock', permission: 'pauta.ver', secao: 'conteudo', modulo: 'pauta' },
  { key: 'referencias', label: 'Referências', href: '/referencias', icon: 'Library', permission: 'pauta.ver', secao: 'conteudo', modulo: 'pauta', pai: 'pauta' },
  { key: 'marketing', label: 'Marketing', href: '/marketing', icon: 'Megaphone', permission: 'pauta.ver', secao: 'conteudo', modulo: 'pauta' },
  { key: 'marketing-performance', label: 'Performance', href: '/marketing/performance', icon: 'TrendingUp', permission: 'pauta.ver', secao: 'conteudo', modulo: 'pauta', pai: 'marketing' },
  { key: 'marketing-relatorio', label: 'Relatório do mês', href: '/marketing/relatorio', icon: 'FileBarChart', permission: 'pauta.ver', secao: 'conteudo', modulo: 'pauta', pai: 'marketing' },
  { key: 'instagram', label: 'Instagram', href: '/instagram', icon: 'Instagram', permission: 'instagram.ver', secao: 'conteudo', modulo: 'instagram' },
  { key: 'bio', label: 'Página de links', href: '/bio', icon: 'Link2', permission: 'bio.ver', secao: 'conteudo', modulo: 'bio' },
  { key: 'campanhas', label: 'Campanhas', href: '/campanhas', icon: 'Megaphone', permission: 'campanhas.ver', secao: 'conteudo', modulo: 'campanhas' },
  { key: 'pixels', label: 'Eventos do site', href: '/pixels', icon: 'Activity', permission: 'dashboard.ver', secao: 'conteudo', modulo: 'pixels' },

  { key: 'leads', label: 'Leads', href: '/leads', icon: 'UserPlus', permission: 'leads.ver', secao: 'comercial', modulo: 'leads' },
  { key: 'funil', label: 'Funil de vendas', href: '/funil', icon: 'Filter', permission: 'dashboard.ver', secao: 'comercial', modulo: 'leads', pai: 'leads' },

  { key: 'financeiro', label: 'Financeiro', href: '/financeiro', icon: 'Wallet', permission: 'financeiro.ver', secao: 'financeiro', modulo: 'financeiro' },

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
  { key: 'assinatura', label: 'Plano e assinatura', href: '/assinatura', icon: 'CreditCard', permission: 'dashboard.ver', secao: 'controle', oculto: true },

  { key: 'rastro', label: 'Registro de ações', href: '/rastro', icon: 'Footprints', permission: 'auditoria.ver', secao: 'registros' },
  { key: 'linha-do-tempo', label: 'Atividade', href: '/linha-do-tempo', icon: 'History', permission: 'auditoria.ver', secao: 'registros', pai: 'rastro' },

  { key: 'config', label: 'Configurações da conta', href: '/config', icon: 'Settings', permission: 'dashboard.ver', secao: 'conta' },
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
