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
 * TODA TAREFA LIGADA A UM CLIENTE (rodada do trabalho T4, 19/10/2026) e a
 * porta única da implantação (T1).
 *
 *  1. a rota (exigirCliente) recusa tarefa nova sem cliente, com a frase;
 *  2. `interno` cria o cliente da casa UMA vez, mesmo com dois pedidos juntos;
 *  3. cliente de outra empresa é recusado no serviço e no banco (gatilho);
 *  4. subtarefa sem cliente herda o da mãe;
 *  5. a tarefa antiga sem cliente não trava edição; o filtro `cliente=sem` acha;
 *  6. a lista do seletor traz o da casa primeiro e só clientes desta empresa;
 *  7. a lista "Onboarding de cliente" da pasta "Clientes" não recebe cartão solto
 *     (subtarefa vale).
 */

const URL = process.env.TEST_DATABASE_URL;
const CASA = 'org-teste-cliente-casa';
const VIZINHA = 'org-teste-cliente-vizinha';
const EMPRESAS = [CASA, VIZINHA];
const EU = 'u-cliente-casa';

async function status(chamada: Promise<unknown>): Promise<number | string> {
  try { await chamada; return 'ok'; } catch (e) { return e instanceof HttpException ? e.getStatus() : String((e as { code?: string }).code ?? (e as Error).message); }
}

exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (duas empresas, clientes, listas e tarefas)');

describe.skipIf(!URL)('trabalho: o cliente da tarefa', () => {
  let prisma: PrismaClient;
  let svc: WorkService;
  let lista: string;
  let onb: string;
  let alicerce: string;
  let daVizinha: string;

  async function limpar() {
    await prisma.workTask.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    await prisma.workStatus.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    await prisma.workList.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    await prisma.workFolder.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    await prisma.partner.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    await prisma.auditLog.deleteMany({ where: { orgId: { in: EMPRESAS } } });
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    svc = new WorkService(p, audit, new CheckoutDeTarefaService(p, audit, new EventLogService(p)));
    for (const orgId of EMPRESAS) await prisma.org.upsert({ where: { id: orgId }, create: { id: orgId, name: orgId === CASA ? 'Root' : 'Vizinha', slug: orgId }, update: {} });
    await prisma.user.upsert({ where: { id: EU }, create: { id: EU, orgId: CASA, name: 'Rodrigo', email: `${EU}@teste.local`, passwordHash: 'x' }, update: {} });
  });

  beforeEach(async () => {
    await limpar();
    const pasta = await prisma.workFolder.create({ data: { orgId: CASA, name: 'Clientes' } });
    lista = (await prisma.workList.create({ data: { orgId: CASA, folderId: pasta.id, name: 'Execução' } })).id;
    onb = (await prisma.workList.create({ data: { orgId: CASA, folderId: pasta.id, name: ' onboarding  de cliente ' } })).id;
    for (const l of [lista, onb]) await prisma.workStatus.create({ data: { orgId: CASA, listId: l, name: 'A fazer', type: 'open', order: 0 } });
    alicerce = (await prisma.partner.create({ data: { orgId: CASA, isCliente: true, razaoSocial: 'Construtora Alicerce Ltda', nomeFantasia: 'Construtora Alicerce', cnpjCpf: '12345678000190' } })).id;
    await prisma.partner.create({ data: { orgId: CASA, isFornecedor: true, razaoSocial: 'Fornecedor X' } });
    daVizinha = (await prisma.partner.create({ data: { orgId: VIZINHA, isCliente: true, razaoSocial: 'Cliente da vizinha' } })).id;
  });

  afterAll(async () => {
    await limpar();
    await prisma.user.deleteMany({ where: { id: EU } });
    await prisma.org.deleteMany({ where: { id: { in: EMPRESAS } } });
    await prisma.$disconnect();
  });

  it('a rota recusa tarefa nova sem cliente; com cliente grava e devolve o nome', async () => {
    await expect(svc.criarTarefa(CASA, EU, { listId: lista, title: 'Enviar proposta revisada' }, { exigirCliente: true }))
      .rejects.toThrow(/Escolha o cliente da tarefa/);
    const t = await svc.criarTarefa(CASA, EU, { listId: lista, title: 'Enviar proposta revisada', clienteId: alicerce }, { exigirCliente: true });
    expect(t.clienteId).toBe(alicerce);
    expect(t.clienteNome).toBe('Construtora Alicerce');
  });

  it('`interno` cria o cliente da casa uma vez só, mesmo com dois pedidos juntos', async () => {
    const [a, b] = await Promise.all([
      svc.criarTarefa(CASA, EU, { listId: lista, title: 'Pagar o contador', clienteId: 'interno' }, { exigirCliente: true }),
      svc.criarTarefa(CASA, EU, { listId: lista, title: 'Renovar o domínio', clienteId: 'interno' }, { exigirCliente: true }),
    ]);
    expect(a.clienteId).toBe(b.clienteId);
    expect(a.clienteNome).toBe('Root (interno)');
    expect(await prisma.partner.count({ where: { orgId: CASA, interno: true } })).toBe(1);
  });

  it('cliente de outra empresa ou cadastro que não é cliente: recusado no serviço e no banco', async () => {
    expect(await status(svc.criarTarefa(CASA, EU, { listId: lista, title: 'Marcar kickoff', clienteId: daVizinha }, { exigirCliente: true }))).toBe(400);
    const fornecedor = (await prisma.partner.findFirstOrThrow({ where: { orgId: CASA, isFornecedor: true } })).id;
    expect(await status(svc.criarTarefa(CASA, EU, { listId: lista, title: 'Marcar kickoff', clienteId: fornecedor }, { exigirCliente: true }))).toBe(400);
    const st = await prisma.workStatus.findFirstOrThrow({ where: { listId: lista } });
    // O gatilho do banco segura o que escapar do serviço.
    expect(await status(prisma.workTask.create({ data: { orgId: CASA, listId: lista, statusId: st.id, title: 'x', clienteId: daVizinha } }))).not.toBe('ok');
    expect(await prisma.workTask.count({ where: { orgId: CASA } })).toBe(0);
  });

  it('subtarefa sem cliente herda o da mãe', async () => {
    const mae = await svc.criarTarefa(CASA, EU, { listId: lista, title: 'Instalar o kit', clienteId: alicerce }, { exigirCliente: true });
    const filha = await svc.criarTarefa(CASA, EU, { listId: lista, title: 'Testar o acesso', parentId: mae.id }, { exigirCliente: true });
    expect(filha.clienteId).toBe(alicerce);
  });

  it('a tarefa antiga sem cliente edita normalmente e o filtro cliente=sem acha; trocar o cliente vai à auditoria', async () => {
    const st = await prisma.workStatus.findFirstOrThrow({ where: { listId: lista } });
    const antiga = await prisma.workTask.create({ data: { orgId: CASA, listId: lista, statusId: st.id, title: 'Tarefa do ClickUp' } });
    await svc.criarTarefa(CASA, EU, { listId: lista, title: 'Marcar kickoff', clienteId: alicerce }, { exigirCliente: true });
    const editada = await svc.editarTarefa(CASA, EU, antiga.id, { title: 'Revisar a tarefa do ClickUp' });
    expect(editada.clienteId).toBeNull();
    const sem = await svc.tarefas(CASA, parseWorkTaskQuery({ listId: lista, cliente: 'sem' }));
    expect(sem.items.map((t) => t.id)).toEqual([antiga.id]);
    const daAlicerce = await svc.tarefas(CASA, parseWorkTaskQuery({ listId: lista, cliente: alicerce }));
    expect(daAlicerce.items.map((t) => t.title)).toEqual(['Marcar kickoff']);
    await svc.editarTarefa(CASA, EU, antiga.id, { clienteId: alicerce });
    const linha = await prisma.auditLog.findFirstOrThrow({ where: { orgId: CASA, entityId: antiga.id, action: 'work.task.update' }, orderBy: { createdAt: 'desc' } });
    expect((linha.after as { clienteId?: string }).clienteId).toBe(alicerce);
    expect(() => parseWorkTaskQuery({ cliente: 'abc' })).toThrow(/cliente/);
  });

  it('o seletor traz o da casa primeiro e só clientes ativos desta empresa, com busca por nome ou CNPJ', async () => {
    const todos = await svc.clientes(CASA);
    expect(todos.map((c) => [c.nome, c.interno])).toEqual([['Root (interno)', true], ['Construtora Alicerce', false]]);
    expect(todos[0].id).toBe('interno');
    expect((await svc.clientes(CASA, '12345678')).map((c) => c.nome)).toEqual(['Construtora Alicerce']);
    expect((await svc.clientes(CASA, 'vizinha')).length).toBe(0);
  });

  it('a lista da implantação não recebe cartão solto; subtarefa dentro do cartão vale', async () => {
    const st = await prisma.workStatus.findFirstOrThrow({ where: { listId: onb } });
    await expect(svc.criarTarefa(CASA, EU, { listId: onb, title: 'Cliente novo', clienteId: alicerce }, { exigirCliente: true })).rejects.toThrow(PORTA_DA_IMPLANTACAO);
    const card = await prisma.workTask.create({ data: { orgId: CASA, listId: onb, statusId: st.id, title: 'Construtora Alicerce', clienteId: alicerce } });
    const sub = await svc.criarTarefa(CASA, EU, { listId: onb, title: 'Marcar kickoff', parentId: card.id }, { exigirCliente: true });
    expect(sub.clienteId).toBe(alicerce);
  });

  it('a lista da implantação não sai da pasta Clientes nem muda de nome; outras listas mudam', async () => {
    const outra = await prisma.workFolder.create({ data: { orgId: CASA, name: 'Gestão' } });
    await expect(svc.editarLista(CASA, EU, onb, { folderId: outra.id })).rejects.toThrow(/porta da implantação/);
    await expect(svc.editarLista(CASA, EU, onb, { name: 'Onboarding antigo' })).rejects.toThrow(/porta da implantação/);
    await svc.editarLista(CASA, EU, lista, { folderId: outra.id });
    expect((await prisma.workList.findUniqueOrThrow({ where: { id: lista } })).folderId).toBe(outra.id);
    expect((await prisma.workList.findUniqueOrThrow({ where: { id: onb } })).name).toBe(' onboarding  de cliente ');
  });
});
