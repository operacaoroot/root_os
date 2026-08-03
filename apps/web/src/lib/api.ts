// Default relativo (/api) → o Next faz proxy p/ a API (ver next.config.mjs).
// Funciona em localhost, LAN e túnel, sem CORS nem URL fixa no build.
export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? '/api';

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // O ZodExceptionFilter responde {error:'ValidationError', issues:[{path,message}]}
    // e NÃO manda `message` — sem desdobrar o issues a tela mostrava só o rótulo
    // genérico, escondendo qual campo reprovou.
    const issues: string = Array.isArray(body.issues)
      ? body.issues
          .map((i: { path?: string; message?: string }) =>
            [i.path, i.message].filter(Boolean).join(': '),
          )
          .filter(Boolean)
          .join(' · ')
      : '';
    throw new Error(issues || body.message || body.error || `Erro ${res.status}`);
  }
  return res.json();
}

export function apiGet<T>(path: string, token?: string | null): Promise<T> {
  return fetch(`${API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: 'no-store',
  }).then((r) => handle<T>(r));
}

export function apiPost<T>(
  path: string,
  body: unknown,
  token?: string | null,
): Promise<T> {
  return fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  }).then((r) => handle<T>(r));
}

/**
 * Upload de arquivo. Sem `Content-Type` de propósito: o browser precisa montar
 * o boundary do multipart sozinho — definir o header à mão quebra o parse.
 */
export function apiUpload<T>(
  path: string,
  arquivo: File,
  token?: string | null,
  campo = 'file',
): Promise<T> {
  const form = new FormData();
  form.append(campo, arquivo);
  return fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  }).then((r) => handle<T>(r));
}

export function apiPatch<T>(
  path: string,
  body: unknown,
  token?: string | null,
): Promise<T> {
  return fetch(`${API_BASE}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  }).then((r) => handle<T>(r));
}

export function apiDelete<T>(path: string, token?: string | null): Promise<T> {
  return fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  }).then((r) => handle<T>(r));
}

export function apiPut<T>(
  path: string,
  body: unknown,
  token?: string | null,
): Promise<T> {
  return fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  }).then((r) => handle<T>(r));
}
