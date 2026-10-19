/*
 * ============================================================================
 * O CONSOLE DA PLATAFORMA — O NÚCLEO PURO (RF-B-02) — fatia 6.3
 * ============================================================================
 *
 * A PROMESSA, EM UMA FRASE
 * Quem opera a plataforma vê SAÚDE, USO e COBRANÇA por empresa — e não vê
 * REGISTRO de empresa nenhuma. Acesso de suporte a dado de cliente existe, mas é
 * o CLIENTE quem autoriza, tem prazo, tem escopo e fica registrado.
 *
 * ----------------------------------------------------------------------------
 * COMO O OPERADOR DA PLATAFORMA É IDENTIFICADO — e por que não há constante nova
 * ----------------------------------------------------------------------------
 * Ele é um usuário comum de UMA empresa: a empresa da casa, cujo slug já tem
 * nome e lugar — `SLUG_DA_PLATAFORMA`, em `src/tenants/provisionar.ts`, valendo
 * `'root'`. É a constante que o provisionamento usa desde ondas atrás, e o
 * comentário dela sempre disse que "quando o console da plataforma existir
 * (RF-B-02), é esta constante que dá lugar ao papel de verdade". O console
 * existe agora: ele IMPORTA aquela, e este arquivo não declara nenhuma homônima.
 *
 * A PRIMEIRA VERSÃO DESTA FATIA DECLARAVA UMA SEGUNDA `SLUG_DA_PLATAFORMA`, com
 * o valor `'plataforma'`. O estrago tinha três camadas, e vale registrar porque
 * o erro é fácil de repetir:
 *
 *   1. a empresa que PROVISIONA (slug `root`) não abria o console, e a que
 *      abriria o console (slug `plataforma`) não provisionava nada;
 *   2. a empresa de slug `plataforma` não existia, e nada a criava — o console
 *      ficava inalcançável para todo mundo;
 *   3. `plataforma` NÃO está na lista de identificadores reservados do cadastro
 *      (`src/onboarding/cadastro.ts`), que é anônimo e deriva o slug do nome da
 *      empresa. Quem se cadastrasse como "Plataforma" levava o identificador,
 *      passava a satisfazer a conferência de "sou a plataforma" e via a lista de
 *      clientes. E, mesmo barrado no login, o slug é único no banco: a empresa
 *      do console nunca mais poderia ser criada.
 *
 * `root` não tem nenhum dos três problemas: existe, provisiona, e ESTÁ na lista
 * de reservados do cadastro (ela importa a mesma constante). A conferência de
 * identidade e a de provisionamento passaram a falar da mesma empresa.
 *
 * O DESENHO CONTINUA VALENDO, e ele é o que evita permissão nova:
 *
 *  1. `Org.modulos = []` — o gate de módulos por empresa (`tenants/modulos.ts`,
 *     RF-T-06) responde **404 em toda rota de módulo de negócio** para essa
 *     sessão. Leads, financeiro, bio, pauta, conteúdo, campanhas, metas,
 *     instagram, pixels, relatórios e trabalho somem de uma vez, sem lista nova.
 *     (Hoje a empresa `root` é a da CASA e tem módulos ligados — ver a nota de
 *     FORA DO ESCOPO no relatório da fatia: enquanto a casa e a plataforma forem
 *     a mesma empresa, quem fecha as rotas de negócio é o gate, não o console.)
 *  2. O ISOLAMENTO POR LINHA — a sessão do operador carrega `app.org_id` = a
 *     empresa da plataforma, então toda rota de ESPINHA que sobrar (rastro,
 *     usuários, agentes, memória…) responde recortada por ESSA empresa.
 *  3. A CERCA DESTE ARQUIVO — `SUPERFICIE_DO_CONSOLE`, `SUPERFICIE_DO_CLIENTE` e
 *     `SUPERFICIE_DO_SUPORTE`.
 *
 * O terceiro existe porque os dois primeiros não bastam HOJE: a aplicação ainda
 * conecta como DONA das tabelas, e sob conexão dona o isolamento por linha é
 * inerte (ver `anunciarPapel` em `src/prisma/sessao-de-banco.ts`). Um console que
 * dependesse só da policy para não vazar não estaria protegido no dia de hoje. A
 * cerca protege hoje; a policy protege depois da virada; e a suíte mede as duas,
 * com o papel restrito e com o papel dono (`test/console-da-plataforma.test.ts`).
 *
 * ----------------------------------------------------------------------------
 * POR QUE ESTE CONSOLE **NÃO** ENTROU EM `CHAMADORES_DE_PLATAFORMA`
 * ----------------------------------------------------------------------------
 * A sentinela de plataforma (`src/prisma/contexto-de-plataforma.ts`) abre o
 * contexto para consultas que rodam ANTES de existir empresa — login,
 * provisionamento, cron da casa — e libera leitura em `Org`, `User`, `Role`, as
 * duas junções e `PolicyVersion`. Ela é a tentação óbvia aqui: com ela o console
 * listaria todas as empresas numa consulta.
 *
 * Não entrou, e o motivo é o que a fatia pede em primeiro lugar. Entrar na lista
 * daria a este módulo leitura de `Org`, `User` e `Role` de TODAS as empresas — a
 * lista de quem trabalha em cada cliente, com e-mail e papel. Isso é dado de
 * cliente, e a fatia diz que o console não o vê. O console não precisa dele: o
 * que ele mostra é o REGISTRO DA PLATAFORMA sobre cada cliente
 * (`EmpresaNaPlataforma`), que é escrito pela plataforma, pertence à empresa da
 * plataforma e por isso é alcançável pela policy comum, sem exceção nenhuma.
 *
 * A consequência honesta, dita em voz alta: a lista de empresas do console é o
 * que a plataforma REGISTROU, não uma varredura de `Org`. Empresa provisionada
 * por fora e não registrada aqui não aparece — e é por isso que a rota
 * `PUT /empresas/:empresaId` existe.
 *
 * E HÁ UMA SEGUNDA CONSEQUÊNCIA, que vale dizer antes de alguém descobrir sozinho:
 * O CONSOLE NASCE VAZIO. A migration desta fatia
 * (`20260911235500_console_da_plataforma`) traz um bloco de semente que procura
 * uma `Org` de slug `'plataforma'` — o valor da constante ERRADA, escrito antes
 * da correção. Com o slug certo (`root`) aquele `SELECT` não casa, o bloco se
 * cala com o `NOTICE` que ele já previa e nenhuma linha é semeada.
 *
 * A migration NÃO foi corrigida, e não podia ser: migração aplicada é imutável
 * (o banco guarda o resumo; editar o arquivo depois faz o banco seguir com o SQL
 * antigo enquanto o arquivo mostra o novo). O conserto é uma migração NOVA, de
 * outra fatia, e está registrado no relatório.
 *
 * O efeito prático é pequeno e, por acaso, na direção segura: o console começa
 * sem nenhuma empresa e o operador registra as que quiser por
 * `PUT /api/tenants/plataforma/empresas/:empresaId`. Enquanto uma empresa não
 * está registrada, `usar()` recusa acesso de suporte a ela antes de qualquer
 * troca de contexto — ou seja, a superfície nasce menor, não maior.
 *
 * ----------------------------------------------------------------------------
 * O QUE ESTE ARQUIVO É
 * ----------------------------------------------------------------------------
 * Núcleo PURO: nada de Nest, nada de HTTP, nada de Prisma concreto. Entram um
 * relógio, um acesso e uma superfície; saem "pode" ou "não pode". É o que
 * permite à suíte interrogar a decisão sem subir aplicação e sem banco — e é o
 * que permite provar a expiração POR TENTATIVA, com relógio controlado, em vez
 * de conferir um campo que ninguém lê.
 */

/*
 * ---------------------------------------------------------------------------
 * A CERCA: QUAL MODELO, QUAL OPERAÇÃO — E QUAIS ARGUMENTOS
 * ---------------------------------------------------------------------------
 * Cercar por MODELO não basta, e cercar por (modelo, operação) também não. A
 * revisão adversarial de 11/09/2026 mediu três buracos na versão que só olhava o
 * nome:
 *
 *  1. `include` ATRAVESSA A CERCA PELA RELAÇÃO. `EmpresaNaPlataforma` e
 *     `AcessoDeSuporte` têm `org Org @relation(...)`, e `Org` tem `leads`,
 *     `sessions` e `eventLogs`. Um `findFirst({ include: { org: { include:
 *     { leads: true } } } })` passava pela cerca antiga e devolvia registro de
 *     cliente — inclusive sob o papel restrito, porque dentro do contexto do
 *     cliente a policy DAQUELA empresa permite.
 *  2. `count` COM FILTRO LIVRE É ORÁCULO. "Contagem não é registro" só vale se a
 *     contagem não puder perguntar qualquer coisa: um `where` vindo do pedido
 *     transforma `session.count` num oráculo binário sobre o conteúdo da sessão,
 *     e `startsWith` extrai o texto letra a letra. Verde nas duas catracas.
 *  3. `$transaction` E `$extends` DEVOLVEM CLIENTE SEM CERCA. Os dois estavam na
 *     lista de infraestrutura permitida e só não vazavam por acidente: sem
 *     `bind`, o `this` ia para o proxy e o Prisma explodia com um erro
 *     incompreensível. O conserto óbvio daquele erro — dar `bind` — abriria o
 *     buraco de verdade.
 *
 * Então a cerca passou a declarar, por modelo: as OPERAÇÕES, os CAMPOS escalares
 * que podem ser lidos e escritos, os FILTROS que podem aparecer em `where` e as
 * RELAÇÕES que um `select` pode atravessar (com as colunas de lá). O que não foi
 * declarado é recusado na chamada, com o nome do que faltava.
 *
 * E toda operação carrega a empresa: leitura e escrita em massa exigem `orgId`
 * no `where`, criação exige `orgId` no `data`. É a forma local da proibição do
 * 02-CONSTRAINTS ("nunca consultar sem tenant resolvido") — e é o que impede um
 * `count()` sem argumento nenhum de contar as linhas de todas as empresas sob a
 * conexão dona.
 */

/** Uma relação que `select` pode atravessar → as colunas permitidas dentro. */
export type RelacaoCercada = Readonly<Record<string, readonly string[]>>;

export interface ModeloCercado {
  /** A propriedade do cliente Prisma (`prisma.<modelo>`), em minúscula inicial. */
  modelo: string;
  /** As operações permitidas nele. Fechada: o que não está aqui é recusado. */
  operacoes: readonly string[];
  /** Colunas escalares que `select`, `orderBy` e `data` podem citar. */
  campos: readonly string[];
  /**
   * Colunas que podem aparecer em `where`.
   *
   * NÃO é `campos`: é a lista pensada do que pode ser PERGUNTADO. Filtrar por
   * `motivo` ou por `resumo` seria o oráculo do item 2 acima, e por isso texto
   * livre de cliente não entra aqui nem que esteja em `campos`.
   */
  filtros: readonly string[];
  /** Relações que `select` pode atravessar. Ausente = nenhuma. */
  relacoes?: RelacaoCercada;
  /** Por que este modelo entra, e o que a operação permitida deixa ver. */
  porQue: string;
}

/**
 * As colunas de `AcessoDeSuporte`, numa lista só.
 *
 * Ela é citada por DUAS superfícies (a do cliente e a do suporte), que declaram
 * operações diferentes sobre a mesma tabela. Duas cópias divergiriam no dia em
 * que alguém acrescentasse uma coluna.
 */
const CAMPOS_DO_ACESSO = [
  'id',
  'orgId',
  'operadorEmail',
  'operadorNome',
  'escopo',
  'motivo',
  'autorizadoPorId',
  'autorizadoPorNome',
  'autorizadoEm',
  'expiraEm',
  'revogadoEm',
  'revogadoPorId',
  'usos',
  'ultimoUsoEm',
  'eventoId',
  'criadoEm',
] as const;

/**
 * O que o CONSOLE alcança. Duas tabelas, e as duas são da própria plataforma.
 *
 * `EmpresaNaPlataforma` pertence à empresa da plataforma (`orgId` = plataforma)
 * e descreve um cliente (`empresaId`). Não guarda dado de operação do cliente:
 * guarda nome, plano, estado, saúde e contadores que a plataforma mediu.
 *
 * `OperacaoRodada` é o painel semanal da operação da ROOT, só leitura aqui (quem
 * grava é o script `importar-painel-operacao`, que recusa org de cliente).
 *
 * SEM `relacoes`: a relação `org` existe no schema e leva a `Org`, e de `Org` se
 * chega a lead, sessão e evento. Não declarar é o que fecha o caminho.
 */
export const SUPERFICIE_DO_CONSOLE: readonly ModeloCercado[] = [
  {
    modelo: 'empresaNaPlataforma',
    operacoes: ['findMany', 'findFirst', 'count', 'upsert'],
    campos: [
      'id',
      'orgId',
      'empresaId',
      'nome',
      'slug',
      'plano',
      'estado',
      'saude',
      'usuarios',
      'agentesAtivos',
      'gastoIaUsdMes',
      'mensalidadeBrl',
      'cobrancaEmDia',
      'proximaCobranca',
      'medidoEm',
      'ultimaAtividadeEm',
      'observacao',
      'criadoEm',
      'atualizadoEm',
    ],
    filtros: ['orgId', 'empresaId', 'orgId_empresaId', 'estado', 'saude', 'plano'],
    porQue:
      'o registro que a PLATAFORMA mantém sobre cada cliente — nome, plano, estado, saúde, ' +
      'uso e cobrança. Pertence à empresa da plataforma; nenhuma linha aqui é dado de operação ' +
      'de cliente. A relação `org` NÃO está declarada: por ela se chegaria a lead, sessão e ' +
      'evento.',
  },
  {
    modelo: 'operacaoRodada',
    operacoes: ['findMany', 'findUnique'],
    campos: ['id', 'orgId', 'rodadaEm', 'conteudo', 'origem', 'createdAt', 'updatedAt'],
    filtros: ['orgId', 'rodadaEm', 'orgId_rodadaEm'],
    porQue:
      'o painel semanal da operação da ROOT (clientes, ondas, dinheiro), uma linha por rodada. ' +
      'Só existe linha da empresa da plataforma: o script que grava recusa org de cliente. ' +
      'Sem relação declarada, pelo mesmo motivo de `empresaNaPlataforma`.',
  },
] as const;

/**
 * O que o LADO DO CLIENTE alcança — autorizar, listar e revogar.
 *
 * Esta superfície é de quem está na PRÓPRIA casa: o titular da empresa cliente,
 * na sessão dele. Ela existe separada da de suporte de propósito. Juntá-las
 * daria ao operador da plataforma o `user.findFirst` que só o lado do cliente
 * precisa — e a cerca do operador é justamente a que não pode crescer.
 */
export const SUPERFICIE_DO_CLIENTE: readonly ModeloCercado[] = [
  {
    modelo: 'acessoDeSuporte',
    operacoes: ['findFirst', 'findMany', 'count', 'create', 'updateMany'],
    campos: CAMPOS_DO_ACESSO,
    filtros: ['id', 'orgId', 'operadorEmail', 'escopo', 'expiraEm', 'revogadoEm'],
    porQue:
      'a própria autorização, vista e escrita pelo CLIENTE: achar a que vale, listar, criar, ' +
      'revogar e carimbar o uso. É registro da relação plataforma-cliente, não dado de operação. ' +
      'Escrita só por `updateMany`, que carrega `orgId` no `where` — `update` por id sozinho ' +
      'não carrega empresa nenhuma.',
  },
  {
    modelo: 'user',
    operacoes: ['findFirst'],
    campos: ['id', 'orgId', 'isActive', 'passwordHash'],
    filtros: ['id', 'orgId'],
    relacoes: { roles: ['key'] },
    porQue:
      'QUEM ASSINA, SEGUNDO O BANCO. É a consulta de `src/auth/aprovador.ts`, a mesma que a ' +
      'fila de aprovação usa desde a fatia 3.9: a alçada de R4 tem de sair do papel VIGENTE, ' +
      'não do token de sessão, que dura oito horas. A relação `roles` é a única declarada em ' +
      'toda a cerca, com as colunas nomeadas (`key`), porque sem ela não há papel para comparar. ' +
      'Roda só no lado do CLIENTE, sobre o usuário da própria sessão.',
  },
] as const;

/**
 * O que o ACESSO DE SUPORTE alcança, DEPOIS de autorizado, e só dentro do prazo.
 *
 * Contagens e a própria autorização. Nenhum `find*` em tabela de cliente: é isto
 * que faz "o operador da plataforma não consegue ABRIR um registro de empresa"
 * continuar verdadeiro mesmo com autorização na mão.
 *
 * E as contagens são de FILTRO FECHADO. `session.count` só aceita `orgId`,
 * `criadaEm` e `status` — nunca `pedido`, nunca `resposta`, nunca `motivo`.
 * Contagem com filtro livre sobre texto é leitura de texto, só que devagar.
 *
 * Crescer esta lista é decisão de revisão, não efeito colateral: a suíte compara
 * o conjunto declarado com o que o código usa, e o `porQue` é obrigatório.
 */
export const SUPERFICIE_DO_SUPORTE: readonly ModeloCercado[] = [
  {
    modelo: 'acessoDeSuporte',
    operacoes: ['findMany', 'updateMany'],
    campos: CAMPOS_DO_ACESSO,
    filtros: ['orgId', 'id', 'operadorEmail', 'expiraEm'],
    porQue:
      'a autorização que o operador vai usar: achar as candidatas dele naquela empresa e ' +
      'carimbar o uso. Nenhuma outra linha desta tabela é alcançável — o `where` exige `orgId`.',
  },
  {
    modelo: 'session',
    operacoes: ['count'],
    campos: [],
    filtros: ['orgId', 'criadaEm', 'status'],
    porQue:
      'quantas sessões de agente houve na janela, e quantas falharam. Contagem — nunca o ' +
      'conteúdo da sessão — e com filtro fechado em três colunas, porque contagem com filtro ' +
      'livre sobre `pedido` seria leitura do pedido letra a letra.',
  },
  {
    modelo: 'approval',
    operacoes: ['count'],
    campos: [],
    filtros: ['orgId', 'status'],
    porQue:
      'quantas aprovações estão paradas na fila. Contagem — nunca o corpo retido —, filtrada ' +
      'só por empresa e estado.',
  },
  {
    modelo: 'rotinaExecucao',
    operacoes: ['count'],
    campos: [],
    filtros: ['orgId', 'inicioEm', 'status'],
    porQue:
      'quantas passagens de rotina falharam na janela. Contagem — nunca o resumo nem o erro, ' +
      'que podem citar dado do cliente.',
  },
  {
    modelo: 'eventLog',
    operacoes: ['count'],
    campos: [],
    filtros: ['orgId', 'tipo', 'ocorreuEm'],
    porQue:
      'O TETO DO RASTRO, e nada mais. Cada tentativa NEGADA de acesso de suporte grava um ' +
      'evento no rastro da empresa cliente, e evento do rastro não se apaga — sem teto, um ' +
      'laço enche o registro de auditoria de qualquer cliente registrado. A contagem é por ' +
      '`tipo` (os eventos desta fatia) e por janela de tempo; o `payload` não é alcançável.',
  },
] as const;

/*
 * NENHUM MÉTODO DE INFRAESTRUTURA PASSA. A lista antiga tinha `$transaction`,
 * `$connect`, `$disconnect`, `$on` e `$extends`; os dois primeiros da lista de
 * verdade perigosa — `$transaction` entrega ao callback um cliente CRU, e
 * `$extends` devolve um cliente novo sem cerca nenhuma — e nenhum dos cinco é
 * usado por este módulo. Lista vazia é a única que não precisa ser defendida.
 *
 * `$queryRaw` e irmãos nunca estiveram aqui, e continuam de fora: SQL cru
 * atravessa qualquer cerca por modelo.
 */

/**
 * Nomes que o próprio JavaScript procura num objeto e que NÃO são acesso a
 * modelo: `await` procura `then`, `util.inspect` procura `constructor`,
 * `JSON.stringify` procura `toJSON`.
 *
 * Devolvem `undefined` em vez de lançar E em vez do valor real. Lançar faria um
 * `console.log(cerca)` explodir com uma recusa sem sentido; devolver o valor
 * real entregaria `constructor`, e `new (cerca.constructor)()` é um cliente
 * Prisma novo, sem cerca — a mesma fuga de `$extends`, por outra porta.
 */
const PROTOCOLO_JS = new Set(['then', 'catch', 'finally', 'constructor', 'toJSON']);

/** Alguém tentou alcançar, pelo console, o que o console não alcança. */
export class ForaDaSuperficieError extends Error {
  constructor(
    readonly superficie: string,
    readonly alvo: string,
    detalhe?: string,
  ) {
    super(
      `"${alvo}" está fora da superfície "${superficie}" do console da plataforma` +
        (detalhe ? ` (${detalhe})` : '') +
        '. O console mostra saúde, uso e cobrança POR empresa e não abre registro de empresa ' +
        'nenhuma (RF-B-02). Se a leitura nova é legítima, declare o par (modelo, operação) — e ' +
        'os campos, filtros ou relações que ela precisa — em `SUPERFICIE_DO_CONSOLE`, ' +
        '`SUPERFICIE_DO_CLIENTE` ou `SUPERFICIE_DO_SUPORTE` (src/platform/plataforma.ts) com o ' +
        'motivo escrito. E lembre que contagem com filtro livre é leitura devagar.',
    );
    this.name = 'ForaDaSuperficieError';
  }
}

/* ------------------------------------------------ a conferência de argumentos */

/** Chaves de primeiro nível que uma chamada cercada pode trazer. */
const ARGUMENTOS_PERMITIDOS = new Set([
  'where',
  'select',
  'orderBy',
  'take',
  'skip',
  'data',
  'create',
  'update',
]);

/**
 * Operadores de comparação aceitos num `where`.
 *
 * `contains`, `startsWith`, `endsWith`, `search` e `mode` estão FORA, e a
 * ausência é o ponto: eles são o que transforma uma contagem permitida em busca
 * por prefixo sobre o texto do cliente. `AND`, `OR` e `NOT` também estão fora —
 * são a porta por onde uma chave não declarada entraria aninhada.
 */
const OPERADORES_DE_FILTRO = new Set(['equals', 'not', 'in', 'notIn', 'lt', 'lte', 'gt', 'gte']);

/** Operadores de escrita aceitos num `data`. */
const OPERADORES_DE_ESCRITA = new Set(['set', 'increment', 'decrement']);

/** Operações que leem ou alteram em massa: todas exigem `orgId` no `where`. */
const EXIGEM_ORGID_NO_WHERE = new Set([
  'findMany',
  'findFirst',
  'findUnique',
  'count',
  'updateMany',
  'deleteMany',
  'upsert',
]);

/** Operações que criam linha: exigem `orgId` no `data`/`create`. */
const EXIGEM_ORGID_NO_DATA = new Set(['create', 'createMany', 'upsert']);

function escalar(v: unknown): boolean {
  return (
    v === null ||
    typeof v === 'string' ||
    typeof v === 'number' ||
    typeof v === 'boolean' ||
    typeof v === 'bigint' ||
    v instanceof Date
  );
}

function objetoSimples(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);
}

function escalarOuLista(v: unknown): boolean {
  return escalar(v) || (Array.isArray(v) && v.every(escalar));
}

/**
 * A empresa está no `where`?
 *
 * Aceita `orgId` no primeiro nível ou dentro de uma chave única composta
 * (`orgId_empresaId: { orgId, empresaId }`), que é a forma que o `upsert` do
 * console usa. Fora desses dois lugares, não conta.
 */
function whereTemOrgId(where: unknown): boolean {
  if (!objetoSimples(where)) return false;
  if (typeof where.orgId === 'string' && where.orgId) return true;
  for (const valor of Object.values(where)) {
    if (objetoSimples(valor) && typeof valor.orgId === 'string' && valor.orgId) return true;
  }
  return false;
}

function conferirWhere(m: ModeloCercado, where: unknown, recusa: (d: string) => never): void {
  if (!objetoSimples(where)) recusa('`where` precisa ser um objeto');
  const filtros = new Set(m.filtros);
  for (const [chave, valor] of Object.entries(where)) {
    if (!filtros.has(chave)) recusa(`filtro "${chave}" não declarado em \`filtros\``);
    if (escalar(valor)) continue;
    if (!objetoSimples(valor)) recusa(`filtro "${chave}" com valor que não é escalar nem objeto`);
    for (const [operador, alvo] of Object.entries(valor)) {
      if (OPERADORES_DE_FILTRO.has(operador)) {
        if (!escalarOuLista(alvo)) recusa(`"${chave}.${operador}" aninha objeto`);
        continue;
      }
      // Chave única composta: `orgId_empresaId: { orgId, empresaId }`.
      if (filtros.has(operador)) {
        if (!escalar(alvo)) recusa(`"${chave}.${operador}" aninha objeto`);
        continue;
      }
      recusa(`operador "${operador}" não é permitido em \`where\` (em "${chave}")`);
    }
  }
}

function conferirSelect(m: ModeloCercado, select: unknown, recusa: (d: string) => never): void {
  if (!objetoSimples(select)) recusa('`select` precisa ser um objeto');
  const campos = new Set(m.campos);
  const relacoes = m.relacoes ?? {};
  for (const [chave, valor] of Object.entries(select)) {
    if (campos.has(chave)) {
      if (typeof valor !== 'boolean') recusa(`"${chave}" em \`select\` precisa ser booleano`);
      continue;
    }
    const colunas = relacoes[chave];
    if (!colunas) recusa(`"${chave}" não é campo declarado nem relação declarada`);
    if (!objetoSimples(valor) || !objetoSimples(valor.select)) {
      recusa(`a relação "${chave}" só pode ser atravessada com um \`select\` explícito`);
    }
    for (const [coluna, pedido] of Object.entries(valor.select as Record<string, unknown>)) {
      if (!colunas.includes(coluna)) recusa(`"${chave}.${coluna}" não está declarado na relação`);
      if (typeof pedido !== 'boolean') recusa(`"${chave}.${coluna}" precisa ser booleano`);
    }
  }
}

function conferirOrderBy(m: ModeloCercado, ordem: unknown, recusa: (d: string) => never): void {
  const lista = Array.isArray(ordem) ? ordem : [ordem];
  const campos = new Set(m.campos);
  for (const item of lista) {
    if (!objetoSimples(item)) recusa('`orderBy` precisa ser objeto ou lista de objetos');
    for (const [chave, direcao] of Object.entries(item)) {
      if (!campos.has(chave)) recusa(`ordenar por "${chave}", que não é campo declarado`);
      if (direcao !== 'asc' && direcao !== 'desc') recusa(`direção inválida em "${chave}"`);
    }
  }
}

function conferirData(m: ModeloCercado, data: unknown, recusa: (d: string) => never): void {
  if (!objetoSimples(data)) recusa('`data` precisa ser um objeto');
  const campos = new Set(m.campos);
  for (const [chave, valor] of Object.entries(data)) {
    if (!campos.has(chave)) recusa(`escrever em "${chave}", que não é campo declarado`);
    if (escalar(valor) || valor === undefined) continue;
    if (!objetoSimples(valor)) recusa(`"${chave}" recebe valor que não é escalar`);
    for (const [operador, alvo] of Object.entries(valor)) {
      if (!OPERADORES_DE_ESCRITA.has(operador)) {
        recusa(`operador "${operador}" não é permitido em \`data\` (em "${chave}")`);
      }
      if (!escalar(alvo)) recusa(`"${chave}.${operador}" aninha objeto`);
    }
  }
}

/**
 * Confere os argumentos de UMA chamada cercada. Lança `ForaDaSuperficieError`
 * com o nome do que faltava.
 *
 * Exportada para a suíte poder interrogar a decisão sem montar um proxy — e
 * para o controle negativo poder mostrar a MESMA chamada passando quando a
 * declaração a cobre.
 */
export function conferirArgumentos(
  superficie: string,
  m: ModeloCercado,
  operacao: string,
  args: unknown,
): void {
  const recusa = (detalhe: string): never => {
    throw new ForaDaSuperficieError(superficie, `${m.modelo}.${operacao}`, detalhe);
  };

  if (args === undefined) {
    // `count()` sem argumento nenhum conta TODAS as linhas da tabela — sob a
    // conexão dona, as de todas as empresas. Nunca é o que se quis dizer.
    recusa('chamada sem argumentos: toda consulta cercada declara a empresa');
  }
  if (!objetoSimples(args)) recusa('argumento que não é objeto');
  const a = args as Record<string, unknown>;

  for (const chave of Object.keys(a)) {
    if (!ARGUMENTOS_PERMITIDOS.has(chave)) {
      recusa(
        `"${chave}" não é argumento permitido` +
          (chave === 'include'
            ? ': relação se atravessa por `select` DECLARADO, nunca por `include`'
            : ''),
      );
    }
  }

  if (a.where !== undefined) conferirWhere(m, a.where, recusa);
  if (a.select !== undefined) conferirSelect(m, a.select, recusa);
  if (a.orderBy !== undefined) conferirOrderBy(m, a.orderBy, recusa);
  if (a.data !== undefined) conferirData(m, a.data, recusa);
  if (a.create !== undefined) conferirData(m, a.create, recusa);
  if (a.update !== undefined) conferirData(m, a.update, recusa);
  if (a.take !== undefined && typeof a.take !== 'number') recusa('`take` precisa ser número');
  if (a.skip !== undefined && typeof a.skip !== 'number') recusa('`skip` precisa ser número');

  if (EXIGEM_ORGID_NO_WHERE.has(operacao) && !whereTemOrgId(a.where)) {
    recusa('`where` sem `orgId`: nunca consultar sem tenant resolvido (02-CONSTRAINTS)');
  }
  if (EXIGEM_ORGID_NO_DATA.has(operacao)) {
    const criacao = (a.create ?? a.data) as Record<string, unknown> | undefined;
    if (!objetoSimples(criacao) || typeof criacao.orgId !== 'string' || !criacao.orgId) {
      recusa('criação sem `orgId`: a linha tem de nascer com dono');
    }
  }
}

/**
 * Embrulha um cliente Prisma numa superfície fechada.
 *
 * Devolve um objeto com a mesma forma, mas que só responde pelos modelos
 * declarados, dentro deles só pelas operações declaradas e, dentro delas, só com
 * os argumentos declarados. Qualquer outra coisa LANÇA — inclusive SQL cru,
 * inclusive `$transaction`, inclusive `include` de relação.
 *
 * POR QUE UM PROXY E NÃO DISCIPLINA. Disciplina é o que a suíte não consegue
 * medir depois que o arquivo cresce. O proxy transforma "o console não lê lead"
 * de promessa em tentativa que falha — e é a tentativa que a suíte faz, com o
 * papel restrito E com o papel dono, porque hoje o dono atravessa policy e
 * seria a cerca a única coisa de pé.
 *
 * O tipo de saída é `unknown` de propósito: quem usa declara o recorte que
 * precisa. Devolver `PrismaClient` convidaria o chamador a alcançar o que a
 * cerca recusa em tempo de execução — erro que só aparece na tela do cliente.
 */
export function cercar(prisma: object, superficie: readonly ModeloCercado[], nome: string): unknown {
  const porModelo = new Map(superficie.map((m) => [m.modelo, m]));

  return new Proxy(prisma, {
    get(alvo, prop) {
      // Símbolo é coisa do motor (iteradores, `Symbol.toStringTag`): nunca é
      // acesso a modelo, e recusar quebraria o próprio `console.log`.
      if (typeof prop !== 'string') return Reflect.get(alvo, prop);
      if (PROTOCOLO_JS.has(prop)) return undefined;

      const m = porModelo.get(prop);
      if (!m) throw new ForaDaSuperficieError(nome, prop);
      const operacoes = new Set(m.operacoes);

      const delegate = Reflect.get(alvo, prop) as Record<string, unknown> | undefined;
      if (!delegate || typeof delegate !== 'object') return delegate;

      return new Proxy(delegate, {
        get(d, operacao) {
          if (typeof operacao !== 'string') return Reflect.get(d, operacao);
          if (PROTOCOLO_JS.has(operacao)) return undefined;
          if (!operacoes.has(operacao)) {
            throw new ForaDaSuperficieError(nome, `${prop}.${operacao}`);
          }
          const fn = Reflect.get(d, operacao);
          if (typeof fn !== 'function') return fn;
          // O `this` do delegate DE VERDADE: o cliente do Prisma guarda estado
          // interno e reapontá-lo para o proxy faria cada acesso interno
          // reentrar aqui e ser recusado pelo nome errado.
          return (...args: unknown[]): unknown => {
            conferirArgumentos(nome, m, operacao, args[0]);
            return (fn as (...a: unknown[]) => unknown).apply(d, args);
          };
        },
      });
    },
  });
}

/*
 * ---------------------------------------------------------------------------
 * O ACESSO DE SUPORTE — prazo, escopo e estado
 * ---------------------------------------------------------------------------
 */

/**
 * Os escopos que uma autorização pode conceder. Lista FECHADA.
 *
 * Escopo escrito à mão pelo cliente viraria texto livre que ninguém compara com
 * nada — e "autorizei o suporte a ver X" tem de ser comparável com o que o
 * suporte de fato leu. Cada escopo aqui tem uma leitura correspondente no
 * serviço, e a suíte cobra que não exista escopo sem leitura nem leitura sem
 * escopo.
 */
export const ESCOPOS_DE_SUPORTE = ['diagnostico'] as const;
export type EscopoDeSuporte = (typeof ESCOPOS_DE_SUPORTE)[number];

export function escopoConhecido(v: unknown): v is EscopoDeSuporte {
  return typeof v === 'string' && (ESCOPOS_DE_SUPORTE as readonly string[]).includes(v);
}

/**
 * O prazo tem PISO e TETO, e os dois existem por motivos diferentes.
 *
 * O teto (72 h) é a promessa: acesso de suporte não vira acesso permanente por
 * distração de quem autorizou. O piso (5 min) é o contrário — um prazo de
 * segundos criaria autorização que expira antes de o suporte abrir a tela, e a
 * saída disso seria pedir outra, e outra, até alguém escrever "1 ano" para parar
 * de incomodar.
 */
export const PRAZO_MINIMO_MINUTOS = 5;
export const PRAZO_MAXIMO_MINUTOS = 72 * 60;
/** O que a tela oferece quando ninguém escolhe. */
export const PRAZO_PADRAO_MINUTOS = 60;

/** O motivo é campo de R4 (`exigeMotivo`), e motivo de uma palavra não é motivo. */
export const MOTIVO_MINIMO = 12;

/** O nível da escada em que autorizar acesso de suporte é classificado. */
export const NIVEL_DA_AUTORIZACAO = 'R4';

/** A alçada mínima de quem autoriza. É a de R4 na política — "Valor e acesso". */
export const ALCADA_DA_AUTORIZACAO = 'titular';

/**
 * R4 EXIGE REAUTENTICAÇÃO, e aqui ela acontece de verdade.
 *
 * A primeira versão desta fatia declarava o degrau R4 e cobrava três das quatro
 * exigências dele — motivo escrito, alçada e "é gente" —, omitindo justamente a
 * prova de presença. Ficava a mesma falha que a fatia 3.9 consertou na fila de
 * aprovação: um sistema afirmando um degrau que ele não cumpre.
 *
 * Quem confere é `ReauthService` (`src/auth/reauth.service.ts`), que já existe,
 * já compara a senha com o hash do banco, já tem fila por chave e teto de
 * tentativa. Ver `AcessoDeSuporteService.autorizar`.
 */
export const EXIGE_REAUTENTICACAO = true;

/*
 * ---------------------------------------------------------------------------
 * O TETO DO RASTRO — porque evento do rastro não se apaga
 * ---------------------------------------------------------------------------
 * Toda tentativa NEGADA vira evento no rastro DA EMPRESA CLIENTE, e é de
 * propósito: tentativa de entrar sem autorização é o que mais interessa a quem
 * audita. Sem teto, porém, o mesmo mecanismo vira arma: um laço no operador da
 * plataforma enche o rastro de qualquer empresa REGISTRADA — e a conferência de
 * "empresa registrada" não ajuda, porque a semente da migration registra todas.
 *
 * O teto é o mesmo desenho da trava de reautenticação: a partir de
 * `LIMITE_DE_RECUSAS_NA_JANELA` recusas registradas na janela, a recusa continua
 * acontecendo e PARA de virar linha nova. Uma única linha de "teto atingido"
 * entra por janela — a primeira é a que interessa; as seguintes não
 * acrescentariam nada e o tamanho do rastro deixaria de ser escolha de quem
 * audita para ser escolha de quem ataca.
 *
 * Durável, e não em memória: a contagem é do próprio rastro (`EventLog.count`,
 * declarado na superfície de suporte), então o teto vale entre processos.
 */
export const LIMITE_DE_RECUSAS_NA_JANELA = 5;
export const JANELA_DO_TETO_MINUTOS = 60;

/** O que a plataforma precisa saber de uma autorização para decidir. */
export interface AcessoParaDecidir {
  expiraEm: Date;
  revogadoEm?: Date | null;
  escopo: string;
  operadorEmail: string;
}

export type EstadoDoAcesso = 'valido' | 'expirado' | 'revogado';

/**
 * Em que estado está esta autorização NESTE instante.
 *
 * `agora` é PARÂMETRO e não `new Date()` por dentro: é o que permite à suíte
 * provar a expiração por TENTATIVA, adiantando o relógio, em vez de ler o campo
 * `expiraEm` e acreditar. Esta execução já encontrou um mecanismo que gravava um
 * prazo que ninguém lia — a diferença entre os dois é exatamente esta linha.
 *
 * A revogação vem ANTES da expiração de propósito: uma autorização revogada às
 * 10h que expiraria às 11h é revogada, e chamar isso de "expirada" apagaria a
 * decisão de quem revogou.
 */
export function estadoDoAcesso(acesso: AcessoParaDecidir, agora: Date): EstadoDoAcesso {
  if (acesso.revogadoEm && acesso.revogadoEm <= agora) return 'revogado';
  // `<=` e não `<`: no instante exato do vencimento o acesso já acabou. Um
  // prazo que ainda vale "no último milissegundo" é um prazo que precisa de
  // desempate, e desempate é onde erro de fuso vira acesso a mais.
  if (acesso.expiraEm <= agora) return 'expirado';
  return 'valido';
}

/** Quanto tempo ainda resta, em segundos. Nunca negativo. */
export function segundosRestantes(acesso: AcessoParaDecidir, agora: Date): number {
  return Math.max(0, Math.floor((acesso.expiraEm.getTime() - agora.getTime()) / 1000));
}

/** Recusa de acesso de suporte, com o motivo em vocabulário fechado. */
export type MotivoDaRecusa =
  | 'sem_autorizacao'
  | 'expirado'
  | 'revogado'
  | 'escopo_nao_autorizado'
  | 'operador_diferente';

export class AcessoDeSuporteNegadoError extends Error {
  constructor(
    readonly motivo: MotivoDaRecusa,
    readonly empresaId: string,
  ) {
    super(TEXTO_DA_RECUSA[motivo]);
    this.name = 'AcessoDeSuporteNegadoError';
  }
}

const TEXTO_DA_RECUSA: Record<MotivoDaRecusa, string> = {
  sem_autorizacao:
    'esta empresa não autorizou acesso de suporte. Quem autoriza é o cliente, na tela dele.',
  expirado: 'a autorização de suporte venceu. Peça uma nova ao cliente.',
  revogado: 'a autorização de suporte foi revogada pelo cliente.',
  escopo_nao_autorizado: 'a autorização de suporte não cobre este escopo.',
  operador_diferente: 'a autorização de suporte foi dada a outra pessoa.',
};

/**
 * A decisão inteira, em função pura: esta autorização serve a este operador,
 * para este escopo, neste instante?
 *
 * Devolve o motivo da recusa em vez de um booleano porque o motivo vai para o
 * RASTRO e para a tela — "não autorizado" e "venceu há dez minutos" pedem coisas
 * diferentes de quem está do outro lado.
 */
export function decidirAcesso(
  acesso: AcessoParaDecidir | null | undefined,
  operadorEmail: string,
  escopo: string,
  agora: Date,
): MotivoDaRecusa | null {
  if (!acesso) return 'sem_autorizacao';
  if (acesso.operadorEmail.toLowerCase() !== operadorEmail.toLowerCase()) {
    return 'operador_diferente';
  }
  const estado = estadoDoAcesso(acesso, agora);
  if (estado === 'revogado') return 'revogado';
  if (estado === 'expirado') return 'expirado';
  if (acesso.escopo !== escopo) return 'escopo_nao_autorizado';
  return null;
}

/**
 * Ordem em que os motivos de recusa são RELATADOS quando nenhuma candidata
 * serve. Do mais informativo para o menos.
 *
 * Existe porque "esconder a válida" e "relatar o motivo errado" são o mesmo
 * defeito visto de dois lados. Se a pessoa tem uma autorização revogada e outra
 * vencida, dizer "revogado" é mais útil do que dizer "venceu": o primeiro é uma
 * decisão que alguém tomou, o segundo é o relógio.
 */
const ORDEM_DA_RECUSA: readonly MotivoDaRecusa[] = [
  'revogado',
  'escopo_nao_autorizado',
  'expirado',
  'operador_diferente',
  'sem_autorizacao',
];

export interface EscolhaDeAcesso<T extends AcessoParaDecidir> {
  /** A autorização que serve, ou `null`. */
  valida: T | null;
  /** Quando nenhuma serve: por quê, na versão mais informativa. */
  recusa: MotivoDaRecusa | null;
  /** A candidata que explica a recusa — vai para o RASTRO. */
  candidata: T | null;
}

/**
 * Entre as autorizações desta pessoa nesta empresa, qual serve AGORA?
 *
 * A primeira versão desta fatia pegava UMA linha, a de `expiraEm` mais distante,
 * e decidia sobre ela. Com duas autorizações vivas isso ESCONDE a válida: uma
 * revogada com prazo longo ganha da válida com prazo curto, e o operador recebe
 * "revogado" com a autorização boa parada ao lado. O mesmo vale para escopo —
 * a de escopo errado com prazo maior derrubava a de escopo certo.
 *
 * Agora todas as candidatas passam por `decidirAcesso`, e a escolha é a
 * primeira que ele aprova. Quando nenhuma serve, o motivo relatado é o mais
 * informativo do conjunto (`ORDEM_DA_RECUSA`), junto da linha que o explica.
 */
export function escolherAcesso<T extends AcessoParaDecidir>(
  candidatas: readonly T[],
  operadorEmail: string,
  escopo: string,
  agora: Date,
): EscolhaDeAcesso<T> {
  let melhorRecusa: MotivoDaRecusa | null = null;
  let melhorCandidata: T | null = null;

  for (const c of candidatas) {
    const recusa = decidirAcesso(c, operadorEmail, escopo, agora);
    if (!recusa) return { valida: c, recusa: null, candidata: c };
    const posicao = ORDEM_DA_RECUSA.indexOf(recusa);
    const atual = melhorRecusa ? ORDEM_DA_RECUSA.indexOf(melhorRecusa) : Number.MAX_SAFE_INTEGER;
    if (posicao < atual) {
      melhorRecusa = recusa;
      melhorCandidata = c;
    }
  }
  return {
    valida: null,
    recusa: melhorRecusa ?? 'sem_autorizacao',
    candidata: melhorCandidata,
  };
}

/** Problema no pedido de autorização — 400, não 500. */
export class AutorizacaoInvalidaError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'AutorizacaoInvalidaError';
  }
}

export interface PedidoDeAutorizacao {
  operadorEmail: string;
  operadorNome?: string | null;
  escopo: string;
  motivo: string;
  minutos?: number;
  /**
   * A PROVA DE PRESENÇA de quem assina — a senha do próprio usuário.
   *
   * Só a forma `{ senha }`. A forma `{ token }` de `ReauthService` é presa a uma
   * linha de `Approval` (`claims.apr`) e só é emitida por `POST /auth/reautenticar`,
   * que exige uma aprovação pendente de verdade; aqui não há aprovação nenhuma,
   * então oferecê-la seria oferecer um caminho que sempre recusa.
   */
  senha?: string;
}

export interface AutorizacaoConferida {
  operadorEmail: string;
  operadorNome: string | null;
  escopo: EscopoDeSuporte;
  motivo: string;
  minutos: number;
  expiraEm: Date;
}

/**
 * Confere o pedido e devolve a forma normalizada. LANÇA com a frase em
 * português — é ela que a tela mostra.
 *
 * O que se confere aqui é só o PEDIDO. Quem confere a AUTORIDADE de quem
 * autoriza (alçada `titular` lida do BANCO, gente e não máquina, prova de
 * presença e nunca o próprio operador) é o serviço, porque depende do usuário
 * autenticado e do papel vigente dele.
 */
export function conferirPedido(pedido: PedidoDeAutorizacao, agora: Date): AutorizacaoConferida {
  const email = (pedido.operadorEmail ?? '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    throw new AutorizacaoInvalidaError('Informe o e-mail de quem vai receber o acesso de suporte.');
  }
  if (!escopoConhecido(pedido.escopo)) {
    throw new AutorizacaoInvalidaError(
      `Escopo "${pedido.escopo}" não existe. Escopos: ${ESCOPOS_DE_SUPORTE.join(', ')}.`,
    );
  }
  const motivo = (pedido.motivo ?? '').trim();
  if (motivo.length < MOTIVO_MINIMO) {
    // R4 `exigeMotivo`: o motivo é campo do RASTRO, e um registro que diz
    // "acesso concedido, motivo: ok" não explica nada a quem abrir daqui a
    // seis meses.
    throw new AutorizacaoInvalidaError(
      `Escreva o motivo do acesso (ao menos ${MOTIVO_MINIMO} caracteres). ` +
        'Ele fica no RASTRO e é o que explica a concessão depois.',
    );
  }
  const minutos = Math.trunc(pedido.minutos ?? PRAZO_PADRAO_MINUTOS);
  if (!Number.isFinite(minutos) || minutos < PRAZO_MINIMO_MINUTOS || minutos > PRAZO_MAXIMO_MINUTOS) {
    throw new AutorizacaoInvalidaError(
      `O prazo precisa ficar entre ${PRAZO_MINIMO_MINUTOS} minutos e ${PRAZO_MAXIMO_MINUTOS} ` +
        'minutos (72 horas). Acesso de suporte tem hora para acabar.',
    );
  }
  return {
    operadorEmail: email,
    operadorNome: (pedido.operadorNome ?? '').trim() || null,
    escopo: pedido.escopo,
    motivo,
    minutos,
    expiraEm: new Date(agora.getTime() + minutos * 60_000),
  };
}

/*
 * ---------------------------------------------------------------------------
 * OS TIPOS DO EVENTO — o vocabulário do RASTRO desta fatia
 * ---------------------------------------------------------------------------
 * Constantes, e não literais espalhados: o mesmo texto decide o que a suíte
 * procura, o que a tela do RASTRO mostra e o que um dia vai virar filtro. Três
 * cópias divergem; uma não.
 */
export const EVENTO_AUTORIZADO = 'plataforma.suporte.autorizado';
export const EVENTO_REVOGADO = 'plataforma.suporte.revogado';
export const EVENTO_USADO = 'plataforma.suporte.usado';
export const EVENTO_NEGADO = 'plataforma.suporte.negado';
/** A única linha que o teto grava por janela. Ver `LIMITE_DE_RECUSAS_NA_JANELA`. */
export const EVENTO_TETO_DE_RECUSA = 'plataforma.suporte.teto';
