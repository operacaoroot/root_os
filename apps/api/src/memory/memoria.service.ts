import { createHash } from 'node:crypto';
import type { M05EscopoDto, M05FonteAutorizadaDto } from '@mktos/shared';
import { construirFonteAutorizada } from './fonte-autorizada';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import { exigirAcessoAtual, filtroDeLeitura, leitorDoContexto, leitorAutorizado } from './acesso-memoria';
import { EventLogService, sigiloso } from '../gateway/event-log.service';
import { mesclarComTextuais } from '../obsidian/embeddings-lotes';
import { PrismaService } from '../prisma/prisma.service';
import {
  chaveDaVault,
  corpoNormalizado,
  exigirProcedencia,
  formaDoCorpo,
  hashDoCorpo,
  PREFIXO_DA_VAULT,
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
 *    A exceção declarada é a voz do autor (MC10): as notas `voz.*` entram
 *    como instrução de estilo pelo `pauta/voz-da-pauta.ts` — neutralizadas,
 *    com procedência e sem cerca. Ver ADR-011, "Fronteiras".
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
  acessoRestrito?: boolean;
  leitores?: string[];
  validFrom?: Date | null;
  validUntil?: Date | null;
  /**
   * A nota que esta substitui (RF-M-08). Hoje só a projeção da vault preenche,
   * a partir do `substitui:` do cabeçalho (C19-05); a tela não o recebe.
   */
  supersedesId?: string | null;
  confidence?: number;
  /** O vetor, quando quem chama já o tem. Ver "o que este serviço não faz". */
  embedding?: number[] | null;
  motivo?: string | null;
}

export type MudancaDeNota = Partial<Omit<EntradaDeNota, 'chave'>> & {
  motivo?: string | null;
  /**
   * A versão que quem pede leu. Diferente da atual, a alteração é recusada
   * (409) — conferida DENTRO do cadeado, onde a leitura vale.
   */
  versaoEsperada?: number;
};

/** Escrita de uma nota derivada de outra, validando as duas no mesmo cadeado. */
export interface ProjecaoCondicionada {
  fonte: { id: string; chave: string; versao: number; hash: string };
  destino: { id: string | null; chave: string; versao: number | null; hash: string | null };
  title: string;
  body: string;
  tags: string[];
  sourceRef: string;
  motivo: string;
}

export interface NotaDeContexto {
  escopo?: M05EscopoDto;
  retratoFonte?: M05FonteAutorizadaDto;
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
  escopo?: M05EscopoDto;
  retratoFonte?: M05FonteAutorizadaDto;
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

/** O que uma volta de projeção da vault mexeu. É o que a sonda, o CLI e o recibo mostram. */
export interface ResumoDaProjecao {
  criadas: number;
  alteradas: number;
  inalteradas: number;
  arquivadas: number;
  /** Itens arquivados que voltaram porque o arquivo voltou a existir. */
  restauradas: number;
  /** Notas que falharam NESTA VOLTA. Uma nota ruim não derruba as outras. */
  falhas: number;
  /**
   * Arquivamentos que a guarda RECUSOU por parecerem vault sumida em vez de
   * arquivo apagado. Diferente de zero é incidente, não estatística.
   */
  arquivamentoRecusado: number;
  /** Arquivos movidos com o mesmo `itemId` (C19-04). */
  movidas: number;
  /** Pares de movimento segurados pela guarda: acima do teto, nada novo nasce e nada antigo é arquivado. */
  movimentosRecusados: number;
  /** Pares que não se formaram, e por quê: aí vale o comportamento de antes (arquiva A, cria B). */
  movimentosDescartados: { ambiguos: number; curtos: number };
  /** Os pares da volta, com o caminho de origem e de destino (o recibo os põe sob `sigiloso`). */
  pares: Array<{ de: string; para: string; situacao: 'movido' | 'segurado' | 'falhou' }>;
  /**
   * O conjunto exato que cada guarda segurou, como resumo criptográfico das
   * chaves em ordem. É o que o comando de liberação assina (R-6): a liberação
   * vale só para ESTE conjunto, e uma vault que mudou de novo pede outra.
   */
  guardas: {
    arquivamento: { quantidade: number; conjunto: string | null };
    movimentos: { quantidade: number; conjunto: string | null };
  };
  /** O evento de liberação que esta volta consumiu, quando consumiu. */
  liberacaoUsada: string | null;
  /** `substitui:` resolvidos e sem alvo; o sem alvo fica nulo e vai ao recibo como aviso. */
  substituicoes: { resolvidas: number; semAlvo: number };
  avisos: string[];
}

/** Uma nota da vault como a projeção a recebe. */
export interface NotaDaVaultParaProjetar {
  caminho: string;
  title: string;
  body: string;
  tags?: string[];
  embedding?: number[] | null;
  /**
   * O cabeçalho lido (C19-05). Ausente = desconhecido nesta volta (a fonte Drive
   * reaproveita a nota pela data e não relê o arquivo): os campos do item ficam
   * como estão. Presente, ele é a verdade, inclusive para voltar a `nota` e a
   * validade vazia.
   */
  cabecalho?: {
    kind: ContextKind;
    validFrom: Date | null;
    validUntil: Date | null;
    /** O caminho (NFC) que `substitui:` aponta, já normalizado; `null` quando não há. */
    substitui: string | null;
    /** Avisos do leitor, com valores privados; o recibo os marca como sigilosos. */
    avisos?: string[];
    /** Havia `substitui`, mas o leitor recusou o alvo antes da busca na memória. */
    substituicaoRecusada?: boolean;
  };
}

/**
 * A vault respondeu de um jeito que não dá para acreditar.
 *
 * Não é erro de leitura de disco — é resposta VÁLIDA e suspeita: a lista veio
 * vazia enquanto a memória tem notas daquela origem. Ver a guarda em
 * `projetarDaVault`.
 *
 * Leva o resumo da volta: é dele que o recibo tira o conjunto segurado, e é esse
 * conjunto que o comando de liberação assina (R-6).
 */
export class VaultSuspeitaError extends Error {
  constructor(
    mensagem: string,
    readonly resumo?: ResumoDaProjecao,
  ) {
    super(mensagem);
  }
}

/** O tipo do evento do recibo de uma volta da vault (C19-08). */
export const TIPO_DO_RECIBO = 'memoria.vault.recibo';

/** A coleção `vault:` da root-base, como o recibo a nomeia. */
export const COLECAO_DA_VAULT = 'vault:root-base';

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

/**
 * O MENOR CORPO QUE FORMA PAR DE MOVIMENTO (C19-04, R-4), em caracteres do corpo
 * normalizado (o mesmo texto que vira `contentHash`).
 *
 * De onde saiu o número: a medida Q-CURTOS do contrato, feita sobre a árvore da
 * root-base que produção lia (`e2a2178`, 397 `.md` rastreados) e sobre o `main`
 * de 02/10/2026 (`4bd6e1b`, 403), com a mesma leitura de corpo do OS: nenhum
 * corpo vazio, nenhum abaixo de 200 caracteres, o menor com 282. Duzentos deixa
 * toda nota de hoje apta a formar par e corta o que tem cara de esboço ou
 * modelo — corpo curto é o que mais se repete entre notas sem relação. A mesma
 * medida achou 4 grupos de corpo idêntico (8 notas): esses nunca formam par,
 * pela regra de unicidade logo abaixo, não pelo piso. Em produção a Q-CURTOS do
 * pacote de deploy (E-20.11) repete a medida no banco.
 */
export const PISO_DO_PAR = 200;

/** O evento com que uma pessoa libera, pelo comando, um conjunto que a guarda segurou (R-6). */
export const TIPO_DA_LIBERACAO = 'memoria.vault.guarda_liberada';

/** Até quando uma liberação vale, se a volta não a consumir antes. */
const VALIDADE_DA_LIBERACAO_MS = 24 * 60 * 60 * 1000;

/** O comando que as frases das guardas mandam rodar (R-6). */
export const COMANDO_DE_LIBERACAO =
  'node dist/scripts/liberar-guarda-da-vault.js --como <seu e-mail> --motivo "<por quê>"';

/** O resumo de uma volta que não mexeu em nada — o ponto de partida de toda projeção. */
export function resumoVazio(): ResumoDaProjecao {
  return {
    criadas: 0,
    alteradas: 0,
    inalteradas: 0,
    arquivadas: 0,
    restauradas: 0,
    falhas: 0,
    arquivamentoRecusado: 0,
    movidas: 0,
    movimentosRecusados: 0,
    movimentosDescartados: { ambiguos: 0, curtos: 0 },
    pares: [],
    guardas: {
      arquivamento: { quantidade: 0, conjunto: null },
      movimentos: { quantidade: 0, conjunto: null },
    },
    liberacaoUsada: null,
    substituicoes: { resolvidas: 0, semAlvo: 0 },
    avisos: [],
  };
}

/** O resumo criptográfico de um conjunto de chaves, na ordem: é o que a liberação assina. */
export function conjuntoDaGuarda(chaves: readonly string[]): string {
  return createHash('sha256').update([...chaves].sort().join('\n')).digest('hex');
}

@Injectable()
export class MemoriaService {
  private readonly log = new Logger('Memoria');

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: EventLogService,
  ) {}

  // ==========================================================================
  // LEITURA
  // ==========================================================================

  async listar(
    orgId: string,
    opcoes: { kind?: ContextKind; incluirArquivadas?: boolean } = {},
    solicitanteId: string | null = leitorDoContexto(),
  ): Promise<{ itens: NotaDeContexto[]; total: number; comVetor: number }> {
    if (solicitanteId) await exigirAcessoAtual(this.prisma, orgId, solicitanteId, ['obsidian.ver']);
    let linhas = await this.prisma.contextItem.findMany({
      where: {
        orgId,
        ...filtroDeLeitura(solicitanteId),
        ...(opcoes.kind ? { kind: opcoes.kind } : {}),
        ...(opcoes.incluirArquivadas ? {} : { arquivadoEm: null }),
      },
      orderBy: { atualizadoEm: 'desc' },
      select: SELECAO_DA_NOTA,
    });
    await this.contarComVetor(orgId, solicitanteId);
    const notas = await this.comVetor(orgId, linhas);
    const final = await this.leituraAtual(orgId, solicitanteId, linhas.map((l) => l.id));
    const ids = new Set(final.ids);
    return {
      itens: notas.filter((n) => ids.has(n.id)),
      total: ids.size,
      comVetor: Number(final.comVetor),
    };
  }

  async obter(orgId: string, id: string, solicitanteId: string | null = leitorDoContexto()): Promise<NotaDeContexto | null> {
    if (solicitanteId) await exigirAcessoAtual(this.prisma, orgId, solicitanteId, ['obsidian.ver']);
    const linha = await this.prisma.contextItem.findFirst({
      where: { id, orgId, ...filtroDeLeitura(solicitanteId) },
      select: SELECAO_DA_NOTA,
    });
    if (!linha) return null;
    let nota = (await this.comVetor(orgId, [linha]))[0];
    if (solicitanteId) nota = await this.retratoAtual(orgId, nota, solicitanteId);
    return (await this.reconferirLeitura(orgId, [linha], solicitanteId)).length ? nota : null;
  }

  async porChave(orgId: string, chave: string, solicitanteId: string | null = leitorDoContexto()): Promise<NotaDeContexto | null> {
    if (solicitanteId) await exigirAcessoAtual(this.prisma, orgId, solicitanteId, ['obsidian.ver']);
    const linha = await this.prisma.contextItem.findFirst({
      where: { orgId, chave, ...filtroDeLeitura(solicitanteId) },
      select: SELECAO_DA_NOTA,
    });
    if (!linha) return null;
    let nota = (await this.comVetor(orgId, [linha]))[0];
    if (solicitanteId) nota = await this.retratoAtual(orgId, nota, solicitanteId);
    return (await this.reconferirLeitura(orgId, [linha], solicitanteId)).length ? nota : null;
  }

  /**
   * O HISTÓRICO — RF-M-01.
   *
   * A projeção das mudanças, da mais nova para a mais velha. Cada linha carrega
   * o elo com o evento do RASTRO que a produziu: é por ele que se prova, no
   * `GET /audit/verificar`, que a versão não foi escrita por fora.
   */
  async historico(orgId: string, id: string, solicitanteId: string | null = leitorDoContexto()): Promise<VersaoDeNota[]> {
    if (solicitanteId) await exigirAcessoAtual(this.prisma, orgId, solicitanteId, ['obsidian.ver']);
    const existe = await this.prisma.contextItem.count({ where: { id, orgId, ...filtroDeLeitura(solicitanteId) } });
    if (!existe) throw new NotFoundException('Nota não encontrada nesta empresa.');
    const linhas = await this.prisma.contextItemVersion.findMany({
      where: { orgId, itemId: id },
      orderBy: { versao: 'desc' },
    });
    const item = await this.prisma.contextItem.findFirst({ where: { id, orgId, ...filtroDeLeitura(solicitanteId) } });
    if (!item) throw new NotFoundException('Nota não encontrada nesta empresa.');
    const verificadoEm = new Date();
    const resultado = linhas.map((v) => ({ ...paraVersao(v), ...(solicitanteId ? {
      escopo: { orgId, userId: solicitanteId },
      retratoFonte: construirFonteAutorizada({ item, versaoSelecionada: v, incluirCorpo: true, acessoVerificadoEm: verificadoEm,
        novoUsoPermitido: !item.arquivadoEm && v.sourceType === item.sourceType && v.sourceRef === item.sourceRef }),
    } : {}) }));
    if (!(await this.reconferirLeitura(orgId, [item], solicitanteId)).length) throw new NotFoundException('Nota não encontrada nesta empresa.');
    return resultado;
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
    solicitanteId: string | null = leitorDoContexto(),
  ): Promise<ResultadoDeBusca> {
    if (solicitanteId) await exigirAcessoAtual(this.prisma, orgId, solicitanteId, ['obsidian.ver']);
    const q = (query ?? '').trim();
    const take = Math.min(Math.max(limite, 1), 20);
    let modo: 'semantica' | 'textual' = 'textual';
    let linhas: Array<Record<string, unknown>> = [];

    if (vetorDaBusca?.length && q) {
      try {
        const vec = `[${vetorDaBusca.join(',')}]`;
        const semanticas: Array<Record<string, unknown> & { id: string }> = await this.prisma.$queryRawUnsafe(
          `SELECT ${COLUNAS_DA_NOTA},
                  (embedding IS NOT NULL) AS "temVetor",
                  1 - (embedding <=> $1::vector) AS score
             FROM "ContextItem"
            WHERE "orgId" = $2 AND "arquivadoEm" IS NULL
              AND ("acessoRestrito" = false OR $4::text = ANY("leitores")) AND embedding IS NOT NULL
            ORDER BY embedding <=> $1::vector
            LIMIT $3`,
          vec,
          orgId,
          take,
          solicitanteId,
        );
        /*
         * O KNN só vê nota COM vetor: sem nenhuma, a busca voltava vazia como
         * "semântica"; com parte delas, a nota sem vetor não aparecia nem
         * contendo o texto pedido. Sem semântica cai no textual abaixo; com ela,
         * as notas SEM vetor que têm o texto entram pela mescla, a mesma regra
         * da busca da vault (`mesclarComTextuais`).
         */
        if (semanticas.length) {
          const semVetor: Array<Record<string, unknown> & { id: string }> = await this.prisma.$queryRawUnsafe(
            `SELECT ${COLUNAS_DA_NOTA},
                    (embedding IS NOT NULL) AS "temVetor",
                    0 AS score
               FROM "ContextItem"
              WHERE "orgId" = $2 AND "arquivadoEm" IS NULL
              AND ("acessoRestrito" = false OR $4::text = ANY("leitores")) AND embedding IS NULL
                AND (title ILIKE $1 OR body ILIKE $1)
              ORDER BY "atualizadoEm" DESC
              LIMIT $3`,
            `%${q}%`,
            orgId,
            take,
            solicitanteId,
          );
          linhas = mesclarComTextuais(semanticas, semVetor, take);
          modo = 'semantica';
        }
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
              AND ("acessoRestrito" = false OR $4::text = ANY("leitores"))
            AND (title ILIKE $1 OR body ILIKE $1)
          ORDER BY "atualizadoEm" DESC
          LIMIT $3`,
        `%${q}%`,
        orgId,
        take,
        solicitanteId,
      );
    }

    linhas = await this.reconferirLeitura(orgId, linhas as Array<Record<string, unknown> & { id: string; acessoRestrito?: boolean }>, solicitanteId);
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

  // ==========================================================================
  // ESCRITA — sempre evento + projeção
  // ==========================================================================

  async criar(orgId: string, entrada: EntradaDeNota): Promise<NotaDeContexto> {
    const chave = (entrada.chave ?? '').trim();
    if (!chave) throw new BadRequestException('A nota precisa de uma chave estável.');
    if (!(entrada.title ?? '').trim()) throw new BadRequestException('A nota precisa de título.');
    const sourceType = this.exigirProcedencia(entrada.sourceType);

    await this.conferirLeitores(this.prisma, orgId, entrada.leitores);
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
            acessoRestrito: entrada.acessoRestrito ?? false,
            leitores: entrada.leitores ?? [],
            validFrom: entrada.validFrom ?? null,
            validUntil: entrada.validUntil ?? null,
            supersedesId: entrada.supersedesId ?? null,
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
    await this.gravarVetorSemDerrubar(orgId, item.id, item.contentHash, entrada.embedding);

    return (await this.obter(orgId, item.id)) as NotaDeContexto;
  }

  async alterar(orgId: string, id: string, mudancas: MudancaDeNota): Promise<NotaDeContexto> {
    const ator = this.ator();
    await this.conferirLeitores(this.prisma, orgId, mudancas.leitores);

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
        if (mudancas.versaoEsperada !== undefined && atual.versao !== mudancas.versaoEsperada) {
          throw new ConflictException(
            `A nota mudou desde a leitura (versão ${mudancas.versaoEsperada}, agora ${atual.versao}) — recarregue e tente de novo.`,
          );
        }
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
            ...(mudancas.acessoRestrito === undefined ? {} : { acessoRestrito: mudancas.acessoRestrito }),
            ...(mudancas.leitores === undefined ? {} : { leitores: mudancas.leitores }),
            validFrom: mudancas.validFrom === undefined ? atual.validFrom : mudancas.validFrom,
            validUntil: mudancas.validUntil === undefined ? atual.validUntil : mudancas.validUntil,
            supersedesId: mudancas.supersedesId === undefined ? atual.supersedesId : mudancas.supersedesId,
            confidence: mudancas.confidence ?? atual.confidence,
            contentHash: hashDoCorpo(body),
            atualizadoPor: ator.actorId,
          },
          motivo: mudancas.motivo ?? null,
        };
      },
      /*
       * CORPO NOVO TIRA O VETOR DO CORPO ANTERIOR, NA MESMA TRANSAÇÃO (V1 da
       * ROOT-05ab-REV). Antes o vetor só era trocado quando vinha um novo, e o
       * do texto anterior ficava: a edição na tela e a nota da vault alterada
       * numa volta sem fornecedor guardavam um vetor que já não descreve o
       * corpo, e `semVetor` nunca mais as listava. Vetor velho não deixa marca
       * que permita achá-lo depois.
       *
       * Na transação porque o corpo e o vetor têm de mudar juntos. Com um
       * UPDATE depois do commit, uma queda do processo entre os dois deixaria o
       * corpo novo com o vetor velho para sempre; aqui, a transação desfeita
       * leva junto o NULL, e o vetor só sai quando o corpo de fato mudou. O
       * vetor novo, quando vem, entra depois do evento, pela regra de baixo.
       */
      noCadeado: async (tx, antes, depois) => {
        if (depois.contentHash === antes.contentHash) return;
        await tx.$executeRawUnsafe(
          'UPDATE "ContextItem" SET embedding = NULL WHERE id = $1 AND "orgId" = $2',
          depois.id,
          orgId,
        );
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
     *
     * Com o hash trocado, a coluna já saiu da transação vazia (`noCadeado`
     * acima). O vetor que veio no pedido é gravado condicionado ao hash novo:
     * sem vetor, ou com um que o banco recuse, a nota fica em `semVetor`.
     */
    if (item.contentHash !== anterior.contentHash) {
      await this.gravarVetorSemDerrubar(orgId, id, item.contentHash, mudancas.embedding);
    }

    return (await this.obter(orgId, id)) as NotaDeContexto;
  }

  /**
   * A fonte e o destino são relidos após o advisory lock da empresa. Prévia
   * antiga não pode publicar uma fonte arquivada nem apagar edição de outra aba.
   * Mantém a mesma sequência item → versão → evento usada por criar/alterar.
   */
  async projetarCondicionado(orgId: string, pedido: ProjecaoCondicionada): Promise<NotaDeContexto> {
    if (!pedido.title.trim() || !pedido.body.trim()) throw new BadRequestException('A projeção precisa de título e corpo.');
    if (pedido.sourceRef.length > 1_000) throw new BadRequestException('A referência da fonte passou de 1.000 caracteres.');
    const ator = this.ator();
    const hash = hashDoCorpo(pedido.body);
    let gravada: {
      item: LinhaDaNota;
      anterior: LinhaDaNota | null;
      versao: { id: string; versao: number } | null;
      mudanca: ContextChange;
    };
    try {
      gravada = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`memoria:${orgId}`}))`;
        const leitor = await leitorAutorizado(tx, orgId, leitorDoContexto());
        const fonte = await tx.contextItem.findFirst({
          where: { orgId, chave: pedido.fonte.chave, ...filtroDeLeitura(leitor) }, select: SELECAO_DA_NOTA,
        });
        if (!fonte || fonte.id !== pedido.fonte.id || fonte.arquivadoEm ||
            fonte.versao !== pedido.fonte.versao || fonte.contentHash !== pedido.fonte.hash) {
          throw new ConflictException('A fonte mudou, foi arquivada ou deixou de existir. Refaça a prévia.');
        }
        const atual = await tx.contextItem.findFirst({
          where: { orgId, chave: pedido.destino.chave, ...filtroDeLeitura(leitor) }, select: SELECAO_DA_NOTA,
        });
        if (atual?.arquivadoEm) throw new ConflictException('O destino está arquivado. Restaure-o explicitamente na Memória antes de aplicar.');

        // Replay só é inofensivo quando ESTA foi a última versão criada a
        // partir do estado esperado. Uma edição manual intermediária muda a
        // versão ou a referência e não pode ser ignorada.
        const versaoRepetida = (pedido.destino.versao ?? 0) + 1;
        if (atual && (atual.id === pedido.destino.id || pedido.destino.id === null) &&
            atual.versao === versaoRepetida &&
            atual.contentHash === hash && atual.sourceRef === pedido.sourceRef &&
            atual.body === pedido.body && atual.title === pedido.title.trim()) {
          const ultimaVersao = await tx.contextItemVersion.findFirst({
            where: { orgId, itemId: atual.id }, orderBy: { versao: 'desc' },
            select: { versao: true, motivo: true, sourceRef: true },
          });
          if (ultimaVersao?.versao === atual.versao && ultimaVersao.motivo === pedido.motivo &&
              ultimaVersao.sourceRef === pedido.sourceRef) {
            return { item: atual, anterior: null, versao: null, mudanca: ContextChange.alteracao };
          }
        }
        if ((atual?.id ?? null) !== pedido.destino.id || (atual?.versao ?? null) !== pedido.destino.versao ||
            (atual?.contentHash ?? null) !== pedido.destino.hash) {
          throw new ConflictException('O perfil ou os pilares mudaram desde a prévia. Recarregue antes de aplicar.');
        }

        if (!atual) {
          const item = await tx.contextItem.create({
            data: {
              orgId, chave: pedido.destino.chave, kind: ContextKind.definicao,
              title: pedido.title.trim(), body: pedido.body, tags: pedido.tags,
              sourceType: ContextSource.operador, sourceRef: pedido.sourceRef,
              contentHash: hash, versao: 1, criadoPor: ator.actorId, atualizadoPor: ator.actorId,
            },
            select: SELECAO_DA_NOTA,
          });
          const versao = await tx.contextItemVersion.create({
            data: {
              orgId, itemId: item.id, versao: 1, mudanca: ContextChange.criacao,
              kind: item.kind, title: item.title, body: item.body,
              sourceType: item.sourceType, sourceRef: item.sourceRef,
              contentHash: item.contentHash, motivo: pedido.motivo,
              autorTipo: ator.actorType, autorId: ator.actorId,
            },
            select: { id: true, versao: true },
          });
          return { item, anterior: null, versao, mudanca: ContextChange.criacao };
        }

        const ultima = await tx.contextItemVersion.findFirst({
          where: { orgId, itemId: atual.id }, orderBy: { versao: 'desc' }, select: { versao: true },
        });
        const proxima = Math.max(atual.versao, ultima?.versao ?? 0) + 1;
        const item = await tx.contextItem.update({
          where: { id: atual.id },
          data: {
            kind: ContextKind.definicao, title: pedido.title.trim(), body: pedido.body,
            tags: pedido.tags, sourceType: ContextSource.operador, sourceRef: pedido.sourceRef,
            contentHash: hash, versao: proxima, atualizadoPor: ator.actorId,
          },
          select: SELECAO_DA_NOTA,
        });
        // O vetor do texto anterior sai na mesma transação, como em `alterar` (V1).
        if (item.contentHash !== atual.contentHash) {
          await tx.$executeRawUnsafe(
            'UPDATE "ContextItem" SET embedding = NULL WHERE id = $1 AND "orgId" = $2',
            item.id,
            orgId,
          );
        }
        const versao = await tx.contextItemVersion.create({
          data: {
            orgId, itemId: item.id, versao: proxima, mudanca: ContextChange.alteracao,
            kind: item.kind, title: item.title, body: item.body,
            sourceType: item.sourceType, sourceRef: item.sourceRef,
            contentHash: item.contentHash, motivo: pedido.motivo,
            autorTipo: ator.actorType, autorId: ator.actorId,
          },
          select: { id: true, versao: true },
        });
        return { item, anterior: atual, versao, mudanca: ContextChange.alteracao };
      });
    } catch (e) {
      throw this.traduzirChaveRepetida(e, pedido.destino.chave);
    }
    if (gravada.versao) {
      await this.registrarMudanca({
        orgId, mudanca: gravada.mudanca, item: gravada.item,
        versaoId: gravada.versao.id, versaoNumero: gravada.versao.versao,
        motivo: pedido.motivo, anterior: gravada.anterior,
      });
    }
    return (await this.obter(orgId, gravada.item.id)) as NotaDeContexto;
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
   * NÃO É HIPOTÉTICO NESTA INSTALAÇÃO. O caminho `/srv/marketing-os/vault`,
   * para onde o `OBSIDIAN_VAULT_HOST` da VPS continua apontando, esteve vazio e
   * não era a vault real; desde 17/09/2026 ele aponta para o clone da
   * root-base, que é a vault lida hoje (D1, decidida em 04/10/2026, manteve a
   * root-base como fonte). Antes desta fatia o estrago era um índice descartável
   * (`KnowledgeNote` é recriado a cada volta). Agora é o histórico, que não
   * vence nunca.
   *
   * Duas guardas, e as duas RECUSAM O ARQUIVAMENTO sem impedir o resto:
   *  · lista VAZIA com notas vivas na memória: recusa a volta inteira, antes de
   *    gravar qualquer coisa. Vault legítima que ficou sem nenhum arquivo é
   *    evento raríssimo; ponto de montagem caído é semanal.
   *  · arquivamento em MASSA (acima de `TETO_DE_ARQUIVAMENTO`, com piso): faz as
   *    criações e alterações — que são aditivas e reversíveis — e deixa o
   *    arquivamento para uma decisão humana, com o número no log.
   * A decisão humana é o comando de liberação (R-6), que assina o conjunto exato
   * que a guarda segurou: a tela não arquiva item da vault (E4 da ROOT-05-REV).
   *
   * ----------------------------------------------------------------------------
   * IDENTIDADE DO DOCUMENTO
   * Hash confere conteúdo. Um caminho novo sem vínculo explícito cria outro
   * item, mesmo com corpo igual. Não inferimos movimento nem alias nesta volta.
   * Movimento explícito com rastro atômico pertence a outro contrato.
   *
   * `vistos` são os caminhos que ficaram fora da coleção por anomalia do clone
   * (alterado ou apagado fora do git, entrada não verificável, colisão de NFC):
   * o item deles não é arquivado nem alterado nesta volta (R-3).
   */
  async projetarDaVault(
    orgId: string,
    notas: NotaDaVaultParaProjetar[],
    opcoes: { vistos?: readonly string[] } = {},
  ): Promise<ResumoDaProjecao> {
    const resumo = resumoVazio();
    const membros = new Map<string, NotaDaVaultParaProjetar>();
    for (const n of notas) membros.set(chaveDaVault(n.caminho), n);
    const vistosExtras = new Set((opcoes.vistos ?? []).map((c) => chaveDaVault(c)));

    const itens = await this.prisma.contextItem.findMany({
      where: { orgId, sourceType: ContextSource.vault },
      select: { id: true, chave: true, contentHash: true, arquivadoEm: true },
    });
    const vivos = itens.filter((i) => !i.arquivadoEm);
    const vivas = vivos.length;
    const teto = Math.max(PISO_DE_ARQUIVAMENTO, Math.ceil(vivas * TETO_DE_ARQUIVAMENTO));
    const sumidos = vivos.filter((i) => !membros.has(i.chave) && !vistosExtras.has(i.chave));
    const liberacao = await this.liberacaoDaVault(orgId);
    const caminhoDe = (chave: string) => chave.slice(PREFIXO_DA_VAULT.length);

    if (notas.length === 0 && sumidos.length > 0) {
      const conjunto = conjuntoDaGuarda(sumidos.map((s) => s.chave));
      if (liberacao?.arquivamento !== conjunto) {
        resumo.arquivamentoRecusado = sumidos.length;
        resumo.guardas.arquivamento = { quantidade: sumidos.length, conjunto };
        throw new VaultSuspeitaError(
          `a vault respondeu VAZIA e esta empresa tem ${vivas} nota(s) de origem "vault" na ` +
            'memória. Nada foi arquivado: uma pasta que existe e não tem nenhum arquivo é ponto ' +
            'de montagem caído ou caminho errado muito mais vezes do que é vault esvaziada de ' +
            'propósito — e o arquivamento em massa custaria uma versão e um evento por nota, ' +
            'mais outro par quando a pasta voltasse. Se esvaziar for de verdade, quem decide ' +
            `libera este conjunto pelo comando \`${COMANDO_DE_LIBERACAO}\` e a volta seguinte ` +
            'arquiva; a tela não arquiva nota da vault.',
          resumo,
        );
      }
    }

    // Um caminho novo não herda identidade por igualdade de conteúdo.
    const segurados = new Set<string>();
    const movidos = new Set<string>();

    // ---- o laço: quem não aponta substituição primeiro --------------------------
    const ordem = [...membros.entries()]
      .filter(([chave]) => !segurados.has(chave))
      .sort(([, a], [, b]) => Number(Boolean(a.cabecalho?.substitui)) - Number(Boolean(b.cabecalho?.substitui)));
    const adiados: Array<[string, NotaDaVaultParaProjetar]> = [];
    for (const [chave, nota] of ordem) {
      try {
        const supersedesId = await this.alvoDaSubstituicao(orgId, chave, nota, membros, resumo, adiados);
        await this.projetarUmaNota(orgId, chave, nota, resumo, supersedesId);
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
    // A substituição cujo alvo nasceu nesta mesma volta, depois de quem o aponta.
    for (const [chave, nota] of adiados) {
      try {
        const alvo = await this.porChave(orgId, chaveDaVault(nota.cabecalho!.substitui!));
        const item = await this.porChave(orgId, chave);
        if (!alvo || !item) {
          resumo.substituicoes.semAlvo++;
          resumo.avisos.push(`${nota.caminho}: substitui "${nota.cabecalho!.substitui}" sem nota correspondente`);
          continue;
        }
        resumo.substituicoes.resolvidas++;
        if (item.supersedesId !== alvo.id) {
          await this.alterar(orgId, item.id, {
            supersedesId: alvo.id,
            motivo: 'substitui: a nota apontada nasceu nesta mesma volta da vault',
          });
          resumo.alteradas++;
        }
      } catch (e) {
        resumo.falhas++;
        this.log.warn(`empresa ${orgId}: a substituição de "${nota.caminho}" falhou (${(e as Error).message}).`);
      }
    }

    // ---- o arquivamento: só o que sumiu sem par ------------------------------
    const sumidas = sumidos.filter((s) => !movidos.has(s.chave) && !segurados.has(s.chave));
    const conjuntoDoArquivamento = conjuntoDaGuarda(sumidas.map((s) => s.chave));
    if (sumidas.length > teto) {
      if (liberacao?.arquivamento !== conjuntoDoArquivamento) {
        resumo.arquivamentoRecusado = sumidas.length;
        resumo.guardas.arquivamento = { quantidade: sumidas.length, conjunto: conjuntoDoArquivamento };
        this.log.error(
          `empresa ${orgId}: a volta da vault sumiu com ${sumidas.length} de ${vivas} nota(s) ` +
            `vivas, acima do teto de ${teto} para uma volta só. NADA foi arquivado — isto tem ` +
            'cara de vault montada no lugar errado, e arquivar em massa é caro de desfazer ' +
            '(uma versão e um evento por nota, nos dois sentidos). Confira o caminho da vault; ' +
            `se a remoção for real, quem decide libera este conjunto com \`${COMANDO_DE_LIBERACAO}\` ` +
            'e a volta seguinte arquiva. A tela não arquiva nota da vault.',
        );
        return resumo;
      }
      resumo.liberacaoUsada = liberacao.eventoId;
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

  /**
   * O `supersedesId` de uma nota, a partir do `substitui:` já normalizado.
   * `undefined` = o cabeçalho não foi lido; a projeção preserva o campo,
   * exceto pelo autoalvo já conhecido no registro autorizado.
   */
  private async alvoDaSubstituicao(
    orgId: string,
    chave: string,
    nota: NotaDaVaultParaProjetar,
    membros: Map<string, NotaDaVaultParaProjetar>,
    resumo: ResumoDaProjecao,
    adiados: Array<[string, NotaDaVaultParaProjetar]>,
  ): Promise<string | null | undefined> {
    if (!nota.cabecalho) return undefined;
    for (const aviso of nota.cabecalho.avisos ?? []) resumo.avisos.push(`${nota.caminho}: ${aviso}`);
    if (nota.cabecalho.substituicaoRecusada) {
      resumo.substituicoes.semAlvo++;
      return null;
    }
    const substitui = nota.cabecalho.substitui;
    if (!substitui) return null;
    const chaveDoAlvo = chaveDaVault(substitui);
    if (chaveDoAlvo === chave) {
      resumo.substituicoes.semAlvo++;
      resumo.avisos.push(`${nota.caminho}: substitui "${substitui}" aponta para a própria nota`);
      return null;
    }
    const alvo = await this.porChave(orgId, chaveDoAlvo);
    if (alvo) {
      resumo.substituicoes.resolvidas++;
      return alvo.id;
    }
    if (membros.has(chaveDoAlvo) && chaveDoAlvo !== chave) {
      adiados.push([chave, nota]);
      return null;
    }
    resumo.substituicoes.semAlvo++;
    resumo.avisos.push(`${nota.caminho}: substitui "${substitui}" sem nota correspondente`);
    return null;
  }

  /** Uma nota da vault, projetada. Separado para que a falha seja POR NOTA. */
  private async projetarUmaNota(
    orgId: string,
    chave: string,
    nota: NotaDaVaultParaProjetar,
    resumo: ResumoDaProjecao,
    supersedesId: string | null | undefined,
  ): Promise<void> {
    const existente = await this.porChave(orgId, chave);
    const hash = hashDoCorpo(nota.body);
    const cab = nota.cabecalho;

    if (!existente) {
      await this.criar(orgId, {
        chave,
        kind: cab?.kind ?? ContextKind.nota,
        title: nota.title,
        body: nota.body,
        tags: nota.tags ?? [],
        sourceType: ContextSource.vault,
        sourceRef: nota.caminho,
        validFrom: cab?.validFrom ?? null,
        validUntil: cab?.validUntil ?? null,
        supersedesId: supersedesId ?? null,
        embedding: nota.embedding ?? null,
        motivo: 'indexação da vault do Obsidian',
      });
      resumo.criadas++;
      return;
    }

    // O cache não relê o cabeçalho, mas o registro autorizado já revela o
    // autoalvo antigo. Corrigir só esse campo usa o versionamento existente.
    if (supersedesId === undefined && existente.supersedesId === existente.id) {
      supersedesId = null;
      resumo.substituicoes.semAlvo++;
      resumo.avisos.push(`${nota.caminho}: substituição persistida aponta para a própria nota`);
    }

    const mudouTexto =
      hash !== existente.contentHash ||
      nota.title !== existente.title ||
      !mesmasTags(nota.tags ?? [], existente.tags);
    /*
     * O CABEÇALHO TAMBÉM VERSIONA (C19-05, R-8). `kind`, `valido_de`,
     * `valido_ate` e `substitui` contam como mudança: um `valido_ate` novo é
     * como a base aposenta uma regra, e sem versão a regra seguiria valendo para
     * o agente. O histórico desses três campos vai no EVENTO (`estadoDaNota`),
     * sem coluna nova em `ContextItemVersion`.
     */
    const mudouCabecalho =
      (cab !== undefined &&
        (cab.kind !== existente.kind ||
          iso(cab.validFrom) !== existente.validFrom ||
          iso(cab.validUntil) !== existente.validUntil)) ||
      (supersedesId !== undefined && supersedesId !== existente.supersedesId);

    if (!mudouTexto && !mudouCabecalho && !existente.arquivadoEm) {
      // Nada mudou no arquivo. O vetor pode estar faltando (nota criada na
      // tela antes de haver chave de embedding): esse é o único caso em que
      // ainda vale gravar alguma coisa.
      if (nota.embedding?.length && !existente.temVetor) {
        await this.gravarVetorSemDerrubar(orgId, existente.id, hash, nota.embedding);
      }
      resumo.inalteradas++;
      return;
    }

    if (existente.arquivadoEm) {
      await this.restaurar(orgId, existente.id, 'o arquivo voltou a existir na vault');
      resumo.restauradas++;
    }
    if (mudouTexto || mudouCabecalho) {
      await this.alterar(orgId, existente.id, {
        title: nota.title,
        body: nota.body,
        tags: nota.tags ?? [],
        sourceType: ContextSource.vault,
        sourceRef: nota.caminho,
        ...(cab ? { kind: cab.kind, validFrom: cab.validFrom, validUntil: cab.validUntil } : {}),
        ...(supersedesId !== undefined ? { supersedesId } : {}),
        embedding: nota.embedding ?? null,
        motivo: mudouTexto
          ? 'o arquivo mudou na vault do Obsidian'
          : 'o cabeçalho do arquivo mudou na vault do Obsidian (kind, validade ou substitui)',
      });
      resumo.alteradas++;
    }
  }

  /**
   * O MOVIMENTO (C19-04): a mesma linha troca de chave, com uma versão
   * `alteracao` que guarda `sourceRef` novo e o motivo de onde para onde. A
   * versão anterior continua com o caminho antigo, e o evento sai com `vault:A`
   * no estado anterior e `vault:B` no novo, pelo caminho que já existe.
   *
   * O destino é conferido DENTRO do cadeado: entre o cálculo do par e aqui, só
   * a própria projeção cria chave `vault:` (a borda HTTP recusa o prefixo), mas
   * a conferência é barata e o índice único `(orgId, chave)` é a segunda tranca.
   */
  private async mover(
    orgId: string,
    id: string,
    novaChave: string,
    novoCaminho: string,
    motivo: string,
  ): Promise<void> {
    const ator = this.ator();
    const { item, anterior, versao } = await this.gravarVersao({
      orgId,
      id,
      mudanca: ContextChange.alteracao,
      ator,
      conferir: async (tx, atual) => {
        if (atual.arquivadoEm) throw new ConflictException('a nota de origem foi arquivada no meio da volta');
        const ocupada = await tx.contextItem.findFirst({ where: { orgId, chave: novaChave }, select: { id: true } });
        if (ocupada) throw this.conflitoDeChave(novaChave);
      },
      montar: () => ({
        dados: { chave: novaChave, sourceType: ContextSource.vault, sourceRef: novoCaminho, atualizadoPor: ator.actorId },
        motivo,
      }),
    });
    await this.registrarMudanca({
      orgId,
      mudanca: ContextChange.alteracao,
      item,
      versaoId: versao.id,
      versaoNumero: versao.versao,
      motivo,
      anterior,
    });
  }

  // ==========================================================================
  // O RECIBO E A LIBERAÇÃO DAS GUARDAS — C19-08 e R-6
  // ==========================================================================

  /**
   * O recibo de uma volta da vault, no RASTRO. Quem monta é o conector
   * (`obsidian/recibo-da-vault.ts`), que sabe de montante, descoberta, leitura,
   * índice e vetor; aqui é só a escrita, pelo mesmo `EventLogService` das
   * mudanças da memória, com a correlação da volta — a mesma dos eventos
   * `memoria.item.*` que ela produziu.
   */
  async registrarReciboDaVault(
    orgId: string,
    recibo: { payload: Prisma.InputJsonValue; resumo: string; motivo: string },
  ): Promise<{ id: string; seq: bigint }> {
    const ator = this.ator();
    return this.eventos.registrar({
      orgId,
      tipo: TIPO_DO_RECIBO,
      actorType: (ator.actorType as ActorType) ?? ActorType.system,
      actorId: ator.actorId,
      correlationId: ator.correlationId,
      payload: recibo.payload,
      conteudo: { resumo: recibo.resumo, fontes: [COLECAO_DA_VAULT], motivo: recibo.motivo },
      sensibilidade: 'interna',
    });
  }

  /** O último recibo da vault desta empresa: a assinatura e quando. */
  async ultimoReciboDaVault(orgId: string): Promise<{ assinatura: string | null; ocorreuEm: Date } | null> {
    const ultimo = await this.prisma.eventLog.findFirst({
      where: { orgId, tipo: TIPO_DO_RECIBO },
      orderBy: { seq: 'desc' },
      select: { ocorreuEm: true, payload: true },
    });
    if (!ultimo) return null;
    const assinatura = (ultimo.payload as { assinatura?: unknown } | null)?.assinatura;
    return { assinatura: typeof assinatura === 'string' ? assinatura : null, ocorreuEm: ultimo.ocorreuEm };
  }

  /**
   * A LIBERAÇÃO DE UMA GUARDA, por gente (R-6).
   *
   * Grava o evento que a projeção lê na volta seguinte: o conjunto exato que a
   * guarda segurou (resumo das chaves), quem liberou e por quê. Só vale para
   * aquele conjunto e por 24 horas; consumida, não vale de novo. Recusa ator que
   * não seja pessoa: liberar arquivamento em massa é decisão de alguém com nome.
   */
  async liberarGuardaDaVault(
    orgId: string,
    pedido: {
      reciboId: string;
      arquivamento: { conjunto: string; quantidade: number } | null;
      movimentos: { conjunto: string; quantidade: number } | null;
      motivo: string;
    },
  ): Promise<{ id: string; seq: bigint }> {
    const ator = this.ator();
    if (ator.actorType !== ActorType.user || !ator.actorId) {
      throw new BadRequestException('A liberação da guarda da vault é de uma pessoa: o ator precisa ser um usuário.');
    }
    const motivo = (pedido.motivo ?? '').trim();
    if (motivo.length < 10) throw new BadRequestException('Diga por que a guarda está sendo liberada (motivo com 10+ caracteres).');
    if (!pedido.arquivamento && !pedido.movimentos) throw new BadRequestException('Nada a liberar: o recibo não tem conjunto segurado.');
    return this.eventos.registrar({
      orgId,
      tipo: TIPO_DA_LIBERACAO,
      actorType: ActorType.user,
      actorId: ator.actorId,
      correlationId: ator.correlationId,
      payload: {
        reciboId: pedido.reciboId,
        conjuntos: {
          arquivamento: pedido.arquivamento?.conjunto ?? null,
          movimentos: pedido.movimentos?.conjunto ?? null,
        },
      },
      conteudo: {
        resumo:
          `liberação da guarda da vault: ${pedido.arquivamento?.quantidade ?? 0} arquivamento(s) e ` +
          `${pedido.movimentos?.quantidade ?? 0} movimento(s) do recibo ${pedido.reciboId}`,
        motivo,
        fontes: [COLECAO_DA_VAULT],
      },
      sensibilidade: 'interna',
    });
  }

  /** A liberação que ainda vale: a mais recente, de até 24 h, que nenhum recibo consumiu. */
  async liberacaoDaVault(
    orgId: string,
  ): Promise<{ eventoId: string; arquivamento: string | null; movimentos: string | null } | null> {
    const ev = await this.prisma.eventLog.findFirst({
      where: { orgId, tipo: TIPO_DA_LIBERACAO },
      orderBy: { seq: 'desc' },
      select: { id: true, seq: true, ocorreuEm: true, payload: true },
    });
    if (!ev || Date.now() - ev.ocorreuEm.getTime() > VALIDADE_DA_LIBERACAO_MS) return null;
    const consumida = await this.prisma.eventLog.findFirst({
      where: { orgId, tipo: TIPO_DO_RECIBO, seq: { gt: ev.seq }, payload: { path: ['liberacaoUsada'], equals: ev.id } },
      select: { id: true },
    });
    if (consumida) return null;
    const conjuntos = (ev.payload as { conjuntos?: { arquivamento?: unknown; movimentos?: unknown } } | null)?.conjuntos;
    return {
      eventoId: ev.id,
      arquivamento: typeof conjuntos?.arquivamento === 'string' ? conjuntos.arquivamento : null,
      movimentos: typeof conjuntos?.movimentos === 'string' ? conjuntos.movimentos : null,
    };
  }

  /**
   * As notas desta empresa que ainda não têm vetor. Quem as vetoriza é o conector.
   *
   * O `contentHash` vai junto porque o vetor só pode ser gravado sobre o corpo
   * que foi lido aqui: entre esta leitura e a volta do fornecedor alguém pode
   * editar a nota, e `gravarVetor` confere o hash para não pôr o vetor do texto
   * antigo em cima do novo.
   *
   * `excetoChaves` tira da fila as notas que outro caminho já vetoriza nesta
   * volta (as da vault, que recebem o vetor do índice — R2 da ROOT-05ab-REV). O
   * corte é na consulta, antes do `LIMIT`: filtrar depois deixaria nota da vault
   * ocupando as vagas das que só esta fila alcança.
   */
  async semVetor(
    orgId: string,
    limite = 100,
    opcoes: { excetoChaves?: readonly string[] } = {},
  ): Promise<Array<{ id: string; title: string; body: string; contentHash: string }>> {
    return this.prisma.$queryRawUnsafe(
      `SELECT id, title, body, "contentHash"
         FROM "ContextItem"
        WHERE "orgId" = $1 AND "arquivadoEm" IS NULL AND embedding IS NULL AND "acessoRestrito" = false
          AND NOT (chave = ANY($3::text[]))
        ORDER BY "atualizadoEm" DESC
        LIMIT $2`,
      orgId,
      limite,
      [...(opcoes.excetoChaves ?? [])],
    );
  }

  /**
   * Grava o vetor de uma nota, se ela ainda tem o corpo de onde o vetor saiu.
   *
   * `$executeRawUnsafe` porque `vector` é `Unsupported` no Prisma — o mesmo
   * caminho que `ObsidianService.reindex` e `PautaService` já usam. O `AND
   * "orgId"` não é redundância com a policy: é a primeira tranca, e é ela que
   * transforma um id trocado num zero-linhas em vez de numa escrita em empresa
   * alheia.
   *
   * O `AND "contentHash"` é a mesma tranca contra o tempo. O vetor é calculado
   * fora daqui, às vezes um minuto depois da leitura; se a nota mudou nesse
   * meio-tempo, gravar seria pôr o significado do texto antigo no texto novo, sem
   * nada que permita achar isso depois. Devolve as linhas alteradas: zero quer
   * dizer que o corpo mudou (ou que a nota não é desta empresa) e o vetor foi
   * descartado.
   */
  async gravarVetor(orgId: string, id: string, vetor: number[], contentHash: string): Promise<number> {
    return this.prisma.$executeRawUnsafe(
      'UPDATE "ContextItem" SET embedding = $1::vector WHERE id = $2 AND "orgId" = $3 AND "contentHash" = $4',
      `[${vetor.join(',')}]`,
      id,
      orgId,
      contentHash,
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
   *
   * `contentHash` é o do corpo de onde o vetor saiu, e a gravação é condicionada
   * a ele: se outra mudança passou na frente, ela é a dona da coluna e esta não
   * mexe em nada. Quem chama garante que, sem gravar, a coluna fica vazia (a
   * nota nova nasce sem vetor, a projeção só chega aqui com `!temVetor` e
   * `alterar` esvazia a coluna na transação que troca o corpo). É isso que torna
   * verdade o "volta na próxima passada": com o vetor velho no lugar, nenhuma
   * passada a encontraria.
   */
  private async gravarVetorSemDerrubar(
    orgId: string,
    id: string,
    contentHash: string,
    vetor?: number[] | null,
  ): Promise<void> {
    if (!vetor?.length) return;
    try {
      await this.gravarVetor(orgId, id, vetor, contentHash);
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
    const leitor = await leitorAutorizado(this.prisma, orgId, leitorDoContexto());
    const [versoes, eventos] = await Promise.all([
      /*
       * OS DOIS LADOS PEGAM AS MAIS RECENTES, e a simetria importa: com o teto
       * atingido, versões novas contra eventos VELHOS acusariam "sem
       * explicação" em massa só porque o evento ficou de fora da consulta.
       */
      this.prisma.contextItemVersion.findMany({
        where: { orgId, item: filtroDeLeitura(leitor) },
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

  async contarComVetor(orgId: string, solicitanteId: string | null = leitorDoContexto()): Promise<number> {
    if (solicitanteId) await exigirAcessoAtual(this.prisma, orgId, solicitanteId, ['obsidian.ver']);
    const final = await this.leituraAtual(orgId, solicitanteId, []);
    return Number(final.comVetor);
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
   *
   * `noCadeado` é a escrita que precisa acontecer junto com a do item e fora do
   * alcance do Prisma (a coluna `vector` é `Unsupported`). Roda depois do item e
   * da versão, na mesma transação: lançar ali desfaz tudo. Hoje só `alterar` o
   * usa, para tirar o vetor do corpo anterior.
   *
   * `conferir` é a pergunta que precisa do banco ANTES de montar, ainda sob o
   * cadeado — o movimento da vault o usa para conferir que a chave de destino
   * continua livre.
   */
  private async gravarVersao(args: {
    orgId: string;
    id: string;
    mudanca: ContextChange;
    ator: { actorType: string; actorId: string | null };
    conferir?: (tx: Prisma.TransactionClient, atual: LinhaDaNota) => Promise<void>;
    montar: (atual: LinhaDaNota) => {
      dados: Prisma.ContextItemUncheckedUpdateInput;
      motivo: string | null;
    };
    noCadeado?: (tx: Prisma.TransactionClient, antes: LinhaDaNota, depois: LinhaDaNota) => Promise<void>;
  }): Promise<{
    item: LinhaDaNota;
    anterior: LinhaDaNota;
    versao: { id: string; versao: number };
  }> {
    const { orgId, id, mudanca, ator, conferir, montar, noCadeado } = args;
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`memoria:${orgId}`}))`;

      const leitor = await leitorAutorizado(tx, orgId, leitorDoContexto());
      const atual = await tx.contextItem.findFirst({
        where: { id, orgId, ...filtroDeLeitura(leitor) },
        select: SELECAO_DA_NOTA,
      });
      if (!atual) throw new NotFoundException('Nota não encontrada nesta empresa.');

      await conferir?.(tx, atual);
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
      await noCadeado?.(tx, atual, item);
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
  private async conferirLeitores(db: Pick<Prisma.TransactionClient, 'user'>, orgId: string, leitores?: string[]): Promise<void> {
    if (leitores === undefined) return;
    if (new Set(leitores).size !== leitores.length ||
      await db.user.count({ where: { orgId, id: { in: leitores } } }) !== leitores.length)
      throw new BadRequestException('As pessoas concedidas precisam pertencer a esta empresa e não podem se repetir.');
  }

  private async reconferirLeitura<T extends { id: string; acessoRestrito?: boolean }>(
    orgId: string, linhas: T[], solicitanteId: string | null,
  ): Promise<T[]> {
    const final = await this.leituraAtual(orgId, solicitanteId, linhas.map((l) => l.id));
    const ids = new Set(final.ids);
    return linhas.filter((l) => ids.has(l.id));
  }

  /** Pessoa, ACL da fonte e contador são conferidos no mesmo retrato do banco. */
  private async leituraAtual(
    orgId: string, solicitanteId: string | null, itemIds: string[],
  ): Promise<{ autorizado: boolean; ids: string[]; comVetor: bigint }> {
    const linhas = await this.prisma.$queryRawUnsafe<Array<{ autorizado: boolean; ids: string[]; comVetor: bigint }>>(`
      WITH acesso AS (
        SELECT ($2::text IS NULL OR EXISTS (
          SELECT 1 FROM "User" u
          JOIN "_UserRoles" ur ON ur."B" = u.id
          JOIN "Role" r ON r.id = ur."A" AND r."orgId" = u."orgId"
          JOIN "_RolePermissions" rp ON rp."B" = r.id
          JOIN "Permission" p ON p.id = rp."A"
          WHERE u.id = $2 AND u."orgId" = $1 AND u."isActive" = true AND p.key = 'obsidian.ver'
        )) AS autorizado
      ), permitidas AS (
        SELECT c.id, (c.embedding IS NOT NULL) AS "temVetor" FROM "ContextItem" c
        WHERE c."orgId" = $1
          AND (c."acessoRestrito" = false OR $2::text = ANY(c.leitores))
          AND (SELECT autorizado FROM acesso)
      )
      SELECT a.autorizado,
        ARRAY(SELECT id FROM permitidas WHERE id = ANY($3::text[])) AS ids,
        (SELECT count(*)::bigint FROM permitidas WHERE "temVetor") AS "comVetor"
      FROM acesso a
    `, orgId, solicitanteId, itemIds);
    const final = linhas[0];
    if (!final?.autorizado) throw new ForbiddenException('Acesso insuficiente.');
    return final;
  }

  private async retratoAtual(orgId: string, nota: NotaDeContexto, pessoaId: string): Promise<NotaDeContexto> {
    const v = await this.prisma.contextItemVersion.findFirst({ where: { orgId, itemId: nota.id, versao: nota.versao } });
    if (!v || v.body !== nota.body || v.title !== nota.title || v.contentHash !== nota.contentHash
      || v.sourceType !== nota.sourceType || v.sourceRef !== nota.sourceRef)
      throw new ConflictException({ code: 'contexto_fonte_inconsistente', message: 'A versão da fonte não pôde ser conferida.' });
    return { ...nota, escopo: { orgId, userId: pessoaId }, retratoFonte: construirFonteAutorizada({
      item: { ...nota, orgId, arquivadoEm: nota.arquivadoEm, atualizadoEm: nota.atualizadoEm }, versaoSelecionada: v,
      incluirCorpo: true, acessoVerificadoEm: new Date(), novoUsoPermitido: !nota.arquivadoEm,
    }) };
  }

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
  id: true, acessoRestrito: true, leitores: true,
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
  'id', '"acessoRestrito"', 'leitores',
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
  acessoRestrito?: boolean;
  leitores?: string[];
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
    /*
     * VALIDADE E SUBSTITUIÇÃO, no antes e no depois (R-8). `ContextItemVersion`
     * não tem essas colunas, e acrescentá-las seria migration com gate; o evento
     * já é a fonte da memória (ADR-011), então é nele que o histórico dos três
     * campos mora. A versão que sobreviver ao expurgo do evento perde esse
     * histórico — está escrito no ADR para ninguém prometer mais do que isso.
     */
    validFrom: iso(l.validFrom),
    validUntil: iso(l.validUntil),
    supersedesId: l.supersedesId ?? null,
  };
}

function mesmasTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const ordenadoA = [...a].sort();
  const ordenadoB = [...b].sort();
  return ordenadoA.every((t, i) => t === ordenadoB[i]);
}
