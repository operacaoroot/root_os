/**
 * Modelos GLOBAIS por desenho — RF-T-01
 * =====================================
 *
 * A regra do sistema é uma só: **todo modelo carrega `orgId`**. Filho de
 * entidade de tenant carrega o orgId redundante do pai (LeadEvent tem o da Lead,
 * WorkComment o da WorkTask), justamente para que uma consulta que esqueça o
 * join não saia sem empresa e para que o isolamento por linha tenha em que
 * coluna se apoiar.
 *
 * As exceções abaixo são as ÚNICAS. Não são esquecimento: cada uma tem um
 * motivo e uma consequência escrita para o dia em que alguém tentar "arrumar".
 *
 * POR QUE ESTA LISTA EXISTE EM ARQUIVO
 * Sem ela, "modelo sem orgId" e "modelo global" são a mesma coisa aos olhos de
 * quem lê o schema — e um modelo novo que nasce sem orgId passa despercebido,
 * porque parece só mais uma exceção. Com a lista, ser global é uma DECLARAÇÃO:
 * `apps/api/test/modelos-globais.test.ts` lê o `schema.prisma`, cruza com o que
 * está aqui e REPROVA quando aparece modelo sem orgId que ninguém declarou — ou
 * modelo com orgId ANULÁVEL que não está em `MODELOS_ESCOPO_OPCIONAL`.
 *
 * ONDE A CATRACA RODA — E POR QUE NÃO É NO ARQUIVO DE ISOLAMENTO
 * Os casos que só leem o `schema.prisma` moram em `test/modelos-globais.test.ts`,
 * que entra no `pnpm test` padrão e reprova de verdade. O que precisa de banco
 * fica em `test/tenant-isolation.test.ts`, que roda com `continue-on-error` na
 * integração contínua enquanto o isolamento por linha não estiver ligado — lá,
 * catraca acusando não reprovaria nada.
 *
 * COMO ACRESCENTAR UM MODELO AQUI
 * Só depois de responder por escrito, no campo `quebraSe`, o que exatamente
 * deixa de funcionar se o modelo for escopado por empresa. Se a resposta for
 * "nada", o modelo não é global: falta orgId nele.
 */

/** Uma exceção declarada à regra "todo modelo tem orgId". */
export interface ModeloGlobal {
  /** Nome do modelo no `schema.prisma` (e da tabela no Postgres). */
  modelo: string;
  /** Por que ele não tem — e não deve ter — coluna de empresa. */
  porQue: string;
  /** O que quebra se alguém escopar este modelo por empresa. */
  quebraSe: string;
}

/**
 * As quatro tabelas sem `orgId` no banco. Qualquer outra sem `orgId` é bug.
 *
 * Versionada de propósito: mudar esta lista é mudar a fronteira do isolamento
 * entre empresas, e isso precisa aparecer em diff e passar por revisão.
 */
export const MODELOS_GLOBAIS: readonly ModeloGlobal[] = [
  {
    modelo: 'Org',
    porQue: 'É o próprio tenant. O escopo dele é a chave primária.',
    quebraSe:
      'não existe "orgId da Org": a coluna seria uma cópia do id. O isolamento aqui é por PK — ' +
      'uma empresa nunca deve LISTAR as outras, e é isso que a política de linha da tabela precisa impor.',
  },
  {
    modelo: 'Permission',
    porQue:
      'Catálogo global de chaves de permissão. Quem amarra permissão a empresa é o Role, ' +
      'que tem orgId; duplicar o catálogo por cliente é garantir que um dia divergem.',
    quebraSe:
      'o PermissionsGuard para de resolver permissão e toda empresa perde acesso. ' +
      'Na junção _RolePermissions a política vai na coluna B (Role), nunca na A (Permission).',
  },
  {
    modelo: 'BioVisitor',
    porQue:
      'Identidade de cookie: o MESMO navegador visita páginas de empresas diferentes. ' +
      'Escopar por empresa criaria um visitante por empresa e mataria a deduplicação — ' +
      'mesmo racional do anonymousId do PixelEvent.',
    quebraSe:
      'o visitante fica órfão no join de BioVisit/BioEvent e a sessionização da bio se parte em duas. ' +
      'Os FILHOS não dependem daqui para achar a empresa: BioVisit e BioEvent carregam orgId próprio, ' +
      'derivado da BioPage — por isso um pai global não deixa filho sem tenant.',
  },
  {
    modelo: 'Capability',
    porQue:
      'Catálogo de capacidades da escada R0–R5. A diferença entre empresas mora no PolicyVersion ' +
      '(que tem orgId anulável: nulo = a base ROOT que todas herdam), não numa cópia do catálogo por tenant.',
    quebraSe:
      'a porta passa a classificar contra catálogos que divergem entre empresas, e "R3 aqui, R2 ali" ' +
      'deixa de ser decisão registrada para virar acidente de cópia.',
  },
] as const;

/** Modelos com `orgId` ANULÁVEL — escopáveis, com um significado para o nulo. */
export interface ModeloEscopoOpcional {
  modelo: string;
  /** O que o nulo significa naquela tabela. */
  nuloSignifica: string;
}

/**
 * Não são globais: têm a coluna e a usam. O nulo é um valor com sentido, e a
 * política de linha precisa tratá-lo — `orgId = atual OR orgId IS NULL` na
 * leitura, e só `orgId = atual` na escrita, senão uma empresa sobrescreve o que
 * serve a todas.
 *
 * A lista é FECHADA: `test/modelos-globais.test.ts` reprova qualquer modelo cujo
 * `orgId` seja anulável no schema e que não esteja aqui. Sem isso, um modelo
 * novo com `orgId String?` passaria na catraca — o nome do campo está lá, e era
 * só o nome que se conferia — e nasceria escapando de toda política de linha.
 */
export const MODELOS_ESCOPO_OPCIONAL: readonly ModeloEscopoOpcional[] = [
  {
    modelo: 'BioCredencialApp',
    nuloSignifica: 'credencial do app de plataforma compartilhada por todas as empresas.',
  },
  {
    modelo: 'PolicyVersion',
    nuloSignifica: 'a política base ROOT, que toda empresa herda enquanto não tiver delta próprio.',
  },
] as const;

/**
 * Os dez filhos de entidade de tenant que passaram a carregar `orgId`
 * redundante, e de qual pai o valor é derivado.
 *
 * Serve a duas coisas: é a lista que o teste de isolamento percorre um a um, e é
 * o mapa de quem deriva de quem — a mesma relação que os gatilhos
 * `<Tabela>_orgId_do_pai` implementam no banco (migration
 * `20260910120000_orgid_em_todo_filho`).
 *
 * ATÉ ONDE A GARANTIA VAI — leia antes de confiar nela
 *
 * 1. O gatilho vale na ESCRITA DO FILHO. Mudar o `orgId` do PAI depois deixa o
 *    filho parado na empresa antiga, e o par volta a estar cruzado:
 *
 *        UPDATE "Lead" SET "orgId" = 'org_B' WHERE id = 'lead_da_A';
 *        -- o LeadEvent daquele lead continua com 'org_A'
 *
 *    É limitação CONHECIDA E ACEITA. Não existe gatilho de propagação porque
 *    (a) nenhum caminho de código muda o orgId de um pai hoje; (b) propagar
 *    exigiria gatilho em nove tabelas-pai e, em WorkFieldValue, mover só um dos
 *    três pais passaria a derrubar o UPDATE do pai; (c) provisionamento e fusão
 *    de tenant vão ter de decidir a ordem em que pai e filhos se movem, e um
 *    gatilho escondido faria essa migração PARECER segura enquanto reordena o
 *    trabalho por baixo.
 *    A postura é PREVENIR na escrita do filho e DETECTAR na auditoria: o teste
 *    "o orgId de X bate com o do pai em TODAS as linhas" percorre todos os pais
 *    conferidos e é o detector desse desvio. Quem for implementar movimentação
 *    de tenant trata disso explicitamente, e não confia neste gatilho.
 *
 * 2. Índice composto antigo destas tabelas não começa por `orgId` (o documento
 *    de modelo de dados manda que comece). Decisão registrada no cabeçalho da
 *    migration: os não-únicos começam pela FK do pai e já saem escopados por
 *    ele — são caminhos secundários; os únicos NÃO podem ser reordenados, porque
 *    prefixar `orgId` num índice único afrouxa a unicidade. Caminho amplo novo
 *    pede índice novo com orgId à frente, nunca reordenar um único.
 */
export interface FilhoComOrgIdRedundante {
  modelo: string;
  /** Modelo pai de onde o orgId é derivado. */
  pai: string;
  /** Coluna da chave estrangeira que leva ao pai. */
  fk: string;
  /**
   * Pais ADICIONAIS cujo orgId precisa bater com o do primeiro.
   *
   * Lista e não campo único: WorkFieldValue tem três pais (tarefa, campo e opção
   * escolhida) e um deles ficaria de fora numa estrutura que só comporta dois.
   * Cada entrada aqui tem um gatilho correspondente no banco — a varredura do
   * catálogo no teste de isolamento cobra os dois lados.
   */
  paisConferidos?: readonly { modelo: string; fk: string }[];
}

export const FILHOS_COM_ORGID_REDUNDANTE: readonly FilhoComOrgIdRedundante[] = [
  { modelo: 'IntegrationHealth', pai: 'IntegrationAccount', fk: 'accountId' },
  { modelo: 'LeadEvent', pai: 'Lead', fk: 'leadId' },
  { modelo: 'BioLink', pai: 'BioPage', fk: 'pageId' },
  { modelo: 'BioChallengeAccount', pai: 'BioChallenge', fk: 'challengeId' },
  { modelo: 'BioChallengePost', pai: 'BioChallengeAccount', fk: 'contaId' },
  { modelo: 'BioChallengeSnapshot', pai: 'BioChallengeAccount', fk: 'contaId' },
  { modelo: 'WorkStatus', pai: 'WorkList', fk: 'listId' },
  { modelo: 'WorkFieldOption', pai: 'WorkField', fk: 'fieldId' },
  {
    modelo: 'WorkFieldValue',
    pai: 'WorkTask',
    fk: 'taskId',
    // `optionId` é FK ANULÁVEL: valor de campo que não é dropdown não tem opção.
    // O gatilho trata o nulo (sem pai, nada a conferir); o que ele recusa é
    // opção de OUTRA empresa, que sem esta linha entrava sem reclamação.
    paisConferidos: [
      { modelo: 'WorkField', fk: 'fieldId' },
      { modelo: 'WorkFieldOption', fk: 'optionId' },
    ],
  },
  { modelo: 'WorkComment', pai: 'WorkTask', fk: 'taskId' },
  // Horas apontadas (esteira de clientes, 17/09/2026). Um pai só: a etapa é
  // fotografia em texto, não chave estrangeira — ver a migration.
  { modelo: 'WorkApontamento', pai: 'WorkTask', fk: 'taskId' },
  // O onboarding do cliente (23/09/2026): os quatro filhos do trilho. A
  // empresa é sempre a do trilho — migration `20260924010000_onboarding_do_cliente`.
  { modelo: 'OnboardingItem', pai: 'OnboardingTrilho', fk: 'trilhoId' },
  { modelo: 'OnboardingConvite', pai: 'OnboardingTrilho', fk: 'trilhoId' },
  { modelo: 'OnboardingAta', pai: 'OnboardingTrilho', fk: 'trilhoId' },
  { modelo: 'OnboardingMarco', pai: 'OnboardingTrilho', fk: 'trilhoId' },
  // O episódio da máquina de conteúdo (MC7, 23/09/2026): a empresa é a da
  // rodada, e a página de links, quando houver, tem de ser da mesma empresa —
  // migration `20260924060000_pauta_episodio`.
  {
    modelo: 'PautaEpisodio',
    pai: 'PautaRodada',
    fk: 'rodadaId',
    paisConferidos: [{ modelo: 'BioPage', fk: 'bioPageId' }],
  },
  // A publicação da peça numa rede (MD6, 24/09/2026): a empresa é a da peça —
  // migration `20260924224733_pauta_publicacao`.
  { modelo: 'PautaPublicacao', pai: 'PautaPeca', fk: 'pecaId' },
  // O item do lote de aprovação (MD7, 24/09/2026): a empresa é a do lote —
  // migration `20260924235614_aprovacao_de_lote`.
  { modelo: 'ItemDoLote', pai: 'AprovacaoDeLote', fk: 'loteId' },
  // Quem comentou a palavra-chave num post da semana (MD9, 25/09/2026): a
  // empresa é a da peça — migration `20260925021740_comentario_com_palavra`.
  { modelo: 'ComentarioComPalavra', pai: 'PautaPeca', fk: 'pecaId' },
] as const;

/**
 * Todos os pais conferidos de um filho, o derivante na frente.
 *
 * Existe para que nenhum consumidor precise lembrar que `paisConferidos` é
 * opcional — foi exatamente esse tipo de "só o primeiro" que deixou o terceiro
 * pai de WorkFieldValue sem gatilho e sem teste.
 */
export function paisDoFilho(filho: FilhoComOrgIdRedundante): { modelo: string; fk: string }[] {
  return [{ modelo: filho.pai, fk: filho.fk }, ...(filho.paisConferidos ?? [])];
}

const GLOBAIS = new Set(MODELOS_GLOBAIS.map((m) => m.modelo));

/** `true` quando o modelo está declarado como global. Não adivinha: consulta a lista. */
export function ehModeloGlobal(modelo: string): boolean {
  return GLOBAIS.has(modelo);
}

/** A justificativa declarada, ou `undefined` se o modelo não é global. */
export function motivoDeSerGlobal(modelo: string): ModeloGlobal | undefined {
  return MODELOS_GLOBAIS.find((m) => m.modelo === modelo);
}
