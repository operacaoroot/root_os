import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AuditService } from '../src/audit/audit.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { CheckoutDeTarefaService } from '../src/work/checkout-de-tarefa.service';
import { WorkService } from '../src/work/work.service';
import { parseWorkTaskQuery, pastaComSubpastas } from '../src/work/work-task-query';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * TODAS AS TAREFAS, POR SEGMENTO (rodada da interface U3, 20/10/2026).
 *
 * "Todas" (`todas=1`) junta as tarefas de todas as pastas e listas. O segmento
 * (`segmentoId`) recorta por uma pasta de topo, com as subpastas dentro, ou só as
 * listas soltas (`sem-pasta`). As regras de "Todas" continuam: lista de cadastro
 * não entra. A árvore é lida da empresa da sessão: pasta de outra empresa não traz
 * nada.
 *
 *  1. sem banco: o parser e a conta da pasta com subpastas;
 *  2. contra o Postgres: cada segmento traz só o que é dele, a lista solta de área
 *     (Marketing, Financeiro) aparece em Todas e em "Sem pasta", e a vizinha não vaza.
 */

async function status(chamada: () => unknown): Promise<number | string> {
  try { await chamada(); return 'ok'; } catch (e) { return e instanceof HttpException ? e.getStatus() : String((e as Error).message); }
}

describe('segmento de Todas: as regras puras', () => {
  const RAIZ = '11111111-1111-4111-8111-111111111111';

  it('o parser aceita o id de uma pasta ou sem-pasta, só com todas=1', async () => {
    expect(parseWorkTaskQuery({ todas: '1', segmentoId: RAIZ }).segmentoId).toBe(RAIZ);
    expect(parseWorkTaskQuery({ todas: '1', segmentoId: 'sem-pasta' }).segmentoId).toBe('sem-pasta');
    expect(parseWorkTaskQuery({ todas: '1', segmentoId: '' }).segmentoId).toBeUndefined();
    expect(parseWorkTaskQuery({ todas: '1' }).segmentoId).toBeUndefined();
    expect(await status(() => parseWorkTaskQuery({ segmentoId: RAIZ }))).toBe(400);
    expect(await status(() => parseWorkTaskQuery({ todas: '1', segmentoId: 'Clientes' }))).toBe(400);
    expect(await status(() => parseWorkTaskQuery({ todas: '1', segmentoId: ['a', 'b'] }))).toBe(400);
  });

  it('a pasta leva as subpastas de qualquer nível; pasta desconhecida é vazio', () => {
    const arvore = [
      { id: 'a', parentId: null }, { id: 'a1', parentId: 'a' }, { id: 'a11', parentId: 'a1' },
      { id: 'b', parentId: null }, { id: 'b1', parentId: 'b' },
    ];
    expect([...pastaComSubpastas(arvore, 'a')].sort()).toEqual(['a', 'a1', 'a11']);
    expect([...pastaComSubpastas(arvore, 'b1')]).toEqual(['b1']);
    expect(pastaComSubpastas(arvore, 'z').size).toBe(0);
  });
});

const URL = process.env.TEST_DATABASE_URL;
const CASA = 'org-teste-segmentos-casa';
const VIZINHA = 'org-teste-segmentos-vizinha';
const EMPRESAS = [CASA, VIZINHA];

exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (duas empresas, pastas, listas e tarefas)');

describe.skipIf(!URL)('segmento de Todas: contra o Postgres', () => {
  let prisma: PrismaClient;
  let svc: WorkService;
  const pasta: Record<string, string> = {};

  async function limpar(tentativa = 1): Promise<void> {
    try {
      await prisma.workTask.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workStatus.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workList.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workFolder.deleteMany({ where: { orgId: { in: EMPRESAS }, parentId: { not: null } } });
      await prisma.workFolder.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    } catch (e) {
      if (tentativa < 4 && /40P01|deadlock/.test(String((e as Error).message))) return limpar(tentativa + 1);
      throw e;
    }
  }

  /** Uma lista com uma etapa aberta e uma tarefa com o título dado. */
  async function listaComTarefa(orgId: string, folderId: string | null, nome: string, titulo: string, natureza: 'tarefas' | 'cadastro' = 'tarefas') {
    const lista = await prisma.workList.create({ data: { orgId, folderId, name: nome, natureza } });
    const st = await prisma.workStatus.create({ data: { orgId, listId: lista.id, name: 'A fazer', type: 'open', order: 0 } });
    await prisma.workTask.create({ data: { orgId, listId: lista.id, statusId: st.id, title: titulo } });
  }

  const titulos = async (orgId: string, raw: Record<string, unknown>) =>
    (await svc.tarefas(orgId, parseWorkTaskQuery(raw))).items.map((t) => t.title).sort();

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    svc = new WorkService(p, audit, new CheckoutDeTarefaService(p, audit, new EventLogService(p)));
    for (const orgId of EMPRESAS) await prisma.org.upsert({ where: { id: orgId }, create: { id: orgId, name: orgId, slug: orgId }, update: {} });
  });

  beforeEach(async () => {
    await limpar();
    for (const nome of ['Administrativa', 'Gestão', 'Clientes']) {
      pasta[nome] = (await prisma.workFolder.create({ data: { orgId: CASA, name: nome } })).id;
    }
    // Subpasta: entra no segmento da pasta de topo.
    pasta.Marketing = (await prisma.workFolder.create({ data: { orgId: CASA, name: 'Marketing', parentId: pasta['Gestão'] } })).id;
    pasta.Vizinha = (await prisma.workFolder.create({ data: { orgId: VIZINHA, name: 'Clientes' } })).id;
    await listaComTarefa(CASA, pasta.Administrativa, 'Rotina', 'Pagar o aluguel');
    await listaComTarefa(CASA, pasta.Marketing, 'Tarefas', 'Gravar o episódio');
    await listaComTarefa(CASA, pasta.Clientes, 'Execução', 'Entregar o diagnóstico');
    await listaComTarefa(CASA, pasta.Clientes, 'Esteira de clientes', 'Construtora Alicerce', 'cadastro');
    // A lista de área (Dia a dia, Marketing › Tarefas, Financeiro › Tarefas) nasce solta.
    await listaComTarefa(CASA, null, 'Financeiro', 'Conciliar o extrato');
    await listaComTarefa(VIZINHA, pasta.Vizinha, 'Execução', 'Tarefa da vizinha');
  });

  afterAll(async () => {
    await limpar();
    await prisma.org.deleteMany({ where: { id: { in: EMPRESAS } } });
    await prisma.$disconnect();
  });

  it('Todas traz as tarefas de todas as pastas e das listas soltas, sem o cadastro e sem a vizinha', async () => {
    expect(await titulos(CASA, { todas: '1' })).toEqual(['Conciliar o extrato', 'Entregar o diagnóstico', 'Gravar o episódio', 'Pagar o aluguel']);
  });

  it('o segmento traz só a pasta de topo e as subpastas dela', async () => {
    expect(await titulos(CASA, { todas: '1', segmentoId: pasta['Gestão'] })).toEqual(['Gravar o episódio']);
    expect(await titulos(CASA, { todas: '1', segmentoId: pasta.Clientes })).toEqual(['Entregar o diagnóstico']);
    expect(await titulos(CASA, { todas: '1', segmentoId: pasta.Administrativa })).toEqual(['Pagar o aluguel']);
  });

  it('sem-pasta traz só as listas soltas', async () => {
    expect(await titulos(CASA, { todas: '1', segmentoId: 'sem-pasta' })).toEqual(['Conciliar o extrato']);
  });

  it('o segmento combina com os outros filtros', async () => {
    expect(await titulos(CASA, { todas: '1', segmentoId: pasta['Gestão'], q: 'episódio' })).toEqual(['Gravar o episódio']);
    expect(await titulos(CASA, { todas: '1', segmentoId: pasta['Gestão'], q: 'aluguel' })).toEqual([]);
  });

  it('a pasta de outra empresa não traz nada; cada empresa só vê o segmento dela', async () => {
    expect(await titulos(CASA, { todas: '1', segmentoId: pasta.Vizinha })).toEqual([]);
    expect(await titulos(VIZINHA, { todas: '1', segmentoId: pasta.Clientes })).toEqual([]);
    expect(await titulos(VIZINHA, { todas: '1', segmentoId: pasta.Vizinha })).toEqual(['Tarefa da vizinha']);
    expect(await titulos(VIZINHA, { todas: '1', segmentoId: 'sem-pasta' })).toEqual([]);
  });

  it('pasta que não existe responde vazio, sem erro', async () => {
    expect(await titulos(CASA, { todas: '1', segmentoId: '22222222-2222-4222-8222-222222222222' })).toEqual([]);
  });
});
