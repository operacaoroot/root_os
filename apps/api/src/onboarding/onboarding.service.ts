import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, SessionCanal } from '@prisma/client';

import { AgentRuntime } from '../agents/agent-runtime.service';
import {
  CHAVE_DO_RETRATO,
  SLUG_DO_ASSISTENTE,
  TEMAS_DA_CARGA,
  chaveDoTema,
  precisaSemear,
  semearRoster,
  type ResumoDoRoster,
} from '../agents/roster';
import { AuditService } from '../audit/audit.service';
import { comContexto, contextoAtual, novaCorrelacao } from '../common/contexto-execucao';
import { EventLogService } from '../gateway/event-log.service';
import { MemoriaService } from '../memory/memoria.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProvisionamentoService } from '../tenants/provisionar.service';
import {
  abrirEmpresa,
  type Cadastro,
  type EntradaDoCadastro,
} from './cadastro';
import {
  estadoDaCarga,
  notaDoTema,
  type EstadoDaCarga,
  type NotaDaCarga,
  type RespostaGravada,
} from './carga-guiada';
import { espelharNoIndice } from './indice';
import {
  LINHAS_NO_HUB,
  estadoDaEntrada,
  fonteDaLinhaDoHub,
  type EstadoDaEntrada,
} from './passos';
import { RetratoSemFonteError, montarRetrato, type Retrato } from './retrato';

/**
 * A empresa não tem assistente inteiro — e por isso a pergunta livre recusa.
 *
 * NÃO É `NotFoundException`: a empresa existe, a carga existe, o que falta é um
 * agente que o próprio sistema devia ter criado. Quem lê a recusa precisa saber
 * que o conserto é automático e que basta recarregar a tela de entrada, porque
 * é a leitura de estado que re-semeia (`garantirRoster`).
 */
export class AssistenteIncompletoError extends Error {
  constructor(readonly faltaOAgente: boolean) {
    super(
      faltaOAgente
        ? 'esta empresa ainda não tem o assistente da central. Recarregue a tela de entrada: a ' +
          'leitura de estado cria o roster que faltou.'
        : 'o assistente desta empresa está sem procedimento, e um agente sem procedimento ' +
          'responderia com o prompt degradado em vez de recusar. Recarregue a tela de entrada: a ' +
          'leitura de estado grava o procedimento que faltou.',
    );
    this.name = 'AssistenteIncompletoError';
  }
}

/* ==========================================================================
 * A CASCA INJETÁVEL DA ENTRADA — RF-O-01, RF-O-02, RF-M-05
 * ==========================================================================
 *
 * As operações moram em arquivos puros (`cadastro.ts`, `carga-guiada.ts`,
 * `retrato.ts`), sem Nest, porque nada que dependa de injeção roda sob o vitest
 * — é o mesmo desenho de `tenants/provisionar.ts`. Aqui entra só o que o Nest
 * sabe dar:
 *
 *   · o PROVISIONAMENTO, que já é idempotente e já registra tudo;
 *   · a MEMÓRIA, que é quem grava nota com versão, procedência e RASTRO;
 *   · o RASTRO dos marcos da própria entrada;
 *   · a AUDITORIA da rota anônima de cadastro;
 *   · o LAÇO DO AGENTE, para a pergunta livre depois da carga.
 */
@Injectable()
export class OnboardingService {
  private readonly log = new Logger('Onboarding');

  constructor(
    private readonly prisma: PrismaService,
    private readonly provisionamento: ProvisionamentoService,
    private readonly memoria: MemoriaService,
    private readonly eventos: EventLogService,
    private readonly auditoria: AuditService,
    private readonly runtime: AgentRuntime,
  ) {}

  // ==========================================================================
  // 1. CADASTRO — a rota anônima
  // ==========================================================================

  /**
   * Abre a empresa e semeia o roster dela.
   *
   * `actorType: 'system'`, e não `user`: quem chama não tem sessão — é esse o
   * ponto do degrau de entrada. O e-mail informado vira o primeiro
   * administrador e a identidade dele é conferida no login com a conta Google,
   * que exige e-mail verificado pelo próprio Google.
   */
  async cadastrar(entrada: EntradaDoCadastro): Promise<Cadastro> {
    const cadastro = await abrirEmpresa(entrada, {
      provisionar: (e) =>
        this.provisionamento.provisionar(e, { tipo: 'system', origem: 'http' }),
      semear: (orgId, donoId) => this.semear(orgId, donoId),
    });

    await this.marco(cadastro.orgId, 'onboarding.empresa.aberta', {
      slug: cadastro.slug,
      nome: cadastro.nome,
      colisoes: cadastro.colisoes,
      agentesCriados: cadastro.roster?.criados ?? [],
    });

    for (const aviso of cadastro.avisos) this.log.warn(`empresa ${cadastro.slug}: ${aviso}`);
    return cadastro;
  }

  /** Semeia o roster dentro do contexto da empresa nova. */
  private semear(orgId: string, donoId: string | null): Promise<ResumoDoRoster> {
    return comContexto(
      {
        orgId,
        actorType: 'system',
        actorId: null,
        correlationId: contextoAtual()?.correlationId ?? novaCorrelacao('onboarding'),
        origem: contextoAtual()?.origem ?? 'http',
      },
      () => semearRoster(this.prisma, orgId, { donoId }),
    );
  }

  /**
   * A linha de auditoria da rota anônima — inclusive quando ela não criou nada.
   *
   * Mora na empresa NOVA quando houve uma; quando a tentativa foi recusada não
   * há empresa onde caber, e a recusa fica só no log. É a mesma limitação que
   * `provisionar.service.ts` descreve em `ordenante()`, e pelo mesmo motivo:
   * `AuditLog.orgId` tem chave estrangeira para `Org`.
   */
  async auditarCadastro(
    orgId: string | null,
    action: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    if (!orgId) {
      this.log.warn(`cadastro (${action}): sem empresa onde auditar — ${JSON.stringify(metadata)}`);
      return;
    }
    await comContexto(
      {
        orgId,
        actorType: 'system',
        actorId: null,
        correlationId: contextoAtual()?.correlationId ?? novaCorrelacao('onboarding'),
        origem: 'http',
      },
      () =>
        this.auditoria
          .log({
            orgId,
            actorType: 'system',
            action,
            entityType: 'org',
            entityId: orgId,
            metadata: metadata as Prisma.InputJsonValue,
          })
          .catch(() => undefined),
    );
  }

  // ==========================================================================
  // 2. ESTADO — derivado, nunca guardado
  // ==========================================================================

  async estado(orgId: string): Promise<EstadoDaEntrada> {
    const empresa = await this.prisma.org.findUnique({
      where: { id: orgId },
      select: { name: true, slug: true },
    });
    if (!empresa) throw new NotFoundException('empresa não encontrada.');

    await this.garantirRoster(orgId);

    const [carga, temRetrato, fontes] = await Promise.all([
      this.carga(orgId),
      this.prisma.contextItem.count({
        where: { orgId, chave: CHAVE_DO_RETRATO, arquivadoEm: null },
      }),
      /*
       * A CONSULTA É PELAS LINHAS DO HUB, e não pela chave do contrato — ver
       * `FonteDaEntrada.linhasNoHub`. `IntegrationAccount.key` guarda `gmail`,
       * `gcal`, `gdocs`, `drive` e `instagram`; filtrar por `'google'` aqui
       * devolveria zero linha SEMPRE, e a tela diria "nada conectado" para uma
       * empresa que acabou de autorizar.
       */
      this.prisma.integrationAccount.findMany({
        where: { orgId, status: 'connected', key: { in: [...LINHAS_NO_HUB] } },
        select: { key: true },
      }),
    ]);

    return estadoDaEntrada({
      empresa: { nome: empresa.name, slug: empresa.slug },
      // Uma fonte por CONTRATO, não quatro por superfície: quem autorizou a
      // conta Google conectou uma coisa, não quatro.
      fontesConectadas: [
        ...new Set(fontes.map((f) => fonteDaLinhaDoHub(f.key)).filter((c): c is string => !!c)),
      ],
      carga,
      temRetrato: temRetrato > 0,
    });
  }

  /**
   * A empresa tem os agentes do roster, com procedimento?
   *
   * RODA EM TODA LEITURA DE ESTADO, e é ele que faz o cabeçalho de `semear.ts`
   * dizer a verdade. O cadastro são DUAS escritas sem transação comum: quando a
   * segunda falha (ou o processo morre no meio), a empresa fica com agente sem
   * procedimento — ou sem agente nenhum — e nada re-semeava.
   *
   * `precisaSemear` primeiro, e a semente só quando falta: duas consultas numa
   * recarga de tela contra os quinze comandos da semente. Escrita dentro de um caminho de
   * LEITURA é decisão consciente e é o preço de não ter ninguém da ROOT no
   * caminho — conserto que depende de alguém rodar um comando não existe para
   * quem entrou sozinho num sábado. É idempotente e não toca no que é decisão
   * de gente (estado, dono, autonomia — ver `semearRoster`).
   *
   * FALHA AQUI NÃO DERRUBA A TELA: sem o roster a carga guiada continua
   * funcionando (ela não usa agente nenhum); quem depende dele é a pergunta
   * livre, e ela recusa por conta própria com o motivo escrito.
   */
  private async garantirRoster(orgId: string): Promise<void> {
    try {
      if (!(await precisaSemear(this.prisma, orgId))) return;
      const dono = await this.prisma.user.findFirst({
        where: { orgId },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      const resumo = await this.semear(orgId, dono?.id ?? null);
      this.log.warn(
        `empresa ${orgId}: o roster de entrada estava incompleto e foi RE-SEMEADO ` +
          `(criados: ${resumo.criados.join(', ') || 'nenhum'}; procedimentos: ` +
          `${resumo.procedimentos.join(', ') || 'nenhum'}). Isso quer dizer que o cadastro ` +
          'terminou pela metade — procure a falha da semente no log daquele momento.',
      );
    } catch (e) {
      this.log.error(
        `empresa ${orgId}: não consegui reparar o roster de entrada (${(e as Error).message}). ` +
          'A carga guiada segue; a pergunta livre vai recusar até isto ser resolvido.',
      );
    }
  }

  /** O estado da carga, lido das notas que existem. Ver `estadoDaCarga`. */
  private async carga(orgId: string): Promise<EstadoDaCarga> {
    const chaves = TEMAS_DA_CARGA.map((t) => chaveDoTema(t.id));
    const notas = await this.prisma.contextItem.findMany({
      /*
       * `arquivadoEm: null` AQUI e em `fechar`, e a MESMA conferência dentro de
       * `responder` — as três leituras precisam concordar sobre o que conta
       * como respondido.
       *
       * A divergência custou um defeito de laço infinito: esta consulta filtrava
       * a arquivada (o tema sumia do estado e voltava a ser perguntado),
       * `responder` achava a nota arquivada pela chave e a alterava SEM
       * desarquivar, e a unicidade de `(orgId, chave)` impedia criar outra. A
       * mesma pergunta para sempre, e o tema pendente para sempre. O conserto
       * está em `responder`: quem responde um tema arquivado o RESTAURA.
       */
      where: { orgId, chave: { in: chaves }, arquivadoEm: null, acessoRestrito: false },
      select: { chave: true, body: true, versao: true },
    });
    const gravadas: RespostaGravada[] = notas.map((n) => ({
      temaId: n.chave.replace(/^onboarding:/, ''),
      corpo: n.body,
      versao: n.versao,
    }));
    return estadoDaCarga(gravadas);
  }

  // ==========================================================================
  // 3. A CARGA GUIADA
  // ==========================================================================

  /**
   * A resposta de um tema vira nota da memória.
   *
   * A ESTRUTURAÇÃO É DO PROCEDIMENTO (`notaDoTema`), não de quem respondeu:
   * título, espécie, etiquetas, chave estável e procedência vêm de lá. O que
   * chega da tela é só o corpo.
   *
   * Responder de novo CORRIGE em vez de duplicar — a chave estável é a mesma e
   * o caminho é `alterar`, que produz uma versão nova com motivo próprio
   * (RF-M-01). É o que faz a carga poder ser reaberta sem sujar a memória.
   */
  async responder(
    orgId: string,
    temaId: string,
    resposta: string,
  ): Promise<{ estado: EstadoDaEntrada; notaId: string; versao: number }> {
    const nota = notaDoTema(temaId, resposta);
    const gravada = await this.gravarNotaDaCarga(orgId, nota, `${nota.motivo} (resposta revista)`);
    await this.espelhar(orgId, nota);

    return { estado: await this.estado(orgId), notaId: gravada.id, versao: gravada.versao };
  }

  /**
   * Grava (ou regrava) uma nota de chave estável da entrada.
   *
   * TRÊS CASOS, e os dois últimos são defeitos que a revisão pegou:
   *
   *  1. NÃO EXISTE → `criar`;
   *  2. EXISTE E ESTÁ ARQUIVADA → `restaurar` e depois `alterar`. Sem a
   *     restauração o tema ficava em LAÇO: a leitura de estado filtra
   *     arquivada, então ele voltava a ser perguntado; a resposta achava a nota
   *     pela chave e a alterava ainda arquivada; a unicidade de `(orgId, chave)`
   *     impedia criar outra. A mesma pergunta para sempre, e o retrato listando
   *     o tema como pendente para sempre. É exatamente a divergência entre
   *     gravar o fato e marcar o passo que o estado derivado deveria evitar — e
   *     não evitava, porque três leituras não concordavam sobre "respondido".
   *     A sequência `restaurar` → `alterar` é a MESMA de
   *     `MemoriaService.projetarUmaNota`, que já resolvia isto para a vault;
   *  3. DUAS ABAS AO MESMO TEMPO → as duas leem "não existe", as duas chamam
   *     `criar`, a segunda bate no índice único. A memória traduz isso para
   *     `ConflictException` ("Já existe uma nota com esta chave"), que chegava à
   *     tela como conflito sem explicação nenhuma sobre o que fazer. Aqui a
   *     segunda tentativa relê e ALTERA: responder duas vezes é corrigir, que é
   *     o contrato da chave estável, e não um erro.
   */
  private async gravarNotaDaCarga(
    orgId: string,
    nota: NotaDaCarga,
    motivoDaRevisao: string,
  ): Promise<{ id: string; versao: number }> {
    const alterar = async (id: string, arquivada: boolean) => {
      if (arquivada) {
        await this.memoria.restaurar(
          orgId,
          id,
          'o tema voltou a ser respondido na carga guiada de entrada',
        );
      }
      return this.memoria.alterar(orgId, id, {
        title: nota.titulo,
        body: nota.corpo,
        kind: nota.kind,
        tags: nota.tags,
        sourceType: nota.sourceType,
        sourceRef: nota.sourceRef,
        motivo: motivoDaRevisao,
      });
    };

    const existente = await this.memoria.porChave(orgId, nota.chave);
    if (existente) return alterar(existente.id, !!existente.arquivadoEm);

    try {
      return await this.memoria.criar(orgId, {
        chave: nota.chave,
        title: nota.titulo,
        body: nota.corpo,
        kind: nota.kind,
        tags: nota.tags,
        sourceType: nota.sourceType,
        sourceRef: nota.sourceRef,
        motivo: nota.motivo,
      });
    } catch (e) {
      // A corrida. Quem chegou primeiro criou; esta chamada vira correção.
      const agora = await this.memoria.porChave(orgId, nota.chave);
      if (!agora) throw e;
      this.log.warn(
        `empresa ${orgId}: a nota "${nota.chave}" foi criada por outra aba no mesmo instante; ` +
          'esta resposta virou uma versão nova da mesma nota, não um erro.',
      );
      return alterar(agora.id, !!agora.arquivadoEm);
    }
  }

  /**
   * O espelho no índice de busca. Falha aqui NÃO derruba a carga — ver
   * `indice.ts`: a memória canônica já foi gravada, e o que se perde é alcance
   * da busca, não o contexto.
   */
  private async espelhar(
    orgId: string,
    nota: { chave: string; titulo: string; corpo: string; tags: readonly string[] },
  ): Promise<void> {
    try {
      await espelharNoIndice(this.prisma, orgId, nota);
    } catch (e) {
      this.log.warn(
        `empresa ${orgId}: a nota "${nota.chave}" foi gravada na memória mas NÃO entrou no ` +
          `índice de busca (${(e as Error).message}). O contexto está salvo; o que se perde é a ` +
          'chance de o agente achá-la sozinho.',
      );
    }
  }

  // ==========================================================================
  // 4. O FECHO — a primeira resposta, com fonte por construção
  // ==========================================================================

  /**
   * Lê de volta o que a carga entendeu e grava o retrato na memória.
   *
   * Idempotente: rodar de novo reescreve o retrato (versão nova da mesma nota),
   * nunca um segundo retrato. É o mesmo princípio da chave estável dos temas.
   */
  async fechar(orgId: string): Promise<Retrato & { notaId: string; versao: number }> {
    const empresa = await this.prisma.org.findUnique({
      where: { id: orgId },
      select: { name: true, slug: true },
    });
    if (!empresa) throw new NotFoundException('empresa não encontrada.');

    const chaves = TEMAS_DA_CARGA.map((t) => chaveDoTema(t.id));
    const notas = await this.prisma.contextItem.findMany({
      where: { orgId, chave: { in: chaves }, arquivadoEm: null, acessoRestrito: false },
      select: {
        id: true,
        chave: true,
        title: true,
        body: true,
        // `tags` entra porque o espelho é REFEITO aqui e a etiqueta faz parte
        // dele — ver o bloco do reespelho, mais abaixo.
        tags: true,
        sourceType: true,
        sourceRef: true,
        versao: true,
      },
    });

    const retrato = montarRetrato(
      notas.map((n) => ({
        id: n.id,
        chave: n.chave,
        titulo: n.title,
        corpo: n.body,
        procedencia: n.sourceRef ? `${n.sourceType}:${n.sourceRef}` : String(n.sourceType),
        versao: n.versao,
      })),
      { nome: empresa.name, slug: empresa.slug },
    );

    const dados = retrato.nota;
    if (!dados) throw new RetratoSemFonteError();
    const gravada = await this.gravarNotaDaCarga(orgId, dados, `${dados.motivo} (relido)`);

    /*
     * O ESPELHO É REFEITO AQUI, E NÃO SÓ ACRESCENTADO — o conserto da perda que
     * a revisão encontrou.
     *
     * `ObsidianService.reindex` (`POST /api/knowledge/reindex`) APAGA
     * `KnowledgeNote` da empresa inteira (`deleteMany({ where: { orgId } })`) e
     * repovoa a partir do vault ÚNICO do ambiente. Numa empresa cliente isso
     * some com o espelho da carga e enche o índice dela com as notas da casa —
     * e a permissão que libera aquela rota (`obsidian.editar`) é A MESMA que
     * esta carga exige, ou seja, quem carrega o contexto pode disparar aquilo
     * sem passar por ninguém.
     *
     * A memória canônica sobrevive (é `ContextItem`, e o estado da entrada é
     * derivado dela), então o que se perde é ALCANCE da busca, não o contexto.
     * Reespelhar aqui faz de "ler de volta" também o conserto: uma volta pelo
     * fecho da carga devolve as notas ao índice. Não é a solução — a solução é
     * o `reindex` respeitar origem, e está em FORA DO ESCOPO no relatório —,
     * mas é a diferença entre uma perda silenciosa e uma perda que o próprio
     * caminho repara.
     */
    for (const n of notas) {
      await this.espelhar(orgId, {
        chave: n.chave,
        titulo: n.title,
        corpo: n.body,
        tags: n.tags,
      });
    }
    await this.espelhar(orgId, {
      chave: dados.chave,
      titulo: dados.titulo,
      corpo: dados.corpo,
      tags: dados.tags,
    });

    await this.marco(orgId, 'onboarding.contexto.carregado', {
      temas: retrato.fontes.map((f) => f.ref),
      pendentes: retrato.pendentes,
      fontes: retrato.fontes.length,
    });

    return { ...retrato, notaId: gravada.id, versao: gravada.versao };
  }

  // ==========================================================================
  // 5. A PERGUNTA LIVRE — o laço de verdade, com a procedência MEDIDA
  // ==========================================================================

  /**
   * A primeira pergunta livre ao assistente.
   *
   * O QUE ESTA ROTA DEVOLVE A MAIS, e é o motivo de ela existir aqui em vez de
   * a tela chamar `/agents/:slug/executar` direto: ela RELATA a procedência
   * medida pelo mecanismo de verdade (`Session.semProcedencia`, calculado por
   * `respostaSemProcedencia` no laço) em vez de prometê-la.
   *
   * Quando a resposta sai sem fonte, a rota DIZ isso — com o efeito, que não é
   * cosmético: as ações seguintes daquele agente sobem um degrau na régua por
   * 24h, e numa empresa com um aprovador só isso trava a operação. Esconder
   * seria transformar o controle da onda 10 em armadilha para o cliente novo.
   */
  async primeiraPergunta(
    orgId: string,
    pergunta: string,
    quem: { id: string; rotulo: string },
  ): Promise<{
    resposta: string;
    status: string;
    fontes: { tipo: string; titulo?: string; ref?: string }[];
    procedencia: { tem: boolean; aviso: string | null };
    sessionId: string;
  }> {
    await this.exigirAssistenteInteiro(orgId);

    const sessao = await this.runtime.executar({
      orgId,
      agentSlug: SLUG_DO_ASSISTENTE,
      canal: SessionCanal.web,
      pedido: pergunta,
      solicitanteId: quem.id,
      solicitanteRotulo: quem.rotulo,
    });

    /*
     * `nota` e `ferramenta` são as fontes de DADO; `regra` é configuração e não
     * sustenta afirmação nenhuma. O critério é o mesmo de `TIPOS_DE_DADO`, em
     * `agents/context-builder.service.ts` — repetido aqui porque aquele
     * conjunto não é exportado, e não porque a regra seja outra.
     */
    const comDado = sessao.fontes.filter((f) => f.tipo === 'nota' || f.tipo === 'ferramenta');

    return {
      resposta: sessao.resposta,
      status: String(sessao.status),
      fontes: sessao.fontes.map((f) => ({
        tipo: String(f.tipo),
        titulo: (f as { titulo?: string }).titulo,
        ref: (f as { ref?: string }).ref,
      })),
      procedencia: {
        tem: comDado.length > 0,
        aviso: comDado.length
          ? null
          : 'esta resposta saiu sem nenhuma fonte de dado. Se ela afirmar número, a sessão é ' +
            'marcada e as ações seguintes deste agente sobem um degrau na régua por 24 horas. ' +
            'Carregue mais contexto antes de confiar nela.',
      },
      sessionId: sessao.sessionId,
    };
  }

  /**
   * O assistente existe E tem procedimento? Se não, RECUSA antes de gastar.
   *
   * POR QUE A CONFERÊNCIA É AQUI E NÃO NO LAÇO: `impedimento()`
   * (`agents/agent-runtime.service.ts`) olha estado, `ativo` e capacidades — e
   * NÃO olha o procedimento. Um agente sem `Sop` não é recusado por ele: o
   * prompt sai sem o bloco PROCEDIMENTO (`montarSop` simplesmente o omite) e o
   * modelo responde como se nada faltasse. Numa empresa recém-criada esse é
   * justamente o estado que um cadastro interrompido no meio deixa para trás, e
   * a resposta degradada seria a PRIMEIRA coisa que a pessoa vê do produto.
   *
   * Consertar aquilo dentro do runtime é a resposta certa e não é desta fatia
   * (está no relatório, em FORA DO ESCOPO). Aqui a recusa é explícita, com o
   * motivo escrito e com o conserto já disparado: `estado()` re-semeia, então
   * recarregar a tela costuma bastar.
   */
  private async exigirAssistenteInteiro(orgId: string): Promise<void> {
    const agente = await this.prisma.agent.findUnique({
      where: { orgId_slug: { orgId, slug: SLUG_DO_ASSISTENTE } },
      select: { id: true, sop: { select: { id: true } } },
    });
    if (agente?.sop) return;
    throw new AssistenteIncompletoError(!agente);
  }

  // ==========================================================================
  // O RASTRO DOS MARCOS
  // ==========================================================================

  /**
   * Um marco da entrada no RASTRO da empresa.
   *
   * NÃO DERRUBA A OPERAÇÃO quando falha — e a diferença para o provisionamento
   * é deliberada: lá o registro da INTENÇÃO é pré-condição da escrita
   * (02-CONSTRAINTS §5), porque a escrita cria uma empresa. Aqui o fato já
   * aconteceu e já está registrado pela memória (`memoria.item.*`), que é quem
   * guarda o conteúdo; este marco é o índice do caminho de entrada. Derrubar a
   * carga por causa dele trocaria um registro por um cliente.
   *
   * `conteudo` traz só o vocabulário da política — nunca o corpo da resposta do
   * cliente. O corpo está na memória, que se lê com `obsidian.ver`; o RASTRO se
   * lê com `auditoria.ver`. São públicos diferentes, e o texto do cliente não
   * atravessa essa fronteira por conveniência de registro.
   */
  private async marco(
    orgId: string,
    tipo: string,
    dados: Record<string, unknown>,
  ): Promise<void> {
    try {
      await comContexto(
        {
          orgId,
          actorType: contextoAtual()?.actorType ?? 'system',
          actorId: contextoAtual()?.actorId ?? null,
          correlationId: contextoAtual()?.correlationId ?? novaCorrelacao('onboarding'),
          origem: contextoAtual()?.origem ?? 'http',
        },
        () =>
          this.eventos.registrar({
            orgId,
            tipo,
            actorType: contextoAtual()?.actorType ?? 'system',
            actorId: contextoAtual()?.actorId ?? null,
            correlationId: contextoAtual()?.correlationId ?? null,
            payload: dados as Prisma.InputJsonValue,
            conteudo: {
              argumentos: dados,
              motivo: 'degrau de entrada do produto (RF-O-01)',
              fontes: [{ tipo: 'onboarding', id: orgId }],
            },
            sensibilidade: 'interna',
          }),
      );
    } catch (e) {
      this.log.warn(
        `empresa ${orgId}: o marco "${tipo}" não foi registrado (${(e as Error).message}). ` +
          'O fato em si está no RASTRO da memória (memoria.item.*); o que se perde é o índice ' +
          'do caminho de entrada.',
      );
    }
  }
}
