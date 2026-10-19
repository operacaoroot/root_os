import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PORTA_DA_IMPLANTACAO } from '@mktos/shared';
import { AuditService } from '../src/audit/audit.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { CheckoutDeTarefaService } from '../src/work/checkout-de-tarefa.service';
import { WorkService } from '../src/work/work.service';
import { parseWorkTaskQuery } from '../src/work/work-task-query';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * VERSÃO FINAL, F4 (19/10/2026): o que veio das tarefas do Lucas para o Trabalho,
 * pelas regras nossas (versão lida, cliente, porta da implantação, auditoria).
 *
 *  1. vários responsáveis: o principal em `assigneeUserId`, os demais à parte, só
 *     contas ativas desta empresa; o filtro da pessoa acha a tarefa pelos dois;
 *  2. tarefa que se repete: concluir (por qualquer caminho de edição) cria UMA
 *     próxima, com o cliente, os responsáveis e a regra; reabrir e concluir de novo
 *     não duplica; o cartão da implantação não recebe regra (porta única);
 *  3. ordem manual: a sequência inteira com as versões lidas; uma vencida é 409 e
 *     nada é gravado;
 *  4. "Todas": só tarefas de verdade (sem cadastro, sem subtarefa de tarefa).
 */

const URL = process.env.TEST_DATABASE_URL;
const CASA = 'org-teste-f4-casa';
const VIZINHA = 'org-teste-f4-vizinha';
const EMPRESAS = [CASA, VIZINHA];
const EU = '0f4f4f4f-0000-4000-8000-000000000001';
const ANA = '0f4f4f4f-0000-4000-8000-000000000002';
const INATIVO = '0f4f4f4f-0000-4000-8000-000000000003';
const DE_FORA = '0f4f4f4f-0000-4000-8000-000000000004';
const PESSOAS = [EU, ANA, INATIVO, DE_FORA];

async function status(chamada: Promise<unknown>): Promise<number | string> {
  try { await chamada; return 'ok'; } catch (e) { return e instanceof HttpException ? e.getStatus() : String((e as Error).message); }
}

exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (duas empresas, pessoas, listas e tarefas)');

describe.skipIf(!URL)('Trabalho F4: responsáveis, repetição, ordem e "Todas"', () => {
  let prisma: PrismaClient;
  let svc: WorkService;
  let lista: string;
  let aberto: string;
  let feito: string;
  let onb: string;
  let cadastro: string;
  let cliente: string;

  async function limpar(tentativa = 1): Promise<void> {
    try {
      await prisma.workTask.deleteMany({ where: { orgId: { in: EMPRESAS }, parentId: { not: null } } });
      await prisma.workTask.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workStatus.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workList.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workFolder.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.partner.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.auditLog.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    } catch (e) {
      if (tentativa < 4 && /40P01|deadlock/.test(String((e as Error).message))) return limpar(tentativa + 1);
      throw e;
    }
  }

  const versao = async (id: string) => (await prisma.workTask.findUniqueOrThrow({ where: { id } })).updatedAt.toISOString();

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    svc = new WorkService(p, audit, new CheckoutDeTarefaService(p, audit, new EventLogService(p)));
    for (const orgId of EMPRESAS) await prisma.org.upsert({ where: { id: orgId }, create: { id: orgId, name: orgId === CASA ? 'Casa F4' : 'Vizinha F4', slug: orgId }, update: {} });
    const permissoes = [];
    for (const key of ['tarefas.ver', 'tarefas.editar']) permissoes.push(await prisma.permission.upsert({ where: { key }, create: { key }, update: {}, select: { id: true } }));
    const papel = await prisma.role.upsert({
      where: { orgId_key: { orgId: CASA, key: 'analista' } },
      create: { orgId: CASA, key: 'analista', name: 'Analista', permissions: { connect: permissoes } },
      update: { permissions: { connect: permissoes } },
      select: { id: true },
    });
    const gente: [string, string, string, boolean][] = [[EU, CASA, 'Rodrigo F4', true], [ANA, CASA, 'Ana F4', true], [INATIVO, CASA, 'Antigo F4', false], [DE_FORA, VIZINHA, 'Vizinho F4', true]];
    for (const [id, orgId, name, isActive] of gente) {
      await prisma.user.upsert({
        where: { id },
        create: { id, orgId, name, isActive, email: `${id}@f4.test`, passwordHash: 'x', ...(id === EU ? { roles: { connect: { id: papel.id } } } : {}) },
        update: { isActive },
      });
    }
  });

  beforeEach(async () => {
    await limpar();
    const pasta = await prisma.workFolder.create({ data: { orgId: CASA, name: 'Clientes' } });
    lista = (await prisma.workList.create({ data: { orgId: CASA, folderId: pasta.id, name: 'Execução' } })).id;
    onb = (await prisma.workList.create({ data: { orgId: CASA, folderId: pasta.id, name: 'Onboarding de cliente' } })).id;
    cadastro = (await prisma.workList.create({ data: { orgId: CASA, name: 'Cadastro de clientes', natureza: 'cadastro' } })).id;
    aberto = (await prisma.workStatus.create({ data: { orgId: CASA, listId: lista, name: 'A fazer', type: 'open', order: 0 } })).id;
    feito = (await prisma.workStatus.create({ data: { orgId: CASA, listId: lista, name: 'Feito', type: 'closed', order: 1 } })).id;
    for (const l of [onb, cadastro]) await prisma.workStatus.create({ data: { orgId: CASA, listId: l, name: 'A fazer', type: 'open', order: 0 } });
    cliente = (await prisma.partner.create({ data: { orgId: CASA, isCliente: true, razaoSocial: 'Construtora Alicerce Ltda' } })).id;
  });

  afterAll(async () => {
    await limpar();
    await prisma.user.deleteMany({ where: { id: { in: PESSOAS } } });
    await prisma.role.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    await prisma.org.deleteMany({ where: { id: { in: EMPRESAS } } });
    await prisma.$disconnect();
  });

  it('vários responsáveis: o principal fica fora dos demais, conta inativa ou de outra empresa não entra, e a auditoria registra', async () => {
    const t = await svc.criarTarefa(CASA, EU, { listId: lista, title: 'Revisar o contrato', clienteId: cliente, assigneeUserId: EU }, { exigirCliente: true });
    const editada = await svc.editarTarefa(CASA, EU, t.id, { outrosResponsaveisIds: [ANA, EU, ANA], expectedUpdatedAt: t.updatedAt });
    expect(editada.assigneeUserId).toBe(EU);
    expect(editada.outrosResponsaveisIds).toEqual([ANA]);
    expect(await status(svc.editarTarefa(CASA, EU, t.id, { outrosResponsaveisIds: [ANA, INATIVO], expectedUpdatedAt: editada.updatedAt }))).toBe(400);
    expect(await status(svc.editarTarefa(CASA, EU, t.id, { outrosResponsaveisIds: [DE_FORA], expectedUpdatedAt: editada.updatedAt }))).toBe(400);
    // Versão vencida não grava, nem os demais responsáveis.
    expect(await status(svc.editarTarefa(CASA, EU, t.id, { outrosResponsaveisIds: [], expectedUpdatedAt: t.updatedAt }))).toBe(409);
    const linha = await prisma.auditLog.findFirstOrThrow({ where: { orgId: CASA, entityId: t.id, action: 'work.task.update' }, orderBy: { createdAt: 'desc' } });
    expect((linha.after as { outrosResponsaveisIds?: string[] }).outrosResponsaveisIds).toEqual([ANA]);
    // Quem vira principal sai dos demais.
    const troca = await svc.editarTarefa(CASA, EU, t.id, { assigneeUserId: ANA, expectedUpdatedAt: editada.updatedAt });
    expect(troca.assigneeUserId).toBe(ANA);
    expect(troca.outrosResponsaveisIds).toEqual([]);
  });

  it('o filtro da pessoa acha a tarefa em que ela é a principal ou uma das demais', async () => {
    const minha = await svc.criarTarefa(CASA, EU, { listId: lista, title: 'Ligar para o cliente', clienteId: cliente, assigneeUserId: EU }, { exigirCliente: true });
    const junto = await svc.criarTarefa(CASA, EU, { listId: lista, title: 'Montar a apresentação', clienteId: cliente, assigneeUserId: ANA }, { exigirCliente: true });
    await svc.criarTarefa(CASA, EU, { listId: lista, title: 'Pagar o fornecedor', clienteId: cliente, assigneeUserId: ANA }, { exigirCliente: true });
    await svc.editarTarefa(CASA, EU, junto.id, { outrosResponsaveisIds: [EU], expectedUpdatedAt: junto.updatedAt });
    const r = await svc.tarefas(CASA, parseWorkTaskQuery({ assigneeUserId: EU }));
    expect(r.items.map((x) => x.id).sort()).toEqual([minha.id, junto.id].sort());
  });

  it('concluir a tarefa que se repete cria UMA próxima, com cliente, responsáveis e regra; reabrir e concluir não duplica', async () => {
    const t = await svc.criarTarefa(CASA, EU, {
      listId: lista, title: 'Enviar o relatório', clienteId: cliente, assigneeUserId: EU,
      dueDate: '2099-01-05T03:00:00.000Z',
    }, { exigirCliente: true });
    const comRegra = await svc.editarTarefa(CASA, EU, t.id, { recorrencia: { tipo: 'semanal', dias: [1] }, outrosResponsaveisIds: [ANA], expectedUpdatedAt: t.updatedAt });
    expect(comRegra.recorrencia).toEqual({ tipo: 'semanal', dias: [1] });
    const concluida = await svc.editarTarefa(CASA, EU, t.id, { statusId: feito, expectedUpdatedAt: comRegra.updatedAt });
    expect(concluida.statusType).toBe('closed');
    expect(concluida.proxima?.dueDate).toBe('2099-01-12T03:00:00.000Z');
    const proxima = await svc.tarefa(CASA, concluida.proxima!.id);
    expect(proxima).toMatchObject({
      title: 'Enviar o relatório', listId: lista, statusId: aberto, clienteId: cliente, assigneeUserId: EU,
      outrosResponsaveisIds: [ANA], recorrencia: { tipo: 'semanal', dias: [1] },
    });
    // Reabrir e concluir de novo devolve a mesma próxima.
    const reaberta = await svc.editarTarefa(CASA, EU, t.id, { statusId: aberto, expectedUpdatedAt: concluida.updatedAt });
    const outraVez = await svc.editarTarefa(CASA, EU, t.id, { statusId: feito, expectedUpdatedAt: reaberta.updatedAt });
    expect(outraVez.proxima?.id).toBe(proxima.id);
    expect(await prisma.workTask.count({ where: { orgId: CASA, title: 'Enviar o relatório' } })).toBe(2);
  });

  it('tarefa sem regra conclui sem criar nada; regra inválida é recusada; o cartão da implantação não recebe regra', async () => {
    const t = await svc.criarTarefa(CASA, EU, { listId: lista, title: 'Arquivar o contrato', clienteId: cliente }, { exigirCliente: true });
    const c = await svc.editarTarefa(CASA, EU, t.id, { statusId: feito, expectedUpdatedAt: t.updatedAt });
    expect(c.proxima).toBeUndefined();
    expect(await prisma.workTask.count({ where: { orgId: CASA } })).toBe(1);
    const st = await prisma.workStatus.findFirstOrThrow({ where: { listId: onb } });
    const card = await prisma.workTask.create({ data: { orgId: CASA, listId: onb, statusId: st.id, title: 'Construtora Alicerce', clienteId: cliente } });
    await expect(svc.editarTarefa(CASA, EU, card.id, { recorrencia: { tipo: 'diaria' }, expectedUpdatedAt: card.updatedAt.toISOString() }))
      .rejects.toThrow(PORTA_DA_IMPLANTACAO);
  });

  it('ordem manual: a sequência vira 10, 20, 30 com a versão lida; uma vencida é 409 e nada muda', async () => {
    const a = await svc.criarTarefa(CASA, EU, { listId: lista, title: 'Tarefa A', clienteId: cliente }, { exigirCliente: true });
    const b = await svc.criarTarefa(CASA, EU, { listId: lista, title: 'Tarefa B', clienteId: cliente }, { exigirCliente: true });
    const c = await svc.criarTarefa(CASA, EU, { listId: lista, title: 'Tarefa C', clienteId: cliente }, { exigirCliente: true });
    await svc.reordenar(CASA, EU, { itens: [c, a, b].map((x) => ({ id: x.id, expectedUpdatedAt: x.updatedAt })) });
    const lidas = await svc.tarefas(CASA, parseWorkTaskQuery({ listId: lista }));
    expect(lidas.items.map((x) => x.title)).toEqual(['Tarefa C', 'Tarefa A', 'Tarefa B']);
    // Versão de antes da reordenação: vencida.
    expect(await status(svc.reordenar(CASA, EU, { itens: [a, b, c].map((x) => ({ id: x.id, expectedUpdatedAt: x.updatedAt })) }))).toBe(409);
    expect((await svc.tarefas(CASA, parseWorkTaskQuery({ listId: lista }))).items.map((x) => x.title)).toEqual(['Tarefa C', 'Tarefa A', 'Tarefa B']);
    expect(await status(svc.reordenar(CASA, EU, { itens: [{ id: a.id, expectedUpdatedAt: await versao(a.id) }, { id: a.id, expectedUpdatedAt: await versao(a.id) }] }))).toBe(400);
    // Pessoa sem o papel no banco não reordena.
    expect(await status(svc.reordenar(CASA, ANA, { itens: [{ id: a.id, expectedUpdatedAt: await versao(a.id) }] }))).toBe(403);
  });

  it('"Todas": tarefas de todas as listas, sem cadastro e sem subtarefa de tarefa; a que pende de cadastro sobe', async () => {
    const solta = await svc.criarTarefa(CASA, EU, { listId: lista, title: 'Marcar kickoff', clienteId: cliente }, { exigirCliente: true });
    await svc.criarTarefa(CASA, EU, { listId: lista, title: 'Subtarefa do kickoff', parentId: solta.id }, { exigirCliente: true });
    const st = await prisma.workStatus.findFirstOrThrow({ where: { listId: cadastro } });
    const ficha = await prisma.workTask.create({ data: { orgId: CASA, listId: cadastro, statusId: st.id, title: 'Construtora Alicerce' } });
    const daFicha = await prisma.workTask.create({ data: { orgId: CASA, listId: lista, statusId: aberto, title: 'Cobrar documentos', parentId: ficha.id, clienteId: cliente } });
    const r = await svc.tarefas(CASA, parseWorkTaskQuery({ todas: '1' }));
    expect(r.items.map((x) => x.id).sort()).toEqual([solta.id, daFicha.id].sort());
    expect(r.items.every((x) => x.listName === 'Execução')).toBe(true);
  });
});
