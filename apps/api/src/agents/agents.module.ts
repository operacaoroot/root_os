import { ProcedimentoFerramentaLocalService } from './procedimento-ferramenta-local.service';
import { Module } from '@nestjs/common';
import { AgentsController } from './agents.controller';
import { AgendaLocalService } from './agenda-local.service';
import { AgentsService } from './agents.service';
import { AgentRuntime } from './agent-runtime.service';
import { SessionService } from './session.service';
import { ContextBuilder } from './context-builder.service';
import { VaultVersionadaService } from './vault-versionada.service';
import { EfeitosService } from './efeitos.service';
import { ObsidianModule } from '../obsidian/obsidian.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { FinanceModule } from '../finance/finance.module';
import { LeadsModule } from '../leads/leads.module';
import { TasksModule } from '../tasks/tasks.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { PautaModule } from '../pauta/pauta.module';
import { WorkModule } from '../work/work.module';
import { ModeloLocalService } from './modelo-local.service';
import { ProcedimentoDoAgenteService } from './procedimento-do-agente.service';

@Module({
  imports: [
    ObsidianModule,
    DashboardModule,
    FinanceModule,
    LeadsModule,
    TasksModule,
    CampaignsModule,
    PautaModule,
    /*
     * O CHECKOUT DE TAREFA (fatia A4): pausar ou encerrar um agente solta as
     * tarefas que ele tem na mão. A direção é agents → work porque quem conhece
     * `WorkTask` é o módulo de trabalho, e `WorkModule` não importa este — sem
     * ciclo. Ver o cabeçalho de `work/work.module.ts`.
     */
    WorkModule,
  ],
  controllers: [AgentsController],
  providers: [ProcedimentoFerramentaLocalService, AgendaLocalService, ModeloLocalService, ProcedimentoDoAgenteService, AgentsService, AgentRuntime, SessionService, ContextBuilder, VaultVersionadaService, EfeitosService],
  exports: [AgentsService, AgentRuntime, SessionService],
})
export class AgentsModule {}
