import { writeClient, type ResourceType } from './write-client.js';

// Enums de status (espelham @mktos/shared; inline p/ não acoplar dep nova ao bot).
const LEAD_STATUS = ['novo', 'qualificado', 'oportunidade', 'reuniao', 'proposta', 'ganho', 'perdido'];
const TASK_STATUS = ['aberta', 'em_andamento', 'concluida', 'bloqueada'];
const CAMPAIGN_STATUS = ['planejada', 'ativa', 'pausada', 'analise', 'encerrada', 'problema'];

// `changes` É o corpo exato do PATCH — o mesmo objeto vira o hash da aprovação
// no backend, então propose e escrita têm de mandar idêntico (bind da mudança).
export interface ProposedAction {
  resourceType: ResourceType;
  resourceId: string;
  changes: Record<string, unknown>;
  describe: string;
}

// Tools de AÇÃO expostas à IA — elas NÃO executam nada; apenas registram uma
// PROPOSTA que o humano confirma no Telegram. A escrita real só ocorre após o "sim".
export const ACTION_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'propose_update_lead_status',
      description:
        'PROPÕE mudar a etapa (status) de um lead e/ou definir a próxima ação. NÃO executa — o humano confirma no Telegram. Use o lead_id vindo das ferramentas de leitura.',
      parameters: {
        type: 'object',
        properties: {
          lead_id: { type: 'string', description: 'ID do lead' },
          status: { type: 'string', enum: LEAD_STATUS },
          next_action: { type: 'string', description: 'Próxima ação (opcional)' },
        },
        required: ['lead_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'propose_set_task_status',
      description: 'PROPÕE mudar o status de uma tarefa (ex.: concluir). NÃO executa — requer confirmação humana.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          status: { type: 'string', enum: TASK_STATUS },
        },
        required: ['task_id', 'status'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'propose_set_campaign_status',
      description: 'PROPÕE mudar o status de uma campanha (ex.: pausar). NÃO executa — requer confirmação humana.',
      parameters: {
        type: 'object',
        properties: {
          campaign_id: { type: 'string' },
          status: { type: 'string', enum: CAMPAIGN_STATUS },
        },
        required: ['campaign_id', 'status'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'propose_set_content_status',
      description:
        'PROPÕE mover um TEMA de conteúdo para outra etapa do pipeline (ex.: "validar ideia"→"escrever roteiro"→"complete"). Escreve de volta no ClickUp. Use o content_id do list_content e o NOME exato da etapa. NÃO executa — requer confirmação humana.',
      parameters: {
        type: 'object',
        properties: {
          content_id: { type: 'string', description: 'ID do tema (list_content)' },
          status: { type: 'string', description: 'Etapa alvo (nome exato do ClickUp)' },
        },
        required: ['content_id', 'status'],
      },
    },
  },
];

export const ACTION_TOOL_NAMES = new Set(ACTION_TOOLS.map((t) => t.function.name));

/** Converte um tool_call de ação da IA numa PROPOSTA validada (ou lança erro). */
export function parseAction(name: string, args: Record<string, unknown>): ProposedAction {
  if (name === 'propose_update_lead_status') {
    const id = String(args.lead_id ?? '');
    const status = args.status ? String(args.status) : undefined;
    const nextAction = args.next_action ? String(args.next_action) : undefined;
    if (!id) throw new Error('lead_id ausente');
    if (status && !LEAD_STATUS.includes(status)) throw new Error(`status inválido: ${status}`);
    if (!status && !nextAction) throw new Error('nada a alterar no lead');
    const changes: Record<string, unknown> = {};
    if (status) changes.status = status;
    if (nextAction) changes.nextAction = nextAction;
    const parts = [status && `etapa → ${status}`, nextAction && `próxima ação → "${nextAction}"`].filter(Boolean);
    return { resourceType: 'lead', resourceId: id, changes, describe: `Lead ${id.slice(0, 8)}: ${parts.join(' · ')}` };
  }
  if (name === 'propose_set_task_status') {
    const id = String(args.task_id ?? '');
    const status = String(args.status ?? '');
    if (!id || !TASK_STATUS.includes(status)) throw new Error('task_id/status inválidos');
    return { resourceType: 'task', resourceId: id, changes: { status }, describe: `Tarefa ${id.slice(0, 8)}: status → ${status}` };
  }
  if (name === 'propose_set_campaign_status') {
    const id = String(args.campaign_id ?? '');
    const status = String(args.status ?? '');
    if (!id || !CAMPAIGN_STATUS.includes(status)) throw new Error('campaign_id/status inválidos');
    return { resourceType: 'campaign', resourceId: id, changes: { status }, describe: `Campanha ${id.slice(0, 8)}: status → ${status}` };
  }
  if (name === 'propose_set_content_status') {
    const id = String(args.content_id ?? '');
    const status = String(args.status ?? '');
    if (!id || !status) throw new Error('content_id/status inválidos');
    return { resourceType: 'content', resourceId: id, changes: { status }, describe: `Tema ${id.slice(0, 8)}: etapa → ${status} (grava no ClickUp)` };
  }
  throw new Error(`ação desconhecida: ${name}`);
}

/** Executa a ação JÁ APROVADA (token confirmado) via a conta de AÇÃO. */
export async function executeAction(a: ProposedAction, approvalToken: string): Promise<string> {
  await writeClient.writeResource(a.resourceType, a.resourceId, a.changes, approvalToken);
  if (a.resourceType === 'content') return `✅ Tema movido (${a.describe}).`;
  return `✅ Feito — ${a.describe}.`;
}
