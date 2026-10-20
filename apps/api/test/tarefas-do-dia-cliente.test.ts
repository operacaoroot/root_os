import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient, WorkListaNatureza } from '@prisma/client';
import { AuditService } from '../src/audit/audit.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { CheckoutDeTarefaService } from '../src/work/checkout-de-tarefa.service';
import { WorkService } from '../src/work/work.service';
import { TarefasDoDiaService } from '../src/work/tarefas-do-dia.service';
import { acharClientePorNome, nomeDeClienteNormalizado } from '../src/work/clientes-da-casa';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * O CLIENTE NAS TAREFAS DE TODAS AS ÁREAS depois da conciliação (revisão final, 19/10/2026).
 *
 *  1.7 "Novo cliente" em /financeiro/tarefas, /marketing/tarefas e /comercial/tarefas
 *      acha ou cria o `Partner` cliente (a régua do Trabalho), nunca um card do CRM,
 *      e o id devolvido serve para ligar a tarefa (antes: 400 "Cliente não encontrado").
 *      Fornecedor de nome igual não vira cliente; cliente da vizinha não é achado.
 *  1.9 A deduplicação compara só o `clienteId` (Partner): o pai de cadastro (id de
 *      card) deixou de valer como "cliente" da tarefa.
 */

const URL = process.env.TEST_DATABASE_URL;
const CASA = 'org-teste-tdd-cliente-casa';
const VIZINHA = 'org-teste-tdd-cliente-vizinha';
const EMPRESAS = [CASA, VIZINHA];
const EU = 'u-tdd-cliente-casa';

describe('a régua do nome do cliente', () => {
  it('é a da conciliação: sem caixa, acento, pontuação nem espaço repetido', () => {
    expect(nomeDeClienteNormalizado('  Construtora   ALICERCE — Ltda. ')).toBe('construtora alicerce ltda');
    expect(nomeDeClienteNormalizado('Padaria Pão & Cia')).toBe('padaria pao cia');
    expect(nomeDeClienteNormalizado('---')).toBe('');
  });
});

exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (duas empresas, clientes, listas e tarefas)');

describe.skipIf(!URL)('tarefas de todas as áreas: o cliente é Partner', () => {
  let prisma: PrismaClient;
  let svc: TarefasDoDiaService;
  let alicerce: string;
  let fornecedor: string;
  let daVizinha: string;
  let listaDoCrm: string;

  async function limpar(tentativa = 1): Promise<void> {
    try {
      await prisma.workTask.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workStatus.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workList.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workSpace.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workArea.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.partner.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.auditLog.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    } catch (e) {
      if (tentativa < 4 && /40P01|deadlock/.test(String((e as Error).message))) return limpar(tentativa + 1);
      throw e;
    }
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    const trabalho = new WorkService(p, audit, new CheckoutDeTarefaService(p, audit, new EventLogService(p)));
    svc = new TarefasDoDiaService(p, audit, trabalho);
    for (const orgId of EMPRESAS) await prisma.org.upsert({ where: { id: orgId }, create: { id: orgId, name: orgId === CASA ? 'Root' : 'Vizinha', slug: orgId }, update: {} });
    await prisma.user.upsert({ where: { id: EU }, create: { id: EU, orgId: CASA, name: 'Rodrigo', email: `${EU}@teste.local`, passwordHash: 'x' }, update: {} });
  });

  beforeEach(async () => {
    await limpar();
    alicerce = (await prisma.partner.create({ data: { orgId: CASA, isCliente: true, razaoSocial: 'Construtora Alicerce Ltda', nomeFantasia: 'Construtora Alicerce' } })).id;
    fornecedor = (await prisma.partner.create({ data: { orgId: CASA, isFornecedor: true, razaoSocial: 'Gráfica Pontual' } })).id;
    daVizinha = (await prisma.partner.create({ data: { orgId: VIZINHA, isCliente: true, razaoSocial: 'Padaria Pão' } })).id;
    // A lista do CRM da produção existe: o conserto não pode criar card nela.
    const crm = await prisma.workList.create({ data: { orgId: CASA, name: 'CRM Root', externalId: 'crm-root-lista', natureza: WorkListaNatureza.cadastro } });
    await prisma.workStatus.create({ data: { orgId: CASA, listId: crm.id, name: 'Lead', type: 'open', order: 0 } });
    listaDoCrm = crm.id;
  });

  afterAll(async () => {
    await limpar();
    await prisma.user.deleteMany({ where: { id: EU } });
    await prisma.org.deleteMany({ where: { id: { in: EMPRESAS } } });
    await prisma.$disconnect();
  });

  it('1.7: nome de cliente que já existe (outra caixa, acento, espaço) liga ao Partner, sem card no CRM', async () => {
    const c = await svc.criarCliente(CASA, EU, '  construtora   ALICERCE ');
    expect(c).toEqual({ id: alicerce, titulo: 'Construtora Alicerce', jaExistia: true });
    expect(await prisma.workTask.count({ where: { orgId: CASA, listId: listaDoCrm } })).toBe(0);
    expect(await prisma.partner.count({ where: { orgId: CASA } })).toBe(2);
  });

  it('1.7: nome novo cria o Partner cliente e o id serve para ligar a tarefa (antes: 400)', async () => {
    const [area] = await svc.areas(CASA);
    const r = await svc.criar(CASA, EU, { titulo: 'Conferir o boleto de outubro', areaId: area.id });
    if (!r.criada) throw new Error('a tarefa devia ter sido criada');
    const c = await svc.criarCliente(CASA, EU, 'Oficina Boa Vista');
    expect(c.jaExistia).toBe(false);
    const p = await prisma.partner.findUniqueOrThrow({ where: { id: c.id } });
    expect([p.orgId, p.isCliente, p.interno, p.razaoSocial]).toEqual([CASA, true, false, 'Oficina Boa Vista']);
    const editada = await svc.editar(CASA, EU, r.tarefa.id, { clienteId: c.id, expectedUpdatedAt: r.tarefa.updatedAt });
    expect(editada.cliente?.id).toBe(c.id);
    expect(await prisma.workTask.count({ where: { orgId: CASA, listId: listaDoCrm } })).toBe(0);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { orgId: CASA, entityId: c.id } });
    expect(log.action).toBe('finance.partner.create');
  });

  it('1.7: fornecedor de nome igual não vira cliente; cliente da vizinha não é achado', async () => {
    const c = await svc.criarCliente(CASA, EU, 'Grafica Pontual');
    expect(c.jaExistia).toBe(false);
    expect(c.id).not.toBe(fornecedor);
    expect((await prisma.partner.findUniqueOrThrow({ where: { id: fornecedor } })).isCliente).toBe(false);
    const d = await svc.criarCliente(CASA, EU, 'Padaria Pão');
    expect(d.id).not.toBe(daVizinha);
    expect((await prisma.partner.findUniqueOrThrow({ where: { id: d.id } })).orgId).toBe(CASA);
    expect(await acharClientePorNome(prisma, VIZINHA, 'Oficina que não existe')).toBeNull();
  });

  it('1.7: dois cliques juntos dão um cliente só; nome só de pontuação é recusado', async () => {
    const [a, b] = await Promise.all([svc.criarCliente(CASA, EU, 'Sítio Esperança'), svc.criarCliente(CASA, EU, 'sitio esperanca')]);
    expect(a.id).toBe(b.id);
    expect(await prisma.partner.count({ where: { orgId: CASA, isCliente: true, interno: false } })).toBe(2);
    await expect(svc.criarCliente(CASA, EU, '---')).rejects.toThrow(/letras ou números/);
  });

  it('1.9: a tarefa feita pela ficha (pai de cadastro) não conta o card como cliente na deduplicação', async () => {
    const [area] = await svc.areas(CASA);
    const r = await svc.criar(CASA, EU, { titulo: 'Enviar a minuta revisada', areaId: area.id });
    if (!r.criada) throw new Error('a tarefa devia ter sido criada');
    const card = await prisma.workTask.create({
      data: { orgId: CASA, listId: listaDoCrm, statusId: (await prisma.workStatus.findFirstOrThrow({ where: { listId: listaDoCrm } })).id, title: 'Construtora Alicerce' },
    });
    // A tarefa antiga, pendurada no card (forma da produção) e sem Partner.
    await prisma.workTask.update({ where: { id: r.tarefa.id }, data: { parentId: card.id } });
    // Mesma tarefa, sem cliente: é a mesma (o card não é cliente).
    const sem = await svc.criar(CASA, EU, { titulo: 'Enviar a minuta revisada', areaId: area.id });
    expect(sem.criada).toBe(false);
    if (!sem.criada) expect(sem.aviso.tipo).toBe('igual');
    // Com o Partner como cliente: outra tarefa.
    const com = await svc.criar(CASA, EU, { titulo: 'Enviar a minuta revisada', areaId: area.id, clienteId: alicerce });
    expect(com.criada).toBe(true);
  });
});
