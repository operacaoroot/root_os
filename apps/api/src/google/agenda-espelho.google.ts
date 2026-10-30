import type { Efeito } from '../gateway/efeitos.registry';

/*
 * A LEITURA DO ESPELHO DA AGENDA NO GOOGLE (agenda v2, 29/10/2026, lane G1).
 *
 * Os dois efeitos R0 que a rotina `agenda.sincronizar` pede pela porta:
 *   · `comunicacao.agenda.sincronizar` — `events.list` com `syncToken` (410 =
 *     o token venceu, a sincronia refaz a janela de -30 a +180 dias);
 *   · `comunicacao.agenda.livre_ocupado` — `freeBusy.query` das agendas pessoais
 *     dos sócios (decisão 3): só começo e fim, nunca título.
 * Só LÊ.
 *
 * O ARQUIVO NÃO IMPORTA O CONECTOR (catraca de arquitetura): o `GoogleService`
 * importa ESTE arquivo e se passa como `ChamadorDaAgenda` na inscrição dos
 * efeitos. O HTTP continua lá, em `chamarAgenda` (destino fixo, só `/calendar/v3/`).
 *
 * ESQUELETO DA LANE 0: a lane G1 implementa os efeitos.
 */

/** O pedaço do conector que a agenda usa: uma chamada autenticada ao Calendar. */
export interface ChamadorDaAgenda {
  chamarAgenda<T = unknown>(orgId: string, caminho: string, init?: RequestInit): Promise<T>;
}

export function efeitosDaLeituraDaAgenda(google: ChamadorDaAgenda): Record<string, Efeito> {
  void google;
  return {};
}
