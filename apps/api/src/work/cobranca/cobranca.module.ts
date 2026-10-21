import { Module } from '@nestjs/common';

import { AuditModule } from '../../audit/audit.module';
import { MemoryModule } from '../../memory/memoria.module';
import { RoutinesModule } from '../../routines/routines.module';
import { CobrancaDeTarefasService } from './cobranca.service';

/**
 * TR-07 · O COBRADOR DE TAREFAS (rodada dos agentes, 21/10/2026).
 *
 * Um provider só, que se inscreve no registro de executores de rotina
 * (`trabalho.cobranca`) e no registro de pendências (`tarefa.cobranca`). As
 * pendências (`PendenciasModule`) e o modelo (`LlmModule`) são globais.
 *
 * SEM A LINHA NO `AppModule`, a rotina aparece em /rotinas "sem executor" e
 * nunca dispara; responder a pendência não tem tratador (só registra a escolha).
 */
@Module({
  imports: [RoutinesModule, MemoryModule, AuditModule],
  providers: [CobrancaDeTarefasService],
})
export class CobrancaDeTarefasModule {}
