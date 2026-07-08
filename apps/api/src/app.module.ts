import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { DashboardModule } from './dashboard/dashboard.module';
import { LeadsModule } from './leads/leads.module';
import { EventsModule } from './events/events.module';
import { FunnelModule } from './funnel/funnel.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { TasksModule } from './tasks/tasks.module';
import { LlmModule } from './llm/llm.module';
import { ReportsModule } from './reports/reports.module';
import { UsersModule } from './users/users.module';
import { AppConfigModule } from './config/config.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { ContentModule } from './content/content.module';
import { ObsidianModule } from './obsidian/obsidian.module';
import { GoogleModule } from './google/google.module';
import { FinanceModule } from './finance/finance.module';
import { MetaModule } from './meta/meta.module';
import { GoalsModule } from './goals/goals.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuditModule,
    AuthModule,
    DashboardModule,
    LeadsModule,
    EventsModule,
    FunnelModule,
    CampaignsModule,
    TasksModule,
    LlmModule,
    ReportsModule,
    UsersModule,
    AppConfigModule,
    IntegrationsModule,
    ContentModule,
    ObsidianModule,
    GoogleModule,
    FinanceModule,
    MetaModule,
    GoalsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
