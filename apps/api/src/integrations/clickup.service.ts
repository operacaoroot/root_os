import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { comContextoDePlataforma } from '../prisma/contexto-de-plataforma';
import { AuditService } from '../audit/audit.service';
import { ConectoresService } from './conectores.service';
import { ConectoresConfiguradosRegistry } from '../gateway/conectores-configurados.registry';
import { EfeitosRegistry } from '../gateway/efeitos.registry';
import { PRAZO_DA_CHAMADA_DE_SONDA_MS, RegistroDeConectores } from './conectores.registry';
import {
  type ConectorDoContrato,
  type ContextoDoVerbo,
  type ResultadoDeAutorizacao,
  type ResultadoDeRevogacao,
  type ResultadoDeSincronizacao,
  type SaudeDeConector,
  conectado,
  erroDeConector,
  frasedoErro,
  naoConfigurado,
} from './contrato-de-conector';
import {
  SemTenantError,
  comContexto,
  contextoAtual,
  novaCorrelacao,
} from '../common/contexto-execucao';

// Conector ClickUp (API v2, token pessoal). Credencial PRÓPRIA do root em
// ~/.config/root/clickup.env. PREMISSA: só o espaço "root". Listas de CONTEÚDO
// (Gestão de Temas) → ContentItem (status cru + campos); demais → Task.

interface CuOption { id: string; name: string; orderindex: number }
interface CuField {
  name: string;
  type: string;
  value?: unknown;
  type_config?: { options?: CuOption[] };
}
interface CuStatus { status: string; type: string }
interface CuTask {
  id: string;
  name: string;
  description?: string | null;
  status?: CuStatus;
  date_due?: string | null;
  priority?: { priority?: string } | null;
  assignees?: Array<{ username?: string }>;
  url?: string;
  tags?: Array<{ name: string }>;
  list?: { id?: string; name?: string };
  custom_fields?: CuField[];
}

@Injectable()
export class ClickupService implements OnModuleInit {
  private readonly log = new Logger('ClickupService');
  private readonly token = process.env.CLICKUP_API_TOKEN ?? '';
  private readonly base = (process.env.CLICKUP_BASE_URL ?? 'https://api.clickup.com/api/v2').replace(/\/$/, '');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly conectores: ConectoresService,
    /*
     * Quem pergunta se o ClickUp está configurado é a tela de Conexões, e até a
     * fatia 3.3 ela descobria isso lendo `CLICKUP_API_TOKEN` do ambiente por
     * conta própria. Renomear a variável aqui dentro fazia a tela mentir
     * "desconectado" sem nenhum erro de compilação. Agora quem responde é o dono
     * do segredo — ver `gateway/conectores-configurados.registry.ts`.
     */
    private readonly conectoresConfigurados: ConectoresConfiguradosRegistry,
    /*
     * O registro de efeitos: é aqui que as duas capacidades de escrita do
     * ClickUp passam a existir de fato para a porta (ver `onModuleInit`).
     */
    private readonly efeitos: EfeitosRegistry,
    /*
     * O contrato único de conector (fatia 5.4). Vem de um módulo `@Global`, como
     * os dois registros da porta: injetar aqui não acrescenta aresta nenhuma ao
     * grafo de módulos.
     */
    private readonly contrato: RegistroDeConectores,
  ) {}

  /**
   * O CONTRATO ÚNICO — autorizar, sincronizar, saúde, revogar (RF-X-01).
   *
   * Mora dentro do conector, como a declaração de efeitos ao lado, pelo mesmo
   * motivo: a catraca de arquitetura proíbe qualquer arquivo fora da porta de
   * importar um serviço de conector, então um arquivo de fiação ao lado seria
   * violação nova. O conector importar o REGISTRO é o inverso, e é permitido.
   */
  private descritorDoContrato(): ConectorDoContrato {
    return {
      chave: 'clickup',
      rotulo: 'ClickUp',
      /*
       * A rota própria deste conector (`POST integrations/clickup/sync`) sempre
       * exigiu `tarefas.editar` — de quem OPERA as tarefas, não de quem
       * administra usuários. Sem esta linha, o verbo genérico do contrato seria
       * uma segunda porta para a mesma sincronização, com a permissão antiga
       * intacta e inútil ao lado. Ver `permissaoParaSincronizar` no contrato.
       */
      permissaoParaSincronizar: 'tarefas.editar',
      /*
       * A CREDENCIAL É DO PROCESSO, e dizer isso é o que impede a tela de
       * oferecer "revogar" numa credencial que não é desta empresa. O token do
       * ClickUp é pessoal de um MEMBRO (formato `pk_<userId>_…`), definido no
       * ambiente pelo operador, e vale para todas as empresas do OS. Quem quer
       * parar o ClickUp de UMA empresa usa o desligamento, que é por empresa.
       */
      escopoDaCredencial: 'processo',

      autorizar: async (): Promise<ResultadoDeAutorizacao> => ({
        tipo: 'manual',
        instrucao:
          'O ClickUp não tem fluxo de OAuth aqui: ele usa um token pessoal de membro ' +
          '(formato "pk_<id>_…"), gerado em Settings → Apps no ClickUp e colocado na ' +
          'variável de ambiente do conector pelo operador da VPS. O token morre quando a ' +
          'pessoa dona dele sai do workspace — é por isso que a sonda de saúde existe.',
      }),

      sincronizar: async (ctx: ContextoDoVerbo): Promise<ResultadoDeSincronizacao> => {
        const r = await this.sync(ctx.orgId, ctx.actorId ?? undefined);
        return {
          tipo: 'feito',
          resumo:
            `${r.tasks} tarefa(s) e ${r.content} conteúdo(s) trazidos de ${r.lists} lista(s) ` +
            'do espaço da root.',
          numeros: { tarefas: r.tasks, conteudos: r.content, listas: r.lists },
        };
      },

      /**
       * A sonda: pergunta ao ClickUp QUEM é o dono do token.
       *
       * `GET /user` é a chamada mais barata que prova as três coisas que
       * importam de uma vez — o token existe, é aceito e ainda pertence a
       * alguém. Um `configured` que só olha o comprimento da string diria "sim"
       * para um token revogado meses atrás.
       */
      saude: async (): Promise<SaudeDeConector> => {
        if (!this.configured) {
          return naoConfigurado(
            'Falta o token do ClickUp no ambiente da API (é o token pessoal de um membro, ' +
              'gerado em Settings → Apps). Enquanto ele não existir, nenhuma empresa usa o ' +
              'ClickUp — a credencial é do processo, não desta empresa.',
          );
        }
        const comecou = Date.now();
        try {
          const r = await this.sondar<{ user?: { username?: string; email?: string } }>('/user');
          const quem = r.user?.username ?? r.user?.email ?? 'usuário sem nome';
          return conectado(Date.now() - comecou, `token pessoal de ${quem}.`);
        } catch (e) {
          return erroDeConector(frasedoErro(e), Date.now() - comecou);
        }
      },

      revogar: async (): Promise<ResultadoDeRevogacao> => ({
        tipo: 'nao_se_aplica',
        motivo:
          'O token do ClickUp é do PROCESSO e vale para todas as empresas: queimá-lo daqui ' +
          'derrubaria o ClickUp de todo mundo, e não há como fazê-lo só para esta empresa. ' +
          'Para esta empresa parar de usar o ClickUp agora, DESLIGUE o conector em Conexões — ' +
          'é por empresa, tem efeito na próxima chamada e não toca credencial nenhuma. Para ' +
          'queimar o token de verdade, revogue-o no ClickUp (Settings → Apps) e troque a ' +
          'variável no ambiente da API.',
      }),
    };
  }

  /**
   * Uma chamada de SONDA: a mesma API, com prazo e sem depender de `cu`.
   *
   * `cu` não tem prazo — é o cliente das rotinas, onde demorar é aceitável. Numa
   * sonda, demorar é o defeito: a tela de Conexões sonda todo mundo de uma vez e
   * quem a abre costuma estar atrás justamente do conector que está pendurado.
   */
  private async sondar<T>(path: string): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      headers: { Authorization: this.token },
      /*
       * O prazo de DENTRO, menor que o relógio de fora do registro: é o que faz
       * a frase deste conector ("token inválido ou revogado…") chegar à tela
       * antes do "a sonda passou de 6000 ms", que não diz o que fazer.
       */
      signal: AbortSignal.timeout(PRAZO_DA_CHAMADA_DE_SONDA_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(
        `O ClickUp respondeu HTTP ${res.status} em ${path}` +
          (body ? `: ${body.slice(0, 200)}` : '') +
          (res.status === 401
            ? ' — token inválido ou revogado (ele morre quando a pessoa dona sai do workspace).'
            : ''),
      );
    }
    return res.json() as Promise<T>;
  }

  get configured(): boolean {
    return this.token.length > 0;
  }

  /**
   * O DESLIGAMENTO, ANTES DE SAIR DA CASA (RF-G-06).
   *
   * Lança `ConectorDesligadoError` (403 com a frase em português) quando o
   * ClickUp está desligado para a empresa. Chamada no começo dos três métodos
   * que falam com a API do ClickUp; a leitura do espelho no banco não passa por
   * aqui, de propósito — desligar um conector para de MANDAR coisa para fora,
   * não apaga o que já foi trazido.
   *
   * A EMPRESA VEM DO PARÂMETRO QUANDO EXISTE, e do contexto de execução quando
   * não. `writeTaskStatus` e `criarTarefa` não recebem `orgId` e são chamados de
   * `content.service.ts` e `pauta/publicacao.service.ts` — arquivos de outra
   * fatia, cuja assinatura não dá para mudar aqui (está em FORA DO ESCOPO no
   * relatório). Hoje os dois só são alcançados por rota HTTP, onde o
   * `ContextoInterceptor` já abriu o contexto com a empresa do token.
   *
   * SEM EMPRESA RESOLVÍVEL, ELE RECUSA. A primeira versão avisava no log e
   * deixava passar, e o preço dessa conveniência era exato: o primeiro trabalho
   * agendado que chamasse um destes dois métodos atravessaria o interruptor sem
   * nada vermelho em canto nenhum — desligar o ClickUp num incidente e o OS
   * continuar escrevendo lá, em silêncio. "Não sei de quem é esta chamada" não
   * é licença para sair da casa: é o motivo mais forte para não sair. Quem
   * precisar chamar fora de requisição abre o contexto (`comContexto`), como o
   * laço agendado logo abaixo passou a fazer.
   */
  private async exigirClickupLigado(orgExplicito?: string, onde = 'ClickUp'): Promise<void> {
    const orgId = orgExplicito ?? contextoAtual()?.orgId ?? null;
    if (!orgId) {
      throw new SemTenantError(
        `${onde} (desligamento de conector não avaliado, então nada sai da casa — RF-G-06; ` +
          'abra o contexto com comContexto ou passe a empresa explicitamente)',
      );
    }
    await this.conectores.exigirLigado({ orgId, conector: 'clickup' });
  }

  // Sync AGENDADO (in-process): mantém o ClickUp em dia sozinho.
  // CLICKUP_SYNC_INTERVAL_MIN (default 60; 0 desliga). Primeira ~20s após o boot.
  onModuleInit(): void {
    // A inscrição vem ANTES do `return` de conector não configurado: a tela
    // precisa da resposta "não" tanto quanto da resposta "sim", e sair daqui
    // cedo deixaria a chave sem dono no registro — que a tela lê como "ninguém
    // respondeu", não como "desconectado".
    this.conectoresConfigurados.registrar('clickup', () => this.configured);

    /*
     * O CONTRATO ÚNICO (fatia 5.4). Vem ANTES do retorno antecipado pelo mesmo
     * motivo da linha acima: sem token, a resposta certa é "não configurado, e
     * aqui está o porquê" — que é uma RESPOSTA. Sair daqui cedo deixaria a chave
     * sem dono, e o registro derruba o arranque quando um conector cobrado não
     * se inscreve.
     */
    this.contrato.registrar(this.descritorDoContrato(), 'ClickupService');

    /*
     * AS DUAS ESCRITAS DO CLICKUP, DECLARADAS PELO CONECTOR — fatia 3.3.
     *
     * `clickup.tarefa.criar` e `clickup.tarefa.alterar` estavam no catálogo
     * como R3 desde sempre e não tinham EFEITO ligado: um agente que as
     * propusesse via porta chegava até a aprovação, uma pessoa confirmava, e a
     * execução respondia "classificada e aprovada, mas o efeito não está ligado
     * nesta versão". A régua funcionava e a ação não acontecia.
     *
     * Registradas aqui, dentro do conector, pelo mesmo motivo do Google e da
     * Evolution: a catraca de arquitetura proíbe qualquer arquivo fora de
     * `src/gateway/` de importar um serviço de conector, e um arquivo de fiação
     * ao lado seria violação nova. O `EfeitosRegistry` é `@Global`, então isto
     * não mexe no grafo de módulos.
     *
     * A LISTA DE DESTINO NÃO VEM DO MODELO. `criarTarefa` resolve `listId` do
     * ambiente quando não é informado, e o efeito NÃO repassa `listId` de
     * propósito: senão a régua controlaria o texto da tarefa e não onde ela cai.
     * É a mesma decisão do destino fixo da mensagem de WhatsApp.
     *
     * AS DUAS GANHARAM `argsSchema` NO CATÁLOGO na correção da fatia 3.3, e sem
     * ele a porta não validava nada: a aprovação assinava um corpo livre, e
     * `titulo` vazio só virava erro lá no ClickUp, com a aprovação já queimada.
     * `clickup.tarefa.criar` só existia em `politica-root.json` — cópia byte a
     * byte do anexo normativo, que não se edita — então a entrada foi
     * SOBRESCRITA no delta, com o mesmo nível e o mesmo efeito.
     *
     * OS APELIDOS ABAIXO (`nome`, `corpo`, `externalId`, `id`) ficaram para
     * trás de propósito, e não são dívida: o schema é `additionalProperties:
     * false`, então nada além de `titulo`/`descricao` e `tarefaId`/`status`
     * atravessa a porta. Eles seguem aqui para as propostas GRAVADAS antes do
     * schema existir, que a fila ainda pode conter — essas revalidam contra o
     * schema de hoje em `conferirAprovado` e são recusadas sem custar a
     * aprovação, o que é o comportamento certo, mas até lá o código não pode
     * quebrar de outro jeito.
     */
    this.efeitos.registrar({
      'clickup.tarefa.criar': (a: Record<string, unknown>) =>
        this.criarTarefa({
          nome: String(a.titulo ?? a.nome ?? '').trim(),
          descricao: String(a.descricao ?? a.corpo ?? ''),
        }),
      'clickup.tarefa.alterar': (a: Record<string, unknown>) =>
        this.writeTaskStatus(
          String(a.tarefaId ?? a.externalId ?? a.id ?? '').trim(),
          String(a.status ?? '').trim(),
        ),
    }, 'ClickupService');

    if (!this.configured) return;
    const min = Number(process.env.CLICKUP_SYNC_INTERVAL_MIN ?? 60);
    if (!(min > 0)) return;
    const run = async () => {
      try {
        const org = await comContextoDePlataforma(() =>
          this.prisma.org.findUnique({ where: { slug: 'root' } }));
        if (!org) return;
        /*
         * O CONTEXTO, que este laço não tinha. Sem requisição não há
         * `ContextoInterceptor`, então a empresa nunca chegava à sessão do
         * banco: sob isolamento por linha a primeira consulta já falharia, e
         * `exigirClickupLigado` não teria como avaliar o desligamento. Abrir o
         * escopo aqui é o que a onda 6 pede para toda rotina sem requisição
         * (varrer empresa por empresa, dentro da sessão de cada uma) — aqui a
         * varredura é de uma empresa só, a do slug `root`.
         */
        const r = await comContexto(
          { orgId: org.id, correlationId: novaCorrelacao('cron'), origem: 'cron' },
          () => this.sync(org.id),
        );
        this.log.log(`sync agendado: ${r.tasks} tarefa(s) + ${r.content} conteúdo(s)`);
      } catch (e) {
        this.log.warn(`sync agendado falhou: ${(e as Error).message}`);
      }
    };
    setTimeout(run, 20_000);
    setInterval(run, min * 60_000);
    this.log.log(`ClickUp sync agendado a cada ${min} min`);
  }

  private async cu<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { Authorization: this.token, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`ClickUp ${path} → HTTP ${res.status} ${body.slice(0, 160)}`);
    }
    return res.json() as Promise<T>;
  }

  /** Write-back: muda o status de uma task no ClickUp (fonte da verdade). */
  async writeTaskStatus(externalId: string, status: string): Promise<{ status: string; type: string | null }> {
    if (!this.configured) throw new ServiceUnavailableException('ClickUp não configurado.');
    await this.exigirClickupLigado(undefined, 'ClickUp writeTaskStatus');
    const t = await this.cu<{ status?: { status: string; type: string } }>(
      `/task/${encodeURIComponent(externalId)}`,
      { method: 'PUT', body: JSON.stringify({ status }) },
    );
    return { status: t.status?.status ?? status, type: t.status?.type ?? null };
  }

  /**
   * Cria uma task na lista informada (ou na CLICKUP_LIST_PAUTA). Usado pelo
   * módulo Pauta para transformar a peça de canal `clickup` em tema real.
   */
  async criarTarefa(args: {
    nome: string;
    descricao: string;
    listId?: string | null;
  }): Promise<{ id: string; url: string | null }> {
    if (!this.configured) throw new ServiceUnavailableException('ClickUp não configurado.');
    await this.exigirClickupLigado(undefined, 'ClickUp criarTarefa');
    const listId = (args.listId || process.env.CLICKUP_LIST_PAUTA || '').trim();
    if (!listId) {
      throw new ServiceUnavailableException(
        'Falta a lista de destino: defina CLICKUP_LIST_PAUTA no .env ou informe listId.',
      );
    }
    const t = await this.cu<{ id: string; url?: string }>(`/list/${encodeURIComponent(listId)}/task`, {
      method: 'POST',
      body: JSON.stringify({ name: args.nome.slice(0, 250), description: args.descricao }),
    });
    return { id: t.id, url: t.url ?? null };
  }

  /**
   * PREMISSA: só o espaço "root". Localiza por id (CLICKUP_SPACE_ID) ou nome
   * (CLICKUP_SPACE_NAME, default "root"), IGNORANDO o workspace do escritório.
   */
  private async resolveSpace(): Promise<{ spaceId: string; spaceName: string }> {
    const byId = (process.env.CLICKUP_SPACE_ID ?? '').trim();
    const wantName = (process.env.CLICKUP_SPACE_NAME ?? 'root').trim();
    if (byId) return { spaceId: byId, spaceName: wantName };

    const ignore = (process.env.CLICKUP_IGNORE_TEAMS ?? 'Cardozo & Saggioro')
      .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    const { teams } = await this.cu<{ teams: Array<{ id: string; name: string }> }>('/team');
    for (const t of teams) {
      if (ignore.includes(t.name.trim().toLowerCase())) continue; // não toca o escritório
      const { spaces } = await this.cu<{ spaces: Array<{ id: string; name: string }> }>(
        `/team/${t.id}/space?archived=false`,
      );
      const found = spaces.find((s) => s.name.trim().toLowerCase() === wantName.toLowerCase());
      if (found) return { spaceId: found.id, spaceName: found.name };
    }
    throw new Error(`Espaço "${wantName}" não encontrado (fora do escritório).`);
  }

  /** Todas as listas do espaço (com nome), pastas + sem pasta. */
  private async spaceLists(spaceId: string): Promise<Array<{ id: string; name: string }>> {
    const out: Array<{ id: string; name: string }> = [];
    const { folders } = await this.cu<{ folders: Array<{ lists: Array<{ id: string; name: string }> }> }>(
      `/space/${spaceId}/folder?archived=false`,
    );
    for (const f of folders) for (const l of f.lists ?? []) out.push({ id: l.id, name: l.name });
    const { lists } = await this.cu<{ lists: Array<{ id: string; name: string }> }>(
      `/space/${spaceId}/list?archived=false`,
    );
    for (const l of lists) out.push({ id: l.id, name: l.name });
    // dedup por id
    return [...new Map(out.map((l) => [l.id, l])).values()];
  }

  /** Quais listas são "de conteúdo" (env CLICKUP_CONTENT_LIST_IDS ou por nome). */
  private contentListIds(lists: Array<{ id: string; name: string }>): Set<string> {
    const byIds = (process.env.CLICKUP_CONTENT_LIST_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (byIds.length) return new Set(byIds);
    const names = (process.env.CLICKUP_CONTENT_LIST_NAMES ?? 'Gestão de Temas')
      .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    return new Set(lists.filter((l) => names.some((n) => l.name.trim().toLowerCase().includes(n))).map((l) => l.id));
  }

  // include_closed=true: senão o ClickUp esconde tarefas fechadas (ex.: "complete").
  private async fetchTasks(listId: string): Promise<CuTask[]> {
    const out: CuTask[] = [];
    for (let page = 0; page < 30; page++) {
      const { tasks } = await this.cu<{ tasks: CuTask[] }>(
        `/list/${listId}/task?archived=false&include_closed=true&subtasks=true&page=${page}`,
      );
      out.push(...tasks);
      if (tasks.length < 100) break;
    }
    return out;
  }

  private mapStatus(s?: CuStatus): TaskStatus {
    const type = s?.type ?? 'open';
    if (type === 'closed' || type === 'done') return 'concluida';
    if (type === 'custom') return 'em_andamento';
    return 'aberta';
  }

  private mapPriority(p?: { priority?: string } | null): string {
    return p?.priority === 'urgent' || p?.priority === 'high' ? 'alta' : 'normal';
  }

  /** Resolve um custom field pelo nome (dropdown → nome da opção). */
  private cf(task: CuTask, needle: string): string | null {
    const f = (task.custom_fields ?? []).find((x) => x.name.trim().toLowerCase().includes(needle.toLowerCase()));
    if (!f || f.value === null || f.value === undefined || f.value === '') return null;
    if (f.type === 'drop_down') {
      const opts = f.type_config?.options ?? [];
      const opt = opts.find((o) => o.id === f.value || String(o.orderindex) === String(f.value));
      return opt?.name ?? null;
    }
    if (Array.isArray(f.value)) return f.value.map(String).join(', ') || null;
    return String(f.value);
  }

  async sync(orgId: string, actorId?: string): Promise<{ tasks: number; content: number; lists: number }> {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'ClickUp não configurado: defina CLICKUP_API_TOKEN em ~/.config/root/clickup.env e reinicie a API.',
      );
    }
    await this.exigirClickupLigado(orgId, 'ClickUp sync');
    const started = Date.now();
    try {
      const { spaceId, spaceName } = await this.resolveSpace();
      const lists = await this.spaceLists(spaceId);
      const contentIds = this.contentListIds(lists);
      const taskLists = lists.filter((l) => !contentIds.has(l.id));
      const contentLists = lists.filter((l) => contentIds.has(l.id));
      this.log.log(
        `ClickUp: espaço "${spaceName}" — ${taskLists.length} lista(s) de tarefa, ${contentLists.length} de conteúdo`,
      );

      // --- Tarefas operacionais → Task ---
      const taskRows: any[] = [];
      for (const l of taskLists) {
        for (const t of await this.fetchTasks(l.id)) {
          taskRows.push({
            orgId,
            tool: 'clickup',
            externalId: t.id,
            title: t.name,
            description: t.description ?? null,
            status: this.mapStatus(t.status),
            priority: this.mapPriority(t.priority),
            assignee: t.assignees?.[0]?.username ?? null,
            dueDate: t.date_due ? new Date(Number(t.date_due)) : null,
            externalUrl: t.url ?? null,
            tags: (t.tags ?? []).map((tg) => tg.name),
          });
        }
      }

      // --- Conteúdo (pipeline) → ContentItem (status cru + campos) ---
      const contentRows: any[] = [];
      for (const l of contentLists) {
        for (const t of await this.fetchTasks(l.id)) {
          contentRows.push({
            orgId,
            source: 'clickup',
            externalId: t.id,
            listId: l.id,
            listName: l.name,
            title: t.name,
            status: t.status?.status ?? '—',
            statusType: t.status?.type ?? null,
            formato: this.cf(t, 'formato'),
            eixo: this.cf(t, 'eixo'),
            tipo: this.cf(t, 'tipo'),
            fonte: this.cf(t, 'fonte'),
            assignee: t.assignees?.[0]?.username ?? null,
            url: t.url ?? null,
            dueDate: t.date_due ? new Date(Number(t.date_due)) : null,
          });
        }
      }

      await this.prisma.$transaction([
        this.prisma.task.deleteMany({ where: { orgId, tool: 'clickup' } }),
        ...(taskRows.length ? [this.prisma.task.createMany({ data: taskRows })] : []),
        this.prisma.contentItem.deleteMany({ where: { orgId, source: 'clickup' } }),
        ...(contentRows.length ? [this.prisma.contentItem.createMany({ data: contentRows })] : []),
      ]);

      const latencyMs = Date.now() - started;
      await this.markHealth(orgId, 'ok', latencyMs, null);
      await this.audit.log({
        orgId,
        actorId,
        actorType: actorId ? 'user' : 'system',
        action: 'integration.sync',
        entityType: 'integration',
        entityId: 'clickup',
        after: { tasks: taskRows.length, content: contentRows.length },
      });
      this.log.log(
        `ClickUp sync: ${taskRows.length} tarefa(s) + ${contentRows.length} conteúdo(s) em ${latencyMs}ms`,
      );
      return { tasks: taskRows.length, content: contentRows.length, lists: lists.length };
    } catch (e) {
      await this.markHealth(orgId, 'down', Date.now() - started, (e as Error).message).catch(() => {});
      throw e;
    }
  }

  /** Atualiza IntegrationAccount(clickup) + health. */
  private async markHealth(orgId: string, health: 'ok' | 'down', latencyMs: number, lastError: string | null) {
    const status = health === 'ok' ? 'connected' : 'error';
    const acc = await this.prisma.integrationAccount.findFirst({ where: { orgId, key: 'clickup' } });
    const account = acc
      ? await this.prisma.integrationAccount.update({
          where: { id: acc.id },
          data: { status, connectedAt: health === 'ok' ? new Date() : acc.connectedAt },
        })
      : await this.prisma.integrationAccount.create({
          data: { orgId, key: 'clickup', label: 'ClickUp (root)', status, connectedAt: new Date() },
        });
    await this.prisma.integrationHealth.upsert({
      where: { accountId: account.id },
      update: { status: health, lastSyncAt: new Date(), latencyMs, lastError },
      create: { accountId: account.id, status: health, lastSyncAt: new Date(), latencyMs, lastError },
    });
  }
}
