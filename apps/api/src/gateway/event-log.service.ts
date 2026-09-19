import { Injectable, Logger, Optional } from '@nestjs/common';
import { ActorType, Prisma, RiskLevel } from '@prisma/client';
import { createHash } from 'node:crypto';
import politicaEmpacotada from '@mktos/policy/politica-root.json';
import { PrismaService } from '../prisma/prisma.service';
import { PolicyService } from '../policy/policy.service';

/**
 * O que o RASTRO guarda ALÉM das colunas — os campos que a política nomeia em
 * `niveis.<R>.rastro`, um por um.
 *
 * Cada chave aqui é uma palavra do vocabulário da política. Não invente chave
 * nova: se a política não pede, o campo é enfeite; se a política pede e não
 * existe aqui, a conferência acusa `faltando` e ninguém consegue satisfazer.
 */
export interface ConteudoDoEvento {
  /** R0/R1: a pergunta que a consulta respondeu. */
  pergunta?: unknown;
  /** `argumentos` da política. `pergunta` também satisfaz este campo. */
  argumentos?: unknown;
  /** De onde veio o que o modelo leu. Metadado — nunca redigido. */
  fontes?: unknown;
  /** Quanto custou. Metadado — nunca redigido. */
  custo?: unknown;
  /** R1: o que foi produzido. */
  artefato?: unknown;
  /** R1: qual versão do prompt gerou. */
  versaoPrompt?: unknown;
  /** R2+: o que a ação devolveu. */
  resultado?: unknown;
  /** R2: como desfazer. */
  desfazer?: unknown;
  /** R3+: o resumo legível do conteúdo aprovado — o substituto seguro do cru. */
  resumo?: unknown;
  /** R3+: quem assinou. É pessoa, nunca o agente que propôs. */
  aprovador?: unknown;
  /** R3+: quando assinou. */
  aprovadoEm?: Date | string | null;
  /** R3+: por qual canal saiu (whatsapp, email, instagram…). */
  canal?: unknown;
  /** R3+: o retorno da entrega — o que o outro lado respondeu. */
  entrega?: unknown;
  /** R4+: por que foi feito. */
  motivo?: unknown;
  /** R4+: o antes e o depois. */
  estadoAnterior?: unknown;
  estadoNovo?: unknown;
  /** R5: o que foi preparado e para quem foi encaminhado. */
  preparo?: unknown;
  encaminhadoPara?: unknown;
  encaminhadoEm?: Date | string | null;
  desfechoInformado?: unknown;
  /**
   * Onde o conteúdo cru de verdade mora, quando ele foi substituído por resumo
   * criptográfico. É a outra metade do "resumo e a referência".
   */
  referencia?: string;
}

/*
 * ============================================================================
 * OS PONTOS DE CHAMADA DESTE VOCABULÁRIO — leia antes de mexer
 * ============================================================================
 *
 * ESTADO EM 11/09/2026 (estabilização da onda 6): O VOCABULÁRIO ESTÁ LIGADO.
 * Os CINCO pontos de chamada que escrevem no RASTRO passam `conteudo` e, onde
 * há conteúdo de cliente, `sensibilidade`. Não refaça esse trabalho, e não
 * invente um segundo registrador: quem escreve linha no RASTRO é `registrar`,
 * desta classe, e mais nada.
 *
 * SÃO CINCO, E NÃO SEIS. A versão anterior deste bloco contava
 * `agents/efeitos.service.ts` como ponto de chamada — ele tem um método
 * `registrar`, mas é o do REGISTRO DE EFEITOS (`gateway/efeitos.registry.ts`),
 * que só guarda callbacks e nunca escreve evento nenhum. Quem registra o que
 * aconteceu com um efeito é a porta, em volta dele.
 *
 * O MAPA, ponto a ponto — o que cada um passa hoje:
 *
 *   `gateway/tool-gateway.service.ts`  (cinco chamadas)
 *     · `tool.proposta`   → conteudo: { argumentos, fontes, custo, canal? },
 *                           contentHash: o hash que amarra a aprovação,
 *                           sensibilidade: cap?.efeito.sensibilidade
 *     · `tool.resultado`  → conteudo: { argumentos, resultado, fontes, custo,
 *                           desfazer, canal?, entrega?, aprovador?, aprovadoEm?,
 *                           motivo? } — os três últimos vêm do retorno de
 *                           `ApprovalsService.consumir`, e é por isso que aquele
 *                           método devolve a aprovação em vez de `void`
 *     · `tool.recusado` (dois caminhos) e `tool.erro` → conteudo: { argumentos,
 *                           fontes, custo }, mais o bloco de R5 quando é R5
 *     · `aprovacao.invalida` → o mesmo trio de argumentos/fontes/custo
 *
 *   `gateway/acoes.service.ts`  (duas chamadas, `conteudoDaAcao`)
 *     · `acao.executada` / `acao.falhou` → ATENÇÃO: aqui mora a ARMADILHA, e ela
 *       continua valendo para quem for mexer. O payload deste caminho JÁ
 *       CARREGAVA O APROVADOR, com outro nome (`aprovadoPor: ap.aprovadoPorId`).
 *       Como a conferência procura a palavra da POLÍTICA (`aprovador`), ela
 *       acusava "aprovador faltando" numa linha que o continha — dívida contada
 *       duas vezes e nenhuma delas verdadeira. O conserto foi RENOMEAR na
 *       chamada, não registrar de novo:
 *           conteudo: {
 *             aprovador: ap.aprovadoPorId,
 *             aprovadoEm: ap.aprovadoEm,
 *             canal, resumo, motivo, desfazer, fontes, custo,
 *             argumentos, resultado, entrega,
 *           }
 *       `approvalId` e `duracaoMs` continuam em `payload`: são metadado da
 *       operação, não palavra da política.
 *
 *   `tenants/provisionar.service.ts`, `integrations/conectores.service.ts`,
 *   `llm/teto-diario.service.ts`
 *     · mesma forma, com os campos que o nível de cada um pedir.
 *
 * ----------------------------------------------------------------------------
 * A FRONTEIRA: LINHA DE INTENÇÃO × LINHA DE DESFECHO
 * ----------------------------------------------------------------------------
 * `GET /audit/verificar` devolve `incompletosPorNivel`, e é ele que mede a
 * dívida sem depender de ninguém acreditar em ninguém. ESSE NÚMERO NÃO CAI A
 * ZERO, E NÃO DEVE CAIR. Quem ler "zero" como meta vai ler o resto como defeito.
 *
 * A política cobra de CADA LINHA os campos do nível dela, mas uma passagem pela
 * porta escreve linhas de duas naturezas:
 *
 *   · LINHA DE INTENÇÃO — `tool.proposta`. É gravada ANTES de existir aprovação
 *     e antes de qualquer coisa sair. Num R3 ela não tem como carregar
 *     `aprovador`, `aprovadoEm` nem `entrega`; num R4, tampouco `motivo`,
 *     `estadoAnterior` e `estadoNovo`; num R1, nem `artefato` nem `versaoPrompt`.
 *     Preenchê-los ali seria escrever no RASTRO que houve gente antes de haver,
 *     que é a única coisa pior do que um campo em branco.
 *
 *   · LINHA DE DESFECHO — `tool.resultado` e `acao.executada`. Esta sim carrega
 *     tudo o que quem a escreve SABE. É dela que se cobra completude.
 *
 *   · LINHA DE DESFECHO NEGATIVO — `tool.recusado`, `tool.erro`, `acao.falhou`,
 *     `aprovacao.invalida`. Mesma cobrança, com uma ressalva óbvia e por escrito:
 *     o que NÃO ACONTECEU não tem como constar. Uma recusa não tem `entrega`
 *     (nada saiu) e, quando a recusa vem ANTES de qualquer aprovação — que é o
 *     caso de `tool.recusado` e `aprovacao.invalida` —, também não tem
 *     `aprovador` nem `aprovadoEm`. Já `acao.falhou` TEM os dois e os carrega:
 *     a ação foi aprovada, tentou sair, e não deu. `canal` entra em todas elas,
 *     inclusive nas recusas — quem audita um "não" precisa saber de que porta de
 *     saída se fala.
 *
 * E mesmo na linha de desfecho sobra o que o escritor NÃO TEM. Declarado, com
 * dono, para ninguém procurar defeito onde não há:
 *
 *   · `artefato` e `versaoPrompt` (R1) — são do RUNTIME DO AGENTE, que produziu
 *     o texto e sabe com qual versão de prompt. A porta vê uma chamada de
 *     ferramenta, não a geração. Fica em `agents/agent-runtime.service.ts`.
 *   · `estadoAnterior` e `estadoNovo` (R4) — são do EFEITO/CONECTOR, o único que
 *     enxerga o registro antes e depois. A porta vê o retorno, não o antes.
 *   · `desfechoInformado` (R5) — NÃO TEM DONO neste repositório: ninguém volta
 *     para dizer ao OS o que a pessoa fez com o preparo que recebeu.
 *   · `agente`, quando o ator é gente — não há agente. A política pede `agente`
 *     em todo nível porque foi escrita pensando no laço do agente; uma ação que
 *     uma pessoa dispara pela tela não tem o que preencher ali.
 *
 * O que a conferência serve, então, é a FRONTEIRA, não o zero: a linha de
 * desfecho não pode faltar nada do que quem a escreve sabe, e a linha de
 * intenção só pode faltar o que ainda não aconteceu.
 */

export type SensibilidadeDoEvento = 'publica' | 'interna' | 'confidencial' | 'restrita';

export interface EventoInput {
  orgId: string;
  tipo: string;
  actorType?: ActorType;
  actorId?: string | null;
  agentSlug?: string | null;
  capabilityId?: string | null;
  toolCallId?: string | null;
  decisionId?: string | null;
  nivel?: RiskLevel | null;
  correlationId?: string | null;
  payload?: Prisma.InputJsonValue;
  contentHash?: string | null;
  /** Os campos que a política nomeia. Ver `ConteudoDoEvento`. */
  conteudo?: ConteudoDoEvento;
  /**
   * A sensibilidade da capacidade (`efeito.sensibilidade`). `confidencial` e
   * `restrita` fazem o conteúdo cru virar resumo criptográfico + referência.
   */
  sensibilidade?: SensibilidadeDoEvento;
}

/** O valor marcado individualmente como sigiloso, em qualquer nível. */
interface ValorSigiloso {
  readonly __sigiloso: true;
  readonly valor: unknown;
  readonly rotulo?: string;
}

/**
 * Marca UM valor como sigiloso, independentemente do nível da capacidade.
 *
 * `registrar({ conteudo: { argumentos: { para: '+55…', corpo: sigiloso(texto) } } })`
 *
 * O que entra no registro é o resumo criptográfico e o tamanho — nunca o texto.
 * Existe porque a sensibilidade da CAPACIDADE é grossa demais para o caso comum:
 * uma ação `interna` pode carregar um campo que quem audita não pode ler, e
 * classificar a capacidade inteira como confidencial por causa dele cegaria o
 * resto do registro.
 */
export function sigiloso(valor: unknown, rotulo?: string): unknown {
  const marcado: ValorSigiloso = { __sigiloso: true, valor, rotulo };
  return marcado;
}

function ehSigiloso(v: unknown): v is ValorSigiloso {
  return typeof v === 'object' && v !== null && (v as ValorSigiloso).__sigiloso === true;
}

/**
 * O tipo do evento que registra um expurgo por retenção.
 *
 * CONSTANTE E NÃO LITERAL porque o mesmo texto decide quatro coisas diferentes
 * e divergir em UMA delas reabilita, em silêncio, apagar o registro do expurgo:
 *
 *   1. aqui, em `TIPOS_PERENES` — o evento nasce com prazo no ano 9999;
 *   2. aqui, em `faixasExpurgadas()` — é por este tipo que `verificar()` acha
 *      quem assumiu cada buraco da cadeia;
 *   3. no banco, na policy `tenant_expurgo_retencao` (`tipo <> '…'`);
 *   4. no banco, no DELETE e no INSERT de `app_rastro_expurgar`.
 *
 * Os dois primeiros importam este símbolo. Os dois do banco não têm como
 * importar nada — então quem os prende a este valor é um caso de
 * `rastro-retencao.test.ts` ("o mesmo texto…"), que lê a policy e a função do
 * catálogo do PostgreSQL e compara com esta constante.
 */
export const TIPO_EXPURGO = 'rastro.expurgo';

/**
 * O ano 9999. É o `retencaoAte` do evento que registra um expurgo.
 *
 * Não é firula: se o expurgo seguinte pudesse apagar o registro do anterior, o
 * RASTRO perderia a memória de ter esquecido — e uma lacuna sem explicação na
 * cadeia é indistinguível de adulteração. A segunda garantia, independente
 * desta, está no banco (`tipo <> TIPO_EXPURGO` na policy `tenant_expurgo_retencao`
 * e no DELETE de `app_rastro_expurgar`).
 */
export const RETENCAO_PERENE = new Date('9999-12-31T23:59:59.000Z');

/** Tipos de evento que nunca vencem. A lista é curta de propósito. */
export const TIPOS_PERENES: ReadonlySet<string> = new Set([TIPO_EXPURGO]);

/**
 * O instante em que a fórmula da cadeia foi corrigida (ver `verificar()`).
 *
 * Linha ESCRITA ANTES dela pode fechar pela fórmula antiga — reescrever hash de
 * linha antiga é adulterar o rastro, que é o que não se faz. Linha escrita
 * DEPOIS que só fecha pela antiga é FALHA, e não "compatibilidade": daqui para
 * frente nada neste código-base escreve com a fórmula velha, então um casamento
 * por ela significa que alguém inseriu linha por fora — e o miolo daquela linha
 * (tudo o que está aninhado no payload: aprovador, canal, entrega, custo) ficaria
 * permanentemente FORA do que a cadeia cobre.
 *
 * A data é o começo do dia 11/09/2026, que é quando a correção entrou. Banco
 * descartável com linha escrita horas antes por este mesmo código passa a
 * acusar — e isso é o certo: a linha realmente não está coberta.
 */
export const VIRADA_DA_CADEIA = new Date('2026-09-11T00:00:00.000Z');

/**
 * Campos de CONTEÚDO — o que vira resumo criptográfico quando a capacidade é
 * confidencial ou restrita.
 *
 * O que fica DE FORA é tão importante quanto: `fontes`, `custo`, `canal`,
 * `aprovador`, `aprovadoEm`, `motivo`, `desfazer` e `versaoPrompt` são
 * METADADO. Cifrar metadado não protege ninguém e cega a auditoria — quem
 * audita precisa saber QUE alguém aprovou, POR QUAL canal e a QUE custo, mesmo
 * sem poder ler o texto que saiu.
 */
const CAMPOS_DE_CONTEUDO: readonly string[] = [
  'pergunta',
  'argumentos',
  'artefato',
  'resultado',
  'entrega',
  'estadoAnterior',
  'estadoNovo',
  'preparo',
];

/**
 * `resumo` é o substituto SEGURO do conteúdo, então sobrevive a `confidencial`
 * — é justamente ele que o R3 exige ("o resumo do conteúdo aprovado"). Em
 * `restrita` nem ele passa: nesse degrau a política não admite nem a versão
 * mascarada (`sensibilidade: restrita` já sobe a ação para R4 na escada).
 */
const CAMPO_MASCARA = 'resumo';

/**
 * Qual campo de conteúdo vira o `hashConteudo` da linha quando o chamador não
 * trouxe um. ORDEM FIXA, e não "o primeiro que aparecer": a ordem das chaves de
 * um objeto é de quem escreveu a chamada, e um hash que muda conforme o autor
 * digitou os campos não serve para comparar nada depois.
 *
 * `argumentos` na frente porque, num R3, o conteúdo que uma pessoa aprovou é o
 * que foi ENVIADO — não o que voltou.
 */
const PRIORIDADE_DO_HASH: readonly string[] = [
  'argumentos',
  'artefato',
  'preparo',
  'pergunta',
  'resultado',
  'entrega',
  'estadoNovo',
  'estadoAnterior',
];

/** A forma mínima que este serviço lê do documento de política. */
interface PoliticaLida {
  niveis?: Record<string, { rastro?: string[] } | undefined>;
  retencao?: Record<string, unknown>;
}

/*
 * O RASTRO. Três propriedades, e nada mais:
 *
 *  1. É PRÉ-CONDIÇÃO. A porta grava, faz COMMIT, e só então executa o efeito.
 *     Se o banco recusar o registro, a ação não acontece. Por isso a gravação
 *     vive numa transação curta PRÓPRIA: se o efeito entrasse na mesma
 *     transação, um rollback apagaria o evento e recriaria exatamente o buraco
 *     que a regra fecha.
 *
 *  2. É ENCADEADO. Cada linha carrega o hash da anterior. Um elo quebrado
 *     prova adulteração, e é isso que transforma "tudo fica registrado" de
 *     promessa em verificação.
 *
 *  3. REGISTRA O QUE O NÍVEL EXIGE (fatia 3.5, RF-R-03). A lista de campos de
 *     cada degrau não é opinião deste arquivo: sai de `niveis.<R>.rastro` da
 *     POLÍTICA. R0 pede ator, agente, ferramenta, fontes e custo; R3 pede tudo
 *     isso mais argumentos, hash do conteúdo, aprovador, quando aprovou, canal
 *     e o retorno da entrega. Cada linha gravada carrega, em `payload.rastro`,
 *     o que o nível dela exigia e o que de fato chegou — então a lacuna fica
 *     VISÍVEL no próprio registro, em vez de depender de alguém comparar o
 *     código com o documento.
 *
 *     A conferência AVISA, não recusa. Recusar seria trocar "ação registrada
 *     pela metade" por "ação sem registro nenhum", e é a segunda que
 *     02-CONSTRAINTS proíbe. Quem lê `payload.rastro.faltando` sabe o tamanho
 *     da dívida sem precisar acreditar em ninguém.
 *
 * O encadeamento precisa de uma cauda serializada por empresa. A implementação
 * ingênua (lê o último hash, insere) BIFURCA em silêncio com dois escritores
 * simultâneos — e a cadeia existe justamente para provar que nada sumiu. Daí o
 * advisory lock por org, que solta no commit e não trava outras empresas.
 *
 * O QUE ESTE SERVIÇO NÃO FAZ: apagar. Nem por retenção. O único caminho por
 * onde linha do RASTRO sai do banco é a função `app_rastro_expurgar`, que exige
 * ser DONO da tabela — ver `apps/api/src/audit/expurgo.service.ts`, a migration
 * `20260911060000_rastro_retencao_e_expurgo` e a que a substitui,
 * `20260911120000_expurgo_registra_de_dentro`.
 *
 * E É A MESMA FUNÇÃO QUE ESCREVE O EVENTO `rastro.expurgo`, em SQL, dentro da
 * transação que apaga — não este serviço. Se o evento nascesse aqui, ele estaria
 * fora da transação, e um soluço entre apagar e registrar deixaria a lacuna de
 * `seq` sem explicação (que é indistinguível de adulteração para `verificar()`).
 * O corpo da cadeia é calculado lá com `app_json_canonico`, o par em SQL de
 * `canonizar()` no fim deste arquivo; quem prova que os dois concordam é o caso
 * "a cadeia continua íntegra depois do expurgo" de `rastro-retencao.test.ts`.
 * Mudar `corpoDaCadeia` ou `canonizar` SEM mudar a função do banco quebra a
 * cadeia daquele evento.
 */
@Injectable()
export class EventLogService {
  private readonly log = new Logger('EventLog');
  /** O chão, quando a política não disser nada. */
  private readonly retencaoDoAmbiente = Number(process.env.RASTRO_RETENCAO_DIAS ?? 1825);

  /**
   * Retenção por empresa, em memória curta.
   *
   * Sem cache seria uma consulta a mais em TODO evento — e evento é o caminho
   * mais quente do sistema, porque ele é pré-condição de execução. Com TTL e
   * não "para sempre" porque a API roda em mais de um processo: quem muda a
   * configuração num container não alcança a memória do outro, e 60 s de
   * defasagem num prazo medido em anos não machuca ninguém.
   */
  private readonly retencaoPorOrg = new Map<string, { dias: number; ate: number }>();
  private readonly TTL_RETENCAO_MS = 60_000;

  /** Assinaturas de lacuna já avisadas — inventário, não enxurrada de log. */
  private readonly lacunasAvisadas = new Set<string>();
  private readonly TETO_DE_AVISOS = 200;

  constructor(
    private readonly prisma: PrismaService,
    /*
     * OPCIONAL de propósito. Em produção a política que vale é a do BANCO
     * (`PolicyService.baseHerdada()`), e é dela que saem a lista de campos de
     * cada nível e o prazo de retenção padrão. Sem o serviço injetado — cinco
     * suítes constroem este serviço à mão, com o Prisma e mais nada — cai na
     * política EMPACOTADA, que é o mesmo documento no repositório.
     */
    @Optional() private readonly policy?: PolicyService,
  ) {}

  // ==========================================================================
  // GRAVAR
  // ==========================================================================

  async registrar(input: EventoInput): Promise<{ id: string; seq: bigint; hash: string }> {
    /*
     * A retenção é lida ANTES da transação do evento, de propósito. Dentro
     * dela, uma consulta que falhasse abortaria a transação inteira no
     * PostgreSQL — e o `catch` em volta pareceria funcionar até o `create`
     * seguinte estourar com "current transaction is aborted". Fora, a falha é
     * isolada e o evento ainda é gravado com o prazo herdado.
     */
    const retencaoAte = await this.retencaoAte(input);

    return this.prisma.$transaction(async (tx) => this.registrarNaTransacao(tx, input, retencaoAte));
  }

  /**
   * Variante para o escritor que já possui uma transação de domínio.
   * Memória/conector não podem confirmar projeção e recibo deixando o rastro
   * para depois: se esta chamada falhar, a transação do chamador também falha.
   * A montagem/redação permanece encapsulada aqui para que escritores de
   * domínio não possam inserir payloads ou hashes fora da política do evento.
   */
  async registrarNaTransacao(
    tx: Prisma.TransactionClient,
    input: EventoInput,
    retencaoAte?: Date,
  ): Promise<{ id: string; seq: bigint; hash: string }> {
    const { payload, contentHash } = this.montar(input);
    const prazo = retencaoAte ?? await this.retencaoAte(input);

    // Serializa só os escritores DESTA empresa. hashtext devolve int4; o
    // advisory lock de transação solta sozinho no commit.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.orgId}))`;

      const ultimo = await tx.eventLog.findFirst({
        where: { orgId: input.orgId },
        orderBy: { seq: 'desc' },
        select: { seq: true, hash: true },
      });

      const seq = (ultimo?.seq ?? 0n) + 1n;
      const prevHash = ultimo?.hash ?? null;
      const ocorreuEm = new Date();
      const hash = this.encadear({
        orgId: input.orgId,
        seq,
        tipo: input.tipo,
        prevHash,
        ocorreuEm,
        capabilityId: input.capabilityId,
        contentHash,
        payload,
      });

      const linha = await tx.eventLog.create({
        data: {
          orgId: input.orgId,
          seq,
          tipo: input.tipo,
          actorType: input.actorType ?? ActorType.ai,
          actorId: input.actorId ?? null,
          agentSlug: input.agentSlug ?? null,
          capabilityId: input.capabilityId ?? null,
          toolCallId: input.toolCallId ?? null,
          decisionId: input.decisionId ?? null,
          nivel: input.nivel ?? null,
          correlationId: input.correlationId ?? null,
          payload,
          contentHash,
          prevHash,
          hash,
          ocorreuEm,
          retencaoAte: prazo,
        },
        select: { id: true, seq: true, hash: true },
      });
    return linha;
  }

  // ==========================================================================
  // O QUE CADA NÍVEL EXIGE — RF-R-03
  // ==========================================================================

  /**
   * A lista de campos que a política manda registrar neste nível.
   *
   * FONTE ÚNICA: `niveis.<R>.rastro`. Um nível que a política não descreva
   * devolve lista vazia e a conferência se cala — inventar exigência aqui seria
   * pior do que não conferir, porque passaria a cobrar o que o documento
   * normativo nunca pediu.
   */
  camposExigidos(nivel: RiskLevel | null | undefined): string[] {
    if (!nivel) return [];
    const bloco = this.politica().niveis?.[nivel];
    return bloco?.rastro ? [...bloco.rastro] : [];
  }

  /** O documento que vale: o do banco quando há, o empacotado senão. */
  private politica(): PoliticaLida {
    try {
      return (this.policy?.baseHerdada() as PoliticaLida | undefined) ?? (politicaEmpacotada as PoliticaLida);
    } catch {
      return politicaEmpacotada as PoliticaLida;
    }
  }

  /**
   * Monta o payload final, o `contentHash` da linha e a conferência de nível.
   *
   * A ordem importa: REDIGIR PRIMEIRO, conferir depois, encadear por último. Se
   * a conferência rodasse sobre o cru e a redação viesse depois, o hash da
   * cadeia protegeria um payload que não é o que ficou gravado.
   */
  private montar(input: EventoInput): {
    payload: Prisma.InputJsonValue;
    contentHash: string | null;
  } {
    const conteudo = input.conteudo ?? {};
    const oculta = input.sensibilidade === 'confidencial' || input.sensibilidade === 'restrita';
    const referencia =
      conteudo.referencia ?? (input.toolCallId ? `toolCall:${input.toolCallId}` : undefined);

    const campos: Record<string, unknown> = {};
    const presentes = new Set<string>();

    for (const [chave, valor] of Object.entries(conteudo)) {
      if (valor === undefined || valor === null || chave === 'referencia') continue;

      const ocultarEste =
        (oculta && CAMPOS_DE_CONTEUDO.includes(chave)) ||
        (chave === CAMPO_MASCARA && input.sensibilidade === 'restrita');

      campos[chave] = ocultarEste
        ? this.resumoCriptografico(valor, referencia)
        : this.redigirSigilosos(valor, referencia);
      presentes.add(chave);
    }

    /*
     * O `hashConteudo` da linha. O do CHAMADOR manda sempre: ele é o vínculo da
     * APROVAÇÃO com o conteúdo exato, e trocá-lo desfaria a amarra. Sem ele, e
     * havendo conteúdo oculto, o resumo do campo de maior prioridade ocupa o
     * lugar — é o que faz a exigência do R3 existir sem ninguém precisar
     * lembrar.
     */
    let hashDoConteudo: string | null = input.contentHash ?? null;
    if (!hashDoConteudo && oculta) {
      const escolhido = PRIORIDADE_DO_HASH.find((c) => presentes.has(c));
      if (escolhido) {
        hashDoConteudo = (campos[escolhido] as { resumoCriptografico?: string })
          .resumoCriptografico ?? null;
      }
    }

    // `pergunta` satisfaz `argumentos`: no R0 a pergunta É o argumento da
    // consulta, e a política não tem palavra separada para ela.
    if (presentes.has('pergunta')) presentes.add('argumentos');

    if (input.actorType && (input.actorId || input.agentSlug || input.actorType === ActorType.system)) {
      presentes.add('ator');
    }
    if (input.agentSlug) presentes.add('agente');
    if (input.capabilityId) presentes.add('ferramenta');
    if (hashDoConteudo) presentes.add('hashConteudo');

    const exigidos = this.camposExigidos(input.nivel);
    const faltando = exigidos.filter((c) => !presentes.has(c));
    this.avisarLacuna(input, faltando);

    const rastro = input.nivel
      ? {
          nivel: input.nivel,
          conferido: true,
          exigidos,
          faltando,
          completo: faltando.length === 0,
          ...(input.sensibilidade ? { sensibilidade: input.sensibilidade } : {}),
        }
      : { nivel: null, conferido: false };

    const doChamador = this.redigirSigilosos(
      (input.payload ?? {}) as Record<string, unknown>,
      referencia,
    ) as Record<string, unknown>;
    this.avisarColisao(input, doChamador, campos);

    const payload = {
      ...doChamador,
      ...campos,
      ...(referencia ? { referencia } : {}),
      // `rastro` é chave RESERVADA do payload: é a conferência da própria linha.
      rastro,
    };
    return { payload: payload as unknown as Prisma.InputJsonValue, contentHash: hashDoConteudo };
  }

  /**
   * A COLISÃO ENTRE `payload` E `conteudo` — a armadilha do espalhamento.
   *
   * `conteudo` vira chave de primeiro nível do payload, então uma chave que
   * exista dos dois lados (`motivo` é a comum) tem um vencedor, e o vencedor é o
   * CONTEÚDO. Isso não pode mudar: é o conteúdo que passou pela redação de
   * sensibilidade (`resumoCriptografico`), e deixar o valor cru do payload
   * sobreviver no lugar dele trocaria um campo duplicado por um vazamento.
   *
   * O QUE ERA SILENCIOSO, E DEIXOU DE SER. Quem escrevia os dois lados só podia
   * se defender repetindo o valor letra por letra — e um dia alguém melhora a
   * frase de um lado só, o valor do outro some sem barulho, e quem lê o RASTRO
   * procura uma palavra que a linha já não tem. Um caso de teste por chamada
   * guardava isso; agora quem guarda é a montagem, para a classe inteira.
   *
   * AVISA, NÃO RECUSA — mesma regra do resto deste arquivo: registro imperfeito
   * é melhor do que ação sem registro (02-CONSTRAINTS). E avisa por INVENTÁRIO,
   * como `avisarLacuna`: uma assinatura por tipo de evento e chave.
   */
  private avisarColisao(
    input: EventoInput,
    doChamador: Record<string, unknown>,
    campos: Record<string, unknown>,
  ): void {
    for (const chave of Object.keys(campos)) {
      if (!(chave in doChamador)) continue;
      // Dizer a mesma coisa duas vezes é inofensivo — é justamente o que a
      // duplicação letra por letra fazia. Só a DIVERGÊNCIA interessa.
      if (canonizar(doChamador[chave]) === canonizar(campos[chave])) continue;

      const assinatura = `colisao|${input.tipo}|${chave}`;
      // Já avisado: segue para as outras chaves desta linha. Teto estourado:
      // para de vez, como `avisarLacuna`.
      if (this.lacunasAvisadas.has(assinatura)) continue;
      if (this.lacunasAvisadas.size >= this.TETO_DE_AVISOS) return;
      this.lacunasAvisadas.add(assinatura);
      this.log.warn(
        `[rastro] evento "${input.tipo}": "${chave}" veio em payload E em conteudo com valores ` +
          'DIFERENTES — o de `conteudo` venceu e o do `payload` foi descartado. O conteúdo vence ' +
          'sempre (é ele que passa pela redação de sensibilidade); se o valor do payload importa, ' +
          'ele precisa de outro nome.',
      );
    }
  }

  /**
   * O aviso é INVENTÁRIO, não alarme: uma assinatura por combinação de tipo,
   * nível e lacuna, com teto. Mesma disciplina de `sessao-de-banco.ts` — o log
   * serve para alguém descobrir o que falta preencher, não para rolar a tela.
   */
  private avisarLacuna(input: EventoInput, faltando: string[]): void {
    if (faltando.length === 0) return;
    const chave = `${input.tipo}|${input.nivel}|${faltando.join(',')}`;
    if (this.lacunasAvisadas.has(chave) || this.lacunasAvisadas.size >= this.TETO_DE_AVISOS) return;
    this.lacunasAvisadas.add(chave);
    this.log.warn(
      `[rastro] evento "${input.tipo}" (${input.nivel}) gravado SEM ${faltando.join(', ')} — ` +
        `a política exige ${this.camposExigidos(input.nivel).join(', ')} neste nível (RF-R-03). ` +
        'A linha foi gravada assim mesmo e DECLARA a lacuna em payload.rastro.faltando: ' +
        'registro incompleto é melhor do que ação sem registro.',
    );
  }

  /** Só para o teste: zera o inventário de avisos entre casos. */
  esquecerAvisos(): void {
    this.lacunasAvisadas.clear();
  }

  // ==========================================================================
  // CONTEÚDO SENSÍVEL — RF-R-04
  // ==========================================================================

  /**
   * O conteúdo vira RESUMO CRIPTOGRÁFICO mais REFERÊNCIA. Nunca o texto.
   *
   * O que isto prova e o que não prova, dito em voz alta: o resumo permite a
   * quem JÁ TEM o conteúdo confirmar que era aquele, e é essa a pergunta da
   * auditoria ("foi isto que saiu?"). Ele NÃO protege conteúdo de baixa entropia
   * contra quem queira adivinhar — o sha256 de "sim" é o sha256 de "sim" em
   * qualquer lugar do mundo. Por isso a referência: o cru continua onde ele já
   * mora e é governado (a chamada de ferramenta, a aprovação), com o controle de
   * acesso daquele lugar, em vez de virar uma segunda cópia dentro do rastro.
   */
  private resumoCriptografico(valor: unknown, referencia?: string): Record<string, unknown> {
    const alvo = ehSigiloso(valor) ? valor.valor : valor;
    const texto = typeof alvo === 'string' ? alvo : JSON.stringify(alvo ?? null);
    return {
      sigiloso: true,
      algoritmo: 'sha256',
      resumoCriptografico: createHash('sha256').update(texto).digest('hex'),
      bytes: Buffer.byteLength(texto),
      ...(ehSigiloso(valor) && valor.rotulo ? { rotulo: valor.rotulo } : {}),
      ...(alvo && typeof alvo === 'object' && !Array.isArray(alvo) && !(alvo instanceof Date)
        ? { chaves: Object.keys(alvo as object) }
        : {}),
      ...(referencia ? { referencia } : {}),
    };
  }

  /**
   * Varre o valor e troca TODO `sigiloso(...)` pelo resumo — em qualquer
   * profundidade.
   *
   * Profundidade importa: o caso real é um campo sigiloso DENTRO do objeto de
   * argumentos, não o objeto inteiro. Sem a varredura recursiva, marcar o campo
   * não faria nada e o texto entraria cru no payload.
   */
  private redigirSigilosos(valor: unknown, referencia?: string, profundidade = 0): unknown {
    if (profundidade > 12) return '[aninhamento profundo demais para o rastro]';
    if (ehSigiloso(valor)) return this.resumoCriptografico(valor, referencia);
    if (valor instanceof Date) return valor.toISOString();
    if (Array.isArray(valor)) {
      return valor.map((v) => this.redigirSigilosos(v, referencia, profundidade + 1));
    }
    if (valor && typeof valor === 'object') {
      const saida: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
        saida[k] = this.redigirSigilosos(v, referencia, profundidade + 1);
      }
      return saida;
    }
    return valor;
  }

  // ==========================================================================
  // RETENÇÃO POR EMPRESA — RF-R-06
  // ==========================================================================

  /** O prazo padrão: o da política, e o do ambiente só se a política calar. */
  retencaoPadrao(): number {
    const daPolitica = this.politica().retencao?.rastroDias;
    const n = typeof daPolitica === 'number' ? daPolitica : this.retencaoDoAmbiente;
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1825;
  }

  /** Tira a empresa do cache: a próxima gravação relê o prazo do banco. */
  esquecerRetencao(orgId?: string): void {
    if (orgId) this.retencaoPorOrg.delete(orgId);
    else this.retencaoPorOrg.clear();
  }

  /** Os dias de guarda desta empresa. Ausência de linha = herda o padrão. */
  async diasDeRetencao(orgId: string): Promise<number> {
    const agora = Date.now();
    const guardado = this.retencaoPorOrg.get(orgId);
    if (guardado && guardado.ate > agora) return guardado.dias;

    let dias = this.retencaoPadrao();
    try {
      const linha = await this.prisma.rastroRetencao.findUnique({
        where: { orgId },
        select: { dias: true },
      });
      if (linha?.dias) dias = linha.dias;
    } catch (e) {
      // Falhar a LEITURA do prazo não pode impedir a gravação do evento: o
      // evento é pré-condição de execução, e ficar sem ele é pior do que ficar
      // com o prazo herdado.
      this.log.warn(
        `[rastro] não consegui ler a retenção de ${orgId} (${(e as Error).message}); ` +
          `valendo o padrão de ${dias} dias.`,
      );
    }
    this.retencaoPorOrg.set(orgId, { dias, ate: agora + this.TTL_RETENCAO_MS });
    return dias;
  }

  private async retencaoAte(input: EventoInput): Promise<Date> {
    if (TIPOS_PERENES.has(input.tipo)) return RETENCAO_PERENE;
    const dias = await this.diasDeRetencao(input.orgId);
    return new Date(Date.now() + dias * 86_400_000);
  }

  // ==========================================================================
  // A CADEIA
  // ==========================================================================

  private encadear(e: EntradaDaCadeia): string {
    return createHash('sha256').update(this.corpoDaCadeia(e, canonizar)).digest('hex');
  }

  /**
   * A FÓRMULA ANTIGA, mantida só para VERIFICAR linha escrita antes de
   * 11/09/2026. Nada novo é escrito com ela. Ver `verificar()`.
   */
  private encadearV1(e: EntradaDaCadeia): string {
    const v1 = (p: unknown) => JSON.stringify(p ?? null, Object.keys((p as object) ?? {}).sort());
    return createHash('sha256').update(this.corpoDaCadeia(e, v1)).digest('hex');
  }

  private corpoDaCadeia(e: EntradaDaCadeia, serializar: (p: unknown) => string): string {
    return [
      e.prevHash ?? '',
      e.orgId,
      e.seq.toString(),
      e.tipo,
      e.capabilityId ?? '',
      e.contentHash ?? '',
      e.ocorreuEm.toISOString(),
      serializar(e.payload ?? null),
    ].join('|');
  }

  /**
   * Percorre a cadeia e devolve o primeiro elo quebrado. É isto que transforma
   * "cadeia íntegra" de enfeite de tela em afirmação verificável.
   *
   * DUAS FÓRMULAS, E POR QUÊ (11/09/2026). A fórmula original passava
   * `Object.keys(payload).sort()` como REPLACER de `JSON.stringify` — e replacer
   * em array não ordena nada: ele é uma LISTA BRANCA de chaves, aplicada em
   * TODOS os níveis. Medido: `{a:'z', b:{x:1,y:2}}` virava `{"a":"z","b":{}}`.
   * O hash cobria só os valores de primeiro nível; tudo dentro de um objeto
   * ficava FORA da cadeia. Como esta fatia põe exatamente os campos que importam
   * (aprovador, canal, entrega, custo, resumo) DENTRO do payload, a cadeia
   * estaria protegendo o que não interessa.
   *
   * A fórmula nova canoniza de verdade (ordenação recursiva de chaves). Linha
   * escrita antes da correção não fecha com ela — e reescrever hash de linha
   * antiga é adulterar o rastro, que é o que não se faz.
   *
   * MAS A ACEITAÇÃO TEM CORTE DE DATA (`VIRADA_DA_CADEIA`), e sem ele a
   * tolerância vira buraco permanente: uma linha escrita HOJE pela fórmula fraca
   * seria aceita como válida e o miolo dela — tudo o que está aninhado no
   * payload — ficaria fora da cadeia para sempre. O risco NÃO é forjar (a
   * corrente é resumo puro, sem chave: quem consegue inserir calcula qualquer
   * uma das duas); é cobertura. Então: fórmula antiga vale só para linha
   * anterior à virada; casamento pela antiga em linha mais nova é FALHA, com o
   * `seq` e o motivo, igual a qualquer outra quebra.
   *
   * DEPOIS DE UM EXPURGO POR RETENÇÃO A CADEIA TEM BURACO, e ele é legítimo.
   *
   * E não é só a cauda: `retencaoAte` é gravado LINHA A LINHA, com o prazo que
   * valia no instante da escrita, então um expurgo tira do MEIO — uma linha
   * antiga sai e a vizinha de `seq` seguinte fica. Cobrar numeração contígua
   * transformaria retenção cumprida em "cadeia adulterada", que é exatamente o
   * alarme falso que faria ninguém mais olhar para o alarme.
   *
   * A regra, então: buraco é aceito QUANDO ALGUÉM ASSUMIU. As faixas apagadas
   * ficam registradas nos eventos `rastro.expurgo` (perenes, nunca expurgáveis),
   * e só um buraco coberto por elas passa. Buraco fora de faixa registrada
   * continua sendo quebra — e essa é a diferença entre "esqueci porque a
   * retenção mandou" e "sumiu".
   *
   * O BURACO DA CABEÇA CONTA COMO OS OUTROS, e esta é a correção que mais
   * importa aqui. A versão anterior começava com `esperado = linhas[0].seq`, o
   * primeiro `seq` que aparecesse: com isso a PRIMEIRA iteração nunca podia
   * divergir e truncar a cabeça do rastro ficava invisível, sem precisar de
   * nenhum evento que explicasse. E a cabeça é justamente o que o expurgo por
   * retenção corta, porque o vencido é sempre o mais velho. Agora o esperado
   * começa em 1 e a falta do começo é cobrada como qualquer outra faixa.
   *
   * AS FAIXAS VÊM DE CONSULTA PRÓPRIA, FORA DA JANELA. Elas eram calculadas
   * sobre as mesmas `limite` linhas que estavam sendo conferidas — e o evento
   * que explica um buraco é sempre escrito DEPOIS dele, logo com `seq` maior.
   * Numa empresa com mais eventos do que a janela, o mecanismo não funcionava
   * para buraco nenhum: um expurgo legítimo do meio virava acusação de
   * adulteração. Os eventos de expurgo são perenes e poucos; buscá-los à parte
   * custa uma consulta indexada por (`orgId`, `tipo`).
   *
   * Atravessado o buraco, o `prevHash` da primeira linha do outro lado aponta
   * para uma linha que não existe mais: a ligação é retomada dali, não cobrada.
   *
   * O QUE A CADEIA NÃO COBRE, dito em voz alta: `retencaoAte` não entra no corpo
   * do hash. É o campo que decide QUANDO a prova some, e quem for dono do banco
   * pode adiantá-lo sem quebrar elo nenhum — encurtando na prática a retenção de
   * uma linha específica. Não dá para consertar sem uma terceira fórmula (mudar
   * o corpo invalidaria toda linha já escrita), e a mudança do prazo por empresa
   * tem registro próprio (`rastro.retencao.definida`). Está no relatório da
   * fatia, em RISCOS.
   */
  async verificar(
    orgId: string,
    limite = 5000,
  ): Promise<{
    ok: boolean;
    verificados: number;
    porFormula: { v1: number; v2: number };
    lacunasExplicadas: { de: string; ate: string }[];
    /** Quantos eventos declaram lacuna, por nível. Ver `incompletosPorNivel`. */
    incompletosPorNivel: Record<string, number>;
    quebrouEm?: { seq: string; motivo: string };
  }> {
    const [linhas, expurgadas, incompletosPorNivel] = await Promise.all([
      this.prisma.eventLog.findMany({
        where: { orgId },
        orderBy: { seq: 'asc' },
        take: limite,
        select: {
          seq: true,
          tipo: true,
          prevHash: true,
          hash: true,
          ocorreuEm: true,
          capabilityId: true,
          contentHash: true,
          payload: true,
        },
      }),
      this.faixasExpurgadas(orgId),
      this.incompletosPorNivel(orgId),
    ]);

    const porFormula = { v1: 0, v2: 0 };
    const lacunasExplicadas: { de: string; ate: string }[] = [];
    const conferidos = () => porFormula.v1 + porFormula.v2;
    const reprovar = (seq: bigint, motivo: string) => ({
      ok: false as const,
      verificados: conferidos(),
      porFormula,
      lacunasExplicadas,
      incompletosPorNivel,
      quebrouEm: { seq: seq.toString(), motivo },
    });

    let anterior: string | null = null;
    // O COMEÇO DE VERDADE, e não "o primeiro que apareceu": a cabeça faltando é
    // exatamente o que o expurgo por retenção produz, e ela tem de ser cobrada.
    let esperado = 1n;

    for (const l of linhas) {
      if (l.seq !== esperado) {
        const de = esperado;
        const ate = l.seq - 1n;
        if (!this.faixaCoberta(de, ate, expurgadas)) {
          return reprovar(
            l.seq,
            de === 1n
              ? `o rastro começa em ${l.seq}: as linhas 1–${ate} sumiram e nenhum evento ` +
                  `${TIPO_EXPURGO} declara essa faixa`
              : `sequência pulou de ${de} para ${l.seq} e nenhum evento ${TIPO_EXPURGO} ` +
                  'declara essa faixa',
          );
        }
        lacunasExplicadas.push({ de: de.toString(), ate: ate.toString() });
        // Do outro lado do buraco a ligação recomeça: o `prevHash` desta linha
        // aponta para uma que a retenção levou.
        anterior = null;
        esperado = l.seq;
      }
      if (anterior !== null && l.prevHash !== anterior) {
        return reprovar(l.seq, 'prevHash não casa com o hash anterior');
      }
      const entrada: EntradaDaCadeia = {
        orgId,
        seq: l.seq,
        tipo: l.tipo,
        prevHash: l.prevHash,
        ocorreuEm: l.ocorreuEm,
        capabilityId: l.capabilityId,
        contentHash: l.contentHash,
        payload: l.payload,
      };
      if (this.encadear(entrada) === l.hash) {
        porFormula.v2 += 1;
      } else if (this.encadearV1(entrada) === l.hash) {
        if (l.ocorreuEm >= VIRADA_DA_CADEIA) {
          return reprovar(
            l.seq,
            `linha de ${l.ocorreuEm.toISOString()} fecha pela fórmula ANTIGA da cadeia, que foi ` +
              `aposentada em ${VIRADA_DA_CADEIA.toISOString()}. Nada neste código escreve assim ` +
              'desde então: ou a linha foi inserida por fora, ou o payload dela foi trocado por ' +
              'um que só difere no que está aninhado — que é justamente o que a fórmula antiga ' +
              'não cobria.',
          );
        }
        porFormula.v1 += 1;
      } else {
        return reprovar(l.seq, 'conteúdo não bate com o hash gravado');
      }
      anterior = l.hash;
      esperado += 1n;
    }

    return {
      ok: true,
      verificados: linhas.length,
      porFormula,
      lacunasExplicadas,
      incompletosPorNivel,
    };
  }

  /**
   * Quantos eventos declararam lacuna, por nível — o prêmio de consolação de
   * "avisar em vez de recusar", em forma legível.
   *
   * A conferência de nível AVISA e grava `payload.rastro.faltando` em vez de
   * recusar a ação, porque ação sem registro é pior do que registro incompleto
   * (02-CONSTRAINTS). Só que um campo que ninguém lê não é aviso nenhum: não há
   * rota que liste os eventos, e a tela de auditoria ainda lê o log antigo.
   * Então a dívida sai por aqui, na rota de integridade — quem abre
   * `GET /audit/verificar` vê o tamanho dela sem precisar consultar o banco à
   * mão.
   *
   * Conta o RASTRO INTEIRO da empresa, não a janela de `verificar()`: a pergunta
   * é "quanto do registro está incompleto", e responder isso sobre as primeiras
   * 5000 linhas seria responder outra coisa.
   *
   * ZERO NÃO É A META — ver "A FRONTEIRA" no cabeçalho deste arquivo. Toda
   * passagem R3 pela porta deixa pelo menos uma linha aqui (a proposta, que não
   * tem como saber quem vai aprovar), e todo R4 deixa mais uma (o antes-e-depois
   * do sistema de destino, que só o efeito enxerga). O que se lê neste número é
   * TENDÊNCIA e COMPOSIÇÃO: um tipo de evento novo aparecendo aqui é o sinal.
   *
   * Falha de leitura não derruba a verificação da cadeia — devolve vazio e
   * avisa. A integridade é a resposta principal; esta é o rodapé.
   */
  private async incompletosPorNivel(orgId: string): Promise<Record<string, number>> {
    try {
      const linhas = await this.prisma.$queryRaw<{ nivel: string | null; quantos: bigint }[]>`
        SELECT "nivel"::text AS nivel, count(*) AS quantos
          FROM "EventLog"
         WHERE "orgId" = ${orgId}
           AND "payload" -> 'rastro' ->> 'completo' = 'false'
         GROUP BY "nivel"`;
      const saida: Record<string, number> = {};
      for (const l of linhas) saida[l.nivel ?? 'sem-nivel'] = Number(l.quantos);
      return saida;
    } catch (e) {
      this.log.warn(
        `[rastro] não consegui contar os eventos incompletos de ${orgId} (${(e as Error).message}).`,
      );
      return {};
    }
  }

  /**
   * As faixas de `seq` que algum expurgo assumiu ter apagado.
   *
   * CONSULTA PRÓPRIA, e não um filtro sobre a janela que está sendo conferida —
   * ver a nota em `verificar()`. Sai do PRÓPRIO rastro: cada `rastro.expurgo`
   * grava `resultado.seqDe` e `resultado.seqAte`. É por isso que aquele evento é
   * perene: sem ele, o buraco que a retenção abriu vira quebra de cadeia no ano
   * seguinte.
   */
  private async faixasExpurgadas(orgId: string): Promise<{ de: bigint; ate: bigint }[]> {
    const linhas = await this.prisma.eventLog.findMany({
      where: { orgId, tipo: TIPO_EXPURGO },
      orderBy: { seq: 'asc' },
      select: { payload: true },
    });

    const faixas: { de: bigint; ate: bigint }[] = [];
    for (const l of linhas) {
      const r = (l.payload as { resultado?: { seqDe?: unknown; seqAte?: unknown } } | null)?.resultado;
      if (!r?.seqDe || !r?.seqAte) continue;
      try {
        faixas.push({ de: BigInt(String(r.seqDe)), ate: BigInt(String(r.seqAte)) });
      } catch {
        // Faixa ilegível não vira permissão: o buraco segue sem explicação.
      }
    }
    return faixas;
  }

  /** A lacuna INTEIRA cabe em alguma faixa declarada? Parcial não vale. */
  private faixaCoberta(de: bigint, ate: bigint, faixas: { de: bigint; ate: bigint }[]): boolean {
    return faixas.some((f) => f.de <= de && f.ate >= ate);
  }
}

interface EntradaDaCadeia {
  orgId: string;
  seq: bigint;
  tipo: string;
  prevHash: string | null;
  ocorreuEm: Date;
  capabilityId?: string | null;
  contentHash?: string | null;
  payload?: unknown;
}

/**
 * JSON ESTÁVEL DE VERDADE: chave fora de ordem não muda o resultado, e o que
 * está aninhado ENTRA. `JSON.stringify(v, chavesOrdenadas)` não faz isso — ver a
 * nota em `verificar()`.
 */
export function canonizar(valor: unknown): string {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor ?? null);
  if (Array.isArray(valor)) return `[${valor.map(canonizar).join(',')}]`;
  const chaves = Object.keys(valor as object).sort();
  return `{${chaves
    .map((k) => `${JSON.stringify(k)}:${canonizar((valor as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}
