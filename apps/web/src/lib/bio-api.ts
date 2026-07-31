import type { BioPublicPage, BioTrackInput } from '@mktos/shared';

/**
 * A página pública é RSC: fala com a API server-to-server, por dentro da rede.
 * Não passa pelo rewrite /api do Next (que existe pro browser) nem carrega token
 * — os endpoints /bio/public/* são abertos por natureza.
 */
const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4001';

export async function buscarPaginaPublica(handle: string): Promise<BioPublicPage | null> {
  try {
    const res = await fetch(`${API}/api/bio/public/page/${encodeURIComponent(handle)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as BioPublicPage;
  } catch {
    return null;
  }
}

/** Fire-and-forget: a página responde antes do registro terminar. */
export function registrarPageview(input: BioTrackInput): void {
  void fetch(`${API}/api/bio/public/track`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    cache: 'no-store',
  }).catch(() => undefined);
}
