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

type Metodo = 'GET' | 'PUT' | 'POST' | 'PATCH' | 'DELETE';
export interface ArquivoParaEnviar { caminho: string; campo?: string; campos?: Record<string, string> }
export interface ArquivoBaixado { bytes: Buffer; tipo: string | null; nome: string | null }
export interface ClienteDaApi {
  rotulo: string;
  get<T = unknown>(path: string): Promise<T>;
  put<T = unknown>(path: string, body: unknown): Promise<T>;
  post<T = unknown>(path: string, body?: unknown): Promise<T>;
  patch<T = unknown>(path: string, body: unknown): Promise<T>;
  delete<T = unknown>(path: string, body?: unknown): Promise<T>;
  /** Chamada genérica: devolve JSON quando a resposta é JSON, senão `{ texto }`. */
  chamar<T = unknown>(metodo: Metodo, path: string, body?: unknown): Promise<T>;
  /** multipart/form-data: o arquivo no campo (padrão `file`) mais os campos de texto. */
  enviarArquivo<T = unknown>(path: string, arquivo: ArquivoParaEnviar): Promise<T>;
  /** GET que devolve bytes (PDF, imagem, áudio). */
  baixar(path: string): Promise<ArquivoBaixado>;
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
  async function comSessao(pedir: () => Promise<Response>): Promise<Response> {
    if (!token) await login();
    let res = await pedir();
    if (res.status === 401) {
      await login();
      res = await pedir();
    }
    return res;
  }
  async function recusa(metodo: string, path: string, res: Response): Promise<never> {
    const texto = await res.text().catch(() => '');
    throw new Error(`API ${metodo} ${path} → HTTP ${res.status} ${texto.slice(0, 2000)}`);
  }
  async function chamar<T>(metodo: Metodo, path: string, body?: unknown): Promise<T> {
    const res = await comSessao(() =>
      fetch(`${API_URL}${path}`, {
        method: metodo,
        headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
    );
    if (!res.ok) return recusa(metodo, path, res);
    const tipo = res.headers.get('content-type') ?? '';
    if (tipo.includes('json')) return res.json() as Promise<T>;
    const texto = await res.text();
    return (texto ? { texto } : { ok: true }) as T;
  }
  async function enviarArquivo<T>(path: string, arquivo: ArquivoParaEnviar): Promise<T> {
    const { readFile } = await import('node:fs/promises');
    const { basename } = await import('node:path');
    const bytes = await readFile(arquivo.caminho);
    const nome = basename(arquivo.caminho);
    const res = await comSessao(() => {
      const fd = new FormData();
      fd.append(arquivo.campo ?? 'file', new Blob([bytes], { type: tipoPeloNome(nome) }), nome);
      for (const [k, v] of Object.entries(arquivo.campos ?? {})) fd.append(k, v);
      return fetch(`${API_URL}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd });
    });
    if (!res.ok) return recusa('POST', path, res);
    const tipo = res.headers.get('content-type') ?? '';
    return (tipo.includes('json') ? res.json() : res.text().then((t) => ({ texto: t }))) as Promise<T>;
  }
  async function baixar(path: string): Promise<ArquivoBaixado> {
    const res = await comSessao(() => fetch(`${API_URL}${path}`, { headers: { Authorization: `Bearer ${token}` } }));
    if (!res.ok) return recusa('GET', path, res);
    const cd = res.headers.get('content-disposition') ?? '';
    const nome = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd)?.[1] ?? null;
    return { bytes: Buffer.from(await res.arrayBuffer()), tipo: res.headers.get('content-type'), nome: nome ? decodeURIComponent(nome) : null };
  }
  return {
    rotulo,
    get: (path) => chamar('GET', path),
    put: (path, body) => chamar('PUT', path, body),
    post: (path, body) => chamar('POST', path, body),
    patch: (path, body) => chamar('PATCH', path, body),
    delete: (path, body) => chamar('DELETE', path, body),
    chamar,
    enviarArquivo,
    baixar,
  };
}

function tipoPeloNome(nome: string): string {
  const ext = nome.toLowerCase().split('.').pop() ?? '';
  return ({ pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', txt: 'text/plain', md: 'text/markdown', json: 'application/json', csv: 'text/csv', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } as Record<string, string>)[ext] ?? 'application/octet-stream';
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

/** Quem LÊ: o operador quando configurado (vê o que a pessoa vê), senão a conta de serviço. */
export function leitor(): ClienteDaApi {
  return temOperador() ? operador() : servico;
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
