import { Module } from '@nestjs/common';

import { EspelhoDaAgendaModule } from '../espelho/espelho.module';

/** A busca do cliente no painel de marcar: Funil e Clientes, com a ficha (lane G3). */
@Module({
  imports: [EspelhoDaAgendaModule],
})
export class BuscaDaAgendaModule {}
