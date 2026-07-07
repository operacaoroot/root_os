import { writeClient } from './write-client.js';

// Enums de status (espelham @mktos/shared; inline p/ não acoplar dep nova ao bot).
const LEAD_STATUS = ['novo', 'qualificado', 'oportunidade', 'reuniao', 'proposta', 'ganho', 'perdido'];
const TASK_STATUS = ['aberta', 'em_andamento', 'concluida', 'bloqueada'];
const CAMPAIGN_STATUS = ['planejada', 'ativa', 'pausada', 'analise', 'encerrada', 'problema'];

export type ProposedAction =
  | { kind: 'lead'; id: string; status?: string; nextAction?: string; describe: string }
  | { kind: 'task'; id: string; status: string; describe: string }
  | { kind: 'campaign'; id: string; status: string; describe: string };

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
    const parts = [status && `etapa → ${status}`, nextAction && `próxima ação → "${nextAction}"`].filter(Boolean);
    return { kind: 'lead', id, status, nextAction, describe: `Lead ${id.slice(0, 8)}: ${parts.join(' · ')}` };
  }
  if (name === 'propose_set_task_status') {
    const id = String(args.task_id ?? '');
    const status = String(args.status ?? '');
    if (!id || !TASK_STATUS.includes(status)) throw new Error('task_id/status inválidos');
    return { kind: 'task', id, status, describe: `Tarefa ${id.slice(0, 8)}: status → ${status}` };
  }
  if (name === 'propose_set_campaign_status') {
    const id = String(args.campaign_id ?? '');
    const status = String(args.status ?? '');
    if (!id || !CAMPAIGN_STATUS.includes(status)) throw new Error('campaign_id/status inválidos');
    return { kind: 'campaign', id, status, describe: `Campanha ${id.slice(0, 8)}: status → ${status}` };
  }
  throw new Error(`ação desconhecida: ${name}`);
}

/** Executa a ação aprovada via a conta de AÇÃO (least-privilege). */
export async function executeAction(a: ProposedAction): Promise<string> {
  if (a.kind === 'lead') {
    const body: { status?: string; nextAction?: string | null } = {};
    if (a.status) body.status = a.status;
    if (a.nextAction) body.nextAction = a.nextAction;
    await writeClient.updateLead(a.id, body);
    return `✅ Lead atualizado (${a.describe}).`;
  }
  if (a.kind === 'task') {
    await writeClient.setTaskStatus(a.id, a.status);
    return `✅ Tarefa atualizada (status → ${a.status}).`;
  }
  await writeClient.setCampaignStatus(a.id, a.status);
  return `✅ Campanha atualizada (status → ${a.status}).`;
}
