import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { TrabCampoCreateSchema, type TrabTarefaUpdateHttpInput } from '@mktos/shared';
import { AuditService } from '../src/audit/audit.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { CheckoutDeTarefaService } from '../src/work/checkout-de-tarefa.service';
import { WorkService } from '../src/work/work.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * O CAMPO `moeda` NA API DO TRABALHO (ROOT-06a, com a errata E1 e o achado A4).
 *
 * O que se cobra:
 *  1. Num campo `moeda` só entra o texto canônico (`BRL 1500.00`); digitação
 *     pt-BR, número sem moeda e símbolo recebem 400, e `optionId` também.
 *     `value: null` apaga, como nos outros tipos; texto continua livre.
 *  2. A conferência de TODOS os campos acontece antes da primeira escrita: POST
 *     com moeda inválida não cria tarefa (e repetir não duplica), e PATCH com um
 *     texto válido ao lado de uma moeda inválida não grava nem o texto.
 *  3. A escrita da tarefa e dos valores é uma transação: falha no meio desfaz o
 *     que já tinha sido gravado.
 *  4. A auditoria de `work.task.update` passa a guardar o antes e o depois dos
 *     campos do pedido, então trocar um valor monetário deixa rastro.
 *
 * A primeira parte usa um Prisma de mentira e roda sem banco; a segunda, com
 * `TEST_DATABASE_URL`, mede no Postgres o que ficou gravado.
 */

const MENSAGEM_MONETARIA = (campo: string) => `Valor de ${campo} fora do formato monetário (exemplo: BRL 1500.00).`;

async function erroDe(chamada: Promise<unknown>): Promise<{ status: number | null; mensagem: string } | 'sem erro'> {
  try {
    await chamada;
    return 'sem erro';
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), mensagem: e.message };
    return { status: null, mensagem: (e as Error).message };
  }
}

/* ==========================================================================
 * 1. AS REGRAS, com Prisma de mentira
 * ========================================================================== */

const ORG = 'org-moeda-falsa';
const LISTA = 'lista-falsa';
const TAREFA = 'tarefa-falsa';
const VERSAO_FALSA = '2026-10-07T00:00:00.000Z';
const CAMPOS_FALSOS = [
  { id: 'c-valor', name: 'Valor em negocição', type: 'moeda', options: [] },
  { id: 'c-obs', name: 'Observação', type: 'texto', options: [] },
  { id: 'c-perfil', name: 'Perfil', type: 'drop_down', options: [{ id: 'op-p1', name: 'P1' }] },
];

function servicoFalso(valoresIniciais: Record<string, { optionId: string | null; value: string | null }> = {}) {
  const valores = new Map(Object.entries(valoresIniciais));
  const chamadas = { create: 0, update: 0, upsert: [] as unknown[], deleteMany: [] as unknown[] };
  const tarefa = { id: TAREFA, orgId: ORG, listId: LISTA, title: 'Lead', assignee: null, assigneeUserId: null, updatedAt: new Date(VERSAO_FALSA), priority: 'normal', status: { name: 'oportunidade' }, tags: [] };
  const leitura = vi.fn(async () => ({ ...tarefa, status: { ...tarefa.status } }));
  const prisma: Record<string, unknown> = {
    workList: { findFirst: async () => ({ id: LISTA, orgId: ORG, statuses: [{ id: 'st-1' }] }) },
    workTask: {
      findFirst: leitura,
      create: async () => { chamadas.create++; return { id: TAREFA, listId: LISTA }; },
      updateMany: async ({ data }: { data: Record<string, unknown> }) => { chamadas.update++; for (const [key, value] of Object.entries(data)) if (value !== undefined) Object.assign(tarefa, { [key]: value }); return { count: 1 }; },
      update: async ({ data }: { data: { title?: string } }) => { chamadas.update++; return { ...tarefa, title: data.title ?? tarefa.title }; },
    },
    workField: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        CAMPOS_FALSOS.filter((c) => where.id.in.includes(c.id)).map((c) => ({ ...c, orgId: ORG, listId: LISTA })),
    },
    workFieldValue: {
      findMany: async ({ where }: { where: { fieldId: { in: string[] } } }) => [...valores]
        .filter(([fieldId]) => where.fieldId.in.includes(fieldId))
        .map(([fieldId, v]) => ({ fieldId, ...v, option: CAMPOS_FALSOS.flatMap((c) => c.options).find((o) => o.id === v.optionId) ?? null })),
      upsert: async (args: { where: { taskId_fieldId: { fieldId: string } }; update: { optionId: string | null; value: string | null } }) => {
        chamadas.upsert.push(args);
        valores.set(args.where.taskId_fieldId.fieldId, args.update);
      },
      deleteMany: async (args: { where: { fieldId: string } }) => { chamadas.deleteMany.push(args); valores.delete(args.where.fieldId); },
    },
  };
  prisma.$transaction = async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma);
  const audit = { log: vi.fn(async () => undefined) };
  const svc = new WorkService(prisma as unknown as PrismaService, audit as unknown as AuditService, {} as CheckoutDeTarefaService);
  vi.spyOn(svc, 'tarefa').mockResolvedValue({ id: TAREFA } as never);
  return { svc, chamadas, audit, valores, leitura };
}

describe('escritor interno de tarefa exige versão antes da leitura', () => {
  it.each([undefined, null, '', '2026-10-08', 'data-inválida'])('versão %j recusa sem consultar ou alterar conteúdo', async (version) => {
    const { svc, chamadas, audit, valores, leitura } = servicoFalso({ 'c-obs': { optionId: null, value: 'Material preservado' } });
    const body = { title: 'Pedido antigo sem versão válida', campos: { 'c-obs': { value: 'Não gravar' } },
      ...(version === undefined ? {} : { expectedUpdatedAt: version }) } as TrabTarefaUpdateHttpInput;
    expect(await erroDe(svc.editarTarefa(ORG, 'eu', TAREFA, body))).toEqual({
      status: 400, mensagem: 'Informe uma versão válida da tarefa antes de editar.',
    });
    expect(leitura).not.toHaveBeenCalled();
    expect(chamadas).toEqual({ create: 0, update: 0, upsert: [], deleteMany: [] });
    expect(audit.log).not.toHaveBeenCalled();
    expect(valores.get('c-obs')).toEqual({ optionId: null, value: 'Material preservado' });
  });
});

describe('campo moeda: o que a API aceita', () => {
  it('POST /trabalho/campos aceita o tipo moeda; tipo desconhecido continua recusado', () => {
    expect(TrabCampoCreateSchema.parse({ name: 'Valor em negocição', type: 'moeda' })).toMatchObject({ type: 'moeda' });
    expect(TrabCampoCreateSchema.safeParse({ name: 'Valor', type: 'currency' }).success).toBe(false);
  });

  it('BRL 1500.00 chega ao upsert sem mudança e sem opção', async () => {
    const { svc, chamadas } = servicoFalso();
    await svc.editarTarefa(ORG, 'eu', TAREFA, { expectedUpdatedAt: VERSAO_FALSA, campos: { 'c-valor': { value: 'BRL 1500.00' } } });
    expect(chamadas.upsert).toEqual([{
      where: { taskId_fieldId: { taskId: TAREFA, fieldId: 'c-valor' } },
      update: { optionId: null, value: 'BRL 1500.00' },
      create: { taskId: TAREFA, fieldId: 'c-valor', optionId: null, value: 'BRL 1500.00' },
    }]);
  });

  it.each(['1.500,00', '1500', '1500.00', 'BRL 1500', 'R$ 1.500,00', 'BRL -0.00', 'BRL 1500.0', 'brl 1500.00', 'XXY 1.00', ''])(
    '%j recebe 400 e nada é gravado', async (value) => {
      const { svc, chamadas } = servicoFalso();
      expect(await erroDe(svc.editarTarefa(ORG, 'eu', TAREFA, { expectedUpdatedAt: VERSAO_FALSA, campos: { 'c-valor': { value } } })))
        .toEqual({ status: 400, mensagem: MENSAGEM_MONETARIA('Valor em negocição') });
      expect(chamadas).toEqual({ create: 0, update: 0, upsert: [], deleteMany: [] });
    },
  );

  it('optionId num campo moeda recebe 400, com ou sem valor', async () => {
    for (const v of [{ optionId: 'op-p1' }, { optionId: 'op-p1', value: 'BRL 1500.00' }, { optionId: 'op-p1', value: null }]) {
      const { svc, chamadas } = servicoFalso();
      expect(await erroDe(svc.editarTarefa(ORG, 'eu', TAREFA, { expectedUpdatedAt: VERSAO_FALSA, campos: { 'c-valor': v } })))
        .toEqual({ status: 400, mensagem: MENSAGEM_MONETARIA('Valor em negocição') });
      expect(chamadas.upsert).toEqual([]);
    }
  });

  it('value null apaga, como nos outros tipos', async () => {
    for (const v of [{ value: null }, {}, { optionId: null }]) {
      const { svc, chamadas } = servicoFalso({ 'c-valor': { optionId: null, value: 'BRL 1500.00' } });
      await svc.editarTarefa(ORG, 'eu', TAREFA, { expectedUpdatedAt: VERSAO_FALSA, campos: { 'c-valor': v } });
      expect(chamadas.upsert).toEqual([]);
      expect(chamadas.deleteMany).toEqual([{ where: { taskId: TAREFA, fieldId: 'c-valor' } }]);
    }
  });

  it('campo texto continua aceitando texto livre, inclusive com cara de dinheiro', async () => {
    const { svc, chamadas } = servicoFalso();
    await svc.editarTarefa(ORG, 'eu', TAREFA, { expectedUpdatedAt: VERSAO_FALSA, campos: { 'c-obs': { value: 'R$ 15 mil, a confirmar' } } });
    expect(chamadas.upsert).toEqual([expect.objectContaining({ update: { optionId: null, value: 'R$ 15 mil, a confirmar' } })]);
  });
});

describe('campo moeda: tudo é conferido antes da primeira escrita (E1)', () => {
  it('POST com moeda inválida: 400 e nenhuma tarefa criada', async () => {
    const { svc, chamadas, audit } = servicoFalso();
    const erro = await erroDe(svc.criarTarefa(ORG, 'eu', {
      listId: LISTA, title: 'Lead novo', campos: { 'c-obs': { value: 'ok' }, 'c-valor': { value: '1.500,00' } },
    }));
    expect(erro).toEqual({ status: 400, mensagem: MENSAGEM_MONETARIA('Valor em negocição') });
    expect(chamadas).toEqual({ create: 0, update: 0, upsert: [], deleteMany: [] });
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('PATCH com texto válido e moeda inválida: 400 e nada alterado, nem o título', async () => {
    const { svc, chamadas, audit, valores } = servicoFalso({ 'c-obs': { optionId: null, value: 'antes' } });
    const erro = await erroDe(svc.editarTarefa(ORG, 'eu', TAREFA, { expectedUpdatedAt: VERSAO_FALSA,
      title: 'Título novo', campos: { 'c-obs': { value: 'depois' }, 'c-valor': { value: 'R$ 2.000,00' } },
    }));
    expect(erro).toEqual({ status: 400, mensagem: MENSAGEM_MONETARIA('Valor em negocição') });
    expect(chamadas).toEqual({ create: 0, update: 0, upsert: [], deleteMany: [] });
    expect(valores.get('c-obs')).toEqual({ optionId: null, value: 'antes' });
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('PATCH com opção de outro campo depois de um texto válido: 400 e nada gravado', async () => {
    const { svc, chamadas } = servicoFalso();
    expect(await erroDe(svc.editarTarefa(ORG, 'eu', TAREFA, { expectedUpdatedAt: VERSAO_FALSA,
      campos: { 'c-obs': { value: 'ok' }, 'c-perfil': { optionId: 'op-de-outro-campo' } },
    }))).toEqual({ status: 400, mensagem: 'Opção não pertence ao campo Perfil.' });
    expect(chamadas.upsert).toEqual([]);
  });

  it('campo que não vale para a lista: 400 antes de qualquer escrita', async () => {
    const { svc, chamadas } = servicoFalso();
    expect(await erroDe(svc.editarTarefa(ORG, 'eu', TAREFA, { expectedUpdatedAt: VERSAO_FALSA,
      campos: { 'c-obs': { value: 'ok' }, 'c-de-outra-lista': { value: 'x' } },
    }))).toEqual({ status: 400, mensagem: 'Campo c-de-outra-lista não vale para esta lista.' });
    expect(chamadas).toEqual({ create: 0, update: 0, upsert: [], deleteMany: [] });
  });
});

describe('campo moeda: a auditoria guarda o valor (A4)', () => {
  it('work.task.update leva o antes e o depois dos campos do pedido', async () => {
    const { svc, audit } = servicoFalso({ 'c-valor': { optionId: null, value: 'BRL 1500.00' } });
    await svc.editarTarefa(ORG, 'eu', TAREFA, { expectedUpdatedAt: VERSAO_FALSA, campos: { 'c-valor': { value: 'BRL 2000.00' }, 'c-perfil': { optionId: 'op-p1' } } });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'work.task.update', entityId: TAREFA,
      before: expect.objectContaining({ campos: {
        'c-valor': { campo: 'Valor em negocição', tipo: 'moeda', opcao: null, valor: 'BRL 1500.00' },
        'c-perfil': { campo: 'Perfil', tipo: 'drop_down', opcao: null, valor: null },
      } }),
      after: expect.objectContaining({ campos: {
        'c-valor': { campo: 'Valor em negocição', tipo: 'moeda', opcao: null, valor: 'BRL 2000.00' },
        'c-perfil': { campo: 'Perfil', tipo: 'drop_down', opcao: 'P1', valor: null },
      } }),
    }), expect.anything());
  });

  it('PATCH sem campos não ganha a chave campos na auditoria', async () => {
    const { svc, audit } = servicoFalso();
    await svc.editarTarefa(ORG, 'eu', TAREFA, { expectedUpdatedAt: VERSAO_FALSA, title: 'Só o título' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      before: { status: 'oportunidade', title: 'Lead', assignee: null, assigneeUserId: null, priority: 'normal' },
      after: { status: 'oportunidade', title: 'Só o título', assignee: null, assigneeUserId: null, priority: 'normal' },
    }), expect.anything());
  });
});

/* ==========================================================================
 * 2. NO BANCO: o que ficou gravado depois de cada recusa
 * ========================================================================== */

const URL = process.env.TEST_DATABASE_URL;
const CASA = 'org-teste-campo-moeda';
const EU = 'u-teste-campo-moeda';

exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (empresa, lista, campos, tarefas e auditoria do campo moeda)');

/**
 * O mesmo cliente, com todo segundo `upsert` de valor falhando, dentro e fora de
 * transação. Fora também, de propósito: sem a transação no serviço, a falha
 * continuaria acontecendo e a tarefa ficaria meio gravada, e o teste acusaria.
 */
function comFalhaNoSegundoValor(real: PrismaClient): PrismaService {
  const comFalha = (delegado: Prisma.WorkFieldValueDelegate, contador: { upserts: number }) => new Proxy(delegado, {
    get(d, metodo) {
      if (metodo !== 'upsert') return Reflect.get(d, metodo);
      return async (args: Prisma.WorkFieldValueUpsertArgs) => {
        contador.upserts += 1;
        if (contador.upserts % 2 === 0) throw new Error('falha simulada no meio da escrita');
        return d.upsert(args);
      };
    },
  });
  const foraDeTransacao = { upserts: 0 };
  return new Proxy(real, {
    // Sem `receptor`, como em `sessao-de-banco.ts`: o cliente do Prisma já é um
    // proxy, e reapontar o `this` faria cada acesso interno reentrar aqui.
    get(alvo, prop) {
      if (prop === 'workFieldValue') return comFalha(alvo.workFieldValue, foraDeTransacao);
      if (prop !== '$transaction') return Reflect.get(alvo, prop);
      return (fn: (tx: Prisma.TransactionClient) => Promise<unknown>) => alvo.$transaction(async (tx) => {
        const valores = comFalha(tx.workFieldValue, { upserts: 0 });
        return fn(new Proxy(tx, { get: (t, p) => (p === 'workFieldValue' ? valores : Reflect.get(t, p)) }));
      });
    },
  }) as unknown as PrismaService;
}

describe.skipIf(!URL)('campo moeda no banco: recusa não deixa nada gravado', () => {
  let prisma: PrismaClient;
  let svc: WorkService;
  let svcComFalha: WorkService;
  let lista: string;
  let valor: string;
  let obs: string;
  let alvo: string;
  let versaoInicial: string;

  const auditoria = async (action: string) => prisma.auditLog.count({ where: { orgId: CASA, action } });
  const valoresDe = async (taskId: string) => Object.fromEntries(
    (await prisma.workFieldValue.findMany({ where: { taskId } })).map((v) => [v.fieldId, v.value]),
  );

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    const checkout = new CheckoutDeTarefaService(p, audit, new EventLogService(p));
    svc = new WorkService(p, audit, checkout);
    svcComFalha = new WorkService(comFalhaNoSegundoValor(prisma), audit, checkout);
    await prisma.org.upsert({ where: { id: CASA }, create: { id: CASA, name: CASA, slug: CASA }, update: {} });
    await prisma.user.upsert({
      where: { id: EU }, create: { id: EU, orgId: CASA, name: EU, email: `${EU}@teste.local`, passwordHash: 'x' }, update: {},
    });
    await prisma.workTask.deleteMany({ where: { orgId: CASA } });
    await prisma.workList.deleteMany({ where: { orgId: CASA } });
    lista = (await svc.criarLista(CASA, EU, { name: 'Gestão de Leads' })).id;
    valor = (await svc.criarCampo(CASA, EU, { listId: lista, name: 'Valor em negocição', type: 'moeda' })).id;
    obs = (await svc.criarCampo(CASA, EU, { listId: lista, name: 'Observação', type: 'texto' })).id;
  });

  beforeEach(async () => {
    await prisma.workTask.deleteMany({ where: { orgId: CASA } });
    await prisma.auditLog.deleteMany({ where: { orgId: CASA, entityType: 'work_task' } });
    const criada = await svc.criarTarefa(CASA, EU, {
      listId: lista, title: 'Alvo', campos: { [obs]: { value: 'antes' }, [valor]: { value: 'BRL 1500.00' } },
    });
    alvo = criada.id;
    versaoInicial = criada.updatedAt;
    await prisma.auditLog.deleteMany({ where: { orgId: CASA, entityType: 'work_task' } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.workTask.deleteMany({ where: { orgId: CASA } });
    await prisma.workList.deleteMany({ where: { orgId: CASA } });
    await prisma.auditLog.deleteMany({ where: { orgId: CASA } });
    await prisma.user.deleteMany({ where: { id: EU } });
    await prisma.org.deleteMany({ where: { id: CASA } });
    await prisma.$disconnect();
  });

  it('POST inválido: 400, nenhuma tarefa nova; a nova tentativa cria uma só', async () => {
    const pedido = { listId: lista, title: 'Lead novo', campos: { [obs]: { value: 'ok' }, [valor]: { value: '1.500,00' } } };
    expect(await erroDe(svc.criarTarefa(CASA, EU, pedido))).toEqual({ status: 400, mensagem: MENSAGEM_MONETARIA('Valor em negocição') });
    expect(await prisma.workTask.count({ where: { orgId: CASA, title: 'Lead novo' } })).toBe(0);
    expect(await auditoria('work.task.create')).toBe(0);
    const criada = await svc.criarTarefa(CASA, EU, { ...pedido, campos: { ...pedido.campos, [valor]: { value: 'BRL 1500.00' } } });
    expect(await prisma.workTask.count({ where: { orgId: CASA, title: 'Lead novo' } })).toBe(1);
    expect(await valoresDe(criada.id)).toEqual({ [obs]: 'ok', [valor]: 'BRL 1500.00' });
  });

  it('PATCH com texto válido e moeda inválida: 400 e nenhum valor gravado', async () => {
    const erro = await erroDe(svc.editarTarefa(CASA, EU, alvo, { expectedUpdatedAt: versaoInicial,
      title: 'Outro título', campos: { [obs]: { value: 'depois' }, [valor]: { value: '2000.50' } },
    }));
    expect(erro).toEqual({ status: 400, mensagem: MENSAGEM_MONETARIA('Valor em negocição') });
    expect(await valoresDe(alvo)).toEqual({ [obs]: 'antes', [valor]: 'BRL 1500.00' });
    expect((await prisma.workTask.findUniqueOrThrow({ where: { id: alvo } })).title).toBe('Alvo');
    expect(await auditoria('work.task.update')).toBe(0);
  });

  it('falha no meio da escrita desfaz a tarefa e os valores já gravados', async () => {
    const erro = await erroDe(svcComFalha.editarTarefa(CASA, EU, alvo, { expectedUpdatedAt: versaoInicial,
      title: 'Outro título', campos: { [obs]: { value: 'depois' }, [valor]: { value: 'BRL 2000.50' } },
    }));
    expect(erro).toEqual({ status: null, mensagem: 'falha simulada no meio da escrita' });
    expect(await valoresDe(alvo)).toEqual({ [obs]: 'antes', [valor]: 'BRL 1500.00' });
    expect((await prisma.workTask.findUniqueOrThrow({ where: { id: alvo } })).title).toBe('Alvo');
    expect(await auditoria('work.task.update')).toBe(0);

    expect(await erroDe(svcComFalha.criarTarefa(CASA, EU, {
      listId: lista, title: 'Não nasce', campos: { [obs]: { value: 'x' }, [valor]: { value: 'BRL 1.00' } },
    }))).toEqual({ status: null, mensagem: 'falha simulada no meio da escrita' });
    expect(await prisma.workTask.count({ where: { orgId: CASA, title: 'Não nasce' } })).toBe(0);
  });

  it('PATCH válido grava o canônico, a leitura devolve type moeda e a auditoria guarda o antes e o depois', async () => {
    await svc.editarTarefa(CASA, EU, alvo, { expectedUpdatedAt: versaoInicial, campos: { [valor]: { value: 'BRL 2000.50' } } });
    expect(await valoresDe(alvo)).toEqual({ [obs]: 'antes', [valor]: 'BRL 2000.50' });
    const lida = (await svc.tarefas(CASA, { listId: lista })).items.find((t) => t.id === alvo)!;
    expect(lida.values.find((v) => v.fieldId === valor)).toMatchObject({ type: 'moeda', optionId: null, value: 'BRL 2000.50' });
    const registro = await prisma.auditLog.findFirstOrThrow({ where: { orgId: CASA, action: 'work.task.update', entityId: alvo } });
    expect(registro.before).toMatchObject({ campos: { [valor]: { tipo: 'moeda', valor: 'BRL 1500.00' } } });
    expect(registro.after).toMatchObject({ campos: { [valor]: { tipo: 'moeda', valor: 'BRL 2000.50' } } });
  });

  it('value null apaga o valor monetário', async () => {
    await svc.editarTarefa(CASA, EU, alvo, { expectedUpdatedAt: versaoInicial, campos: { [valor]: { value: null } } });
    expect(await valoresDe(alvo)).toEqual({ [obs]: 'antes' });
  });
});
