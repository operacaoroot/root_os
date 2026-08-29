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

/**
 * POST que responde `text/event-stream`, lido pedaço a pedaço.
 *
 * `fetch` + ReadableStream, e não `EventSource`: o EventSource não manda
 * header, e token em query string é dado sensível dentro de URL — que fica em
 * log de proxy, em histórico e no Referer.
 *
 * Devolve uma função de cancelamento: sair da tela no meio de uma resposta
 * precisa abortar a requisição, senão o laço do agente continua rodando (e
 * gastando) para ninguém.
 */
export function apiStream<E>(
  path: string,
  body: unknown,
  token: string | null | undefined,
  onEvento: (e: E) => void,
): { pronto: Promise<void>; cancelar: () => void } {
  const ctrl = new AbortController();

  const pronto = (async () => {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) {
      const erro = await res.json().catch(() => ({}));
      throw new Error(erro.message || erro.error || `Erro ${res.status}`);
    }

    const leitor = res.body.getReader();
    const dec = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      buffer += dec.decode(value, { stream: true });
      // Um evento SSE termina em linha em branco. Sem esperar por ela, um
      // JSON partido no meio do chunk quebraria o parse.
      const partes = buffer.split('\n\n');
      buffer = partes.pop() ?? '';
      for (const p of partes) {
        const linha = p.split('\n').find((l) => l.startsWith('data: '));
        if (!linha) continue;
        try {
          onEvento(JSON.parse(linha.slice(6)) as E);
        } catch {
          /* evento malformado não derruba o stream */
        }
      }
    }
  })();

  return { pronto, cancelar: () => ctrl.abort() };
}
