import { Module } from '@nestjs/common';

import { AuditModule } from '../../audit/audit.module';
import { RoutinesModule } from '../../routines/routines.module';
import { WorkModule } from '../work.module';
import { AgenteDeTarefasService } from './agente-de-tarefas.service';
import { ResumoDoGrupoService } from './resumo-do-grupo.service';

/**
 * O agente de tarefas (TR-12): o pedido do grupo e o resumo das 07h e das 18h.
 * Módulo próprio, como a cobrança: o Trabalho não importa rotinas.
 */
@Module({
  imports: [WorkModule, RoutinesModule, AuditModule],
  providers: [AgenteDeTarefasService, ResumoDoGrupoService],
})
export class AgenteDeTarefasModule {}
