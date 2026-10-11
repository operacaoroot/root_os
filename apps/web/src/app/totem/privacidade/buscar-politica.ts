import {
  TotemCodigoEtiquetaSchema,
  TotemTokenSchema,
  totemMontarPolitica,
  type TotemPolitica,
  type TotemPoliticaResposta,
} from '@mktos/shared';
import { totemApi, type TotemCredencial } from '@/lib/totem/api-publica';

/*
 * De onde vem o texto da política que a tela mostra (frente D).
 *
 * Com credencial e rede, a API devolve o texto preenchido com os dados da
 * empresa. Sem credencial, sem rede ou com qualquer recusa, a tela monta o
 * mesmo texto aqui, com os dados da empresa marcados "(a confirmar)": a
 * política nunca fica em branco, porque é ela que a pessoa aceita no cadastro.
 */

/** Onde o quiosque guarda o token do aparelho no `localStorage`. */
export const TOTEM_CHAVE_TOKEN_LOCAL = 'totem.token';

export interface PoliticaNaTela {
  politica: TotemPolitica;
  /** `empresa`: preenchida pela API. `base`: montada no aparelho, sem os dados da empresa. */
  fonte: 'empresa' | 'base';
}

/** O código da etiqueta (`?e=`) vale mais que o token guardado; fora do formato, nenhum dos dois. */
export function credencialDaPagina(
  etiqueta: string | null | undefined,
  tokenGuardado: string | null | undefined,
): TotemCredencial | null {
  const e = TotemCodigoEtiquetaSchema.safeParse(etiqueta ?? undefined);
  if (e.success) return { etiqueta: e.data };
  const t = TotemTokenSchema.safeParse(tokenGuardado ?? undefined);
  if (t.success) return { token: t.data };
  return null;
}

export function lerTokenGuardado(): string | null {
  try {
    return window.localStorage.getItem(TOTEM_CHAVE_TOKEN_LOCAL);
  } catch {
    return null;
  }
}

export async function buscarPolitica(credencial: TotemCredencial | null): Promise<PoliticaNaTela> {
  if (!credencial) return { politica: totemMontarPolitica(), fonte: 'base' };
  try {
    const politica = await totemApi<TotemPoliticaResposta>('/totem-cadastro/politica', {
      credencial,
      tempoLimiteMs: 8000,
    });
    return { politica, fonte: 'empresa' };
  } catch {
    return { politica: totemMontarPolitica(), fonte: 'base' };
  }
}
