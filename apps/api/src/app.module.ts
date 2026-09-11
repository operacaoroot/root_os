import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ContextoModule } from './common/contexto.module';
import { PrismaModule } from './prisma/prisma.module';
import { TenantsModule } from './tenants/tenants.module';
import { AuditModule } from './audit/audit.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { PolicyModule } from './policy/policy.module';
import { GatewayModule } from './gateway/gateway.module';
import { AgentsModule } from './agents/agents.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { DashboardModule } from './dashboard/dashboard.module';
import { LeadsModule } from './leads/leads.module';
import { EventsModule } from './events/events.module';
import { FunnelModule } from './funnel/funnel.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { TasksModule } from './tasks/tasks.module';
import { WorkModule } from './work/work.module';
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
import { BioModule } from './bio/bio.module';
import { PautaModule } from './pauta/pauta.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Tenant, ator e correlação em toda requisição (RF-T-04, RNF-09). Antes do
    // PrismaModule de propósito: o que abre o contexto tem de estar de pé antes
    // do que consulta o banco.
    ContextoModule,
    PrismaModule,
    // O gate de módulos por empresa (RF-T-06). DEPOIS do ContextoModule de
    // propósito: interceptor global registrado antes envolve o registrado
    // depois, então o gate roda com o tenant já resolvido no contexto. E antes
    // de todo módulo de domínio, porque é ele que decide se o domínio existe
    // para esta empresa.
    TenantsModule,
    AuditModule,
    // A régua carrega antes da porta, e a porta antes de qualquer módulo de
    // domínio: ADR-004 — nenhum agente alcança conector sem passar por ela.
    PolicyModule,
    ApprovalsModule,
    GatewayModule,
    AgentsModule,
    AuthModule,
    DashboardModule,
    LeadsModule,
    EventsModule,
    FunnelModule,
    CampaignsModule,
    TasksModule,
    WorkModule,
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
    BioModule,
    PautaModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
