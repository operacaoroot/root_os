import { Module } from '@nestjs/common';

import { EspelhoDaAgendaModule } from '../espelho/espelho.module';
import { BuscaDaAgendaController } from './busca.controller';
import { BuscaDaAgendaService } from './busca.service';

/**
 * A busca do cliente no painel de marcar: Funil e Clientes, com a ficha (lane G3).
 * A contagem "quantas vezes esteve na agenda" lê a tabela do espelho
 * (`AgendaEvento`) direto, só para contar.
 */
@Module({
  imports: [EspelhoDaAgendaModule],
  controllers: [BuscaDaAgendaController],
  providers: [BuscaDaAgendaService],
  exports: [BuscaDaAgendaService],
})
export class BuscaDaAgendaModule {}
