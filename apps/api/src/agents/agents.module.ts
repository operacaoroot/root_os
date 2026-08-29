import { Module } from '@nestjs/common';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { AgentRuntime } from './agent-runtime.service';
import { SessionService } from './session.service';
import { ContextBuilder } from './context-builder.service';
import { EfeitosService } from './efeitos.service';
import { ObsidianModule } from '../obsidian/obsidian.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { FinanceModule } from '../finance/finance.module';
import { LeadsModule } from '../leads/leads.module';
import { TasksModule } from '../tasks/tasks.module';
import { CampaignsModule } from '../campaigns/campaigns.module';

@Module({
  imports: [
    ObsidianModule,
    DashboardModule,
    FinanceModule,
    LeadsModule,
    TasksModule,
    CampaignsModule,
  ],
  controllers: [AgentsController],
  providers: [AgentsService, AgentRuntime, SessionService, ContextBuilder, EfeitosService],
  exports: [AgentsService, AgentRuntime, SessionService],
})
export class AgentsModule {}
