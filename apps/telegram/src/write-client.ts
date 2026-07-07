import { config } from './config.js';

// Cliente de ESCRITA do bot — autentica com a conta de AÇÃO (least-privilege:
// só *.editar). Usado APENAS depois da confirmação humana no Telegram.
// Separado do MCP (que é read-only): a IA nunca escreve direto.
const EMAIL = process.env.MCP_ACTION_EMAIL ?? 'ia-acao@marketing-os.local';
const PASSWORD = process.env.MCP_ACTION_PASSWORD ?? 'ia-acao-12345';

let token: string | null = null;

async function login(): Promise<void> {
  const res = await fetch(`${config.mcp.apiUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login da conta de ação falhou: HTTP ${res.status}`);
  token = ((await res.json()) as { token: string }).token;
}

async function patch(path: string, body: unknown): Promise<unknown> {
  if (!token) await login();
  const doReq = () =>
    fetch(`${config.mcp.apiUrl}${path}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  let res = await doReq();
  if (res.status === 401) {
    await login();
    res = await doReq();
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`API ${path} → HTTP ${res.status} ${t.slice(0, 200)}`);
  }
  return res.json();
}

export const writeClient = {
  updateLead: (id: string, body: { status?: string; nextAction?: string | null }) =>
    patch(`/leads/${encodeURIComponent(id)}`, body),
  setTaskStatus: (id: string, status: string) =>
    patch(`/tasks/${encodeURIComponent(id)}`, { status }),
  setCampaignStatus: (id: string, status: string) =>
    patch(`/campaigns/${encodeURIComponent(id)}`, { status }),
  setContentStatus: (id: string, status: string) =>
    patch(`/content/${encodeURIComponent(id)}`, { status }),
};
