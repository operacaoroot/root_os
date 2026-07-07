// Cliente da API do Marketing OS para o MCP.
// Autentica com a conta de SERVIÇO (só-leitura) e chama endpoints read-only.
// Assim, toda tool passa pelo RBAC + auditoria da API (a IA nunca toca o banco direto).

const API_URL = process.env.MCP_API_URL ?? 'http://localhost:4001/api';
const EMAIL = process.env.MCP_SERVICE_EMAIL ?? 'mcp@marketing-os.local';
const PASSWORD = process.env.MCP_SERVICE_PASSWORD ?? 'mcp-service-12345';

let token: string | null = null;

async function login(): Promise<void> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`Login do MCP (conta de serviço) falhou: HTTP ${res.status}`);
  }
  const data = (await res.json()) as { token: string };
  token = data.token;
}

export async function apiGet<T = unknown>(path: string): Promise<T> {
  if (!token) await login();
  let res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    await login();
    res = await fetch(`${API_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${path} → HTTP ${res.status} ${body}`);
  }
  return res.json() as Promise<T>;
}

export function qs(params: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}
