// Cliente da API do Marketing OS para o MCP.
// O modo padrão usa PAT individual de agente. O modo legado é opt-in explícito
// (`MCP_MODE=legacy`) e mantém a conta de serviço apenas para compatibilidade.

const MODE = process.env.MCP_MODE ?? 'memoria';
const API_URL = validarApiUrl(process.env.MCP_API_URL ?? 'http://localhost:4001/api');
const TIMEOUT_MS = timeoutMs(process.env.MCP_TIMEOUT_MS);
const AGENT_TOKEN = process.env.MCP_AGENT_TOKEN;
const EMAIL = process.env.MCP_SERVICE_EMAIL ?? 'mcp@marketing-os.local';
const PASSWORD = MODE === 'legacy' ? process.env.MCP_SERVICE_PASSWORD : undefined;
let legacyToken: string | null = null;

function validarApiUrl(valor: string): string {
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    throw new Error('MCP_API_URL inválida.');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  const testeOuDev = process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local && (testeOuDev || process.env.MCP_ALLOW_INSECURE_LOCAL === '1'))) {
    throw new Error('MCP_API_URL deve usar HTTPS; HTTP só é permitido explicitamente em localhost de teste/desenvolvimento.');
  }
  if (url.username || url.password || url.hash) throw new Error('MCP_API_URL não pode carregar credenciais ou fragmento.');
  return url.toString().replace(/\/$/, '');
}

function timeoutMs(valor: string | undefined): number {
  const numero = valor ? Number(valor) : 10_000;
  return Number.isFinite(numero) && numero >= 100 && numero <= 60_000 ? Math.floor(numero) : 10_000;
}

function mensagemDeErro(status: number): string {
  if (status === 401) return 'API recusou a credencial do agente.';
  if (status === 403) return 'API recusou o escopo da credencial do agente.';
  if (status === 404) return 'Recurso não encontrado ou não autorizado.';
  return `API recusou a requisição (HTTP ${status}).`;
}

type RespostaApi = { status: number; data: unknown };

async function requisicao(path: string, headers: Record<string, string>): Promise<RespostaApi> {
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  try {
    const resposta = await fetch(`${API_URL}${path}`, {
      headers,
      signal: controlador.signal,
      redirect: 'manual',
    });
    const texto = await resposta.text();
    let data: unknown = null;
    if (texto) {
      try {
        data = JSON.parse(texto) as unknown;
      } catch {
        throw new Error('API devolveu resposta inválida.');
      }
    }
    return { status: resposta.status, data };
  } catch (erro) {
    if ((erro as Error).name === 'AbortError') throw new Error('API excedeu o tempo limite.');
    if (erro instanceof Error && erro.message === 'API devolveu resposta inválida.') throw erro;
    throw new Error('Falha de comunicação com a API.');
  } finally {
    clearTimeout(timer);
  }
}

async function loginLegado(): Promise<void> {
  if (!PASSWORD) throw new Error('MCP_SERVICE_PASSWORD ausente no modo legado explícito.');
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  try {
    const resposta = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
      signal: controlador.signal,
      redirect: 'manual',
    });
    if (resposta.status >= 300 && resposta.status < 400) throw new Error('API redirecionou a autenticação.');
    const texto = await resposta.text();
    if (!resposta.ok) throw new Error(`Login legado recusado (HTTP ${resposta.status}).`);
    let data: { token?: string } = {};
    try {
      data = texto ? (JSON.parse(texto) as { token?: string }) : {};
    } catch {
      throw new Error('Login legado devolveu resposta inválida.');
    }
    if (!data.token) throw new Error('Login legado não devolveu credencial.');
    legacyToken = data.token;
  } catch (erro) {
    if ((erro as Error).name === 'AbortError') throw new Error('Login legado excedeu o tempo limite.');
    throw new Error((erro as Error).message || 'Login legado falhou.');
  } finally {
    clearTimeout(timer);
  }
}

async function apiGetInterno<T>(path: string, reautenticou: boolean): Promise<T> {
  if (MODE === 'legacy') {
    if (!legacyToken) await loginLegado();
    const resposta = await requisicao(path, { Authorization: `Bearer ${legacyToken}` });
    if (resposta.status >= 300 && resposta.status < 400) throw new Error('API redirecionou uma requisição autenticada.');
    if (resposta.status === 401 && !reautenticou) {
      legacyToken = null;
      await loginLegado();
      return apiGetInterno<T>(path, true);
    }
    if (resposta.status === 401) throw new Error(mensagemDeErro(resposta.status));
    if (resposta.status < 200 || resposta.status >= 300) throw new Error(mensagemDeErro(resposta.status));
    return resposta.data as T;
  }

  if (!AGENT_TOKEN) throw new Error('MCP_AGENT_TOKEN ausente; o cliente não faz login ou fallback.');
  const resposta = await requisicao(path, { Authorization: `Bearer ${AGENT_TOKEN}` });
  if (resposta.status >= 300 && resposta.status < 400) throw new Error('API redirecionou uma requisição autenticada.');
  if (resposta.status < 200 || resposta.status >= 300) throw new Error(mensagemDeErro(resposta.status));
  return resposta.data as T;
}

export async function apiGet<T = unknown>(path: string): Promise<T> {
  return apiGetInterno<T>(path, false);
}

export function qs(params: Record<string, string | number | boolean | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}
