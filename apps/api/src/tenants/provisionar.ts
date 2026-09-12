import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { ActorType, Prisma, PrismaClient } from '@prisma/client';
import { MODULOS, PERMISSIONS, ROLES, type ModuloKey, type RoleKey } from '@mktos/shared';

import { SemTenantError } from '../common/contexto-execucao';
import { ehModulo, modulosConhecidos } from './modulos';

/*
 * NASCER UMA EMPRESA — RF-T-07.
 *
 * Até aqui o único jeito de existir um tenant era `db:seed`, que apaga leads,
 * eventos e tarefas para recriar dados de exemplo (`prisma/seed.ts`, aviso no
 * commit `fe24ad7`). Ou seja: criar a segunda empresa era comando direto no
 * banco. Este arquivo é a operação que faltava, e a regra dela é uma só —
 * **rodar duas vezes com o mesmo `slug` não duplica nada e não dá erro**.
 *
 * O QUE A EMPRESA NOVA GANHA
 *   1. o registro da `Org`, com os módulos contratados (RF-T-06);
 *   2. o catálogo de permissões (global) e os papéis do produto, com
 *      `admin_master` como PAPEL INICIAL (RF-T-07);
 *   3. a política padrão da ROOT — herdada, não copiada (ver `politicaDoTenant`);
 *   4. o contexto vazio — conferido, não fabricado (ver `contextoDoTenant`);
 *   5. opcionalmente, o primeiro administrador, sem senha utilizável.
 *
 * DOIS MODOS, E A DIFERENÇA É DE SEGURANÇA (ver `ModoDeProvisionamento`)
 * `criar` nunca CONFIGURA empresa que já existe; `reconfigurar` pode. A rota
 * administrativa usa o primeiro, o comando de terminal usa o segundo.
 *
 * POR QUE NÃO É UM MÉTODO DO NEST
 * Porque a suíte precisa chamá-lo, e nada que dependa de injeção do Nest roda
 * sob o vitest (o esbuild não emite `emitDecoratorMetadata`). A casca injetável
 * é `provisionar.service.ts`; aqui mora a operação, que só precisa de um cliente
 * do Prisma. O script de linha de comando roda COMPILADO e passa pela casca, que
 * é o que lhe dá contexto de execução, RASTRO e auditoria.
 *
 * ESTA É UMA OPERAÇÃO DE PLATAFORMA, NÃO DE TENANT
 * Ela nasce olhando para uma empresa que ainda não existe: a primeira consulta
 * (achar a `Org` pelo slug) não tem empresa resolvida e, quando o isolamento por
 * linha estiver ligado, vai precisar de uma conexão que enxergue todos os
 * tenants — o papel DONO, nunca o papel da aplicação (07-MODELO-DE-DADOS §3).
 * Enquanto isso não existe, a consulta falha com nome próprio
 * (`ProvisionamentoSemPlataformaError`) em vez de um `SemTenantError` sem
 * endereço.
 */

/** O papel que a empresa ganha para ter alguém que manda nela desde o dia zero. */
export const PAPEL_INICIAL: RoleKey = 'admin_master';

/**
 * A empresa que opera a PLATAFORMA — a única de onde se cria empresa nova, e a
 * dona do RASTRO de quem MANDOU provisionar.
 *
 * Hoje o sistema não tem papel de plataforma: permissão é por empresa, e um
 * `admin.permissoes` existe dentro de cada tenant. O marcador é o slug `root`,
 * que é o que o resto do código já usa para dizer "a empresa da casa"
 * (`auth/google-login.service.ts`, `integrations/`, `finance/`). Fica NOMEADO
 * aqui, num lugar só, em vez de virar mais uma string solta: quando o console da
 * plataforma existir (RF-B-02), é esta constante que dá lugar ao papel de
 * verdade.
 *
 * NÃO é variável de ambiente de propósito: variável nova precisa entrar em DOIS
 * lugares (o bloco `environment:` do `docker-compose.yml` e o `.env`), e o
 * compose é arquivo de outra fatia — uma variável que não chega ao container
 * seria uma trava que parece configurável e não é.
 */
export const SLUG_DA_PLATAFORMA = 'root';

/**
 * O que a rodada tem licença de MEXER numa empresa que já existe.
 *
 *  · `criar` — o modo da ROTA. Cria empresa que não existe e, na empresa que já
 *    existe, **não configura nada**: administrador, módulos e nome informados
 *    são IGNORADOS e devolvidos em `ignorado`. O que continua valendo é o
 *    conserto do que faltou nascer (catálogo de permissões e papéis do produto),
 *    que não concede acesso a ninguém.
 *
 *  · `reconfigurar` — o modo do COMANDO DE TERMINAL, que exige operador logado
 *    no servidor. Aplica a configuração informada também em empresa que já
 *    existe (é assim que se liga um módulo contratado depois, ou se corrige o
 *    nome).
 *
 * POR QUE A ROTA NÃO GANHA UMA BANDEIRA DE RECONFIGURAÇÃO
 * Porque ela não tem como ser autorizada direito hoje. Escrever dentro de
 * empresa cliente a partir da plataforma é exatamente o que
 * 05-SEGURANCA-OWASP §"o operador da plataforma não enxerga dado de tenant"
 * proíbe: acesso de suporte é autorizado pelo cliente, tem PRAZO e fica
 * registrado — três coisas que o catálogo de permissões de hoje
 * (`packages/shared/src/permissions.ts`) não sabe expressar, porque é por
 * empresa e não por plataforma. Enquanto não houver permissão própria (RF-B-02),
 * a resposta certa da rota é NÃO. Ver o comentário do controller.
 */
export type ModoDeProvisionamento = 'criar' | 'reconfigurar';

/**
 * Slug aceito: minúsculas, dígitos e hífen, começando e terminando em
 * alfanumérico.
 *
 * NÃO normalizamos o que chega. Baixar a caixa em silêncio faria
 * `provisionar --slug Root` devolver a empresa ROOT que já existe, com cara de
 * sucesso — o pior desfecho possível para uma operação cuja promessa é
 * "mesmo identificador, mesmo estado". Recusar obriga quem digitou a ver o que
 * digitou.
 */
const SLUG_VALIDO = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

/** Um e-mail plausível. A conferência de verdade é o login, não uma regex. */
const EMAIL_PLAUSIVEL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type MotivoDeRecusa =
  | 'slug'
  | 'modulo-desconhecido'
  | 'email'
  | 'email-de-outra-empresa';

/** Entrada inválida — é erro de quem chamou, não invariante quebrada. */
export class ProvisionamentoInvalidoError extends Error {
  constructor(
    readonly motivo: MotivoDeRecusa,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ProvisionamentoInvalidoError';
  }
}

/** A consulta de plataforma (achar empresa pelo slug) não tinha por onde rodar. */
export class ProvisionamentoSemPlataformaError extends Error {
  constructor(causa: string) {
    super(
      'provisionar empresa é operação de PLATAFORMA: a busca pelo slug acontece antes de ' +
        'existir empresa resolvida, e nesta configuração ela não roda ' +
        `(${causa}). Rode pelo papel DONO do banco (07-MODELO-DE-DADOS §3) ou fora de TENANT_MODO=impor.`,
    );
    this.name = 'ProvisionamentoSemPlataformaError';
  }
}

/**
 * Duas rodadas simultâneas com o mesmo slug e a perdedora não conseguiu nem
 * reler o que a vencedora escreveu.
 *
 * É o último recurso: a perdedora hoje RELÊ e devolve o retrato (ver a segunda
 * chamada a `umaRodada` em `provisionarTenant`), então este erro só sobra se a
 * corrida se repetir na segunda tentativa — o que, na prática, significa alguém
 * criando e apagando a mesma empresa em laço.
 */
export class ProvisionamentoConcorrenteError extends Error {
  constructor(slug: string) {
    super(
      `a empresa "${slug}" foi criada por outra rodada duas vezes seguidas, no meio desta. ` +
        'Nada foi duplicado (o índice único do slug garantiu); rode de novo para obter o estado final.',
    );
    this.name = 'ProvisionamentoConcorrenteError';
  }
}

/** Sinal interno da corrida pelo slug. Nunca sai de `provisionarTenant`. */
class PerdeuACorrida extends Error {
  constructor(readonly vencedorId: string) {
    super('outra rodada criou a empresa primeiro');
  }
}

export interface EntradaDeProvisionamento {
  /** A identidade da empresa e a CHAVE DA IDEMPOTÊNCIA. */
  slug: string;
  /** Nome de exibição. Ausente na criação = o próprio slug. */
  nome?: string;
  /**
   * Módulos contratados (RF-T-06). Ausente = não decide nada: empresa nova
   * nasce sem nenhum (só a espinha do OS) e empresa que já existe fica como
   * está. Ver `modulosDoTenant`.
   */
  modulos?: readonly string[];
  /** O primeiro administrador. Ausente = a empresa nasce sem ninguém dentro. */
  admin?: { email: string; nome?: string };
  /** Ver `ModoDeProvisionamento`. Ausente = `criar`, que é o modo que não escreve. */
  modo?: ModoDeProvisionamento;
  /**
   * Religar empresa DESATIVADA. Só vale em `reconfigurar`, e só quando pedido:
   * desativar empresa é decisão de contrato, e uma rodada de conferência não
   * pode desfazê-la de raspão.
   */
  reativar?: boolean;
}

/** O que o RASTRO recebe. Um evento ANTES da escrita e um DEPOIS do commit. */
export interface EventoDeProvisionamento {
  orgId: string;
  tipo: 'tenant.provisionamento.iniciado' | 'tenant.provisionado';
  actorType: ActorType;
  actorId: string | null;
  /**
   * Liga a requisição HTTP (ou a rodada do script) ao que aconteceu no banco —
   * RNF-09. Todos os outros chamadores do `EventLogService` passam; este passou
   * a passar depois que um revisor viu o comentário prometendo e o código não
   * entregando.
   */
  correlationId: string | null;
  payload: Record<string, unknown>;
}

/** O que a AUDITORIA recebe. Uma linha por CHAMADA, inclusive as recusadas. */
export interface AuditoriaDeProvisionamento {
  orgId: string;
  action:
    | 'tenant.provisionar.criado'
    | 'tenant.provisionar.reconfigurado'
    | 'tenant.provisionar.sem-mudanca'
    | 'tenant.provisionar.recusado';
  entityId: string | null;
  metadata: Record<string, unknown>;
}

export interface OpcoesDeProvisionamento {
  /**
   * Abre o contexto de execução da empresa em volta do trabalho de banco.
   *
   * Existe porque a sessão do banco lê a empresa do contexto para declará-la à
   * conexão (`prisma/sessao-de-banco.ts`): sem isto, TODA escrita do
   * provisionamento sairia sem empresa — avisada em `observar`, recusada em
   * `impor`. O identificador já é conhecido quando esta função é chamada,
   * porque ele é gerado aqui e não pelo banco.
   */
  emContexto?: <T>(orgId: string, fn: () => Promise<T>) => Promise<T>;
  /** Onde o nascimento da empresa é registrado. Ausente = nasce sem RASTRO. */
  rastro?: (evento: EventoDeProvisionamento) => Promise<unknown>;
  /** Onde toda CHAMADA é registrada. Ausente = a chamada não é auditada. */
  auditar?: (linha: AuditoriaDeProvisionamento) => Promise<unknown>;
  /** Quem mandou provisionar. Vai para o RASTRO, não para o banco da empresa. */
  responsavel?: { tipo: ActorType; id?: string | null };
  /**
   * A empresa que MANDOU provisionar — normalmente a plataforma.
   *
   * É onde mora o evento de INTENÇÃO, e o motivo é do banco: `EventLog.orgId`
   * tem chave estrangeira para `Org`, então um evento da empresa que ainda não
   * existe não tem onde ser gravado. O ato de mandar provisionar é da
   * plataforma de qualquer forma; o nascimento é que é da empresa nova.
   *
   * Ausente (banco novo, primeira empresa do mundo) = a intenção fica sem casa,
   * e o resultado DIZ isso em `avisos` em vez de fingir que registrou.
   */
  ordenante?: string | null;
  /** Correlação a carimbar nos eventos. Ausente = o evento sai sem ela. */
  correlacao?: string | null;
}

export type CodigoDeAviso =
  | 'empresa-desativada'
  | 'configuracao-ignorada'
  | 'papel-incompleto'
  | 'papel-inicial-sem-ninguem'
  | 'papeis-alem-do-catalogo'
  | 'rastro-sem-ordenante'
  | 'rastro-da-conclusao-falhou';

/** O que o retrato precisa DENUNCIAR, mesmo quando nada mudou. */
export interface AvisoDeProvisionamento {
  codigo: CodigoDeAviso;
  texto: string;
}

export interface PapelIncompleto {
  key: string;
  tem: number;
  esperado: number;
  faltando: string[];
}

export interface Provisionamento {
  orgId: string;
  slug: string;
  /** A `Org` nasceu NESTA rodada. Na segunda rodada é sempre `false`. */
  criada: boolean;
  nome: string;
  /** `Org.isActive`. Empresa desligada não pode passar por "nada mudou". */
  ativa: boolean;
  modo: ModoDeProvisionamento;
  modulos: ModuloKey[];
  modulosAlterados: boolean;
  /**
   * O que foi informado e NÃO aplicado porque a empresa já existia e o modo é
   * `criar`. Lista vazia é o caso normal.
   */
  ignorado: Array<'admin' | 'modulos' | 'nome' | 'reativar'>;
  papelInicial: {
    key: RoleKey;
    id: string;
    criado: boolean;
    /** CONFERIDO, nunca corrigido: papel que já existe não é reescrito. */
    permissoes: number;
    esperadas: number;
    /** Quantas pessoas carregam o papel. Zero = empresa sem dono. */
    usuarios: number;
  };
  papeis: {
    criados: string[];
    jaExistiam: string[];
    /** Total de papéis da empresa, para comparar com o catálogo do produto. */
    total: number;
    /** Chaves que não estão em `ROLES` — papel renomeado ou feito à mão. */
    foraDoCatalogo: string[];
    /** Papéis que existem com menos permissão do que o catálogo manda. */
    incompletos: PapelIncompleto[];
  };
  permissoes: { criadas: number; catalogo: number };
  admin?: { email: string; userId: string; criado: boolean; papelVinculado: boolean };
  politica: {
    /** `base-root` = há versão base no banco. `empacotada` = só a do build. */
    heranca: 'base-root' | 'empacotada';
    versaoBase: number | null;
    /** Versão própria da empresa, quando ela já sobrescreveu algo (fatia 2.1). */
    sobrescritaPropria: number | null;
  };
  contexto: { notas: number; vazio: boolean };
  /** Alguma linha mudou. `false` é o desfecho esperado da segunda rodada. */
  mudou: boolean;
  /** O que o retrato denuncia. Vazio é o desfecho saudável. */
  avisos: AvisoDeProvisionamento[];
  rastro: {
    /** Sequência do evento de INTENÇÃO, na empresa que mandou provisionar. */
    intencao: string | null;
    /** Sequência do evento de NASCIMENTO, na empresa nova. */
    conclusao: string | null;
    /** Preenchido quando o registro de conclusão falhou — nada some em silêncio. */
    falhaNaConclusao: string | null;
  };
}

function exigirSlug(bruto: string): string {
  const slug = (bruto ?? '').trim();
  if (!SLUG_VALIDO.test(slug)) {
    throw new ProvisionamentoInvalidoError(
      'slug',
      `slug "${bruto}" inválido: use minúsculas, dígitos e hífen (2 a 40 caracteres), ` +
        'começando e terminando em letra ou dígito. Não normalizamos por conta própria — ' +
        'um slug "corrigido" em silêncio pode apontar para outra empresa.',
    );
  }
  return slug;
}

/**
 * Os módulos que vão para o banco.
 *
 * Chave desconhecida RECUSA a operação inteira, e isso é decisão: o
 * `ModulosService` já descarta lixo na leitura (e avisa no log), então gravar
 * `'finaceiro'` não abriria porta nenhuma — só produziria uma empresa que jura
 * ter contratado um módulo que não existe, e um chamado de suporte semanas
 * depois. A hora de reclamar é a da escrita.
 */
function exigirModulos(brutos: readonly string[]): ModuloKey[] {
  const desconhecidos = brutos.filter((m) => !ehModulo(m));
  if (desconhecidos.length) {
    throw new ProvisionamentoInvalidoError(
      'modulo-desconhecido',
      `módulo(s) que não existem: ${desconhecidos.join(', ')}. ` +
        `Os válidos são: ${MODULOS.join(', ')}.`,
    );
  }
  return modulosConhecidos(brutos);
}

function exigirEmail(bruto: string): string {
  const email = (bruto ?? '').trim().toLowerCase();
  if (!EMAIL_PLAUSIVEL.test(email)) {
    throw new ProvisionamentoInvalidoError('email', `e-mail "${bruto}" não parece um e-mail.`);
  }
  return email;
}

/**
 * A empresa que já existe com este slug, ou `null`.
 *
 * Esta é a única consulta do provisionamento que roda ANTES de haver empresa
 * resolvida — e é por isso que ela traduz o `SemTenantError` num erro com nome:
 * quem lê "tenant não resolvido em Org.findUnique" não tem como adivinhar que o
 * que falta é uma conexão de plataforma.
 */
async function acharOrg(prisma: PrismaClient, slug: string) {
  try {
    return await prisma.org.findUnique({
      where: { slug },
      select: { id: true, name: true, modulos: true, isActive: true },
    });
  } catch (e) {
    if (e instanceof SemTenantError) throw new ProvisionamentoSemPlataformaError(e.message);
    throw e;
  }
}

type OrgExistente = Awaited<ReturnType<typeof acharOrg>>;

/**
 * O que fazer com `Org.modulos`.
 *
 * Duas regras, e as duas são sobre não estragar o que já está de pé:
 *
 *  · EMPRESA NOVA sem lista informada nasce com NENHUM módulo. É o que o campo
 *    já documenta ("vazio significa só a espinha do OS") e o que a escada
 *    comercial pede: o cliente liga o que contratou, não desliga o que não
 *    contratou.
 *
 *  · EMPRESA QUE JÁ EXISTE e rodada sem lista informada NÃO É TOCADA. Este é o
 *    coração da idempotência: se a segunda rodada aplicasse o padrão, ela
 *    DESLIGARIA todo módulo que alguém tivesse ligado depois da primeira — e
 *    "rodar de novo para conferir" passaria a ser uma operação destrutiva.
 *    Lista informada é intenção declarada e vale, inclusive para desligar —
 *    mas só no modo `reconfigurar`.
 */
function modulosDoTenant(
  informados: ModuloKey[] | undefined,
  atuais: string[] | undefined,
): { valor: ModuloKey[]; alterados: boolean } {
  const jaGravados = modulosConhecidos(atuais ?? []);
  if (!informados) return { valor: jaGravados, alterados: false };
  const igual =
    informados.length === jaGravados.length && informados.every((m, i) => m === jaGravados[i]);
  return { valor: informados, alterados: !igual };
}

/**
 * Quanto do catálogo de permissões faltava no banco.
 *
 * `Permission` é catálogo GLOBAL (uma linha por chave, compartilhada por todas
 * as empresas — `src/common/modelos-globais.ts`), então isto não é dado do
 * tenant: é garantir que o papel inicial tenha o que apontar. `createMany` com
 * `skipDuplicates` em vez de 35 `upsert`: uma viagem, e duas rodadas
 * simultâneas não brigam pelo índice único.
 */
async function garantirPermissoes(tx: Prisma.TransactionClient): Promise<{
  criadas: number;
  porChave: Map<string, string>;
}> {
  const existentes = await tx.permission.findMany({ select: { id: true, key: true } });
  const conhecidas = new Set(existentes.map((p) => p.key));
  const faltando = PERMISSIONS.filter((k) => !conhecidas.has(k));

  if (faltando.length) {
    await tx.permission.createMany({
      data: faltando.map((key) => ({ key })),
      skipDuplicates: true,
    });
  }

  const todas = faltando.length
    ? await tx.permission.findMany({ select: { id: true, key: true } })
    : existentes;
  return { criadas: faltando.length, porChave: new Map(todas.map((p) => [p.key, p.id])) };
}

/** A forma como os papéis da empresa estão HOJE. Só leitura, em todo lugar. */
type PapelNoBanco = { id: string; key: string; permissions: { key: string }[] };

async function lerPapeis(
  tx: Prisma.TransactionClient,
  orgId: string,
): Promise<PapelNoBanco[]> {
  return tx.role.findMany({
    where: { orgId },
    select: { id: true, key: true, permissions: { select: { key: true } } },
  });
}

/**
 * Os papéis do produto na empresa nova.
 *
 * CRIA O QUE FALTA E NÃO ENCOSTA NO QUE EXISTE. `prisma/sync-permissions.ts`
 * faz o contrário — realinha os vínculos com `set` — e é a ferramenta certa
 * para isso; aqui seria errado: a segunda rodada do provisionamento desfaria
 * qualquer ajuste que a empresa tenha feito nos próprios papéis, e uma operação
 * que se anuncia como "roda de novo sem medo" não pode ter esse efeito.
 *
 * MAS O QUE NÃO É ESCRITO É CONFERIDO. Não escrever no papel que já existe é
 * defensável; devolver "nada mudou" sobre um `admin_master` com zero de trinta
 * e cinco permissões não é. A conferência sai em `incompletos` e vira aviso no
 * retrato — quem decide corrigir chama `db:sync-permissions`, que é a
 * ferramenta que existe para isso.
 *
 * POR QUE TODOS OS PAPÉIS E NÃO SÓ O INICIAL. O RF-T-07 pede "o papel inicial",
 * e ele é o `admin_master` — mas os nove papéis de `ROLES` são o catálogo do
 * produto, iguais em toda empresa, e é o que `db:sync-permissions` cria para
 * todas na próxima manutenção. Nascer com menos significaria ganhar papéis
 * depois sem ninguém ter decidido nada.
 */
async function garantirPapeis(
  tx: Prisma.TransactionClient,
  orgId: string,
  permPorChave: Map<string, string>,
): Promise<{
  criados: string[];
  jaExistiam: string[];
  total: number;
  foraDoCatalogo: string[];
  incompletos: PapelIncompleto[];
  inicial: { key: RoleKey; id: string; criado: boolean; permissoes: number; esperadas: number };
}> {
  const existentes = await lerPapeis(tx, orgId);
  const porChave = new Map(existentes.map((r) => [r.key, r.id]));
  const permissoesPorChave = new Map(
    existentes.map((r) => [r.key, new Set(r.permissions.map((p) => p.key))]),
  );

  const criados: string[] = [];
  const jaExistiam: string[] = [];

  for (const [key, def] of Object.entries(ROLES)) {
    if (porChave.has(key)) {
      jaExistiam.push(key);
      continue;
    }
    const ids = def.permissions
      .map((k) => permPorChave.get(k))
      .filter((id): id is string => typeof id === 'string')
      .map((id) => ({ id }));
    const criado = await tx.role.create({
      data: { orgId, key, name: def.name, permissions: { connect: ids } },
      select: { id: true },
    });
    porChave.set(key, criado.id);
    permissoesPorChave.set(key, new Set(def.permissions));
    criados.push(key);
  }

  const idInicial = porChave.get(PAPEL_INICIAL);
  if (!idInicial) {
    // Invariante: `PAPEL_INICIAL` é chave de `ROLES` e o laço acima cobre todas.
    throw new Error(`papel inicial "${PAPEL_INICIAL}" não foi criado — catálogo de papéis mudou?`);
  }

  /*
   * A conferência do que já existia. Roda sobre o estado FINAL (o que foi criado
   * agora nasce completo por construção), e é a única coisa que este bloco faz
   * com papel alheio: ler.
   */
  const incompletos: PapelIncompleto[] = [];
  for (const [key, def] of Object.entries(ROLES)) {
    const tem = permissoesPorChave.get(key) ?? new Set<string>();
    const faltando = def.permissions.filter((p) => !tem.has(p));
    if (faltando.length) {
      incompletos.push({ key, tem: tem.size, esperado: def.permissions.length, faltando });
    }
  }

  const chavesDoCatalogo = new Set(Object.keys(ROLES));
  const foraDoCatalogo = [...porChave.keys()].filter((k) => !chavesDoCatalogo.has(k)).sort();
  const permissoesDoInicial = permissoesPorChave.get(PAPEL_INICIAL)?.size ?? 0;

  return {
    criados,
    jaExistiam,
    total: porChave.size,
    foraDoCatalogo,
    incompletos,
    inicial: {
      key: PAPEL_INICIAL,
      id: idInicial,
      criado: criados.includes(PAPEL_INICIAL),
      permissoes: permissoesDoInicial,
      esperadas: ROLES[PAPEL_INICIAL].permissions.length,
    },
  };
}

/**
 * O primeiro administrador, quando pedido.
 *
 * SENHA INUTILIZÁVEL, sempre: o hash é de 32 bytes aleatórios que ninguém
 * guarda, imprime ou devolve. A entrada é pelo login com a conta Google, que já
 * exige usuário pré-existente e é o mesmo caminho que
 * `auth/google-login.service.ts` usa para provisionar gente. Assim nenhuma
 * senha trafega na resposta de uma rota administrativa, e não há segredo para
 * vazar em log.
 *
 * `User.email` é único GLOBAL (e não por empresa — limitação conhecida, com
 * teste próprio na suíte de isolamento). Um e-mail que já é de outra empresa
 * RECUSA a operação: movê-lo daria acesso da empresa antiga à nova por engano.
 *
 * QUEM CHEGA AQUI. Só o modo `reconfigurar` e a criação de empresa nova. Plantar
 * administrador dentro de empresa que já existe é escalada de privilégio, não
 * provisionamento — ver `ModoDeProvisionamento`.
 */
async function garantirAdmin(
  tx: Prisma.TransactionClient,
  orgId: string,
  email: string,
  nome: string,
  papelInicialId: string,
  hashInutilizavel: string,
): Promise<{ email: string; userId: string; criado: boolean; papelVinculado: boolean }> {
  const existente = await tx.user.findUnique({
    where: { email },
    select: { id: true, orgId: true, roles: { select: { id: true } } },
  });

  if (existente && existente.orgId !== orgId) {
    throw new ProvisionamentoInvalidoError(
      'email-de-outra-empresa',
      `o e-mail ${email} já pertence a outra empresa. E-mail é único no sistema inteiro: ` +
        'use outro, ou mova a pessoa pela tela de usuários da empresa de origem.',
    );
  }

  if (existente) {
    const temPapel = existente.roles.some((r) => r.id === papelInicialId);
    if (!temPapel) {
      await tx.user.update({
        where: { id: existente.id },
        data: { roles: { connect: { id: papelInicialId } } },
      });
    }
    return { email, userId: existente.id, criado: false, papelVinculado: !temPapel };
  }

  const criado = await tx.user.create({
    data: {
      orgId,
      email,
      name: nome,
      passwordHash: hashInutilizavel,
      roles: { connect: { id: papelInicialId } },
    },
    select: { id: true },
  });
  return { email, userId: criado.id, criado: true, papelVinculado: true };
}

/**
 * A política que a empresa nova passa a obedecer.
 *
 * ELA HERDA A BASE DA ROOT — E HERDAR É NÃO TER VERSÃO PRÓPRIA. O
 * `PolicyService` resolve capacidade na versão da empresa e, não achando,
 * na base (`orgId: null`); `db:seed:politica` mantém essa base em dia. Copiar o
 * documento resolvido para uma `PolicyVersion` da empresa pareceria mais
 * explícito e seria uma armadilha: a cópia CONGELA. Capacidade nova, nível
 * subido, sinal novo — nada disso chegaria à empresa, e cada tenant
 * provisionado ficaria preso à régua do dia em que nasceu, em silêncio. A
 * sobrescrita por tenant existe para o que a operação dele exigir (RF-P-04) e é
 * assunto da fatia 2.1, com data, responsável e diff.
 *
 * Sem base no banco não recusamos o provisionamento: o `PolicyService` cai na
 * base EMPACOTADA no build, então a empresa nasce com régua de qualquer jeito.
 * Mas o desfecho vai no resultado, porque a diferença importa no dia em que
 * alguém perguntar por que a produção decide diferente do repositório.
 */
async function politicaDoTenant(
  tx: Prisma.TransactionClient,
  orgId: string,
): Promise<Provisionamento['politica']> {
  const base = await tx.policyVersion.findFirst({
    where: { orgId: null, ativaAte: null },
    orderBy: { versao: 'desc' },
    select: { versao: true },
  });
  const propria = await tx.policyVersion.findFirst({
    where: { orgId, ativaAte: null },
    orderBy: { versao: 'desc' },
    select: { versao: true },
  });
  return {
    heranca: base ? 'base-root' : 'empacotada',
    versaoBase: base?.versao ?? null,
    sobrescritaPropria: propria?.versao ?? null,
  };
}

/**
 * O contexto vazio (RF-T-07) — CONFERIDO, não fabricado.
 *
 * A MEMÓRIA de hoje é `KnowledgeNote`, e ela é um espelho: `ObsidianService`
 * reindexa com `deleteMany({ where: { orgId } })` e recria a partir do vault.
 * Qualquer nota "de partida" que o provisionamento escrevesse sumiria na
 * primeira sincronização, e o estado provisionado passaria a mentir. Por isso o
 * contexto vazio aqui é um FATO CONFERIDO — a empresa nova não herda memória de
 * ninguém — e o marco fica no RASTRO, que é onde histórico de empresa mora.
 *
 * Quando a MEMÓRIA ganhar tabela própria (`ContextItem`, 07-MODELO-DE-DADOS §2)
 * é aqui que o esqueleto — regra, dicionário, decisão — passa a ser semeado.
 */
async function contextoDoTenant(
  tx: Prisma.TransactionClient,
  orgId: string,
): Promise<Provisionamento['contexto']> {
  const notas = await tx.knowledgeNote.count({ where: { orgId } });
  return { notas, vazio: notas === 0 };
}

/**
 * O que esta rodada PRETENDE escrever — só leitura, antes de qualquer escrita.
 *
 * Existe por dois motivos, e os dois são do enunciado:
 *
 *  1. o evento de INTENÇÃO precisa dizer o que vai acontecer, e precisa sair
 *     ANTES; sem o plano ele seria um evento vazio;
 *  2. rodada de conferência (empresa existe, nada declarado, nada faltando) não
 *     pode sujar a cadeia do RASTRO com um evento por execução. Ela é auditada,
 *     que é onde "quem rodou e não mudou nada" deve aparecer.
 */
interface PlanoDeEscrita {
  criaEmpresa: boolean;
  mudaNome: boolean;
  mudaModulos: boolean;
  reativa: boolean;
  mexeNoAdmin: boolean;
  papeisFaltando: string[];
  permissoesFaltando: number;
  escreve: boolean;
}

async function planejar(
  prisma: PrismaClient,
  dados: {
    jaExistia: OrgExistente;
    orgId: string;
    nome: string;
    modulos: { valor: ModuloKey[]; alterados: boolean };
    emailAdmin: string | undefined;
    reativar: boolean;
  },
): Promise<PlanoDeEscrita> {
  const { jaExistia, orgId, nome, modulos, emailAdmin, reativar } = dados;

  const papeisAtuais = jaExistia ? await prisma.role.findMany({ where: { orgId }, select: { key: true } }) : [];
  const temPapel = new Set(papeisAtuais.map((r) => r.key));
  const papeisFaltando = Object.keys(ROLES).filter((k) => !temPapel.has(k));

  const permissoesAtuais = await prisma.permission.count({ where: { key: { in: [...PERMISSIONS] } } });
  const permissoesFaltando = PERMISSIONS.length - permissoesAtuais;

  /*
   * O administrador só entra no plano quando ele MUDARIA alguma coisa. Ler pela
   * chave do papel (e não pelo id, que ainda não existe em empresa nova) é o que
   * permite decidir isto sem escrever nada.
   */
  let mexeNoAdmin = false;
  if (emailAdmin) {
    const atual = await prisma.user.findUnique({
      where: { email: emailAdmin },
      select: { orgId: true, roles: { select: { key: true } } },
    });
    mexeNoAdmin = !(
      atual &&
      atual.orgId === orgId &&
      atual.roles.some((r) => r.key === PAPEL_INICIAL)
    );
  }

  const criaEmpresa = !jaExistia;
  const mudaNome = Boolean(jaExistia) && nome !== jaExistia?.name;
  const reativa = reativar && jaExistia?.isActive === false;

  return {
    criaEmpresa,
    mudaNome,
    mudaModulos: modulos.alterados,
    reativa,
    mexeNoAdmin,
    papeisFaltando,
    permissoesFaltando,
    escreve:
      criaEmpresa ||
      mudaNome ||
      modulos.alterados ||
      reativa ||
      mexeNoAdmin ||
      papeisFaltando.length > 0 ||
      permissoesFaltando > 0,
  };
}

/** Os avisos que o retrato precisa carregar mesmo quando `mudou` é `false`. */
function avisosDoRetrato(r: {
  ativa: boolean;
  slug: string;
  ignorado: Provisionamento['ignorado'];
  papelInicial: Provisionamento['papelInicial'];
  papeis: Provisionamento['papeis'];
  modo: ModoDeProvisionamento;
}): AvisoDeProvisionamento[] {
  const avisos: AvisoDeProvisionamento[] = [];

  if (!r.ativa) {
    avisos.push({
      codigo: 'empresa-desativada',
      texto:
        `a empresa "${r.slug}" está DESATIVADA (isActive=false). Ela não foi religada por esta ` +
        'rodada: reativar é decisão de contrato e exige `--reativar` no comando de terminal.',
    });
  }

  if (r.ignorado.length) {
    avisos.push({
      codigo: 'configuracao-ignorada',
      texto:
        `a empresa já existia e o modo é "${r.modo}": ${r.ignorado.join(', ')} ` +
        'NÃO foi aplicado. A rota não configura empresa que já existe — quem precisa ' +
        'reconfigurar usa o comando de terminal, no servidor.',
    });
  }

  if (r.papelInicial.permissoes < r.papelInicial.esperadas) {
    avisos.push({
      codigo: 'papel-incompleto',
      texto:
        `o papel inicial "${r.papelInicial.key}" tem ${r.papelInicial.permissoes} de ` +
        `${r.papelInicial.esperadas} permissões. Papel que já existe NÃO é reescrito aqui; ` +
        'corrija com `pnpm --filter @mktos/api db:sync-permissions`.',
    });
  }

  const outros = r.papeis.incompletos.filter((p) => p.key !== r.papelInicial.key);
  if (outros.length) {
    avisos.push({
      codigo: 'papel-incompleto',
      texto:
        `papéis com menos permissão do que o catálogo manda: ${outros
          .map((p) => `${p.key} (${p.tem}/${p.esperado})`)
          .join(', ')}. Não foram reescritos — ver \`db:sync-permissions\`.`,
    });
  }

  if (r.papelInicial.usuarios === 0) {
    avisos.push({
      codigo: 'papel-inicial-sem-ninguem',
      texto:
        `ninguém carrega o papel "${r.papelInicial.key}": a empresa está SEM DONO. ` +
        'Informe um administrador ou vincule alguém pela tela de usuários da empresa.',
    });
  }

  const catalogo = Object.keys(ROLES).length;
  if (r.papeis.total > catalogo) {
    avisos.push({
      codigo: 'papeis-alem-do-catalogo',
      texto:
        `a empresa tem ${r.papeis.total} papéis e o catálogo do produto tem ${catalogo}. ` +
        (r.papeis.foraDoCatalogo.length
          ? `Fora do catálogo: ${r.papeis.foraDoCatalogo.join(', ')}. `
          : '') +
        'Papel do produto renomeado faz a rodada seguinte CRIAR outro com a chave original — ' +
        'dois administradores na mesma empresa. Confira antes de seguir.',
    });
  }

  return avisos;
}

/**
 * Cria (ou reconhece) a empresa e tudo que ela precisa para existir.
 *
 * Idempotente pelo `slug`: a segunda rodada devolve `mudou: false` e não escreve
 * uma linha. Devolve o retrato do que encontrou e do que fez — é esse retrato
 * que o script imprime, a rota devolve e o teste compara entre as duas rodadas.
 *
 * A ORDEM DAS COISAS, que é o desenho e não detalhe:
 *   1. valida a entrada (recusa não chega a tocar no banco);
 *   2. lê o estado e monta o PLANO — só leitura;
 *   3. registra a INTENÇÃO no RASTRO, quando o plano escreve. Registro que falha
 *      ABORTA a operação: 02-CONSTRAINTS §5, "o registro é pré-condição, não
 *      relatório";
 *   4. escreve tudo numa transação só;
 *   5. registra o NASCIMENTO na empresa nova, depois do commit;
 *   6. audita a chamada — sempre, inclusive quando ela foi recusada.
 */
export async function provisionarTenant(
  prisma: PrismaClient,
  entrada: EntradaDeProvisionamento,
  opcoes: OpcoesDeProvisionamento = {},
): Promise<Provisionamento> {
  /*
   * A RODADA PERDEDORA RELÊ EM VEZ DE ERRAR.
   *
   * O enunciado pede "sem erro", e a corrida pelo slug é justamente o caso em
   * que nada deu errado: a empresa existe, completa, criada pela vencedora. A
   * transação da perdedora já voltou inteira (nada pela metade), então refazer é
   * seguro. E refazer a RODADA — não só a transação — é o que importa: na
   * segunda passada a empresa já existe, o modo `criar` congela a configuração
   * como congelaria para qualquer outra empresa alheia, e o que sai é o retrato.
   */
  try {
    return await umaRodada(prisma, entrada, opcoes);
  } catch (e) {
    if (!(e instanceof PerdeuACorrida)) throw e;
  }
  try {
    return await umaRodada(prisma, entrada, opcoes);
  } catch (e) {
    if (e instanceof PerdeuACorrida) throw new ProvisionamentoConcorrenteError(entrada.slug);
    throw e;
  }
}

async function umaRodada(
  prisma: PrismaClient,
  entrada: EntradaDeProvisionamento,
  opcoes: OpcoesDeProvisionamento,
): Promise<Provisionamento> {
  const modo: ModoDeProvisionamento = entrada.modo ?? 'criar';
  const slugBruto = (entrada.slug ?? '').trim();

  /**
   * Audita e re-lança. Toda saída por erro desta função passa por aqui.
   *
   * `PerdeuACorrida` não é recusa: é o sinal de que a rodada vai ser refeita e
   * provavelmente terminar bem. Auditá-lo encheria a trilha de falsos negativos.
   */
  const recusar = async (e: unknown, orgId: string | null, extra: Record<string, unknown> = {}) => {
    const erro = e as Error;
    if (opcoes.auditar && orgId && !(e instanceof PerdeuACorrida)) {
      await opcoes
        .auditar({
          orgId,
          action: 'tenant.provisionar.recusado',
          entityId: null,
          metadata: {
            slug: slugBruto,
            modo,
            erro: erro.name,
            motivo: (e as ProvisionamentoInvalidoError).motivo ?? null,
            mensagem: erro.message,
            ...extra,
          },
        })
        .catch(() => undefined);
    }
    throw e;
  };

  const validado = await (async () => {
    try {
      return {
        slug: exigirSlug(entrada.slug),
        modulos: entrada.modulos ? exigirModulos(entrada.modulos) : undefined,
        email: entrada.admin ? exigirEmail(entrada.admin.email) : undefined,
      };
    } catch (e) {
      return recusar(e, opcoes.ordenante ?? null);
    }
  })();
  const slug = validado.slug;
  const modulosPedidos = validado.modulos;
  const emailAdmin = validado.email;
  const nomeAdmin = entrada.admin?.nome?.trim() || emailAdmin?.split('@')[0] || '';

  const jaExistia: OrgExistente = await acharOrg(prisma, slug).catch((e) =>
    recusar(e, opcoes.ordenante ?? null),
  );
  const orgId = jaExistia?.id ?? randomUUID();

  /*
   * A TRAVA DA ESCALADA DE PRIVILÉGIO.
   *
   * Empresa que já existe + modo `criar` = nenhuma configuração é aplicada. Sem
   * isto, quem pode chamar a rota planta um administrador dentro de qualquer
   * empresa cliente (o usuário plantado entra pelo login com Google, que não
   * passa por lista de permissão quando o usuário já existe) e ainda zera os
   * módulos dela — dois passos, sem autorização do cliente, sem prazo e sem
   * aprovação. É o oposto do que 05-SEGURANCA-OWASP exige do operador de
   * plataforma, e abre justamente o que a rota de criação de usuário fecha,
   * porque aquela é escopada à empresa de quem chama.
   *
   * Também é armadilha operacional: slug digitado errado desligaria os módulos
   * de um cliente em produção.
   */
  const congelado = Boolean(jaExistia) && modo === 'criar';
  const ignorado: Provisionamento['ignorado'] = [];
  if (congelado) {
    if (entrada.admin) ignorado.push('admin');
    if (entrada.modulos) ignorado.push('modulos');
    if (entrada.nome?.trim() && entrada.nome.trim() !== jaExistia?.name) ignorado.push('nome');
    if (entrada.reativar) ignorado.push('reativar');
  }
  const modulosEfetivos = congelado ? undefined : modulosPedidos;
  const emailEfetivo = congelado ? undefined : emailAdmin;
  const nomeEfetivo = congelado
    ? (jaExistia?.name ?? slug)
    : entrada.nome?.trim() || jaExistia?.name || slug;
  const reativarEfetivo = !congelado && modo === 'reconfigurar' && Boolean(entrada.reativar);

  /*
   * O hash sai da transação de propósito: bcrypt custa ~100ms de CPU e seguraria
   * a conexão o tempo todo. Custa uma volta desperdiçada quando o usuário já
   * existe — troca barata por não alongar transação que escreve.
   */
  const hashInutilizavel = emailEfetivo
    ? await bcrypt.hash(randomBytes(32).toString('hex'), 10)
    : '';

  const dentroDoContexto = opcoes.emContexto ?? (<T>(_: string, fn: () => Promise<T>) => fn());
  const avisos: AvisoDeProvisionamento[] = [];
  const rastro: Provisionamento['rastro'] = {
    intencao: null,
    conclusao: null,
    falhaNaConclusao: null,
  };

  try {
    const resultado = await dentroDoContexto(orgId, async (): Promise<Provisionamento> => {
      const modulos = modulosDoTenant(modulosEfetivos, jaExistia?.modulos);
      const plano = await planejar(prisma, {
        jaExistia,
        orgId,
        nome: nomeEfetivo,
        modulos,
        emailAdmin: emailEfetivo,
        reativar: reativarEfetivo,
      });

      /*
       * A INTENÇÃO, ANTES DA ESCRITA — 02-CONSTRAINTS §5.
       *
       * Mora na empresa que MANDOU provisionar porque `EventLog.orgId` tem chave
       * estrangeira para `Org`: evento de empresa que ainda não existe não tem
       * onde ser gravado. Se este registro falhar, nada é escrito e o chamador
       * recebe o erro do registrador — que é o desfecho certo, e o oposto do que
       * acontecia quando o RASTRO saía só depois do commit (empresa criada, zero
       * eventos, erro na mão de quem chamou).
       */
      if (plano.escreve && opcoes.rastro) {
        if (opcoes.ordenante) {
          const registrado = (await opcoes.rastro({
            orgId: opcoes.ordenante,
            tipo: 'tenant.provisionamento.iniciado',
            actorType: opcoes.responsavel?.tipo ?? 'system',
            actorId: opcoes.responsavel?.id ?? null,
            correlationId: opcoes.correlacao ?? null,
            payload: {
              slug,
              orgId,
              modo,
              criaEmpresa: plano.criaEmpresa,
              mudaNome: plano.mudaNome,
              mudaModulos: plano.mudaModulos,
              reativa: plano.reativa,
              mexeNoAdmin: plano.mexeNoAdmin,
              papeisFaltando: plano.papeisFaltando,
              permissoesFaltando: plano.permissoesFaltando,
              ignorado,
            },
          })) as { seq?: bigint } | undefined;
          if (registrado?.seq !== undefined) rastro.intencao = String(registrado.seq);
        } else {
          avisos.push({
            codigo: 'rastro-sem-ordenante',
            texto:
              'esta rodada VAI ESCREVER e não há empresa onde registrar a intenção ' +
              '(EventLog.orgId aponta para Org, e a empresa que manda provisionar não foi ' +
              'informada ou não existe). É o caso do banco recém-criado, na primeira empresa ' +
              'do mundo. O nascimento em si continua registrado na empresa nova.',
          });
        }
      }

      return prisma.$transaction(
        async (tx) => {
          /*
           * TUDO NUMA TRANSAÇÃO SÓ: empresa pela metade é pior que empresa
           * nenhuma — o slug fica ocupado, o papel inicial não existe e a
           * rodada seguinte encontra um estado que ninguém desenhou.
           *
           * O teto de 20s é generoso de propósito. São ~15 comandos (nove
           * papéis, cada um com os vínculos de permissão) e o padrão do
           * Prisma são 5s: num banco remoto, com a sessão declarando a
           * empresa a cada consulta (três viagens extras por comando, ver
           * `prisma/sessao-de-banco.ts`), 5s é apertado. É uma operação de
           * algumas vezes por ano, não um caminho quente.
           */
          const org = await tx.org.upsert({
            where: { slug },
            create: { id: orgId, name: nomeEfetivo, slug, modulos: modulos.valor },
            /*
             * `upsert` e não `create`, mesmo já sabendo se existe: entre a
             * leitura e esta linha cabe outra rodada. Quem perde a corrida
             * ATUALIZA em vez de estourar o índice único — e a comparação de
             * id logo abaixo é o que impede a rodada perdedora de seguir com
             * o contexto da empresa errada.
             */
            update: {
              ...(plano.mudaNome ? { name: nomeEfetivo } : {}),
              ...(modulos.alterados ? { modulos: modulos.valor } : {}),
              ...(plano.reativa ? { isActive: true } : {}),
            },
            select: { id: true, name: true, modulos: true, isActive: true },
          });
          if (org.id !== orgId) throw new PerdeuACorrida(org.id);

          const permissoes = await garantirPermissoes(tx);
          const papeis = await garantirPapeis(tx, orgId, permissoes.porChave);
          const admin = emailEfetivo
            ? await garantirAdmin(
                tx,
                orgId,
                emailEfetivo,
                nomeAdmin,
                papeis.inicial.id,
                hashInutilizavel,
              )
            : undefined;
          const donos = await tx.user.count({
            where: { orgId, roles: { some: { id: papeis.inicial.id } } },
          });
          const politica = await politicaDoTenant(tx, orgId);
          const contexto = await contextoDoTenant(tx, orgId);

          const criada = !jaExistia;
          const mudou =
            criada ||
            modulos.alterados ||
            plano.mudaNome ||
            plano.reativa ||
            permissoes.criadas > 0 ||
            papeis.criados.length > 0 ||
            Boolean(admin?.criado) ||
            Boolean(admin?.papelVinculado);

          const papelInicial = { ...papeis.inicial, usuarios: donos };
          const retrato: Provisionamento = {
            orgId,
            slug,
            criada,
            nome: org.name,
            ativa: org.isActive,
            modo,
            modulos: modulosConhecidos(org.modulos),
            modulosAlterados: modulos.alterados,
            ignorado,
            papelInicial,
            papeis: {
              criados: papeis.criados,
              jaExistiam: papeis.jaExistiam,
              total: papeis.total,
              foraDoCatalogo: papeis.foraDoCatalogo,
              incompletos: papeis.incompletos,
            },
            permissoes: { criadas: permissoes.criadas, catalogo: PERMISSIONS.length },
            admin,
            politica,
            contexto,
            mudou,
            avisos: [],
            rastro,
          };
          retrato.avisos = [
            ...avisos,
            ...avisosDoRetrato({
              ativa: retrato.ativa,
              slug,
              ignorado,
              papelInicial,
              papeis: retrato.papeis,
              modo,
            }),
          ];
          return retrato;
        },
        { maxWait: 10_000, timeout: 20_000 },
      );
    });

    /*
     * O NASCIMENTO, DEPOIS DO COMMIT E NA EMPRESA NOVA.
     *
     * Depois porque o registro abre transação própria com advisory lock por
     * empresa (`gateway/event-log.service.ts`) — chamá-lo de dentro da nossa
     * aninharia transação e tomaria o lock no lugar errado. E só quando mudou
     * porque a cadeia da EMPRESA registra FATO: rodada de conferência aparece na
     * auditoria, não aqui.
     *
     * Falha aqui NÃO SOME e NÃO derruba a operação: a intenção já está
     * registrada, a empresa existe e o retrato carrega o erro. Derrubar
     * devolveria ao chamador exatamente a mentira que o revisor pegou — "deu
     * erro" sobre uma empresa que foi criada.
     */
    if (resultado.mudou && opcoes.rastro) {
      try {
        const registrado = (await opcoes.rastro({
          orgId: resultado.orgId,
          tipo: 'tenant.provisionado',
          actorType: opcoes.responsavel?.tipo ?? 'system',
          actorId: opcoes.responsavel?.id ?? null,
          correlationId: opcoes.correlacao ?? null,
          payload: {
            slug: resultado.slug,
            criada: resultado.criada,
            modo: resultado.modo,
            nome: resultado.nome,
            ativa: resultado.ativa,
            modulos: resultado.modulos,
            papelInicial: resultado.papelInicial.key,
            papeisCriados: resultado.papeis.criados,
            permissoesCriadas: resultado.permissoes.criadas,
            // Só o e-mail, que é identificador — nunca o hash, nunca senha.
            admin: resultado.admin
              ? { email: resultado.admin.email, criado: resultado.admin.criado }
              : null,
            politica: resultado.politica,
            contexto: resultado.contexto,
            intencao: rastro.intencao,
          },
        })) as { seq?: bigint } | undefined;
        if (registrado?.seq !== undefined) rastro.conclusao = String(registrado.seq);
      } catch (e) {
        rastro.falhaNaConclusao = (e as Error).message;
        resultado.avisos.push({
          codigo: 'rastro-da-conclusao-falhou',
          texto:
            'a empresa foi criada e o evento de NASCIMENTO não pôde ser gravado: ' +
            `${(e as Error).message}. A intenção ${rastro.intencao ? `(evento #${rastro.intencao}) ` : ''}` +
            'e a auditoria continuam de pé — o registro não se perdeu.',
        });
      }
    }

    if (opcoes.auditar) {
      const action = resultado.criada
        ? 'tenant.provisionar.criado'
        : resultado.mudou
          ? 'tenant.provisionar.reconfigurado'
          : 'tenant.provisionar.sem-mudanca';
      await opcoes
        .auditar({
          // A auditoria de uma operação de plataforma é da PLATAFORMA quando há
          // uma; sem ela (script em banco novo), fica na própria empresa.
          orgId: opcoes.ordenante ?? resultado.orgId,
          action,
          entityId: resultado.orgId,
          metadata: {
            slug: resultado.slug,
            modo: resultado.modo,
            criada: resultado.criada,
            mudou: resultado.mudou,
            ativa: resultado.ativa,
            modulos: resultado.modulos,
            ignorado: resultado.ignorado,
            avisos: resultado.avisos.map((a) => a.codigo),
            rastro,
          },
        })
        .catch(() => undefined);
    }

    return resultado;
  } catch (e) {
    return recusar(e, opcoes.ordenante ?? jaExistia?.id ?? null, { orgId });
  }
}
