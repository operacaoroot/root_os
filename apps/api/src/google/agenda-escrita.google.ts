import type { Efeito } from '../gateway/efeitos.registry';
import type { ChamadorDaAgenda } from './agenda-espelho.google';

/*
 * A ESCRITA DA AGENDA NO GOOGLE (agenda v2, 29/10/2026, lane G4).
 *
 * Os efeitos de `agenda.reuniao.marcar` (que muda de casa: sai do
 * `google.service.ts`), `agenda.reuniao.alterar`, `agenda.reuniao.cancelar`,
 * `agenda.reuniao.desmarcar` e `agenda.reuniao.reabrir`. Cada um confere o evento
 * de agora contra o que a pessoa viu antes de escrever, escreve com
 * `sendUpdates=all` e devolve o evento como o Google o gravou. Nunca apaga.
 *
 * O ARQUIVO NÃO IMPORTA O CONECTOR (catraca de arquitetura): o `GoogleService`
 * importa ESTE arquivo e se passa como `ChamadorDaAgenda` na inscrição dos
 * efeitos. As entradas daqui vêm DEPOIS das do conector no registro, então uma
 * chave igual (o `agenda.reuniao.marcar` de hoje) passa a valer a daqui.
 *
 * ESQUELETO DA LANE 0: a lane G4 implementa os efeitos.
 */
export function efeitosDaEscritaDaAgenda(google: ChamadorDaAgenda): Record<string, Efeito> {
  void google;
  return {};
}
