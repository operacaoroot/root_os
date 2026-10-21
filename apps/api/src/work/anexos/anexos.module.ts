import { Module } from '@nestjs/common';

import { StorageModule } from '../../storage/storage.module';
import { AnexosDaTarefaController } from './anexos.controller';
import { AnexosDaTarefaService } from './anexos.service';

/**
 * O anexo na tarefa (rodada dos agentes, TR-06). O arquivista vem do
 * `ClientesModule` (`@Global`), pela porta `ARQUIVISTA_DO_CLIENTE`.
 * SEM A LINHA NO `AppModule`, as rotas de anexo respondem 404 e nada acusa.
 */
@Module({
  imports: [StorageModule],
  controllers: [AnexosDaTarefaController],
  providers: [AnexosDaTarefaService],
  exports: [AnexosDaTarefaService],
})
export class AnexosDaTarefaModule {}
