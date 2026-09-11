import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ContextoModule } from './common/contexto.module';
import { PrismaModule } from './prisma/prisma.module';
import { TenantsModule } from './tenants/tenants.module';
import { AuditModule } from './audit/audit.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { PolicyModule } from './policy/policy.module';
import { GatewayModule } from './gateway/gateway.module';
import { CofreModule } from './cofre/cofre.module';
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
import { MemoryModule } from './memory/memoria.module';
import { RoutinesModule } from './routines/routines.module';

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
    // O COFRE (RF-C-01..RF-C-04). Aqui, e não mais tarde: `@Global()` só vale
    // depois de o módulo ser IMPORTADO uma vez — sem esta linha o marcador não
    // faz nada e nenhum módulo consegue injetar `CofreService`, nem hoje nem
    // depois. Foi o que deixou o cofre inalcançável na primeira entrega desta
    // fatia: código inteiro, correto e fora do alcance de qualquer chamador.
    // Depois da porta porque quem empresta credencial é quem já passou por ela;
    // antes de todo módulo de domínio porque `bio/`, `google/` e `integrations/`
    // o injetam.
    CofreModule,
    // A MEMÓRIA (RF-M-01, RF-M-06). Aqui, e não pendurada no conector da vault:
    // o Obsidian é uma FONTE da memória, não o dono dela, e o dia em que uma
    // segunda fonte existir (upload, resposta promovida a nota) a aresta
    // invertida ficaria estranha de ler. Depois do GatewayModule porque
    // `MemoriaService` injeta `EventLogService` — toda mudança da memória é um
    // evento do RASTRO, e as projeções vêm dele (ver `docs/adr/ADR-011-memoria.md`).
    // `ObsidianModule` continua importando este módulo, e precisa: `ObsidianService`
    // injeta `MemoriaService` para projetar a vault, e em Nest quem injeta importa.
    // As duas linhas não se duplicam — esta declara o DONO, a de lá declara USO.
    MemoryModule,
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
    // O RELÓGIO DO PRODUTO (RF-N-04). Depois do PautaModule porque o executor da
    // pauta precisa do `RodadaService` que aquele módulo exporta. Sem esta linha
    // NENHUMA rotina dispara — nem a da pauta —, e a API RECUSA SUBIR: a
    // sentinela em `pauta/scheduler.service.ts` lança no arranque, de propósito,
    // porque mudança de dono que falha em silêncio só aparece dias depois como
    // "a rodada parou sozinha". Para subir sem tique use `ROTINAS_CRON=off`, que
    // mantém o módulo montado.
    RoutinesModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
