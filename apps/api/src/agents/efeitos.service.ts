import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EfeitosRegistry } from '../gateway/efeitos.registry';
import { DashboardService } from '../dashboard/dashboard.service';
import { FinanceService } from '../finance/finance.service';
import { FinopsService } from '../finance/finops.service';
import { AprService } from '../finance/apr.service';
import { LeadsService } from '../leads/leads.service';
import { TasksService } from '../tasks/tasks.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { MemoriaService } from '../memory/memoria.service';
import { contextoAtual } from '../common/contexto-execucao';

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
    private readonly memoria: MemoriaService,
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
        this.memoria.buscarParaAgente(org, String(a.q ?? a.query ?? ''), Number(a.limit ?? 5), {
          userId: contextoAtual()?.actorId ?? undefined,
        }),
    }, 'EfeitosService (capacidades do próprio OS)');
    /*
     * O QUE SAIU DAQUI NA FATIA 3.3, e por quê.
     *
     * `whatsapp.mensagem.enviar` morava neste mapa, e para escrevê-lo este
     * arquivo importava o `EvolutionService` — o runtime do agente alcançando um
     * conector por fora da porta, que era a violação mais antiga da catraca de
     * arquitetura. O efeito não mudou de corpo, mudou de LADO: agora quem o
     * declara é o próprio conector (`pauta/evolution.service.ts`), no
     * `onModuleInit` dele. O mesmo vale para as nove capacidades do Google, que
     * o `GoogleService` passou a declarar.
     *
     * A regra que ficou: **efeito que fala com sistema de terceiro é declarado
     * pelo conector daquele sistema; este mapa só liga o que é do próprio OS** —
     * painel, financeiro, leads, tarefas, campanhas, tudo lendo o banco daqui.
     *
     * `contexto.memoria.buscar` passa pelo `MemoriaService` com a mesma
     * concessão ADR-015 da rota PAT. Não há queda para vault/Obsidian: a busca
     * sem grant devolve diagnóstico fechado e não conteúdo.
     *
     * O NÚMERO NO LOG deixou de ser "as capacidades desta classe": ele conta o
     * registro INTEIRO, que agora é preenchido por vários serviços em ordem de
     * arranque. É o número certo para a pergunta que interessa — quantas
     * capacidades o OS consegue executar — e é por isso que continua aqui.
     */
    this.log.log(`${this.registro.tamanho} capacidades com efeito ligado`);
  }
}
