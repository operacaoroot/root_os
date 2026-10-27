import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  NAV,
  NAV_DETALHE,
  ROTAS_ABSORVIDAS,
  ROLES,
  SECOES,
  MODULOS,
  navPorSecao,
  navEmArvore,
  moduloDaRotaDoWeb,
  type RoleKey,
} from '@mktos/shared';
import { ROTAS_ANTIGAS } from '../../rotas-antigas.mjs';
import { areasDaNota } from '@/app/contexto/grafo';

/*
 * Trava de não-regressão da reorganização do painel na lógica do ROOT OS.
 *
 * A promessa feita foi literal: "não perder nenhuma funcionalidade do painel".
 * Esta suíte é o que impede a promessa de virar boa intenção. Ela não congela a
 * aparência do menu — congela o que não pode se perder: toda tela que existia
 * continua alcançável, e nenhuma permissão foi afrouxada no caminho.
 */

/** O menu como estava antes da reorganização. Não editar sem motivo escrito. */
const ANTES: { key: string; href: string; permission: string }[] = [
  { key: 'dashboard', href: '/painel', permission: 'dashboard.ver' },
  { key: 'obsidian', href: '/obsidian', permission: 'obsidian.ver' },
  { key: 'documentos', href: '/documentos', permission: 'drive.ver' },
  { key: 'ia', href: '/ia', permission: 'mcp.ver' },
  { key: 'relatorios', href: '/relatorios', permission: 'relatorios.ver' },
  { key: 'trabalho', href: '/trabalho', permission: 'tarefas.ver' },
  { key: 'tarefas', href: '/tarefas', permission: 'tarefas.ver' },
  { key: 'automacoes', href: '/automacoes', permission: 'automacoes.ver' },
  { key: 'leads', href: '/leads', permission: 'leads.ver' },
  { key: 'funil', href: '/funil', permission: 'dashboard.ver' },
  { key: 'campanhas', href: '/campanhas', permission: 'campanhas.ver' },
  { key: 'pixels', href: '/pixels', permission: 'dashboard.ver' },
  { key: 'vendas', href: '/vendas', permission: 'dashboard.ver' },
  { key: 'conteudo', href: '/conteudo', permission: 'dashboard.ver' },
  { key: 'pauta', href: '/pauta', permission: 'pauta.ver' },
  { key: 'referencias', href: '/referencias', permission: 'pauta.ver' },
  { key: 'instagram', href: '/instagram', permission: 'instagram.ver' },
  { key: 'bio', href: '/bio', permission: 'bio.ver' },
  { key: 'metas', href: '/metas', permission: 'dashboard.ver' },
  { key: 'financeiro', href: '/financeiro', permission: 'financeiro.ver' },
  { key: 'whatsapp', href: '/whatsapp', permission: 'whatsapp.enviar' },
  { key: 'usuarios', href: '/usuarios', permission: 'admin.usuarios' },
  { key: 'auditoria', href: '/auditoria', permission: 'auditoria.ver' },
  { key: 'mcp', href: '/mcp', permission: 'mcp.ver' },
  { key: 'integracoes', href: '/integracoes', permission: 'dashboard.ver' },
  { key: 'google', href: '/google', permission: 'dashboard.ver' },
  { key: 'config', href: '/config', permission: 'dashboard.ver' },
];

/**
 * Para onde cada item de antes foi. `paraKey` é o item do NAV novo que assumiu
 * a função. `absorvido` marca o que virou conteúdo dentro de outra tela — e aí
 * a permissão do destino pode ser outra, o que é registrado no motivo.
 */
const DESTINO: Record<string, { paraKey: string; absorvido?: string }> = {
  dashboard: { paraKey: 'console' },
  obsidian: { paraKey: 'contexto' },
  documentos: {
    paraKey: 'contexto',
    absorvido: 'vira a aba Arquivos do Contexto; a aba é que exige drive.ver',
  },
  ia: { paraKey: 'sessoes' },
  relatorios: { paraKey: 'relatorios' },
  trabalho: { paraKey: 'trabalho' },
  tarefas: { paraKey: 'tarefas' },
  automacoes: { paraKey: 'rotinas' },
  leads: { paraKey: 'leads' },
  funil: { paraKey: 'funil' },
  campanhas: { paraKey: 'campanhas' },
  pixels: { paraKey: 'pixels' },
  vendas: {
    paraKey: 'pixels',
    absorvido: 'é o manual de instalação do pixel; a rota /vendas segue viva fora do menu',
  },
  // Layout 26/10: Temas do ClickUp aposentado; /conteudo redireciona para o Marketing.
  conteudo: {
    paraKey: 'marketing',
    absorvido: 'o espelho dos Temas do ClickUp foi aposentado em 26/10/2026; o conteúdo mora no Marketing, que pede pauta.ver',
  },
  pauta: { paraKey: 'pauta' },
  referencias: { paraKey: 'referencias' },
  instagram: { paraKey: 'instagram' },
  bio: { paraKey: 'bio' },
  metas: { paraKey: 'metas' },
  financeiro: { paraKey: 'financeiro' },
  whatsapp: {
    paraKey: 'whatsapp',
    absorvido:
      'o /whatsapp de antes era uma tela sem conector (o placeholder de módulo), e até ' +
      '20/10/2026 a rota redirecionava para a fila de aprovação (/atendimento, aprovacoes.ver). ' +
      'Na rodada da interface (20/10/2026, U1) a rota voltou a ter tela: a área WhatsApp, que é ' +
      'a tela de conversas do comercial que morava em /comercial/simulador, com a MESMA ' +
      'permissão de antes (leads.ver, a que a API exige nas rotas /comercial/simulador/*). ' +
      'Enviar mensagem continua sendo a capacidade comercial.whatsapp.enviar (R3), retida na ' +
      'fila: a tela não envia nada sozinha, e por isso whatsapp.enviar não é a permissão dela',
  },
  usuarios: {
    paraKey: 'regua',
    absorvido:
      'vira a aba "Quem autoriza" da Régua, e a aba é que exige admin.usuarios — ' +
      'users.controller.ts pede a permissão nas quatro rotas dela, e a tela esconde o botão ' +
      'de quem não tem. A Régua em si é painel de leitura e pede mcp.ver, como Agentes e ' +
      'Ferramentas: com admin.usuarios nenhum operador abriria o simulador, que é o critério ' +
      'da fatia 2.3',
  },
  auditoria: { paraKey: 'rastro' },
  mcp: { paraKey: 'ferramentas' },
  integracoes: { paraKey: 'conexoes' },
  google: {
    paraKey: 'conexoes',
    absorvido: 'o OAuth do Google é uma conexão; a rota /google segue viva como callback',
  },
  config: { paraKey: 'config' },
};

const porKey = new Map(NAV.map((n) => [n.key, n]));

describe('não se perdeu funcionalidade', () => {
  it('todo módulo de antes tem destino declarado, e o destino existe', () => {
    for (const velho of ANTES) {
      const destino = DESTINO[velho.key];
      expect(destino, `"${velho.key}" saiu do menu sem destino declarado`).toBeDefined();
      expect(porKey.has(destino.paraKey), `destino "${destino.paraKey}" não existe no NAV`).toBe(
        true,
      );
    }
  });

  it('nenhuma permissão foi afrouxada: quem herdou a tela exige a mesma coisa', () => {
    for (const velho of ANTES) {
      const { paraKey, absorvido } = DESTINO[velho.key];
      const novo = porKey.get(paraKey)!;
      if (absorvido) continue; // a exceção está escrita no próprio DESTINO
      expect(novo.permission, `${velho.key} → ${paraKey} mudou de permissão`).toBe(
        velho.permission,
      );
    }
  });

  it('toda rota antiga responde: ou continua no NAV, ou tem redirect, ou segue viva fora do menu', () => {
    const hrefsNovos = new Set(NAV.map((n) => n.href));
    const comRedirect = new Set(ROTAS_ANTIGAS.map((r: { de: string }) => r.de));
    const vivasForaDoMenu = new Set(ROTAS_ABSORVIDAS.map((r) => r.href));

    for (const velho of ANTES) {
      const ok =
        hrefsNovos.has(velho.href) || comRedirect.has(velho.href) || vivasForaDoMenu.has(velho.href);
      expect(ok, `${velho.href} ficaria sem resposta`).toBe(true);
    }
  });

  it('nenhum redirect aponta para uma rota que não existe', () => {
    const hrefsNovos = new Set(NAV.map((n) => n.href));
    for (const r of ROTAS_ANTIGAS as { de: string; para: string }[]) {
      const destino = r.para.split('?')[0];
      expect(hrefsNovos.has(destino), `${r.de} → ${r.para} aponta para rota inexistente`).toBe(
        true,
      );
    }
    // O destino pode levar query (`/trabalho?pasta=todas`, 20/10/2026): a rota é o que vem antes.
    for (const r of ROTAS_ABSORVIDAS) {
      expect(hrefsNovos.has(r.destino.split('?')[0]), `${r.href} → ${r.destino} não existe`).toBe(true);
    }
  });

  it('nenhuma rota absorvida aponta para fila duplicada: a fonte migrada do ClickUp é o Quadro interno', () => {
    const filasDuplicadas = new Set(['/tarefas', '/conteudo']);
    const hrefsNovos = new Set(NAV.map((n) => n.href));
    expect(hrefsNovos.has('/trabalho')).toBe(true);
    for (const r of ROTAS_ABSORVIDAS) {
      expect(filasDuplicadas.has(r.destino), `${r.href} → ${r.destino} é fila duplicada`).toBe(false);
    }
    // 18/10/2026 (rodada do painel P0): /conteudo saiu do menu e entrou como ORIGEM.
    // Layout 26/10: /conteudo foi aposentado (redirect para /marketing, teste abaixo).
    for (const h of filasDuplicadas) {
      const absorvida = ROTAS_ABSORVIDAS.some((r) => r.href === h);
      const item = NAV.find((n) => n.href === h);
      if (absorvida) expect(item?.oculto, `${h} absorvida precisa ser item oculto, tela viva`).toBe(true);
    }
  });

  it('redirect e página não disputam a mesma rota', () => {
    const hrefsNovos = new Set(NAV.map((n) => n.href));
    for (const r of ROTAS_ANTIGAS as { de: string }[]) {
      expect(hrefsNovos.has(r.de), `${r.de} tem redirect E item de menu — o redirect vence`).toBe(
        false,
      );
    }
  });

  // Layout 26/10: "Temas do ClickUp" aposentado. A rota responde com o redirect para o
  // Marketing, sem item no NAV, sem página e fora das rotas absorvidas.
  it('/conteudo redireciona para /marketing e não tem mais tela nem item', () => {
    const r = (ROTAS_ANTIGAS as { de: string; para: string }[]).find((x) => x.de === '/conteudo');
    expect(r?.para).toBe('/marketing');
    expect(NAV.find((n) => n.href === '/marketing')?.key).toBe('marketing');
    expect(NAV.some((n) => n.href === '/conteudo')).toBe(false);
    expect(ROTAS_ABSORVIDAS.some((x) => x.href === '/conteudo')).toBe(false);
    expect(existsSync(join(__dirname, '..', '..', 'src', 'app', 'conteudo', 'page.tsx'))).toBe(false);
  });
});

/*
 * O MENU FINAL (versão final, 19/10/2026): nossa + Pedro + Lucas, item a item e na
 * ordem. É a tabela de `homolog/final/enxugamento.md` §2 em forma de teste: mexer
 * no NAV sem mexer aqui reprova, e o motivo tem de ir junto.
 *
 * Colunas: chave, rótulo, rota, permissão, seção, módulo, pai, oculto.
 */
type LinhaDoMenu = [string, string, string, string, string, string | null, string | null, boolean];
const MENU_FINAL: LinhaDoMenu[] = [
  // Dia a dia: Visão geral (o dash do Lucas, entrada) · Pendências · Aprovações · Agenda. O Painel
  // geral da empresa sai do menu em 20/10/2026 (rodada da interface, U1): oculto, vivo pela rota.
  ['tarefas-todas', 'Visão geral', '/dia-a-dia', 'tarefas.ver', 'dia', 'trabalho', null, false],
  ['caixa', 'Pendências', '/caixa', 'dashboard.ver', 'dia', null, null, false],
  ['atendimento', 'Aprovações', '/atendimento', 'aprovacoes.ver', 'dia', null, null, false],
  ['agenda', 'Agenda', '/agenda', 'dashboard.ver', 'dia', null, null, false],
  ['console', 'Painel geral da empresa', '/painel', 'dashboard.ver', 'dia', null, null, true],
  // Contexto (desceu para depois do Motor de IA nas SECOES; no NAV a posição não pesa).
  ['contexto', 'Conhecimento da empresa', '/contexto', 'obsidian.ver', 'empresa', null, null, false],
  ['marca', 'Marca e pilares', '/contexto/marca', 'pauta.ver', 'empresa', 'pauta', 'contexto', false],
  // Trabalho: a base nossa.
  ['tarefas', 'Lista de tarefas', '/tarefas', 'tarefas.ver', 'trabalho', 'trabalho', null, true],
  ['trabalho', 'Tarefas', '/trabalho', 'tarefas.ver', 'trabalho', 'trabalho', null, false],
  // Todas as tarefas (20/10/2026, rodada da interface, U1/U3): a rota pendurada no Trabalho.
  // Na mesma noite saiu do menu (pedido do Rodrigo): oculto, a rota redireciona para o chip Todas.
  ['trabalho-todas', 'Todas as tarefas', '/trabalho/todas', 'tarefas.ver', 'trabalho', 'trabalho', 'trabalho', true],
  // Leva 5, L3 (27/10/2026, decisão do Rodrigo em 26/10): a Implantação sai do menu; oculta, a rota segue viva.
  ['implantacao', 'Implantação de clientes', '/trabalho/implantacao', 'tarefas.ver', 'trabalho', 'trabalho', 'trabalho', true],
  ['onboarding', 'Bancada de onboarding', '/onboarding', 'tarefas.ver', 'trabalho', 'trabalho', 'trabalho', true],
  ['trabalho-atas', 'Atas', '/trabalho/atas', 'tarefas.ver', 'trabalho', 'trabalho', 'trabalho', false],
  // 22/10/2026 (produção 3, I2): a Lixeira, oculta, aberta pela engrenagem do topo.
  ['lixeira', 'Lixeira', '/lixeira', 'tarefas.editar', 'trabalho', 'trabalho', null, true],
  // Aba Marketing no jeito do ROOT Estúdio (26/10/2026): só as seções no menu; o resto é aba (oculto, com pai).
  ['marketing', 'Início', '/marketing', 'pauta.ver', 'conteudo', 'pauta', null, false],
  ['marketing-memoria', 'Memória', '/marketing/memoria', 'pauta.ver', 'conteudo', 'pauta', null, false],
  ['marketing-triagem', 'Ideias de conteúdo', '/marketing/triagem', 'pauta.ver', 'conteudo', 'pauta', null, false],
  ['marketing-base', 'Base', '/marketing/base', 'pauta.ver', 'conteudo', 'pauta', 'marketing-triagem', true],
  ['marketing-fontes', 'Fontes', '/marketing/fontes', 'pauta.ver', 'conteudo', 'pauta', 'marketing-triagem', true],
  ['marketing-estrategia', 'Estratégia do mês', '/marketing/estrategia', 'pauta.ver', 'conteudo', 'pauta', 'marketing-triagem', true],
  ['referencias', 'Referências', '/referencias', 'pauta.ver', 'conteudo', 'pauta', 'marketing-triagem', true],
  ['marketing-ideias', 'Ideias da pauta', '/marketing/ideias', 'pauta.ver', 'conteudo', 'pauta', 'marketing-triagem', true],
  ['maquina-producao', 'Produção', '/marketing/producao', 'pauta.ver', 'conteudo', 'pauta', null, false],
  ['maquina-banco', 'Banco de ideias', '/marketing/banco', 'pauta.ver', 'conteudo', 'pauta', 'maquina-producao', true],
  ['maquina-agendar', 'Agendar', '/marketing/agendar', 'pauta.ver', 'conteudo', 'pauta', 'maquina-producao', true],
  ['maquina-calendario', 'Calendário', '/marketing/calendario', 'pauta.ver', 'conteudo', 'pauta', 'maquina-producao', true],
  ['marketing-formatos', 'Formatos', '/marketing/formatos', 'pauta.ver', 'conteudo', 'pauta', 'maquina-producao', true],
  ['pauta', 'Pauta (episódios)', '/pauta', 'pauta.ver', 'conteudo', 'pauta', 'maquina-producao', true],
  ['marketing-performance', 'Performance', '/marketing/performance', 'pauta.ver', 'conteudo', 'pauta', null, false],
  ['maquina-analise', 'Análise dos posts', '/marketing/analise', 'pauta.ver', 'conteudo', 'pauta', 'marketing-performance', true],
  ['marketing-relatorio', 'Relatório do mês', '/marketing/relatorio', 'pauta.ver', 'conteudo', 'pauta', 'marketing-performance', true],
  ['instagram', 'Instagram', '/instagram', 'instagram.ver', 'conteudo', 'instagram', 'marketing-performance', true],
  ['bio', 'Página de links', '/bio', 'bio.ver', 'conteudo', 'bio', null, false],
  ['campanhas', 'Campanhas', '/campanhas', 'campanhas.ver', 'conteudo', 'campanhas', null, false],
  ['pixels', 'Eventos do site', '/pixels', 'dashboard.ver', 'conteudo', 'pixels', null, false],
  ['marketing-tarefas', 'Tarefas', '/marketing/tarefas', 'tarefas.ver', 'conteudo', 'trabalho', null, false],
  // Motor Comercial: Painel geral · Funil vivo · Propostas · Lista de leads · Contratos vivos · Torre · Relatório.
  // O Simulador de WhatsApp virou a área WhatsApp em 20/10/2026: oculto, a rota redireciona.
  ['comercial-painel', 'Painel geral', '/comercial', 'leads.ver', 'comercial', 'leads', null, false],
  ['comercial-funil', 'Funil de vendas', '/comercial/funil', 'leads.ver', 'comercial', 'leads', null, false],
  ['propostas', 'Propostas', '/propostas', 'leads.ver', 'comercial', 'leads', null, false],
  ['leads', 'Lista de leads', '/leads', 'leads.ver', 'comercial', 'leads', null, false],
  ['comercial-contratos', 'Contratos vivos', '/comercial/contratos', 'leads.ver', 'comercial', 'leads', null, false],
  ['comercial-simulador', 'Simulador de WhatsApp', '/comercial/simulador', 'leads.ver', 'comercial', 'leads', null, true],
  ['comercial-torre', 'Torre das automações', '/comercial/torre', 'leads.ver', 'comercial', 'leads', null, false],
  ['comercial-relatorio', 'Relatório da semana', '/comercial/relatorio', 'leads.ver', 'comercial', 'leads', null, false],
  // Saem do Comercial, ocultos e vivos: o funil antigo, Clientes, Tarefas e a fila antiga de decisões.
  ['funil', 'Funil de vendas', '/funil', 'dashboard.ver', 'comercial', 'leads', 'leads', true],
  ['clientes', 'Clientes', '/clientes', 'tarefas.ver', 'comercial', 'trabalho', null, true],
  ['comercial-tarefas', 'Tarefas', '/comercial/tarefas', 'tarefas.ver', 'comercial', 'trabalho', null, true],
  ['comercial-decisoes', 'Decisões do comercial', '/comercial/decisoes', 'leads.ver', 'comercial', 'leads', null, true],
  // WhatsApp (20/10/2026, rodada da interface, U1): área própria, um item, leads.ver e o módulo leads.
  ['whatsapp', 'WhatsApp', '/whatsapp', 'leads.ver', 'whatsapp', 'leads', null, false],
  // Motor Financeiro, Motor de IA, Resultados, Configurações e Registros: a forma da produção.
  ['financeiro', 'Financeiro', '/financeiro', 'financeiro.ver', 'financeiro', 'financeiro', null, false],
  ['financeiro-tarefas', 'Tarefas', '/financeiro/tarefas', 'tarefas.ver', 'financeiro', 'trabalho', null, false],
  ['agentes', 'Agentes de IA', '/agentes', 'mcp.ver', 'automacoes', null, null, false],
  ['rotinas', 'Rotinas automáticas', '/rotinas', 'automacoes.ver', 'automacoes', null, null, false],
  ['sessoes', 'Sessões de IA', '/sessoes', 'mcp.ver', 'automacoes', null, null, false],
  ['fluxos', 'Processos', '/fluxos', 'automacoes.ver', 'automacoes', null, null, false],
  ['custo-ia', 'Custos de IA', '/painel/custo-ia', 'dashboard.ver', 'automacoes', null, null, false],
  ['relatorios', 'Relatórios', '/relatorios', 'relatorios.ver', 'resultados', 'relatorios', null, false],
  ['metas', 'Metas', '/metas', 'dashboard.ver', 'resultados', 'metas', null, false],
  ['organograma', 'Equipe', '/organograma', 'dashboard.ver', 'controle', null, null, false],
  ['ferramentas', 'Ferramentas disponíveis', '/ferramentas', 'mcp.ver', 'controle', null, null, false],
  ['conexoes', 'Integrações', '/conexoes', 'dashboard.ver', 'controle', null, null, false],
  ['regua', 'Regras e permissões', '/regua', 'mcp.ver', 'controle', null, null, false],
  ['cofre', 'Cofre', '/cofre', 'cofre.ver', 'controle', null, null, false],
  ['assinatura', 'Plano e assinatura', '/assinatura', 'dashboard.ver', 'controle', null, null, true],
  ['rastro', 'Registro de ações', '/rastro', 'auditoria.ver', 'registros', null, null, false],
  ['linha-do-tempo', 'Atividade', '/linha-do-tempo', 'auditoria.ver', 'registros', null, 'rastro', false],
  ['config', 'Configurações da conta', '/config', 'dashboard.ver', 'conta', null, null, false],
  // Produção 22B (I6): o perfil, oculto (a entrada é a engrenagem do topo), dono da rota.
  ['perfil', 'Perfil', '/perfil', 'dashboard.ver', 'conta', null, null, true],
];

/** O que o enxugamento ocultou, e para onde a função foi (ROTAS_ABSORVIDAS). */
const OCULTOS_E_DESTINO: Record<string, string | null> = {
  tarefas: '/trabalho',
  onboarding: '/trabalho/implantacao',
  funil: '/comercial/funil',
  clientes: '/trabalho/implantacao',
  'comercial-tarefas': '/trabalho',
  'comercial-decisoes': '/caixa',
  // 20/10/2026 (rodada da interface, U1).
  console: '/dia-a-dia',
  'comercial-simulador': '/whatsapp',
  // 20/10/2026 (noite, pedido do Rodrigo): o Todas é o chip de Tarefas.
  'trabalho-todas': '/trabalho?pasta=todas',
  // Leva 5, L3 (27/10/2026): a Implantação sai do menu; os clientes ficam na lista Onboarding de cliente,
  // na pasta Clientes da árvore do Trabalho. A rota do kanban segue viva pelo link.
  implantacao: '/trabalho',
  // Sai da barra e da busca por decisão de marca; não tem destino, a rota segue com dono.
  assinatura: null,
  // Produção 22B (I6): a entrada é a engrenagem do topo; sem destino, a rota segue com dono.
  perfil: null,
  // A Lixeira (22/10/2026) abre pela engrenagem do topo: não é absorvida, a rota é dela.
  lixeira: null,
  // 26/10/2026 (aba Marketing no jeito do ROOT Estúdio): abas das seções Ideias, Produção e
  // Performance. Não são absorvidas: cada uma segue sendo a dona da rota, aberta pela aba.
  'maquina-banco': null,
  'marketing-base': null,
  'marketing-fontes': null,
  'marketing-estrategia': null,
  referencias: null,
  'marketing-ideias': null,
  'maquina-agendar': null,
  'maquina-calendario': null,
  'marketing-formatos': null,
  pauta: null,
  'maquina-analise': null,
  'marketing-relatorio': null,
  instagram: null,
};

const RAIZ_DO_WEB = join(__dirname, '..', '..');
const paginaExiste = (href: string) => existsSync(join(RAIZ_DO_WEB, 'src', 'app', ...href.split('/').filter(Boolean), 'page.tsx'));

describe('NAV — estrutura', () => {
  it('o menu final, item a item e na ordem (enxugamento.md §2)', () => {
    expect(NAV.map((n) => [n.key, n.label, n.href, n.permission, n.secao, n.modulo ?? null, n.pai ?? null, !!n.oculto])).toEqual(MENU_FINAL);
  });

  it('toda rota do NAV tem página, visível ou oculta; a que não tem é parcial e cai na página de preparação', () => {
    const semPagina = NAV.filter((n) => !paginaExiste(n.href));
    expect(semPagina.map((n) => n.key).sort()).toEqual(['ferramentas', 'fluxos']);
    for (const n of semPagina) expect(n.estado, n.key).toBe('parcial');
    expect(existsSync(join(RAIZ_DO_WEB, 'src', 'app', '[...slug]', 'page.tsx'))).toBe(true);
  });

  it('não repete chave nem rota', () => {
    expect(new Set(NAV.map((n) => n.key)).size).toBe(NAV.length);
    expect(new Set(NAV.map((n) => n.href)).size).toBe(NAV.length);
  });

  it('todo item tem rótulo, ícone, seção existente e módulo válido', () => {
    const secoes = new Set(SECOES.map((s) => s.key));
    const modulos = new Set<string>(MODULOS);
    for (const n of NAV) {
      expect(n.label.trim(), n.key).not.toBe('');
      expect(n.icon.trim(), n.key).not.toBe('');
      expect(secoes.has(n.secao), `${n.key}: seção inexistente`).toBe(true);
      if (n.modulo) expect(modulos.has(n.modulo), `${n.key}: módulo inexistente`).toBe(true);
    }
  });

  it('item marcado como parcial diz o que falta', () => {
    for (const n of NAV.filter((i) => i.estado === 'parcial')) {
      expect(n.parcial?.trim(), `${n.key} é parcial e não explica por quê`).toBeTruthy();
    }
  });

  it('as rotas de detalhe herdam a permissão do módulo pai', () => {
    for (const d of NAV_DETALHE) {
      const pai = porKey.get(d.parentKey);
      expect(pai, d.href).toBeDefined();
      expect(d.permission).toBe(pai!.permission);
    }
  });
});

describe('navPorSecao', () => {
  const todas = new Set(NAV.map((n) => n.permission));

  const visiveis = NAV.filter((n) => !n.oculto);

  it('com todas as permissões devolve todos os itens visíveis, sem repetir', () => {
    const itens = navPorSecao(todas).flatMap((g) => g.itens);
    expect(itens).toHaveLength(visiveis.length);
    expect(new Set(itens.map((i) => i.key)).size).toBe(visiveis.length);
  });

  it('preserva a ordem das seções e a ordem do NAV dentro de cada uma', () => {
    const ordem = SECOES.map((s) => s.key).filter((k) => visiveis.some((n) => n.secao === k));
    const grupos = navPorSecao(todas);
    expect(grupos.map((g) => g.secao.key)).toEqual(ordem);
    expect(grupos.flatMap((g) => g.itens.map((i) => i.key))).toEqual(
      ordem.flatMap((k) => visiveis.filter((n) => n.secao === k).map((n) => n.key)),
    );
  });

  it('destinos de apoio vêm depois dos grupos principais', () => {
    const tipos = navPorSecao(todas).map((g) => g.secao.tipo);
    // Versão final: o Trabalho voltou a ter itens visíveis (a nossa organização); o WhatsApp
    // entrou como área principal em 20/10/2026.
    expect(tipos.slice(0, 9)).toEqual(Array(9).fill('principal'));
    expect(tipos.slice(9)).toEqual(['apoio', 'apoio', 'apoio']);
  });

  it('sem permissão nenhuma não devolve seção nenhuma', () => {
    expect(navPorSecao(new Set())).toEqual([]);
  });

  it('mostra só o que a permissão libera e descarta a seção vazia', () => {
    const grupos = navPorSecao(new Set(['leads.ver']));
    expect(grupos.map((g) => g.secao.key)).toEqual(['comercial', 'whatsapp']);
    expect(grupos[0].itens.map((i) => i.key)).toEqual([
      'comercial-painel', 'comercial-funil', 'propostas', 'leads',
      'comercial-contratos', 'comercial-torre', 'comercial-relatorio',
    ]);
    expect(grupos[1].itens.map((i) => i.key)).toEqual(['whatsapp']);
  });

  it('módulo desligado sai do menu; a espinha nunca sai', () => {
    const grupos = navPorSecao(todas, ['financeiro']);
    const chaves = grupos.flatMap((g) => g.itens.map((i) => i.key));
    expect(chaves).toContain('financeiro');
    expect(chaves).toContain('agenda'); // espinha
    expect(chaves).toContain('caixa'); // espinha
    expect(chaves).toContain('regua'); // espinha
    expect(chaves).not.toContain('leads');
    expect(chaves).not.toContain('tarefas-todas');
    expect(chaves).not.toContain('pauta');
  });

  it('omitir a lista de módulos é o estado de hoje: todos ligados', () => {
    expect(navPorSecao(todas).flatMap((g) => g.itens)).toHaveLength(
      navPorSecao(todas, MODULOS).flatMap((g) => g.itens).length,
    );
  });

  it('aceita array, e não só Set', () => {
    // `auditoria.ver` abre as DUAS leituras do rastro desde a fatia A9: a prova
    // (`/rastro`) e a história (`/linha-do-tempo`). Na ordem do NAV.
    expect(navPorSecao(['auditoria.ver']).flatMap((g) => g.itens.map((i) => i.key))).toEqual([
      'rastro',
      'linha-do-tempo',
    ]);
  });

  /*
   * O CRITÉRIO DA FATIA 2.3 EM FORMA DE TESTE: "um operador submete uma ação
   * hipotética". Enquanto a Régua exigia `admin.usuarios`, ela aparecia para um
   * perfil só — o Admin Master. Nem o Diretor tinha. Este caso reprova se
   * alguém devolver a tela para uma permissão que operador nenhum carrega.
   */
  it('a Régua chega a quem opera, e não só ao Admin Master', () => {
    const regua = NAV.find((n) => n.key === 'regua')!;
    const veem = (Object.keys(ROLES) as RoleKey[]).filter((papel) =>
      (ROLES[papel].permissions as readonly string[]).includes(regua.permission),
    );
    expect(veem).toContain('gestor_marketing');
    expect(veem).toContain('analista');
    expect(veem).toContain('admin_master');
    expect(veem.length).toBeGreaterThan(3);
  });
});

/*
 * O SUBMENU (fatia A1 do docs/PLANO-CONTROLE-DE-AGENTES.md).
 *
 * Aninhar item de menu é mexer em ACESSO por acidente: o filho tem permissão e
 * módulo próprios, e a tentação é fazê-lo depender do pai. Estes casos travam
 * as duas coisas que não podem quebrar — nada desaparece, e o desenho não
 * inventa hierarquia onde o NAV não declarou.
 */
describe('navEmArvore', () => {
  const todas = new Set(NAV.map((n) => n.permission));
  const planos = (ps: Iterable<string>, mods?: Iterable<string>) =>
    navEmArvore(ps, mods).flatMap((g) => g.itens.flatMap((no) => [no.item, ...no.filhos]));

  it('não perde nem repete item nenhum em relação à lista plana', () => {
    const arvore = planos(todas).map((i) => i.key);
    const plana = navPorSecao(todas)
      .flatMap((g) => g.itens)
      .map((i) => i.key);
    expect(new Set(arvore)).toEqual(new Set(plana));
    expect(arvore).toHaveLength(plana.length);
  });

  it('o filho vem dentro do pai, e não no topo da seção', () => {
    // 26/10/2026: o Marketing não tem mais filho visível (as abas são ocultas); o exemplo é o Trabalho.
    const trabalho = navEmArvore(todas).find((g) => g.secao.key === 'trabalho')!;
    expect(trabalho.itens.map((no) => no.item.key)).not.toContain('trabalho-atas');
    const raiz = trabalho.itens.find((no) => no.item.key === 'trabalho')!;
    expect(raiz.filhos.map((f) => f.key)).toContain('trabalho-atas');
  });

  /*
   * O CASO QUE CUSTA ACESSO SE FOR ESQUECIDO, e que é real: `marca` pede
   * `pauta.ver` e o pai dele, `contexto`, pede `obsidian.ver`. Quem opera sem
   * `obsidian.ver` TEM a Marca — se o filho caísse com o pai, a tela sumiria do
   * menu sem nada acusar.
   */
  it('filho cujo pai foi filtrado sobe para o primeiro nível, e não desaparece', () => {
    const grupos = navEmArvore(new Set(['pauta.ver']));
    const contexto = grupos.find((g) => g.secao.key === 'empresa')!;
    expect(contexto.itens.map((no) => no.item.key)).toContain('marca');
    expect(contexto.itens.every((no) => no.filhos.length === 0)).toBe(true);
  });

  it('módulo desligado tira pai e filho juntos', () => {
    const chaves = planos(todas, ['financeiro']).map((i) => i.key);
    expect(chaves).not.toContain('trabalho');
    expect(chaves).not.toContain('implantacao');
    expect(chaves).toContain('financeiro');
  });

  it('preserva a ordem do NAV dentro de cada seção', () => {
    const conteudo = navEmArvore(todas).find((g) => g.secao.key === 'conteudo')!;
    expect(conteudo.itens.map((no) => no.item.key)).toEqual(
      NAV.filter((n) => n.secao === 'conteudo' && !n.pai && !n.oculto).map((n) => n.key),
    );
  });

  /*
   * Trava de DADO, não de desenho: pai que não existe, ou que mora em outra
   * seção, faz o filho ser tratado como órfão — ele aparece, mas fora do lugar
   * pretendido, e ninguém descobre olhando a tela. Aqui descobre.
   */
  it('todo pai declarado existe e vive na mesma seção do filho', () => {
    for (const n of NAV.filter((i) => i.pai)) {
      const pai = NAV.find((i) => i.key === n.pai);
      expect(pai, `pai '${n.pai}' de '${n.key}' não existe no NAV`).toBeDefined();
      expect(pai!.secao, `'${n.key}' e o pai dele estão em seções diferentes`).toBe(n.secao);
      expect(pai!.pai, `menu é de dois níveis: '${n.pai}' não pode ser filho`).toBeUndefined();
    }
  });
});

/*
 * O BLOCO MARKETING (MK7, frente MK).
 *
 * A decisão do Pedro de 28/09/2026 manda o bloco seguir a organização do app do
 * Lucas. O que esta suíte guarda não é a aparência do menu — é o desenho que a
 * decisão fixou, e que se perde calado numa refatoração: o bloco fica no
 * Motor de Marketing (chave `conteudo`), a marca fica em Contexto (chave `empresa`), e a agenda do mês não vira item
 * próprio porque a aba Semana da Pauta já é a agenda.
 */
describe('o bloco Marketing (MK7)', () => {
  const item = (k: string) => NAV.find((n) => n.key === k);

  it('o bloco vive no Motor de Marketing, governado pelo módulo pauta', () => {
    const m = item('marketing');
    expect(m).toBeDefined();
    expect(m!.href).toBe('/marketing');
    expect(m!.secao).toBe('conteudo');
    expect(m!.modulo).toBe('pauta');
    expect(m!.pai, 'o bloco é raiz, não filho da Pauta').toBeUndefined();
  });

  it('26/10/2026: o menu mostra só as seções do Estúdio; o resto é aba da seção, oculto e vivo', () => {
    const visiveis = NAV.filter((n) => n.secao === 'conteudo' && !n.oculto).map((n) => n.label);
    expect(visiveis).toEqual(['Início', 'Memória', 'Ideias de conteúdo', 'Produção', 'Performance', 'Página de links', 'Campanhas', 'Eventos do site', 'Tarefas']);
    const abas: Record<string, string[]> = {
      'marketing-triagem': ['marketing-base', 'marketing-fontes', 'referencias', 'marketing-estrategia', 'marketing-ideias'],
      'maquina-producao': ['maquina-banco', 'maquina-agendar', 'maquina-calendario', 'marketing-formatos', 'pauta'],
      'marketing-performance': ['maquina-analise', 'marketing-relatorio', 'instagram'],
    };
    for (const [pai, filhos] of Object.entries(abas)) for (const k of filhos) {
      const n = item(k);
      expect(n, `${k} sumiu do NAV`).toBeDefined();
      expect(n!.pai, k).toBe(pai);
      expect(n!.oculto, k).toBe(true);
      expect(n!.secao, k).toBe('conteudo');
      expect(ROTAS_ABSORVIDAS.some((r) => r.href === n!.href), `${k}: aba não é rota absorvida`).toBe(false);
    }
  });

  it('a MARCA não mora no bloco: ela é contexto da empresa', () => {
    const marca = item('marca');
    expect(marca).toBeDefined();
    expect(marca!.pai, 'marca dentro de Marketing a esconde de quem escreve').toBe('contexto');
    expect(marca!.secao).toBe('empresa'); // seção Contexto
    expect(marca!.modulo).toBe('pauta');
    // A permissão é a da rota da API, e não a do Contexto: quem abre a tela
    // precisa poder ler a pauta, senão vê um erro em vez do conteúdo.
    expect(marca!.permission).toBe('pauta.ver');
  });

  it('a agenda do mês NÃO vira item próprio: a aba Semana da Pauta já é a agenda', () => {
    const agendaDoBloco = NAV.filter((n) => n.pai === 'marketing').find((n) => /agenda/i.test(n.label));
    expect(agendaDoBloco, 'duplicar a agenda cria a segunda verdade que a decisão manda evitar').toBeUndefined();
    expect(item('pauta')!.href).toBe('/pauta');
  });

  it('quem enxerga a Pauta enxerga o bloco inteiro, e sem o módulo nada aparece', () => {
    const perms = new Set(['pauta.ver']);
    const comModulo = navEmArvore(perms, ['pauta']);
    const conteudo = comModulo.find((g) => g.secao.key === 'conteudo');
    const bloco = conteudo?.itens.find((i) => i.item.key === 'marketing');
    expect(bloco, 'o bloco não apareceu para quem tem pauta.ver').toBeDefined();
    // 26/10/2026: as seções do Estúdio aparecem para quem tem pauta.ver; as abas ficam fora do menu.
    expect(conteudo!.itens.map((i) => i.item.key)).toEqual(expect.arrayContaining(['marketing-memoria', 'marketing-triagem', 'maquina-producao', 'marketing-performance']));
    expect(conteudo!.itens.map((i) => i.item.key)).not.toContain('marketing-ideias');
    const trabalho = comModulo.find((g) => g.secao.key === 'trabalho');
    expect(trabalho?.itens.map((i) => i.item.key) ?? []).not.toContain('marketing-ideias');

    // Sem o módulo, a seção inteira some (nenhum item dela sobra) — o que
    // importa é que o bloco não aparece por nenhum caminho.
    const semModulo = navEmArvore(perms, []);
    const todosSemModulo = semModulo.flatMap((g) => g.itens.map((i) => i.item.key));
    expect(todosSemModulo).not.toContain('marketing');
    expect(todosSemModulo).not.toContain('marketing-estrategia');
    expect(todosSemModulo).not.toContain('marca');
  });
});

/*
 * A ORGANIZAÇÃO DA ROOT-07 (C-16) e o enxugamento da versão final: agrupamento,
 * ordem, seção, hub e marca de oculto.
 */
describe('organização da navegação (ROOT-07 e versão final)', () => {
  /** Permissão de cada item que já existia na base. Fixa: reorganizar não toca o acesso. */
  const PERMISSAO_DA_BASE: Record<string, string> = {
    caixa: 'dashboard.ver', atendimento: 'aprovacoes.ver', agenda: 'dashboard.ver', console: 'dashboard.ver',
    contexto: 'obsidian.ver', marca: 'pauta.ver', organograma: 'dashboard.ver',
    tarefas: 'tarefas.ver', trabalho: 'tarefas.ver', onboarding: 'tarefas.ver',
    // Layout 26/10: `conteudo` (Temas do ClickUp) saiu do NAV; a rota redireciona para o Marketing.
    pauta: 'pauta.ver', referencias: 'pauta.ver', marketing: 'pauta.ver',
    'marketing-ideias': 'pauta.ver', 'marketing-estrategia': 'pauta.ver', 'marketing-performance': 'pauta.ver',
    'marketing-relatorio': 'pauta.ver', instagram: 'instagram.ver', bio: 'bio.ver',
    'comercial-painel': 'leads.ver', clientes: 'tarefas.ver', 'tarefas-todas': 'tarefas.ver', leads: 'leads.ver',
    'comercial-tarefas': 'tarefas.ver', 'marketing-tarefas': 'tarefas.ver', 'financeiro-tarefas': 'tarefas.ver', funil: 'dashboard.ver', campanhas: 'campanhas.ver', pixels: 'dashboard.ver',
    relatorios: 'relatorios.ver', metas: 'dashboard.ver', financeiro: 'financeiro.ver', 'custo-ia': 'dashboard.ver',
    agentes: 'mcp.ver', rotinas: 'automacoes.ver', sessoes: 'mcp.ver', fluxos: 'automacoes.ver',
    ferramentas: 'mcp.ver', conexoes: 'dashboard.ver', regua: 'mcp.ver', cofre: 'cofre.ver', rastro: 'auditoria.ver',
    'linha-do-tempo': 'auditoria.ver', assinatura: 'dashboard.ver', config: 'dashboard.ver',
  };

  it('os destinos da base mantêm chave e permissão', () => {
    for (const [k, perm] of Object.entries(PERMISSAO_DA_BASE)) {
      expect(porKey.get(k)?.permission, `${k}: permissão mudou ou item sumiu`).toBe(perm);
    }
  });

  /*
   * Propostas: era tela da ROOT fora do NAV (pedia a sessão da plataforma). Na versão
   * final é item do Comercial com `leads.ver`, a mesma permissão da API das propostas
   * da sala; as antigas do serviço de propostas continuam só na sessão da plataforma.
   */
  it('Propostas é do Comercial, com leads.ver', () => {
    expect(porKey.get('propostas')).toMatchObject({ href: '/propostas', permission: 'leads.ver', secao: 'comercial', modulo: 'leads' });
    expect(moduloDaRotaDoWeb('/propostas')).toBe('leads');
  });

  it('rótulos: nada promete função ausente, e item não repete o nome da seção', () => {
    expect(porKey.get('console')?.label).toBe('Painel geral da empresa');
    expect(porKey.get('tarefas-todas')?.label).toBe('Visão geral');
    expect(porKey.get('leads')?.label).toBe('Lista de leads');
    // "Minhas pendências/aprovações/agenda" só entram com o filtro pessoal pronto (doc 38).
    for (const n of NAV) expect(n.label, n.key).not.toMatch(/^minh[ao]s?\b/i);
    // nenhum rótulo anuncia a fonte ClickUp na tela que lê tarefa nativa
    expect(porKey.get('tarefas')?.label).toBe('Lista de tarefas');
    // as telas ainda não entregues dizem isso no próprio item
    expect(porKey.get('fluxos')).toMatchObject({ label: 'Processos', estado: 'parcial' });
    const rotulosDeSecao = new Set<string>(SECOES.map((s) => s.label));
    const repetidos = NAV.filter((n) => rotulosDeSecao.has(n.label)).map((n) => n.key);
    // "WhatsApp" e "Configurações da conta": cada seção tem um item só, o mesmo destino.
    expect(repetidos).toEqual(['whatsapp', 'config']);
  });

  it('o texto de apoio de Trabalho não cita as ideias, que moram no Marketing', () => {
    expect(SECOES.find((s) => s.key === 'trabalho')?.hint).toBe('tarefas, quadro e implantação');
  });

  // Ordem de 18/10/2026 (rodada do painel P0): Contexto desce para depois do Motor de IA.
  it('SECOES: ordem, rótulos e tipos do contrato C-16, com a ordem de 18/10/2026', () => {
    expect(SECOES.map((s) => [s.key, s.label, s.tipo])).toEqual([
      ['dia', 'Dia a dia', 'principal'],
      ['trabalho', 'Trabalho', 'principal'],
      ['conteudo', 'Motor de Marketing', 'principal'],
      ['comercial', 'Motor Comercial', 'principal'],
      ['whatsapp', 'WhatsApp', 'principal'],
      ['financeiro', 'Motor Financeiro', 'principal'],
      ['automacoes', 'Motor de IA', 'principal'],
      // 27/10/2026: a Frota (servidores de cliente que a ROOT opera) entrou como área própria, depois da IA.
      ['frota', 'Frota', 'principal'],
      ['empresa', 'Contexto', 'principal'],
      ['resultados', 'Resultados', 'principal'],
      ['controle', 'Configurações da empresa', 'apoio'],
      ['registros', 'Registros', 'apoio'],
      ['conta', 'Configurações da conta', 'apoio'],
    ]);
    const secaoDe = (k: string) => SECOES.find((s) => s.key === k) as { dentroDe?: string } | undefined;
    expect(secaoDe('registros')?.dentroDe, 'Registros fica dentro de Configurações').toBe('controle');
    expect(SECOES.filter((s) => 'dentroDe' in s)).toHaveLength(1);
  });

  it('Dia a dia: Visão geral · Pendências · Aprovações · Agenda, com Pendências visível', () => {
    const todas = new Set(NAV.map((n) => n.permission));
    const dia = navPorSecao(todas).find((g) => g.secao.key === 'dia')!;
    expect(dia.itens.map((i) => i.label)).toEqual(['Visão geral', 'Pendências', 'Aprovações', 'Agenda']);
    expect(porKey.get('caixa')?.oculto).toBeFalsy();
    expect(moduloDaRotaDoWeb('/dia-a-dia')).toBe('trabalho');
  });

  /*
   * Rodada da interface (20/10/2026, U1, item 4 da ata): o Painel geral da empresa sai do
   * menu. O item fica no NAV, oculto e dono da rota; `/painel` continua respondendo, e o
   * Custos de IA (`/painel/custo-ia`) segue na IA e automações.
   */
  it('o Painel geral sai do menu, e /painel segue viva com dono', () => {
    const todas = new Set(NAV.map((n) => n.permission));
    const painel = porKey.get('console')!;
    expect(painel).toMatchObject({ href: '/painel', oculto: true, permission: 'dashboard.ver', secao: 'dia' });
    expect(painel.modulo).toBeUndefined();
    expect(navEmArvore(todas).flatMap((g) => g.itens.flatMap((no) => [no.item.key, ...no.filhos.map((f) => f.key)]))).not.toContain('console');
    const absorvida = ROTAS_ABSORVIDAS.find((r) => r.href === '/painel');
    expect(absorvida?.destino).toBe('/dia-a-dia');
    expect(absorvida?.porque).toBe('a Visão geral é a entrada do dia; o painel antigo segue vivo pela rota');
    expect(paginaExiste('/painel')).toBe(true);
    expect(porKey.get('custo-ia')).toMatchObject({ href: '/painel/custo-ia', secao: 'automacoes' });
    expect(porKey.get('custo-ia')?.oculto).toBeFalsy();
  });

  /*
   * O enxugamento: o que eles ocultaram continua oculto, cada um com a rota em
   * ROTAS_ABSORVIDAS dizendo para onde a função foi, a tela viva e o mesmo módulo.
   * Nada volta ao menu por causa do merge.
   */
  it('o que foi ocultado continua oculto, vivo e com destino escrito', () => {
    const todas = new Set(NAV.map((n) => n.permission));
    const noMenu = navEmArvore(todas).flatMap((g) => g.itens.flatMap((no) => [no.item.key, ...no.filhos.map((f) => f.key)]));
    expect(NAV.filter((n) => n.oculto).map((n) => n.key).sort()).toEqual(Object.keys(OCULTOS_E_DESTINO).sort());
    for (const [k, destino] of Object.entries(OCULTOS_E_DESTINO)) {
      const n = porKey.get(k)!;
      expect(n.oculto, k).toBe(true);
      expect(noMenu, k).not.toContain(k);
      expect(paginaExiste(n.href), `${k}: a tela segue viva`).toBe(true);
      if (destino === null) continue;
      const absorvida = ROTAS_ABSORVIDAS.find((r) => r.href === n.href);
      expect(absorvida?.destino, k).toBe(destino);
      expect(absorvida?.porque.trim(), k).toBeTruthy();
    }
  });

  /*
   * Versão final (19/10/2026): o Motor Comercial tem oito itens soltos, nesta ordem.
   * `/comercial` voltou a ser o Painel geral do Lucas (deixou de redirecionar), e a
   * fila antiga das decisões mora em `/comercial/decisoes`, oculta, absorvida por
   * Pendências. Clientes e Tarefas saem (duplicados), ocultos e vivos.
   */
  it('Motor Comercial: Painel geral · Funil vivo · Propostas · Lista de leads · Contratos vivos · Torre · Relatório', () => {
    const todas = new Set(NAV.map((n) => n.permission));
    const comercial = navEmArvore(todas).find((g) => g.secao.key === 'comercial')!;
    // A Rodada da semana entra depois dos Contratos vivos só para a plataforma, fora do NAV
    // (navegacao-modulos.test.ts cobra). O Simulador virou a área WhatsApp em 20/10/2026.
    expect(comercial.itens.map((no) => no.item.label)).toEqual([
      'Painel geral', 'Funil de vendas', 'Propostas', 'Lista de leads', 'Contratos vivos',
      'Torre das automações', 'Relatório da semana',
    ]);
    for (const no of comercial.itens) {
      expect(no.item.pai, no.item.key).toBeUndefined();
      expect(no.filhos, no.item.key).toEqual([]);
    }
    expect(porKey.get('comercial-painel')?.href).toBe('/comercial');
    expect(porKey.get('comercial-painel')?.oculto).toBeFalsy();
    expect(ROTAS_ABSORVIDAS.some((r) => r.href === '/comercial')).toBe(false);
    const decisoes = porKey.get('comercial-decisoes')!;
    expect(decisoes).toMatchObject({ href: '/comercial/decisoes', oculto: true, modulo: 'leads', permission: 'leads.ver', secao: 'comercial' });
    const absorvida = ROTAS_ABSORVIDAS.find((r) => r.href === '/comercial/decisoes');
    expect(absorvida?.destino).toBe('/caixa');
    expect(absorvida?.porque).toMatch(/Pendências/);
    for (const rota of ['/comercial', '/comercial/decisoes', '/comercial/lead/abc', '/comercial/ficha/abc', '/propostas', '/leads']) {
      expect(moduloDaRotaDoWeb(rota), rota).toBe('leads');
    }
    expect(navPorSecao(todas, ['trabalho']).flatMap((g) => g.itens.map((i) => i.key))).not.toContain('comercial-funil');
  });

  /*
   * Rodada da interface (20/10/2026, U1, item 18 da ata): o WhatsApp vira área própria,
   * logo depois do Comercial, com a tela que morava em /comercial/simulador. Mesma
   * permissão e mesmo módulo; o item antigo fica oculto e dono da rota, que redireciona.
   * Clientes e Tarefas do Comercial não aparecem, mas abrem: as rotas têm página e dono.
   */
  it('WhatsApp é área própria; /comercial/simulador, /clientes e /comercial/tarefas fora do menu, mas abrindo', () => {
    expect(porKey.get('whatsapp')).toMatchObject({ label: 'WhatsApp', href: '/whatsapp', icon: 'MessageCircle', permission: 'leads.ver', secao: 'whatsapp', modulo: 'leads' });
    expect(porKey.get('whatsapp')?.oculto).toBeFalsy();
    expect(porKey.get('whatsapp')?.pai).toBeUndefined();
    expect(moduloDaRotaDoWeb('/whatsapp')).toBe('leads');
    expect(moduloDaRotaDoWeb('/whatsapp?conversa=abc')).toBe('leads');
    expect(paginaExiste('/whatsapp')).toBe(true);
    const ordem = SECOES.map((s) => s.key as string);
    expect(ordem.indexOf('whatsapp')).toBe(ordem.indexOf('comercial') + 1);
    // nenhum rótulo visível do menu chama a tela de simulador
    const comTodas = new Set(NAV.map((n) => n.permission));
    expect(navPorSecao(comTodas).flatMap((g) => g.itens.map((i) => i.label)).filter((r) => /simulador/i.test(r))).toEqual([]);
    expect(porKey.get('comercial-simulador')).toMatchObject({ href: '/comercial/simulador', secao: 'comercial', oculto: true, permission: 'leads.ver', modulo: 'leads' });
    expect(ROTAS_ABSORVIDAS.find((r) => r.href === '/comercial/simulador')?.destino).toBe('/whatsapp');
    // Produção 22C (W2): /whatsapp é a caixa; os celulares do comercial moram em /whatsapp/simulador.
    expect(paginaExiste('/whatsapp/simulador')).toBe(true);
    expect(paginaExiste('/comercial/simulador')).toBe(true);
    // A rota /whatsapp deixou de redirecionar para /atendimento: a página é que responde.
    expect((ROTAS_ANTIGAS as { de: string }[]).some((r) => r.de === '/whatsapp')).toBe(false);
    const todas = new Set(NAV.map((n) => n.permission));
    const noMenu = navPorSecao(todas).flatMap((g) => g.itens.map((i) => i.href));
    for (const href of ['/clientes', '/comercial/tarefas']) {
      expect(noMenu, href).not.toContain(href);
      expect(paginaExiste(href), href).toBe(true);
      expect(NAV.find((n) => n.href === href)?.oculto, href).toBe(true);
    }
    expect(moduloDaRotaDoWeb('/clientes')).toBe('trabalho');
    expect(moduloDaRotaDoWeb('/comercial/tarefas')).toBe('trabalho');
  });

  /*
   * Rodada do painel P2 (18/10/2026): a Lista de tarefas virou a visão Lista do
   * Trabalho. `/tarefas` sai do menu oculta, absorvida por /trabalho, e a página
   * redireciona (na página, não em rotas-antigas.mjs: item do NAV com redirect de
   * configuração reprova o teste de disputa de rota). A Implantação de clientes
   * fica pendurada no Trabalho, mesma seção.
   */
  it('quadro e lista são uma tela só: /tarefas oculta e absorvida, Implantação sob o Trabalho abrindo o kanban', () => {
    const tarefas = porKey.get('tarefas')!;
    expect(tarefas).toMatchObject({ href: '/tarefas', oculto: true, modulo: 'trabalho', permission: 'tarefas.ver' });
    const absorvida = ROTAS_ABSORVIDAS.find((r) => r.href === '/tarefas');
    expect(absorvida?.destino).toBe('/trabalho');
    expect(absorvida?.porque).toMatch(/uma tela só/);
    expect(porKey.get('trabalho')).toMatchObject({ label: 'Tarefas', href: '/trabalho' });
    expect(porKey.get('onboarding')).toMatchObject({ pai: 'trabalho', secao: 'trabalho', href: '/onboarding', oculto: true });
    expect(ROTAS_ABSORVIDAS.find((r) => r.href === '/onboarding')?.destino).toBe('/trabalho/implantacao');
    // Leva 5, L3 (27/10/2026): a Implantação fica oculta (a rota segue viva); só as Atas ficam penduradas em Tarefas.
    expect(porKey.get('implantacao')).toMatchObject({ pai: 'trabalho', secao: 'trabalho', href: '/trabalho/implantacao', label: 'Implantação de clientes', oculto: true });
    expect(ROTAS_ABSORVIDAS.find((r) => r.href === '/trabalho/implantacao')?.destino).toBe('/trabalho');
    expect(ROTAS_ABSORVIDAS.find((r) => r.href === '/trabalho/implantacao')?.porque).toMatch(/Onboarding de cliente/);
    expect(paginaExiste('/trabalho/implantacao')).toBe(true);
    const todas = new Set(NAV.map((n) => n.permission));
    const trabalho = navEmArvore(todas).find((g) => g.secao.key === 'trabalho')!;
    const raiz = trabalho.itens.find((no) => no.item.key === 'trabalho')!;
    expect(raiz.filhos.map((f) => f.key)).toEqual(['trabalho-atas']);
    expect(navPorSecao(todas).flatMap((g) => g.itens.map((i) => i.key))).not.toContain('tarefas');
    expect(moduloDaRotaDoWeb('/tarefas')).toBe('trabalho');
  });

  /*
   * Rodada do painel P3 (18/10/2026): o banco de atas da operação mora no Trabalho,
   * pendurado no item Tarefas, com a permissão de ler o quadro.
   */
  /*
   * Rodada da interface (20/10/2026, U1/U3): "Todas as tarefas" era a rota /trabalho/todas,
   * pendurada no Trabalho. Na mesma noite (pedido do Rodrigo) "o Todas é uma opção dentro
   * de Tarefas, não uma subseção": o item fica oculto e dono da rota, absorvido pelo chip
   * Todas de /trabalho, e a página redireciona com a mesma query.
   */
  it('Todas as tarefas: oculto, dono de /trabalho/todas e absorvido pelo chip Todas de Tarefas', () => {
    expect(porKey.get('trabalho-todas')).toMatchObject({ label: 'Todas as tarefas', href: '/trabalho/todas', permission: 'tarefas.ver', secao: 'trabalho', modulo: 'trabalho', pai: 'trabalho', oculto: true });
    expect(moduloDaRotaDoWeb('/trabalho/todas')).toBe('trabalho');
    expect(moduloDaRotaDoWeb('/trabalho/todas?segmento=abc')).toBe('trabalho');
    const absorvida = ROTAS_ABSORVIDAS.find((r) => r.href === '/trabalho/todas');
    expect(absorvida?.destino).toBe('/trabalho?pasta=todas');
    expect(absorvida?.porque).toMatch(/opção dentro de Tarefas, não uma subseção/);
    expect(paginaExiste('/trabalho/todas')).toBe(true);
    const todas = new Set(NAV.map((n) => n.permission));
    const trabalho = navPorSecao(todas).find((g) => g.secao.key === 'trabalho')!;
    // Leva 5, L3: a Implantação saiu do menu (oculta, viva).
    expect(trabalho.itens.map((i) => i.label)).toEqual(['Tarefas', 'Atas']);
    // As contagens do menu depois da noite de 20/10/2026.
    // Leva única de 27/10 (leva 5 L3 + Marketing no jeito do Estúdio): 42 visíveis, 26 ocultos (13 abas do Marketing) e 12 absorvidas.
    expect(NAV.filter((n) => !n.oculto)).toHaveLength(42);
    // 13 desde a produção 22B: o Perfil (I6) e a Lixeira (I2) entraram ocultos (a entrada é a engrenagem do topo).
    // Layout 26/10: 12 e 11, `/conteudo` (Temas do ClickUp) aposentado, com redirect para o Marketing.
    expect(NAV.filter((n) => n.oculto)).toHaveLength(26);
    expect(ROTAS_ABSORVIDAS).toHaveLength(12);
  });

  it('as Atas ficam no Trabalho, sob Tarefas, com tarefas.ver e o módulo trabalho', () => {
    const atas = porKey.get('trabalho-atas')!;
    expect(atas).toMatchObject({ label: 'Atas', href: '/trabalho/atas', icon: 'NotebookText', permission: 'tarefas.ver', secao: 'trabalho', modulo: 'trabalho', pai: 'trabalho' });
    expect(atas.oculto).toBeFalsy();
    expect(moduloDaRotaDoWeb('/trabalho/atas')).toBe('trabalho');
    const soVer = navEmArvore(new Set(['tarefas.ver'])).find((g) => g.secao.key === 'trabalho')!;
    expect(soVer.itens.find((no) => no.item.key === 'trabalho')!.filhos.map((f) => f.key)).toContain('trabalho-atas');
    expect(navPorSecao(new Set(['dashboard.ver'])).flatMap((g) => g.itens.map((i) => i.key))).not.toContain('trabalho-atas');
  });

  it('/assinatura sai da barra e da busca por marca, e continua no NAV', () => {
    const a = porKey.get('assinatura')!;
    expect(a.oculto).toBe(true);
    const todas = new Set(NAV.map((n) => n.permission));
    expect(navPorSecao(todas).flatMap((g) => g.itens.map((i) => i.key))).not.toContain('assinatura');
    expect(
      navEmArvore(todas).flatMap((g) => g.itens.flatMap((no) => [no.item.key, ...no.filhos.map((f) => f.key)])),
    ).not.toContain('assinatura');
    expect(navPorSecao(todas, MODULOS).flatMap((g) => g.itens.map((i) => i.key))).not.toContain('assinatura');
    // a rota segue com dono: permissão e módulo preservados
    expect(a.href).toBe('/assinatura');
    expect(a.permission).toBe('dashboard.ver');
    expect(a.modulo).toBeUndefined();
  });

  /*
   * B1 (ROOT-06-REV): toda tag `area:<chave>` publicada na base continua
   * resolvendo para uma área do mapa. As chaves antigas ficaram e só mudaram de
   * rótulo; as novas somam.
   */
  it('as tags area:<chave> da base continuam resolvendo no mapa', () => {
    for (const chave of ['empresa', 'conteudo', 'comercial', 'automacoes', 'dia', 'trabalho', 'resultados', 'controle']) {
      expect(areasDaNota([`area:${chave}`]), `area:${chave} ficou sem área`).toEqual([chave]);
    }
    // A chave nova soma (20/10/2026): `area:whatsapp` cai na área WhatsApp do mapa, e
    // nenhuma chave publicada sumiu.
    expect(areasDaNota(['area:whatsapp'])).toEqual(['whatsapp']);
    expect(SECOES.map((s) => s.key)).toEqual(expect.arrayContaining(['empresa', 'conteudo', 'comercial', 'automacoes', 'dia', 'trabalho', 'resultados', 'controle', 'financeiro', 'registros', 'conta', 'whatsapp']));
    expect(areasDaNota(['area:empresa', 'area:conteudo', 'area:comercial', 'area:automacoes']))
      .toEqual(['conteudo', 'comercial', 'automacoes', 'empresa']); // na ordem das SECOES (Contexto desceu em 18/10/2026)
    expect(areasDaNota(['area:nao-existe'])).toEqual([]);
  });
});

describe('revisão final 2.5: os comentários descrevem o menu final', () => {
  const ler = (...p: string[]) => readFileSync(join(__dirname, '..', '..', ...p), 'utf8');
  it('/comercial é o Painel geral (não redireciona ao Funil vivo) e Pendências está no menu', () => {
    const nav = ler('..', '..', 'packages', 'shared', 'src', 'nav.ts');
    expect(nav).not.toMatch(/`\/comercial` redireciona/);
    expect(nav).not.toMatch(/Dia a dia › Tarefas filtrada/);
    expect(NAV.find((i) => i.href === '/comercial')?.label).toBe('Painel geral');
    expect(NAV.find((i) => i.key === 'caixa')?.oculto).toBeFalsy();
    expect(ler('src', 'components', 'Sidebar.tsx')).not.toMatch(/Pendências fora do menu/);
  });
});
