import {
  TOTEM_CABECALHO_TOKEN,
  TotemCatalogoSchema,
  type TotemCatalogo,
  type TotemEventoQuiosque,
} from '@mktos/shared';

import { API_BASE, ErroDaApi, erroDaResposta } from '@/lib/api';
import { CODIGO_SEM_REDE, totemApi } from '@/lib/totem/api-publica';
import type { Armazem } from './armazem';

/*
 * A SINCRONIA DO QUIOSQUE com `/api/totem-publico`.
 *
 * O catálogo tem `fetch` próprio porque o cliente comum trata 304 como erro: o
 * aparelho manda a versão que tem em `If-None-Match` e, se nada mudou, a API
 * responde 304 sem corpo. Resposta que não passa no schema é descartada e o
 * catálogo guardado continua valendo.
 */

/** Sobe junto com `VERSAO` de `public/totem/sw.js` quando o quiosque muda. */
export const TOTEM_VERSAO_DO_QUIOSQUE = '1.0.0';

const CHAVE_CATALOGO = 'totem.catalogo';
const TEMPO_LIMITE_MS = 20_000;

export interface CatalogoGuardado {
  catalogo: TotemCatalogo;
  sincronizadoEm: string;
}

export type ResultadoDoCatalogo = { mudou: true; catalogo: TotemCatalogo } | { mudou: false };

export async function baixarCatalogo(
  token: string,
  versaoAtual: string | null,
  base: string = API_BASE,
): Promise<ResultadoDoCatalogo> {
  const cabecalhos: Record<string, string> = { [TOTEM_CABECALHO_TOKEN]: token };
  if (versaoAtual) cabecalhos['If-None-Match'] = `"${versaoAtual}"`;
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), TEMPO_LIMITE_MS);
  let res: Response;
  try {
    res = await fetch(`${base}/totem-publico/catalogo`, {
      headers: cabecalhos,
      cache: 'no-store',
      credentials: 'omit',
      signal: controle.signal,
    });
  } catch {
    throw new ErroDaApi('Sem conexão com a internet.', 0, CODIGO_SEM_REDE);
  } finally {
    clearTimeout(relogio);
  }
  if (res.status === 304) return { mudou: false };
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw erroDaResposta(body as Record<string, unknown>, res.status);
  }
  const lido = TotemCatalogoSchema.safeParse(await res.json().catch(() => null));
  if (!lido.success) throw new ErroDaApi('O catálogo chegou incompleto.', res.status, 'catalogo_invalido');
  if (versaoAtual && lido.data.versao === versaoAtual) return { mudou: false };
  return { mudou: true, catalogo: lido.data };
}

export function enviarBatimento(token: string, catalogoVersao: string | null): Promise<void> {
  return totemApi<void>('/totem-publico/batimento', {
    credencial: { token },
    corpo: { versaoApp: TOTEM_VERSAO_DO_QUIOSQUE, catalogoVersao },
  });
}

export function enviarEventos(token: string) {
  return async (eventos: TotemEventoQuiosque[]): Promise<void> => {
    await totemApi<{ recebidos: number }>('/totem-publico/eventos', { credencial: { token }, corpo: { eventos } });
  };
}

export async function lerCatalogoGuardado(armazem: Armazem): Promise<CatalogoGuardado | null> {
  const bruto = await armazem.ler<CatalogoGuardado>(CHAVE_CATALOGO).catch(() => undefined);
  if (!bruto || typeof bruto.sincronizadoEm !== 'string') return null;
  const lido = TotemCatalogoSchema.safeParse(bruto.catalogo);
  return lido.success ? { catalogo: lido.data, sincronizadoEm: bruto.sincronizadoEm } : null;
}

export async function guardarCatalogo(armazem: Armazem, guardado: CatalogoGuardado): Promise<void> {
  await armazem.gravar(CHAVE_CATALOGO, guardado).catch(() => undefined);
}

export async function esquecerCatalogo(armazem: Armazem): Promise<void> {
  await armazem.apagar(CHAVE_CATALOGO).catch(() => undefined);
}
