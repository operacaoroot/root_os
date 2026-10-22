import { Injectable } from '@nestjs/common';

/** O vínculo com lead e cliente: casamento, sugestão, manual, lead e ficha (W3) (produção 22C, lane C). Esqueleto do contrato: a lane C preenche. */
@Injectable()
export class VinculoDoWhatsappService {
  /**
   * CONTRATO (chamado pelo gravador e pela sincronização, lane A, depois de
   * criar ou atualizar uma conversa): casa a conversa sozinha (1:1 pelo
   * telefone; grupo pelo nome vira SUGESTÃO, nunca vínculo sem clique; equipe
   * pelo nome) e propaga o vínculo às mensagens. Nunca desfaz vínculo manual.
   * Idempotente; nunca lança.
   */
  async casarConversa(_orgId: string, _conversaId: string): Promise<void> {}
}
