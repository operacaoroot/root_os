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
import { BillingModule } from './billing/billing.module';
import { AgentsModule } from './agents/agents.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { AuthModule } from './auth/auth.module';
import { HealthController } from './health/health.controller';
import { DashboardModule } from './dashboard/dashboard.module';
import { LeadsModule } from './leads/leads.module';
import { EventsModule } from './events/events.module';
import { FunnelModule } from './funnel/funnel.module';
import { PainelComercialModule } from './painel-comercial/painel-comercial.module';
import { FichaModule } from './ficha/ficha.module';
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
import { CofreDaEmpresaModule } from './cofre-da-empresa/cofre-da-empresa.module';
import { MetaModule } from './meta/meta.module';
import { GoalsModule } from './goals/goals.module';
import { BioModule } from './bio/bio.module';
import { PautaModule } from './pauta/pauta.module';
import { MarketingPreparacaoModule } from './marketing-preparacao/marketing-preparacao.module';
import { MemoryModule } from './memory/memoria.module';
import { RoutinesModule } from './routines/routines.module';
import { PublicMapModule } from './public-map/public-map.module';
import { PlataformaModule } from './platform/plataforma.module';
import { LinhaDoTempoModule } from './linha-do-tempo/linha-do-tempo.module';
import { CaixaModule } from './caixa/caixa.module';

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
    // ASSINATURA, COBRANÇA E SUSPENSÃO (RF-O-03, fatia 6.2). Depois do
    // `CofreModule` porque a credencial de cobrança mora no cofre, por empresa —
    // e DEPOIS do `TenantsModule` de propósito: interceptor global registrado
    // antes envolve o registrado depois, então o gate de módulos decide primeiro
    // ("contratou este módulo?") e o gate de suspensão em seguida ("está em
    // dia?"). Nessa ordem, módulo não contratado responde 404 mesmo para empresa
    // suspensa, que é o certo: quem não contratou não precisa saber que a rota
    // existe.
    //
    // SEM ESTA LINHA o gate de suspensão não é instalado e `/assinatura` não
    // existe — a fatia inteira fica no repositório e fora do alcance de qualquer
    // requisição, que é como o cofre nasceu inalcançável na primeira entrega.
    BillingModule,
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
    // O DEGRAU DE ENTRADA (RF-O-01, RF-O-02, RF-M-05, fatia 6.1+4.5). Depois de
    // `AgentsModule` e `MemoryModule`, que ele injeta, e depois de `AuthModule`
    // por causa do `JwtAuthGuard` das rotas autenticadas — a de cadastro é
    // anônima de propósito, e por isso os guardas são declarados POR MÉTODO.
    //
    // SEM ESTA LINHA as cinco rotas de `/api/tenants/onboarding/*` respondem 404
    // e NADA ACUSA: o módulo inteiro fica no repositório, correto e fora do
    // alcance de qualquer requisição — foi assim que o cofre nasceu inalcançável
    // na fatia 5.3 e a memória ficou pendurada no conector do Obsidian na onda 9.
    // `test/onboarding.test.ts` cobra esta linha lendo os `imports` deste módulo.
    OnboardingModule,
    DashboardModule,
    LeadsModule,
    EventsModule,
    FunnelModule,
    PainelComercialModule,
    FichaModule,
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
    CofreDaEmpresaModule,
    MetaModule,
    GoalsModule,
    BioModule,
    PautaModule,
    MarketingPreparacaoModule,
    // O RELÓGIO DO PRODUTO (RF-N-04). Depois do PautaModule porque o executor da
    // pauta precisa do `RodadaService` que aquele módulo exporta. Sem esta linha
    // NENHUMA rotina dispara — nem a da pauta —, e a API RECUSA SUBIR: a
    // sentinela em `pauta/scheduler.service.ts` lança no arranque, de propósito,
    // porque mudança de dono que falha em silêncio só aparece dias depois como
    // "a rodada parou sozinha". Para subir sem tique use `ROTINAS_CRON=off`, que
    // mantém o módulo montado.
    RoutinesModule,
    // A ENTRADA PÚBLICA DO DOMÍNIO (fatia 6.5): o mapa da ROOT ao vivo, montado
    // só a partir das linhas que alguém marcou como públicas. Última porque não
    // injeta nenhum outro módulo — só o `PrismaService`, que é global. Sem esta
    // linha `GET /api/mapa-publico` responde 404 e a raiz do domínio mostra o
    // texto de venda sem mapa nenhum (ela degrada de propósito, mas degrada).
    PublicMapModule,
    // O CONSOLE DA PLATAFORMA (RF-B-02, fatia 6.3): saúde, uso e cobrança por
    // empresa, e o acesso de suporte que o CLIENTE autoriza. Depois do
    // `AuthModule` (de onde vêm `JwtAuthGuard` e o verificador de
    // reautenticação), do `GatewayModule` (o RASTRO) e do `TenantsModule` (o
    // gate de módulos). Sem esta linha as rotas de `/api/tenants/plataforma` e
    // `/api/tenants/suporte` respondem 404 — o console abre e não carrega, e o
    // cliente não tem onde autorizar nem onde revogar acesso de suporte.
    PlataformaModule,
    // A LINHA DO TEMPO (fatia A9): a leitura narrativa do RASTRO — o mesmo fato
    // que `/rastro` prova, contado em ordem, com ator e objeto legíveis. Última
    // porque só lê e não injeta módulo nenhum (`PrismaService` e
    // `EventLogService` são globais). Sem esta linha `GET /api/linha-do-tempo`
    // responde 404 e nada acusa — o módulo fica no repositório e fora do alcance
    // de qualquer requisição, como o cofre nasceu na primeira entrega.
    LinhaDoTempoModule,
    // A CAIXA PESSOAL (fatia A7): "o que precisa de mim" — as aprovações que
    // ESTA pessoa pode assinar, as tarefas dela que pararam e a conversa recente
    // no quadro dela, num lugar. Depois do `TenantsModule`, que ela importa para
    // uma pergunta só ("a empresa contratou o módulo `trabalho`?"), e depois do
    // `GatewayModule`, de onde vem a metade só-leitura da porta. Sem esta linha
    // `GET /api/caixa` responde 404, o selo da barra lateral fica em branco e
    // NADA ACUSA — mesmo silêncio da linha do tempo, e é por isso que a rota
    // está na lista padrão do smoke.
    CaixaModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
