import { Injectable, NotImplementedException } from '@nestjs/common';
import type { EstadoDaSincronia, EventoDaAgenda, RespostaDoEspelho } from '@mktos/shared';

/*
 * O ESPELHO DA AGENDA (agenda v2, 29/10/2026, lane G1, decisão 1).
 *
 * Cópia SÓ DE LEITURA da agenda do Google da casa (`AgendaEvento`), atualizada
 * pela rotina `agenda.sincronizar` (a cada 2 min, empresa da casa, leitura R0
 * pela porta). Ninguém a edita: a escrita vai ao Google pela porta e volta por
 * aqui (`refletir` logo depois da escrita, a sincronia em seguida).
 *
 * ESQUELETO DA LANE 0 — o contrato que as outras lanes chamam:
 *   · `periodo` (tela, régua, conflitos, link público, cartão da implantação);
 *   · `estado` (o selo "sincronizado há N s");
 *   · `refletir` (a escrita põe o evento no espelho sem esperar a rotina).
 */
@Injectable()
export class EspelhoService {
  /** Os eventos do intervalo. Espelho atrasado (> 10 min) = leitura direta do Google, com `fonte: google`. */
  async periodo(orgId: string, de: Date, ate: Date, opcoes: { incluirCancelados?: boolean } = {}): Promise<RespostaDoEspelho> {
    void orgId; void de; void ate; void opcoes;
    throw new NotImplementedException('Espelho da agenda: lane G1.');
  }

  async estado(orgId: string, agora?: Date): Promise<EstadoDaSincronia> {
    void orgId; void agora;
    throw new NotImplementedException('Espelho da agenda: lane G1.');
  }

  /** Grava no espelho o evento como o Google o devolveu (o corpo cru de `events.insert/patch/get`). */
  async refletir(orgId: string, eventoDoGoogle: unknown): Promise<EventoDaAgenda | null> {
    void orgId; void eventoDoGoogle;
    throw new NotImplementedException('Espelho da agenda: lane G1.');
  }
}
