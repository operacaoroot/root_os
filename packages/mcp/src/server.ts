import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { apiGet, qs } from './client.js';

// Todas as tools desta fase são read_only (menor privilégio; a conta de serviço
// nem tem permissão de escrita). Retornamos JSON com o campo `source` da API
// para que a IA sempre cite a fonte interna dos dados.

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}
function fail(e: unknown) {
  return {
    content: [{ type: 'text' as const, text: `Erro: ${(e as Error).message}` }],
    isError: true,
  };
}

const READ_ONLY = { readOnlyHint: true, openWorldHint: false };

export function buildServer(): McpServer {
  const server = new McpServer({ name: 'marketing-os', version: '0.1.0' });

  server.registerTool(
    'get_dashboard_summary',
    {
      description:
        'Resumo executivo do dia: leads (hoje/semana/mês), conversões, vendas, receita, taxa de conversão, CPL, tarefas atrasadas, campanhas ativas/em risco e alertas. [read_only]',
      inputSchema: {},
      annotations: { title: 'Resumo do dashboard', ...READ_ONLY },
    },
    async () => {
      try {
        return ok(await apiGet('/dashboard/summary'));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'get_funnel_metrics',
    {
      description:
        'Métricas do funil de marketing: contagem por etapa (visitante→lead→qualificado→...→ganho) e conversão entre etapas. [read_only]',
      inputSchema: {},
      annotations: { title: 'Métricas do funil', ...READ_ONLY },
    },
    async () => {
      try {
        return ok(await apiGet('/funnel/metrics'));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'search_leads',
    {
      description:
        'Lista leads, opcionalmente filtrando por período (today|week|month) e/ou status (novo, qualificado, oportunidade, reuniao, proposta, ganho, perdido). [read_only]',
      inputSchema: {
        period: z.enum(['today', 'week', 'month']).optional().describe('Janela de tempo'),
        status: z.string().optional().describe('Status do lead'),
      },
      annotations: { title: 'Buscar leads', ...READ_ONLY },
    },
    async ({ period, status }) => {
      try {
        return ok(await apiGet(`/leads${qs({ period, status })}`));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'get_lead',
    {
      description: 'Retorna a ficha completa de um lead pelo id (dados, UTMs, campanha e histórico). [read_only]',
      inputSchema: { lead_id: z.string().describe('ID do lead') },
      annotations: { title: 'Ficha do lead', ...READ_ONLY },
    },
    async ({ lead_id }) => {
      try {
        return ok(await apiGet(`/leads/${encodeURIComponent(lead_id)}`));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'list_campaigns',
    {
      description:
        'Lista campanhas com leads, conversões e CPL. Filtro opcional por status (ativa, pausada, problema, encerrada). [read_only]',
      inputSchema: { status: z.string().optional().describe('Status da campanha') },
      annotations: { title: 'Listar campanhas', ...READ_ONLY },
    },
    async ({ status }) => {
      try {
        return ok(await apiGet(`/campaigns${qs({ status })}`));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'get_campaign',
    {
      description: 'Dossiê de uma campanha: métricas (CPL/CPA), orçamento/investido e leads da campanha. [read_only]',
      inputSchema: { campaign_id: z.string().describe('ID da campanha') },
      annotations: { title: 'Dossiê da campanha', ...READ_ONLY },
    },
    async ({ campaign_id }) => {
      try {
        return ok(await apiGet(`/campaigns/${encodeURIComponent(campaign_id)}`));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'list_tasks',
    {
      description:
        'Lista tarefas (ClickUp/Asana unificados). Filtros: overdue (só atrasadas) e status. [read_only]',
      inputSchema: {
        overdue: z.boolean().optional().describe('Apenas tarefas atrasadas'),
        status: z.string().optional().describe('Status da tarefa'),
      },
      annotations: { title: 'Listar tarefas', ...READ_ONLY },
    },
    async ({ overdue, status }) => {
      try {
        return ok(await apiGet(`/tasks${qs({ overdue: overdue ? 1 : undefined, status })}`));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'get_overdue_tasks',
    {
      description: 'Atalho: retorna apenas as tarefas atrasadas (due < agora e não concluídas). [read_only]',
      inputSchema: {},
      annotations: { title: 'Tarefas atrasadas', ...READ_ONLY },
    },
    async () => {
      try {
        return ok(await apiGet('/tasks?overdue=1'));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'get_events_summary',
    {
      description:
        'Resumo do tráfego do pixel numa janela (default 7 dias): totais de eventos, sessões, visitantes, compras e receita; quebra por evento, por origem (UTM) e páginas mais vistas; série diária. [read_only]',
      inputSchema: {
        days: z.number().int().min(1).max(90).optional().describe('Janela em dias (1–90; default 7)'),
      },
      annotations: { title: 'Resumo de eventos/pixel', ...READ_ONLY },
    },
    async ({ days }) => {
      try {
        return ok(await apiGet(`/events/summary${qs({ days })}`));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'get_content_stats',
    {
      description:
        'Resumo do pipeline de conteúdo (temas do ClickUp): total e contagem por etapa (validar ideia/escrever roteiro/complete), por eixo e por formato. [read_only]',
      inputSchema: {},
      annotations: { title: 'Resumo de conteúdo', ...READ_ONLY },
    },
    async () => {
      try {
        return ok(await apiGet('/content/stats'));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'list_content',
    {
      description:
        'Lista temas de conteúdo (pipeline do ClickUp) com título, etapa (status), eixo, formato, tipo e link. Filtros opcionais por status, eixo e formato. Use para triar/priorizar temas e achar o id para propor mudança de etapa. [read_only]',
      inputSchema: {
        status: z.string().optional().describe('Etapa (ex.: "validar ideia", "escrever roteiro")'),
        eixo: z.string().optional().describe('Eixo de conteúdo'),
        formato: z.string().optional().describe('Formato (ex.: Reel, Carrossel)'),
      },
      annotations: { title: 'Listar conteúdo', ...READ_ONLY },
    },
    async ({ status, eixo, formato }) => {
      try {
        return ok(await apiGet(`/content${qs({ status, eixo, formato })}`));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'search_knowledge',
    {
      description:
        'Busca SEMÂNTICA na base de conhecimento (vault Obsidian do root): retorna as notas mais relevantes p/ a pergunta, com título, trecho e caminho. Use para responder citando o conhecimento interno — sempre cite a nota (path). [read_only]',
      inputSchema: {
        query: z.string().describe('Pergunta ou tema a buscar'),
        limit: z.number().int().min(1).max(20).optional().describe('Quantas notas (default 8)'),
      },
      annotations: { title: 'Buscar conhecimento (Obsidian)', ...READ_ONLY },
    },
    async ({ query, limit }) => {
      try {
        return ok(await apiGet(`/knowledge/search${qs({ q: query, limit })}`));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'get_note',
    {
      description: 'Retorna o conteúdo completo de uma nota da base de conhecimento pelo id (use o id vindo do search_knowledge). [read_only]',
      inputSchema: { note_id: z.string().describe('ID da nota') },
      annotations: { title: 'Ler nota (Obsidian)', ...READ_ONLY },
    },
    async ({ note_id }) => {
      try {
        return ok(await apiGet(`/knowledge/${encodeURIComponent(note_id)}`));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'list_calendar_events',
    {
      description: 'Próximos eventos da Google Agenda (calendário primário): título, início/fim, local e participantes. [read_only]',
      inputSchema: { max: z.number().int().min(1).max(50).optional().describe('Quantos eventos (default 10)') },
      annotations: { title: 'Agenda (Google)', ...READ_ONLY },
    },
    async ({ max }) => {
      try {
        return ok(await apiGet(`/google/calendar${qs({ max })}`));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'search_gmail',
    {
      description: 'Lista/busca e-mails recentes do Gmail (remetente, assunto, data, trecho, não-lido). `q` usa a sintaxe de busca do Gmail (ex.: "is:unread", "from:cliente"). [read_only]',
      inputSchema: {
        q: z.string().optional().describe('Busca estilo Gmail (opcional)'),
        max: z.number().int().min(1).max(30).optional().describe('Quantos (default 10)'),
      },
      annotations: { title: 'Gmail', ...READ_ONLY },
    },
    async ({ q, max }) => {
      try {
        return ok(await apiGet(`/google/gmail${qs({ q, max })}`));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'get_email',
    {
      description: 'Lê um e-mail completo do Gmail pelo id (corpo em texto). [read_only]',
      inputSchema: { message_id: z.string().describe('ID da mensagem') },
      annotations: { title: 'Ler e-mail', ...READ_ONLY },
    },
    async ({ message_id }) => {
      try {
        return ok(await apiGet(`/google/gmail/${encodeURIComponent(message_id)}`));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'list_drive_files',
    {
      description: 'Lista/busca arquivos do Google Drive (nome, tipo, modificado, link). `q` filtra por nome. [read_only]',
      inputSchema: {
        q: z.string().optional().describe('Filtro por nome (opcional)'),
        max: z.number().int().min(1).max(50).optional(),
      },
      annotations: { title: 'Google Drive', ...READ_ONLY },
    },
    async ({ q, max }) => {
      try {
        return ok(await apiGet(`/google/drive${qs({ q, max })}`));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'get_doc',
    {
      description: 'Lê o conteúdo (texto) de um Google Doc pelo id (use o id vindo do list_drive_files). [read_only]',
      inputSchema: { doc_id: z.string().describe('ID do documento') },
      annotations: { title: 'Ler Google Doc', ...READ_ONLY },
    },
    async ({ doc_id }) => {
      try {
        return ok(await apiGet(`/google/docs/${encodeURIComponent(doc_id)}`));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'list_recent_events',
    {
      description:
        'Lista os eventos de pixel mais recentes (page_view, purchase, lead, etc.) com página, origem (UTM), dispositivo e valor. Útil para depurar rastreamento e ver conversões em tempo quase real. [read_only]',
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional().describe('Quantos eventos (1–200; default 50)'),
      },
      annotations: { title: 'Eventos recentes do pixel', ...READ_ONLY },
    },
    async ({ limit }) => {
      try {
        return ok(await apiGet(`/events/recent${qs({ limit })}`));
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ---------- Financeiro (FinOps) ----------
  server.registerTool(
    'get_finance_summary',
    {
      description:
        'Resumo financeiro: saldo total consolidado, resultado/entradas/saídas do mês, contas a pagar e a receber (inclusive vencidas), saldo por conta, top categorias do mês e status das conexões bancárias. [read_only]',
      inputSchema: {},
      annotations: { title: 'Resumo financeiro', ...READ_ONLY },
    },
    async () => {
      try {
        return ok(await apiGet('/finance/summary'));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'list_finance_accounts',
    {
      description: 'Lista as contas financeiras (bancária, caixa, cartão) com saldo atual e saldo inicial. [read_only]',
      inputSchema: {},
      annotations: { title: 'Contas financeiras', ...READ_ONLY },
    },
    async () => {
      try {
        return ok(await apiGet('/finance/accounts'));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'list_finance_transactions',
    {
      description:
        'Lista lançamentos financeiros, filtrando por status (previsto|realizado|conciliado), tipo (entrada|saida), conta e período (from/to em YYYY-MM-DD). Retorna também os totais de entradas, saídas e saldo. [read_only]',
      inputSchema: {
        status: z.enum(['previsto', 'realizado', 'conciliado']).optional().describe('Status do lançamento'),
        type: z.enum(['entrada', 'saida']).optional().describe('Tipo do lançamento'),
        account_id: z.string().optional().describe('ID da conta'),
        from: z.string().optional().describe('Data inicial (YYYY-MM-DD)'),
        to: z.string().optional().describe('Data final (YYYY-MM-DD)'),
        limit: z.number().int().min(1).max(1000).optional().describe('Quantos lançamentos (default 200)'),
      },
      annotations: { title: 'Lançamentos financeiros', ...READ_ONLY },
    },
    async ({ status, type, account_id, from, to, limit }) => {
      try {
        return ok(await apiGet(`/finance/transactions${qs({ status, type, accountId: account_id, from, to, limit })}`));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    'get_cashflow',
    {
      description:
        'Fluxo de caixa projetado dia a dia (inclui previstos por vencimento): saldo de abertura, entradas/saídas/resultado por dia e saldo acumulado. Janela padrão: hoje até +30 dias. [read_only]',
      inputSchema: {
        from: z.string().optional().describe('Início da janela (YYYY-MM-DD)'),
        to: z.string().optional().describe('Fim da janela (YYYY-MM-DD)'),
      },
      annotations: { title: 'Fluxo de caixa', ...READ_ONLY },
    },
    async ({ from, to }) => {
      try {
        return ok(await apiGet(`/finance/cashflow${qs({ from, to })}`));
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}
