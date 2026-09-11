import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { DailyReport, ReportList } from '@mktos/shared';
import { PrismaService } from '../prisma/prisma.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { FunnelService } from '../funnel/funnel.service';
import { EventsService } from '../events/events.service';
import { TasksService } from '../tasks/tasks.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { LLM_PROVIDER, type LlmProvider } from '../llm/llm.provider';

const SYSTEM_PROMPT = `Você é um analista de marketing sênior do "Marketing OS".
Escreva um BRIEFING DIÁRIO executivo em português do Brasil, em markdown, curto e direto,
com estas seções (use exatamente estes títulos):
## Resumo do dia
## Destaques
## Alertas e riscos
## Ações sugeridas
Regras: use SOMENTE os números fornecidos (não invente); cite valores concretos; seja objetivo
(no máximo ~180 palavras no total); em "Ações sugeridas" liste de 2 a 4 bullets acionáveis.
Se algum dado estiver zerado, diga isso com naturalidade em vez de inventar tendência.`;

@Injectable()
export class ReportsService {
  private readonly log = new Logger('ReportsService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboard: DashboardService,
    private readonly funnel: FunnelService,
    private readonly events: EventsService,
    private readonly tasks: TasksService,
    private readonly campaigns: CampaignsService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  /** Coleta os números do dia (mesma fonte do dashboard/painéis). */
  private async gather(orgId: string) {
    const [dash, funnel, events, overdue, campaigns] = await Promise.all([
      this.dashboard.summary(orgId),
      this.funnel.metrics(orgId),
      this.events.summary(orgId, 7),
      this.tasks.list(orgId, { overdue: true }),
      this.campaigns.list(orgId),
    ]);

    return {
      dashboard: dash,
      funil: funnel.stages.map((s) => ({
        etapa: s.label,
        total: s.count,
        convDaAnterior: s.convFromPrev,
      })),
      trafego: {
        janela: events.window,
        totais: events.totals,
        porEvento: events.byEvent,
        porOrigem: events.bySource,
        diario: events.daily,
      },
      tarefasAtrasadas: {
        total: overdue.overdue,
        exemplos: overdue.items.slice(0, 5).map((t) => t.title),
      },
      campanhasEmRisco: campaigns.items
        .filter((c) => c.status === 'problema')
        .map((c) => ({ nome: c.name, cpl: c.cpl, leads: c.leads })),
    };
  }

  async generateDaily(orgId: string): Promise<DailyReport> {
    if (!this.llm.configured) {
      throw new ServiceUnavailableException(
        `IA não configurada: falta a credencial do provider "${this.llm.name}". ` +
          `Configure ~/.config/root/${this.llm.name}.env e reinicie a API.`,
      );
    }
    const data = await this.gather(orgId);
    const periodStart = new Date(data.trafego.janela.since);
    const periodEnd = new Date(data.trafego.janela.until);

    const user = `Data de referência: ${periodEnd.toISOString().slice(0, 10)}.
Dados (JSON):
${JSON.stringify(data)}`;

    this.log.log(`Gerando resumo diário via ${this.llm.name}/${this.llm.model} (org ${orgId})`);
    // `orgId` explícito diz de quem é o gasto para o teto de custo de IA por
    // empresa e por dia (RF-G-05). Hoje esta rota só chega por requisição, e o
    // contexto já traria a empresa; declarar aqui é o que mantém o gasto
    // rastreado se um dia ela virar rotina agendada.
    const summary = await this.llm.complete({ system: SYSTEM_PROMPT, user, orgId });

    const row = await this.prisma.report.create({
      data: {
        orgId,
        type: 'daily',
        title: `Resumo diário — ${periodEnd.toLocaleDateString('pt-BR')}`,
        summary,
        data: data as unknown as object,
        provider: this.llm.name,
        model: this.llm.model,
        periodStart,
        periodEnd,
      },
    });
    return this.toDto(row);
  }

  async latest(orgId: string): Promise<DailyReport | null> {
    const row = await this.prisma.report.findFirst({
      where: { orgId, type: 'daily' },
      orderBy: { createdAt: 'desc' },
    });
    return row ? this.toDto(row) : null;
  }

  async list(orgId: string, limit = 30): Promise<ReportList> {
    const take = Math.min(Math.max(limit, 1), 100);
    const [rows, total] = await Promise.all([
      this.prisma.report.findMany({
        where: { orgId, type: 'daily' },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.report.count({ where: { orgId, type: 'daily' } }),
    ]);
    return {
      items: rows.map((r) => this.toDto(r)),
      total,
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    };
  }

  private toDto(r: {
    id: string;
    title: string;
    summary: string;
    provider: string;
    model: string;
    periodStart: Date;
    periodEnd: Date;
    createdAt: Date;
  }): DailyReport {
    return {
      id: r.id,
      type: 'daily',
      title: r.title,
      summary: r.summary,
      provider: r.provider,
      model: r.model,
      periodStart: r.periodStart.toISOString(),
      periodEnd: r.periodEnd.toISOString(),
      createdAt: r.createdAt.toISOString(),
    };
  }
}
