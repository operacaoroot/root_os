export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4001/api';

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || body.error || `Erro ${res.status}`);
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
