import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';
import { Client } from 'pg';

import { comContexto } from '../src/common/contexto-execucao';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { EventLogService } from '../src/gateway/event-log.service';
import type { ReauthService } from '../src/auth/reauth.service';
import {
  AcessoDeSuporteNegadoError,
  AutorizacaoInvalidaError,
  EVENTO_AUTORIZADO,
  EVENTO_NEGADO,
  EVENTO_TETO_DE_RECUSA,
  EVENTO_USADO,
  ESCOPOS_DE_SUPORTE,
  EXIGE_REAUTENTICACAO,
  ForaDaSuperficieError,
  JANELA_DO_TETO_MINUTOS,
  LIMITE_DE_RECUSAS_NA_JANELA,
  MOTIVO_MINIMO,
  PRAZO_MAXIMO_MINUTOS,
  PRAZO_MINIMO_MINUTOS,
  SUPERFICIE_DO_CLIENTE,
  SUPERFICIE_DO_CONSOLE,
  SUPERFICIE_DO_SUPORTE,
  cercar,
  conferirArgumentos,
  conferirPedido,
  decidirAcesso,
  escolherAcesso,
  estadoDoAcesso,
  segundosRestantes,
} from '../src/platform/plataforma';
import { SLUG_DA_PLATAFORMA } from '../src/tenants/provisionar';
import { AcessoDeSuporteService } from '../src/platform/acesso-de-suporte.service';
import { ConsoleDaPlataformaService } from '../src/platform/console.service';
import { moduloDoCaminho } from '../src/tenants/modulos';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * ============================================================================
 * O CONSOLE DA PLATAFORMA QUE NÃO ENXERGA DADO DE CLIENTE — fatia 6.3, RF-B-02
 * ============================================================================
 *
 * A FATIA DIZ, COM TODAS AS LETRAS, QUAL É O CASO QUE VALE MAIS:
 * "o teste que prova que o operador da plataforma NÃO consegue abrir um registro
 * de tenant vale mais que a tela". É esta suíte, e ela mede a recusa por
 * TENTATIVA — nunca por leitura de campo, nunca por inspeção de configuração.
 *
 * ----------------------------------------------------------------------------
 * O QUE A REVISÃO ADVERSARIAL DE 11/09/2026 DERRUBOU — e virou caso aqui
 * ----------------------------------------------------------------------------
 * A cerca da primeira versão olhava o NOME do modelo e da operação, e não os
 * ARGUMENTOS. Três buracos, os três reais, os três com caso próprio na seção 2:
 *
 *   · `include: { org: { include: { leads: true } } }` trazia a relação junto e
 *     devolvia registro de cliente;
 *   · `count` aceitava `where` livre — `startsWith` sobre o texto da sessão é
 *     leitura do texto, só que devagar;
 *   · `$transaction` e `$extends` devolviam cliente SEM cerca, e só não vazavam
 *     porque o `this` errado fazia o Prisma explodir.
 *
 * Cada um deles tem, ao lado, o CONTROLE NEGATIVO: a mesma chamada no cliente
 * cru, mostrando o dado saindo. Sem isso um verde não distingue "a defesa
 * funcionou" de "o método não existia".
 *
 * ----------------------------------------------------------------------------
 * AS DUAS METADES, E POR QUE PRECISAM SER DUAS
 * ----------------------------------------------------------------------------
 * 1. A CERCA (código). Roda SEMPRE, sem banco. É ela que protege HOJE: a
 *    aplicação conecta como DONA das tabelas e, medido no banco `prova_63` em
 *    11/09/2026, a mesma sessão de plataforma que sob o papel restrito lê ZERO
 *    lead do cliente lê UM sob o papel dono.
 *
 * 2. A POLICY (banco). Roda quando há as DUAS conexões — a dona
 *    (`TEST_DATABASE_URL`) e a do papel restrito (`TENANT_DATABASE_URL`). É ela
 *    que protege DEPOIS da virada, e medi-la com a conexão dona não provaria
 *    nada: dono atravessa policy.
 *
 * O isolamento POR LINHA das duas tabelas desta fatia é medido também, e em
 * outro lugar: `test/tenant-isolation.test.ts`, que desde a correção tem
 * `EmpresaNaPlataforma` e `AcessoDeSuporte` no registro e semeadas nas duas
 * empresas. Ficar só aqui era o defeito: esta seção depende de duas variáveis de
 * ambiente, e sem elas o isolamento das duas tabelas não era medido por ninguém.
 *
 * ----------------------------------------------------------------------------
 * COMO RODAR A PARTE DE BANCO (opcional; sem ela a seção não é registrada)
 * ----------------------------------------------------------------------------
 *   docker exec mktos-shadow psql -U mkt -d marketing_os_test_rls \
 *     -c "ALTER ROLE mktos_app WITH LOGIN PASSWORD '<senha local>'"
 *   TEST_DATABASE_URL='postgresql://mkt:shadow@localhost:55432/marketing_os_test_rls' \
 *   TENANT_DATABASE_URL='postgresql://mktos_app:<senha>@localhost:55432/marketing_os_test_rls' \
 *     npx vitest run test/console-da-plataforma.test.ts
 *
 * A seção é registrada por `if`, e NÃO por `describe.skipIf`: a trava de
 * cobertura da CI reprova a suíte com qualquer caso pulado (ver o cabeçalho de
 * `test/rotas-publicas-tenant.test.ts`). Com `if`, a seção simplesmente não
 * existe quando as conexões não existem — nada pulado, nada a desculpar.
 */

const ORG_CLIENTE = 'org-cliente-63';
const ORG_PLATAFORMA = 'org-plataforma-63';

// ---------------------------------------------------------------------------
// O cliente Prisma FALSO — e ele é generoso de propósito
// ---------------------------------------------------------------------------

/*
 * Repare no que este objeto TEM: `lead.findMany`, `user.findMany`,
 * `session.findMany`, `eventLog.findMany`, `$queryRawUnsafe`, `$transaction` e
 * `$extends`. Tudo funciona, tudo devolve linha.
 *
 * É deliberado. Uma cerca testada contra um cliente que não tem o método estaria
 * medindo a ausência do método. Aqui o dado está do outro lado da cerca, ao
 * alcance da mão, e a única coisa entre ele e o console é `cercar()`.
 *
 * E os `find*` RESPEITAM `include`: é isso que faz o controle negativo do
 * atravessamento por relação ser um vazamento de verdade, e não uma encenação.
 */
interface Chamada {
  alvo: string;
  args: unknown;
}

const LEAD_DO_CLIENTE = { id: 'lead-1', name: 'Fulano de Tal', email: 'fulano@cliente.com' };

function prismaFalso(chamadas: Chamada[] = []): Record<string, unknown> {
  const registra =
    (alvo: string, resposta: unknown) =>
    (args: unknown): Promise<unknown> => {
      chamadas.push({ alvo, args });
      return Promise.resolve(
        typeof resposta === 'function' ? (resposta as (a: unknown) => unknown)(args) : resposta,
      );
    };

  /** A linha do registro comercial — e a relação `org`, quando pedida. */
  const empresaRegistrada = (args: unknown) => {
    const a = (args ?? {}) as { include?: { org?: unknown }; select?: { org?: unknown } };
    const base: Record<string, unknown> = {
      id: 'emp-1',
      orgId: ORG_PLATAFORMA,
      empresaId: ORG_CLIENTE,
      nome: 'Cliente 6.3',
      slug: 'cliente-63',
      plano: 'piloto',
      estado: 'ativa',
      saude: 'ok',
      usuarios: 3,
      agentesAtivos: 1,
      gastoIaUsdMes: 0,
      mensalidadeBrl: 0,
      cobrancaEmDia: true,
      proximaCobranca: null,
      medidoEm: null,
      ultimaAtividadeEm: null,
      observacao: null,
      atualizadoEm: new Date(),
    };
    // O Prisma de verdade devolve a relação quando ela é pedida. O falso
    // também: senão o controle negativo do `include` não provaria nada.
    if (a.include?.org || a.select?.org) {
      base.org = { id: ORG_CLIENTE, name: 'Cliente 6.3', leads: [LEAD_DO_CLIENTE] };
    }
    return base;
  };

  return {
    lead: {
      findMany: registra('lead.findMany', [LEAD_DO_CLIENTE]),
      findFirst: registra('lead.findFirst', LEAD_DO_CLIENTE),
      count: registra('lead.count', 1),
    },
    user: {
      findMany: registra('user.findMany', [{ id: 'u-1', email: 'alguem@cliente.com' }]),
      findFirst: registra('user.findFirst', null),
    },
    eventLog: {
      findMany: registra('eventLog.findMany', [{ id: 'ev-1', payload: { segredo: true } }]),
      count: registra('eventLog.count', 0),
    },
    session: {
      count: registra('session.count', 7),
      findMany: registra('session.findMany', [{ id: 's-1', pedido: 'o que o cliente perguntou' }]),
    },
    approval: { count: registra('approval.count', 2) },
    rotinaExecucao: { count: registra('rotinaExecucao.count', 1) },
    empresaNaPlataforma: {
      findMany: registra('empresaNaPlataforma.findMany', []),
      findFirst: registra('empresaNaPlataforma.findFirst', empresaRegistrada),
      count: registra('empresaNaPlataforma.count', 0),
      create: registra('empresaNaPlataforma.create', {}),
      update: registra('empresaNaPlataforma.update', {}),
      upsert: registra('empresaNaPlataforma.upsert', empresaRegistrada),
    },
    acessoDeSuporte: {
      findFirst: registra('acessoDeSuporte.findFirst', null),
      findMany: registra('acessoDeSuporte.findMany', []),
      count: registra('acessoDeSuporte.count', 0),
      create: registra('acessoDeSuporte.create', {}),
      update: registra('acessoDeSuporte.update', {}),
      updateMany: registra('acessoDeSuporte.updateMany', { count: 0 }),
    },
    $queryRawUnsafe: registra('$queryRawUnsafe', [{ tudo: 'que o SQL quiser' }]),
    $executeRawUnsafe: registra('$executeRawUnsafe', 1),
    /*
     * O `$transaction` do Prisma entrega ao callback um cliente CRU. O falso faz
     * o mesmo, de propósito: é assim que o controle negativo mostra o que estava
     * ao alcance de quem chamasse `cerca.$transaction`.
     */
    $transaction: (fn: (tx: unknown) => unknown): unknown => {
      chamadas.push({ alvo: '$transaction', args: null });
      return Promise.resolve(fn(prismaFalso(chamadas)));
    },
    $extends: (): unknown => {
      chamadas.push({ alvo: '$extends', args: null });
      return prismaFalso(chamadas);
    },
  };
}

// ---------------------------------------------------------------------------
// 1. A CERCA, por MODELO e OPERAÇÃO — a tentativa que prova a fatia
// ---------------------------------------------------------------------------

describe('a cerca do console: o operador da plataforma não abre registro de empresa', () => {
  it('CONTROLE NEGATIVO: sem a cerca, o mesmo cliente entrega o lead do cliente', async () => {
    // Se este caso ficar verde por engano (o cliente falso não ter o método), os
    // seguintes estariam medindo o nada. É por isso que ele vem primeiro e
    // afirma o VAZAMENTO.
    const cru = prismaFalso() as unknown as {
      lead: { findMany(a: unknown): Promise<Array<{ name: string }>> };
    };
    const leads = await cru.lead.findMany({});
    expect(leads).toHaveLength(1);
    expect(leads[0].name).toBe('Fulano de Tal');
  });

  it('o console não alcança tabela de cliente nenhuma', () => {
    const cerca = cercar(prismaFalso(), SUPERFICIE_DO_CONSOLE, 'console') as Record<string, unknown>;
    for (const modelo of ['lead', 'user', 'eventLog', 'session', 'approval', 'acessoDeSuporte']) {
      expect(() => cerca[modelo], `o console alcançou "${modelo}"`).toThrow(ForaDaSuperficieError);
    }
  });

  it('o console não alcança SQL cru — que atravessaria qualquer cerca por modelo', () => {
    const cerca = cercar(prismaFalso(), SUPERFICIE_DO_CONSOLE, 'console') as Record<string, unknown>;
    expect(() => cerca.$queryRawUnsafe).toThrow(ForaDaSuperficieError);
    expect(() => cerca.$executeRawUnsafe).toThrow(ForaDaSuperficieError);
  });

  it('o SUPORTE conta, mas não abre: `session.count` passa e `session.findMany` é recusado', async () => {
    const chamadas: Chamada[] = [];
    const cerca = cercar(prismaFalso(chamadas), SUPERFICIE_DO_SUPORTE, 'suporte') as {
      session: { count(a: unknown): Promise<number>; findMany(a: unknown): Promise<unknown[]> };
    };

    await expect(cerca.session.count({ where: { orgId: ORG_CLIENTE } })).resolves.toBe(7);
    // A MESMA tabela, a MESMA sessão, com autorização de suporte válida: a
    // contagem passa e o registro não. É a diferença entre "quantos" e "quais",
    // e é ela que a fatia vende.
    expect(() => cerca.session.findMany).toThrow(ForaDaSuperficieError);
    expect(chamadas.map((c) => c.alvo)).toEqual(['session.count']);
  });

  it('a recusa diz o que foi tentado e onde declarar — erro que ensina, não erro que some', () => {
    const cerca = cercar(prismaFalso(), SUPERFICIE_DO_SUPORTE, 'suporte') as Record<string, unknown>;
    try {
      void (cerca as { session: { findMany: unknown } }).session.findMany;
      expect.unreachable('a cerca deixou passar');
    } catch (e) {
      expect(e).toBeInstanceOf(ForaDaSuperficieError);
      const erro = e as ForaDaSuperficieError;
      expect(erro.superficie).toBe('suporte');
      expect(erro.alvo).toBe('session.findMany');
      expect(erro.message).toContain('SUPERFICIE_DO_SUPORTE');
    }
  });

  it('toda superfície declara o motivo de cada modelo — lista sem porquê é lista que cresce sozinha', () => {
    const todas = [...SUPERFICIE_DO_CONSOLE, ...SUPERFICIE_DO_CLIENTE, ...SUPERFICIE_DO_SUPORTE];
    for (const m of todas) {
      expect(m.porQue.length, `${m.modelo} sem motivo escrito`).toBeGreaterThan(40);
      expect(m.operacoes.length, `${m.modelo} sem operação declarada`).toBeGreaterThan(0);
      expect(m.filtros.length, `${m.modelo} sem filtro declarado`).toBeGreaterThan(0);
    }
  });

  it('nenhuma tabela de CLIENTE aceita operação que devolva registro', () => {
    // A regra em forma de caso: dos modelos da superfície de suporte, só
    // `acessoDeSuporte` (a relação plataforma-cliente) pode devolver linha. Os
    // outros contam. Afrouxar isso fica vermelho aqui.
    const deCliente = SUPERFICIE_DO_SUPORTE.filter((m) => m.modelo !== 'acessoDeSuporte');
    expect(deCliente.length).toBeGreaterThan(0);
    for (const m of deCliente) {
      expect(m.operacoes, `${m.modelo} devolve registro`).toEqual(['count']);
    }
  });

  it('a cerca do SUPORTE não tem `user` — e a do cliente tem, por um motivo escrito', () => {
    /*
     * As duas superfícies existem separadas para isto. O lado do cliente precisa
     * ler o PAPEL de quem assina (é o conserto da alçada lida do token); o lado
     * da plataforma não pode ganhar essa leitura de carona, porque `User` é a
     * lista de quem trabalha no cliente, com e-mail.
     */
    expect(SUPERFICIE_DO_SUPORTE.map((m) => m.modelo)).not.toContain('user');
    const user = SUPERFICIE_DO_CLIENTE.find((m) => m.modelo === 'user');
    expect(user, 'o lado do cliente precisa de `user` para ler a alçada do banco').toBeDefined();
    expect(user!.operacoes).toEqual(['findFirst']);
    expect(user!.relacoes).toEqual({ roles: ['key'] });
  });
});

// ---------------------------------------------------------------------------
// 2. A CERCA, por ARGUMENTO — os três buracos que a revisão mediu
// ---------------------------------------------------------------------------

describe('a cerca olha os argumentos (os três furos da revisão de 11/09/2026)', () => {
  const doConsole = () =>
    cercar(prismaFalso(), SUPERFICIE_DO_CONSOLE, 'console') as {
      empresaNaPlataforma: { findFirst(a: unknown): Promise<Record<string, unknown>> };
    };
  const doSuporte = () =>
    cercar(prismaFalso(), SUPERFICIE_DO_SUPORTE, 'suporte') as {
      session: { count(a: unknown): Promise<number> };
      acessoDeSuporte: { findMany(a: unknown): Promise<unknown[]> };
    } & Record<string, unknown>;

  // --- furo 1: a relação -----------------------------------------------------

  it('CONTROLE NEGATIVO: sem a cerca, `include` da relação entrega o lead do cliente', async () => {
    const cru = prismaFalso() as unknown as {
      empresaNaPlataforma: { findFirst(a: unknown): Promise<{ org?: { leads: unknown[] } }> };
    };
    const linha = await cru.empresaNaPlataforma.findFirst({
      where: { orgId: ORG_PLATAFORMA },
      include: { org: { include: { leads: true } } },
    });
    // O dado ESTÁ do outro lado. É exatamente isto que a cerca antiga deixava
    // passar, medido pelo revisor contra o cliente real.
    expect(linha.org?.leads).toEqual([LEAD_DO_CLIENTE]);
  });

  /*
   * A RECUSA É SÍNCRONA, e por isso os casos usam `expect(() => …).toThrow` em
   * vez de `.rejects`. Não é detalhe de teste: a conferência acontece ANTES de a
   * chamada virar promessa, então um argumento proibido nunca chega ao banco —
   * nem como consulta cancelada. Dentro de um `await`, o efeito para quem chama
   * é idêntico.
   */
  it('`include` é recusado, e a recusa nomeia o caminho certo (`select` declarado)', () => {
    expect(() =>
      doConsole().empresaNaPlataforma.findFirst({
        where: { orgId: ORG_PLATAFORMA },
        include: { org: { include: { leads: true } } },
      }),
    ).toThrow(/include/);
  });

  it('`select` de relação NÃO declarada também é recusado — fechar `include` só não bastaria', () => {
    expect(() =>
      doConsole().empresaNaPlataforma.findFirst({
        where: { orgId: ORG_PLATAFORMA },
        select: { org: { select: { name: true } } },
      }),
    ).toThrow(/não é campo declarado nem relação declarada/);
  });

  it('a relação DECLARADA passa, e só nas colunas declaradas', async () => {
    // O outro lado do controle: a cerca não é um "não" para tudo. `roles.key` é
    // o que `lerAprovador` pede, e passa; `roles.name` não está declarado.
    const cliente = cercar(prismaFalso(), SUPERFICIE_DO_CLIENTE, 'cliente') as {
      user: { findFirst(a: unknown): Promise<unknown> };
    };
    await expect(
      cliente.user.findFirst({
        where: { id: 'u-1', orgId: ORG_CLIENTE },
        select: { id: true, roles: { select: { key: true } } },
      }),
    ).resolves.toBeNull();
    expect(() =>
      cliente.user.findFirst({
        where: { id: 'u-1', orgId: ORG_CLIENTE },
        select: { id: true, roles: { select: { name: true } } },
      }),
    ).toThrow(/roles\.name/);
  });

  // --- furo 2: a contagem como oráculo --------------------------------------

  it('CONTROLE NEGATIVO: sem a cerca, `count` com `startsWith` lê o texto da sessão', async () => {
    const chamadas: Chamada[] = [];
    const cru = prismaFalso(chamadas) as unknown as {
      session: { count(a: unknown): Promise<number> };
    };
    await cru.session.count({ where: { orgId: ORG_CLIENTE, pedido: { startsWith: 'o que' } } });
    // A chamada CHEGOU ao banco com o filtro por prefixo. Repetida letra a
    // letra, isso é a leitura do pedido do cliente — com "contagem não é
    // registro" verde nas duas catracas o tempo todo.
    expect(chamadas[0].args).toMatchObject({ where: { pedido: { startsWith: 'o que' } } });
  });

  it('`count` com filtro fora da lista é recusado — "contagem não é registro" vira garantia', () => {
    expect(() =>
      doSuporte().session.count({ where: { orgId: ORG_CLIENTE, pedido: { startsWith: 'o que' } } }),
    ).toThrow(/filtro "pedido" não declarado/);
  });

  it('`count` com operador de texto num campo DECLARADO também é recusado', () => {
    // `status` é filtro legítimo. `startsWith` nele não é: operador de texto é o
    // que transforma contagem em busca.
    expect(() =>
      doSuporte().session.count({ where: { orgId: ORG_CLIENTE, status: { startsWith: 'fal' } } }),
    ).toThrow(/operador "startsWith" não é permitido/);
  });

  it('`count` sem argumento nenhum é recusado — contaria a tabela inteira sob a conexão dona', () => {
    expect(() => (doSuporte().session as { count(a?: unknown): Promise<number> }).count()).toThrow(
      /sem argumentos/,
    );
    expect(() => doSuporte().session.count({ where: { status: 'falhou' } })).toThrow(/sem `orgId`/);
  });

  it('o `count` que o produto faz continua passando — a cerca não é um "não" para tudo', async () => {
    await expect(
      doSuporte().session.count({
        where: { orgId: ORG_CLIENTE, criadaEm: { gte: new Date() }, status: 'falhou' },
      }),
    ).resolves.toBe(7);
  });

  // --- furo 3: a infraestrutura ---------------------------------------------

  it('CONTROLE NEGATIVO: `$transaction` do cliente cru entrega um cliente SEM cerca', async () => {
    const cru = prismaFalso() as unknown as {
      $transaction(fn: (tx: Record<string, { findMany(a: unknown): Promise<unknown[]> }>) => unknown): Promise<unknown>;
    };
    const leads = await cru.$transaction(async (tx) => tx.lead.findMany({}));
    expect(leads).toEqual([LEAD_DO_CLIENTE]);
  });

  it('`$transaction` e `$extends` são RECUSADOS, e não "explodem por acidente"', () => {
    /*
     * A versão anterior os tinha em `INFRA_PERMITIDA` e devolvia a função sem
     * `bind`. Com o cliente real isso dava erro incompreensível (o `this` ia
     * para o proxy); com um cliente falso, vazava. A contenção vinha de um
     * detalhe de implementação, e o conserto óbvio daquele erro — dar `bind` —
     * abriria o buraco. Agora a lista de infraestrutura é VAZIA e a recusa é a
     * mesma dos modelos: explícita, com nome.
     */
    for (const nome of ['console', 'suporte', 'cliente'] as const) {
      const superficie =
        nome === 'console'
          ? SUPERFICIE_DO_CONSOLE
          : nome === 'suporte'
            ? SUPERFICIE_DO_SUPORTE
            : SUPERFICIE_DO_CLIENTE;
      const cerca = cercar(prismaFalso(), superficie, nome) as Record<string, unknown>;
      expect(() => cerca.$transaction, `${nome}.$transaction passou`).toThrow(ForaDaSuperficieError);
      expect(() => cerca.$extends, `${nome}.$extends passou`).toThrow(ForaDaSuperficieError);
      expect(() => cerca.$connect).toThrow(ForaDaSuperficieError);
    }
  });

  it('`constructor` não volta da cerca — `new (cerca.constructor)()` seria outro cliente cru', () => {
    const cerca = cercar(prismaFalso(), SUPERFICIE_DO_CONSOLE, 'console') as Record<string, unknown>;
    // `undefined` e não o valor real: devolver o construtor seria a mesma fuga
    // de `$extends`, por outra porta. E `undefined` também não LANÇA, senão um
    // `console.log(cerca)` quebraria com uma recusa sem sentido.
    expect(cerca.constructor).toBeUndefined();
    expect(cerca.then).toBeUndefined();
  });

  // --- a empresa em toda consulta -------------------------------------------

  it('escrita sem `orgId` é recusada nos dois lados: no `where` e no `data`', () => {
    const cliente = cercar(prismaFalso(), SUPERFICIE_DO_CLIENTE, 'cliente') as {
      acessoDeSuporte: {
        create(a: unknown): Promise<unknown>;
        updateMany(a: unknown): Promise<unknown>;
      };
    };
    expect(() =>
      cliente.acessoDeSuporte.create({ data: { escopo: 'diagnostico', motivo: 'x'.repeat(20) } }),
    ).toThrow(/criação sem `orgId`/);
    expect(() =>
      cliente.acessoDeSuporte.updateMany({ where: { id: 'ac-1' }, data: { revogadoEm: new Date() } }),
    ).toThrow(/sem `orgId`/);
  });

  it('a conferência é função pura — dá para interrogá-la sem proxy e sem Prisma', () => {
    /*
     * `conferirArgumentos` é exportada por isto: a decisão de "este argumento
     * pode?" tem de ser legível fora do proxy, senão a única forma de discutir
     * uma regra nova é montar meio cliente Prisma. Aqui uma superfície de
     * mentira, com duas colunas, mostra a regra inteira em quatro linhas.
     */
    const brinquedo = {
      modelo: 'coisa',
      operacoes: ['findMany'],
      campos: ['id', 'orgId', 'rotulo'],
      filtros: ['orgId'],
      porQue: 'superfície de brinquedo, só para este caso',
    };
    expect(() =>
      conferirArgumentos('t', brinquedo, 'findMany', { where: { orgId: 'o1' }, select: { rotulo: true } }),
    ).not.toThrow();
    expect(() => conferirArgumentos('t', brinquedo, 'findMany', { where: { rotulo: 'x' } })).toThrow(
      ForaDaSuperficieError,
    );
    expect(() =>
      conferirArgumentos('t', brinquedo, 'findMany', { where: { orgId: 'o1' }, select: { segredo: true } }),
    ).toThrow(/segredo/);
  });

  it('escrever em coluna não declarada é recusado — inclusive por relação aninhada', () => {
    const cliente = cercar(prismaFalso(), SUPERFICIE_DO_CLIENTE, 'cliente') as {
      acessoDeSuporte: { create(a: unknown): Promise<unknown> };
    };
    expect(() =>
      cliente.acessoDeSuporte.create({
        data: { orgId: ORG_CLIENTE, org: { connect: { id: 'outra-empresa' } } },
      }),
    ).toThrow(/escrever em "org"/);
  });
});

// ---------------------------------------------------------------------------
// 3. O PRAZO — expira sozinho, e a prova é por tentativa
// ---------------------------------------------------------------------------

const T0 = new Date('2026-09-11T12:00:00Z');
const UMA_HORA = 3_600_000;

describe('o acesso de suporte expira sozinho', () => {
  const acesso = {
    expiraEm: new Date(T0.getTime() + UMA_HORA),
    revogadoEm: null,
    escopo: 'diagnostico',
    operadorEmail: 'op@root.com',
  };

  it('vale antes do prazo', () => {
    expect(estadoDoAcesso(acesso, new Date(T0.getTime() + UMA_HORA - 1))).toBe('valido');
    expect(decidirAcesso(acesso, 'op@root.com', 'diagnostico', T0)).toBeNull();
  });

  it('no INSTANTE do vencimento já acabou — sem desempate', () => {
    // `<=` e não `<`. Um prazo que ainda vale no último milissegundo precisa de
    // desempate, e desempate é onde erro de fuso vira acesso a mais.
    const noPonto = new Date(T0.getTime() + UMA_HORA);
    expect(estadoDoAcesso(acesso, noPonto)).toBe('expirado');
    expect(decidirAcesso(acesso, 'op@root.com', 'diagnostico', noPonto)).toBe('expirado');
  });

  it('depois do prazo, a TENTATIVA é recusada — ninguém precisou passar apagando nada', () => {
    const depois = new Date(T0.getTime() + 5 * UMA_HORA);
    expect(decidirAcesso(acesso, 'op@root.com', 'diagnostico', depois)).toBe('expirado');
    expect(segundosRestantes(acesso, depois)).toBe(0);
  });

  it('revogar vence expirar — a decisão de quem revogou não é apagada pelo relógio', () => {
    const revogado = { ...acesso, revogadoEm: new Date(T0.getTime() + UMA_HORA / 2) };
    const depoisDoPrazo = new Date(T0.getTime() + 10 * UMA_HORA);
    expect(estadoDoAcesso(revogado, depoisDoPrazo)).toBe('revogado');
  });

  it('o acesso é de UMA pessoa e de UM escopo', () => {
    expect(decidirAcesso(acesso, 'outro@root.com', 'diagnostico', T0)).toBe('operador_diferente');
    expect(decidirAcesso(acesso, 'OP@ROOT.COM', 'diagnostico', T0)).toBeNull(); // e-mail não é sensível a caixa
    expect(decidirAcesso(acesso, 'op@root.com', 'faturamento', T0)).toBe('escopo_nao_autorizado');
    expect(decidirAcesso(null, 'op@root.com', 'diagnostico', T0)).toBe('sem_autorizacao');
  });
});

describe('com duas autorizações vivas, a escolha não esconde a válida', () => {
  /*
   * A VERSÃO ANTERIOR pegava a de `expiraEm` mais distante e decidia sobre ela.
   * Uma autorização REVOGADA com prazo longo derrubava a VÁLIDA com prazo curto,
   * e o operador recebia "revogado" com a boa parada ao lado.
   */
  const revogadaDePrazoLongo = {
    id: 'longa',
    expiraEm: new Date(T0.getTime() + 10 * UMA_HORA),
    revogadoEm: new Date(T0.getTime() - UMA_HORA),
    escopo: 'diagnostico',
    operadorEmail: 'op@root.com',
  };
  const validaDePrazoCurto = {
    id: 'curta',
    expiraEm: new Date(T0.getTime() + UMA_HORA),
    revogadoEm: null,
    escopo: 'diagnostico',
    operadorEmail: 'op@root.com',
  };

  it('CONTROLE NEGATIVO: a regra antiga (a de prazo mais longo) escolheria a revogada', () => {
    const comoAntes = [revogadaDePrazoLongo, validaDePrazoCurto].sort(
      (a, b) => b.expiraEm.getTime() - a.expiraEm.getTime(),
    )[0];
    expect(comoAntes.id).toBe('longa');
    expect(decidirAcesso(comoAntes, 'op@root.com', 'diagnostico', T0)).toBe('revogado');
  });

  it('a escolha acha a válida, mesmo com a revogada de prazo maior ao lado', () => {
    const r = escolherAcesso([revogadaDePrazoLongo, validaDePrazoCurto], 'op@root.com', 'diagnostico', T0);
    expect(r.valida?.id).toBe('curta');
    expect(r.recusa).toBeNull();
  });

  it('escopo errado com prazo maior também não derruba o escopo certo', () => {
    const outroEscopo = { ...revogadaDePrazoLongo, revogadoEm: null, escopo: 'faturamento' };
    const r = escolherAcesso([outroEscopo, validaDePrazoCurto], 'op@root.com', 'diagnostico', T0);
    expect(r.valida?.id).toBe('curta');
  });

  it('quando nenhuma serve, o motivo relatado é o mais informativo do conjunto', () => {
    const vencida = { ...validaDePrazoCurto, expiraEm: new Date(T0.getTime() - 1) };
    const r = escolherAcesso([vencida, revogadaDePrazoLongo], 'op@root.com', 'diagnostico', T0);
    expect(r.valida).toBeNull();
    // "revogado" é decisão de alguém; "expirado" é o relógio. A primeira explica
    // melhor a quem está do outro lado o que precisa acontecer agora.
    expect(r.recusa).toBe('revogado');
    expect(r.candidata?.id).toBe('longa');
  });

  it('lista vazia recusa por "sem_autorizacao", não por acidente', () => {
    const r = escolherAcesso([], 'op@root.com', 'diagnostico', T0);
    expect(r.recusa).toBe('sem_autorizacao');
    expect(r.candidata).toBeNull();
  });
});

describe('o pedido de autorização: R4 exige motivo, e o prazo tem teto', () => {
  const base = { operadorEmail: 'op@root.com', escopo: 'diagnostico', motivo: 'x'.repeat(40) };

  it('motivo curto é recusado — R4 exige motivo, e "ok" não explica nada', () => {
    expect(() => conferirPedido({ ...base, motivo: 'ok' }, T0)).toThrow(AutorizacaoInvalidaError);
    expect(() => conferirPedido({ ...base, motivo: 'a'.repeat(MOTIVO_MINIMO) }, T0)).not.toThrow();
  });

  it('prazo fora da faixa é recusado nos DOIS lados', () => {
    expect(() => conferirPedido({ ...base, minutos: PRAZO_MINIMO_MINUTOS - 1 }, T0)).toThrow();
    expect(() => conferirPedido({ ...base, minutos: PRAZO_MAXIMO_MINUTOS + 1 }, T0)).toThrow();
    expect(() => conferirPedido({ ...base, minutos: PRAZO_MAXIMO_MINUTOS }, T0)).not.toThrow();
  });

  it('escopo desconhecido é recusado — a lista é fechada', () => {
    expect(() => conferirPedido({ ...base, escopo: 'tudo' }, T0)).toThrow(AutorizacaoInvalidaError);
  });

  it('o vencimento sai do relógio recebido, não de `new Date()`', () => {
    const c = conferirPedido({ ...base, minutos: 30 }, T0);
    expect(c.expiraEm.toISOString()).toBe(new Date(T0.getTime() + 30 * 60_000).toISOString());
  });

  it('o e-mail entra normalizado — senão "OP@root.com" e "op@root.com" seriam dois acessos', () => {
    expect(conferirPedido({ ...base, operadorEmail: '  OP@Root.COM ' }, T0).operadorEmail).toBe(
      'op@root.com',
    );
  });
});

// ---------------------------------------------------------------------------
// 4. O SERVIÇO, com o cliente falso: autorizar, usar, expirar, registrar
// ---------------------------------------------------------------------------

interface LinhaFalsa {
  id: string;
  orgId: string;
  operadorEmail: string;
  operadorNome: string | null;
  escopo: string;
  motivo: string;
  autorizadoPorId: string;
  autorizadoPorNome: string;
  autorizadoEm: Date;
  expiraEm: Date;
  revogadoEm: Date | null;
  revogadoPorId: string | null;
  usos: number;
  ultimoUsoEm: Date | null;
  eventoId: string | null;
}

const TITULAR = {
  id: 'u-titular',
  nome: 'Dona da Empresa',
  email: 'dona@cliente.com',
  papeis: ['diretor'],
};
const OPERADOR = { id: 'u-op', nome: 'Suporte ROOT', email: 'op@root.com' };
const SENHA = 'a-senha-da-dona';

/** Um Prisma falso com estado: guarda `AcessoDeSuporte`, `User` e o rastro. */
function bancoDeSuporte(papeisNoBanco: string[] = ['diretor'], ativo = true) {
  const linhas: LinhaFalsa[] = [];
  const eventos: Array<{ tipo: string; nivel: unknown; conteudo: unknown; orgId: string; em: Date }> =
    [];
  let n = 0;
  let relogio = new Date(T0);

  const bate = (l: LinhaFalsa, where: Record<string, unknown>): boolean =>
    l.orgId === where.orgId &&
    (where.id === undefined || l.id === where.id) &&
    (where.operadorEmail === undefined || l.operadorEmail === where.operadorEmail);

  const prisma = {
    ...prismaFalso(),
    user: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        where.id === TITULAR.id && where.orgId === ORG_CLIENTE
          ? {
              id: TITULAR.id,
              isActive: ativo,
              passwordHash: 'hash-de-mentira',
              roles: papeisNoBanco.map((key) => ({ key })),
            }
          : null,
    },
    eventLog: {
      // Conta o RASTRO de verdade: é o que o teto lê.
      count: async ({ where }: { where: Record<string, unknown> }) => {
        const desde = (where.ocorreuEm as { gte?: Date } | undefined)?.gte;
        return eventos.filter(
          (e) =>
            e.orgId === where.orgId &&
            (where.tipo === undefined || e.tipo === where.tipo) &&
            (!desde || e.em >= desde),
        ).length;
      },
    },
    acessoDeSuporte: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const linha: LinhaFalsa = {
          id: `ac-${++n}`,
          orgId: String(data.orgId),
          operadorEmail: String(data.operadorEmail),
          operadorNome: (data.operadorNome as string | null) ?? null,
          escopo: String(data.escopo),
          motivo: String(data.motivo),
          autorizadoPorId: String(data.autorizadoPorId),
          autorizadoPorNome: String(data.autorizadoPorNome),
          autorizadoEm: data.autorizadoEm as Date,
          expiraEm: data.expiraEm as Date,
          revogadoEm: null,
          revogadoPorId: null,
          usos: 0,
          ultimoUsoEm: null,
          eventoId: null,
        };
        linhas.push(linha);
        return linha;
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        linhas.filter((l) => bate(l, where))[0] ?? null,
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        linhas
          .filter((l) => bate(l, where))
          .sort((a, b) => b.expiraEm.getTime() - a.expiraEm.getTime()),
      count: async () => linhas.length,
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const alvos = linhas.filter((l) => bate(l, where));
        for (const l of alvos) {
          if (data.eventoId !== undefined) l.eventoId = data.eventoId as string;
          if (data.revogadoEm !== undefined) l.revogadoEm = data.revogadoEm as Date;
          if (data.revogadoPorId !== undefined) l.revogadoPorId = data.revogadoPorId as string;
          if (data.ultimoUsoEm !== undefined) l.ultimoUsoEm = data.ultimoUsoEm as Date;
          if (data.usos !== undefined) l.usos += 1;
        }
        return { count: alvos.length };
      },
    },
  };

  const eventLog = {
    registrar: async (e: { orgId: string; tipo: string; nivel?: unknown; conteudo?: unknown }) => {
      eventos.push({
        tipo: e.tipo,
        nivel: e.nivel,
        conteudo: e.conteudo,
        orgId: e.orgId,
        em: relogio,
      });
      return { id: `ev-${eventos.length}`, seq: BigInt(eventos.length), hash: 'h' };
    },
  } as unknown as EventLogService;

  /** O verificador de reautenticação: confere a senha e devolve os papéis. */
  const conferidas: Array<{ userId: string; orgId: string; aprovacaoId: string }> = [];
  const reauth = {
    conferir: async (input: {
      userId: string;
      orgId: string;
      aprovacaoId: string;
      prova?: { senha?: string };
    }) => {
      conferidas.push({ userId: input.userId, orgId: input.orgId, aprovacaoId: input.aprovacaoId });
      if (input.prova?.senha !== SENHA) throw new Error('Senha incorreta.');
      return { em: relogio, papeis: papeisNoBanco, forma: 'senha' as const };
    },
  } as unknown as ReauthService;

  return {
    prisma,
    eventos,
    linhas,
    eventLog,
    reauth,
    conferidas,
    andarAte: (d: Date) => {
      relogio = d;
    },
  };
}

describe('o serviço de acesso de suporte', () => {
  let banco: ReturnType<typeof bancoDeSuporte>;
  let agora: Date;
  let servico: AcessoDeSuporteService;

  function montar(papeisNoBanco: string[] = ['diretor'], ativo = true): AcessoDeSuporteService {
    banco = bancoDeSuporte(papeisNoBanco, ativo);
    return new AcessoDeSuporteService(
      banco.prisma as unknown as PrismaService,
      banco.eventLog,
      new ConsoleDaPlataformaService(banco.prisma as unknown as PrismaService),
      banco.reauth,
      () => agora,
    );
  }

  beforeEach(() => {
    agora = new Date(T0);
    servico = montar();
  });

  const noCliente = <T>(fn: () => Promise<T>): Promise<T> =>
    comContexto({ orgId: ORG_CLIENTE, correlationId: 'cor-63' }, fn);

  /**
   * O operador roda na empresa DA PLATAFORMA — é dela a sessão dele.
   *
   * Envolver as chamadas de `usar()` nisto não é detalhe de teste: é o que
   * torna o caso fiel ao produto. `usar()` confere o registro da empresa AINDA
   * na plataforma e só então troca de contexto; sem o contexto de fora, a
   * conferência nem chegaria a acontecer.
   */
  const naPlataforma = <T>(fn: () => Promise<T>): Promise<T> =>
    comContexto({ orgId: ORG_PLATAFORMA, correlationId: 'cor-63' }, fn);

  /*
   * `senha` é `string | null` e não `string | undefined`: parâmetro com valor
   * padrão em JavaScript aplica o padrão TAMBÉM quando alguém passa `undefined`
   * de propósito — e o caso "sem senha a autorização é recusada" passaria com a
   * senha certa sem ninguém notar. `null` diz "não mande senha nenhuma".
   */
  const autorizar = (minutos = 60, quem = TITULAR, senha: string | null = SENHA) =>
    noCliente(() =>
      servico.autorizar(
        {
          operadorEmail: OPERADOR.email,
          escopo: 'diagnostico',
          motivo: 'cliente relatou erro ao publicar peça',
          minutos,
          senha: senha ?? undefined,
        },
        quem,
      ),
    );

  it('o cliente autoriza, e o RASTRO da EMPRESA DELE registra em R4 com motivo e antes/depois', async () => {
    const acesso = await autorizar();
    expect(acesso.estado).toBe('valido');
    expect(acesso.expiraEm).toBe(new Date(T0.getTime() + UMA_HORA).toISOString());

    const ev = banco.eventos.find((e) => e.tipo === EVENTO_AUTORIZADO);
    expect(ev, 'a autorização não foi registrada no RASTRO').toBeDefined();
    expect(ev!.orgId, 'o registro tem de ficar na empresa do CLIENTE').toBe(ORG_CLIENTE);
    expect(ev!.nivel).toBe('R4');
    const c = ev!.conteudo as Record<string, unknown>;
    expect(c.motivo).toContain('erro ao publicar');
    expect(c.estadoAnterior).toEqual({ acesso: 'nenhum' });
    expect((c.estadoNovo as Record<string, unknown>).operadorEmail).toBe(OPERADOR.email);
  });

  it('a linha guarda o id do evento — é o fio entre o registro e a prova encadeada', async () => {
    await autorizar();
    expect(banco.linhas[0].eventoId).toBe('ev-1');
  });

  it('conta de máquina NÃO autoriza acesso — quem concede acesso é gente', async () => {
    await expect(autorizar(60, { ...TITULAR, papeis: ['ia_acao'] })).rejects.toThrow(
      /Conta de serviço/i,
    );
  });

  it('ninguém autoriza acesso para si mesmo', async () => {
    await expect(
      noCliente(() =>
        servico.autorizar(
          {
            operadorEmail: TITULAR.email,
            escopo: 'diagnostico',
            motivo: 'a'.repeat(30),
            senha: SENHA,
          },
          TITULAR,
        ),
      ),
    ).rejects.toThrow(/para si mesmo/);
  });

  // --- a alçada vem do BANCO, não do token ----------------------------------

  it('CONTROLE NEGATIVO: o token diz `diretor`, e sozinho ele bastaria', () => {
    // O que a versão anterior lia. É a afirmação do vazamento: com este token na
    // mão, a alçada calculada é `titular` e a autorização passaria — mesmo que o
    // banco diga outra coisa.
    expect(TITULAR.papeis).toEqual(['diretor']);
  });

  it('REBAIXADO NO BANCO não autoriza, mesmo com o token antigo dizendo `diretor`', async () => {
    /*
     * O token vale OITO HORAS. A versão anterior lia `quem.papeis` dele, e quem
     * fosse rebaixado seguia autorizando acesso de suporte à própria empresa
     * pelo resto da sessão — com três comentários e a tela afirmando que a
     * alçada vinha do banco. É a mesma falha que a fatia 3.9 consertou na fila.
     */
    servico = montar(['analista']);
    await expect(autorizar(60, { ...TITULAR, papeis: ['diretor'] })).rejects.toThrow(
      /alçada titular/i,
    );
    // E nada foi criado: a recusa acontece antes da escrita.
    expect(banco.linhas).toHaveLength(0);
    /*
     * E ANTES DA SENHA. Sem esta linha o caso passaria com a leitura do banco
     * REMOVIDA — a reconferência pós-reautenticação também pega o rebaixado, e
     * o verde não distinguiria as duas defesas. Medido: com a releitura fora, a
     * recusa acontecia só depois de o sistema pedir a senha de quem já não tem
     * alçada nenhuma, que é pedir credencial à toa.
     */
    expect(banco.conferidas, 'pediu a senha antes de conferir a alçada do banco').toHaveLength(0);
  });

  it('DESATIVADO no banco não autoriza — nem com papel alto', async () => {
    servico = montar(['diretor'], false);
    await expect(autorizar()).rejects.toThrow(/usuário ativo/i);
  });

  it('conta de máquina NO BANCO não autoriza, mesmo com o token limpo', async () => {
    servico = montar(['ia_servico']);
    await expect(autorizar(60, { ...TITULAR, papeis: ['diretor'] })).rejects.toThrow(
      /Conta de serviço/i,
    );
  });

  // --- a reautenticação ------------------------------------------------------

  it('R4 exige REAUTENTICAÇÃO, e sem senha a autorização é recusada', async () => {
    expect(EXIGE_REAUTENTICACAO).toBe(true);
    await expect(autorizar(60, TITULAR, null)).rejects.toThrow(/senha/i);
    expect(banco.linhas).toHaveLength(0);
  });

  it('senha errada é recusada pelo verificador, e nada é criado', async () => {
    await expect(autorizar(60, TITULAR, 'senha-errada')).rejects.toThrow(/senha/i);
    expect(banco.linhas).toHaveLength(0);
  });

  it('a reautenticação é presa à PESSOA e à EMPRESA da sessão', async () => {
    await autorizar();
    expect(banco.conferidas).toEqual([
      { userId: TITULAR.id, orgId: ORG_CLIENTE, aprovacaoId: `suporte:${ORG_CLIENTE}` },
    ]);
  });

  it('sem verificador na instância, a autorização RECUSA — não passa por cima', async () => {
    // Trava que depende de serviço opcional é trava que some quando o serviço
    // some. Aqui a ausência fecha, como em `ApprovalsService.confirm`.
    banco = bancoDeSuporte();
    const semReauth = new AcessoDeSuporteService(
      banco.prisma as unknown as PrismaService,
      banco.eventLog,
      new ConsoleDaPlataformaService(banco.prisma as unknown as PrismaService),
      undefined,
      () => agora,
    );
    await expect(
      noCliente(() =>
        semReauth.autorizar(
          {
            operadorEmail: OPERADOR.email,
            escopo: 'diagnostico',
            motivo: 'a'.repeat(30),
            senha: SENHA,
          },
          TITULAR,
        ),
      ),
    ).rejects.toThrow(/reautenticação/i);
  });

  // --- usar o acesso ---------------------------------------------------------

  it('DENTRO do prazo o operador entra, recebe CONTAGENS e o uso fica registrado', async () => {
    await autorizar();
    const diag = await naPlataforma(() => servico.usar(ORG_CLIENTE, OPERADOR, 'diagnostico'));

    expect(diag.sessoesNaJanela).toBe(7);
    expect(diag.aprovacoesPendentes).toBe(2);
    expect(diag.rotinasQueFalharam).toBe(1);
    // Nenhum campo do diagnóstico carrega texto de cliente: só número e prazo.
    for (const v of Object.values(diag)) {
      expect(typeof v === 'number' || typeof v === 'string').toBe(true);
    }

    const uso = banco.eventos.find((e) => e.tipo === EVENTO_USADO);
    expect(uso, 'o uso não foi registrado').toBeDefined();
    expect(uso!.orgId).toBe(ORG_CLIENTE);
    expect(banco.linhas[0].usos).toBe(1);
    expect(banco.linhas[0].ultimoUsoEm?.toISOString()).toBe(T0.toISOString());
  });

  it('DEPOIS do prazo a TENTATIVA falha — e a recusa também fica registrada', async () => {
    await autorizar(60);

    // O relógio anda. Nada mais acontece: nenhum cron, nenhuma varredura,
    // ninguém marcou a linha como expirada. É a tentativa que descobre.
    agora = new Date(T0.getTime() + 2 * UMA_HORA);
    banco.andarAte(agora);

    await expect(naPlataforma(() => servico.usar(ORG_CLIENTE, OPERADOR, 'diagnostico'))).rejects.toThrow(
      AcessoDeSuporteNegadoError,
    );

    const negado = banco.eventos.find((e) => e.tipo === EVENTO_NEGADO);
    expect(negado, 'a tentativa negada não foi registrada — é ela que interessa a quem audita')
      .toBeDefined();
    expect((negado!.conteudo as Record<string, unknown>).argumentos).toMatchObject({
      recusa: 'expirado',
    });
    // E o uso NÃO foi contado: a recusa aconteceu antes de qualquer leitura.
    expect(banco.linhas[0].usos).toBe(0);
  });

  it('CONTROLE NEGATIVO do prazo: com o relógio parado no instante da autorização, o mesmo acesso passa', async () => {
    // O caso acima ficaria verde se `usar()` estivesse quebrado e recusasse
    // sempre. Este mostra o mesmo acesso, a mesma chamada, passando — a única
    // coisa que mudou entre os dois é o relógio.
    await autorizar(60);
    await expect(naPlataforma(() => servico.usar(ORG_CLIENTE, OPERADOR, 'diagnostico'))).resolves.toBeDefined();
  });

  it('revogado, a tentativa falha antes do prazo', async () => {
    const acesso = await autorizar(600);
    await noCliente(() => servico.revogar(acesso.id, TITULAR));
    agora = new Date(T0.getTime() + UMA_HORA);
    await expect(naPlataforma(() => servico.usar(ORG_CLIENTE, OPERADOR, 'diagnostico'))).rejects.toMatchObject({
      motivo: 'revogado',
    });
  });

  it('com DUAS autorizações vivas, o operador entra pela que vale', async () => {
    // O par exato que a regra antiga confundia: a revogada tem prazo maior.
    const longa = await autorizar(600);
    await noCliente(() => servico.revogar(longa.id, TITULAR));
    await autorizar(60);
    await expect(
      naPlataforma(() => servico.usar(ORG_CLIENTE, OPERADOR, 'diagnostico')),
    ).resolves.toBeDefined();
  });

  it('empresa NÃO registrada no console é recusada antes de qualquer troca de contexto', async () => {
    /*
     * `empresaId` chega pelo caminho da rota. Sem esta conferência, quem tivesse
     * sessão de plataforma abriria o contexto de QUALQUER empresa. O que ela NÃO
     * faz — e a primeira versão desta fatia dizia que fazia — é conter enchente
     * do rastro em empresa REGISTRADA. Quem faz isso é o teto, logo abaixo.
     */
    const semRegistro = new AcessoDeSuporteService(
      banco.prisma as unknown as PrismaService,
      banco.eventLog,
      { empresa: async () => null } as unknown as ConsoleDaPlataformaService,
      banco.reauth,
      () => agora,
    );
    await expect(
      naPlataforma(() => semRegistro.usar('org-que-nao-existe', OPERADOR, 'diagnostico')),
    ).rejects.toThrow(AutorizacaoInvalidaError);
    // E nada foi para o RASTRO da empresa inventada.
    expect(banco.eventos).toEqual([]);
  });

  it('OUTRO operador não usa a autorização alheia', async () => {
    await autorizar();
    await expect(
      naPlataforma(() => servico.usar(ORG_CLIENTE, { ...OPERADOR, email: 'outro@root.com' }, 'diagnostico')),
    ).rejects.toMatchObject({ motivo: 'sem_autorizacao' });
  });

  it('mesmo COM autorização válida, o operador não abre registro — a cerca continua de pé', async () => {
    await autorizar();
    // `usar()` roda dentro do contexto do cliente, que sob o papel restrito daria
    // à conexão o alcance da policy DAQUELA empresa. O que segura é a cerca: o
    // serviço só tem `count` nas tabelas de cliente.
    const cerca = cercar(banco.prisma, SUPERFICIE_DO_SUPORTE, 'suporte') as Record<string, unknown>;
    expect(() => cerca.lead).toThrow(ForaDaSuperficieError);
    expect(() => (cerca as { session: { findMany: unknown } }).session.findMany).toThrow(
      ForaDaSuperficieError,
    );
  });

  // --- o teto do rastro ------------------------------------------------------

  it('o operador NÃO enche o rastro do cliente: a recusa para de virar linha no teto', async () => {
    /*
     * Cada tentativa negada grava evento no rastro DA EMPRESA CLIENTE, e evento
     * do rastro não se apaga. Sem teto, um laço enche o registro de auditoria de
     * qualquer empresa registrada — e a semente da migration registra todas.
     */
    for (let i = 0; i < LIMITE_DE_RECUSAS_NA_JANELA + 7; i++) {
      await expect(
        naPlataforma(() => servico.usar(ORG_CLIENTE, OPERADOR, 'diagnostico')),
      ).rejects.toThrow(AcessoDeSuporteNegadoError);
    }
    const negados = banco.eventos.filter((e) => e.tipo === EVENTO_NEGADO);
    expect(negados).toHaveLength(LIMITE_DE_RECUSAS_NA_JANELA);

    // E uma ÚNICA linha de teto por janela, dizendo que o padrão existe.
    const tetos = banco.eventos.filter((e) => e.tipo === EVENTO_TETO_DE_RECUSA);
    expect(tetos).toHaveLength(1);
    expect((tetos[0].conteudo as Record<string, unknown>).resultado).toMatchObject({
      janelaMinutos: JANELA_DO_TETO_MINUTOS,
    });
  });

  it('CONTROLE NEGATIVO do teto: a recusa CONTINUA sendo recusa depois dele', async () => {
    // O caso acima ficaria verde se o teto tivesse virado "deixa passar". A
    // tentativa de número vinte continua sendo recusada — o que some é a LINHA
    // nova no rastro, não a proteção.
    for (let i = 0; i < LIMITE_DE_RECUSAS_NA_JANELA + 15; i++) {
      await expect(
        naPlataforma(() => servico.usar(ORG_CLIENTE, OPERADOR, 'diagnostico')),
      ).rejects.toMatchObject({ motivo: 'sem_autorizacao' });
    }
    expect(banco.eventos.filter((e) => e.tipo === EVENTO_NEGADO)).toHaveLength(
      LIMITE_DE_RECUSAS_NA_JANELA,
    );
  });

  it('passada a janela, a recusa volta a ser registrada — o teto não é mordaça permanente', async () => {
    for (let i = 0; i < LIMITE_DE_RECUSAS_NA_JANELA + 2; i++) {
      await naPlataforma(() => servico.usar(ORG_CLIENTE, OPERADOR, 'diagnostico')).catch(() => undefined);
    }
    expect(banco.eventos.filter((e) => e.tipo === EVENTO_NEGADO)).toHaveLength(
      LIMITE_DE_RECUSAS_NA_JANELA,
    );

    agora = new Date(T0.getTime() + (JANELA_DO_TETO_MINUTOS + 1) * 60_000);
    banco.andarAte(agora);
    await naPlataforma(() => servico.usar(ORG_CLIENTE, OPERADOR, 'diagnostico')).catch(() => undefined);
    expect(banco.eventos.filter((e) => e.tipo === EVENTO_NEGADO)).toHaveLength(
      LIMITE_DE_RECUSAS_NA_JANELA + 1,
    );
  });
});

describe('o serviço do console', () => {
  it('lê a empresa da SESSÃO — nunca uma empresa vinda do pedido', async () => {
    const chamadas: Chamada[] = [];
    const servico = new ConsoleDaPlataformaService(
      prismaFalso(chamadas) as unknown as PrismaService,
    );
    await comContexto({ orgId: ORG_PLATAFORMA, correlationId: 'c' }, () => servico.empresas());
    const where = (chamadas[0].args as { where: { orgId: string } }).where;
    expect(where.orgId).toBe(ORG_PLATAFORMA);
  });

  it('sem empresa na sessão, LANÇA — nunca "todas"', async () => {
    const servico = new ConsoleDaPlataformaService(prismaFalso() as unknown as PrismaService);
    await expect(servico.empresas()).rejects.toThrow(/tenant não resolvido/i);
  });
});

// ---------------------------------------------------------------------------
// 5. CATRACAS ESTÁTICAS — o que o código do console PODE tocar
// ---------------------------------------------------------------------------

function acharRaizDaApi(): string {
  const marco = path.join('src', 'prisma', 'sessao-de-banco.ts');
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, marco))) return dir;
    if (existsSync(path.join(dir, 'apps', 'api', marco))) return path.join(dir, 'apps', 'api');
    dir = path.dirname(dir);
  }
  throw new Error(`não achei a raiz de apps/api a partir de ${process.cwd()}`);
}

const RAIZ = acharRaizDaApi();
const PASTA = path.join(RAIZ, 'src', 'platform');

function arquivosDoConsole(): string[] {
  return readdirSync(PASTA).filter((f) => f.endsWith('.ts'));
}

/**
 * Todo par (modelo, operação) alcançado por uma cerca, lido do código-fonte.
 *
 * O NOME DO CAMPO É CURINGA (`this.<qualquerCoisa>.<modelo>.<op>`), e isso é
 * conserto de 11/09/2026: a versão anterior casava só `this.cerca.`, então
 * `this.cercaDoCliente.` passava despercebido — e, pior, `this.cerca.$transaction`
 * também, porque o `$` não casa com `\w`. Uma catraca que não vê o símbolo que o
 * código usa é uma catraca que mede o arquivo errado.
 */
function paresUsados(fonte: string): string[] {
  const re = /this\.(?:cerca|cercaDoCliente|prisma)[A-Za-z]*\.([$\w]+)\.([$\w]+)\s*\(/g;
  const achados: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(fonte)) !== null) achados.push(`${m[1]}.${m[2]}`);
  return achados;
}

describe('catraca: o código do console só alcança o que as superfícies declaram', () => {
  const declarados = new Set(
    [...SUPERFICIE_DO_CONSOLE, ...SUPERFICIE_DO_CLIENTE, ...SUPERFICIE_DO_SUPORTE].flatMap((m) =>
      m.operacoes.map((op) => `${m.modelo}.${op}`),
    ),
  );

  it('a varredura acha os arquivos (piso: varredura vazia passaria em tudo)', () => {
    expect(arquivosDoConsole().length).toBeGreaterThanOrEqual(5);
  });

  it('CONTROLE NEGATIVO: o leitor de pares enxerga violação plantada — inclusive com `$`', () => {
    // Sem este caso, um regex quebrado devolveria zero pares e o caso seguinte
    // passaria vazio — verde em silêncio, que é como catraca morre.
    const canario = 'const x = await this.cerca.lead.findMany({ where: { orgId } });';
    expect(paresUsados(canario)).toEqual(['lead.findMany']);
    expect(declarados.has('lead.findMany')).toBe(false);

    // As duas formas que a versão anterior NÃO via.
    expect(paresUsados('await this.cercaDoCliente.lead.findMany({});')).toEqual(['lead.findMany']);
    expect(paresUsados('await this.cerca.$transaction.run({});')).toEqual(['$transaction.run']);
  });

  it('nenhum par usado está fora das superfícies', () => {
    const foras: string[] = [];
    let total = 0;
    for (const arquivo of arquivosDoConsole()) {
      const fonte = readFileSync(path.join(PASTA, arquivo), 'utf8');
      for (const par of paresUsados(fonte)) {
        total += 1;
        if (!declarados.has(par)) foras.push(`${arquivo}: ${par}`);
      }
    }
    expect(total, 'nenhum par encontrado — o regex quebrou?').toBeGreaterThan(5);
    expect(foras, `pares fora das superfícies: ${foras.join(', ')}`).toEqual([
      // A ÚNICA exceção, e ela é do guarda: `SessaoDaPlataformaGuard` pergunta
      // `org.findFirst({ where: { id: <a própria>, slug } })` para saber se ESTA
      // sessão é a da plataforma. Não passa por cerca porque é a pergunta que
      // decide quem entra nela — e a consulta filtra pela empresa da PRÓPRIA
      // sessão, então ela é incapaz de enxergar outra, com ou sem policy.
      'sessao-da-plataforma.guard.ts: org.findFirst',
    ]);
  });

  it('nenhum arquivo do console usa SQL cru', () => {
    /*
     * SQL cru atravessa a cerca por modelo — é por isso que `$queryRawUnsafe` e
     * os irmãos nunca estiveram na lista de infraestrutura (que hoje é vazia).
     *
     * O PONTO ANTES DO CIFRÃO não é enfeite do regex: sem ele a catraca ficava
     * vermelha por causa do PRÓPRIO COMENTÁRIO de `plataforma.ts`, que NOMEIA
     * os métodos proibidos para explicar a ausência deles. Chamada de verdade é
     * sempre `<alguma coisa>.$queryRaw…`; menção em texto, não.
     */
    const comRaw = arquivosDoConsole().filter((a) =>
      /\.\$(query|execute)Raw/.test(readFileSync(path.join(PASTA, a), 'utf8')),
    );
    expect(comRaw).toEqual([]);
  });

  it('CONTROLE NEGATIVO: a busca por SQL cru enxerga uma chamada plantada', () => {
    const canario = 'await this.prisma.$queryRawUnsafe(`SELECT * FROM "Lead"`);';
    expect(/\.\$(query|execute)Raw/.test(canario)).toBe(true);
    // E não confunde a MENÇÃO com a chamada — que é o que o caso acima precisa.
    expect(/\.\$(query|execute)Raw/.test('não use `$queryRawUnsafe` aqui')).toBe(false);
  });

  it('o console NÃO abre o contexto de plataforma — e é a decisão da fatia', () => {
    /*
     * A sentinela de `src/prisma/contexto-de-plataforma.ts` libera leitura de
     * `Org`, `User` e `Role` de TODAS as empresas. Seria o caminho curto para
     * listar clientes, e daria ao console a lista de quem trabalha em cada um,
     * com e-mail e papel — dado de cliente, que é justamente o que este console
     * não vê. Por isso o registro do console mora em tabela da PRÓPRIA
     * plataforma, e este caso é o que impede a decisão de ser desfeita sem
     * aparecer em diff.
     */
    const importam = arquivosDoConsole().filter((a) =>
      /from\s*['"][^'"]*contexto-de-plataforma/.test(readFileSync(path.join(PASTA, a), 'utf8')),
    );
    expect(importam).toEqual([]);
  });

  it('o console NÃO declara uma segunda `SLUG_DA_PLATAFORMA` — importa a que existe', () => {
    /*
     * O defeito mais caro da primeira versão: uma homônima valendo `'plataforma'`
     * ao lado da de `tenants/provisionar.ts`, que vale `'root'`. A empresa que
     * provisiona não abria o console, a que abriria não existia, e `plataforma`
     * seguia livre no cadastro anônimo — quem se cadastrasse com esse nome
     * levava o identificador e travava para sempre a criação da empresa do
     * console. Autocomplete errado troca de significado em silêncio; esta
     * catraca é o que faz o silêncio virar vermelho.
     */
    const declaram = arquivosDoConsole().filter((a) =>
      /(?:const|let|var|function)\s+SLUG_DA_PLATAFORMA\b/.test(
        readFileSync(path.join(PASTA, a), 'utf8'),
      ),
    );
    expect(declaram, `declararam uma homônima: ${declaram.join(', ')}`).toEqual([]);
    // E o valor em uso é o da constante de verdade, não uma cópia literal.
    expect(SLUG_DA_PLATAFORMA).toBe('root');
  });

  it('o prefixo de rota do console está DECLARADO — senão ele falha em execução', () => {
    /*
     * `moduloDoCaminho` LANÇA para prefixo que ninguém declarou
     * (`src/tenants/modulos.ts`), e o interceptor então LIBERA a rota com um log
     * — quer dizer, prefixo esquecido vira rota que nunca desliga. As rotas do
     * console entram na família `tenants`, que já é espinha declarada; este caso
     * é o que descobre se alguém mudar o prefixo sem declarar o novo.
     */
    const prefixos = new Set<string>();
    for (const arquivo of arquivosDoConsole()) {
      const fonte = readFileSync(path.join(PASTA, arquivo), 'utf8');
      const re = /@Controller\(\s*['"]([^'"]*)['"]\s*\)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(fonte)) !== null) prefixos.add(m[1]);
    }
    expect(prefixos.size, 'nenhum @Controller encontrado').toBeGreaterThan(0);
    for (const p of prefixos) {
      expect(() => moduloDoCaminho(`/api/${p}/x`), `prefixo "${p}" não declarado`).not.toThrow();
      // E espinha, não módulo: o console não se contrata.
      expect(moduloDoCaminho(`/api/${p}/x`), `prefixo "${p}" virou módulo de negócio`).toBeNull();
    }
  });

  it('o módulo do console está registrado no AppModule — senão as rotas somem', () => {
    // Módulo que ninguém importa é rota que responde 404 sem erro nenhum no
    // arranque. A linha existe, e esta catraca é o que impede que ela suma.
    const app = readFileSync(path.join(RAIZ, 'src', 'app.module.ts'), 'utf8');
    expect(app).toContain("from './platform/plataforma.module'");
    expect(app).toMatch(/^\s*PlataformaModule,\s*$/m);
  });

  it('entrar na casa do cliente não pede permissão MAIS FRACA que editar o registro comercial', () => {
    /*
     * Na primeira versão as duas estavam invertidas em sensibilidade: usar o
     * acesso de suporte pedia `dashboard.ver` (que todo papel tem, inclusive
     * `consulta_limitada`) e corrigir uma mensalidade pedia `admin.permissoes`.
     */
    const fonte = readFileSync(path.join(PASTA, 'plataforma.controller.ts'), 'utf8');
    const suporte = /@Post\('empresas\/:empresaId\/suporte'\)\s*\n\s*@RequirePermissions\('([^']+)'\)/.exec(
      fonte,
    );
    const registro = /@Put\('empresas\/:empresaId'\)\s*\n\s*@RequirePermissions\('([^']+)'\)/.exec(fonte);
    expect(suporte?.[1], 'a rota de suporte perdeu a permissão').toBe('admin.permissoes');
    expect(registro?.[1]).toBe('admin.permissoes');
  });

  it('todo escopo declarado tem leitura, e toda leitura tem escopo', () => {
    // Escopo sem leitura é promessa vazia na tela do cliente; leitura sem escopo
    // é acesso que ninguém autorizou.
    expect([...ESCOPOS_DE_SUPORTE]).toEqual(['diagnostico']);
    const fonte = readFileSync(path.join(PASTA, 'acesso-de-suporte.service.ts'), 'utf8');
    for (const escopo of ESCOPOS_DE_SUPORTE) expect(fonte).toContain(escopo);
  });

  it('as duas tabelas desta fatia estão no registro da suíte de isolamento', () => {
    /*
     * A CATRACA QUE A REVISÃO COBROU. `test/tenant-isolation.test.ts` é a suíte
     * permanente do isolamento por linha, e ela só MEDE o que está no registro
     * `ALVOS` e semeado nas duas empresas. Sem as duas entradas, o isolamento de
     * `EmpresaNaPlataforma` e `AcessoDeSuporte` só era medido pela seção
     * condicional desta fatia — a que exige duas variáveis de ambiente para
     * sequer existir.
     *
     * A conferência é sobre o ARQUIVO, e não sobre o banco, porque roda no
     * conjunto PADRÃO: é o que a CI executa sempre.
     */
    const suite = readFileSync(path.join(RAIZ, 'test', 'tenant-isolation.test.ts'), 'utf8');
    for (const tabela of ['EmpresaNaPlataforma', 'AcessoDeSuporte']) {
      expect(suite, `${tabela} fora de ALVOS`).toContain(`{ tabela: '${tabela}'`);
      expect(suite, `${tabela} sem semente`).toContain(`reg('${tabela}', await ins(c, '${tabela}'`);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. A POLICY — a outra metade, com as DUAS conexões
// ---------------------------------------------------------------------------

const URL_DONA = process.env.TEST_DATABASE_URL ?? '';
const URL_RESTRITA = process.env.TENANT_DATABASE_URL ?? '';

if (URL_DONA && URL_RESTRITA) {
  exigirBancoDescartavel(URL_DONA, 'cria empresas e acessos de suporte e os apaga depois');

  describe('o isolamento por linha, com o papel restrito e com o papel dono', () => {
    const PLAT = 'org-63-plataforma';
    const CLI = 'org-63-cliente';
    let dona: Client;
    let restrita: Client;

    async function comEmpresa<T>(c: Client, orgId: string, sql: string): Promise<T[]> {
      await c.query('BEGIN');
      await c.query('SELECT set_config($1,$2,true)', ['app.org_id', orgId]);
      const r = await c.query(sql);
      await c.query('COMMIT');
      return r.rows as T[];
    }

    it('semeia', async () => {
      dona = new Client({ connectionString: URL_DONA });
      restrita = new Client({ connectionString: URL_RESTRITA });
      await dona.connect();
      await restrita.connect();

      await dona.query('BEGIN');
      await dona.query('SELECT set_config($1,$2,true)', ['app.org_id', PLAT]);
      await dona.query(
        `INSERT INTO "Org"(id,name,slug,modulos) VALUES ($1,'Plataforma 6.3',$2,'{}')
           ON CONFLICT (id) DO NOTHING`,
        // O slug de teste deriva da constante de VERDADE (`root`), com sufixo:
        // `Org.slug` é único e a empresa real não pode ser tocada pela suíte.
        [PLAT, `${SLUG_DA_PLATAFORMA}-63`],
      );
      await dona.query('SELECT set_config($1,$2,true)', ['app.org_id', CLI]);
      await dona.query(
        `INSERT INTO "Org"(id,name,slug,modulos) VALUES ($1,'Cliente 6.3','cliente-63','{leads}')
           ON CONFLICT (id) DO NOTHING`,
        [CLI],
      );
      await dona.query(
        `INSERT INTO "Lead"(id,"orgId",name,"updatedAt") VALUES ('lead-63',$1,'Fulano 63',now())
           ON CONFLICT (id) DO NOTHING`,
        [CLI],
      );
      await dona.query(
        `INSERT INTO "AcessoDeSuporte"(id,"orgId","operadorEmail",escopo,motivo,
             "autorizadoPorId","autorizadoPorNome","expiraEm")
           VALUES ('ac-63',$1,'op@root.com','diagnostico','motivo escrito pelo cliente',
                   'u','Titular', now() + interval '1 hour')
           ON CONFLICT (id) DO NOTHING`,
        [CLI],
      );
      await dona.query('SELECT set_config($1,$2,true)', ['app.org_id', PLAT]);
      await dona.query(
        `INSERT INTO "EmpresaNaPlataforma"(id,"orgId","empresaId",nome,slug,"atualizadoEm")
           VALUES ('emp-63',$1,$2,'Cliente 6.3','cliente-63',now())
           ON CONFLICT (id) DO NOTHING`,
        [PLAT, CLI],
      );
      await dona.query('COMMIT');
      expect(true).toBe(true);
    }, 30_000);

    it('a sessão da plataforma LÊ o registro do console', async () => {
      const r = await comEmpresa<{ n: string }>(
        restrita,
        PLAT,
        'SELECT count(*)::text AS n FROM "EmpresaNaPlataforma"',
      );
      expect(Number(r[0].n)).toBeGreaterThanOrEqual(1);
    });

    it('a sessão da plataforma NÃO lê registro de empresa nenhuma', async () => {
      for (const tabela of ['Lead', 'AcessoDeSuporte', 'User', 'Session', 'EventLog']) {
        const r = await comEmpresa<{ n: string }>(
          restrita,
          PLAT,
          `SELECT count(*)::text AS n FROM "${tabela}"`,
        );
        expect(Number(r[0].n), `a plataforma leu ${tabela}`).toBe(0);
      }
    });

    it('a sessão da plataforma só enxerga a PRÓPRIA Org', async () => {
      const r = await comEmpresa<{ id: string }>(restrita, PLAT, 'SELECT id FROM "Org"');
      expect(r.map((x) => x.id)).toEqual([PLAT]);
    });

    it('o CLIENTE vê o acesso de suporte que autorizou — e não vê o registro do console', async () => {
      const acessos = await comEmpresa<{ n: string }>(
        restrita,
        CLI,
        'SELECT count(*)::text AS n FROM "AcessoDeSuporte"',
      );
      expect(Number(acessos[0].n)).toBeGreaterThanOrEqual(1);
      const console_ = await comEmpresa<{ n: string }>(
        restrita,
        CLI,
        'SELECT count(*)::text AS n FROM "EmpresaNaPlataforma"',
      );
      expect(Number(console_[0].n)).toBe(0);
    });

    it('a plataforma não ESCREVE na casa do cliente — nem com o id dele no INSERT', async () => {
      await restrita.query('BEGIN');
      await restrita.query('SELECT set_config($1,$2,true)', ['app.org_id', PLAT]);
      await expect(
        restrita.query(
          `INSERT INTO "AcessoDeSuporte"(id,"orgId","operadorEmail",escopo,motivo,
             "autorizadoPorId","autorizadoPorNome","expiraEm")
           VALUES ('ac-63-forjado',$1,'op@root.com','diagnostico','forjado',
                   'u','x', now() + interval '1 hour')`,
          [CLI],
        ),
      ).rejects.toThrow(/row-level security/i);
      await restrita.query('ROLLBACK');
    });

    it('CONTRAPROVA: com o papel DONO a mesma sessão lê tudo — hoje quem protege é a cerca', async () => {
      /*
       * Este caso afirma o VAZAMENTO, de propósito, e é a razão de a cerca
       * existir. A aplicação conecta como dona das tabelas hoje
       * (`anunciarPapel`), e sob conexão dona a policy é inerte. Se um dia ele
       * ficar vermelho, é porque a virada para o papel restrito aconteceu — e aí
       * a linha a mudar é esta, não a defesa.
       */
      const r = await comEmpresa<{ n: string }>(
        dona,
        PLAT,
        'SELECT count(*)::text AS n FROM "Lead" WHERE id = \'lead-63\'',
      );
      expect(Number(r[0].n)).toBe(1);
    });

    it('limpa o que semeou', async () => {
      await dona.query('SELECT set_config($1,$2,true)', ['app.org_id', PLAT]);
      await dona.query(`DELETE FROM "EmpresaNaPlataforma" WHERE id = 'emp-63'`);
      await dona.query(`DELETE FROM "AcessoDeSuporte" WHERE id LIKE 'ac-63%'`);
      await dona.query(`DELETE FROM "Lead" WHERE id = 'lead-63'`);
      await dona.query(`DELETE FROM "Org" WHERE id IN ($1,$2)`, [PLAT, CLI]);
      await dona.end();
      await restrita.end();
      expect(true).toBe(true);
    }, 30_000);
  });
}
