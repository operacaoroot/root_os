import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EfeitosRegistry, type ContextoDoEfeito } from '../gateway/efeitos.registry';
import { EvolutionService } from '../pauta/evolution.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { FinanceService } from '../finance/finance.service';
import { FinopsService } from '../finance/finops.service';
import { AprService } from '../finance/apr.service';
import { LeadsService } from '../leads/leads.service';
import { TasksService } from '../tasks/tasks.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { ObsidianService } from '../obsidian/obsidian.service';

/*
 * O que liga uma CAPACIDADE ao código que a realiza.
 *
 * É um provider, e não o construtor do módulo, por um motivo que custou dois
 * minutos de produção: módulo-classe com dependências injetadas não é
 * resolvido por Test.createTestingModule().compile(), então o teste de grafo
 * passa e o boot quebra. Provider comum é instanciado no compile, e aí o teste
 * pega o "esqueci de exportar" antes do deploy.
 *
 * O runtime chama os serviços do Nest direto, não um cliente MCP por stdio:
 * dentro da API o org e a permissão já vêm do contexto da porta, e um processo
 * filho por sessão seria caro e frágil. O packages/mcp continua servindo o
 * terminal do operador pelos GETs, sem mudança.
 *
 * Só as capacidades listadas aqui EXECUTAM. As outras estão classificadas e
 * registradas, e o runtime diz isso com todas as letras em vez de fingir que
 * rodou. Ligar mais é acrescentar linha neste mapa.
 */
@Injectable()
export class EfeitosService implements OnModuleInit {
  private readonly log = new Logger('Efeitos');

  constructor(
    private readonly registro: EfeitosRegistry,
    private readonly dashboard: DashboardService,
    private readonly finance: FinanceService,
    private readonly finops: FinopsService,
    private readonly apr: AprService,
    private readonly leads: LeadsService,
    private readonly tasks: TasksService,
    private readonly campanhas: CampaignsService,
    private readonly obsidian: ObsidianService,
    private readonly evolution: EvolutionService,
  ) {}

  onModuleInit(): void {
    this.registro.registrar({
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

      /*
       * A PRIMEIRA capacidade de escrita com efeito ligado. R3: ela só chega
       * aqui depois que uma pessoa aprovou, e com os argumentos GRAVADOS na
       * proposta — nunca com os que vieram na confirmação.
       *
       * O destino é SEMPRE o grupo configurado no ambiente. O modelo não
       * escolhe para quem manda: um `destino` proposto por ele é ignorado de
       * propósito, senão a régua controlaria o texto e não o destinatário.
       *
       * O terceiro parâmetro é quem pediu (RF-T-04, RNF-09). A Evolution não
       * tem campo para ator, então ele sai no RESULTADO — que é o que a porta
       * grava em `ToolCall.resultado` e o que volta para quem confirmou. Sem
       * isso, o registro do envio diz o que saiu e não diz por ordem de quem:
       * nesta rota o proponente é a IA e o executor é gente, e a diferença é o
       * ponto inteiro da aprovação.
       */
      'whatsapp.mensagem.enviar': async (
        a: Record<string, unknown>,
        _org: string,
        ctx: ContextoDoEfeito,
      ) => {
        const titulo = String(a.titulo ?? '').trim();
        const corpo = String(a.corpo ?? a.texto ?? a.mensagem ?? '').trim();
        if (!corpo) throw new Error('mensagem vazia: nada foi enviado');
        const texto = titulo ? `*${titulo}*\n\n${corpo}` : corpo;
        const r = await this.evolution.enviarTexto(this.evolution.grupo, texto);
        return {
          enviado: true,
          id: r.id,
          destino: this.evolution.grupo,
          caracteres: texto.length,
          porOrdemDe: ctx.actorId ?? null,
        };
      },
    });
    this.log.log(`${this.registro.tamanho} capacidades com efeito ligado`);
  }
}
