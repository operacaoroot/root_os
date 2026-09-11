import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import politicaRoot from '@mktos/policy/politica-root.json';
import { EventLogService, TIPO_EXPURGO, canonizar } from '../src/gateway/event-log.service';
import { RetencaoService } from '../src/audit/retencao.service';
import { ExpurgoService, ExpurgoIndisponivelError } from '../src/audit/expurgo.service';
import { comTenantNaSessao } from '../src/prisma/sessao-de-banco';
import { comContexto } from '../src/common/contexto-execucao';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * RETENÇÃO POR EMPRESA E EXPURGO DO RASTRO — RF-R-06.
 *
 * A pergunta deste arquivo: o prazo de guarda é DE CADA EMPRESA, o que apaga por
 * vencimento tem quem o chame, e ele não fica ao alcance da aplicação em
 * operação normal?
 *
 * Precisa de banco de verdade, e não dá para fingir: as travas que importam são
 * do PostgreSQL — a RULE de append-only (`DO INSTEAD NOTHING`, que engole o
 * DELETE em silêncio), a policy de linha, o REVOKE do papel, a exigência de ser
 * DONO da tabela para desligar a RULE e — desde 11/09/2026 — o INSERT do evento
 * do expurgo DENTRO da mesma transação que apaga. Um dobrê de Prisma mediria a
 * opinião do teste sobre o banco.
 *
 *   TEST_DATABASE_URL='postgresql://mkt:shadow@localhost:55432/marketing_os_test' \
 *     npx vitest run test/rastro-retencao.test.ts
 *
 * O QUE ESTA SUÍTE FAZ COM O BANCO, e por que o guarda existe: ela EXPURGA
 * linhas do `EventLog` — isto é, apaga rastro. Apontá-la para o banco errado é
 * o único jeito de perder evento de produção, então o nome do banco tem de se
 * anunciar como descartável.
 *
 * UMA NOTA SOBRE RODAR EM PARALELO: o expurgo pega ACCESS EXCLUSIVE em
 * `EventLog` enquanto desliga e religa a RULE. A janela é de milissegundos e a
 * função tem `lock_timeout` de 5 s, mas se um dia esta suíte começar a falhar
 * com 55P03 num banco compartilhado, a causa é essa e não um defeito do código.
 *
 * E UMA SOBRE A LIMPEZA: a faxina desta suíte desliga a RULE de append-only para
 * poder apagar o que ela mesma escreveu — e `EventLog` é do banco INTEIRO, que é
 * compartilhado com os outros arquivos rodando em paralelo. Por isso ela roda
 * numa TRANSAÇÃO só (`apagarRastroDeTeste`): o `ALTER TABLE` segura ACCESS
 * EXCLUSIVE até o commit, então enquanto a RULE está desligada NENHUMA outra
 * sessão consegue sequer ler a tabela, e um worker morto no meio derruba a
 * transação e devolve a RULE ligada. Fora de transação, três comandos soltos
 * deixavam o banco inteiro sem append-only por uma janela visível — e para
 * sempre, se o processo morresse entre o segundo e o terceiro.
 */

const URL = process.env.TEST_DATABASE_URL;
const URL_RESTRITA = process.env.TENANT_DATABASE_URL;
const ORG_A = 'org-teste-retencao-a';
const ORG_B = 'org-teste-retencao-b';
const PADRAO = (politicaRoot.retencao as { rastroDias: number }).rastroDias;

exigirBancoDescartavel(URL ?? '', 'EXPURGA linhas do RASTRO (apaga evento)');

/** O log antigo continua escrevendo; aqui ele é dobrê porque não é o assunto. */
const auditoriaDeMentira = { log: async () => undefined };

/**
 * Apaga o rastro que ESTA suíte escreveu, numa transação só.
 *
 * Ver a nota do cabeçalho: a RULE de append-only é do banco inteiro e os
 * arquivos de teste rodam em paralelo contra ele. Desligá-la fora de transação
 * abriria o append-only para todo mundo — e worker morto entre o DELETE e o
 * `ENABLE RULE` deixaria o banco assim para sempre.
 */
async function apagarRastroDeTeste(admin: PrismaClient, orgIds: string[]): Promise<void> {
  if (orgIds.length === 0) return;
  const marcadores = orgIds.map((_, i) => `$${i + 1}`).join(', ');
  await admin.$transaction([
    admin.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
    admin.$executeRawUnsafe(`DELETE FROM "EventLog" WHERE "orgId" IN (${marcadores})`, ...orgIds),
    admin.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
  ]);
}

describe.skipIf(!URL)('retenção do rastro por empresa', () => {
  let admin: PrismaClient;
  let prisma: PrismaClient;
  let eventos: EventLogService;
  let retencao: RetencaoService;

  const naEmpresa = <T>(orgId: string, fn: () => Promise<T>) =>
    comContexto({ orgId, actorType: 'system', correlationId: `teste-${orgId}` }, fn);

  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: URL } } });
    await admin.$connect();

    for (const [id, slug] of [
      [ORG_A, 'teste-retencao-a'],
      [ORG_B, 'teste-retencao-b'],
    ]) {
      await admin.org.upsert({
        where: { id },
        update: {},
        create: { id, name: id, slug, modulos: [] },
      });
    }

    // O cliente EMBRULHADO, e não um `PrismaClient` cru: é ele que põe
    // `SET LOCAL app.org_id` na frente de cada consulta, e é disso que
    // `app_rastro_expurgar` precisa para conferir que a empresa pedida é a da
    // sessão. Com o cliente cru a função recusaria — e recusar é o certo.
    prisma = comTenantNaSessao(new PrismaClient({ datasources: { db: { url: URL } } }), {
      modo: 'observar',
    });
    eventos = new EventLogService(prisma as never);
    retencao = new RetencaoService(prisma as never, eventos, auditoriaDeMentira as never);
  });

  afterAll(async () => {
    vi.useRealTimers();
    await apagarRastroDeTeste(admin, [ORG_A, ORG_B]);
    await admin.rastroRetencao.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await admin.auditLog.deleteMany({ where: { orgId: { in: [ORG_A, ORG_B] } } });
    await admin.org.deleteMany({ where: { id: { in: [ORG_A, ORG_B] } } });
    await admin.$disconnect();
    await (prisma as PrismaClient).$disconnect();
  });

  it('empresa sem configuração HERDA o prazo da política, sem materializar linha', async () => {
    const lido = await naEmpresa(ORG_B, () => retencao.ler(ORG_B));
    expect(lido).toMatchObject({ herdado: true, dias: PADRAO, padraoHerdado: PADRAO });
    // e continua sem linha: materializar o padrão congelaria o valor herdado
    expect(await admin.rastroRetencao.count({ where: { orgId: ORG_B } })).toBe(0);
  });

  it('encurtar o prazo SEM motivo escrito é recusado; alongar não precisa', async () => {
    await expect(
      naEmpresa(ORG_A, () =>
        retencao.definir({ orgId: ORG_A, dias: 30, definidoPor: 'pedro' }),
      ),
    ).rejects.toThrow(/motivo escrito/i);

    const maior = await naEmpresa(ORG_A, () =>
      retencao.definir({ orgId: ORG_A, dias: PADRAO + 365, definidoPor: 'pedro' }),
    );
    expect(maior).toMatchObject({ dias: PADRAO + 365, herdado: false });
  });

  it('VOLTAR A HERDAR também exige motivo quando encurta — é o mesmo apagar de prova', async () => {
    /*
     * A trava do `definir` não valia nada enquanto este caminho existisse sem
     * ela: a empresa está com PADRAO+365 dias, e `herdar()` a levaria de volta
     * para PADRAO — encurtando a guarda — com as MESMAS permissões e sem uma
     * palavra de justificativa. `definir({ dias: PADRAO })` seria recusado.
     */
    await expect(naEmpresa(ORG_A, () => retencao.herdar(ORG_A, 'pedro'))).rejects.toThrow(
      /encurta a guarda|ENCURTA a guarda/i,
    );

    const herdado = await naEmpresa(ORG_A, () =>
      retencao.herdar(ORG_A, 'pedro', 'contrato encerrado; volta ao prazo padrão da política'),
    );
    expect(herdado).toMatchObject({ herdado: true, dias: PADRAO });

    const linha = await admin.eventLog.findFirst({
      where: { orgId: ORG_A, tipo: 'rastro.retencao.herdada' },
      orderBy: { seq: 'desc' },
    });
    expect((linha?.payload as Record<string, unknown>).motivo).toContain('contrato encerrado');
  });

  it('voltar a herdar quando ALONGA não precisa de motivo', async () => {
    await naEmpresa(ORG_A, () =>
      retencao.definir({
        orgId: ORG_A,
        dias: 10,
        motivo: 'minimização pedida pelo cliente em contrato',
        definidoPor: 'pedro',
      }),
    );
    // 10 → PADRAO é endurecer: guarda mais, não menos.
    const herdado = await naEmpresa(ORG_A, () => retencao.herdar(ORG_A, 'pedro'));
    expect(herdado).toMatchObject({ herdado: true, dias: PADRAO });
  });

  it('a mudança de prazo entra no próprio rastro, com quem, quando e de quanto para quanto', async () => {
    const linha = await admin.eventLog.findFirst({
      where: { orgId: ORG_A, tipo: 'rastro.retencao.definida' },
      orderBy: { seq: 'asc' },
    });
    const p = linha?.payload as Record<string, unknown>;
    expect(linha?.actorId).toBe('pedro');
    expect(p.estadoAnterior).toMatchObject({ dias: PADRAO, herdado: true });
    expect(p.estadoNovo).toMatchObject({ dias: PADRAO + 365, herdado: false });
  });

  it('cada empresa grava o evento com o SEU prazo', async () => {
    await naEmpresa(ORG_A, () =>
      retencao.definir({
        orgId: ORG_A,
        dias: 1,
        motivo: 'minimização pedida pelo cliente em contrato',
        definidoPor: 'pedro',
      }),
    );

    const deA = await naEmpresa(ORG_A, () =>
      eventos.registrar({ orgId: ORG_A, tipo: 'teste.prazo', actorType: 'system' }),
    );
    const deB = await naEmpresa(ORG_B, () =>
      eventos.registrar({ orgId: ORG_B, tipo: 'teste.prazo', actorType: 'system' }),
    );

    const [linhaA, linhaB] = await Promise.all([
      admin.eventLog.findUnique({ where: { id: deA.id }, select: { retencaoAte: true } }),
      admin.eventLog.findUnique({ where: { id: deB.id }, select: { retencaoAte: true } }),
    ]);

    const emDias = (d: Date) => Math.round((d.getTime() - Date.now()) / 86_400_000);
    expect(emDias(linhaA!.retencaoAte)).toBe(1);
    expect(emDias(linhaB!.retencaoAte)).toBe(PADRAO);
  });
});

describe.skipIf(!URL)('o expurgo por retenção', () => {
  let admin: PrismaClient;
  let prisma: PrismaClient;
  let eventos: EventLogService;
  let retencao: RetencaoService;
  let expurgo: ExpurgoService;

  const naEmpresa = <T>(orgId: string, fn: () => Promise<T>) =>
    comContexto({ orgId, actorType: 'system', correlationId: `expurgo-${orgId}` }, fn);

  const ORG_A_X = `${ORG_A}-x`;
  const ORG_B_X = `${ORG_B}-x`;
  /** Empresa reservada ao caminho que DESCOBRE as empresas sozinho. */
  const ORG_C_X = `${ORG_A}-descoberta`;

  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: URL } } });
    await admin.$connect();
    for (const [id, slug] of [
      [ORG_A_X, 'teste-expurgo-a'],
      [ORG_B_X, 'teste-expurgo-b'],
      [ORG_C_X, 'teste-expurgo-descoberta'],
    ]) {
      await admin.org.upsert({
        where: { id },
        update: {},
        create: { id, name: id, slug, modulos: [] },
      });
    }
    prisma = comTenantNaSessao(new PrismaClient({ datasources: { db: { url: URL } } }), {
      modo: 'observar',
    });
    eventos = new EventLogService(prisma as never);
    retencao = new RetencaoService(prisma as never, eventos, auditoriaDeMentira as never);
    expurgo = new ExpurgoService(prisma as never, eventos, auditoriaDeMentira as never);

    // A e C têm prazo de 1 dia; B herda os 1825 da política.
    for (const org of [ORG_A_X, ORG_C_X]) {
      await naEmpresa(org, () =>
        retencao.definir({
          orgId: org,
          dias: 1,
          motivo: 'retenção curta combinada com o cliente',
          definidoPor: 'pedro',
        }),
      );
    }

    /*
     * DOIS DIAS ATRÁS. `retencaoAte` é calculado no momento da gravação
     * (`agora + dias`), então uma linha escrita "há dois dias" com prazo de um
     * dia está genuinamente VENCIDA para o relógio do banco — que é o que a
     * função cobra (`retencaoAte < LEAST(p_corte, now())`).
     *
     * É a única forma honesta de medir isto sem esperar: mexer no `retencaoAte`
     * depois de gravado exigiria desligar a RULE de append-only, que é
     * exatamente a trava que esta suíte existe para provar.
     */
    vi.setSystemTime(new Date(Date.now() - 2 * 86_400_000));
    for (const tipo of ['teste.velho.1', 'teste.velho.2']) {
      for (const org of [ORG_A_X, ORG_B_X, ORG_C_X]) {
        await naEmpresa(org, () => eventos.registrar({ orgId: org, tipo, actorType: 'system' }));
      }
    }
    vi.useRealTimers();

    // E uma linha nova em A, dentro do prazo: ela tem de sobreviver.
    await naEmpresa(ORG_A_X, () =>
      eventos.registrar({ orgId: ORG_A_X, tipo: 'teste.novo', actorType: 'system' }),
    );
  });

  afterAll(async () => {
    vi.useRealTimers();
    await apagarRastroDeTeste(admin, [ORG_A_X, ORG_B_X, ORG_C_X]);
    await admin.rastroRetencao.deleteMany({ where: { orgId: { in: [ORG_A_X, ORG_B_X, ORG_C_X] } } });
    await admin.auditLog.deleteMany({ where: { orgId: { in: [ORG_A_X, ORG_B_X, ORG_C_X] } } });
    await admin.org.deleteMany({ where: { id: { in: [ORG_A_X, ORG_B_X, ORG_C_X] } } });
    await admin.$disconnect();
    await (prisma as PrismaClient).$disconnect();
  });

  it('a RULE de append-only engole um DELETE comum — em SILÊNCIO, que é o pior jeito', async () => {
    const antes = await admin.eventLog.count({ where: { orgId: ORG_A_X } });
    const apagados = await admin.$executeRawUnsafe(
      `DELETE FROM "EventLog" WHERE "orgId" = $1`,
      ORG_A_X,
    );
    expect(apagados).toBe(0);
    expect(await admin.eventLog.count({ where: { orgId: ORG_A_X } })).toBe(antes);
  });

  it('corte no FUTURO é recusado pela varredura', async () => {
    /*
     * A policy `tenant_expurgo_retencao` exige `retencaoAte < now()`, mas onde a
     * aplicação roda hoje o dono das tabelas é SUPERUSUÁRIO e atravessa policy:
     * ela fica inerte. O que sobrava era o filtro da própria função, com a data
     * que o chamador mandasse — e uma data no futuro apagaria linha NÃO VENCIDA.
     */
    await expect(
      expurgo.varrer({ corte: new Date(Date.now() + 86_400_000), orgIds: [ORG_A_X] }),
    ).rejects.toThrow(/no futuro/i);
  });

  it('e o PISO mora dentro da função: corte adiantado não alcança linha no prazo', async () => {
    // Chamada direta, por baixo da varredura, com um corte 100 dias à frente. Se
    // o piso não estivesse na função, a linha `teste.novo` (1 dia de prazo,
    // escrita agora) sairia junto.
    const antes = await admin.eventLog.count({ where: { orgId: ORG_B_X } });
    await naEmpresa(ORG_B_X, async () => {
      await (prisma as PrismaClient).$queryRawUnsafe(
        `SELECT * FROM app_rastro_expurgar($1, now() + interval '100 day', 1825)`,
        ORG_B_X,
      );
    });
    expect(
      await admin.eventLog.count({ where: { orgId: ORG_B_X } }),
      '\nUM CORTE NO FUTURO APAGOU LINHA QUE AINDA NÃO VENCEU.\n' +
        '  O piso tem de estar DENTRO da função (LEAST(p_corte, now())): a policy não serve de\n' +
        '  piso onde o dono das tabelas é superusuário, porque ele a atravessa.\n',
    ).toBe(antes);
  });

  it('uma empresa expurga e a outra não — cada uma pelo prazo dela', async () => {
    const resumo = await expurgo.varrer({ orgIds: [ORG_A_X, ORG_B_X] });

    const deA = resumo.empresas.find((e) => e.orgId === ORG_A_X)!;
    const deB = resumo.empresas.find((e) => e.orgId === ORG_B_X)!;
    expect(resumo.falhas).toBe(0);
    expect(deA.apagados).toBe(2);
    expect(deA.diasDeRetencao).toBe(1);
    expect(deB.apagados).toBe(0);
    expect(deB.diasDeRetencao).toBe(PADRAO);

    // A: sobrou a linha nova, a mudança de retenção e o evento do expurgo.
    const tiposDeA = (
      await admin.eventLog.findMany({
        where: { orgId: ORG_A_X },
        select: { tipo: true },
        orderBy: { seq: 'asc' },
      })
    ).map((l) => l.tipo);
    expect(tiposDeA).not.toContain('teste.velho.1');
    expect(tiposDeA).not.toContain('teste.velho.2');
    expect(tiposDeA).toContain('teste.novo');
    expect(tiposDeA).toContain(TIPO_EXPURGO);

    // B: nada saiu.
    expect(await admin.eventLog.count({ where: { orgId: ORG_B_X } })).toBe(2);
  });

  it('o expurgo é ele mesmo um evento, com a faixa que sumiu', async () => {
    const evento = await admin.eventLog.findFirst({
      where: { orgId: ORG_A_X, tipo: TIPO_EXPURGO },
    });
    expect(evento).toBeTruthy();
    const p = evento!.payload as Record<string, Record<string, unknown>>;
    expect(p.resultado.apagados).toBe(2);
    expect(p.resultado.seqDe).toBeTruthy();
    expect(p.resultado.seqAte).toBeTruthy();
    expect(p.motivo).toContain('1 dias');
    expect(evento!.actorType).toBe('system');
    // Perene: o expurgo seguinte não tem como alcançá-lo.
    expect(evento!.retencaoAte.getUTCFullYear()).toBe(9999);
  });

  it('o evento nasce NA MESMA TRANSAÇÃO do apagar — não há janela entre um e outro', async () => {
    /*
     * A prova de que o INSERT mora dentro de `app_rastro_expurgar`, e não num
     * segundo passo do Node: a função DEVOLVE o id do evento, e esse id já
     * existe na tabela quando a chamada retorna. Antes, o evento era escrito
     * depois, em outra transação e sem `try` — qualquer soluço no meio deixava a
     * lacuna de `seq` sem explicação E abortava a varredura, que a varredura
     * seguinte não conserta (ela é idempotente).
     */
    const fonte = await admin.$queryRawUnsafe<{ prosrc: string }[]>(
      `SELECT prosrc FROM pg_proc WHERE proname = 'app_rastro_expurgar'`,
    );
    expect(fonte).toHaveLength(1);
    expect(
      /INSERT\s+INTO\s+"EventLog"/i.test(fonte[0].prosrc),
      '\nO INSERT DO EVENTO SAIU DE DENTRO DA FUNÇÃO DO BANCO.\n' +
        '  Ele voltou a ser um passo separado, fora da transação que apaga — e é exatamente aí\n' +
        '  que mora a lacuna sem explicação.\n',
    ).toBe(true);
  });

  it('o canonizador do BANCO produz o mesmo texto que o do Node', async () => {
    /*
     * A cadeia do evento escrito pela função só fecha porque `app_json_canonico`
     * (plpgsql) e `canonizar` (TypeScript) serializam igual. O caso da cadeia
     * íntegra já prova isso de forma indireta — mas só para UM payload, o do
     * expurgo. Aqui a pergunta é direta, com as formas que costumam divergir:
     * chave fora de ordem, objeto aninhado, array misto, vazio, acento, e os
     * três escalares.
     *
     * Se este caso ficar vermelho depois de alguém mexer em `canonizar`, o
     * conserto NÃO é ajustar o teste: é mexer nos dois lados juntos, com
     * migration nova para o do banco.
     */
    const casos: unknown[] = [
      { b: { y: 2, x: 1 }, a: 'z' },
      { lista: [1, 'dois', null, { z: 1, a: 2 }] },
      { vazio: {}, semItens: [], aninhado: { um: { dois: { tres: 3 } } } },
      { n: 0, t: true, f: false, nulo: null },
      { motivo: 'retenção de 30 dias configurada para esta empresa' },
      { 'com aspas "e" barra \\': 'texto\ncom quebra\tе tab' },
    ];
    for (const caso of casos) {
      const [linha] = await admin.$queryRawUnsafe<{ sql: string }[]>(
        `SELECT app_json_canonico($1::jsonb) AS sql`,
        JSON.stringify(caso),
      );
      expect(linha.sql, `divergiu em ${JSON.stringify(caso)}`).toBe(canonizar(caso));
    }
  });

  it('o mesmo texto do tipo de evento vale no banco e no código', async () => {
    // Divergir em um dos quatro lugares reabilita, em silêncio, apagar o
    // registro do expurgo. Os dois do banco não têm como importar a constante —
    // então quem os prende a ela é este caso.
    const [policy] = await admin.$queryRawUnsafe<{ expr: string }[]>(
      `SELECT pg_get_expr(p.polqual, p.polrelid) AS expr
         FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
        WHERE c.relname = 'EventLog' AND p.polname = 'tenant_expurgo_retencao'`,
    );
    expect(policy.expr).toContain(TIPO_EXPURGO);

    const [funcao] = await admin.$queryRawUnsafe<{ prosrc: string }[]>(
      `SELECT prosrc FROM pg_proc WHERE proname = 'app_rastro_expurgar'`,
    );
    // duas vezes: no DELETE (e no SELECT da faixa) e no INSERT do evento
    expect(funcao.prosrc.split(TIPO_EXPURGO).length - 1).toBeGreaterThanOrEqual(2);
  });

  it('o expurgo seguinte NÃO apaga o registro do anterior', async () => {
    const antes = await admin.eventLog.count({
      where: { orgId: ORG_A_X, tipo: TIPO_EXPURGO },
    });
    const resumo = await expurgo.varrer({ orgIds: [ORG_A_X] });
    expect(resumo.apagados).toBe(0);
    expect(await admin.eventLog.count({ where: { orgId: ORG_A_X, tipo: TIPO_EXPURGO } })).toBe(
      antes,
    );
  });

  it('a cadeia continua íntegra depois do expurgo — e o hash escrito pelo BANCO fecha no Node', async () => {
    /*
     * Este caso mede duas coisas de uma vez, e a segunda é a que importa mais:
     *
     *  1. o buraco de `seq` que a retenção abriu está explicado pelo evento, em
     *     vez de parecer adulteração;
     *  2. o `app_json_canonico` do PostgreSQL produz EXATAMENTE o mesmo texto
     *     que `canonizar()` em TypeScript — se não produzisse, o hash da linha
     *     escrita pela função não fecharia e `ok` seria falso. É a prova de que
     *     escrever o evento dentro do banco não quebrou a corrente.
     */
    const r = await naEmpresa(ORG_A_X, () => eventos.verificar(ORG_A_X));
    expect(r.ok, `quebrou em ${JSON.stringify(r.quebrouEm)}`).toBe(true);
    expect(r.verificados).toBeGreaterThan(0);
    expect(r.lacunasExplicadas.length).toBe(1);
    // Tudo o que esta suíte escreveu saiu pela fórmula nova.
    expect(r.porFormula.v1).toBe(0);
  });

  it('a rota de integridade devolve a contagem de eventos incompletos por nível', async () => {
    // O prêmio de consolação de "avisar em vez de recusar" precisa ser legível.
    await naEmpresa(ORG_B_X, () =>
      eventos.registrar({
        orgId: ORG_B_X,
        tipo: 'tool.resultado',
        nivel: 'R3',
        actorType: 'ai',
        agentSlug: 'publicador',
        capabilityId: 'whatsapp.mensagem.enviar',
        conteudo: { argumentos: { para: 'x' }, fontes: [] },
      }),
    );
    const r = await naEmpresa(ORG_B_X, () => eventos.verificar(ORG_B_X));
    expect(r.incompletosPorNivel.R3).toBeGreaterThanOrEqual(1);
  });

  it('a RULE volta ligada depois do expurgo', async () => {
    const r = await admin.$queryRawUnsafe<{ ev_enabled: string }[]>(
      `SELECT r.ev_enabled FROM pg_rewrite r JOIN pg_class c ON c.oid = r.ev_class
        WHERE c.relname = 'EventLog' AND r.rulename = 'eventlog_sem_delete'`,
    );
    expect(r[0].ev_enabled).toBe('O');
  });

  it('sem empresa na sessão o banco RECUSA o expurgo — não devolve zero em silêncio', async () => {
    await expect(
      (prisma as PrismaClient).$queryRawUnsafe(
        `SELECT * FROM app_rastro_expurgar($1, now(), 30)`,
        ORG_A_X,
      ),
    ).rejects.toThrow(/sem empresa resolvida/i);
  });

  it('uma empresa não expurga o rastro da outra', async () => {
    /*
     * `async () => { await … }`, nunca a promessa solta: a do Prisma é
     * PREGUIÇOSA, e devolvê-la de dentro de `comContexto` faz a consulta começar
     * DEPOIS que o escopo fechou — a sessão sairia sem empresa e o erro seria o
     * outro, o de sessão vazia. Mesma armadilha documentada em
     * `src/prisma/contexto-de-plataforma.ts`.
     */
    await expect(
      naEmpresa(ORG_B_X, async () => {
        await (prisma as PrismaClient).$queryRawUnsafe(
          `SELECT * FROM app_rastro_expurgar($1, now(), 30)`,
          ORG_A_X,
        );
      }),
    ).rejects.toThrow(/nao expurga o rastro de outra/i);
  });

  // -------------------------------------------------------------------------
  // O CAMINHO DE PRODUÇÃO: descobrir as empresas sozinho
  // -------------------------------------------------------------------------

  it('a descoberta acha a empresa com rastro vencido — sem empresa na sessão', async () => {
    /*
     * Até 11/09/2026 este caminho NUNCA rodava: a única chamada de `varrer()`
     * era o teste, sempre com a lista explícita. O caminho que descobre é o de
     * produção e é o que carrega a ressalva de isolamento (roda com `app.org_id`
     * vazio, e só funciona porque a conexão é a DONA).
     */
    const achadas = await expurgo.empresasComRastroVencido(new Date());
    expect(achadas).toContain(ORG_C_X);
  });

  it('varrer SEM lista de empresas expurga a que a descoberta achou', async () => {
    const resumo = await expurgo.varrer();
    const deC = resumo.empresas.find((e) => e.orgId === ORG_C_X);
    expect(
      deC,
      '\nA VARREDURA SEM LISTA NÃO ALCANÇOU A EMPRESA COM RASTRO VENCIDO.\n' +
        '  É este o caminho que o script de manutenção usa; o outro só existe para o teste.\n',
    ).toBeTruthy();
    expect(deC!.apagados).toBe(2);
    expect(resumo.falhas).toBe(0);

    const tipos = (
      await admin.eventLog.findMany({ where: { orgId: ORG_C_X }, select: { tipo: true } })
    ).map((l) => l.tipo);
    expect(tipos).not.toContain('teste.velho.1');
    expect(tipos).toContain(TIPO_EXPURGO);
  });

});

// ---------------------------------------------------------------------------
// Sem banco: as travas que são de FORMA, não de estado
// ---------------------------------------------------------------------------

describe('o caminho que apaga não está ao alcance da aplicação', () => {
  const raiz = acharRaizDaApi();

  /** Todo arquivo `.ts` sob `src/`, em caminho relativo a `apps/api`. */
  function fontes(): string[] {
    const saida: string[] = [];
    const andar = (dir: string) => {
      for (const entrada of readdirSync(dir)) {
        const completo = path.join(dir, entrada);
        if (statSync(completo).isDirectory()) {
          if (entrada !== 'node_modules' && entrada !== 'dist') andar(completo);
          continue;
        }
        if (entrada.endsWith('.ts') && !entrada.endsWith('.d.ts')) {
          saida.push(path.relative(raiz, completo).split(path.sep).join('/'));
        }
      }
    };
    andar(path.join(raiz, 'src'));
    return saida.sort();
  }

  /** Um `import … from './algo/expurgo.service'`, em qualquer forma de caminho. */
  const IMPORTA_EXPURGO = /^\s*import[^;]*from\s+'[^']*expurgo\.service'/m;

  const arquivos = fontes();

  it('a varredura acha o código-fonte da API', () => {
    // Guarda de sanidade: varredura que não achou nada passa em silêncio, e um
    // teste que sempre passa não protege coisa nenhuma.
    expect(arquivos.length).toBeGreaterThan(50);
    expect(arquivos).toContain('src/audit/audit.controller.ts');
    expect(arquivos.filter((a) => a.endsWith('.controller.ts')).length).toBeGreaterThan(5);
  });

  it('NENHUM controller conhece o expurgo — varridos todos, não um só', () => {
    /*
     * A versão anterior desta catraca lia UM arquivo (`audit.controller.ts`) com
     * uma expressão frágil. Bastava alguém pôr a rota em qualquer outro
     * controller — `agents`, `tenants`, um `manutencao.controller.ts` novo — e a
     * catraca não veria nada. Agora ela varre todos.
     */
    const culpados = arquivos
      .filter((a) => a.endsWith('.controller.ts'))
      .filter((a) => IMPORTA_EXPURGO.test(readFileSync(path.join(raiz, a), 'utf8')));

    expect(
      culpados,
      '\nUM CONTROLLER PASSOU A CONHECER O EXPURGO.\n' +
        '  Expurgo é apagar linha do RASTRO. Ele roda num processo de manutenção com a\n' +
        '  conexão DONA das tabelas, nunca por requisição. E quando a aplicação conecta como\n' +
        '  dona — o padrão sem TENANT_DATABASE_URL —, as travas do banco não a alcançam:\n' +
        '  dona é superusuário, tem EXECUTE e atravessa policy.\n' +
        '  Se a operação precisa virar tela, o desenho muda: a tela AGENDA, não executa.\n',
    ).toEqual([]);
  });

  it('o expurgo não é provider de módulo nenhum — o injetor do Nest não o conhece', () => {
    /*
     * Ele era provider E export de um módulo `@Global`, o que significa
     * alcançável por injeção de qualquer canto da aplicação: bastava escrever o
     * construtor. A catraca do controller não pegaria isso, porque um serviço
     * qualquer poderia injetá-lo e expor o efeito por outra rota.
     */
    const culpados = arquivos
      .filter((a) => a.endsWith('.module.ts'))
      .filter((a) => IMPORTA_EXPURGO.test(readFileSync(path.join(raiz, a), 'utf8')));

    expect(
      culpados,
      '\nO EXPURGO VOLTOU A SER PROVIDER DE UM MÓDULO.\n' +
        '  Quem o constrói é src/scripts/expurgar-rastro.ts, à mão, com a conexão DONA.\n',
    ).toEqual([]);
  });

  it('mas ele TEM um chamador declarado — senão a retenção nunca acontece', () => {
    /*
     * A outra metade, e a que faltava por inteiro: até 11/09/2026 não havia
     * script, entrada no package.json, rotina nem rota. `retencaoAte` era
     * carimbado linha a linha e NADA apagava.
     */
    const script = path.join(raiz, 'src/scripts/expurgar-rastro.ts');
    expect(existsSync(script), 'src/scripts/expurgar-rastro.ts não existe').toBe(true);

    const fonte = readFileSync(script, 'utf8');
    expect(IMPORTA_EXPURGO.test(fonte)).toBe(true);
    // chama a forma que DESCOBRE as empresas, não só a que recebe a lista
    expect(/empresasComRastroVencido|varrer\(\)/.test(fonte)).toBe(true);

    const pkg = JSON.parse(readFileSync(path.join(raiz, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['expurgo:rastro']).toBe('node dist/scripts/expurgar-rastro.js');
  });

  it('o serviço confere que a conexão é a dona ANTES de tentar apagar', async () => {
    // Sem banco: um dobrê responde "não sou dono", e o serviço tem de recusar
    // alto em vez de seguir e apagar zero linha com ar de sucesso.
    const fingido = {
      $queryRaw: async () => [{ dono: false, papel: 'mktos_app' }],
    };
    const svc = new ExpurgoService(fingido as never, {} as never, {} as never);
    await expect(svc.varrer()).rejects.toBeInstanceOf(ExpurgoIndisponivelError);
    await expect(svc.varrer()).rejects.toThrow(/mktos_app/);
  });

  it('uma empresa que falha não derruba a varredura das outras', async () => {
    /*
     * Sem banco de propósito: forçar um erro REAL do PostgreSQL no meio de uma
     * varredura é frágil (empresa inexistente simplesmente não tem o que
     * apagar), e o que se mede aqui é o CONTORNO, que é código deste lado. Antes
     * não havia contorno nenhum: um erro em qualquer empresa abortava a
     * varredura e as seguintes ficavam sem expurgo — calado, porque obrigação de
     * retenção não tem quem reclame dela.
     */
    const fingido = {
      rastroRetencao: { findUnique: async () => null },
      auditLog: { create: async () => undefined },
      $queryRaw: async (partes: TemplateStringsArray, ...valores: unknown[]) => {
        if (partes.join(' ').includes('pg_get_userbyid')) return [{ dono: true, papel: 'mkt' }];
        if (valores[0] === 'org-ruim') throw new Error('deadlock detected');
        return [{ apagados: 1n, seq_de: 5n, seq_ate: 5n, evento_id: 'evt-x' }];
      },
    };
    const eventos = new EventLogService(fingido as never);
    const svc = new ExpurgoService(fingido as never, eventos, auditoriaDeMentira as never);

    const resumo = await svc.varrer({ orgIds: ['org-ruim', 'org-boa'] });
    expect(resumo.falhas).toBe(1);
    expect(resumo.empresas.find((e) => e.orgId === 'org-ruim')!.erro).toMatch(/deadlock/);
    expect(resumo.empresas.find((e) => e.orgId === 'org-boa')!.apagados).toBe(1);
    expect(resumo.apagados).toBe(1);
  });

  it('a varredura recusa corte no futuro antes de chegar ao banco', async () => {
    const fingido = { $queryRaw: async () => [{ dono: true, papel: 'mkt' }] };
    const svc = new ExpurgoService(fingido as never, {} as never, {} as never);
    await expect(
      svc.varrer({ corte: new Date(Date.now() + 60_000), orgIds: ['org-a'] }),
    ).rejects.toThrow(/no futuro/i);
  });
});

/*
 * A seção do papel restrito entra por `if`, e NÃO por `describe.skipIf`.
 *
 * A diferença não é estética, e já custou uma CI vermelha na onda 4:
 * `describe.skipIf(true)` COLETA os casos e os marca como pulados, e a trava de
 * cobertura do `.github/workflows/ci.yml` reprova a suíte com qualquer caso
 * pulado — de propósito, porque "pulado" quase sempre é banco de teste que não
 * chegou. No job `qualidade` o `TENANT_DATABASE_URL` nunca está definido (o
 * papel restrito tem job próprio), então estes casos apareceriam como pulados em
 * TODA execução e a trava reprovaria para sempre.
 *
 * Com `if`, a seção simplesmente não existe quando não há papel restrito: nada
 * pulado, nada a desculpar.
 */
if (URL_RESTRITA) {
  describe('o papel restrito não alcança o expurgo', () => {
    let restrito: PrismaClient;

    beforeAll(async () => {
      restrito = new PrismaClient({ datasources: { db: { url: URL_RESTRITA } } });
      await restrito.$connect();
    });
    afterAll(async () => {
      await restrito.$disconnect();
    });

    it('não tem EXECUTE na função nem DELETE no rastro', async () => {
      const r = await restrito.$queryRawUnsafe<
        { executa: boolean; apaga: boolean; papel: string }[]
      >(
        `SELECT has_function_privilege(current_user, 'app_rastro_expurgar(text, timestamptz, int)', 'EXECUTE') AS executa,
                has_table_privilege(current_user, '"EventLog"', 'DELETE') AS apaga,
                current_user::text AS papel`,
      );
      expect(r[0]).toMatchObject({ executa: false, apaga: false });
    });

    it('chamar a função devolve erro, não zero linha', async () => {
      await expect(
        restrito.$queryRawUnsafe(`SELECT * FROM app_rastro_expurgar('qualquer', now(), 30)`),
      ).rejects.toThrow(/permission denied/i);
    });
  });
}

/** Mesma técnica de `arquitetura.test.ts`: acha a raiz por um marco. */
function acharRaizDaApi(): string {
  const marco = path.join('src', 'audit', 'audit.controller.ts');
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, marco))) return dir;
    if (existsSync(path.join(dir, 'apps', 'api', marco))) return path.join(dir, 'apps', 'api');
    dir = path.dirname(dir);
  }
  throw new Error('não achei a raiz de apps/api a partir de ' + process.cwd());
}
