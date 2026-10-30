import { Global, Module } from '@nestjs/common';

import { RoutinesModule } from '../../routines/routines.module';
import { StorageModule } from '../../storage/storage.module';
import { CopiaDaAgendaService } from './copia-da-agenda.service';
import { EspelhoController } from './espelho.controller';
import { ExecutorDoEspelhoDaAgenda } from './espelho.executor';
import { EspelhoService } from './espelho.service';

/**
 * O espelho, a rotina `agenda.sincronizar` e a cópia diária (lanes G1 e G7).
 *
 * GLOBAL de propósito: o cartão da implantação (`implantacao/`) também lê do
 * espelho, e o `EspelhoService` só depende de coisas globais (a porta, os
 * interruptores, o contrato de conector, o Prisma). Continua importado pelo
 * `AgendaModule`, que é quem o põe no grafo.
 */
@Global()
@Module({
  imports: [RoutinesModule, StorageModule],
  controllers: [EspelhoController],
  providers: [EspelhoService, CopiaDaAgendaService, ExecutorDoEspelhoDaAgenda],
  exports: [EspelhoService],
})
export class EspelhoDaAgendaModule {}
