import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma, PrismaClient } from '@prisma/client';

import { SemTenantError, contextoAtual } from '../common/contexto-execucao';
import { ORG_RESOLUCAO_PUBLICA } from '../common/tenant-publico';
import {
  type ChamadorDePlataforma,
  ORG_PLATAFORMA,
  caminhosDePlataformaFaltando,
} from './contexto-de-plataforma';

/*
 * A SESSÃO DO BANCO SABE DE QUE EMPRESA ESTÁ FALANDO (RF-T-02, RF-R-01).
 *
 * O QUE ESTE ARQUIVO RESOLVE
 * O isolamento por linha do Postgres (RLS) compara cada linha com um parâmetro
 * de sessão. Se ninguém disser ao banco qual é a empresa, ligar RLS não protege
 * nada — ou mata 100% das consultas. Aqui a empresa do contexto de execução
 * (`common/contexto-execucao.ts`) passa a viajar até a CONEXÃO, como
 * `SET LOCAL app.org_id`.
 *
 * A RLS JÁ ESTÁ LIGADA (mudou na fatia 1.5). Este arquivo construiu o
 * encanamento e o deixou inerte — sem policy no banco, `app.org_id` era um valor
 * que ninguém lia. A migration `20260911050000_isolamento_por_linha` escreveu as
 * policies e ligou `ROW LEVEL SECURITY` com `FORCE` nas 72 tabelas do schema:
 * agora `app.org_id` é lido a cada linha.
 *
 * O QUE ISSO MUDA PARA QUEM LÊ ESTE ARQUIVO
 * O valor que sai daqui deixou de ser diagnóstico e passou a ser o que DECIDE se
 * a consulta devolve linha. Em particular, `SEM_TENANT` (string vazia) deixou de
 * significar "vai passar e avisar" para significar "não vai devolver nada" —
 * quando a conexão for a do papel restrito.
 *
 * E é só quando ela for: o isolamento continua INERTE para quem conecta como
 * DONO das tabelas, que é o que a aplicação faz hoje (`urlDaAplicacao` degrau 3)
 * e o que `anunciarPapel` anuncia no arranque. A virada é operacional, não de
 * código: `deploy/papel-app.sh` + `DB_APP_USER`/`DB_APP_PASSWORD` + container
 * recriado. Os pré-requisitos dela estão no cabeçalho da migration.
 *
 * POR QUE `SET LOCAL` E NÃO `SET`
 * `SET` vale para a SESSÃO, e o Prisma tem fila de conexões: a conexão que
 * acabou de servir a empresa A volta para a fila com `app.org_id` = A, e a
 * próxima consulta — de outra empresa, de outro usuário — herda o valor. Seria
 * um vazamento criado pela própria defesa. `SET LOCAL` morre no COMMIT (medido:
 * `current_setting` devolve vazio na consulta seguinte da mesma conexão), e é
 * por isso que toda consulta precisa de uma transação em volta.
 *
 * O PREÇO, DITO EM VOZ ALTA
 * Cada consulta solta vira `BEGIN; SELECT set_config(...); <consulta>; COMMIT`:
 * três viagens de rede a mais. É o custo de o banco — e não a disciplina de quem
 * escreve `where: { orgId }` — ser o guarda.
 *
 * "Três viagens a mais" soa barato e não é. Medido (Postgres 16 em container no
 * host, duas amostras de 300 consultas, 10/09/2026):
 *
 *   consulta de modelo   0,44 ms  ->  1,38-1,48 ms   (2,5x a 3,1x)
 *   consulta crua        0,40 ms  ->  1,31-1,72 ms   (3,3x a 4,2x)
 *   vazão, 40 chamadas em paralelo: 4.000-4.800 -> 1.800-2.500 op/s  (-48% a -55%)
 *
 * A queda de vazão é o número que importa, e não é o dobro do tempo de CPU: é
 * que cada consulta agora SEGURA a conexão por umas quatro vezes mais tempo. Com
 * a fila de conexões do tamanho de hoje (nenhum `connection_limit` declarado —
 * vale o padrão do Prisma, núcleos x 2 + 1), o teto de concorrência cai na mesma
 * proporção. Dimensionar a fila é decisão que precisa acontecer ANTES de isto
 * chegar na VPS, não depois.
 *
 * POR QUE UM PROXY POR CIMA DO `$extends`
 * O `$extends` do Prisma resolve as operações de modelo e as consultas cruas,
 * mas NÃO resolve `$transaction`, e é justamente aí que ele se sabota:
 *
 *   · transação interativa (`$transaction(async (tx) => …)`): o `tx` que o
 *     Prisma entrega também é estendido, então CADA operação de dentro dispara
 *     o gancho e abre uma SEGUNDA transação, em outra conexão. Medido: os
 *     `BEGIN` aninham. O `pg_advisory_xact_lock` do RASTRO
 *     (`gateway/event-log.service.ts`) seria tomado e solto na transação de
 *     dentro — a cauda do encadeamento deixaria de ser serializada, que é a
 *     única coisa que aquele lock existe para garantir.
 *
 *   · lote (`$transaction([...])`): cada elemento abre a sua própria transação e
 *     a atomicidade do lote se desfaz em silêncio. Três call sites dependem
 *     dela hoje (bio, clickup, conciliação financeira).
 *
 * Daí o proxy: ele intercepta `$transaction` ANTES do cliente estendido e faz o
 * `SET LOCAL` uma vez só, na transação de verdade. Na forma interativa o `tx`
 * entregue é o do cliente CRU — sem gancho, portanto sem aninhamento.
 */

/** O parâmetro de sessão que a policy de RLS vai ler. Um nome, um lugar. */
export const GUC_TENANT = 'app.org_id';

/** O papel restrito com que a aplicação conecta. Criado pela migration. */
export const PAPEL_DE_APLICACAO = 'mktos_app';

/**
 * Ausência de empresa vira string VAZIA, nunca "não definido".
 *
 * As duas falham fechado quando a policy chegar (`'' = "orgId"` é falso, e
 * comparar com NULL também), mas a vazia é a que se escreve: ela sobrescreve
 * qualquer `app.org_id` que alguém tenha deixado na sessão à mão. "Sem empresa"
 * passa a ser um estado declarado, não a falta de uma declaração.
 */
const SEM_TENANT = '';

export type ModoDoTenant = 'observar' | 'impor';

/*
 * Os dois modos, com o mesmo vocabulário da porta (`GATEWAY_MODO`).
 *
 *  · `observar` (padrão, e o que produção roda hoje): consulta sem empresa
 *    resolvida RODA, com `app.org_id` vazio, e o caminho é registrado uma vez no
 *    log. É o inventário de quem ainda precisa de contexto — cron, rotas
 *    públicas, scripts — levantado com o sistema no ar, e não por leitura de
 *    código.
 *
 *  · `impor`: consulta sem empresa resolvida LANÇA (RF-T-04: "ausência de
 *    tenant é erro, nunca 'todos'"). É o modo do teste e o destino da fatia que
 *    liga a RLS. Ligar antes de o inventário estar zerado derruba a aplicação.
 *
 * O INVENTÁRIO TEM DOIS ITENS, e o segundo entrou na fatia 1.5: além de
 * "consulta sem empresa", o modo `observar` agora registra também "consulta com
 * empresa DIFERENTE da sessão no `where` escrito à mão" (ver
 * `conferirDivergencia`). São os dois jeitos de o isolamento quebrar, e o
 * segundo é o que some em silêncio depois da virada — tela vazia, sem erro.
 *
 * QUANDO LIGAR `impor`: junto com a virada para o papel restrito, nunca depois.
 * Sob RLS, consulta sem empresa não lança — devolve ZERO LINHA, calada. O modo
 * `impor` é o que transforma isso em erro alto. Os caminhos que legitimamente
 * consultam sem empresa (login, provisionamento, cron da casa) precisam declarar
 * o contexto de plataforma ANTES (`prisma/contexto-de-plataforma.ts`); a lista
 * do que falta está no cabeçalho da migration do isolamento.
 */
export function modoDoTenant(env: NodeJS.ProcessEnv = process.env): ModoDoTenant {
  const bruto = (env.TENANT_MODO ?? '').trim();
  if (bruto === '') return 'observar';
  if (bruto === 'observar' || bruto === 'impor') return bruto;
  // Valor desconhecido derruba na hora em vez de cair no padrão: um
  // `TENANT_MODO=forcar` que virasse `observar` em silêncio seria uma defesa
  // que o operador acha que ligou e que não está ligada.
  throw new Error(
    `TENANT_MODO="${bruto}" não existe. Valores: observar | impor (vazio = observar).`,
  );
}

/**
 * A URL com que a APLICAÇÃO conecta — o papel restrito, não o dono.
 *
 * Três degraus, nesta ordem:
 *   1. `APP_DATABASE_URL` inteira, quando a aplicação fala com outro host/porta
 *      (um pgbouncer, por exemplo);
 *   2. `DB_APP_USER` + `DB_APP_PASSWORD` trocados dentro da `DATABASE_URL` — é
 *      o caminho normal, e existe para não haver DUAS URLs a manter em sincronia
 *      (a de dentro do compose fala com `db:5432`, a de fora com `localhost`;
 *      duplicar isso é o erro que ninguém percebe até o deploy);
 *   3. nada: devolve `undefined` e o Prisma segue com a `DATABASE_URL` do
 *      ambiente — que é a conexão DONA, exatamente como antes desta fatia.
 *
 * O degrau 3 é a razão de produção não quebrar no deploy seguinte: enquanto o
 * papel não tiver senha, tudo continua como está.
 */
export function urlDaAplicacao(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const inteira = (env.APP_DATABASE_URL ?? '').trim();
  if (inteira !== '') return inteira;

  const usuario = (env.DB_APP_USER ?? '').trim();
  const senha = env.DB_APP_PASSWORD ?? '';
  const base = (env.DATABASE_URL ?? '').trim();
  // Senha vazia NÃO vira URL: `postgresql://mktos_app:@db/…` é sintaticamente
  // válida e falha na autenticação — a aplicação não subiria, e o erro apareceria
  // longe daqui. Preferimos seguir como dono e avisar no boot.
  if (usuario === '' || senha === '' || base === '') return undefined;

  // `%` literal na senha corromperia a URL: o setter de `URL` escapa tudo menos
  // o próprio `%`, então `ab%25` voltaria de lá como `ab%`. Recusamos alto em vez
  // de conectar com senha errada.
  if (senha.includes('%')) {
    throw new Error(
      'DB_APP_PASSWORD contém "%", que não sobrevive à URL de conexão. ' +
        'Gere uma sem: openssl rand -hex 32',
    );
  }

  const u = new URL(base);
  u.username = usuario;
  u.password = senha;
  return u.toString();
}

/**
 * Marca "já estamos dentro de uma transação com o `SET LOCAL` feito".
 *
 * Serve só à forma em LOTE: os elementos do array são construídos pelo cliente
 * estendido antes de `$transaction` ser chamado, mas o gancho de cada um só roda
 * na EXECUÇÃO — que acontece dentro deste escopo (medido). Ali ele vira
 * passagem direta, e o Prisma costura tudo na transação do lote.
 *
 * A forma interativa NÃO usa esta marca de propósito: lá o `tx` entregue é o do
 * cliente cru e não passa pelo gancho. Se o corpo da transação usar o cliente de
 * FORA (`this.prisma.x` em vez de `tx.x`), aquela consulta ganha transação
 * própria com o `SET LOCAL` dela — que é o que já acontece hoje, porque ela já
 * roda em outra conexão. Marcar o escopo faria essa consulta sair SEM empresa, e
 * um furo silencioso é pior que uma transação a mais.
 */
const dentroDeUmLote = new AsyncLocalStorage<true>();

export interface OpcoesDaSessao {
  modo: ModoDoTenant;
  /** De onde sai a empresa. Injetável para o teste não depender do armazém global. */
  tenant?: () => string | null | undefined;
  /** Para onde vai o aviso de consulta sem empresa. */
  avisar?: (mensagem: string) => void;
}

/** Caminhos já avisados — o aviso é inventário, não enxurrada de log. */
const jaAvisados = new Set<string>();
/** Teto de memória do inventário: passou disto, o aviso se cala. */
const TETO_DE_AVISOS = 500;

/**
 * As duas SENTINELAS — estados declarados que NÃO são empresa.
 *
 * `ORG_RESOLUCAO_PUBLICA` (fatia 1.4, `common/tenant-publico.ts`): uma rota
 * pública está descobrindo de quem é o pedido.
 * `ORG_PLATAFORMA` (fatia 1.5, `prisma/contexto-de-plataforma.ts`): o login, o
 * provisionamento ou um cron da casa está descobrindo a empresa.
 *
 * Elas VIAJAM como `app.org_id` — é assim que a policy de linha as reconhece —,
 * então para este arquivo são "empresa resolvida" e passam direto. Só o
 * inventário abaixo precisa distingui-las, e por um motivo pequeno: sob
 * sentinela, `where: { orgId }` diferente do valor da sessão é o normal, não um
 * desvio.
 *
 * IMPORTADAS, nunca reescritas. O terceiro lugar que carrega os mesmos dois
 * valores é a migration do isolamento — SQL não importa TypeScript, então lá eles
 * são literais, e o que mantém os dois lados juntos é o caso "os literais das
 * sentinelas são os MESMOS no código e no banco" de
 * `apps/api/test/tenant-isolation.test.ts`.
 */
const SENTINELAS = new Set<string>([ORG_RESOLUCAO_PUBLICA, ORG_PLATAFORMA]);

/**
 * O `orgId` que o chamador escreveu à mão nos argumentos da consulta, quando há
 * um e ele é um id de verdade.
 *
 * Olha só os dois lugares que cobrem a quase totalidade dos call sites
 * (`where.orgId` e `data.orgId`, na forma direta) — de propósito. Varrer o
 * objeto inteiro custaria a cada consulta, e este código roda em TODAS.
 */
function orgIdDosArgumentos(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null;
  const a = args as Record<string, unknown>;
  for (const chave of ['where', 'data'] as const) {
    const bloco = a[chave];
    if (!bloco || typeof bloco !== 'object' || Array.isArray(bloco)) continue;
    const org = (bloco as Record<string, unknown>).orgId;
    if (typeof org === 'string' && org.trim() !== '') return org;
  }
  return null;
}

/** Só para o teste: zera o inventário entre casos. */
export function esquecerAvisos(): void {
  jaAvisados.clear();
}

/**
 * Embrulha um cliente Prisma para que toda consulta declare a empresa à conexão.
 *
 * Recebe o cliente CRU e devolve um objeto com a mesma superfície. Quem injeta
 * `PrismaService` não vê diferença — é essa a condição de esta fatia caber num
 * arquivo só.
 */
export function comTenantNaSessao<C extends PrismaClient>(base: C, opcoes: OpcoesDaSessao): C {
  const lerTenant = opcoes.tenant ?? (() => contextoAtual()?.orgId ?? null);
  const avisar = opcoes.avisar ?? ((m: string) => console.warn(m));

  function resolver(onde: string): string {
    const org = lerTenant();
    if (typeof org === 'string' && org.trim() !== '') return org;
    if (opcoes.modo === 'impor') throw new SemTenantError(onde);
    if (!jaAvisados.has(onde) && jaAvisados.size < TETO_DE_AVISOS) {
      jaAvisados.add(onde);
      avisar(
        `[tenant] consulta SEM empresa resolvida em ${onde}: a sessão vai com ${GUC_TENANT} vazio. ` +
          'Sob isolamento por linha isto não devolveria nada (RF-T-04).',
      );
    }
    return SEM_TENANT;
  }

  /*
   * O SEGUNDO JEITO DE O ISOLAMENTO QUEBRAR, e que o inventário não via.
   *
   * `resolver()` acima levanta consulta SEM empresa. Existe outro desvio, e ele
   * não some quando aquele chegar a zero: consulta COM empresa na sessão e um
   * `where: { orgId }` escrito à mão apontando para OUTRA. Hoje ela devolve o
   * dado alheio (é só um filtro); sob isolamento por linha ela passa a devolver
   * NADA, em silêncio — a policy recorta pela empresa da sessão e o filtro
   * escrito à mão nunca casa.
   *
   * O sintoma é o pior possível de diagnosticar: uma tela que some, sem erro,
   * sem log, em produção. Levantar isso ANTES da virada é o ponto — por isso é
   * aviso de inventário, do mesmo tipo e com o mesmo teto, e não exceção. Não
   * lança nem em `impor`: recusar aqui trocaria "tela vazia" por "500", e
   * nenhum dos dois é conserto; o conserto é o call site parar de escrever a
   * empresa à mão.
   *
   * Sob sentinela não vale nada disso: lá, filtrar por uma empresa específica é
   * o esperado (a resolução pública procura a página de QUALQUER empresa).
   */
  function conferirDivergencia(onde: string, org: string, args: unknown): void {
    if (SENTINELAS.has(org)) return;
    const doArgumento = orgIdDosArgumentos(args);
    if (!doArgumento || doArgumento === org) return;
    const chave = `${onde}#divergente`;
    if (jaAvisados.has(chave) || jaAvisados.size >= TETO_DE_AVISOS) return;
    jaAvisados.add(chave);
    avisar(
      `[tenant] consulta em ${onde} filtra por empresa DIFERENTE da sessão ` +
        `(argumento=${doArgumento}, sessão=${org}). Hoje ela devolve o dado da empresa do ` +
        'argumento; sob isolamento por linha ela passará a devolver VAZIO, sem erro. ' +
        'Tire o orgId escrito à mão e deixe a empresa vir do contexto (RF-T-04).',
    );
  }

  /*
   * `set_config($1, $2, true)` e não `SET LOCAL app.org_id = '<valor>'`: a forma
   * com `SET LOCAL` NÃO aceita parâmetro, e concatenar o id da empresa dentro do
   * SQL é injeção esperando um id que não seja um uuid. O terceiro argumento
   * `true` é o que faz o `set_config` ser local à transação.
   */
  const declararTenant = (orgId: string) =>
    base.$executeRawUnsafe(`SELECT set_config($1, $2, true)`, GUC_TENANT, orgId);

  const estendido = base.$extends({
    query: {
      // `$allOperations` no TOPO (e não dentro de `$allModels`) é o que alcança
      // também `$queryRawUnsafe` e `$executeRawUnsafe` — a busca vetorial do
      // Obsidian e da Pauta só existe nessa forma.
      async $allOperations({ model, operation, args, query }) {
        if (dentroDeUmLote.getStore()) return query(args);

        const onde = model ? `${model}.${operation}` : operation;
        const orgId = resolver(onde);
        if (orgId !== SEM_TENANT) conferirDivergencia(onde, orgId, args);

        // A forma em LOTE, e não `$transaction(async () => …)`: dentro de uma
        // transação interativa o `query(args)` continuaria preso à conexão de
        // fora e rodaria FORA dela. No lote o Prisma alista as duas na mesma
        // transação — é o padrão que a própria documentação do Prisma usa para
        // RLS, e foi conferido no Postgres descartável.
        const [, resultado] = await base.$transaction([
          declararTenant(orgId),
          query(args) as unknown as Prisma.PrismaPromise<unknown>,
        ]);
        return resultado;
      },
    },
  });

  type ArgTransacao = unknown;
  const transacaoCrua = base.$transaction.bind(base) as (
    arg: ArgTransacao,
    opcoes?: unknown,
  ) => Promise<unknown>;

  function $transaction(arg: ArgTransacao, opcoesTx?: unknown): Promise<unknown> {
    if (Array.isArray(arg)) {
      const orgId = resolver('$transaction(lote)');
      return dentroDeUmLote.run(true, () =>
        transacaoCrua([declararTenant(orgId), ...arg], opcoesTx).then((r) =>
          // Devolve só o que o chamador pediu: o `set_config` que entrou na
          // frente é nosso, não dele.
          (r as unknown[]).slice(1),
        ),
      );
    }

    if (typeof arg === 'function') {
      const orgId = resolver('$transaction');
      const corpo = arg as (tx: unknown) => Promise<unknown>;
      return transacaoCrua(async (tx: unknown) => {
        await (tx as PrismaClient).$executeRawUnsafe(
          `SELECT set_config($1, $2, true)`,
          GUC_TENANT,
          orgId,
        );
        return corpo(tx);
      }, opcoesTx);
    }

    // Forma que não conhecemos: entrega ao Prisma, que erra melhor que nós.
    return transacaoCrua(arg, opcoesTx);
  }

  return new Proxy(estendido as object, {
    get(alvo, prop) {
      if (prop === '$transaction') return $transaction;
      // Sem `receptor`: o cliente estendido do Prisma já é um proxy que devolve
      // funções ligadas ao alvo certo. Reapontar o `this` para o nosso proxy
      // faria a chamada reentrar aqui a cada acesso interno.
      return Reflect.get(alvo, prop);
    },
  }) as C;
}

/**
 * Erro de arranque: a conexão já é restrita, mas os caminhos de plataforma ainda
 * não declaram o contexto. Tipo próprio para o teste cobrar a recusa sem depender
 * do texto da mensagem.
 */
export class CoberturaDePlataformaIncompletaError extends Error {
  constructor(readonly faltando: readonly ChamadorDePlataforma[]) {
    super(
      'ISOLAMENTO POR LINHA ATIVO COM CAMINHO DE PLATAFORMA EM ABERTO — a API não sobe.\n' +
        `A conexão é o papel restrito, então a policy de linha VALE para ela; e ${faltando.length} ` +
        'caminho(s) que consultam o banco ANTES de haver empresa ainda não declaram o contexto de ' +
        'plataforma (`comContextoDePlataforma`, em `src/prisma/contexto-de-plataforma.ts`).\n' +
        'Sob a policy essas consultas não lançam: devolvem ZERO LINHA, em silêncio. Na prática o ' +
        'login vira "credenciais inválidas" para todo mundo e nada aparece no log.\n\n' +
        faltando.map((c) => `  · ${c.arquivo}\n      ${c.porQue}`).join('\n') +
        '\n\nDois caminhos, e o primeiro é o certo:\n' +
        '  1. declare o contexto nesses arquivos e acrescente cada um a ' +
        '`CHAMADORES_DE_PLATAFORMA`;\n' +
        '  2. para voltar ao estado anterior AGORA, tire `DB_APP_USER`/`DB_APP_PASSWORD` (ou ' +
        '`APP_DATABASE_URL`) e recrie o container: a aplicação volta a conectar como dona e o ' +
        'isolamento fica inerte, exatamente como antes.',
    );
    this.name = 'CoberturaDePlataformaIncompletaError';
  }
}

/**
 * A TRAVA DA VIRADA: conexão restrita só sobe com os caminhos de plataforma
 * declarados.
 *
 * O cabeçalho da migration do isolamento lista sete caminhos que consultam o
 * banco antes de haver empresa — login, provisionamento, conectores da casa,
 * carga da política, sonda de saúde. Enquanto a aplicação conecta como DONA das
 * tabelas, nada disso importa: o dono atravessa policy e tudo funciona. No dia em
 * que alguém preencher `DB_APP_USER`/`DB_APP_PASSWORD` achando que está fazendo a
 * coisa segura, todos eles passam a devolver ZERO LINHA — em silêncio, porque
 * policy de linha não recusa, ela recorta.
 *
 * Antes desta conferência a lista morava em COMENTÁRIO, em dois arquivos. Agora
 * ela é comparada no arranque:
 *
 *   · conexão INERTE (dona, superusuária ou com BYPASSRLS) e lista incompleta
 *     → grita alto, no nível de aviso, e segue. É o estado de hoje em produção, e
 *     derrubar por causa de uma dívida que ainda não tem efeito seria trocar um
 *     risco futuro por uma queda presente.
 *   · conexão RESTRITA e lista incompleta → **recusa subir**. É o único momento
 *     em que a dívida vira estrago, e é o momento em que ninguém está olhando o
 *     log: a virada é uma variável de ambiente e um `docker compose up`.
 *   · conexão restrita e lista completa → uma linha dizendo que a policy vale.
 *
 * Devolve o que faltou, para o chamador decidir. Não consulta o banco.
 */
export function conferirCoberturaDePlataforma(inerte: boolean): {
  faltando: readonly ChamadorDePlataforma[];
  recusar: boolean;
} {
  const faltando = caminhosDePlataformaFaltando();
  return { faltando, recusar: !inerte && faltando.length > 0 };
}

/** O texto do aviso quando a dívida existe mas ainda não tem efeito. */
function avisoDeCoberturaPendente(faltando: readonly ChamadorDePlataforma[]): string {
  return (
    `[tenant] ATENÇÃO: ${faltando.length} caminho(s) de plataforma ainda NÃO declaram contexto — ` +
    faltando.map((c) => c.arquivo).join(', ') +
    '. Hoje isso não tem efeito (a conexão atravessa policy). No dia em que a aplicação conectar ' +
    `como ${PAPEL_DE_APLICACAO}, cada um deles passa a devolver ZERO LINHA em silêncio — o login ` +
    'inclusive. A API vai RECUSAR subir nessa condição, de propósito. Ver ' +
    '`CAMINHOS_DE_PLATAFORMA_EXIGIDOS` em `src/prisma/contexto-de-plataforma.ts`.'
  );
}

/**
 * Uma linha no boot dizendo com que papel a aplicação conectou e o que isso
 * significa para o isolamento.
 *
 * Existe porque o degrau 3 de `urlDaAplicacao` é silencioso por desenho: sem
 * `DB_APP_PASSWORD` a aplicação segue conectando como DONA das tabelas, e dono
 * ignora policy de RLS. Quem lê o log precisa ver isso escrito, não deduzir.
 *
 * Usa o cliente CRU de propósito: no modo `impor` esta consulta não tem empresa
 * e o gancho a derrubaria — o diagnóstico do boot não pode depender de haver
 * requisição em curso.
 *
 * DEIXOU DE SER SÓ DIAGNÓSTICO (fatia 1.5, correção). Quando a conexão é
 * restrita e falta caminho de plataforma declarado, esta função LANÇA e o
 * arranque para — ver `conferirCoberturaDePlataforma`. O `try` cobre só a
 * consulta ao catálogo, que é o que não pode derrubar o boot; a recusa fica
 * FORA dele de propósito, senão o mesmo `catch` que protege o diagnóstico
 * engoliria a trava.
 */
export async function anunciarPapel(
  base: PrismaClient,
  modo: ModoDoTenant,
  registrar: (mensagem: string) => void,
  avisar: (mensagem: string) => void = registrar,
): Promise<void> {
  let inerte: boolean | null = null;

  try {
    const [r] = await base.$queryRawUnsafe<
      Array<{ papel: string; bypassa: boolean; superusuario: boolean; dono: string }>
    >(
      `SELECT current_user::text                                   AS papel,
              COALESCE(r.rolbypassrls, false)                      AS bypassa,
              COALESCE(r.rolsuper, false)                          AS superusuario,
              COALESCE(pg_get_userbyid(c.relowner)::text, '?')     AS dono
         FROM (SELECT 1) _
         LEFT JOIN pg_roles r ON r.rolname = current_user
         LEFT JOIN pg_class c ON c.relname = 'Org' AND c.relkind = 'r'`,
    );

    if (r) {
      const ehDono = r.papel === r.dono;
      inerte = ehDono || r.bypassa || r.superusuario;
      registrar(
        `[tenant] conectado como "${r.papel}" (dono das tabelas: "${r.dono}") · modo=${modo} · ` +
          `GUC=${GUC_TENANT} · ` +
          (inerte
            ? `ISOLAMENTO POR LINHA INERTE: ${
                ehDono ? 'o papel é DONO das tabelas' : r.bypassa ? 'o papel tem BYPASSRLS' : 'o papel é SUPERUSER'
              } e o Postgres ignora policy para ele. Provisione ${PAPEL_DE_APLICACAO} (DB_APP_USER/DB_APP_PASSWORD).`
            : 'papel restrito — a policy de linha vale para esta conexão.'),
      );
    }
  } catch (e) {
    // Diagnóstico nunca derruba o boot.
    registrar(`[tenant] não deu para descobrir o papel da conexão: ${(e as Error).message}`);
  }

  // Não deu para descobrir o papel: sem base para recusar nem para absolver.
  // Grita se houver dívida e deixa o boot seguir — recusar aqui derrubaria a API
  // por uma consulta de catálogo que falhou, que é justamente o que o `catch`
  // acima existe para evitar.
  if (inerte === null) {
    const { faltando } = conferirCoberturaDePlataforma(true);
    if (faltando.length > 0) avisar(avisoDeCoberturaPendente(faltando));
    return;
  }

  const { faltando, recusar } = conferirCoberturaDePlataforma(inerte);
  if (recusar) throw new CoberturaDePlataformaIncompletaError(faltando);
  if (faltando.length > 0) avisar(avisoDeCoberturaPendente(faltando));
}
