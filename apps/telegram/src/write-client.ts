import { config } from './config.js';

// Cliente de ESCRITA do bot — autentica com a conta de AÇÃO (least-privilege:
// só *.editar) e SÓ escreve carregando um x-approval-token confirmado pelo humano.
// A senha vem de env (sem default no código — ver config.action / assertConfigured).
const API = config.mcp.apiUrl;

export type ResourceType = 'lead' | 'task' | 'campaign' | 'content';
const PATHS: Record<ResourceType, string> = {
  lead: 'leads',
  task: 'tasks',
  campaign: 'campaigns',
  content: 'content',
};

export interface ApprovalTicket {
  approvalId: string;
  token: string;
  summary: string;
  expiresAt: string;
}

let token: string | null = null;

async function login(): Promise<void> {
  if (!config.action.password) throw new Error('MCP_ACTION_PASSWORD ausente (conta de ação).');
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: config.action.email, password: config.action.password }),
  });
  if (!res.ok) throw new Error(`Login da conta de ação falhou: HTTP ${res.status}`);
  token = ((await res.json()) as { token: string }).token;
}

async function req<T>(
  method: string,
  path: string,
  opts: { body?: unknown; approvalToken?: string } = {},
): Promise<T> {
  if (!token) await login();
  const doReq = () => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
    if (opts.approvalToken) headers['x-approval-token'] = opts.approvalToken;
    return fetch(`${API}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  };
  let res = await doReq();
  if (res.status === 401) {
    await login();
    res = await doReq();
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API ${path} → HTTP ${res.status} ${t.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export const writeClient = {
  // 1) registra a proposta no backend (status=pending) e recebe o token da escrita
  createApproval(payload: {
    resourceType: ResourceType;
    resourceId: string;
    changes: Record<string, unknown>;
    summary?: string;
  }): Promise<ApprovalTicket> {
    return req<ApprovalTicket>('POST', '/approvals', { body: payload });
  },
  // 2) humano confirmou no Telegram → marca confirmed (libera a escrita)
  confirmApproval(id: string): Promise<unknown> {
    return req('POST', `/approvals/${encodeURIComponent(id)}/confirm`, {});
  },
  // humano cancelou → rejeita (best-effort)
  rejectApproval(id: string): Promise<unknown> {
    return req('POST', `/approvals/${encodeURIComponent(id)}/reject`, {});
  },
  // 3) escrita real, carregando o token confirmado (o ApprovalGuard valida no backend)
  writeResource(
    resourceType: ResourceType,
    id: string,
    changes: Record<string, unknown>,
    approvalToken: string,
  ): Promise<unknown> {
    return req('PATCH', `/${PATHS[resourceType]}/${encodeURIComponent(id)}`, {
      body: changes,
      approvalToken,
    });
  },
};
