// Cliente da API do Marketing OS para o MCP.
// Autentica com a conta de SERVIÇO (só-leitura) e chama endpoints read-only.
// Assim, toda tool passa pelo RBAC + auditoria da API (a IA nunca toca o banco direto).

const API_URL = process.env.MCP_API_URL ?? 'http://localhost:4001/api';
const EMAIL = process.env.MCP_SERVICE_EMAIL ?? 'mcp@marketing-os.local';
// Sem senha default (constituição): falha claro se a env não vier.
const PASSWORD = process.env.MCP_SERVICE_PASSWORD;

/**
 * O modo de sempre (35 ferramentas de leitura) não sobe sem a senha da conta de
 * serviço. Até 30/10/2026 isto lançava no IMPORT deste arquivo; com o modo
 * catálogo (A3), que entra com o token do corpo e não usa a conta de serviço, a
 * conferência passou a ser chamada por `index.ts` antes de subir o modo de
 * sempre — o efeito para ele é o mesmo: o processo morre no arranque, com a frase.
 */
export function exigirSenhaDaContaDeServico(): void {
  if (!PASSWORD) {
    throw new Error('MCP_SERVICE_PASSWORD ausente — defina a senha da conta de serviço do MCP (sem default no código).');
  }
}

let token: string | null = null;

async function login(): Promise<void> {
  exigirSenhaDaContaDeServico();
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

/* ==========================================================================
 * O MODO CATÁLOGO (A3, 30/10/2026): o corpo de um agente externo
 * ==========================================================================
 *
 * Entra com o TOKEN DO CORPO (`MCP_CORPO_TOKEN`, criado em
 * `POST /agents/:slug/corpos` por quem tem `admin.usuarios`), não com a conta de
 * serviço. O token já diz a empresa, o agente e a pessoa padrão; a API só deixa
 * ele (1) ler pelas rotas GET das capacidades R0 que o agente declarou e (2)
 * chamar a rota de execução do agente, que passa pela porta. Este cliente não
 * tem outro caminho: os dois verbos abaixo são os únicos.
 */
const CORPO_TOKEN = process.env.MCP_CORPO_TOKEN;

export function exigirTokenDoCorpo(): string {
  if (!CORPO_TOKEN || !CORPO_TOKEN.startsWith('rcx.')) {
    throw new Error('MCP_CORPO_TOKEN ausente ou fora do formato rcx.<empresa>.<segredo> — o modo catálogo entra só com o token do corpo.');
  }
  return CORPO_TOKEN;
}

async function doCorpo<T>(metodo: 'GET' | 'POST', path: string, corpo?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${exigirTokenDoCorpo()}`,
      ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(corpo !== undefined ? { body: JSON.stringify(corpo) } : {}),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API ${metodo} ${path} → HTTP ${res.status} ${body}`);
  }
  return res.json() as Promise<T>;
}

/** Leitura com o token do corpo: só passa a rota GET de uma capacidade R0 declarada. */
export function corpoGet<T = unknown>(path: string): Promise<T> {
  return doCorpo<T>('GET', path);
}

/** A rota de execução do agente (A2): a única escrita, e ela passa pela porta. */
export function corpoExecutar<T = unknown>(slug: string, capacidade: string, corpo: unknown): Promise<T> {
  return doCorpo<T>('POST', `/agents/${encodeURIComponent(slug)}/capacidades/${encodeURIComponent(capacidade)}/executar`, corpo);
}
