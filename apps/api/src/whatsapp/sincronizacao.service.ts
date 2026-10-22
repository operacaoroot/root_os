import { Injectable } from '@nestjs/common';

/** A rotina whatsapp.sincronizar: conversas, grupos e mensagens pela leitura da Evolution (W1) (produção 22C, lane A). Esqueleto do contrato: a lane A preenche. */
@Injectable()
export class SincronizacaoDoWhatsappService {
  /**
   * CONTRATO (chamado pela caixa, lane B, ao listar; e pelo gravador): semeia a
   * rotina `whatsapp.sincronizar` nesta empresa, só na empresa da casa, ligada,
   * a cada 5 min. Idempotente; nunca lança.
   */
  async garantirRotina(_orgId: string): Promise<void> {}
}
