import { Module, OnModuleInit } from '@nestjs/common';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { AgentRuntime } from './agent-runtime.service';
import { SessionService } from './session.service';
import { ContextBuilder } from './context-builder.service';
import { ObsidianModule } from '../obsidian/obsidian.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { DashboardService } from '../dashboard/dashboard.service';
import { FinanceModule } from '../finance/finance.module';
import { FinanceService } from '../finance/finance.service';
import { FinopsService } from '../finance/finops.service';
import { AprService } from '../finance/apr.service';
import { LeadsModule } from '../leads/leads.module';
import { LeadsService } from '../leads/leads.service';
import { TasksModule } from '../tasks/tasks.module';
import { TasksService } from '../tasks/tasks.service';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { CampaignsService } from '../campaigns/campaigns.service';
import { ObsidianService } from '../obsidian/obsidian.service';

/*
 * O que liga uma CAPACIDADE ao código que a realiza.
 *
 * O runtime chama os serviços do Nest direto, e não um cliente MCP por stdio:
 * dentro da API o org e a permissão já vêm do contexto da porta, e um processo
 * filho por sessão seria caro e frágil. O packages/mcp continua servindo o
 * terminal do operador pelos GETs, sem mudança.
 *
 * Só as capacidades com efeito ligado aqui EXECUTAM. As outras 50 estão
 * classificadas e registradas, e o runtime diz isso com todas as letras em vez
 * de fingir que rodou. Ligar mais é acrescentar linha neste mapa.
 */
@Module({
  imports: [ObsidianModule, DashboardModule, FinanceModule, LeadsModule, TasksModule, CampaignsModule],
  controllers: [AgentsController],
  providers: [AgentsService, AgentRuntime, SessionService, ContextBuilder],
  exports: [AgentsService, AgentRuntime, SessionService],
})
export class AgentsModule implements OnModuleInit {
  constructor(
    private readonly runtime: AgentRuntime,
    private readonly dashboard: DashboardService,
    private readonly finance: FinanceService,
    private readonly finops: FinopsService,
    private readonly apr: AprService,
    private readonly leads: LeadsService,
    private readonly tasks: TasksService,
    private readonly campanhas: CampaignsService,
    private readonly obsidian: ObsidianService,
  ) {}

  onModuleInit(): void {
    Object.assign(this.runtime.efeitos, {
      'numeros.painel.ler': (_a: Record<string, unknown>, org: string) => this.dashboard.summary(org),
      'financeiro.resumo.ler': (_a: Record<string, unknown>, org: string) => this.finance.summary(org),
      'financeiro.kpi.ler': (_a: Record<string, unknown>, org: string) => this.finops.kpis(org),
      'financeiro.pagavel.listar': (a: Record<string, unknown>, org: string) =>
        this.apr.payables(org, a.tipo as string | undefined),
      'crm.lead.buscar': (a: Record<string, unknown>, org: string) =>
        this.leads.list(org, { status: a.status as string, period: a.period as string }),
      'operacao.tarefa.atrasada': (_a: Record<string, unknown>, org: string) =>
        this.tasks.list(org, { overdue: true }),
      'operacao.tarefa.listar': (a: Record<string, unknown>, org: string) =>
        this.tasks.list(org, { status: a.status as string }),
      'pecas.campanha.listar': (a: Record<string, unknown>, org: string) =>
        this.campanhas.list(org, a.status as string | undefined),
      'contexto.memoria.buscar': (a: Record<string, unknown>, org: string) =>
        this.obsidian.search(org, String(a.q ?? a.query ?? ''), Number(a.limit ?? 5)),
    });
  }
}
