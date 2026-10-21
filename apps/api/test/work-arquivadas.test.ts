import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TrabListaExcluirSchema, nomeParaConfirmar } from '@mktos/shared';
import { AuditService } from '../src/audit/audit.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { CheckoutDeTarefaService } from '../src/work/checkout-de-tarefa.service';
import { WorkService } from '../src/work/work.service';
import { TarefasDoDiaService } from '../src/work/tarefas-do-dia.service';
import { pastasEscondidas } from '../src/work/arquivadas';
import { parseWorkTaskQuery } from '../src/work/work-task-query';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * PASTA E LISTA ARQUIVADAS, E EXCLUIR PELA TELA (rodada de produção 1, P3, 21/10/2026).
 *
 *  1. sem banco: a confirmação pelo nome e as pastas que somem com a mãe;
 *  2. contra o Postgres: lista ou pasta arquivada some da árvore, de Todas (com e
 *     sem segmento), da lista pelo id, do Dia a dia e da agenda; a leitura da
 *     tarefa pelo id continua;
 *  3. excluir lista: só com o nome certo, só vazia (apagada) ou toda arquivada
 *     (arquivada, as tarefas ficam), com a contagem na auditoria; a lista da
 *     implantação nunca; outra empresa é 404;
 *  4. arquivar todas as tarefas da lista: condicionada ao número que a tela viu;
 *  5. excluir pasta: só sem lista nem pasta visível; vazia é apagada, a que só
 *     guarda arquivadas é arquivada.
 */

async function erro(chamada: () => Promise<unknown>): Promise<number | string> {
  try { await chamada(); return 'ok'; } catch (e) { return e instanceof HttpException ? e.getStatus() : String((e as Error).message); }
}

describe('arquivadas: as regras puras', () => {
  it('a confirmação ignora maiúscula e espaço sobrando, não o nome', () => {
    expect(nomeParaConfirmar('  Teste   teste ')).toBe(nomeParaConfirmar('teste TESTE'));
    expect(nomeParaConfirmar('Marketing')).not.toBe(nomeParaConfirmar('Marketin'));
    expect(TrabListaExcluirSchema.safeParse({}).success).toBe(false);
    expect(TrabListaExcluirSchema.safeParse({ confirmarNome: 'x', outro: 1 }).success).toBe(false);
  });

  it('a pasta arquivada esconde as que estão dentro dela, em qualquer nível', () => {
    const d = new Date();
    const arvore = [
      { id: 'a', parentId: null, arquivadaEm: d }, { id: 'a1', parentId: 'a', arquivadaEm: null },
      { id: 'a11', parentId: 'a1', arquivadaEm: null }, { id: 'b', parentId: null, arquivadaEm: null },
      { id: 'b1', parentId: 'b', arquivadaEm: d },
    ];
    expect([...pastasEscondidas(arvore)].sort()).toEqual(['a', 'a1', 'a11', 'b1']);
  });
});

const URL = process.env.TEST_DATABASE_URL;
const CASA = 'org-teste-arquivadas-casa';
const VIZINHA = 'org-teste-arquivadas-vizinha';
const EMPRESAS = [CASA, VIZINHA];
const EU = 'u-arquivadas-casa';

exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (duas empresas, pastas, listas e tarefas)');

describe.skipIf(!URL)('arquivadas: contra o Postgres', () => {
  let prisma: PrismaClient;
  let svc: WorkService;
  let dia: TarefasDoDiaService;

  async function limpar(tentativa = 1): Promise<void> {
    try {
      await prisma.auditLog.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workTask.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workStatus.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workList.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workFolder.deleteMany({ where: { orgId: { in: EMPRESAS }, parentId: { not: null } } });
      await prisma.workFolder.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      // O painel do Dia a dia semeia as áreas da empresa.
      await prisma.workArea.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    } catch (e) {
      if (tentativa < 4 && /40P01|deadlock/.test(String((e as Error).message))) return limpar(tentativa + 1);
      throw e;
    }
  }

  async function lista(orgId: string, folderId: string | null, nome: string, titulos: string[] = []) {
    const l = await prisma.workList.create({ data: { orgId, folderId, name: nome } });
    const st = await prisma.workStatus.create({ data: { orgId, listId: l.id, name: 'A fazer', type: 'open', order: 0 } });
    const ids: string[] = [];
    for (const title of titulos) {
      ids.push((await prisma.workTask.create({ data: { orgId, listId: l.id, statusId: st.id, title, dueDate: new Date('2026-10-22T12:00:00Z') } })).id);
    }
    return { id: l.id, tarefas: ids };
  }

  const titulos = async (raw: Record<string, unknown>) =>
    (await svc.tarefas(CASA, parseWorkTaskQuery(raw))).items.map((t) => t.title).sort();
  const nomesDaArvore = async () => {
    const e = await svc.estrutura(CASA);
    return {
      pastas: e.folders.map((f) => f.name).sort(),
      listas: [...e.folders.flatMap((f) => f.lists), ...e.listasSoltas].map((l) => l.name).sort(),
    };
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    svc = new WorkService(p, audit, new CheckoutDeTarefaService(p, audit, new EventLogService(p)));
    dia = new TarefasDoDiaService(p, audit, svc);
    for (const orgId of EMPRESAS) await prisma.org.upsert({ where: { id: orgId }, create: { id: orgId, name: orgId, slug: orgId }, update: {} });
    const permissoes = [];
    for (const key of ['tarefas.ver', 'tarefas.editar']) {
      permissoes.push(await prisma.permission.upsert({ where: { key }, create: { key }, update: {}, select: { id: true } }));
    }
    const papel = await prisma.role.upsert({
      where: { orgId_key: { orgId: CASA, key: 'analista' } },
      create: { orgId: CASA, key: 'analista', name: 'Analista', permissions: { connect: permissoes } },
      update: { permissions: { connect: permissoes } },
      select: { id: true },
    });
    await prisma.user.upsert({
      where: { id: EU },
      create: { id: EU, orgId: CASA, name: 'Pessoa Teste', email: `${EU}@teste.local`, passwordHash: 'x', roles: { connect: { id: papel.id } } },
      update: { roles: { connect: { id: papel.id } } },
    });
  });

  beforeEach(limpar);

  afterAll(async () => {
    await limpar();
    await prisma.user.deleteMany({ where: { id: EU } });
    await prisma.role.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    await prisma.org.deleteMany({ where: { id: { in: EMPRESAS } } });
    await prisma.$disconnect();
  });

  it('lista e pasta arquivadas somem da árvore, de Todas, da agenda e do Dia a dia; a tarefa pelo id continua', async () => {
    const crm = (await prisma.workFolder.create({ data: { orgId: CASA, name: 'CRM' } })).id;
    const dentro = (await prisma.workFolder.create({ data: { orgId: CASA, name: 'Dentro do CRM', parentId: crm } })).id;
    const gestao = (await prisma.workFolder.create({ data: { orgId: CASA, name: 'Gestão' } })).id;
    const leads = await lista(CASA, crm, 'Gestão de Leads', ['Cartão do CRM']);
    const funda = await lista(CASA, dentro, 'Funda', ['Cartão fundo']);
    const teste = await lista(CASA, null, 'Teste teste', ['Lixo de teste']);
    const adm = await lista(CASA, gestao, 'Administrativo', ['Pagar o aluguel']);
    await lista(CASA, null, 'Operação', ['Rodar a rotina']);

    const antes = await titulos({ todas: '1' });
    expect(antes).toEqual(['Cartão do CRM', 'Cartão fundo', 'Lixo de teste', 'Pagar o aluguel', 'Rodar a rotina']);

    await prisma.workFolder.update({ where: { id: crm }, data: { arquivadaEm: new Date() } });
    await prisma.workList.update({ where: { id: teste.id }, data: { arquivadaEm: new Date() } });

    expect(await nomesDaArvore()).toEqual({ pastas: ['Gestão'], listas: ['Administrativo', 'Operação'] });
    expect(await titulos({ todas: '1' })).toEqual(['Pagar o aluguel', 'Rodar a rotina']);
    expect(await titulos({ todas: '1', segmentoId: 'sem-pasta' })).toEqual(['Rodar a rotina']);
    expect(await titulos({ todas: '1', segmentoId: crm })).toEqual([]);
    expect(await titulos({ listId: leads.id })).toEqual([]);
    expect(await titulos({ listId: funda.id })).toEqual([]);
    expect(await titulos({ listId: adm.id })).toEqual(['Pagar o aluguel']);
    // A agenda pede pelo prazo (`dueFrom`/`dueTo`): o que é de lista arquivada não entra.
    expect(await titulos({ dueFrom: '2026-10-22T00:00:00.000Z', dueTo: '2026-10-23T00:00:00.000Z' })).toEqual(['Pagar o aluguel', 'Rodar a rotina']);

    const painel = await dia.painel(CASA);
    const doDia = JSON.stringify(painel);
    expect(doDia).not.toContain('Cartão do CRM');
    expect(doDia).not.toContain('Lixo de teste');
    expect(doDia).toContain('Pagar o aluguel');

    // Os dados ficam: a leitura pelo id continua.
    expect((await svc.tarefa(CASA, leads.tarefas[0])).title).toBe('Cartão do CRM');
  });

  it('excluir lista: nome certo, só vazia (apagada) ou toda arquivada (arquivada), com a contagem', async () => {
    const vazia = await lista(CASA, null, 'Marketing');
    const cheia = await lista(CASA, null, 'Teste teste', ['Um', 'Dois', 'Três']);

    expect(await erro(() => svc.apagarLista(CASA, EU, vazia.id, { confirmarNome: 'Marketin' }))).toBe(400);
    expect(await svc.apagarLista(CASA, EU, vazia.id, { confirmarNome: '  marketing ' })).toEqual({ id: vazia.id, modo: 'apagada', tarefasArquivadas: 0 });
    expect(await prisma.workList.findUnique({ where: { id: vazia.id } })).toBeNull();

    // Com tarefa viva, recusa e não muda nada.
    expect(await erro(() => svc.apagarLista(CASA, EU, cheia.id, { confirmarNome: 'Teste teste' }))).toBe(400);
    expect((await prisma.workList.findUniqueOrThrow({ where: { id: cheia.id } })).arquivadaEm).toBeNull();

    // Arquivar todas, condicionado ao número visto.
    expect(await erro(() => svc.arquivarTarefasDaLista(CASA, EU, cheia.id, { esperadas: 2 }))).toBe(409);
    expect(await prisma.workTask.count({ where: { listId: cheia.id, archived: true } })).toBe(0);
    expect(await svc.arquivarTarefasDaLista(CASA, EU, cheia.id, { esperadas: 3 })).toEqual({ id: cheia.id, arquivadas: 3 });
    expect(await prisma.auditLog.count({ where: { orgId: CASA, action: 'work.task.update', entityId: { in: cheia.tarefas } } })).toBe(3);

    expect(await svc.apagarLista(CASA, EU, cheia.id, { confirmarNome: 'TESTE TESTE' })).toEqual({ id: cheia.id, modo: 'arquivada', tarefasArquivadas: 3 });
    const gravada = await prisma.workList.findUniqueOrThrow({ where: { id: cheia.id } });
    expect(gravada.arquivadaEm).not.toBeNull();
    expect(await prisma.workTask.count({ where: { listId: cheia.id } })).toBe(3);
    const rastro = await prisma.auditLog.findFirstOrThrow({ where: { orgId: CASA, action: 'work.list.archive', entityId: cheia.id } });
    expect(rastro.after).toMatchObject({ modo: 'arquivada', tarefasArquivadas: 3 });
    expect(rastro.actorId).toBe(EU);

    // Depois de excluída, some e não se exclui de novo.
    expect((await nomesDaArvore()).listas).toEqual([]);
    expect(await erro(() => svc.apagarLista(CASA, EU, cheia.id, { confirmarNome: 'Teste teste' }))).toBe(404);
  });

  it('a lista da implantação não sai, e lista de outra empresa é 404', async () => {
    const clientes = (await prisma.workFolder.create({ data: { orgId: CASA, name: 'Clientes' } })).id;
    const onboarding = await lista(CASA, clientes, 'Onboarding de cliente');
    expect(await erro(() => svc.apagarLista(CASA, EU, onboarding.id, { confirmarNome: 'Onboarding de cliente' }))).toBe(400);
    expect(await erro(() => svc.arquivarTarefasDaLista(CASA, EU, onboarding.id, { esperadas: 0 }))).toBe(400);
    expect(await prisma.workList.findUnique({ where: { id: onboarding.id } })).not.toBeNull();

    const daVizinha = await lista(VIZINHA, null, 'Dela');
    expect(await erro(() => svc.apagarLista(CASA, EU, daVizinha.id, { confirmarNome: 'Dela' }))).toBe(404);
    expect(await erro(() => svc.arquivarTarefasDaLista(CASA, EU, daVizinha.id, { esperadas: 0 }))).toBe(404);
    expect(await prisma.workList.findUnique({ where: { id: daVizinha.id } })).not.toBeNull();
  });

  it('excluir pasta: só sem lista visível; vazia é apagada, a que só guarda arquivadas é arquivada', async () => {
    const vazia = (await prisma.workFolder.create({ data: { orgId: CASA, name: 'Administrativa' } })).id;
    const crm = (await prisma.workFolder.create({ data: { orgId: CASA, name: 'CRM' } })).id;
    const leads = await lista(CASA, crm, 'Gestão de Leads', ['Cartão']);

    expect(await erro(() => svc.apagarPasta(CASA, EU, crm))).toBe(400);
    expect(await svc.apagarPasta(CASA, EU, vazia)).toEqual({ id: vazia, modo: 'apagada' });
    expect(await prisma.workFolder.findUnique({ where: { id: vazia } })).toBeNull();

    await svc.arquivarTarefasDaLista(CASA, EU, leads.id, { esperadas: 1 });
    await svc.apagarLista(CASA, EU, leads.id, { confirmarNome: 'Gestão de Leads' });
    expect(await svc.apagarPasta(CASA, EU, crm)).toEqual({ id: crm, modo: 'arquivada' });
    expect((await prisma.workFolder.findUniqueOrThrow({ where: { id: crm } })).arquivadaEm).not.toBeNull();
    expect(await prisma.workList.count({ where: { folderId: crm } })).toBe(1);
    expect((await nomesDaArvore()).pastas).toEqual([]);
    expect(await erro(() => svc.apagarPasta(CASA, EU, crm))).toBe(404);
  });
});
