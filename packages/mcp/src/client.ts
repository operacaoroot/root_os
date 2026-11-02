// Cliente da API do ROOT OS para o MCP, com DUAS identidades:
//  - a conta de SERVIÇO (`ia_servico`, só leitura): as 35 ferramentas de consulta, como sempre;
//  - o OPERADOR (uma pessoa, com e-mail e senha do OS): as ferramentas que escrevem em nome de gente,
//    como a bancada da área do cliente, cujas rotas recusam conta de máquina (`SoGenteGuard`).
// As duas passam pela API (RBAC, porta, auditoria). A IA nunca toca o banco direto.
// Segredos vêm do ambiente ou de `~/.config/root/mcp.env` (ver env.ts); nenhum default de senha no código.
import { carregarEnvDoOperador } from './env.js';

const carga = carregarEnvDoOperador();
if (carga.arquivo) console.error(`[root-os-mcp] variáveis lidas de ${carga.arquivo}: ${carga.chaves.join(', ') || '(nenhuma nova)'}`);

const API_URL = process.env.MCP_API_URL ?? 'http://localhost:4001/api';
const EMAIL = process.env.MCP_SERVICE_EMAIL ?? 'mcp@marketing-os.local';
// Sem senha default (constituição): falha claro se a env não vier.
const PASSWORD = process.env.MCP_SERVICE_PASSWORD;
if (!PASSWORD) {
  throw new Error('MCP_SERVICE_PASSWORD ausente — defina a senha da conta de serviço do MCP (sem default no código).');
}

type Metodo = 'GET' | 'PUT' | 'POST';
export interface ClienteDaApi {
  rotulo: string;
  get<T = unknown>(path: string): Promise<T>;
  put<T = unknown>(path: string, body: unknown): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
}

function criarCliente(rotulo: string, email: string, senha: string): ClienteDaApi {
  let token: string | null = null;
  async function login(): Promise<void> {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: senha }),
    });
    if (!res.ok) throw new Error(`Login do MCP (${rotulo}) falhou: HTTP ${res.status}`);
    const data = (await res.json()) as { token: string };
    token = data.token;
  }
  async function chamar<T>(metodo: Metodo, path: string, body?: unknown): Promise<T> {
    if (!token) await login();
    const pedir = () =>
      fetch(`${API_URL}${path}`, {
        method: metodo,
        headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    let res = await pedir();
    if (res.status === 401) {
      await login();
      res = await pedir();
    }
    if (!res.ok) {
      const texto = await res.text().catch(() => '');
      throw new Error(`API ${metodo} ${path} → HTTP ${res.status} ${texto}`);
    }
    return res.json() as Promise<T>;
  }
  return {
    rotulo,
    get: (path) => chamar('GET', path),
    put: (path, body) => chamar('PUT', path, body),
    post: (path, body) => chamar('POST', path, body),
  };
}

const servico = criarCliente('conta de serviço', EMAIL, PASSWORD);

/** Leitura com a conta de serviço (as 35 ferramentas de consulta). */
export async function apiGet<T = unknown>(path: string): Promise<T> {
  return servico.get<T>(path);
}

export const RECUSA_SEM_OPERADOR =
  'Identidade do operador ausente: defina MCP_OPERADOR_EMAIL e MCP_OPERADOR_SENHA (no ambiente ou em ~/.config/root/mcp.env). ' +
  'As ferramentas da área do cliente escrevem em nome de uma PESSOA do ROOT OS, nunca da conta de serviço.';

let operadorCache: ClienteDaApi | null = null;
/** O cliente em nome do operador (gente). Lança com a frase do que configurar quando não há identidade. */
export function operador(): ClienteDaApi {
  if (operadorCache) return operadorCache;
  const email = process.env.MCP_OPERADOR_EMAIL;
  const senha = process.env.MCP_OPERADOR_SENHA;
  if (!email || !senha) throw new Error(RECUSA_SEM_OPERADOR);
  operadorCache = criarCliente(`operador ${email}`, email, senha);
  return operadorCache;
}

export function temOperador(): boolean {
  return Boolean(process.env.MCP_OPERADOR_EMAIL && process.env.MCP_OPERADOR_SENHA);
}

export function qs(params: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}
