import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AgentTipo,
  EstadoDeAgente,
  PrismaClient,
  RiskLevel,
  WorkStatusType,
} from '@prisma/client';

import { AuditService } from '../src/audit/audit.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { CheckoutDeTarefaService } from '../src/work/checkout-de-tarefa.service';
import {
  CAUSA_DO_CHECKOUT,
  MOTIVO_DA_SOLTURA,
  agentePodeAssumir,
  mensagemDeCorridaPerdida,
  soltarPorCausaDoEstado,
} from '../src/work/checkout-de-tarefa';
import { agenteDaCasa, agentesDaCasa } from '../src/work/agentes-da-casa';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/* ==========================================================================
 * TAREFA COM DONO ÚNICO E CHECKOUT ATÔMICO — fatia A4
 * ==========================================================================
 *
 * O QUE ESTE ARQUIVO PROTEGE, defesa por defesa:
 *
 *  1. A CORRIDA. Chamadas CONCORRENTES DE VERDADE contra o Postgres, disparadas
 *     juntas com `Promise.allSettled`. Exatamente uma vence; as outras recebem
 *     409. Um teste que chamasse duas vezes em SEQUÊNCIA não mediria nada — em
 *     sequência qualquer implementação acerta, inclusive a errada. E duas
 *     chamadas numa RODADA SÓ também não bastam: medido, a versão errada passou
 *     por sorte de escalonamento. Daí as dez rodadas e a corrida de cinco.
 *  2. O 409 DIZ QUEM GANHOU. A frase nomeia o agente e desde quando. Sem isso,
 *     quem perde a corrida não tem como descobrir por que a tarefa não é dele.
 *  3. UMA INSTRUÇÃO, NÃO LER-DEPOIS-ESCREVER. O caso do dublê confere que o
 *     caminho usa `updateMany` com `agenteId: null` no `WHERE` e NUNCA
 *     `workTask.update`. É a trava que fica vermelha no dia em que alguém
 *     "simplificar" o checkout — porque com `update` a suíte da corrida pode
 *     passar por sorte de escalonamento, e esta não.
 *  4. SOLTAR É O CAMINHO DE VOLTA. Tarefa solta volta a ser assumível; soltar
 *     o que está livre é 409; e soltar cobra o dono ESPECÍFICO, para não tirar
 *     da mão de quem assumiu depois.
 *  5. AGENTE QUE NÃO TRABALHA NÃO ASSUME, com a causa da fatia A2.
 *  6. TAREFA ARQUIVADA NÃO RECEBE TRABALHO.
 *  7. A EMPRESA. Agente de outra empresa não é encontrado pelo serviço, e o
 *     GATILHO do banco recusa a escrita crua que tentasse pendurá-lo — as duas
 *     metades, porque a segunda é a que sobra se alguém trocar a consulta.
 *  8. PAUSAR E ENCERRAR SOLTAM o que o agente tem na mão. É a metade da fatia
 *     que impede o travamento eterno pela outra porta: um agente que uma pessoa
 *     tirou de circulação não pode levar tarefa consigo.
 *
 * Precisa de `TEST_DATABASE_URL` com as migrations aplicadas. A parte de regras
 * puras e a do dublê rodam sempre — elas não persistem nada.
 * ========================================================================== */

const URL = process.env.TEST_DATABASE_URL;
const ORG = 'org-teste-checkout';
const VIZINHA = 'org-teste-checkout-vizinha';

exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (tarefas, agentes e o rastro delas)');

/* ==========================================================================
 * 1. AS REGRAS — sem banco
 * ========================================================================== */

describe('A4: as regras do checkout', () => {
  it('só o estado que TRABALHA assume tarefa — e a lista é a da A2', () => {
    expect(agentePodeAssumir(EstadoDeAgente.ativo)).toBe(true);
    for (const parado of [
      EstadoDeAgente.planejado,
      EstadoDeAgente.pausado,
      EstadoDeAgente.encerrado,
    ]) {
      expect(agentePodeAssumir(parado)).toBe(false);
    }
  });

  it('a causa da soltura vem do ESTADO, e retomar não solta nada', () => {
    expect(soltarPorCausaDoEstado(EstadoDeAgente.ativo)).toBeNull();
    expect(soltarPorCausaDoEstado(EstadoDeAgente.pausado)).toBe(MOTIVO_DA_SOLTURA.agentePausado);
    expect(soltarPorCausaDoEstado(EstadoDeAgente.encerrado)).toBe(
      MOTIVO_DA_SOLTURA.agenteEncerrado,
    );
  });

  it('a frase do 409 nomeia quem ganhou e desde quando', () => {
    const frase = mensagemDeCorridaPerdida({
      nome: 'Analista',
      desde: new Date('2026-09-14T15:00:00Z'),
    });
    expect(frase).toContain('Analista');
    expect(frase).toContain('14/09/2026');
  });

  it('sem nome resolvido a frase diz "outro agente" — não inventa nome', () => {
    /*
     * O nome vem de `agentes-da-casa.ts`, que devolve nulo para ponteiro de
     * outra empresa. Dizer o nome errado aqui seria vazar identidade de agente
     * da vizinha na mensagem de erro do cliente.
     */
    const frase = mensagemDeCorridaPerdida({ nome: null, desde: null });
    expect(frase).toContain('outro agente');
    expect(frase).not.toContain('undefined');
    expect(frase).not.toContain('null');
  });
});

/* ==========================================================================
 * 2. UMA INSTRUÇÃO SÓ — o dublê que reprova ler-depois-escrever
 * ========================================================================== */

describe('A4: o checkout é UMA instrução condicional', () => {
  /** Um prisma de mentira que anota tudo o que o serviço pediu. */
  function bancada(livre = true) {
    const chamadas: string[] = [];
    let dono: string | null = livre ? null : 'ag-outro';
    const wheres: Record<string, unknown>[] = [];

    const prisma = {
      agent: {
        findFirst: async () => ({
          id: 'ag-1',
          slug: 'analista',
          nome: 'Analista',
          estado: EstadoDeAgente.ativo,
        }),
        findMany: async () => [
          {
            id: 'ag-outro',
            slug: 'redator',
            nome: 'Redator',
            iniciais: 'RD',
            estado: EstadoDeAgente.ativo,
          },
        ],
      },
      workTask: {
        findFirst: async () => {
          chamadas.push('workTask.findFirst');
          return {
            id: 't-1',
            listId: 'l-1',
            statusId: 's-1',
            title: 'Tarefa',
            archived: false,
            agenteId: dono,
            agenteEm: dono ? new Date('2026-09-14T12:00:00Z') : null,
          };
        },
        updateMany: async ({ where }: { where: Record<string, unknown> }) => {
          chamadas.push('workTask.updateMany');
          wheres.push(where);
          if (where.agenteId === null && dono !== null) return { count: 0 };
          dono = 'ag-1';
          return { count: 1 };
        },
        update: async () => {
          chamadas.push('workTask.update');
          return {};
        },
      },
      workStatus: { findFirst: async () => ({ id: 's-1' }) },
      auditLog: { create: async () => ({}) },
    } as unknown as PrismaService;

    const svc = new CheckoutDeTarefaService(prisma, {
      log: async () => undefined,
    } as unknown as AuditService);
    return { svc, chamadas, wheres };
  }

  it('assumir usa updateMany com `agenteId: null` no WHERE e NUNCA update', async () => {
    const b = bancada();
    await b.svc.assumir(ORG, 't-1', 'analista', { actorId: 'u-1' });
    expect(b.chamadas).toContain('workTask.updateMany');
    expect(b.chamadas).not.toContain('workTask.update');
    /*
     * `agenteId: null` é a condição inteira da fatia. Um `WHERE` sem ela
     * gravaria por cima do dono atual e devolveria sucesso — dois agentes na
     * mesma tarefa, sem erro nenhum para ninguém ver.
     */
    expect(b.wheres[0]).toMatchObject({ id: 't-1', orgId: ORG, agenteId: null });
  });

  it('quando o updateMany afeta zero linhas, a resposta é 409 — não sucesso', async () => {
    const b = bancada(false);
    await expect(b.svc.assumir(ORG, 't-1', 'analista', { actorId: 'u-1' })).rejects.toMatchObject({
      status: 409,
    });
    expect(b.chamadas).not.toContain('workTask.update');
  });
});

/* ==========================================================================
 * 3. CONTRA O BANCO — a corrida de verdade
 * ========================================================================== */

describe.skipIf(!URL)('A4: o checkout atômico contra o Postgres', () => {
  let prisma: PrismaClient;
  let svc: CheckoutDeTarefaService;
  let listaId: string;
  let statusInicial: string;
  let statusAndamento: string;
  let idAtivo: string;
  let idSegundo: string;
  let idPausado: string;

  async function agente(orgId: string, slug: string, estado: EstadoDeAgente) {
    const a = await prisma.agent.upsert({
      where: { orgId_slug: { orgId, slug } },
      create: {
        orgId,
        slug,
        nome: slug,
        iniciais: slug.slice(0, 2).toUpperCase(),
        missao: `agente ${slug} do checkout`,
        tipo: AgentTipo.llm,
        estado,
        ativo: estado === EstadoDeAgente.ativo,
        autonomiaAte: RiskLevel.R1,
        capacidades: [],
      },
      update: { estado, ativo: estado === EstadoDeAgente.ativo },
      select: { id: true },
    });
    return a.id;
  }

  /** Uma tarefa nova e LIVRE, a cada caso. */
  async function tarefa(titulo = 'Tarefa do checkout') {
    const t = await prisma.workTask.create({
      data: { orgId: ORG, listId: listaId, statusId: statusInicial, title: titulo },
      select: { id: true },
    });
    return t.id;
  }

  beforeAll(async () => {
    vi.setSystemTime(new Date('2026-09-14T12:00:00-03:00'));
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    svc = new CheckoutDeTarefaService(
      prisma as unknown as PrismaService,
      new AuditService(prisma as unknown as PrismaService),
      new EventLogService(prisma as unknown as PrismaService),
    );

    for (const orgId of [ORG, VIZINHA]) {
      await prisma.org.upsert({
        where: { id: orgId },
        create: { id: orgId, name: orgId, slug: orgId },
        update: {},
      });
    }

    const lista = await prisma.workList.create({
      data: { orgId: ORG, name: 'Lista do checkout' },
      select: { id: true },
    });
    listaId = lista.id;
    const aFazer = await prisma.workStatus.create({
      data: { listId: listaId, name: 'A fazer', type: WorkStatusType.open, order: 0 },
      select: { id: true },
    });
    const andamento = await prisma.workStatus.create({
      data: { listId: listaId, name: 'Em andamento', type: WorkStatusType.custom, order: 1 },
      select: { id: true },
    });
    statusInicial = aFazer.id;
    statusAndamento = andamento.id;

    idAtivo = await agente(ORG, 'analista-a4', EstadoDeAgente.ativo);
    idSegundo = await agente(ORG, 'redator-a4', EstadoDeAgente.ativo);
    idPausado = await agente(ORG, 'pausado-a4', EstadoDeAgente.pausado);
    await agente(VIZINHA, 'analista-a4', EstadoDeAgente.ativo);
  });

  beforeEach(async () => {
    // Cada caso cria a tarefa dele; as das rodadas anteriores saem daqui para a
    // contagem por agente não herdar carga de outro caso.
    await prisma.workTask.deleteMany({ where: { orgId: ORG } });
  });

  afterAll(async () => {
    if (!prisma) return;
    vi.useRealTimers();
    await prisma.workTask.deleteMany({ where: { orgId: { in: [ORG, VIZINHA] } } });
    await prisma.workStatus.deleteMany({ where: { listId: listaId } });
    await prisma.workList.deleteMany({ where: { orgId: ORG } });
    await prisma.agent.deleteMany({ where: { orgId: { in: [ORG, VIZINHA] } } });
    await prisma.auditLog.deleteMany({ where: { orgId: { in: [ORG, VIZINHA] } } });
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" DISABLE RULE eventlog_sem_delete'),
      prisma.eventLog.deleteMany({ where: { orgId: { in: [ORG, VIZINHA] } } }),
      prisma.$executeRawUnsafe('ALTER TABLE "EventLog" ENABLE RULE eventlog_sem_delete'),
    ]);
    await prisma.org.deleteMany({ where: { id: { in: [ORG, VIZINHA] } } });
    await prisma.$disconnect();
  });

  /* ---------------------------------------------------------------- a corrida */

  /**
   * Uma corrida: `quantos` checkouts disparados JUNTOS sobre a MESMA tarefa
   * nova, sem `await` entre eles. O Prisma usa um pool de conexões, então as
   * instruções saem por conexões diferentes e chegam de verdade ao mesmo tempo
   * na mesma linha do Postgres — é a única forma de medir isto. Duas chamadas em
   * SEQUÊNCIA passariam mesmo com `findFirst` + `update`, que é a implementação
   * errada.
   */
  async function corrida(quantos: number) {
    const id = await tarefa();
    const tentativas = await Promise.allSettled(
      Array.from({ length: quantos }, (_, i) =>
        svc.assumir(ORG, id, i % 2 === 0 ? 'analista-a4' : 'redator-a4', { actorId: `u-${i}` }),
      ),
    );
    const dono = await prisma.workTask.findUniqueOrThrow({
      where: { id },
      select: { agenteId: true, agenteEm: true },
    });
    return {
      vitorias: tentativas.filter((r) => r.status === 'fulfilled'),
      derrotas: tentativas.filter((r) => r.status === 'rejected') as PromiseRejectedResult[],
      dono,
    };
  }

  /*
   * DEZ RODADAS, E NÃO UMA.
   *
   * Medido em 14/09/2026 com a versão errada (ler-depois-escrever) no lugar do
   * `updateMany` condicional: UMA rodada de duas chamadas PASSOU — o
   * escalonamento entregou as duas em ordem e a leitura da segunda já viu a
   * tarefa travada. Uma rodada só, com duas chamadas, é sorte, não medida.
   * Repetir apaga a sorte: a mesma sabotagem reprova em rodadas diferentes.
   */
  it('DUAS CHAMADAS CONCORRENTES, DEZ RODADAS: uma vence, a outra recebe 409', async () => {
    for (let rodada = 0; rodada < 10; rodada++) {
      const r = await corrida(2);
      expect(r.vitorias, `rodada ${rodada}`).toHaveLength(1);
      expect(r.derrotas, `rodada ${rodada}`).toHaveLength(1);
      expect(r.derrotas[0].reason).toMatchObject({ status: 409 });
      // E o banco concorda com quem venceu: um dono, não dois.
      expect([idAtivo, idSegundo]).toContain(r.dono.agenteId);
      expect(r.dono.agenteEm).not.toBeNull();
    }
  });

  it('CINCO CHAMADAS CONCORRENTES: exatamente uma vence, quatro recebem 409', async () => {
    const r = await corrida(5);
    expect(r.vitorias).toHaveLength(1);
    expect(r.derrotas).toHaveLength(4);
    for (const d of r.derrotas) expect(d.reason).toMatchObject({ status: 409 });
  });

  it('quem perde a corrida é informado de QUEM ficou com a tarefa', async () => {
    const id = await tarefa();
    await svc.assumir(ORG, id, 'analista-a4', { actorId: 'u-1' });
    await expect(
      svc.assumir(ORG, id, 'redator-a4', { actorId: 'u-2' }),
    ).rejects.toThrow(/analista-a4/);
  });

  it('a recusa por corrida perdida entra no RASTRO com causa própria', async () => {
    const id = await tarefa();
    await svc.assumir(ORG, id, 'analista-a4', { actorId: 'u-1' });
    await svc.assumir(ORG, id, 'redator-a4', { actorId: 'u-2' }).catch(() => undefined);

    const eventos = await prisma.eventLog.findMany({
      where: { orgId: ORG, tipo: 'tarefa.checkout_recusado' },
      orderBy: { seq: 'desc' },
      take: 1,
    });
    expect(eventos).toHaveLength(1);
    /*
     * O `conteudo` do registro NÃO é coluna: `EventLogService.montar` espalha os
     * campos nomeados pela política como chaves de primeiro nível do `payload`.
     * Ler uma coluna `conteudo` daria `undefined` em silêncio — e um teste de
     * rastro que lê o campo errado é um teste que passa a acusar nada.
     */
    const payload = eventos[0].payload as { argumentos?: { causa?: string } } | null;
    expect(payload?.argumentos?.causa).toBe(CAUSA_DO_CHECKOUT.jaAssumida);
  });

  /* ------------------------------------------------- assumir e mover de etapa */

  it('assumir com statusId move a etapa NA MESMA instrução do checkout', async () => {
    const id = await tarefa();
    const r = await svc.assumir(ORG, id, 'analista-a4', { actorId: 'u-1' }, statusAndamento);
    expect(r.statusId).toBe(statusAndamento);

    const depois = await prisma.workTask.findUniqueOrThrow({
      where: { id },
      select: { statusId: true, agenteId: true },
    });
    /*
     * O ponto do caso é o PAR: não existe instante com a tarefa em andamento e
     * sem dono. Se as duas escritas se separarem, este caso continua passando —
     * mas o da corrida com status abaixo não.
     */
    expect(depois.statusId).toBe(statusAndamento);
    expect(depois.agenteId).toBe(idAtivo);
  });

  it('perder a corrida COM statusId não move a etapa de ninguém', async () => {
    const id = await tarefa();
    await svc.assumir(ORG, id, 'analista-a4', { actorId: 'u-1' });
    await svc
      .assumir(ORG, id, 'redator-a4', { actorId: 'u-2' }, statusAndamento)
      .catch(() => undefined);

    const depois = await prisma.workTask.findUniqueOrThrow({
      where: { id },
      select: { statusId: true, agenteId: true },
    });
    expect(depois.statusId).toBe(statusInicial);
    expect(depois.agenteId).toBe(idAtivo);
  });

  it('status de outra lista é recusado antes de travar coisa nenhuma', async () => {
    const outra = await prisma.workList.create({
      data: { orgId: ORG, name: 'Lista alheia' },
      select: { id: true },
    });
    const alheio = await prisma.workStatus.create({
      data: { listId: outra.id, name: 'Etapa alheia', type: WorkStatusType.custom, order: 0 },
      select: { id: true },
    });
    const id = await tarefa();
    await expect(
      svc.assumir(ORG, id, 'analista-a4', { actorId: 'u-1' }, alheio.id),
    ).rejects.toThrow(/não pertence à lista/);

    const depois = await prisma.workTask.findUniqueOrThrow({
      where: { id },
      select: { agenteId: true },
    });
    expect(depois.agenteId).toBeNull();

    await prisma.workTask.deleteMany({ where: { listId: outra.id } });
    await prisma.workStatus.deleteMany({ where: { listId: outra.id } });
    await prisma.workList.delete({ where: { id: outra.id } });
  });

  /* -------------------------------------------------------- o caminho de volta */

  it('soltar devolve a tarefa para a fila, e outro agente assume depois', async () => {
    const id = await tarefa();
    await svc.assumir(ORG, id, 'analista-a4', { actorId: 'u-1' });
    const solta = await svc.soltar(ORG, id, { actorId: 'u-1' }, 'errei o alvo');
    expect(solta.soltaDe).toBe('analista-a4');

    const livre = await prisma.workTask.findUniqueOrThrow({
      where: { id },
      select: { agenteId: true, agenteEm: true },
    });
    /* Os dois campos são apagados juntos: "livre desde tal hora" não existe. */
    expect(livre.agenteId).toBeNull();
    expect(livre.agenteEm).toBeNull();

    const r = await svc.assumir(ORG, id, 'redator-a4', { actorId: 'u-2' });
    expect(r.agente.slug).toBe('redator-a4');
  });

  it('soltar tarefa que ninguém assumiu é 409, não sucesso silencioso', async () => {
    const id = await tarefa();
    await expect(svc.soltar(ORG, id, { actorId: 'u-1' })).rejects.toThrow(/não está na mão/);
  });

  it('soltar DUAS VEZES em paralelo: uma solta, a outra não diz "livre" por engano', async () => {
    const id = await tarefa();
    await svc.assumir(ORG, id, 'analista-a4', { actorId: 'u-1' });

    /*
     * Duas solturas concorrentes na mesma tarefa. A que perde recebe 409 — e o
     * que este caso protege é o TEXTO: se a perdedora dissesse "não está na mão
     * de ninguém" num cenário em que a tarefa está travada por outro agente, a
     * pessoa iria embora achando que soltou.
     */
    const r = await Promise.allSettled([
      svc.soltar(ORG, id, { actorId: 'u-1' }),
      svc.soltar(ORG, id, { actorId: 'u-2' }),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(r.filter((x) => x.status === 'rejected')).toHaveLength(1);
    const livre = await prisma.workTask.findUniqueOrThrow({
      where: { id },
      select: { agenteId: true },
    });
    expect(livre.agenteId).toBeNull();
  });

  it('qualquer pessoa solta, não só quem travou — senão a tarefa fica presa para sempre', async () => {
    const id = await tarefa();
    await svc.assumir(ORG, id, 'analista-a4', { actorId: 'u-1' });
    /*
     * O agente que travou e morreu no meio não vai soltar nada. Se a devolução
     * dependesse dele, o quadro do cliente acumularia trabalho intocável.
     */
    const r = await svc.soltar(ORG, id, { actorId: 'outra-pessoa' });
    expect(r.ok).toBe(true);
  });

  it('a soltura registra no rastro de quem a tarefa saiu, com a causa "pedido"', async () => {
    const id = await tarefa();
    await svc.assumir(ORG, id, 'analista-a4', { actorId: 'u-1' });
    await svc.soltar(ORG, id, { actorId: 'u-1' });

    const ev = await prisma.eventLog.findFirst({
      where: { orgId: ORG, tipo: 'tarefa.soltada' },
      orderBy: { seq: 'desc' },
    });
    const payload = ev?.payload as { argumentos?: { causa?: string; agente?: string } } | null;
    expect(payload?.argumentos?.causa).toBe(MOTIVO_DA_SOLTURA.pedido);
    expect(payload?.argumentos?.agente).toBe('analista-a4');
  });

  /* ------------------------------------------------------- quem não pode assumir */

  it('agente PAUSADO não assume tarefa — com a causa da fatia A2', async () => {
    const id = await tarefa();
    await expect(
      svc.assumir(ORG, id, 'pausado-a4', { actorId: 'u-1' }),
    ).rejects.toMatchObject({ status: 409 });

    const ev = await prisma.eventLog.findFirst({
      where: { orgId: ORG, tipo: 'tarefa.checkout_recusado' },
      orderBy: { seq: 'desc' },
    });
    const payload = ev?.payload as { argumentos?: { causa?: string } } | null;
    expect(payload?.argumentos?.causa).toBe('agente_pausado');

    const depois = await prisma.workTask.findUniqueOrThrow({
      where: { id },
      select: { agenteId: true },
    });
    expect(depois.agenteId).toBeNull();
    expect(idPausado).toBeTruthy();
  });

  it('tarefa ARQUIVADA não recebe trabalho novo', async () => {
    const id = await tarefa();
    await prisma.workTask.update({ where: { id }, data: { archived: true } });
    await expect(
      svc.assumir(ORG, id, 'analista-a4', { actorId: 'u-1' }),
    ).rejects.toThrow(/arquivada/);
  });

  /* ------------------------------------------------------------- a empresa */

  it('o serviço não acha agente de outra empresa — o escopo é por empresa', async () => {
    const id = await tarefa();
    /*
     * O slug `analista-a4` existe nas DUAS empresas. Se a consulta esquecesse o
     * `orgId`, este caso passaria travando a tarefa com o agente da vizinha.
     */
    const r = await svc.assumir(ORG, id, 'analista-a4', { actorId: 'u-1' });
    expect(r.agente.id).toBe(idAtivo);

    const daVizinha = await prisma.agent.findFirstOrThrow({
      where: { orgId: VIZINHA, slug: 'analista-a4' },
      select: { id: true },
    });
    expect(r.agente.id).not.toBe(daVizinha.id);
  });

  it('O GATILHO DO BANCO recusa pendurar agente de outra empresa na tarefa', async () => {
    const id = await tarefa();
    const daVizinha = await prisma.agent.findFirstOrThrow({
      where: { orgId: VIZINHA, slug: 'analista-a4' },
      select: { id: true },
    });
    /*
     * Escrita CRUA, contornando o serviço de propósito: é a metade da defesa que
     * sobra se alguém trocar a consulta escopada. A chave estrangeira simples
     * aceitaria isto sem reclamar — quem recusa é
     * `WorkTask_orgId_confere_agente`.
     */
    await expect(
      prisma.$executeRaw`UPDATE "WorkTask" SET "agenteId" = ${daVizinha.id} WHERE "id" = ${id}`,
    ).rejects.toThrow();

    const depois = await prisma.workTask.findUniqueOrThrow({
      where: { id },
      select: { agenteId: true },
    });
    expect(depois.agenteId).toBeNull();
  });

  it('a resolução do nome do agente ignora ponteiro de outra empresa', async () => {
    const daVizinha = await prisma.agent.findFirstOrThrow({
      where: { orgId: VIZINHA, slug: 'analista-a4' },
      select: { id: true },
    });
    const p = prisma as unknown as PrismaService;
    expect(await agenteDaCasa(p, ORG, daVizinha.id)).toBeNull();
    expect(await agenteDaCasa(p, ORG, idAtivo)).toMatchObject({ slug: 'analista-a4' });
    const mapa = await agentesDaCasa(p, ORG, [idAtivo, daVizinha.id, null]);
    expect(mapa.size).toBe(1);
  });

  /* ------------------------------------------------------------- a carga */

  it('a carga por agente conta só o que está travado e não arquivado', async () => {
    const a = await tarefa('uma');
    const b = await tarefa('outra');
    const c = await tarefa('arquivada');
    await svc.assumir(ORG, a, 'analista-a4', { actorId: 'u-1' });
    await svc.assumir(ORG, b, 'analista-a4', { actorId: 'u-1' });
    await svc.assumir(ORG, c, 'redator-a4', { actorId: 'u-1' });
    await prisma.workTask.update({ where: { id: c }, data: { archived: true } });

    const carga = await svc.tarefasPorAgente(ORG);
    expect(carga.get(idAtivo)).toBe(2);
    expect(carga.get(idSegundo)).toBeUndefined();
  });

  it('a lista para a tela diz ANTES DO CLIQUE quem pode receber trabalho', async () => {
    const oferecidos = await svc.agentesParaEscolher(ORG);
    const pausado = oferecidos.find((a) => a.slug === 'pausado-a4');
    const ativo = oferecidos.find((a) => a.slug === 'analista-a4');
    /*
     * O agente pausado APARECE (esconder faria a pessoa procurar um agente que
     * existe) mas vem marcado — a tela desabilita em vez de deixar a pessoa
     * descobrir a regra pelo 409.
     */
    expect(pausado?.podeAssumir).toBe(false);
    expect(ativo?.podeAssumir).toBe(true);
    expect(oferecidos.every((a) => a.slug !== 'analista-a4' || a.id === idAtivo)).toBe(true);
  });

  /* --------------------------------- pausar/encerrar solta o que está na mão */

  it('soltarTodasDoAgente devolve TODAS as tarefas daquele agente, e só dele', async () => {
    const minhas = [await tarefa('a'), await tarefa('b')];
    const dooutro = await tarefa('c');
    for (const id of minhas) await svc.assumir(ORG, id, 'analista-a4', { actorId: 'u-1' });
    await svc.assumir(ORG, dooutro, 'redator-a4', { actorId: 'u-1' });

    const soltas = await prisma.$transaction((tx) =>
      svc.soltarTodasDoAgente(tx, ORG, idAtivo, MOTIVO_DA_SOLTURA.agentePausado),
    );
    expect(soltas.map((t) => t.id).sort()).toEqual([...minhas].sort());

    const estado = await prisma.workTask.findMany({
      where: { orgId: ORG },
      select: { id: true, agenteId: true },
    });
    expect(estado.filter((t) => t.agenteId === idAtivo)).toHaveLength(0);
    /* A do outro agente NÃO foi tocada: soltar é por agente, não por empresa. */
    expect(estado.find((t) => t.id === dooutro)?.agenteId).toBe(idSegundo);
  });

  it('agente sem tarefa na mão solta uma lista vazia, sem escrever nada', async () => {
    const soltas = await prisma.$transaction((tx) =>
      svc.soltarTodasDoAgente(tx, ORG, idSegundo, MOTIVO_DA_SOLTURA.agenteEncerrado),
    );
    expect(soltas).toEqual([]);
  });
});
