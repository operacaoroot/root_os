import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ActorType,
  ContextChange,
  ContextKind,
  ContextSource,
  Prisma,
} from '@prisma/client';
import { contextoAtual } from '../common/contexto-execucao';
import { EventLogService, sigiloso } from '../gateway/event-log.service';
import { comTenantResolvido } from '../common/contexto-execucao';
import { PrismaService } from '../prisma/prisma.service';
import {
  AGENT_MEMORY_FIELDS,
  AgentDataGrantService,
  type AgentMemoryField,
} from './agent-data-grant.service';
import {
  chaveDaVault,
  exigirProcedencia,
  formaDoCorpo,
  hashDoCorpo,
  referenciaDaVersao,
  rotuloDeProcedencia,
  SEM_EVENTO,
  type SemEventoPorque,
} from './procedencia';

/*
 * ============================================================================
 * A MEMÓRIA — RF-M-01 (contexto versionado) e RF-M-06 (resposta vira nota)
 * ============================================================================
 *
 * O DESENHO ESTÁ EM `docs/adr/ADR-011-memoria.md` e em uma frase é: toda
 * mudança da memória é um EVENTO no RASTRO que já existe (`EventLogService`), e
 * `ContextItem` / `ContextItemVersion` são PROJEÇÃO dele. Quem for acrescentar
 * um caminho de escrita passa por aqui — um segundo lugar que mexesse na
 * memória sem escrever o evento seria uma segunda verdade sobre o mesmo fato.
 *
 * ----------------------------------------------------------------------------
 * A ORDEM DAS TRÊS ESCRITAS, E POR QUE NÃO É UMA TRANSAÇÃO SÓ
 * ----------------------------------------------------------------------------
 *  1. `$transaction` LÊ o estado corrente e grava o item e a versão, tudo sob o
 *     advisory lock da empresa;
 *  2. o EVENTO é registrado depois do commit. `EventLogService.registrar` abre
 *     transação PRÓPRIA (ele precisa do advisory lock da empresa para a
 *     sequência do rastro); chamá-lo de dentro da nossa pegaria uma segunda
 *     conexão esperando um cadeado que só a primeira solta — é o formato
 *     clássico de travar o pool;
 *  3. a versão recebe `eventoId`/`eventoSeq` num `update` curto.
 *
 * A LEITURA MORA DENTRO DO CADEADO, E ISSO NÃO É ZELO — É O CONSERTO DE UM
 * DEFEITO MEDIDO. A primeira versão desta fatia lia o estado corrente FORA da
 * transação, montava os dados a partir daquela leitura e só então pegava o
 * cadeado, que protegia apenas a numeração. Duas alterações concorrentes da
 * mesma nota liam a versão 1, a primeira gravava a 2 e a segunda gravava a 3
 * COM OS DADOS DA 1 — a alteração do meio desaparecia sem evento nenhum dizendo
 * que desapareceu, e os dois eventos declaravam `estadoAnterior` na mesma versão
 * 1. A cadeia mentia. Medido na revisão: 12 corridas, 12 perdas. Por isso quem
 * chama `gravarVersao` passa uma FUNÇÃO que monta os dados a partir do estado
 * que a transação leu, nunca um objeto pronto montado antes dela.
 *
 * O QUE ACONTECE SE O PASSO 2 FALHAR: a memória fica gravada e a versão fica
 * com `eventoId` nulo E `semEventoPorque = 'falha_ao_registrar'`. É de
 * propósito, e é a regra da casa — o rastro nunca derruba a operação (ver
 * `integrations/conectores.service.ts`). O MOTIVO ESCRITO É O SINAL: sem ele, a
 * versão que falhou e a versão que veio da migração do acervo (que de propósito
 * não escreve evento) ficariam idênticas, e centenas de linhas migradas teriam
 * cara de falha de rastro.
 *
 * ----------------------------------------------------------------------------
 * O QUE ESTE SERVIÇO NÃO FAZ
 * ----------------------------------------------------------------------------
 *  · NÃO chama fornecedor de embedding. Vetor entra por quem já fala com o
 *    fornecedor (`ObsidianService`), e a razão é a catraca de arquitetura: o
 *    endereço e a credencial do fornecedor moram no conector dele, e mais em
 *    lugar nenhum. Ver FORA DO ESCOPO no relatório da fatia.
 *  · NÃO monta contexto para o modelo. Nota é CONTEÚDO EXTERNO e o caminho até
 *    o modelo é `context-builder.service.ts`, com cerca, neutralização e marca
 *    de procedência. Esta fatia não abre caminho novo, e é por isso que o
 *    inventário de cercas da suíte adversarial continua com os três de hoje.
 */

/** O tipo de evento de cada mudança. Um por valor de `ContextChange`. */
const TIPO_DE_EVENTO: Record<ContextChange, string> = {
  [ContextChange.criacao]: 'memoria.item.criado',
  [ContextChange.alteracao]: 'memoria.item.alterado',
  [ContextChange.arquivamento]: 'memoria.item.arquivado',
  [ContextChange.restauracao]: 'memoria.item.restaurado',
};

export interface EntradaDeNota {
  chave: string;
  kind?: ContextKind;
  title: string;
  body: string;
  tags?: string[];
  sourceType: ContextSource;
  sourceRef?: string | null;
  validFrom?: Date | null;
  validUntil?: Date | null;
  confidence?: number;
  /** O vetor, quando quem chama já o tem. Ver "o que este serviço não faz". */
  embedding?: number[] | null;
  motivo?: string | null;
}

export type MudancaDeNota = Partial<Omit<EntradaDeNota, 'chave'>> & { motivo?: string | null };

export interface NotaDeContexto {
  id: string;
  chave: string;
  kind: ContextKind;
  title: string;
  body: string;
  tags: string[];
  /** A procedência, nos dois formatos: os campos crus e o rótulo montado. */
  sourceType: ContextSource;
  sourceRef: string | null;
  procedencia: string;
  validFrom: string | null;
  validUntil: string | null;
  supersedesId: string | null;
  confidence: number;
  contentHash: string;
  versao: number;
  temVetor: boolean;
  arquivadoEm: string | null;
  criadoEm: string;
  atualizadoEm: string;
}

export interface VersaoDeNota {
  id: string;
  versao: number;
  mudanca: ContextChange;
  kind: ContextKind;
  title: string;
  body: string;
  sourceType: ContextSource;
  sourceRef: string | null;
  procedencia: string;
  contentHash: string;
  motivo: string | null;
  autorTipo: string;
  autorId: string | null;
  /**
   * O elo com o RASTRO. Nulo em três situações DIFERENTES, e o par de campos
   * abaixo é o que as separa — ver `conferirElos`.
   */
  eventoId: string | null;
  eventoSeq: string | null;
  /** `migracao` · `falha_ao_registrar` · nulo. Ver `SEM_EVENTO`. */
  semEventoPorque: string | null;
  criadoEm: string;
}

export interface AchadoDeMemoria extends NotaDeContexto {
  score: number;
}

export interface ResultadoDeBusca {
  query: string;
  modo: 'semantica' | 'textual';
  itens: AchadoDeMemoria[];
  fonte: { tool: 'memoria'; generatedAt: string };
}

export interface ResultadoDeBuscaDoAgente {
  query: string;
  modo: 'textual';
  diagnostico: 'ok' | 'sem_consentimento' | 'sem_campo_pesquisavel';
  itens: Array<{
    id: string;
    score: 0;
    sourceType: ContextSource;
    sourceRef: string;
    fields: Partial<Record<AgentMemoryField, unknown>>;
  }>;
  fonte: { tool: 'memoria'; generatedAt: string };
}

export interface AtorDaBuscaDoAgente {
  userId?: string;
  tokenId?: string;
}

interface DecisaoDaMemoriaDoAgente {
  modo: 'textual' | 'leitura';
  diagnostico: string;
  quantidade: number;
  fontes: Array<{ sourceType: ContextSource; sourceRef: string }>;
  campos: string[];
  recursoId?: string;
}

/** O que uma volta de projeção da vault mexeu. É o que a sonda e o CLI mostram. */
export interface ResumoDaProjecao {
  criadas: number;
  alteradas: number;
  inalteradas: number;
  arquivadas: number;
  /** Notas que falharam NESTA VOLTA. Uma nota ruim não derruba as outras. */
  falhas: number;
  /**
   * Arquivamentos que a guarda RECUSOU por parecerem vault sumida em vez de
   * arquivo apagado. Diferente de zero é incidente, não estatística.
   */
  arquivamentoRecusado: number;
}

/**
 * A vault respondeu de um jeito que não dá para acreditar.
 *
 * Não é erro de leitura de disco — é resposta VÁLIDA e suspeita: a lista veio
 * vazia enquanto a memória tem notas daquela origem. Ver a guarda em
 * `projetarDaVault`.
 */
export class VaultSuspeitaError extends Error {}

/**
 * ABAIXO DISTO, PROPORÇÃO NÃO DIZ NADA. Com três notas na memória, arquivar uma
 * é 33% e é só alguém tendo apagado um arquivo.
 */
const PISO_DE_ARQUIVAMENTO = 5;

/**
 * A fração das notas vivas da vault que UMA volta pode arquivar.
 *
 * Não é número mágico: é o reconhecimento de que apagar 20% da vault de uma vez
 * é coisa que uma pessoa faz devagar e um ponto de montagem faz de uma vez. O
 * custo de errar para o lado apertado é uma linha de log e um arquivamento que
 * acontece na volta seguinte, à mão; para o outro lado, é o histórico inteiro
 * da empresa arquivado — uma versão e um evento por nota, e outro par quando a
 * pasta voltar.
 */
const TETO_DE_ARQUIVAMENTO = 0.2;

@Injectable()
export class MemoriaService {
  private readonly log = new Logger('Memoria');

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: EventLogService,
    private readonly agentGrants: AgentDataGrantService,
  ) {}

  // ==========================================================================
  // LEITURA
  // ==========================================================================

  async listar(
    orgId: string,
    opcoes: { kind?: ContextKind; incluirArquivadas?: boolean } = {},
  ): Promise<{ itens: NotaDeContexto[]; total: number; comVetor: number }> {
    const linhas = await this.prisma.contextItem.findMany({
      where: {
        orgId,
        ...(opcoes.kind ? { kind: opcoes.kind } : {}),
        ...(opcoes.incluirArquivadas ? {} : { arquivadoEm: null }),
      },
      orderBy: { atualizadoEm: 'desc' },
      select: SELECAO_DA_NOTA,
    });
    const comVetor = await this.contarComVetor(orgId);
    return {
      itens: await this.comVetor(orgId, linhas),
      total: linhas.length,
      comVetor,
    };
  }

  async obter(orgId: string, id: string): Promise<NotaDeContexto | null> {
    const linha = await this.prisma.contextItem.findFirst({
      where: { id, orgId },
      select: SELECAO_DA_NOTA,
    });
    if (!linha) return null;
    return (await this.comVetor(orgId, [linha]))[0];
  }

  async porChave(orgId: string, chave: string): Promise<NotaDeContexto | null> {
    const linha = await this.prisma.contextItem.findFirst({
      where: { orgId, chave },
      select: SELECAO_DA_NOTA,
    });
    if (!linha) return null;
    return (await this.comVetor(orgId, [linha]))[0];
  }

  /**
   * O HISTÓRICO — RF-M-01.
   *
   * A projeção das mudanças, da mais nova para a mais velha. Cada linha carrega
   * o elo com o evento do RASTRO que a produziu: é por ele que se prova, no
   * `GET /audit/verificar`, que a versão não foi escrita por fora.
   */
  async historico(orgId: string, id: string): Promise<VersaoDeNota[]> {
    const existe = await this.prisma.contextItem.count({ where: { id, orgId } });
    if (!existe) throw new NotFoundException('Nota não encontrada nesta empresa.');
    const linhas = await this.prisma.contextItemVersion.findMany({
      where: { orgId, itemId: id },
      orderBy: { versao: 'desc' },
    });
    return linhas.map(paraVersao);
  }

  // ==========================================================================
  // BUSCA — RF-M-03: híbrida, com queda para textual
  // ==========================================================================

  /**
   * Busca na memória desta empresa.
   *
   * `vetorDaBusca` vem de fora pelo mesmo motivo de `embedding`: quem fala com o
   * fornecedor é o conector. Sem vetor — ou com a consulta vetorial falhando —
   * cai para busca textual, que é o que RF-M-03 pede com todas as letras:
   * "menos inteligência, zero indisponibilidade".
   *
   * O FILTRO DE EMPRESA VAI NA CONSULTA, não numa camada acima dela (ADR-003).
   * A policy de linha é a segunda tranca; uma consulta KNN sem `WHERE "orgId"`
   * confiaria a memória do cliente inteiramente a ela.
   */
  async buscar(
    orgId: string,
    query: string,
    limite = 8,
    vetorDaBusca?: number[] | null,
  ): Promise<ResultadoDeBusca> {
    const q = (query ?? '').trim();
    const take = Math.min(Math.max(limite, 1), 20);
    let modo: 'semantica' | 'textual' = 'textual';
    let linhas: Array<Record<string, unknown>> = [];

    if (vetorDaBusca?.length && q) {
      try {
        const vec = `[${vetorDaBusca.join(',')}]`;
        linhas = await this.prisma.$queryRawUnsafe(
          `SELECT ${COLUNAS_DA_NOTA},
                  (embedding IS NOT NULL) AS "temVetor",
                  1 - (embedding <=> $1::vector) AS score
             FROM "ContextItem"
            WHERE "orgId" = $2 AND "arquivadoEm" IS NULL AND embedding IS NOT NULL
            ORDER BY embedding <=> $1::vector
            LIMIT $3`,
          vec,
          orgId,
          take,
        );
        modo = 'semantica';
      } catch (e) {
        this.log.warn(
          `busca semântica na memória falhou (${(e as Error).message}); usando busca textual`,
        );
      }
    }

    if (modo === 'textual') {
      linhas = await this.prisma.$queryRawUnsafe(
        `SELECT ${COLUNAS_DA_NOTA},
                (embedding IS NOT NULL) AS "temVetor",
                0 AS score
           FROM "ContextItem"
          WHERE "orgId" = $2 AND "arquivadoEm" IS NULL
            AND (title ILIKE $1 OR body ILIKE $1)
          ORDER BY "atualizadoEm" DESC
          LIMIT $3`,
        `%${q}%`,
        orgId,
        take,
      );
    }

    return {
      query: q,
      modo,
      itens: linhas.map((l) => ({
        ...paraNota(l as never, Boolean(l.temVetor)),
        score: Math.round(Number(l.score ?? 0) * 1000) / 1000,
      })),
      fonte: { tool: 'memoria', generatedAt: new Date().toISOString() },
    };
  }

  /**
   * Busca textual para bearer de agente, com fronteira ADR-015.
   *
   * A consulta é montada somente com identificadores desta allowlist e valores
   * parametrizados. A seleção de grants vem antes da consulta de ContextItem;
   * assim um campo negado não entra nem no WHERE (ranking textual), nem no
   * SELECT/snippet, e LIMIT só é aplicado depois do filtro autorizado.
   */
  async buscarParaAgente(
    orgId: string,
    query: string,
    limite = 8,
    ator?: AtorDaBuscaDoAgente,
  ): Promise<ResultadoDeBuscaDoAgente> {
    return comTenantResolvido(orgId, () => this.buscarParaAgenteNoTenant(orgId, query, limite, ator));
  }

  private async buscarParaAgenteNoTenant(
    orgId: string,
    query: string,
    limite: number,
    ator?: AtorDaBuscaDoAgente,
  ): Promise<ResultadoDeBuscaDoAgente> {
    const q = (query ?? '').trim();
    const empty = (diagnostico: ResultadoDeBuscaDoAgente['diagnostico']): ResultadoDeBuscaDoAgente => ({
      query: q,
      modo: 'textual',
      diagnostico,
      itens: [],
      fonte: { tool: 'memoria', generatedAt: new Date().toISOString() },
    });
    const registrarDecisao = async (resultado: ResultadoDeBuscaDoAgente) => {
      await this.registrarDecisaoAgente(orgId, {
        modo: resultado.modo,
        diagnostico: resultado.diagnostico,
        quantidade: resultado.itens.length,
        fontes: resultado.itens.map((item) => ({ sourceType: item.sourceType, sourceRef: item.sourceRef })),
        campos: [...new Set(resultado.itens.flatMap((item) => Object.keys(item.fields)))],
      }, ator, 'memoria.agent_busca');
      return resultado;
    };
    if (!q) return registrarDecisao(empty('sem_campo_pesquisavel'));

    const porFonte = this.agruparGrants(await this.agentGrants.ativos(orgId));
    // Procedência é obrigatória: sem grant de sourceRef não devolvemos nenhum
    // conteúdo, mesmo que alguém tenha concedido title/body isoladamente.
    const fontes = [...porFonte.values()].filter((fonte) => fonte.fields.has('sourceRef'));
    if (!fontes.length) return registrarDecisao(empty('sem_consentimento'));

    const pesquisaveis = fontes.filter((fonte) => fonte.fields.has('title') || fonte.fields.has('body'));
    if (!pesquisaveis.length) return registrarDecisao(empty('sem_campo_pesquisavel'));

    const params: unknown[] = [orgId];
    const next = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const branches: string[] = [];
    const camposPorFonte = new Map<string, Set<AgentMemoryField>>(
      pesquisaveis.map((fonte) => [`${fonte.sourceType}\u0000${fonte.sourceRef}`, fonte.fields]),
    );
    for (const fonte of pesquisaveis) {
      const tipo = next(fonte.sourceType);
      const ref = next(fonte.sourceRef);
      const termos: string[] = [];
      if (fonte.fields.has('title')) termos.push(`"title" ILIKE ${next(`%${q}%`)}`);
      if (fonte.fields.has('body')) termos.push(`"body" ILIKE ${next(`%${q}%`)}`);
      if (!termos.length) continue;
      // Cada fonte tem sua própria SELECT. Uma fonte que só autoriza title não
      // pode receber a coluna body só porque outra fonte autorizou body.
      const jsonFields = this.jsonbCampos(fonte.fields);
      branches.push(
        `SELECT "id", "sourceType", "sourceRef", "atualizadoEm", ` +
          `jsonb_build_object(${jsonFields}) AS "fields" FROM "ContextItem" ` +
          `WHERE "orgId" = $1 AND "arquivadoEm" IS NULL AND "sourceType" = ${tipo}::"ContextSource" ` +
          `AND "sourceRef" = ${ref} AND (${termos.join(' OR ')})`,
      );
    }
    if (!branches.length) return registrarDecisao(empty('sem_campo_pesquisavel'));
    const take = next(Math.min(Math.max(limite, 1), 20));
    const rows = await this.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      `SELECT "id", "sourceType", "sourceRef", "atualizadoEm", "fields"
         FROM (${branches.join(' UNION ALL ')}) AS autorizadas
        ORDER BY "atualizadoEm" DESC
        LIMIT ${take}`,
      ...params,
    );
    return registrarDecisao({
      query: q,
      modo: 'textual',
      diagnostico: 'ok',
      itens: rows.map((row) => {
        const permitidos = camposPorFonte.get(`${String(row.sourceType)}\u0000${String(row.sourceRef)}`);
        const bruto = (row.fields ?? {}) as Record<string, unknown>;
        const item: Partial<Record<AgentMemoryField, unknown>> = {};
        for (const field of permitidos ?? []) {
          if (field !== 'sourceRef' && Object.prototype.hasOwnProperty.call(bruto, field)) {
            item[field] = bruto[field];
          }
        }
        return {
          id: String(row.id),
          score: 0 as const,
          sourceType: row.sourceType as ContextSource,
          sourceRef: String(row.sourceRef),
          fields: item,
        };
      }),
      fonte: { tool: 'memoria', generatedAt: new Date().toISOString() },
    });
  }

  /** Leitura individual para PAT: nunca chama obter(), que é a leitura humana integral. */
  async lerParaAgente(
    orgId: string,
    id: string,
    ator?: AtorDaBuscaDoAgente,
  ): Promise<ResultadoDeBuscaDoAgente['itens'][number] | null> {
    return comTenantResolvido(orgId, async () => {
      const porFonte = this.agruparGrants(await this.agentGrants.ativos(orgId));
      const metadado = await this.prisma.contextItem.findFirst({
        where: { id, orgId, arquivadoEm: null },
        select: { id: true, sourceType: true, sourceRef: true },
      });
      const fonte = metadado?.sourceRef
        ? porFonte.get(`${metadado.sourceType}\u0000${metadado.sourceRef}`)
        : undefined;
      const permitido = fonte && fonte.fields.has('sourceRef') &&
        (fonte.fields.has('title') || fonte.fields.has('body'))
        ? fonte
        : undefined;
      if (!metadado || !permitido) {
        await this.registrarDecisaoAgente(orgId, {
          modo: 'leitura', diagnostico: 'negado', quantidade: 0, fontes: [], campos: [],
          recursoId: id,
        }, ator, 'memoria.agent_leitura');
        return null;
      }
      const campos = this.jsonbCampos(permitido.fields);
      const rows = await this.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
        `SELECT "id", "sourceType", "sourceRef", jsonb_build_object(${campos}) AS "fields"
           FROM "ContextItem"
          WHERE "id" = $1 AND "orgId" = $2 AND "arquivadoEm" IS NULL
            AND "sourceType" = $3::"ContextSource" AND "sourceRef" = $4`,
        id, orgId, metadado.sourceType, metadado.sourceRef,
      );
      if (!rows[0]) {
        await this.registrarDecisaoAgente(orgId, {
          modo: 'leitura', diagnostico: 'negado', quantidade: 0, fontes: [], campos: [], recursoId: id,
        }, ator, 'memoria.agent_leitura');
        return null;
      }
      const bruto = (rows[0].fields ?? {}) as Record<string, unknown>;
      const fields: Partial<Record<AgentMemoryField, unknown>> = {};
      for (const field of permitido.fields) {
        if (field !== 'sourceRef' && Object.prototype.hasOwnProperty.call(bruto, field)) fields[field] = bruto[field];
      }
      const item = {
        id: String(rows[0].id),
        score: 0 as const,
        sourceType: rows[0].sourceType as ContextSource,
        sourceRef: String(rows[0].sourceRef),
        fields,
      };
      await this.registrarDecisaoAgente(orgId, {
        modo: 'leitura', diagnostico: 'ok', quantidade: 1,
        fontes: [{ sourceType: item.sourceType, sourceRef: item.sourceRef }],
        campos: Object.keys(fields), recursoId: id,
      }, ator, 'memoria.agent_leitura');
      return item;
    });
  }

  private agruparGrants(grants: Awaited<ReturnType<AgentDataGrantService['ativos']>>) {
    const porFonte = new Map<string, { sourceType: ContextSource; sourceRef: string; fields: Set<AgentMemoryField> }>();
    for (const grant of grants) {
      const key = `${grant.sourceType}\u0000${grant.sourceRef}`;
      const atual = porFonte.get(key) ?? {
        sourceType: grant.sourceType,
        sourceRef: grant.sourceRef,
        fields: new Set<AgentMemoryField>(),
      };
      atual.fields.add(grant.field);
      porFonte.set(key, atual);
    }
    return porFonte;
  }

  private jsonbCampos(fields: Set<AgentMemoryField>): string {
    return [...fields]
      .filter((field) => field !== 'sourceRef')
      .map((field) => `'${field}', "${field}"`)
      .join(', ');
  }

  private async registrarDecisaoAgente(
    orgId: string,
    decisao: DecisaoDaMemoriaDoAgente,
    ator: AtorDaBuscaDoAgente | undefined,
    tipo: string,
  ): Promise<void> {
    // O rastro guarda decisão e metadados autorizados, nunca query, corpo,
    // bearer ou hash. Falha no rastro falha fechado a leitura.
    const contexto = contextoAtual();
    await this.eventos.registrar({
      orgId,
      tipo,
      actorType: ActorType.ai,
      actorId: ator?.userId ?? contexto?.actorId ?? null,
      agentSlug: contexto?.agentSlug ?? null,
      correlationId: contexto?.correlationId ?? null,
      payload: {
        modo: decisao.modo,
        diagnostico: decisao.diagnostico,
        quantidade: decisao.quantidade,
        credencialId: ator?.tokenId ?? null,
        recursoId: decisao.recursoId ?? null,
        fontes: decisao.fontes,
        campos: decisao.campos,
      },
    });
  }

  /**
   * O cron de embeddings só recebe linhas com consentimento específico de
   * vetorização. Consentimento de leitura, inclusive de `body`, não basta.
   */
  async semVetorComConsentimento(orgId: string, limite = 100) {
    // E2b não remete conteúdo a nenhum provedor. A coluna de consentimento
    // específico permanece preparada para o onboarding futuro, mas não existe
    // caminho alcançável nesta fatia que a transforme em autorização de cron.
    void orgId;
    void limite;
    return [] as Array<{ id: string; title: string; body: string }>;
  }

  // ==========================================================================
  // ESCRITA — sempre evento + projeção
  // ==========================================================================

  async criar(orgId: string, entrada: EntradaDeNota): Promise<NotaDeContexto> {
    const chave = (entrada.chave ?? '').trim();
    if (!chave) throw new BadRequestException('A nota precisa de uma chave estável.');
    if (!(entrada.title ?? '').trim()) throw new BadRequestException('A nota precisa de título.');
    const sourceType = this.exigirProcedencia(entrada.sourceType);

    const contentHash = hashDoCorpo(entrada.body ?? '');
    const ator = this.ator();

    /*
     * A CONFERÊNCIA DE CHAVE REPETIDA MORA DENTRO DA TRANSAÇÃO, sob o cadeado.
     * Fora dela, dois `criar` simultâneos com a mesma chave passavam os dois
     * pela conferência e o segundo estourava no índice único — subindo um
     * `PrismaClientKnownRequestError` cru (500) em vez da recusa que explica o
     * que fazer. O `catch` abaixo é a segunda tranca, para o caso de o cadeado
     * não valer (outra conexão, outro processo, chave criada por script).
     */
    let criacao: { item: LinhaDaNota; versao: { id: string } };
    try {
      criacao = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`memoria:${orgId}`}))`;
        const jaExiste = await tx.contextItem.findFirst({
          where: { orgId, chave },
          select: { id: true },
        });
        if (jaExiste) throw this.conflitoDeChave(chave);

        const criado = await tx.contextItem.create({
          data: {
            orgId,
            chave,
            kind: entrada.kind ?? ContextKind.nota,
            title: entrada.title.trim(),
            body: entrada.body ?? '',
            tags: entrada.tags ?? [],
            sourceType,
            sourceRef: entrada.sourceRef ?? null,
            validFrom: entrada.validFrom ?? null,
            validUntil: entrada.validUntil ?? null,
            confidence: entrada.confidence ?? 1,
            contentHash,
            versao: 1,
            criadoPor: ator.actorId,
            atualizadoPor: ator.actorId,
          },
          select: SELECAO_DA_NOTA,
        });
        const linhaDaVersao = await tx.contextItemVersion.create({
          data: {
            orgId,
            itemId: criado.id,
            versao: 1,
            mudanca: ContextChange.criacao,
            kind: criado.kind,
            title: criado.title,
            body: criado.body,
            sourceType: criado.sourceType,
            sourceRef: criado.sourceRef,
            contentHash,
            motivo: entrada.motivo ?? null,
            autorTipo: ator.actorType,
            autorId: ator.actorId,
          },
          select: { id: true },
        });
        return { item: criado, versao: linhaDaVersao };
      });
    } catch (e) {
      throw this.traduzirChaveRepetida(e, chave);
    }

    const { item, versao } = criacao;

    await this.registrarMudanca({
      orgId,
      mudanca: ContextChange.criacao,
      item,
      versaoId: versao.id,
      versaoNumero: 1,
      motivo: entrada.motivo ?? null,
      anterior: null,
    });

    /*
     * O VETOR VEM DEPOIS DO EVENTO, e a ordem é conserto de defeito medido.
     * Antes ele vinha ANTES: uma falha ao gravar o vetor (o fornecedor devolveu
     * dimensão errada, o pgvector recusou) subia daqui e o evento NUNCA era
     * registrado — e na volta seguinte da vault o hash batia, a nota contava
     * como inalterada e a mudança ficava para sempre fora do rastro. Depois do
     * evento, e sem derrubar: o vetor é recuperável na volta seguinte
     * (`semVetor`), o evento não.
     */
    await this.gravarVetorSemDerrubar(orgId, item.id, entrada.embedding);

    return (await this.obter(orgId, item.id)) as NotaDeContexto;
  }

  async alterar(orgId: string, id: string, mudancas: MudancaDeNota): Promise<NotaDeContexto> {
    const ator = this.ator();

    /*
     * O QUE MUDA É MONTADO A PARTIR DO ESTADO LIDO DENTRO DO CADEADO — ver o
     * cabeçalho deste arquivo. Este `montar` roda quando a transação já é a dona
     * da nota; `atual` é o que o banco tem NESTE instante, não o que tinha
     * quando a requisição chegou.
     */
    const { item, anterior, versao } = await this.gravarVersao({
      orgId,
      id,
      mudanca: ContextChange.alteracao,
      ator,
      montar: (atual) => {
        const body = mudancas.body ?? atual.body;
        const title = (mudancas.title ?? atual.title).trim();
        if (!title) throw new BadRequestException('A nota precisa de título.');
        const sourceType = mudancas.sourceType
          ? this.exigirProcedencia(mudancas.sourceType)
          : atual.sourceType;
        return {
          dados: {
            kind: mudancas.kind ?? atual.kind,
            title,
            body,
            tags: mudancas.tags ?? atual.tags,
            sourceType,
            sourceRef: mudancas.sourceRef === undefined ? atual.sourceRef : mudancas.sourceRef,
            validFrom: mudancas.validFrom === undefined ? atual.validFrom : mudancas.validFrom,
            validUntil: mudancas.validUntil === undefined ? atual.validUntil : mudancas.validUntil,
            confidence: mudancas.confidence ?? atual.confidence,
            contentHash: hashDoCorpo(body),
            atualizadoPor: ator.actorId,
          },
          motivo: mudancas.motivo ?? null,
        };
      },
    });

    await this.registrarMudanca({
      orgId,
      mudanca: ContextChange.alteracao,
      item,
      versaoId: versao.id,
      versaoNumero: versao.versao,
      motivo: mudancas.motivo ?? null,
      anterior,
    });

    /*
     * O VETOR SÓ É TROCADO QUANDO O CORPO MUDOU, e o hash é quem responde isso.
     * Corrigir o título de uma nota não invalida o vetor dela — regravar por via
     * das dúvidas gastaria o item mais caro do sistema para não mudar nada.
     *
     * A comparação é entre o que a TRANSAÇÃO leu e o que ela gravou, não entre
     * uma leitura antiga e o pedido: sob concorrência, as duas respondem
     * diferente e só a primeira responde sobre a mudança que de fato aconteceu.
     */
    if (item.contentHash !== anterior.contentHash) {
      await this.gravarVetorSemDerrubar(orgId, id, mudancas.embedding);
    }

    return (await this.obter(orgId, id)) as NotaDeContexto;
  }

  /**
   * ARQUIVAR, NÃO APAGAR (ADR-011).
   *
   * Apagar contexto é apagar a explicação de decisões passadas. A nota arquivada
   * some da busca e da listagem padrão, e continua respondendo "por que a gente
   * fazia assim em março".
   */
  async arquivar(orgId: string, id: string, motivo?: string | null): Promise<NotaDeContexto> {
    const ator = this.ator();
    const { item, anterior, versao } = await this.gravarVersao({
      orgId,
      id,
      mudanca: ContextChange.arquivamento,
      ator,
      montar: (atual) => {
        // A recusa também mora aqui dentro: fora do cadeado, dois arquivamentos
        // simultâneos passavam os dois e gravavam duas versões de arquivar.
        if (atual.arquivadoEm) throw new ConflictException('Esta nota já está arquivada.');
        return {
          dados: {
            arquivadoEm: new Date(),
            arquivadoPor: ator.actorId,
            atualizadoPor: ator.actorId,
          },
          motivo: motivo ?? null,
        };
      },
    });

    await this.registrarMudanca({
      orgId,
      mudanca: ContextChange.arquivamento,
      item,
      versaoId: versao.id,
      versaoNumero: versao.versao,
      motivo: motivo ?? null,
      anterior,
    });
    return (await this.obter(orgId, id)) as NotaDeContexto;
  }

  async restaurar(orgId: string, id: string, motivo?: string | null): Promise<NotaDeContexto> {
    const ator = this.ator();
    const { item, anterior, versao } = await this.gravarVersao({
      orgId,
      id,
      mudanca: ContextChange.restauracao,
      ator,
      montar: (atual) => {
        if (!atual.arquivadoEm) throw new ConflictException('Esta nota não está arquivada.');
        return {
          dados: { arquivadoEm: null, arquivadoPor: null, atualizadoPor: ator.actorId },
          motivo: motivo ?? null,
        };
      },
    });

    await this.registrarMudanca({
      orgId,
      mudanca: ContextChange.restauracao,
      item,
      versaoId: versao.id,
      versaoNumero: versao.versao,
      motivo: motivo ?? null,
      anterior,
    });
    return (await this.obter(orgId, id)) as NotaDeContexto;
  }

  /**
   * RF-M-06 — a resposta vira nota permanente com um gesto.
   *
   * É `criar` com a procedência já decidida: `promocao`, e `sourceRef` é a
   * sessão de onde a resposta saiu. A procedência importa MAIS aqui do que em
   * qualquer outra origem: o texto foi produzido por um modelo, e quem ler a
   * nota daqui a um ano precisa saber disso sem ter de deduzir pelo estilo.
   */
  async promover(
    orgId: string,
    entrada: Omit<EntradaDeNota, 'sourceType'> & { sessionId?: string | null },
  ): Promise<NotaDeContexto> {
    return this.criar(orgId, {
      ...entrada,
      sourceType: ContextSource.promocao,
      sourceRef: entrada.sourceRef ?? entrada.sessionId ?? null,
      motivo: entrada.motivo ?? 'resposta promovida a nota (RF-M-06)',
    });
  }

  // ==========================================================================
  // A PROJEÇÃO DA VAULT — o que o conector do Obsidian entrega a cada volta
  // ==========================================================================

  /**
   * Projeta o que a vault tem HOJE para dentro da memória, sem duplicar e sem
   * versionar à toa.
   *
   * Três decisões, e as três custam caro se forem outras:
   *
   *  1. NOTA CUJO HASH NÃO MUDOU NÃO GERA VERSÃO. A vault é relida a cada 30
   *     minutos; sem isso, a memória ganharia 48 versões por dia por nota, e o
   *     histórico de decisões viraria ruído onde não dá para achar nada.
   *  2. ARQUIVO QUE SUMIU DA VAULT ARQUIVA A NOTA, não a apaga. `reindex` do
   *     Obsidian substitui o índice inteiro (`deleteMany` + recriação) porque a
   *     vault é a fonte da verdade dele; aqui não pode ser assim — a memória
   *     guarda decisão, e um arquivo apagado por engano não pode levar junto o
   *     histórico de por que a regra existia.
   *  3. SÓ NOTA DE ORIGEM `vault` É ALCANÇADA. O que foi digitado na tela ou
   *     promovido de uma resposta não some porque alguém mexeu numa pasta.
   *
   * ----------------------------------------------------------------------------
   * A GUARDA CONTRA VAULT SUMIDA — e por que ela não é zelo excessivo
   * ----------------------------------------------------------------------------
   * Quem chama aqui só sabe dizer "a pasta existe". Pasta que existe e está
   * VAZIA — porque o ponto de montagem caiu, porque a variável de ambiente
   * aponta para o lugar errado, porque alguém montou a pasta de outra máquina —
   * produz lista vazia, e lista vazia arquivava a memória inteira daquela
   * origem: uma versão e um evento por nota, e outro par quando a pasta
   * voltasse.
   *
   * NÃO É HIPOTÉTICO NESTA INSTALAÇÃO. O `OBSIDIAN_VAULT_HOST` da VPS aponta
   * para `/srv/marketing-os/vault`, que o CLAUDE.md do projeto diz, com todas as
   * letras, NÃO ser a vault real. Antes desta fatia o estrago era um índice
   * descartável (`KnowledgeNote` é recriado a cada volta). Agora é o histórico,
   * que não vence nunca.
   *
   * Duas guardas, e as duas RECUSAM O ARQUIVAMENTO sem impedir o resto:
   *  · lista VAZIA com notas vivas na memória: recusa a volta inteira, antes de
   *    gravar qualquer coisa. Vault legítima que ficou sem nenhum arquivo é
   *    evento raríssimo; ponto de montagem caído é semanal.
   *  · arquivamento em MASSA (acima de `TETO_DE_ARQUIVAMENTO`, com piso): faz as
   *    criações e alterações — que são aditivas e reversíveis — e deixa o
   *    arquivamento para uma decisão humana, com o número no log.
   */
  async projetarDaVault(
    orgId: string,
    notas: Array<{
      caminho: string;
      title: string;
      body: string;
      tags?: string[];
      embedding?: number[] | null;
    }>,
  ): Promise<ResumoDaProjecao> {
    const resumo: ResumoDaProjecao = {
      criadas: 0,
      alteradas: 0,
      inalteradas: 0,
      arquivadas: 0,
      falhas: 0,
      arquivamentoRecusado: 0,
    };
    const vistas = new Set<string>();

    const vivas = await this.prisma.contextItem.count({
      where: { orgId, sourceType: ContextSource.vault, arquivadoEm: null },
    });

    if (notas.length === 0 && vivas > 0) {
      throw new VaultSuspeitaError(
        `a vault respondeu VAZIA e esta empresa tem ${vivas} nota(s) de origem "vault" na ` +
          'memória. Nada foi arquivado: uma pasta que existe e não tem nenhum arquivo é ponto ' +
          'de montagem caído ou caminho errado muito mais vezes do que é vault esvaziada de ' +
          'propósito — e o arquivamento em massa custaria uma versão e um evento por nota, ' +
          'mais outro par quando a pasta voltasse. Para esvaziar de verdade, arquive na tela ' +
          'ou rode `memoria.cli.js desfazer-migracao`.',
      );
    }

    for (const nota of notas) {
      const chave = chaveDaVault(nota.caminho);
      vistas.add(chave);
      try {
        await this.projetarUmaNota(orgId, chave, nota, resumo);
      } catch (e) {
        /*
         * UMA NOTA RUIM NÃO DERRUBA A VOLTA. Antes, um corpo que o banco
         * recusasse — ou uma chave que colidisse com nota digitada na tela —
         * abortava a projeção inteira, e as notas depois dela no laço ficavam
         * sem versionamento sem que nada dissesse quais.
         */
        resumo.falhas++;
        this.log.warn(
          `empresa ${orgId}: a nota "${nota.caminho}" não entrou na memória nesta volta ` +
            `(${(e as Error).message}). As outras seguiram.`,
        );
      }
    }

    const orfas = await this.prisma.contextItem.findMany({
      where: { orgId, sourceType: ContextSource.vault, arquivadoEm: null },
      select: { id: true, chave: true },
    });
    const sumidas = orfas.filter((o) => !vistas.has(o.chave));
    const teto = Math.max(PISO_DE_ARQUIVAMENTO, Math.ceil(vivas * TETO_DE_ARQUIVAMENTO));

    if (sumidas.length > teto) {
      resumo.arquivamentoRecusado = sumidas.length;
      this.log.error(
        `empresa ${orgId}: a volta da vault sumiu com ${sumidas.length} de ${vivas} nota(s) ` +
          `vivas, acima do teto de ${teto} para uma volta só. NADA foi arquivado — isto tem ` +
          'cara de vault montada no lugar errado, e arquivar em massa é caro de desfazer ' +
          '(uma versão e um evento por nota, nos dois sentidos). Confira o caminho da vault; ' +
          'se a remoção for real, arquive na tela.',
      );
      return resumo;
    }

    for (const orfa of sumidas) {
      try {
        await this.arquivar(orgId, orfa.id, 'o arquivo deixou de existir na vault do Obsidian');
        resumo.arquivadas++;
      } catch (e) {
        resumo.falhas++;
        this.log.warn(
          `empresa ${orgId}: não consegui arquivar "${orfa.chave}" (${(e as Error).message}).`,
        );
      }
    }

    return resumo;
  }

  /** Uma nota da vault, projetada. Separado para que a falha seja POR NOTA. */
  private async projetarUmaNota(
    orgId: string,
    chave: string,
    nota: { caminho: string; title: string; body: string; tags?: string[]; embedding?: number[] | null },
    resumo: ResumoDaProjecao,
  ): Promise<void> {
    const existente = await this.porChave(orgId, chave);
    const hash = hashDoCorpo(nota.body);

    if (!existente) {
      await this.criar(orgId, {
        chave,
        kind: ContextKind.nota,
        title: nota.title,
        body: nota.body,
        tags: nota.tags ?? [],
        sourceType: ContextSource.vault,
        sourceRef: nota.caminho,
        embedding: nota.embedding ?? null,
        motivo: 'indexação da vault do Obsidian',
      });
      resumo.criadas++;
      return;
    }

    const mudouTexto =
      hash !== existente.contentHash ||
      nota.title !== existente.title ||
      !mesmasTags(nota.tags ?? [], existente.tags);

    if (!mudouTexto && !existente.arquivadoEm) {
      // Nada mudou no arquivo. O vetor pode estar faltando (nota criada na
      // tela antes de haver chave de embedding): esse é o único caso em que
      // ainda vale gravar alguma coisa.
      if (nota.embedding?.length && !existente.temVetor) {
        await this.gravarVetorSemDerrubar(orgId, existente.id, nota.embedding);
      }
      resumo.inalteradas++;
      return;
    }

    if (existente.arquivadoEm) {
      await this.restaurar(orgId, existente.id, 'o arquivo voltou a existir na vault');
    }
    if (mudouTexto) {
      await this.alterar(orgId, existente.id, {
        title: nota.title,
        body: nota.body,
        tags: nota.tags ?? [],
        sourceType: ContextSource.vault,
        sourceRef: nota.caminho,
        embedding: nota.embedding ?? null,
        motivo: 'o arquivo mudou na vault do Obsidian',
      });
      resumo.alteradas++;
    }
  }

  /** As notas desta empresa que ainda não têm vetor. Quem as vetoriza é o conector. */
  async semVetor(
    orgId: string,
    limite = 100,
  ): Promise<Array<{ id: string; title: string; body: string }>> {
    return this.prisma.$queryRawUnsafe(
      `SELECT id, title, body
         FROM "ContextItem"
        WHERE "orgId" = $1 AND "arquivadoEm" IS NULL AND embedding IS NULL
        ORDER BY "atualizadoEm" DESC
        LIMIT $2`,
      orgId,
      limite,
    );
  }

  /**
   * Grava o vetor de uma nota.
   *
   * `$executeRawUnsafe` porque `vector` é `Unsupported` no Prisma — o mesmo
   * caminho que `ObsidianService.reindex` e `PautaService` já usam. O `AND
   * "orgId"` não é redundância com a policy: é a primeira tranca, e é ela que
   * transforma um id trocado num zero-linhas em vez de numa escrita em empresa
   * alheia.
   */
  async gravarVetor(orgId: string, id: string, vetor: number[]): Promise<void> {
    await this.prisma.$executeRawUnsafe(
      'UPDATE "ContextItem" SET embedding = $1::vector WHERE id = $2 AND "orgId" = $3',
      `[${vetor.join(',')}]`,
      id,
      orgId,
    );
  }

  /**
   * O vetor, sem poder derrubar quem chamou.
   *
   * A ASSIMETRIA É A DECISÃO: vetor perdido volta na próxima passada do conector
   * (`semVetor` o encontra); evento perdido não volta nunca, porque na volta
   * seguinte o hash bate e a nota conta como inalterada. Então uma falha de
   * vetor não pode, em hipótese nenhuma, impedir que o evento seja escrito — e
   * era exatamente isso que acontecia quando esta gravação vinha antes dele.
   */
  private async gravarVetorSemDerrubar(
    orgId: string,
    id: string,
    vetor?: number[] | null,
  ): Promise<void> {
    if (!vetor?.length) return;
    try {
      await this.gravarVetor(orgId, id, vetor);
    } catch (e) {
      this.log.warn(
        `empresa ${orgId}: a nota ${id} mudou e foi registrada, mas o vetor não gravou ` +
          `(${(e as Error).message}). Ela continua encontrável pela busca TEXTUAL e volta a ` +
          'ser vetorizada na próxima passada do conector.',
      );
    }
  }

  // ==========================================================================
  // A CONFERÊNCIA ENTRE A VERSÃO E O EVENTO — RF-M-01, e o que sustenta o ADR
  // ==========================================================================

  /**
   * Confere, versão por versão, se a projeção bate com o RASTRO.
   *
   * POR QUE ELA EXISTE, sem rodeio: o ADR-011 recusou o desenho alternativo
   * ("documento com histórico") alegando que ele não é à prova de adulteração —
   * e, enquanto NADA comparasse a versão com o evento, o desenho escolhido não
   * era melhor nisso. Uma alteração direta na linha de versão passava tão
   * despercebida quanto passaria na alternativa recusada. Isto aqui é o
   * argumento virando código.
   *
   * O QUE TORNA A CONFERÊNCIA POSSÍVEL: `registrarMudanca` manda o `contentHash`
   * da versão como `contentHash` DO EVENTO, e essa coluna entra no hash da
   * cadeia (`EventLogService.encadear`). Então mexer no corpo da versão sem
   * mexer no evento é pego aqui; mexer também no evento para esconder quebra a
   * cadeia e é pego por `GET /audit/verificar`. Uma coisa fecha o que a outra
   * deixa aberto.
   *
   * TRÊS PERGUNTAS POR LINHA:
   *  1. o corpo gravado ainda corresponde ao `contentHash` da própria versão?
   *  2. esse `contentHash` é o mesmo que o evento carimbou?
   *  3. o evento aponta de volta para ESTA versão (`referencia`)?
   *
   * E, para as versões SEM elo, o diagnóstico separa o que é normal do que não
   * é — expurgo por retenção, migração do acervo, falha declarada de rastro e,
   * só então, "ninguém assumiu esta linha".
   */
  async conferirElos(orgId: string, limite = 5000): Promise<ResultadoDaConferencia> {
    const [versoes, eventos] = await Promise.all([
      /*
       * OS DOIS LADOS PEGAM AS MAIS RECENTES, e a simetria importa: com o teto
       * atingido, versões novas contra eventos VELHOS acusariam "sem
       * explicação" em massa só porque o evento ficou de fora da consulta.
       */
      this.prisma.contextItemVersion.findMany({
        where: { orgId },
        orderBy: { criadoEm: 'desc' },
        take: limite,
        select: {
          id: true,
          itemId: true,
          versao: true,
          body: true,
          contentHash: true,
          eventoId: true,
          eventoSeq: true,
          semEventoPorque: true,
        },
      }),
      this.prisma.eventLog.findMany({
        where: { orgId, tipo: { startsWith: 'memoria.item.' } },
        orderBy: { seq: 'desc' },
        take: limite,
        select: { id: true, seq: true, contentHash: true, payload: true },
      }),
    ]);

    const porId = new Map(eventos.map((e) => [e.id, e]));
    const porReferencia = new Map<string, (typeof eventos)[number]>();
    for (const e of eventos) {
      const ref = (e.payload as Record<string, unknown> | null)?.referencia;
      if (typeof ref === 'string') porReferencia.set(ref, e);
    }

    const divergentes: ResultadoDaConferencia['divergentes'] = [];
    const semElo: ResultadoDaConferencia['semElo'] = [];
    const porDiagnostico: Record<string, number> = {};
    let comElo = 0;

    for (const v of versoes) {
      const acusar = (motivo: string) =>
        divergentes.push({ versaoId: v.id, itemId: v.itemId, versao: v.versao, motivo });

      if (hashDoCorpo(v.body) !== v.contentHash) {
        acusar(
          'o corpo gravado não corresponde ao contentHash da própria versão — alguém editou a ' +
            'linha de histórico direto no banco',
        );
      }

      if (!v.eventoId) {
        const diagnostico = this.diagnosticarSemElo(v, porReferencia);
        porDiagnostico[diagnostico] = (porDiagnostico[diagnostico] ?? 0) + 1;
        semElo.push({
          versaoId: v.id,
          itemId: v.itemId,
          versao: v.versao,
          diagnostico,
          eventoSeq: v.eventoSeq === null ? null : v.eventoSeq.toString(),
        });
        continue;
      }

      const evento = porId.get(v.eventoId);
      if (!evento) {
        // Com a chave estrangeira (`ON DELETE SET NULL`) isto não deveria
        // acontecer: ou o id resolve, ou ele já foi limpo. Se acontecer, é
        // porque a constraint sumiu — e aí a acusação é o que se quer.
        acusar(`o elo aponta para o evento ${v.eventoId}, que não existe nesta empresa`);
        continue;
      }
      comElo++;

      if (evento.contentHash !== v.contentHash) {
        acusar(
          `o contentHash da versão (${v.contentHash.slice(0, 12)}…) não é o que o evento ` +
            `carimbou (${(evento.contentHash ?? '—').slice(0, 12)}…) — e o do evento está ` +
            'dentro da cadeia de hash do RASTRO',
        );
      }
      const ref = (evento.payload as Record<string, unknown> | null)?.referencia;
      if (ref !== referenciaDaVersao(v.id)) {
        acusar(`o evento seq ${evento.seq} aponta para "${String(ref)}", não para esta versão`);
      }
    }

    return {
      ok: divergentes.length === 0 && (porDiagnostico.sem_explicacao ?? 0) === 0,
      versoes: versoes.length,
      comElo,
      semElo,
      divergentes,
      porDiagnostico,
    };
  }

  /** Por que esta versão está sem elo — as quatro leituras possíveis. */
  private diagnosticarSemElo(
    v: { id: string; eventoSeq: bigint | null; semEventoPorque: string | null },
    porReferencia: Map<string, { id: string }>,
  ): DiagnosticoDeElo {
    // O expurgo por retenção limpou o id e DEIXOU a sequência. É o único caso em
    // que sobra a prova de que houve evento sem sobrar o evento.
    if (v.eventoSeq !== null) return 'expurgado';
    if (v.semEventoPorque === SEM_EVENTO.migracao) return 'migracao';
    if (v.semEventoPorque === SEM_EVENTO.falha) return 'falha_ao_registrar';
    // O evento existe e aponta para cá: quem falhou foi o elo de VOLTA (passo 3).
    if (porReferencia.has(referenciaDaVersao(v.id))) return 'elo_de_volta_nao_gravado';
    return 'sem_explicacao';
  }

  async contarComVetor(orgId: string): Promise<number> {
    const r = await this.prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
      'SELECT count(*)::bigint AS n FROM "ContextItem" WHERE "orgId" = $1 AND embedding IS NOT NULL',
      orgId,
    );
    return Number(r[0]?.n ?? 0);
  }

  // ==========================================================================
  // MIOLO
  // ==========================================================================

  private exigirProcedencia(sourceType: ContextSource): ContextSource {
    try {
      return exigirProcedencia(sourceType, 'MemoriaService');
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  /** Ator da operação, herdado do contexto de execução. */
  private ator(): { actorType: string; actorId: string | null; correlationId: string | null } {
    const ctx = contextoAtual();
    return {
      actorType: String(ctx?.actorType ?? ActorType.user),
      actorId: ctx?.actorId ?? null,
      correlationId: ctx?.correlationId ?? null,
    };
  }

  /**
   * O PASSO 1 das três escritas: LER, montar e gravar — tudo sob o cadeado.
   *
   * O advisory lock é por EMPRESA e não por nota de propósito: ele é o mesmo
   * mecanismo do `EventLogService`, o número de escritas concorrentes na memória
   * de uma empresa é baixo, e serializar por empresa é o que garante que
   * `versao` não tenha buraco. Cadeado por nota seria mais fino e não resolveria
   * nada que este não resolva.
   *
   * `montar` É FUNÇÃO, E NÃO OBJETO, PELO MOTIVO DO CABEÇALHO DESTE ARQUIVO. Ela
   * recebe o estado que ESTA transação leu, já dona da nota. Quem passasse um
   * objeto pronto estaria montando a mudança a partir de uma leitura que outra
   * transação pode ter invalidado enquanto esperava o cadeado — e o resultado
   * medido era a alteração do meio sumir com os dois eventos declarando o mesmo
   * `estadoAnterior`.
   *
   * `montar` pode LANÇAR (é onde moram "já está arquivada" e "precisa de
   * título"): a recusa acontece com o estado certo em mãos e desfaz a transação.
   */
  private async gravarVersao(args: {
    orgId: string;
    id: string;
    mudanca: ContextChange;
    ator: { actorType: string; actorId: string | null };
    montar: (atual: LinhaDaNota) => {
      dados: Prisma.ContextItemUpdateInput;
      motivo: string | null;
    };
  }): Promise<{
    item: LinhaDaNota;
    anterior: LinhaDaNota;
    versao: { id: string; versao: number };
  }> {
    const { orgId, id, mudanca, ator, montar } = args;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`memoria:${orgId}`}))`;

      const atual = await tx.contextItem.findFirst({
        where: { id, orgId },
        select: SELECAO_DA_NOTA,
      });
      if (!atual) throw new NotFoundException('Nota não encontrada nesta empresa.');

      const { dados, motivo } = montar(atual);

      const ultima = await tx.contextItemVersion.findFirst({
        where: { orgId, itemId: atual.id },
        orderBy: { versao: 'desc' },
        select: { versao: true },
      });
      const maiorDoHistorico = ultima?.versao ?? 0;
      /*
       * A PROJEÇÃO E A FONTE TÊM DE CONCORDAR. `ContextItem.versao` é sempre o
       * maior `versao` do histórico (ADR-011); se não for, alguém escreveu por
       * fora, e a numeração segue pelo MAIOR dos dois para não reaproveitar um
       * número já usado — o índice único (itemId, versao) recusaria.
       */
      if (atual.versao !== maiorDoHistorico) {
        this.log.error(
          `empresa ${orgId}: a nota ${atual.id} diz estar na versão ${atual.versao} e o ` +
            `histórico vai até ${maiorDoHistorico}. A projeção divergiu da fonte — rode ` +
            'GET /memoria/integridade.',
        );
      }
      const proxima = Math.max(atual.versao, maiorDoHistorico) + 1;

      const item = await tx.contextItem.update({
        where: { id: atual.id },
        data: { ...dados, versao: proxima },
        select: SELECAO_DA_NOTA,
      });
      const versao = await tx.contextItemVersion.create({
        data: {
          orgId,
          itemId: item.id,
          versao: proxima,
          mudanca,
          kind: item.kind,
          title: item.title,
          body: item.body,
          sourceType: item.sourceType,
          sourceRef: item.sourceRef,
          contentHash: item.contentHash,
          motivo,
          autorTipo: ator.actorType,
          autorId: ator.actorId,
        },
        select: { id: true, versao: true },
      });
      return { item, anterior: atual, versao };
    });
  }

  /** A recusa amigável de chave repetida, num lugar só. */
  private conflitoDeChave(chave: string): ConflictException {
    return new ConflictException(
      `Já existe nota com a chave "${chave}" nesta empresa. Altere a que existe — a memória ` +
        'versiona, não duplica.',
    );
  }

  /**
   * Traduz a violação do índice único `(orgId, chave)` na mesma recusa.
   *
   * Sem isto, a corrida entre dois `criar` com a mesma chave devolvia o erro cru
   * do Prisma (500, "Unique constraint failed") para quem só digitou uma chave
   * que já existia.
   */
  private traduzirChaveRepetida(e: unknown, chave: string): unknown {
    const erro = e as { code?: string; meta?: { target?: unknown } };
    if (erro?.code !== 'P2002') return e;
    const alvo = Array.isArray(erro.meta?.target) ? erro.meta?.target.join(',') : '';
    return alvo.includes('chave') || alvo === '' ? this.conflitoDeChave(chave) : e;
  }

  /**
   * Os passos 2 e 3: o evento no RASTRO e o elo de volta.
   *
   * O VOCABULÁRIO É O DA POLÍTICA, não uma invenção deste módulo — `motivo`,
   * `estadoAnterior`, `estadoNovo`, `fontes`, `resumo`, `referencia` e
   * `desfazer` são as palavras que `ConteudoDoEvento` nomeia, e a conferência de
   * nível procura exatamente por elas. Ver o mapa no alto de
   * `gateway/event-log.service.ts`.
   *
   * O CORPO NÃO ENTRA, EM TAMANHO NENHUM. A primeira versão desta fatia mandava
   * um EXCERTO de 280 letras, o que quer dizer que corpo curto — que é a maioria
   * das regras da casa — entrava inteiro. O que vai agora é a FORMA (tamanho e
   * hash), mais a `referencia` para a linha de versão onde o corpo mora. O
   * argumento não é tamanho de payload: o RASTRO é lido com `auditoria.ver` e a
   * memória com `obsidian.ver`, e o conteúdo do cliente não atravessa essa
   * fronteira de permissão sem alguém decidir que atravessa — ainda mais para um
   * lugar de onde não se apaga nada depois.
   *
   * O TÍTULO E A CHAVE VÃO SIGILOSOS (`sigiloso()`), pelo mesmo motivo: os dois
   * são texto escolhido pelo cliente, e a chave costuma carregar nome de cliente
   * dele. Sobra no registro o resumo criptográfico e o tamanho, que é o
   * suficiente para provar QUE mudou.
   *
   * A REDUNDÂNCIA DECLARADA: para nota vinda da vault, `fontes` publica
   * `vault:<caminho>`, que é a mesma informação da chave. `fontes` é PROCEDÊNCIA
   * — metadado que a casa nunca redige (`EventLogService`, `CAMPOS_DE_CONTEUDO`)
   * e que RF-M-02 exige. Então a redação da chave protege a nota digitada na
   * tela e não protege a da vault; está escrito aqui para ninguém achar que
   * cobre mais do que cobre.
   *
   * O `contentHash` DA LINHA É O DA VERSÃO, e é isso que torna a conferência de
   * `conferirElos` possível: ele entra no hash da cadeia, então esconder uma
   * edição da versão exigiria mexer também no evento, o que quebra a cadeia e
   * `GET /audit/verificar` acusa.
   *
   * SENSIBILIDADE `interna`: o que sobrou de legível é metadado da decisão —
   * versão, procedência, motivo, autor. Subir para `confidencial` transformaria
   * em resumo criptográfico justamente o que quem audita precisa ler, sem
   * proteger nada que já não esteja protegido campo a campo.
   */
  private async registrarMudanca(args: {
    orgId: string;
    mudanca: ContextChange;
    item: LinhaDaNota;
    versaoId: string;
    versaoNumero: number;
    motivo: string | null;
    anterior: LinhaDaNota | null;
  }): Promise<void> {
    const { orgId, mudanca, item, versaoId, versaoNumero, motivo, anterior } = args;
    const ator = this.ator();

    /*
     * DOIS PASSOS, DOIS TRATAMENTOS. Antes um `try` só cobria o registro do
     * evento E o elo de volta, e a mensagem culpava sempre o primeiro — então
     * uma falha no `update` da versão era relatada como "o evento do rastro
     * falhou" mesmo com o evento gravado e íntegro no banco. Quem lê o log ia
     * procurar o evento que existia.
     */
    let evento: { id: string; seq: bigint };
    try {
      evento = await this.eventos.registrar({
        orgId,
        tipo: TIPO_DE_EVENTO[mudanca],
        actorType: (ator.actorType as ActorType) ?? ActorType.user,
        actorId: ator.actorId,
        correlationId: ator.correlationId,
        contentHash: item.contentHash,
        payload: {
          itemId: item.id,
          versaoId,
          versao: versaoNumero,
          mudanca,
        },
        conteudo: {
          argumentos: { chave: sigiloso(item.chave, 'chave da nota'), kind: item.kind },
          resumo: `${mudanca} · versão ${versaoNumero} · ${formaDoCorpo(item.body, item.contentHash)}`,
          fontes: [rotuloDeProcedencia(item.sourceType, item.sourceRef)],
          motivo,
          estadoAnterior: anterior ? estadoDaNota(anterior) : null,
          estadoNovo: estadoDaNota(item),
          resultado: { versao: versaoNumero },
          desfazer:
            mudanca === ContextChange.arquivamento
              ? 'memoria.item.restaurar'
              : mudanca === ContextChange.restauracao
                ? 'memoria.item.arquivar'
                : 'memoria.item.alterar (a versão anterior continua no histórico)',
          referencia: referenciaDaVersao(versaoId),
        },
        sensibilidade: 'interna',
      });
    } catch (e) {
      /*
       * O RASTRO NUNCA DERRUBA A OPERAÇÃO — regra da casa, e aqui ela tem
       * consequência visível: a versão fica sem elo E DIZ POR QUÊ. É pior perder
       * a escrita do cliente do que perder o elo.
       */
      await this.marcarSemEvento(versaoId, SEM_EVENTO.falha);
      this.log.warn(
        `empresa ${orgId}: a memória mudou (item ${item.id}, versão ${versaoNumero}) mas o ` +
          `EVENTO do rastro não foi gravado: ${(e as Error).message}. A versão fica marcada ` +
          `"${SEM_EVENTO.falha}" — é assim que a falta aparece no histórico e em ` +
          'GET /memoria/integridade.',
      );
      return;
    }

    try {
      await this.prisma.contextItemVersion.update({
        where: { id: versaoId },
        data: { eventoId: evento.id, eventoSeq: evento.seq },
      });
    } catch (e) {
      /*
       * O EVENTO ESTÁ GRAVADO E ÍNTEGRO. O que falhou foi o elo de VOLTA, e a
       * versão NÃO é marcada como "falha ao registrar" porque não houve: a
       * conferência acha o evento pela `referencia` e devolve o diagnóstico
       * `elo_de_volta_nao_gravado`, que é recuperável.
       */
      this.log.error(
        `empresa ${orgId}: o evento da mudança da nota ${item.id} FOI gravado (seq ` +
          `${evento.seq}), mas o elo de volta na versão ${versaoNumero} não: ` +
          `${(e as Error).message}. Nada se perdeu — GET /memoria/integridade devolve ` +
          '"elo_de_volta_nao_gravado" para esta linha, achando o evento pela referência.',
      );
    }
  }

  /** Anota por que a versão nasceu sem elo. Melhor esforço: já estamos num erro. */
  private async marcarSemEvento(versaoId: string, porque: SemEventoPorque): Promise<void> {
    try {
      await this.prisma.contextItemVersion.update({
        where: { id: versaoId },
        data: { semEventoPorque: porque },
      });
    } catch (e) {
      this.log.error(
        `não consegui nem marcar a versão ${versaoId} como "${porque}": ${(e as Error).message}. ` +
          'Ela vai aparecer como "sem_explicacao" na conferência de integridade.',
      );
    }
  }

  /** Preenche `temVetor` sem trazer 1536 números por linha para a memória do processo. */
  private async comVetor(orgId: string, linhas: LinhaDaNota[]): Promise<NotaDeContexto[]> {
    if (linhas.length === 0) return [];
    const comVetor = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "ContextItem" WHERE "orgId" = $1 AND embedding IS NOT NULL`,
      orgId,
    );
    const conjunto = new Set(comVetor.map((l) => l.id));
    return linhas.map((l) => paraNota(l, conjunto.has(l.id)));
  }
}

// ---------------------------------------------------------------------------
// Forma da linha, num lugar só
// ---------------------------------------------------------------------------

/*
 * A seleção NÃO traz `embedding`: são 1536 números por linha, e nenhuma tela
 * precisa deles. `temVetor` responde a pergunta que a tela de fato faz ("esta
 * nota é encontrável por similaridade?") por um custo constante.
 */
const SELECAO_DA_NOTA = {
  id: true,
  chave: true,
  kind: true,
  title: true,
  body: true,
  tags: true,
  sourceType: true,
  sourceRef: true,
  validFrom: true,
  validUntil: true,
  supersedesId: true,
  confidence: true,
  contentHash: true,
  versao: true,
  arquivadoEm: true,
  criadoEm: true,
  atualizadoEm: true,
} as const;

/** As mesmas colunas, para as consultas cruas (busca vetorial e textual). */
const COLUNAS_DA_NOTA = [
  'id',
  'chave',
  'kind',
  'title',
  'body',
  'tags',
  '"sourceType"',
  '"sourceRef"',
  '"validFrom"',
  '"validUntil"',
  '"supersedesId"',
  'confidence',
  '"contentHash"',
  'versao',
  '"arquivadoEm"',
  '"criadoEm"',
  '"atualizadoEm"',
].join(', ');

interface LinhaDaNota {
  id: string;
  chave: string;
  kind: ContextKind;
  title: string;
  body: string;
  tags: string[];
  sourceType: ContextSource;
  sourceRef: string | null;
  validFrom: Date | null;
  validUntil: Date | null;
  supersedesId: string | null;
  confidence: number;
  contentHash: string;
  versao: number;
  arquivadoEm: Date | null;
  criadoEm: Date;
  atualizadoEm: Date;
}

function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

export function paraNota(l: LinhaDaNota, temVetor: boolean): NotaDeContexto {
  return {
    id: l.id,
    chave: l.chave,
    kind: l.kind,
    title: l.title,
    body: l.body,
    tags: l.tags ?? [],
    sourceType: l.sourceType,
    sourceRef: l.sourceRef ?? null,
    // A PROCEDÊNCIA VIAJA MONTADA (RF-M-02): quem consome a nota não tem de
    // saber como montar o rótulo, e assim não existem duas formas dele.
    procedencia: rotuloDeProcedencia(l.sourceType, l.sourceRef),
    validFrom: iso(l.validFrom),
    validUntil: iso(l.validUntil),
    supersedesId: l.supersedesId ?? null,
    confidence: Number(l.confidence ?? 1),
    contentHash: l.contentHash,
    versao: Number(l.versao),
    temVetor,
    arquivadoEm: iso(l.arquivadoEm),
    criadoEm: iso(l.criadoEm) as string,
    atualizadoEm: iso(l.atualizadoEm) as string,
  };
}

function paraVersao(v: {
  id: string;
  versao: number;
  mudanca: ContextChange;
  kind: ContextKind;
  title: string;
  body: string;
  sourceType: ContextSource;
  sourceRef: string | null;
  contentHash: string;
  motivo: string | null;
  autorTipo: string;
  autorId: string | null;
  eventoId: string | null;
  eventoSeq: bigint | null;
  semEventoPorque: string | null;
  criadoEm: Date;
}): VersaoDeNota {
  return {
    id: v.id,
    versao: v.versao,
    mudanca: v.mudanca,
    kind: v.kind,
    title: v.title,
    body: v.body,
    sourceType: v.sourceType,
    sourceRef: v.sourceRef,
    procedencia: rotuloDeProcedencia(v.sourceType, v.sourceRef),
    contentHash: v.contentHash,
    motivo: v.motivo,
    autorTipo: v.autorTipo,
    autorId: v.autorId,
    eventoId: v.eventoId,
    // BigInt não sobrevive a `JSON.stringify` — vai como texto, que é o que o
    // resto do repositório faz com `seq`.
    eventoSeq: v.eventoSeq === null ? null : v.eventoSeq.toString(),
    semEventoPorque: v.semEventoPorque,
    criadoEm: v.criadoEm.toISOString(),
  };
}

/** As quatro leituras de uma versão sem elo. Só a última é acusação. */
export type DiagnosticoDeElo =
  | 'expurgado'
  | 'migracao'
  | 'falha_ao_registrar'
  | 'elo_de_volta_nao_gravado'
  | 'sem_explicacao';

/** O que `conferirElos` devolve — e o que a rota de integridade publica. */
export interface ResultadoDaConferencia {
  /** Falso quando há divergência OU versão que ninguém assumiu. */
  ok: boolean;
  versoes: number;
  comElo: number;
  semElo: Array<{
    versaoId: string;
    itemId: string;
    versao: number;
    diagnostico: DiagnosticoDeElo;
    eventoSeq: string | null;
  }>;
  divergentes: Array<{ versaoId: string; itemId: string; versao: number; motivo: string }>;
  porDiagnostico: Record<string, number>;
}

/**
 * O "antes" e o "depois" que o RASTRO guarda (R4 pede os dois).
 *
 * Metadado, nunca o corpo: o corpo está na versão, e a `referencia` do evento
 * aponta para ela. O `contentHash` é o que permite a quem audita dizer "o texto
 * mudou" sem o registro carregar o texto.
 *
 * O TÍTULO VAI SIGILOSO: ele é texto do cliente como o corpo é, só que curto — e
 * "curto" nunca foi argumento para vazar. O que fica no registro é o resumo
 * criptográfico e o tamanho, que muda quando o título muda e é tudo o que quem
 * audita precisa para dizer que mudou.
 */
function estadoDaNota(l: LinhaDaNota): Record<string, unknown> {
  return {
    versao: Number(l.versao),
    kind: l.kind,
    title: sigiloso(l.title, 'título da nota'),
    contentHash: l.contentHash,
    procedencia: rotuloDeProcedencia(l.sourceType, l.sourceRef),
    arquivada: Boolean(l.arquivadoEm),
  };
}

function mesmasTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const ordenadoA = [...a].sort();
  const ordenadoB = [...b].sort();
  return ordenadoA.every((t, i) => t === ordenadoB[i]);
}
