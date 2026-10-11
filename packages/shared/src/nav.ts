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
  'totem',
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
}

export const NAV: NavItem[] = [
  // ── A central ────────────────────────────────────────────────────────────
  { key: 'console', label: 'Console', href: '/painel', icon: 'SquareTerminal', permission: 'dashboard.ver', secao: 'central' },
  // O MAPA CHEGOU na onda 10 (fatia 4.4): `/contexto` deixou de ser lista de
  // notas e virou o contexto do negócio desenhado, com cada ponto abrindo o
  // registro real. Enquanto ele não existia, este item anunciava ao cliente que
  // a tela principal estava por vir — e continuou anunciando depois de ela
  // existir, que é o defeito que a onda inteira tentou consertar.
  // Segue `parcial` porque as abas Marca e Identidade não entraram; o texto
  // agora diz o que FALTA, e não o que já chegou.
  { key: 'contexto', label: 'Contexto', href: '/contexto', icon: 'Network', permission: 'obsidian.ver', secao: 'central', estado: 'parcial', parcial: 'o mapa está de pé; as abas Marca e Identidade entram nas próximas fatias' },
  { key: 'sessoes', label: 'Sessões', href: '/sessoes', icon: 'Bot', permission: 'mcp.ver', secao: 'central' },
  /*
   * A CAIXA PESSOAL (fatia A7) — "o que precisa de mim".
   *
   * Item de PRIMEIRO NÍVEL em "A central", como o plano pede: ela não é
   * sub-item de nada porque não é a outra leitura de uma tela existente (o caso
   * da Linha do tempo sob o Rastro) — é a única tela do OS que responde por
   * PESSOA e não por empresa.
   *
   * `dashboard.ver` e não `aprovacoes.ver`: toda pessoa que entra tem uma caixa,
   * inclusive quem não acompanha a fila de aprovação — pedir a chave da fila
   * tiraria dela também as tarefas paradas, que são o outro eixo. É a mesma
   * permissão da rota (`GET /api/caixa`), e item de menu pedindo uma permissão
   * com a API respondendo a outra é o 403 que a fila já pagou uma vez. Cada eixo
   * tem a permissão dele DENTRO da tela, e eixo sem permissão diz "sem acesso"
   * em vez de sumir com a tela inteira.
   *
   * Sem `estado: 'parcial'`: os dois eixos que contam (aprovação e tarefa) estão
   * de pé. O terceiro — conversa no quadro — é entregue dizendo na tela o que
   * ele é e o que ele NÃO é (menção não existe como dado neste produto), e
   * marcar a tela como parcial por causa de um dado que o sistema não tem
   * avisaria ao cliente que algo aqui está pela metade quando está inteiro.
   */
  { key: 'caixa', label: 'Caixa', href: '/caixa', icon: 'Inbox', permission: 'dashboard.ver', secao: 'central' },
  /*
   * A AGENDA (24/09/2026) — o calendário do `operacao.root@gmail.com` desenhado
   * pelo padrão de nomenclatura da casa, e o lugar de marcar reunião.
   *
   * Fica em "A central", e não em "O que existe", porque ela não é a tela de uma
   * CONEXÃO — `/conexoes` é quem cuida do OAuth do Google. Esta é o compromisso
   * da semana, ao lado da Caixa: as duas respondem "o que me espera".
   *
   * `dashboard.ver` para VER (é a mesma chave da leitura da agenda na API) e
   * `agenda.editar` para marcar, cobrada dentro da tela — quem só acompanha vê
   * o mês inteiro e não vê o formulário.
   */
  { key: 'agenda', label: 'Agenda', href: '/agenda', icon: 'CalendarDays', permission: 'dashboard.ver', secao: 'central' },

  // ── Quem trabalha ────────────────────────────────────────────────────────
  { key: 'agentes', label: 'Agentes', href: '/agentes', icon: 'Users', permission: 'mcp.ver', secao: 'trabalha' },
  /*
   * CUSTOS ENTRA COMO SUB-ITEM DE AGENTES (fatia A3), e APONTA PARA A TELA QUE
   * JÁ EXISTE — `/painel/custo-ia`, no ar desde a fatia 6.4.
   *
   * Não há tela nova, e a decisão é essa: uma segunda tela de custo de IA seria
   * uma segunda versão dos mesmos números, e é exatamente o defeito que a outra
   * metade desta fatia foi consertar nas horas devolvidas. O que a A3 fez foi
   * acrescentar àquela tela o eixo que faltava (orçamento mensal por agente) e
   * trazer a porta dela para onde a pergunta nasce: o menu de quem trabalha.
   *
   * `secao: 'trabalha'` e não `'central'` porque o pai precisa estar NA MESMA
   * SEÇÃO — `navEmArvore` trata filho de outra seção como órfão e o promove a
   * primeiro nível, o que o faria aparecer fora do lugar. O href continua sob
   * `/painel/` e isso é de propósito: mover a rota quebraria o link que a pílula
   * do Console já publica.
   *
   * `dashboard.ver` é a mesma permissão da rota (`GET /dashboard/custo-ia`) e a
   * mesma do Console. Item de menu pedindo uma permissão e API respondendo a
   * outra é o 403 que a fila de aprovação já pagou uma vez.
   */
  { key: 'custo-ia', label: 'Custos', href: '/painel/custo-ia', icon: 'DollarSign', permission: 'dashboard.ver', secao: 'trabalha', pai: 'agentes' },
  // DEIXOU DE SER PARCIAL NA ONDA 10 (fatia 5.6). A tela lê dado real desde a
  // 5.1 — estado declarado, histórico de cada passagem — e agora mostra também
  // as HORAS DEVOLVIDAS por semana, medidas do log de passagens contra a linha
  // de base declarada. Era o último pedaço que faltava do que esta tela promete.
  //
  // CRIAR ROTINA continua nascendo na tela de Pauta, e isso NÃO é buraco desta
  // tela: criar uma exige escolher o executor, que é decisão de produto ainda
  // não tomada. Marcar a tela como parcial por causa de uma decisão que não é
  // dela avisava ao cliente que algo aqui está pela metade quando não está.
  { key: 'rotinas', label: 'Rotinas', href: '/rotinas', icon: 'Repeat', permission: 'automacoes.ver', secao: 'trabalha' },
  { key: 'fluxos', label: 'Fluxos', href: '/fluxos', icon: 'Workflow', permission: 'automacoes.ver', secao: 'trabalha', estado: 'parcial', parcial: 'editor de processo, com o vazamento declarado' },
  // Deixou de ser parcial na onda 9: `GET /organograma` entrou no ar e a tela lê
  // a fonte boa — toda a gente da empresa, com papel e estado, e não só quem é
  // dono de agente. O desvio pelo roster continua no código como rede de
  // segurança, e hoje só acorda se alguém tirar a rota outra vez.
  { key: 'organograma', label: 'Organograma', href: '/organograma', icon: 'Share2', permission: 'dashboard.ver', secao: 'trabalha' },

  // ── O controle ───────────────────────────────────────────────────────────
  // A FILA DE APROVAÇÃO, e a permissão que ela passou a exigir (fatia 3.10).
  //
  // Era `whatsapp.enviar`, enquanto `approvals.controller.ts` exigia
  // `mcp.executar`: o item aparecia para o Admin Master (o único perfil com
  // `whatsapp.enviar`) e a API respondia a outro público. Agora os dois lados
  // pedem `aprovacoes.ver` — chave própria, criada nesta fatia.
  //
  // NÃO É `mcp.executar` de propósito: ela mora nas duas contas de serviço da IA
  // (`ia_servico`, read-only por desenho, e `ia_acao`), e esta tela mostra o
  // CONTEÚDO EXATO de toda ação retida. E não é `whatsapp.enviar` porque a fila
  // não é de um canal: ela retém qualquer capacidade R2+ do catálogo.
  //
  // O rótulo mudou junto. "Atendimento" prometia caixa de entrada; o que existe
  // hoje é a fila de decisão. A entrada por WhatsApp continua declarada em
  // `parcial`, e `/whatsapp` segue redirecionando para cá (rotas-antigas.mjs).
  { key: 'atendimento', label: 'Aprovações', href: '/atendimento', icon: 'MessagesSquare', permission: 'aprovacoes.ver', secao: 'controle', estado: 'parcial', parcial: 'a fila de aprovação está de pé; a caixa de entrada por WhatsApp vem do FinOps depois' },
  // A Régua pede `mcp.ver`, e não `admin.usuarios`, desde que a fatia 2.3
  // fechou. É painel de LEITURA — níveis, sinais, catálogo, sobrescritas e um
  // simulador que não executa nada —, e a convenção da casa para painel de
  // leitura é a permissão de ver do assunto dele: `mcp.ver` é a mesma de
  // Agentes, Sessões e Ferramentas, que é o eixo que a régua governa.
  // `admin.usuarios` só existe no Admin Master (nem o Diretor tem), e o
  // critério da fatia fala em "um operador submete uma ação hipotética".
  // A aba "Quem autoriza" (a antiga tela de usuários) continua exigindo
  // `admin.usuarios`, pelas rotas dela: users.controller.ts pede isso nas
  // quatro, e a tela esconde a aba de quem não tem.
  { key: 'regua', label: 'Régua', href: '/regua', icon: 'Shield', permission: 'mcp.ver', secao: 'controle' },
  { key: 'rastro', label: 'Rastro', href: '/rastro', icon: 'Footprints', permission: 'auditoria.ver', secao: 'controle' },
  /*
   * A LINHA DO TEMPO (fatia A9) — sub-item do Rastro, e é a mesma fonte.
   *
   * As duas telas leem o MESMO `EventLog`. O que muda é a pergunta: o Rastro é
   * PROVA (evento cru, cadeia de hash, verificação) e a Linha do tempo é
   * HISTÓRIA (por dia, com ator e objeto legíveis, filtrável por agente e por
   * tipo). Aninhar diz isso na forma do menu: não é um segundo registro, é a
   * outra leitura do primeiro.
   *
   * `auditoria.ver`, a MESMA do pai e a mesma da rota — item de menu pedindo uma
   * permissão e API respondendo a outra é o 403 que a fila de aprovação já pagou
   * uma vez. E ser a mesma do pai tem consequência benigna aqui: quem não a tem
   * perde as duas, que é o certo, porque quem não pode ver a prova não tem por
   * que ver a narrativa dela.
   */
  { key: 'linha-do-tempo', label: 'Linha do tempo', href: '/linha-do-tempo', icon: 'History', permission: 'auditoria.ver', secao: 'controle', pai: 'rastro' },

  // ── O que existe ─────────────────────────────────────────────────────────
  { key: 'ferramentas', label: 'Ferramentas', href: '/ferramentas', icon: 'Wrench', permission: 'mcp.ver', secao: 'existe', estado: 'parcial', parcial: 'o catálogo das 35 ferramentas entra na fatia 7' },
  { key: 'conexoes', label: 'Conexões', href: '/conexoes', icon: 'Cable', permission: 'dashboard.ver', secao: 'existe' },

  // ── A execução ───────────────────────────────────────────────────────────
  { key: 'trabalho', label: 'Trabalho', href: '/trabalho', icon: 'KanbanSquare', permission: 'tarefas.ver', secao: 'execucao', modulo: 'trabalho' },
  { key: 'tarefas', label: 'Tarefas', href: '/tarefas', icon: 'CheckSquare', permission: 'tarefas.ver', secao: 'execucao', modulo: 'trabalho', pai: 'trabalho' },
  // O trilho de onboarding (23/09/2026): a esteira de entrega em cinco fases com
  // portão. Filho do Trabalho porque é a esteira de clientes vista de dentro.
  { key: 'onboarding', label: 'Onboarding', href: '/onboarding', icon: 'DoorOpen', permission: 'tarefas.ver', secao: 'execucao', modulo: 'trabalho', pai: 'trabalho' },
  { key: 'relatorios', label: 'Relatórios', href: '/relatorios', icon: 'BarChart3', permission: 'relatorios.ver', secao: 'execucao', modulo: 'relatorios' },
  // O painel da rede de lojas do totem de consulta (11/10/2026). As telas
  // públicas (/totem na loja, /p/[codigo] na etiqueta) não entram no menu.
  { key: 'totem', label: 'Totem', href: '/totem-gestao', icon: 'MonitorSmartphone', permission: 'totem.ver', secao: 'execucao', modulo: 'totem' },

  // ── O que entra ──────────────────────────────────────────────────────────
  { key: 'leads', label: 'Leads', href: '/leads', icon: 'UserPlus', permission: 'leads.ver', secao: 'entra', modulo: 'leads' },
  { key: 'funil', label: 'Funil', href: '/funil', icon: 'Filter', permission: 'dashboard.ver', secao: 'entra', modulo: 'leads', pai: 'leads' },
  { key: 'campanhas', label: 'Campanhas', href: '/campanhas', icon: 'Megaphone', permission: 'campanhas.ver', secao: 'entra', modulo: 'campanhas' },
  { key: 'pixels', label: 'Pixels e eventos', href: '/pixels', icon: 'Activity', permission: 'dashboard.ver', secao: 'entra', modulo: 'pixels' },

  // ── O que sai ────────────────────────────────────────────────────────────
  { key: 'conteudo', label: 'Conteúdo', href: '/conteudo', icon: 'FileText', permission: 'dashboard.ver', secao: 'sai', modulo: 'conteudo' },
  { key: 'pauta', label: 'Pauta', href: '/pauta', icon: 'CalendarClock', permission: 'pauta.ver', secao: 'sai', modulo: 'pauta' },
  { key: 'referencias', label: 'Referências', href: '/referencias', icon: 'Library', permission: 'pauta.ver', secao: 'sai', modulo: 'pauta', pai: 'pauta' },
  { key: 'instagram', label: 'Instagram', href: '/instagram', icon: 'Instagram', permission: 'instagram.ver', secao: 'sai', modulo: 'instagram' },
  { key: 'bio', label: 'Link na bio', href: '/bio', icon: 'Link2', permission: 'bio.ver', secao: 'sai', modulo: 'bio' },
  { key: 'metas', label: 'Metas', href: '/metas', icon: 'Target', permission: 'dashboard.ver', secao: 'sai', modulo: 'metas' },

  // ── O dinheiro ───────────────────────────────────────────────────────────
  { key: 'financeiro', label: 'Financeiro', href: '/financeiro', icon: 'Wallet', permission: 'financeiro.ver', secao: 'dinheiro', modulo: 'financeiro' },

  // ── A conta ──────────────────────────────────────────────────────────────
  // A ASSINATURA ENTROU NA ONDA 11 (fatia 6.2, RF-O-03), e o item existe por um
  // motivo prático antes de qualquer outro: sem ele, a tela que explica a
  // suspensão só era alcançada digitando o endereço. Quem entrava suspenso caía
  // no console, levava recusa em tudo e não tinha como descobrir por quê.
  //
  // `dashboard.ver` e não `admin.usuarios`: TODO usuário precisa poder chegar à
  // tela que diz por que o produto parou de responder — inclusive quem não
  // administra a conta, que é justamente quem não tem como adivinhar. O que a
  // tela deixa MUDAR (registrar plano, guardar credencial, conferir, reativar)
  // exige `admin.usuarios` na API e some da tela de quem não tem.
  //
  // ESPINHA, sem `modulo`: é o contrato que sustenta todos os módulos, e um
  // módulo "cobrança" que a empresa pudesse não contratar seria um contrato
  // opcional sobre o próprio contrato. (Mesma decisão do lado da API, em
  // `apps/api/src/tenants/modulos.ts`.)
  { key: 'assinatura', label: 'Assinatura', href: '/assinatura', icon: 'CreditCard', permission: 'dashboard.ver', secao: 'conta' },
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
      // nível — filho de filho pendura no avô, porque menu de três níveis não
      // cabe numa barra de 216px e ninguém pediu isso.
      for (const item of itens) {
        if (!item.pai) continue;
        const pai = porChave.get(item.pai) ?? porChave.get(presentes.get(item.pai)?.pai ?? '');
        if (pai) pai.filhos.push(item);
      }

      return { secao, itens: nos };
    })
    .filter((g) => g.itens.length > 0);
}
