import { ForbiddenException, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EventLogService } from '../gateway/event-log.service';
import { InterruptoresRegistry } from '../gateway/interruptores.registry';
import { contextoAtual, exigirTenant } from '../common/contexto-execucao';
import {
  type AplicacaoDoDesligamento,
  type RecusaDeConector,
  aplicacaoDoDesligamento,
  conectorDaCapacidade,
  expandirAlvo,
  grupoDoConector,
  montarRecusa,
  rotuloDoConector,
} from './conectores';

/**
 * A empresa da pergunta não é a empresa da sessão do banco.
 *
 * NÃO é erro de usuário: é invariante violada, e por isso não estende
 * `HttpException` — quem chegou aqui tem um defeito a montante, e o erro precisa
 * ser barulhento (09-PADRÕES §3.4). Ver `ConectoresService.empresaDaConsulta`
 * para o porquê de isto ser fatal em vez de aviso.
 */
export class EmpresaDivergenteError extends Error {
  constructor(onde: string, doArgumento: string, doContexto: string | null) {
    super(
      `${onde}: a empresa do argumento (${doArgumento}) não é a da execução em curso ` +
        `(${doContexto ?? 'nenhuma'}). O desligamento de conector FALHA FECHADO: sem poder provar ` +
        'que a leitura enxerga a linha certa, ele não responde "ligado" (RF-G-06, RF-T-04).',
    );
    this.name = 'EmpresaDivergenteError';
  }
}

/**
 * A recusa, como exceção, para quem chama o conector direto.
 *
 * ESTENDE `ForbiddenException` de propósito. Numa rota HTTP ela vira 403 com a
 * frase em português — que é o que uma recusa de POLÍTICA deve ser — em vez de
 * 500, que é o que um `Error` cru viraria e que faria a tela dizer "erro no
 * servidor" para uma decisão deliberada de quem administra a empresa.
 *
 * `recusa` vai junto para quem precisa do detalhe estruturado (o rótulo estável
 * para agrupar, o conector, quando foi desligado) sem ter de reabrir a frase.
 */
export class ConectorDesligadoError extends ForbiddenException {
  readonly recusa: RecusaDeConector;

  constructor(recusa: RecusaDeConector) {
    super(recusa.motivo);
    this.name = 'ConectorDesligadoError';
    this.recusa = recusa;
  }
}

/** Uma linha de desligamento, como a tela e a porta a enxergam. */
export interface ConectorDesligadoInfo {
  conector: string;
  rotulo: string;
  grupo: string | null;
  motivo: string | null;
  desligadoPor: string | null;
  desligadoEm: string;
  /** `recusa` ou `registro` — ver `aplicacaoDoDesligamento` em `conectores.ts`. */
  aplicacao: AplicacaoDoDesligamento;
}

/**
 * O que desligar e religar devolvem. UMA forma para os dois, de propósito: a
 * primeira versão devolvia `desligados: string[]` de um lado e `religados:
 * number` do outro — dois nomes e dois tipos para o mesmo dado ("o que de fato
 * mudou"), e quem consumisse os dois teria de saber a diferença de cor.
 */
export interface MudancaDeConector {
  ok: true;
  /** Todas as chaves que o alvo cobre (o grupo `google` são quatro). */
  conectores: string[];
  /** As que REALMENTE mudaram de estado agora — repetir o clique devolve []. */
  efetivados: string[];
}

/**
 * O DESLIGAMENTO DE CONECTOR — RF-G-06.
 *
 * ------------------------------------------------------------------------
 * POR QUE ESTE SERVIÇO NÃO GUARDA NADA EM MEMÓRIA
 * ------------------------------------------------------------------------
 * A armadilha conhecida do projeto é `GATEWAY_MODO`: ele é lido no CONSTRUTOR,
 * e por isso mudar o modo da porta exige recriar o container — `docker restart`
 * não serve. Um desligamento de emergência com esse desenho seria pior que
 * inútil: quem clicasse "desligar" veria a tela mudar e o conector continuaria
 * mandando mensagem até o próximo deploy.
 *
 * O caminho do meio — guardar por alguns segundos, como `ModulosService` faz com
 * 30s — foi considerado e recusado AQUI, e a diferença entre os dois casos é a
 * natureza da pergunta. Módulo contratado é escopo de produto, muda em escala de
 * semanas, e 30s de atraso não custam nada. Desligar conector é revogação de
 * emergência: os segundos que o cache segura são segundos em que o OS continua
 * agindo depois de alguém ter mandado parar, e em MAIS DE UMA INSTÂNCIA — quem
 * clicou limparia o cache da instância que atendeu o clique, e as outras
 * seguiriam com a resposta velha até expirar.
 *
 * O PREÇO MEDIDO (11/09/2026, Postgres descartável `prova_37`, 802 linhas em 200
 * empresas, consulta `WHERE "orgId" = $1` pelo índice único):
 *
 *   · dentro do banco ............................. 0,019 ms
 *   · ida e volta do Node, conexão de hoje ........ p50 0,165 ms · p99 0,264 ms
 *   · ida e volta em transação com `SET LOCAL`
 *     (o custo depois da virada para `mktos_app`) . p50 0,687 ms · p99 1,405 ms
 *
 * Menos de 1 ms num caminho que já faz cinco escritas (decisão, ToolCall, dois
 * eventos, aprovação). Não vale um segundo de desligamento atrasado.
 *
 * QUANTO TEMPO LEVA PARA O DESLIGAMENTO VALER, então: o tempo da próxima
 * chamada. Zero de defasagem, em qualquer instância, sem recriar container e
 * sem cache para expirar.
 *
 * ------------------------------------------------------------------------
 * E O QUE ELE **NÃO** FAZ
 * ------------------------------------------------------------------------
 * Não apaga credencial, não revoga token, não muda `IntegrationAccount.status`.
 * Religar é apagar a linha — o `GoogleAccount` da empresa continua exatamente
 * como estava e ninguém refaz OAuth. Ver `conectores.ts`.
 */
@Injectable()
export class ConectoresService implements OnModuleInit {
  private readonly log = new Logger('Conectores');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly eventos: EventLogService,
    /*
     * O REGISTRO DE INTERRUPTORES DA PORTA — a ponta que faz o desligamento
     * valer para as ferramentas dos agentes, e não só ficar registrado.
     *
     * A inscrição vai NESTA direção (integrações → porta) porque a contrária
     * fecha ciclo de módulo: este serviço já importa `EventLogService`, que mora
     * na pasta da porta. Ver `gateway/interruptores.registry.ts`.
     *
     * `@Optional()` porque a suíte constrói este serviço à mão; sem o registro,
     * desligar continua gravando a decisão e a porta não pergunta nada.
     */
    @Optional() private readonly interruptores?: InterruptoresRegistry,
  ) {}

  /**
   * Liga o interruptor à porta.
   *
   * É `verificar` que vai para lá, e não `recusaDe`: a porta precisa da decisão
   * COM o registro da recusa no RASTRO — quem lê a auditoria tem de encontrar a
   * linha da ferramenta que foi barrada, não só a do desligamento.
   */
  onModuleInit(): void {
    this.interruptores?.registrar((entrada) => this.verificar(entrada), 'ConectoresService');
  }

  /**
   * A EMPRESA DA CONSULTA — e por que ela falha fechado.
   *
   * O isolamento por linha recorta `ConectorDesligado` pela empresa da SESSÃO do
   * banco (`app_org_atual()`), que vem do contexto de execução. Se o `orgId`
   * passado por argumento não for esse mesmo, a policy não deixa a linha
   * aparecer: `findUnique` devolve `null` — e `null`, no desenho ingênuo, quer
   * dizer "conector ligado".
   *
   * Num botão de emergência, "não consegui ler, então liberado" é o padrão
   * errado. É a única falha desta fatia que se paga com a coisa que ela existe
   * para impedir: o OS continuar agindo depois de alguém ter mandado parar.
   * `sessao-de-banco.ts` já vê essa divergência e só AVISA — de propósito, para
   * não trocar "tela vazia" por 500 no repositório inteiro. Aqui a conta é
   * outra, e a decisão também: sem poder provar que a leitura enxerga a linha
   * certa, este serviço não responde.
   *
   * CONTEXTO AUSENTE TAMBÉM RECUSA, e é o caso mais perigoso dos dois: sessão
   * sem empresa declarada faz `app_org_resolvida()` ser falso e NENHUMA linha
   * aparecer. Quem chama sem contexto aberto tem de abri-lo (`comContexto`) —
   * é o que o laço agendado do ClickUp passou a fazer.
   */
  private empresaDaConsulta(orgId: string | null | undefined, onde: string): string {
    const doArgumento = exigirTenant(orgId, onde);
    const doContexto = contextoAtual()?.orgId ?? null;
    if (doContexto !== doArgumento) {
      throw new EmpresaDivergenteError(onde, doArgumento, doContexto);
    }
    return doArgumento;
  }

  /**
   * Os conectores desligados desta empresa, chave → linha. Leitura fresca, uma
   * por pergunta — ver o cabeçalho da classe.
   */
  async desligados(orgId: string): Promise<
    Map<string, { motivo: string | null; desligadoPor: string | null; desligadoEm: Date }>
  > {
    const id = this.empresaDaConsulta(orgId, 'ConectoresService.desligados');
    const linhas = await this.prisma.conectorDesligado.findMany({
      where: { orgId: id },
      select: { conector: true, motivo: true, desligadoPor: true, desligadoEm: true },
    });
    return new Map(
      linhas.map((l) => [
        l.conector,
        { motivo: l.motivo, desligadoPor: l.desligadoPor, desligadoEm: l.desligadoEm },
      ]),
    );
  }

  /** O que a tela mostra: a lista, ordenada, já com rótulo e grupo. */
  async listar(orgId: string): Promise<ConectorDesligadoInfo[]> {
    const mapa = await this.desligados(orgId);
    return [...mapa.entries()]
      .map(([conector, l]) => ({
        conector,
        rotulo: rotuloDoConector(conector),
        grupo: grupoDoConector(conector),
        motivo: l.motivo,
        desligadoPor: l.desligadoPor,
        desligadoEm: l.desligadoEm.toISOString(),
        // O que este desligamento faz HOJE: recusar a chamada ou só registrar a
        // decisão. Vem do código que cumpre a promessa, nunca do componente.
        aplicacao: aplicacaoDoDesligamento(conector),
      }))
      .sort((a, b) => a.conector.localeCompare(b.conector));
  }

  /**
   * A DECISÃO, sem efeito nenhum: esta chamada seria recusada?
   *
   * Devolve `null` quando a capacidade não usa conector externo, quando o
   * conector está ligado, ou quando a capacidade é desconhecida do mapa (ver
   * `conectorDaCapacidade`). Não grava evento — quem grava é `verificar`, e a
   * separação existe para a tela poder perguntar "o que estaria bloqueado?" sem
   * poluir o RASTRO.
   */
  async recusaDe(entrada: {
    orgId: string;
    capabilityId?: string | null;
    conector?: string | null;
  }): Promise<RecusaDeConector | null> {
    const conector = entrada.conector ?? conectorDaCapacidade(entrada.capabilityId);
    if (!conector) return null;

    const id = this.empresaDaConsulta(entrada.orgId, 'ConectoresService.recusaDe');
    const linha = await this.prisma.conectorDesligado.findUnique({
      where: { orgId_conector: { orgId: id, conector } },
      select: { motivo: true, desligadoPor: true, desligadoEm: true },
    });
    if (!linha) return null;

    return montarRecusa({
      conector,
      capabilityId: entrada.capabilityId ?? null,
      desligadoEm: linha.desligadoEm,
      desligadoPor: linha.desligadoPor,
      motivoDoDesligamento: linha.motivo,
    });
  }

  /**
   * A pergunta da PORTA: decide e, quando recusa, deixa registrado.
   *
   * É esta que o `ToolGateway` chama (ver a nota de FORA DO ESCOPO da fatia).
   * Devolver `RecusaDeConector` em vez de lançar é deliberado: a porta devolve
   * resultado, ela não estoura — um `throw` subindo por ali derrubaria o laço do
   * agente inteiro em vez de virar uma linha "recusado" com motivo.
   */
  async verificar(entrada: {
    orgId: string;
    capabilityId?: string | null;
    conector?: string | null;
    correlationId?: string | null;
    actorType?: ActorType | null;
    actorId?: string | null;
    agentSlug?: string | null;
  }): Promise<RecusaDeConector | null> {
    const recusa = await this.recusaDe(entrada);
    if (!recusa) return null;
    await this.registrarRecusa(entrada.orgId, recusa, entrada);
    return recusa;
  }

  /**
   * A mesma pergunta, para quem chama o conector DIRETO e não tem como devolver
   * resultado — um serviço de integração no meio de um método. Lança
   * `ConectorDesligadoError`, que é 403 com a frase pronta.
   */
  async exigirLigado(entrada: {
    orgId: string;
    capabilityId?: string | null;
    conector?: string | null;
    correlationId?: string | null;
    actorType?: ActorType | null;
    actorId?: string | null;
    agentSlug?: string | null;
  }): Promise<void> {
    const recusa = await this.verificar(entrada);
    if (recusa) throw new ConectorDesligadoError(recusa);
  }

  /**
   * Embrulha uma chamada de conector com o desligamento na frente.
   *
   * Existe para o efeito que já está escrito: `envolver('gmail', orgId, () =>
   * this.google.enviar(...))` põe a recusa ANTES da chamada externa sem que o
   * corpo do efeito precise saber que o desligamento existe. O conector é dito
   * explicitamente porque nem todo efeito carrega `capabilityId`.
   *
   * Como tudo aqui, exige o contexto de execução aberto na MESMA empresa do
   * argumento (ver `empresaDaConsulta`) — no caminho do agente isso já é
   * verdade, porque a porta abre o contexto em volta do efeito.
   */
  async envolver<T>(
    conector: string,
    orgId: string,
    fn: () => Promise<T>,
    extra: { capabilityId?: string | null } = {},
  ): Promise<T> {
    await this.exigirLigado({ orgId, conector, capabilityId: extra.capabilityId ?? null });
    return fn();
  }

  /**
   * DESLIGA. `alvo` é chave de conector (`gmail`) ou grupo (`google`, que vira
   * as quatro superfícies numa transação só).
   *
   * Idempotente: desligar o que já está desligado NÃO reescreve `desligadoEm` —
   * senão o "desde quando" da tela andaria para frente a cada clique repetido, e
   * é justamente essa data que a auditoria usa para saber desde quando o OS
   * parou de agir por aquele conector.
   */
  async desligar(
    orgId: string,
    alvo: string,
    opcoes: { motivo?: string | null; actorId?: string | null } = {},
  ): Promise<MudancaDeConector> {
    const id = this.empresaDaConsulta(orgId, 'ConectoresService.desligar');
    const conectores = expandirAlvo(alvo);
    const motivo = opcoes.motivo?.trim() ? opcoes.motivo.trim().slice(0, 500) : null;

    const novos = await this.prisma.$transaction(async (tx) => {
      const jaDesligados = new Set(
        (
          await tx.conectorDesligado.findMany({
            where: { orgId: id, conector: { in: conectores } },
            select: { conector: true },
          })
        ).map((l) => l.conector),
      );
      const aCriar = conectores.filter((c) => !jaDesligados.has(c));
      if (aCriar.length) {
        await tx.conectorDesligado.createMany({
          data: aCriar.map((conector) => ({
            orgId: id,
            conector,
            motivo,
            desligadoPor: opcoes.actorId ?? null,
          })),
          /*
           * A CORRIDA, e por que ela não pode virar 500.
           *
           * O `findMany` acima e o `createMany` não são atômicos entre si: dois
           * desligamentos simultâneos do mesmo alvo (duas abas, dois operadores
           * no mesmo incidente, um clique duplo) leem "não existe" ao mesmo
           * tempo e os dois tentam inserir. A segunda inserção bate no índice
           * único `(orgId, conector)` e, sem isto, estoura P2002 — a tela diria
           * "erro no servidor" no exato momento em que o conector ACABOU de ser
           * desligado com sucesso pela outra aba, e quem clicou procuraria outro
           * jeito de parar a máquina.
           *
           * `skipDuplicates` faz o perdedor da corrida virar no-op e preserva o
           * `desligadoEm` de quem chegou primeiro — que é a mesma garantia da
           * idempotência do parágrafo acima, agora também sob concorrência.
           *
           * O que fica aproximado é só `efetivados`, um campo de relatório: sob
           * corrida ele pode contar como "minha" a linha que o outro criou. É
           * ruído num contador; o estado no banco e o evento no RASTRO estão
           * certos nos dois lados.
           */
          skipDuplicates: true,
        });
      }
      // Ordenado como em `religar`: mesma forma quer dizer mesmo nome, mesmo
      // tipo E mesma ordem. Sem isto, desligar devolveria a ordem do grupo
      // (`gmail, gcal, gdocs, drive`) e religar a alfabética.
      return aCriar.sort();
    });

    await this.registrarMudanca(id, 'conector.desligado', {
      alvo,
      conectores,
      efetivados: novos,
      motivo,
      actorId: opcoes.actorId ?? null,
    });

    this.log.warn(
      `conector desligado para a empresa ${id}: ${conectores.join(', ')}` +
        (motivo ? ` — ${motivo}` : ''),
    );
    return { ok: true, conectores, efetivados: novos };
  }

  /**
   * RELIGA — apaga a(s) linha(s). NENHUMA CREDENCIAL É TOCADA aqui, e é a
   * ausência de código que garante isso: não há update em `GoogleAccount`, em
   * `IntegrationAccount` nem em `config`. Religar devolve o conector ao estado
   * exato de antes do desligamento, sem nova autorização.
   */
  async religar(
    orgId: string,
    alvo: string,
    opcoes: { actorId?: string | null } = {},
  ): Promise<MudancaDeConector> {
    const id = this.empresaDaConsulta(orgId, 'ConectoresService.religar');
    const conectores = expandirAlvo(alvo);

    /*
     * Ler ANTES de apagar, na mesma transação, para saber QUAIS voltaram e não
     * só quantas linhas sumiram. `deleteMany` devolve contagem, e contagem é o
     * que fazia religar responder num formato e desligar em outro. O evento do
     * RASTRO ganha a mesma lista nos dois sentidos — quem lê a auditoria seis
     * meses depois vê "voltaram gmail e gcal", não "2".
     */
    const religados = await this.prisma.$transaction(async (tx) => {
      const existentes = (
        await tx.conectorDesligado.findMany({
          where: { orgId: id, conector: { in: conectores } },
          select: { conector: true },
        })
      ).map((l) => l.conector);
      if (existentes.length) {
        await tx.conectorDesligado.deleteMany({
          where: { orgId: id, conector: { in: existentes } },
        });
      }
      return existentes.sort();
    });

    await this.registrarMudanca(id, 'conector.religado', {
      alvo,
      conectores,
      efetivados: religados,
      actorId: opcoes.actorId ?? null,
    });

    this.log.log(`conector religado para a empresa ${id}: ${conectores.join(', ')}`);
    return { ok: true, conectores, efetivados: religados };
  }

  /**
   * O evento da recusa. A falha em GRAVAR não vira liberação: a recusa já foi
   * decidida, e trocá-la por "deixa passar porque o log falhou" seria transformar
   * um problema de registro em envio de mensagem que ninguém autorizou.
   */
  private async registrarRecusa(
    orgId: string,
    recusa: RecusaDeConector,
    ctx: {
      correlationId?: string | null;
      actorType?: ActorType | null;
      actorId?: string | null;
      agentSlug?: string | null;
    },
  ): Promise<void> {
    const herdado = contextoAtual();
    try {
      await this.eventos.registrar({
        orgId,
        tipo: 'conector.recusado',
        actorType: ctx.actorType ?? herdado?.actorType ?? ActorType.ai,
        actorId: ctx.actorId ?? herdado?.actorId ?? null,
        agentSlug: ctx.agentSlug ?? herdado?.agentSlug ?? null,
        capabilityId: recusa.capabilityId,
        correlationId: ctx.correlationId ?? herdado?.correlationId ?? null,
        /*
         * `motivo` NÃO ENTRA AQUI, e sim no `conteudo` abaixo — uma vez só.
         *
         * `EventLogService.montar` espalha o `conteudo` por cima do `payload`,
         * então repetir a chave nos dois lados seria escrever o mesmo valor duas
         * vezes para que o vencedor coincidisse com o perdedor. O valor final é
         * o mesmo; o que se perde é a chance de os dois divergirem no dia em que
         * alguém melhorar uma das frases (a montagem passou a AVISAR quando isso
         * acontece, mas não precisar do aviso é melhor do que precisar).
         */
        payload: {
          conector: recusa.conector,
          rotulo: recusa.rotulo,
          motivoDoDesligamento: recusa.motivoDoDesligamento,
          desligadoEm: recusa.desligadoEm.toISOString(),
          desligadoPor: recusa.desligadoPor,
        },
        /*
         * O vocabulário da política, nas palavras dela (RF-R-03). Esta linha não
         * carrega nível — ela não é a execução de uma capacidade, é a porta
         * dizendo "não" —, então a conferência não cobra lista nenhuma aqui. Os
         * campos entram mesmo assim porque quem lê o RASTRO procura sempre as
         * mesmas palavras: `canal` é por onde a ação SAIRIA, `motivo` é a frase
         * que quem tentou recebeu, `resultado` é o que aconteceu de fato.
         */
        conteudo: {
          canal: recusa.conector,
          motivo: recusa.motivo,
          resultado: { recusado: true, rotulo: recusa.rotulo },
          argumentos: { capacidade: recusa.capabilityId, conector: recusa.conector },
        },
      });
    } catch (e) {
      this.log.error(
        `recusa de conector NÃO foi registrada no rastro (${recusa.conector}): ${(e as Error).message}` +
          ' — a recusa continua valendo',
      );
    }
  }

  /**
   * Desligar e religar entram no RASTRO e na auditoria.
   *
   * PROTEGIDO, e a assimetria com a decisão é deliberada. Aqui o registro vem
   * DEPOIS do efeito: a linha já foi gravada (ou apagada) e a transação já
   * fechou. Deixar a falha do log subir faria a rota responder erro para uma
   * ação que ACONTECEU — a tela diria "não consegui desligar" com o conector já
   * desligado, e quem clicou tentaria de novo, ou pior, procuraria outro jeito
   * de parar a máquina achando que nada mudou. O estado real é o que vale, e o
   * que se perde (uma linha de auditoria) sai no log em nível de erro, com o
   * bastante para reconstruir à mão.
   *
   * É o oposto de `registrarRecusa`, e pelo mesmo princípio: lá a falha do log
   * também não muda a decisão, e a decisão de lá é NÃO agir. Nos dois casos o
   * log nunca decide — ele só conta.
   *
   * Os dois destinos são tentados de forma independente: o RASTRO falhar não
   * pode levar a auditoria junto, e vice-versa.
   */
  private async registrarMudanca(
    orgId: string,
    tipo: 'conector.desligado' | 'conector.religado',
    payload: Record<string, unknown>,
  ): Promise<void> {
    const actorId = (payload.actorId as string | null) ?? null;
    const aviso = (onde: string, e: unknown) =>
      this.log.error(
        `${tipo} de ${String(payload.alvo ?? '?')} (empresa ${orgId}) NÃO foi registrado ` +
          `em ${onde}: ${(e as Error).message} — a mudança JÁ VALE no banco. ` +
          `Conteúdo perdido: ${JSON.stringify(payload)}`,
      );

    /*
     * O ANTES E O DEPOIS, nas palavras da política (`estadoAnterior`/`estadoNovo`).
     *
     * Só as chaves EFETIVADAS entram: desligar o que já estava desligado não
     * mudou estado nenhum, e escrever a lista inteira faria o RASTRO afirmar uma
     * mudança que não houve. É a mesma disciplina da idempotência de `desligar`,
     * que não move o `desligadoEm` de quem já estava fora.
     */
    const efetivados = (payload.efetivados as string[] | undefined) ?? [];
    const desligou = tipo === 'conector.desligado';
    const estado = (fora: boolean) => ({ conectores: efetivados, desligados: fora });

    try {
      await this.eventos.registrar({
        orgId,
        tipo,
        actorType: ActorType.user,
        actorId,
        correlationId: contextoAtual()?.correlationId ?? null,
        payload: payload as never,
        conteudo: {
          argumentos: { alvo: payload.alvo, conectores: payload.conectores },
          motivo: (payload.motivo as string | null) ?? null,
          estadoAnterior: estado(!desligou),
          estadoNovo: estado(desligou),
          resultado: { efetivados },
          desfazer: desligou ? 'conector.religar' : 'conector.desligar',
        },
        // A classificação do catálogo para `conector.desligar`/`religar`. Não há
        // conteúdo de cliente nesta linha — o que ela carrega é a decisão.
        sensibilidade: 'interna',
      });
    } catch (e) {
      aviso('o rastro', e);
    }

    try {
      await this.audit.log({
        orgId,
        actorId: actorId ?? undefined,
        action: tipo,
        entityType: 'conector',
        entityId: String(payload.alvo ?? ''),
        after: payload as never,
      });
    } catch (e) {
      aviso('a auditoria', e);
    }
  }
}
