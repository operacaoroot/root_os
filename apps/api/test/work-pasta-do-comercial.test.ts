import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  ICONES_DO_TRABALHO, CORES_DO_TRABALHO, TRAB_DO_COMERCIAL, TrabListaUpdateSchema, TrabPastaUpdateSchema,
  ehEmojiCurto, iconeDoTrabalhoValido, aparenciaDoTrabalho, listasComAsDoComercial, pastasComAsDoComercial,
  LISTA_DA_IMPLANTACAO, listaDaImplantacao,
} from '@mktos/shared';
import { AuditService } from '../src/audit/audit.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { CheckoutDeTarefaService } from '../src/work/checkout-de-tarefa.service';
import { WorkService } from '../src/work/work.service';
import { TarefasDoDiaService } from '../src/work/tarefas-do-dia.service';
import { mudancaDeAparencia } from '../src/work/aparencia-do-trabalho';
import { idsDasPastasDoComercial } from '../src/work/pasta-do-comercial';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * PRODUÇÃO 22B (22/10/2026), lane A: o ícone e a cor da lista e da pasta (I1) e a
 * pasta Clientes fora do Trabalho (I3).
 *
 *  1. sem banco: o que vale como ícone e cor (o schema do PATCH), o que entra na
 *     auditoria, as pastas do Comercial com as de dentro, achar a lista da
 *     implantação juntando as do Comercial;
 *  2. contra o Postgres: a estrutura sugerida cria a Clientes marcada e é
 *     idempotente (e marca a que existia sem marca); a árvore, Todas, a pessoa em
 *     todas as listas e o Dia a dia não veem as listas dela; o quadro da lista pelo
 *     id, a tarefa pelo id e a Implantação continuam iguais; ordenar o topo sem a
 *     Clientes funciona; renomear, criar dentro, mover tarefas para ela e apagar
 *     são recusados; a migration marca a Clientes existente (sem diferença de
 *     maiúscula, acento e espaço) e roda duas vezes sem mudar nada; ícone e cor
 *     gravam, aparecem, apagam e ficam na auditoria; outra empresa não é tocada.
 */

async function erro(chamada: () => Promise<unknown>): Promise<{ status: number | null; mensagem: string }> {
  try { await chamada(); return { status: 0, mensagem: 'ok' }; } catch (e) {
    if (e instanceof HttpException) {
      const r = e.getResponse() as string | { message?: string | string[] };
      const m = typeof r === 'string' ? r : Array.isArray(r.message) ? r.message.join(' ') : r.message ?? e.message;
      return { status: e.getStatus(), mensagem: m };
    }
    return { status: null, mensagem: String((e as Error).message) };
  }
}

describe('I1 e I3: as regras sem banco', () => {
  it('ícone: um emoji só ou um nome do catálogo; texto livre, dois emojis e número não', () => {
    for (const ok of ['📁', '❤️', '🗓️', '👍🏽', '👩‍💻', '🇧🇷', 'KanbanSquare', 'Wallet']) expect(iconeDoTrabalhoValido(ok), ok).toBe(true);
    for (const nao of ['', 'a', 'abc', '1', '#', '📁📁', 'Pasta 📁', 'kanbansquare', 'NaoExiste', '<svg>']) expect(iconeDoTrabalhoValido(nao), nao).toBe(false);
    expect(ehEmojiCurto('📁')).toBe(true);
    expect(ICONES_DO_TRABALHO.length).toBeGreaterThan(10);
  });

  it('o PATCH de lista e de pasta: ícone e cor validados, null apaga, ausente não mexe', () => {
    for (const S of [TrabListaUpdateSchema, TrabPastaUpdateSchema]) {
      expect(S.safeParse({ icone: '📁', cor: 'good' }).success).toBe(true);
      expect(S.safeParse({ icone: null, cor: null }).success).toBe(true);
      expect(S.safeParse({}).success).toBe(true);
      expect(S.safeParse({ icone: 'qualquer coisa' }).success).toBe(false);
      expect(S.safeParse({ cor: '#ff0000' }).success).toBe(false);
      expect(S.safeParse({ cor: 'vermelho' }).success).toBe(false);
    }
    expect(CORES_DO_TRABALHO).toContain('brand');
  });

  it('o gravado que deixou de valer volta nulo; a auditoria só leva o que mudou', () => {
    expect(aparenciaDoTrabalho({ icone: 'NaoExiste', cor: '#fff' })).toEqual({ icone: null, cor: null });
    expect(aparenciaDoTrabalho({ icone: '📁', cor: 'bad' })).toEqual({ icone: '📁', cor: 'bad' });
    const antes = { icone: '📁', cor: 'bad' };
    expect(mudancaDeAparencia(antes, {})).toEqual({ data: {}, before: {}, after: {}, muda: false });
    expect(mudancaDeAparencia(antes, { icone: '📁' }).muda).toBe(false);
    expect(mudancaDeAparencia(antes, { icone: null, cor: 'good' })).toEqual({
      data: { icone: null, cor: 'good' }, before: { icone: '📁', cor: 'bad' }, after: { icone: null, cor: 'good' }, muda: true,
    });
  });

  it('as pastas do Comercial levam as de dentro; achar a implantação junta as do Comercial', () => {
    const ids = idsDasPastasDoComercial([
      { id: 'c', parentId: null, doComercial: true }, { id: 'c1', parentId: 'c', doComercial: false },
      { id: 'g', parentId: null, doComercial: false },
    ]);
    expect([...ids].sort()).toEqual(['c', 'c1']);
    const lista = { id: 'l', name: LISTA_DA_IMPLANTACAO };
    const e = {
      folders: [{ id: 'g', name: 'Gestão', parentId: null, lists: [{ id: 'g1', name: 'Pessoas' }] }],
      listasSoltas: [{ id: 's', name: 'Operação' }],
      pastasDoComercial: [{ id: 'c', name: 'Clientes', parentId: null, lists: [lista] }],
    };
    expect(listaDaImplantacao(e.folders)).toBeNull();
    expect(listaDaImplantacao(pastasComAsDoComercial(e))).toEqual({ pastaId: 'c', listaId: 'l' });
    expect(listasComAsDoComercial(e).map((l) => l.id)).toEqual(['g1', 'l', 's']);
    expect(listasComAsDoComercial({ folders: e.folders, listasSoltas: [] }).map((l) => l.id)).toEqual(['g1']);
  });
});

const URL = process.env.TEST_DATABASE_URL;
const CASA = 'org-teste-22b-a-casa';
const VIZINHA = 'org-teste-22b-a-vizinha';
const EMPRESAS = [CASA, VIZINHA];
const EU = 'u-22b-a-casa';
const MIGRATION = readFileSync(path.resolve(__dirname, '../prisma/migrations/20261022205000_trabalho_pasta_do_comercial/migration.sql'), 'utf8');

exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (duas empresas, pastas, listas, tarefas e auditoria)');

describe.skipIf(!URL)('I1 e I3: contra o Postgres', () => {
  let prisma: PrismaClient;
  let svc: WorkService;
  let dia: TarefasDoDiaService;

  async function limpar(tentativa = 1): Promise<void> {
    try {
      await prisma.auditLog.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workTask.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workFieldOption.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workField.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workStatus.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workList.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workArea.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      while ((await prisma.workFolder.deleteMany({ where: { orgId: { in: EMPRESAS }, children: { none: {} } } })).count > 0);
      await prisma.workFolder.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workSpace.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    } catch (e) {
      if (tentativa < 4 && /40P01|deadlock/.test(String((e as Error).message))) return limpar(tentativa + 1);
      throw e;
    }
  }

  async function lista(orgId: string, folderId: string | null, name: string, titulos: string[] = []) {
    const l = await prisma.workList.create({ data: { orgId, folderId, name } });
    const st = await prisma.workStatus.create({ data: { orgId, listId: l.id, name: 'A fazer', type: 'open', order: 0 } });
    const ids: string[] = [];
    for (const title of titulos) ids.push((await prisma.workTask.create({ data: { orgId, listId: l.id, statusId: st.id, title, assigneeUserId: EU } })).id);
    return { id: l.id, tarefas: ids, statusId: st.id };
  }

  /** A estrutura sugerida, uma tarefa em cada lista de Clientes e uma em Gestão / Pessoas. */
  async function montar() {
    await svc.criarEstruturaSugerida(CASA, EU);
    const e = await svc.estrutura(CASA);
    const listas = listasComAsDoComercial(e);
    const daLista = (nome: string) => listas.find((l) => l.name === nome)!;
    const tarefa = async (nome: string, title: string) => {
      const l = daLista(nome);
      return (await prisma.workTask.create({ data: { orgId: CASA, listId: l.id, statusId: l.statuses[0].id, title, assigneeUserId: EU } })).id;
    };
    return {
      e,
      card: await tarefa(LISTA_DA_IMPLANTACAO, 'Card do cliente'),
      esteira: await tarefa('Esteira de clientes', 'Na esteira'),
      pessoas: await tarefa('Pessoas', 'Contratar'),
      daLista,
    };
  }

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
      create: { orgId: CASA, key: 'analista', name: 'analista', permissions: { connect: permissoes } },
      update: { permissions: { connect: permissoes } },
      select: { id: true },
    });
    await prisma.user.upsert({
      where: { id: EU },
      create: { id: EU, orgId: CASA, name: 'Pessoa da casa', email: `${EU}@teste.local`, passwordHash: 'x', roles: { connect: { id: papel.id } } },
      update: { roles: { connect: { id: papel.id } } },
    });
  });

  beforeEach(limpar);

  afterAll(async () => {
    if (!prisma) return;
    await limpar();
    await prisma.user.deleteMany({ where: { id: EU } });
    await prisma.role.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    await prisma.org.deleteMany({ where: { id: { in: EMPRESAS } } });
    await prisma.$disconnect();
  });

  it('a estrutura sugerida cria a Clientes marcada, fora da árvore, e é idempotente', async () => {
    const r = await svc.criarEstruturaSugerida(CASA, EU);
    expect(r.criadas.pastas).toEqual(['Gestão', 'Clientes']);
    const e = await svc.estrutura(CASA);
    expect(e.folders.map((f) => f.name)).toEqual(['Gestão']);
    expect(e.pastasDoComercial?.map((f) => [f.name, f.lists.map((l) => l.name)])).toEqual([
      ['Clientes', ['Esteira de clientes', 'Onboarding de cliente', 'Execução']],
    ]);
    expect(listaDaImplantacao(e.folders)).toBeNull();
    expect(listaDaImplantacao(pastasComAsDoComercial(e))).not.toBeNull();

    const contagem = async () => ({
      pastas: await prisma.workFolder.count({ where: { orgId: CASA } }),
      listas: await prisma.workList.count({ where: { orgId: CASA } }),
      doComercial: await prisma.workList.count({ where: { orgId: CASA, doComercial: true } }),
    });
    const antes = await contagem();
    expect(antes).toEqual({ pastas: 2, listas: 6, doComercial: 3 });
    const segunda = await svc.criarEstruturaSugerida(CASA, EU);
    expect(segunda.criadas).toEqual({ pastas: [], listas: [] });
    expect(segunda.jaExistiam.pastas).toEqual(['Gestão', 'Clientes']);
    expect(await contagem()).toEqual(antes);
  });

  it('a Clientes que existia sem a marca ganha a marca na estrutura sugerida, sem mudar nome, lugar nem tarefa', async () => {
    const clientes = (await prisma.workFolder.create({ data: { orgId: CASA, name: 'Clientes' } })).id;
    const onboarding = await lista(CASA, clientes, LISTA_DA_IMPLANTACAO, ['Card antigo']);
    expect((await svc.estrutura(CASA)).folders.map((f) => f.name)).toEqual(['Clientes']);
    const r = await svc.criarEstruturaSugerida(CASA, EU);
    expect(r.jaExistiam.pastas).toContain('Clientes');
    expect(r.jaExistiam.listas).toContain(`Clientes / ${LISTA_DA_IMPLANTACAO}`);
    const e = await svc.estrutura(CASA);
    expect(e.folders.map((f) => f.name)).toEqual(['Gestão']);
    expect(e.pastasDoComercial?.[0].id).toBe(clientes);
    expect(await prisma.workList.count({ where: { folderId: clientes, doComercial: true } })).toBe(3);
    const t = await prisma.workTask.findUniqueOrThrow({ where: { id: onboarding.tarefas[0] } });
    expect(t.listId).toBe(onboarding.id);
  });

  it('a migration marca a Clientes existente (maiúscula, acento e espaço não importam) e roda de novo sem mudar nada', async () => {
    const clientes = (await prisma.workFolder.create({ data: { orgId: CASA, name: '  CLIÉNTES ' } })).id;
    const dentro = await lista(CASA, clientes, LISTA_DA_IMPLANTACAO, ['Card']);
    const solta = await lista(CASA, null, 'Clientes');
    const filha = (await prisma.workFolder.create({ data: { orgId: CASA, name: 'Clientes', parentId: (await prisma.workFolder.create({ data: { orgId: CASA, name: 'Gestão' } })).id } })).id;
    const daVizinha = (await prisma.workFolder.create({ data: { orgId: VIZINHA, name: 'Gestão' } })).id;
    // Revisão M2: a Clientes que uma empresa criou à mão, sem a lista da implantação, fica do Trabalho.
    const clientesAMao = (await prisma.workFolder.create({ data: { orgId: VIZINHA, name: 'Clientes' } })).id;
    const execucaoAMao = await lista(VIZINHA, clientesAMao, 'Execução');
    await prisma.$executeRawUnsafe(`UPDATE "WorkFolder" SET "doComercial" = false WHERE "orgId" = ANY(ARRAY['${CASA}','${VIZINHA}'])`);
    // Só os dois UPDATE da migration (o ALTER já rodou neste banco).
    // O banco de teste é dividido com as outras suítes: o UPDATE roda só nas duas empresas daqui
    // (a migration de verdade roda no banco inteiro, uma vez).
    const daqui = `ARRAY['${CASA}','${VIZINHA}']`;
    const updates = MIGRATION.split(';').map((x) => x.replace(/--[^\n]*\n/g, '\n').trim()).filter((x) => x.startsWith('UPDATE'))
      .map((sql) => (sql.includes('FROM "WorkFolder" AS f') ? `${sql} AND l."orgId" = ANY(${daqui})` : `${sql} AND "orgId" = ANY(${daqui})`));
    expect(updates).toHaveLength(2);
    for (const sql of updates) await prisma.$executeRawUnsafe(sql);
    const marca = async () => ({
      pasta: (await prisma.workFolder.findUniqueOrThrow({ where: { id: clientes } })).doComercial,
      lista: (await prisma.workList.findUniqueOrThrow({ where: { id: dentro.id } })).doComercial,
      solta: (await prisma.workList.findUniqueOrThrow({ where: { id: solta.id } })).doComercial,
      filha: (await prisma.workFolder.findUniqueOrThrow({ where: { id: filha } })).doComercial,
      vizinha: (await prisma.workFolder.findUniqueOrThrow({ where: { id: daVizinha } })).doComercial,
      aMao: (await prisma.workFolder.findUniqueOrThrow({ where: { id: clientesAMao } })).doComercial,
      execucaoAMao: (await prisma.workList.findUniqueOrThrow({ where: { id: execucaoAMao.id } })).doComercial,
    });
    expect(await marca()).toEqual({ pasta: true, lista: true, solta: false, filha: false, vizinha: false, aMao: false, execucaoAMao: false });
    for (const sql of updates) expect(await prisma.$executeRawUnsafe(sql)).toBe(0);
    expect(await marca()).toEqual({ pasta: true, lista: true, solta: false, filha: false, vizinha: false, aMao: false, execucaoAMao: false });
  });

  it('Todas, a pessoa em todas as listas e o Dia a dia não veem as listas da Clientes; o quadro pelo id e a tarefa pelo id, sim', async () => {
    const m = await montar();
    const titulos = (r: { items: { title: string }[] }) => r.items.map((t) => t.title).sort();
    expect(titulos(await svc.tarefas(CASA, { todas: true }))).toEqual(['Contratar']);
    expect(titulos(await svc.tarefas(CASA, { assigneeUserId: EU }))).toEqual(['Contratar']);
    const implantacao = listaDaImplantacao(pastasComAsDoComercial(m.e))!;
    expect(titulos(await svc.tarefas(CASA, { listId: implantacao.listaId }))).toEqual(['Card do cliente']);
    expect(titulos(await svc.tarefas(CASA, { listId: m.daLista('Esteira de clientes').id }))).toEqual(['Na esteira']);
    expect((await svc.tarefa(CASA, m.card)).title).toBe('Card do cliente');
    const painel = await dia.painel(CASA);
    expect(painel.tarefas.map((t) => t.titulo ?? (t as unknown as { title: string }).title)).not.toContain('Card do cliente');
    expect(painel.tarefas.map((t) => t.id)).toEqual([m.pessoas]);
    // Os contadores da árvore: a Gestão com a tarefa dela; a Clientes não entra na árvore.
    const e = await svc.estrutura(CASA);
    expect(e.folders.flatMap((f) => f.lists).reduce((n, l) => n + l.total, 0)).toBe(1);
    expect(e.pastasDoComercial![0].lists.find((l) => l.id === implantacao.listaId)!.total).toBe(1);
  });

  it('ordenar o topo sem a Clientes funciona; mexer nela pelo Trabalho é recusado com o porquê', async () => {
    const m = await montar();
    const outra = await svc.criarPasta(CASA, EU, { name: 'Marketing' });
    const gestao = m.e.folders.find((f) => f.name === 'Gestão')!.id;
    await svc.ordenarArvore(CASA, EU, { tipo: 'pasta', paiId: null, ids: [outra.id, gestao] });
    expect((await svc.estrutura(CASA)).folders.map((f) => f.name)).toEqual(['Marketing', 'Gestão']);

    const clientes = m.e.pastasDoComercial![0];
    const onboarding = m.daLista(LISTA_DA_IMPLANTACAO);
    const esteira = m.daLista('Esteira de clientes');
    expect((await erro(() => svc.editarLista(CASA, EU, esteira.id, { name: 'Outra' }))).status).toBe(404);
    expect((await erro(() => svc.editarLista(CASA, EU, onboarding.id, { icone: '📁' }))).status).toBe(404);
    expect((await erro(() => svc.editarPasta(CASA, EU, clientes.id, { name: 'Outra' }))).status).toBe(404);
    expect((await erro(() => svc.apagarPasta(CASA, EU, clientes.id))).status).toBe(404);
    expect((await erro(() => svc.apagarLista(CASA, EU, esteira.id, { confirmarNome: esteira.name }))).status).toBe(404);
    expect((await erro(() => svc.arquivarTarefasDaLista(CASA, EU, esteira.id, { esperadas: 1 }))).status).toBe(404);
    expect(await erro(() => svc.criarLista(CASA, EU, { name: 'Nova', folderId: clientes.id }))).toEqual({ status: 400, mensagem: TRAB_DO_COMERCIAL });
    expect(await erro(() => svc.criarPasta(CASA, EU, { name: 'Sub', parentId: clientes.id }))).toEqual({ status: 400, mensagem: TRAB_DO_COMERCIAL });
    const pessoas = m.daLista('Pessoas');
    expect(await erro(() => svc.editarLista(CASA, EU, pessoas.id, { folderId: clientes.id }))).toEqual({ status: 400, mensagem: TRAB_DO_COMERCIAL });
    expect(await erro(() => svc.moverPasta(CASA, EU, outra.id, { parentId: clientes.id }))).toMatchObject({ status: 404 });
    expect(await erro(() => svc.moverTarefasDaLista(CASA, EU, pessoas.id, { destinoId: esteira.id, esperadas: 1 }))).toEqual({ status: 400, mensagem: TRAB_DO_COMERCIAL });
    // Nada mudou na Clientes.
    expect(await prisma.workList.count({ where: { folderId: clientes.id } })).toBe(3);
    expect(await prisma.workTask.count({ where: { listId: esteira.id, archived: false } })).toBe(1);
    // Nem aparece nas arquivadas da árvore.
    await prisma.workList.update({ where: { id: m.daLista('Execução').id }, data: { arquivadaEm: new Date() } });
    expect((await svc.arquivadas(CASA)).listas).toEqual([]);
  });

  it('ícone e cor: gravam, aparecem na estrutura, apagam e ficam na auditoria como a renomeação', async () => {
    const pasta = await svc.criarPasta(CASA, EU, { name: 'Marketing' });
    const l = await lista(CASA, pasta.id, 'Campanhas');
    await svc.editarLista(CASA, EU, l.id, { icone: '📣', cor: 'mag' });
    await svc.editarPasta(CASA, EU, pasta.id, { icone: 'Megaphone', cor: 'info' });
    let e = await svc.estrutura(CASA);
    expect(e.folders[0]).toMatchObject({ icone: 'Megaphone', cor: 'info' });
    expect(e.folders[0].lists[0]).toMatchObject({ name: 'Campanhas', icone: '📣', cor: 'mag' });

    const linhas = await prisma.auditLog.findMany({ where: { orgId: CASA, entityId: l.id, action: 'work.list.update' } });
    expect(linhas).toHaveLength(1);
    expect(linhas[0].before).toEqual({ icone: null, cor: null });
    expect(linhas[0].after).toEqual({ icone: '📣', cor: 'mag' });

    // Mandar o mesmo não gera trilha nova com mudança; null apaga.
    await svc.editarLista(CASA, EU, l.id, { icone: '📣' });
    await svc.editarLista(CASA, EU, l.id, { icone: null, cor: null });
    e = await svc.estrutura(CASA);
    expect(e.folders[0].lists[0]).toMatchObject({ icone: null, cor: null });
    const depois = await prisma.auditLog.findMany({ where: { orgId: CASA, entityId: l.id, action: 'work.list.update' }, orderBy: { createdAt: 'asc' } });
    expect(depois.at(-1)!.before).toEqual({ icone: '📣', cor: 'mag' });
    expect(depois.at(-1)!.after).toEqual({ icone: null, cor: null });
    expect(depois.filter((x) => x.before && Object.keys(x.before as object).length > 0)).toHaveLength(2);

    // O banco segura o tamanho mesmo por fora da API.
    await expect(prisma.workList.update({ where: { id: l.id }, data: { icone: 'x'.repeat(40) } })).rejects.toThrow();
    // Outra empresa não alcança a lista.
    expect((await erro(() => svc.editarLista(VIZINHA, EU, l.id, { icone: '📁' }))).status).toBe(404);
  });
});
