import { Module } from '@nestjs/common';
import { WorkModule } from '../work/work.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { DashboardModule } from '../dashboard/dashboard.module';
import { FunnelModule } from '../funnel/funnel.module';
import { EventsModule } from '../events/events.module';
import { TasksModule } from '../tasks/tasks.module';
import { CampaignsModule } from '../campaigns/campaigns.module';

// Reusa os services já existentes (mesma fonte de números do dashboard/painéis).
// O LLM_PROVIDER vem do LlmModule (global).
@Module({
  imports: [WorkModule, DashboardModule, FunnelModule, EventsModule, TasksModule, CampaignsModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
