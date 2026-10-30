import type { EstadoDaSincronia, RegrasDaAgenda, RespostaDosConflitos } from '@mktos/shared';
import { apiGet } from '@/lib/api';

import type { EventoDaAgenda as EventoDoGoogle } from './tipos';
import { doGoogleParaV2, ehRespostaDoEspelho, type EventoV2 } from './v2';

/*
 * A LEITURA DA AGENDA V2 (29/10/2026, lane G3).
 *
 * Primeiro o espelho (`GET /agenda/espelho?de=&ate=`, lane G1). Se ele falhar
 * (o esqueleto responde 501) ou vier noutra forma, a tela cai na leitura de
 * hoje (`GET /google/calendar/periodo`) e a adapta com a mesma gramática, com o
 * aviso "sem espelho: lendo direto do Google". Se as duas falharem, o erro é o
 * da leitura direta (é a que diz "conecte o Google").
 */

export interface PeriodoLido {
  eventos: EventoV2[];
  sincronia: EstadoDaSincronia | null;
  /** `espelho`; `google` = o espelho atrasado leu direto; `direto` = sem espelho, a leitura de hoje. */
  fonte: 'espelho' | 'google' | 'direto';
}

const intervalo = (de: Date, ate: Date) => `de=${encodeURIComponent(de.toISOString())}&ate=${encodeURIComponent(ate.toISOString())}`;

export async function lerPeriodo(token: string, de: Date, ate: Date, feriados: readonly string[] = []): Promise<PeriodoLido> {
  try {
    const r = await apiGet<unknown>(`/agenda/espelho?${intervalo(de, ate)}`, token);
    if (ehRespostaDoEspelho(r)) return { eventos: r.eventos, sincronia: r.sincronia, fonte: r.fonte };
  } catch {
    /* cai na leitura direta abaixo */
  }
  const lista = await apiGet<EventoDoGoogle[]>(`/google/calendar/periodo?${intervalo(de, ate)}`, token);
  return { eventos: (Array.isArray(lista) ? lista : []).map((e) => doGoogleParaV2(e, feriados)), sincronia: null, fonte: 'direto' };
}

/** As regras (lane G2); erro = sem regras (o semáforo usa o que tiver). */
export async function lerRegras(token: string): Promise<RegrasDaAgenda | null> {
  try {
    const r = await apiGet<RegrasDaAgenda>('/agenda/regras', token);
    return r && Array.isArray(r.pessoas) && Array.isArray(r.ritos) && Array.isArray(r.feriados) ? r : null;
  } catch {
    return null;
  }
}

/** Quantos conflitos abertos (o número da aba). Erro = sem número. */
export async function lerQuantosConflitos(token: string): Promise<number | null> {
  try {
    const r = await apiGet<RespostaDosConflitos>('/agenda/conflitos', token);
    if (!r || !Array.isArray(r.cartoes)) return null;
    return r.cartoes.filter((c) => !c.confirmado).length;
  } catch {
    return null;
  }
}
