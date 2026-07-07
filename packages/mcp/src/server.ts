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

  return server;
}
