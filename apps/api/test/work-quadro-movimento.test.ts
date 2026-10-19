import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { AuditService } from '../src/audit/audit.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { abrirCardDaImplantacao } from '../src/comercial/card-da-implantacao';
import { CheckoutDeTarefaService } from '../src/work/checkout-de-tarefa.service';
import { passoDaAuditoria, passoDoComentario, trechoDoComentario, ultimoPasso } from '../src/work/movimento-do-quadro';
import { MovimentoDoQuadroService } from '../src/work/movimento-do-quadro.service';
import { WorkService } from '../src/work/work.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * O MOVIMENTO DO CARTÃO (rodada da implantação I2, 18/10/2026).
 *
 *  1. as frases saem da regra da caixa (`mudancasDaAuditoria`): mover diz para
 *     onde, edição invisível não vira passo, o fechamento "abriu o card";
 *  2. o rodapé é o mais novo entre movimento e comentário;
 *  3. contra o Postgres: a mesma tarefa movida pela tela (WorkService, que grava
 *     a auditoria) mostra o passo, o comentário, o balão com no máximo três, e
 *     o card do fechamento traz o selo e a próxima ação "marcar o kickoff";
 *  4. a lista de outra empresa é 404.
 */

const URL = process.env.TEST_DATABASE_URL;
const ORG = 'org-teste-quadro-movimento';
const VIZINHA = 'org-teste-quadro-movimento-vizinha';
const EU = 'u-quadro-movimento';

exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (pastas, listas, tarefas, comentários e auditoria)');

describe('movimento do cartão: as frases (sem banco)', () => {
  const nomes = new Map([['u1', 'Pedro']]);
  const em = new Date('2026-10-18T12:00:00Z');
  it('mover diz para onde; a edição que a tela não mostra não é passo', () => {
    expect(passoDaAuditoria({ action: 'work.task.update', actorType: 'user', actorId: 'u1', before: { status: 'Fechado no comercial' }, after: { status: 'Kickoff marcado' }, createdAt: em }, nomes))
      .toEqual({ tipo: 'status', quem: 'Pedro', frase: 'moveu para Kickoff marcado', em: em.toISOString() });
    expect(passoDaAuditoria({ action: 'work.task.update', actorType: 'user', actorId: 'u1', before: { order: 1 }, after: { order: 2 }, createdAt: em }, nomes)).toBeNull();
    expect(passoDaAuditoria({ action: 'work.task.update', actorType: 'user', actorId: 'u9', before: { assignee: null }, after: { assignee: 'Marina' }, createdAt: em }, nomes))
      .toMatchObject({ tipo: 'atribuicao', quem: 'alguém da equipe', frase: 'passou para Marina' });
  });
  it('a criação pelo fechamento é "Fechamento comercial · abriu o card"', () => {
    expect(passoDaAuditoria({ action: 'work.task.create', actorType: 'system', actorId: 'comercial', before: null, after: {}, createdAt: em }, nomes))
      .toMatchObject({ tipo: 'criacao', quem: 'Fechamento comercial', frase: 'abriu o card' });
  });
  it('o comentário vem entre aspas e cortado; o rodapé é o mais novo dos dois', () => {
    expect(trechoDoComentario('a'.repeat(200))).toHaveLength(80);
    const c = passoDoComentario({ authorName: 'Marina', text: 'mandei os acessos', createdAt: new Date('2026-10-18T13:00:00Z') });
    expect(c.frase).toBe('“mandei os acessos”');
    const m = { tipo: 'status' as const, quem: 'Pedro', frase: 'moveu', em: em.toISOString() };
    expect(ultimoPasso([m], c)).toBe(c);
    expect(ultimoPasso([], null)).toBeNull();
    expect(ultimoPasso([m], null)).toBe(m);
  });
});

describe.skipIf(!URL)('movimento do cartão: contra o Postgres', () => {
  let prisma: PrismaClient;
  let work: WorkService;
  let svc: MovimentoDoQuadroService;

  async function limpar() {
    for (const orgId of [ORG, VIZINHA]) {
      await prisma.workComment.deleteMany({ where: { orgId } });
      await prisma.workTask.deleteMany({ where: { orgId } });
      await prisma.workStatus.deleteMany({ where: { orgId } });
      await prisma.workList.deleteMany({ where: { orgId } });
      await prisma.workFolder.deleteMany({ where: { orgId } });
      await prisma.auditLog.deleteMany({ where: { orgId } });
    }
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    work = new WorkService(p, audit, new CheckoutDeTarefaService(p, audit, new EventLogService(p)));
    svc = new MovimentoDoQuadroService(p);
    for (const orgId of [ORG, VIZINHA]) {
      await prisma.org.upsert({ where: { id: orgId }, create: { id: orgId, name: orgId, slug: orgId }, update: {} });
    }
    await prisma.user.upsert({ where: { id: EU }, create: { id: EU, orgId: ORG, name: 'Pedro', email: `${EU}@teste.local`, passwordHash: 'x' }, update: {} });
    await limpar();
  });

  afterAll(async () => {
    if (!prisma) return;
    await limpar();
    await prisma.user.deleteMany({ where: { id: EU } });
    await prisma.org.deleteMany({ where: { id: { in: [ORG, VIZINHA] } } });
    await prisma.$disconnect();
  });

  it('a tarefa movida e comentada pela tela mostra o rodapé e o balão com no máximo três passos', async () => {
    await work.criarEstruturaSugerida(ORG, EU);
    const lista = await prisma.workList.findFirstOrThrow({ where: { orgId: ORG, name: 'Onboarding de cliente' }, include: { statuses: { orderBy: { order: 'asc' } } } });
    // Rodada do trabalho T1: a lista da implantação não recebe cartão solto pela rota; o card nasce como o fechamento o abre.
    const t = await prisma.workTask.create({ data: { orgId: ORG, listId: lista.id, statusId: lista.statuses[0].id, title: 'Studio Lume' } });
    for (const i of [1, 2, 3]) await work.editarTarefa(ORG, EU, t.id, { statusId: lista.statuses[i].id } as never);
    const r1 = await svc.daLista(ORG, lista.id);
    const c1 = r1.itens.find((x) => x.tarefaId === t.id)!;
    expect(c1.passos.map((p) => p.frase)).toEqual(['moveu para Contexto carregado', 'moveu para Kit montado', 'moveu para Kickoff marcado']);
    expect(c1.ultimo).toMatchObject({ quem: 'Pedro', frase: 'moveu para Contexto carregado' });
    expect(c1.procedencia).toBeNull();

    await new Promise((r) => setTimeout(r, 5));
    await prisma.workComment.create({ data: { orgId: ORG, taskId: t.id, authorId: null, authorName: 'Marina', text: 'mandei os acessos' } });
    const c2 = (await svc.daLista(ORG, lista.id)).itens.find((x) => x.tarefaId === t.id)!;
    expect(c2.ultimo).toMatchObject({ tipo: 'comentario', quem: 'Marina', frase: '“mandei os acessos”' });
    expect(c2.passos).toHaveLength(3);
  });

  it('o card do fechamento traz o selo, "abriu o card" e a próxima ação de marcar o kickoff', async () => {
    const leadId = '00000000-0000-4000-8000-00000000c0de';
    await prisma.lead.upsert({ where: { id: leadId }, create: { id: leadId, orgId: ORG, name: 'Construtora Alicerce' }, update: {} });
    await prisma.comercialFicha.upsert({ where: { leadId }, create: { leadId, orgId: ORG }, update: {} });
    const r = await prisma.$transaction((tx) => abrirCardDaImplantacao(tx, ORG, {
      leadId, empresa: 'Construtora Alicerce Ltda', cnpj: '12.345.678/0001-90', contato: 'Marina Duarte', telefone: null, email: null,
      produto: 'Imersão', valor: 'R$ 2.970,00', parcelas: 10, forma: 'pix', chave: `fech-${leadId}-v1`, trilhoId: null, responsavel: null,
    }));
    const c = (await svc.daLista(ORG, r.listId)).itens.find((x) => x.tarefaId === r.cardId)!;
    expect(c.procedencia).toMatchObject({ tipo: 'fechamento', leadId });
    expect(c.procedencia!.rotulo).toMatch(/^criado pelo fechamento · \d{2}\/\d{2}\/\d{4}$/);
    expect(c.passos[0]).toMatchObject({ quem: 'Fechamento comercial', frase: 'abriu o card' });
    expect(c.proximaAcao).toEqual({ texto: 'marcar o kickoff com o cliente', dono: null, quando: null, fonte: 'implantacao' });
    // De novo: o mesmo card (id derivado), sem segundo comentário.
    const r2 = await prisma.$transaction((tx) => abrirCardDaImplantacao(tx, ORG, {
      leadId, empresa: 'X', cnpj: '', contato: '', telefone: null, email: null, produto: '', valor: '', parcelas: 1, forma: 'pix', chave: 'k', trilhoId: null, responsavel: null,
    }));
    expect(r2).toMatchObject({ estado: 'reaproveitado', cardId: r.cardId });
    expect(await prisma.workComment.count({ where: { taskId: r.cardId } })).toBe(1);
    await prisma.comercialFicha.deleteMany({ where: { leadId } });
    await prisma.lead.deleteMany({ where: { id: leadId } });
  });

  it('a lista de outra empresa é 404', async () => {
    const lista = await prisma.workList.findFirstOrThrow({ where: { orgId: ORG } });
    await expect(svc.daLista(VIZINHA, lista.id)).rejects.toThrow('Lista não encontrada');
  });
});
