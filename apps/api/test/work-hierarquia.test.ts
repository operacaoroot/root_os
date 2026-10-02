import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  TRAB_LISTA_COM_DOIS_PAIS, TRAB_PASTA_COM_DOIS_PAIS, TrabListaUpdateSchema, TrabPastaCreateSchema,
} from '@mktos/shared';
import { AuditService } from '../src/audit/audit.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { CheckoutDeTarefaService } from '../src/work/checkout-de-tarefa.service';
import { WorkService } from '../src/work/work.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * ==========================================================================
 * A ÁRVORE DO TRABALHO: ESPAÇO → PASTAS ANINHADAS → LISTAS (ROOT-16, C-15)
 * ==========================================================================
 *
 * O que esta suíte cobra:
 *  1. Pasta dentro de pasta, em qualquer profundidade, e a estrutura devolve
 *     cada nó com o pai imediato.
 *  2. Nome único entre irmãs, e só entre irmãs: homônimas em ramos diferentes
 *     passam; na mesma mãe, 409. O banco segura o mesmo com NULLS NOT DISTINCT.
 *  3. Ciclo recusado, inclusive com dois movimentos ao mesmo tempo.
 *  4. Espaço, pasta e lista de outra empresa recebem o mesmo 404 de um id que
 *     não existe, nada é gravado, e a chave composta do banco recusa também.
 *  5. Mover lista não mexe nas tarefas: os UUIDs ficam.
 *  6. Lista vazia aparece na estrutura, na pasta aninhada e solta no espaço.
 *  7. Pasta com lista ou com pasta dentro não se apaga, e as contagens só olham
 *     a empresa dela (ROOT-12a-REV, item 5).
 */

const URL = process.env.TEST_DATABASE_URL;
const CASA = 'org-teste-hierarquia-casa';
const VIZINHA = 'org-teste-hierarquia-vizinha';
const EMPRESAS = [CASA, VIZINHA];
const EU = 'u-hierarquia-casa';
const ELA = 'u-hierarquia-vizinha';

type Erro = { status: number | null; mensagem: string } | 'sem erro';

/** O erro da chamada numa forma comparável; erro do Prisma vira classe + código. */
async function erroDe(chamada: Promise<unknown>): Promise<Erro> {
  try {
    await chamada;
    return 'sem erro';
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), mensagem: e.message };
    const codigo = (e as { code?: unknown }).code;
    return { status: null, mensagem: [(e as Error).constructor.name, codigo].filter(Boolean).join(' ') };
  }
}

const PASTA_NAO_ENCONTRADA = { status: 404, mensagem: 'Pasta não encontrada' };
const ESPACO_NAO_ENCONTRADO = { status: 404, mensagem: 'Espaço não encontrado' };
const LISTA_NAO_ENCONTRADA = { status: 404, mensagem: 'Lista não encontrada' };
const CICLO = { status: 400, mensagem: 'A pasta não pode ficar dentro dela mesma nem de uma pasta que está dentro dela.' };

describe('trabalho: o que o serviço confere sem banco', () => {
  it('as contagens de apagarPasta filtram pela empresa da pasta', async () => {
    const consultas: Array<{ modelo: string; where: unknown }> = [];
    const conta = (modelo: string) => async (args: { where: unknown }) => { consultas.push({ modelo, where: args.where }); return 0; };
    const prisma = {
      workFolder: { findFirst: async () => ({ id: 'p1' }), count: conta('workFolder'), delete: async () => ({ id: 'p1' }) },
      workList: { count: conta('workList') },
      auditLog: { create: async () => ({}) },
    } as unknown as PrismaService;
    const audit = new AuditService(prisma);
    const svc = new WorkService(prisma, audit, new CheckoutDeTarefaService(prisma, audit, new EventLogService(prisma)));
    await svc.apagarPasta(CASA, EU, 'p1');
    expect(consultas).toEqual([
      { modelo: 'workList', where: { orgId: CASA, folderId: 'p1' } },
      { modelo: 'workFolder', where: { orgId: CASA, parentId: 'p1' } },
    ]);
  });

  it('o corpo com dois pais é recusado antes do serviço', () => {
    const pasta = TrabPastaCreateSchema.safeParse({ name: 'X', spaceId: crypto.randomUUID(), parentId: crypto.randomUUID() });
    expect(pasta.success ? null : pasta.error.issues.map((i) => i.message)).toEqual([TRAB_PASTA_COM_DOIS_PAIS]);
    const lista = TrabListaUpdateSchema.safeParse({ folderId: crypto.randomUUID(), spaceId: crypto.randomUUID() });
    expect(lista.success ? null : lista.error.issues.map((i) => i.message)).toEqual([TRAB_LISTA_COM_DOIS_PAIS]);
    expect(TrabListaUpdateSchema.safeParse({ folderId: null }).success).toBe(true);
  });
});

exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (duas empresas, espaços, pastas, listas, tarefas e auditoria)');

describe.skipIf(!URL)('trabalho: espaço, pasta aninhada e lista', () => {
  let prisma: PrismaClient;
  let svc: WorkService;
  let espacoVizinha: string;
  let pastaVizinha: string;
  let listaVizinha: string;

  async function limpar() {
    await prisma.workTask.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    await prisma.workField.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    await prisma.workList.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    // Chave RESTRICT entre mãe e filha: apaga das folhas para cima. Soltar as
    // filhas antes faria homônimas de ramos diferentes colidirem no topo.
    while ((await prisma.workFolder.deleteMany({ where: { orgId: { in: EMPRESAS }, children: { none: {} } } })).count > 0);
    // Sobra pasta só se uma regressão deixou ciclo; desfeito aqui, o banco
    // compartilhado pelas suítes não fica com lixo que quebra a rodada seguinte.
    await prisma.$executeRaw`UPDATE "WorkFolder" SET "parentId" = NULL, "name" = "name" || ' ' || "id" WHERE "orgId" = ANY(${EMPRESAS})`;
    await prisma.workFolder.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    await prisma.workSpace.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    await prisma.auditLog.deleteMany({ where: { orgId: { in: EMPRESAS } } });
  }

  /** O que a vizinha tem e o que a auditoria das duas registrou: não pode mudar quando a casa erra. */
  async function retratoDaVizinha() {
    return {
      espacos: await prisma.workSpace.count({ where: { orgId: VIZINHA } }),
      pastas: await prisma.workFolder.findMany({ where: { orgId: VIZINHA }, select: { id: true, name: true, spaceId: true, parentId: true }, orderBy: { id: 'asc' } }),
      listas: await prisma.workList.findMany({ where: { orgId: VIZINHA }, select: { id: true, folderId: true, spaceId: true }, orderBy: { id: 'asc' } }),
      listasDaCasaNaVizinha: await prisma.workList.count({ where: { orgId: CASA, OR: [{ folderId: pastaVizinha }, { spaceId: espacoVizinha }] } }),
      pastasDaCasaNaVizinha: await prisma.workFolder.count({ where: { orgId: CASA, OR: [{ parentId: pastaVizinha }, { spaceId: espacoVizinha }] } }),
      auditoria: await prisma.auditLog.count({ where: { orgId: { in: EMPRESAS } } }),
    };
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    svc = new WorkService(p, audit, new CheckoutDeTarefaService(p, audit, new EventLogService(p)));
    for (const orgId of EMPRESAS) {
      await prisma.org.upsert({ where: { id: orgId }, create: { id: orgId, name: orgId, slug: orgId }, update: {} });
    }
    for (const [id, orgId] of [[EU, CASA], [ELA, VIZINHA]] as const) {
      await prisma.user.upsert({
        where: { id },
        create: { id, orgId, name: id, email: `${id}@teste.local`, passwordHash: 'x' },
        update: {},
      });
    }
  });

  beforeEach(async () => {
    await limpar();
    espacoVizinha = (await svc.criarEspaco(VIZINHA, ELA, { name: 'Espaço da vizinha' })).id;
    pastaVizinha = (await svc.criarPasta(VIZINHA, ELA, { name: 'Pasta da vizinha', spaceId: espacoVizinha })).id;
    listaVizinha = (await svc.criarLista(VIZINHA, ELA, { name: 'Lista da vizinha', folderId: pastaVizinha })).id;
    await prisma.auditLog.deleteMany({ where: { orgId: { in: EMPRESAS } } });
  });

  afterAll(async () => {
    if (!prisma) return;
    await limpar();
    await prisma.user.deleteMany({ where: { id: { in: [EU, ELA] } } });
    await prisma.org.deleteMany({ where: { id: { in: EMPRESAS } } });
    await prisma.$disconnect();
  });

  it('pasta aninhada em três níveis: cada nó volta na estrutura com o pai imediato', async () => {
    const espaco = await svc.criarEspaco(CASA, EU, { name: 'Operação' });
    const clientes = await svc.criarPasta(CASA, EU, { name: 'Clientes', spaceId: espaco.id });
    const ativos = await svc.criarPasta(CASA, EU, { name: 'Ativos', parentId: clientes.id });
    const sul = await svc.criarPasta(CASA, EU, { name: 'Região Sul', parentId: ativos.id });
    const lista = await svc.criarLista(CASA, EU, { name: 'Onboarding Sul', folderId: sul.id });

    const est = await svc.estrutura(CASA);
    expect(est.espacos).toEqual([{ id: espaco.id, name: 'Operação', order: 0, externalId: null }]);
    const porNome = Object.fromEntries(est.folders.map((f) => [f.name, f]));
    expect(Object.keys(porNome).sort()).toEqual(['Ativos', 'Clientes', 'Região Sul']);
    expect(porNome['Clientes']).toMatchObject({ spaceId: espaco.id, parentId: null, externalId: null });
    expect(porNome['Ativos']).toMatchObject({ spaceId: null, parentId: clientes.id });
    expect(porNome['Região Sul']).toMatchObject({ spaceId: null, parentId: ativos.id });
    expect(porNome['Região Sul'].lists.map((l) => l.id)).toEqual([lista.id]);
  });

  it('homônimas em ramos diferentes passam; na mesma mãe, no mesmo espaço ou fora de espaço, 409', async () => {
    const espaco = await svc.criarEspaco(CASA, EU, { name: 'Operação' });
    const a = await svc.criarPasta(CASA, EU, { name: 'A', spaceId: espaco.id });
    const b = await svc.criarPasta(CASA, EU, { name: 'B', spaceId: espaco.id });
    await svc.criarPasta(CASA, EU, { name: 'Relatórios', parentId: a.id });
    await svc.criarPasta(CASA, EU, { name: 'Relatórios', parentId: b.id });
    await svc.criarPasta(CASA, EU, { name: 'Relatórios', spaceId: espaco.id });
    await svc.criarPasta(CASA, EU, { name: 'Relatórios' });
    const repetida = { status: 409, mensagem: 'Já existe uma pasta com esse nome neste lugar.' };
    expect(await erroDe(svc.criarPasta(CASA, EU, { name: 'Relatórios', parentId: a.id }))).toEqual(repetida);
    expect(await erroDe(svc.criarPasta(CASA, EU, { name: 'Relatórios', spaceId: espaco.id }))).toEqual(repetida);
    expect(await erroDe(svc.criarPasta(CASA, EU, { name: 'Relatórios' }))).toEqual(repetida);
    // Mover para onde já há uma irmã com o mesmo nome também é 409.
    const solta = await svc.criarPasta(CASA, EU, { name: 'Solta' });
    expect(await erroDe(svc.editarPasta(CASA, EU, solta.id, { name: 'Relatórios', parentId: a.id }))).toEqual(repetida);
    expect(await prisma.workFolder.findUniqueOrThrow({ where: { id: solta.id } })).toMatchObject({ name: 'Solta', parentId: null });
    expect(await erroDe(svc.criarEspaco(CASA, EU, { name: 'Operação' }))).toEqual({ status: 409, mensagem: 'Já existe um espaço com esse nome.' });
    // A vizinha pode ter o mesmo nome: a unicidade é por empresa.
    expect(await erroDe(svc.criarPasta(VIZINHA, ELA, { name: 'Relatórios' }))).toBe('sem erro');
  });

  it('o índice do banco é NULLS NOT DISTINCT: duas pastas de topo fora de espaço com o mesmo nome não entram nem por fora do serviço', async () => {
    // O `migrate diff` do Prisma não enxerga NULLS NOT DISTINCT (medido no ensaio
    // da ROOT-16): sem esta conferência, uma migration futura que recriasse o
    // índice sem a cláusula passaria verde e deixaria pastas repetidas entrarem.
    const indice = await prisma.$queryRaw<Array<{ indnullsnotdistinct: boolean }>>`
      SELECT x.indnullsnotdistinct FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
       WHERE i.relname = 'WorkFolder_orgId_spaceId_parentId_name_key'`;
    expect(indice).toEqual([{ indnullsnotdistinct: true }]);
    await prisma.workFolder.create({ data: { orgId: CASA, name: 'Duplicada' } });
    expect(await erroDe(prisma.workFolder.create({ data: { orgId: CASA, name: 'Duplicada' } })))
      .toEqual({ status: null, mensagem: 'PrismaClientKnownRequestError P2002' });
  });

  it('ciclo recusado: dentro dela mesma, dentro da neta, e o banco recusa a mãe de si mesma', async () => {
    const a = await svc.criarPasta(CASA, EU, { name: 'A' });
    const b = await svc.criarPasta(CASA, EU, { name: 'B', parentId: a.id });
    const c = await svc.criarPasta(CASA, EU, { name: 'C', parentId: b.id });
    await prisma.auditLog.deleteMany({ where: { orgId: CASA } });
    expect(await erroDe(svc.editarPasta(CASA, EU, a.id, { parentId: c.id }))).toEqual(CICLO);
    expect(await erroDe(svc.editarPasta(CASA, EU, a.id, { parentId: a.id }))).toEqual(CICLO);
    expect(await prisma.workFolder.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ parentId: null, spaceId: null });
    expect(await prisma.auditLog.count({ where: { orgId: CASA, action: 'work.folder.update' } })).toBe(0);
    expect(await erroDe(prisma.workFolder.update({ where: { id: a.id }, data: { parentId: a.id } })))
      .toEqual({ status: null, mensagem: 'PrismaClientUnknownRequestError' });
    // Subir de nível não é ciclo.
    expect(await erroDe(svc.editarPasta(CASA, EU, c.id, { parentId: a.id }))).toBe('sem erro');
  });

  it('mover para dentro de outra pasta espera o cadeado da árvore da empresa', async () => {
    // Prova direta do cadeado: com ele seguro por outra transação, o movimento
    // fica parado; sem ele no serviço, terminaria em milissegundos. O caso
    // seguinte mede o resultado, mas sozinho não pega a falta do cadeado: a
    // janela da corrida é curta demais para aparecer sempre.
    const a = await svc.criarPasta(CASA, EU, { name: 'A' });
    const b = await svc.criarPasta(CASA, EU, { name: 'B' });
    let liberar!: () => void;
    const segura = new Promise<void>((r) => { liberar = r; });
    let pegou!: () => void;
    const cadeadoPego = new Promise<void>((r) => { pegou = r; });
    const outraTransacao = prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`work-arvore:${CASA}`}))`;
      pegou();
      await segura;
    }, { timeout: 20_000 });
    await cadeadoPego;
    let terminou = false;
    const movimento = svc.editarPasta(CASA, EU, a.id, { parentId: b.id }).then(() => { terminou = true; });
    await new Promise((r) => setTimeout(r, 400));
    expect(terminou).toBe(false);
    liberar();
    await outraTransacao;
    await movimento;
    expect(await prisma.workFolder.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ parentId: b.id });
  });

  it('dois movimentos que fechariam um ciclo, ao mesmo tempo: só um passa', async () => {
    const a = await svc.criarPasta(CASA, EU, { name: 'A' });
    const b = await svc.criarPasta(CASA, EU, { name: 'B' });
    const [ab, ba] = await Promise.all([
      erroDe(svc.editarPasta(CASA, EU, a.id, { parentId: b.id })),
      erroDe(svc.editarPasta(CASA, EU, b.id, { parentId: a.id })),
    ]);
    expect([ab, ba].filter((e) => e === 'sem erro')).toHaveLength(1);
    expect([ab, ba].filter((e) => e !== 'sem erro')).toEqual([CICLO]);
    const maes = (await prisma.workFolder.findMany({ where: { id: { in: [a.id, b.id] } }, select: { parentId: true } }))
      .map((p) => p.parentId);
    expect(maes.filter((m) => m === null)).toHaveLength(1);
  });

  describe('espaço, pasta e lista de outra empresa: 404, nada gravado', () => {
    it('criar pasta com espaço ou mãe da vizinha', async () => {
      const antes = await retratoDaVizinha();
      expect(await erroDe(svc.criarPasta(CASA, EU, { name: 'X', spaceId: espacoVizinha }))).toEqual(ESPACO_NAO_ENCONTRADO);
      expect(await erroDe(svc.criarPasta(CASA, EU, { name: 'X', parentId: pastaVizinha }))).toEqual(PASTA_NAO_ENCONTRADA);
      expect(await prisma.workFolder.count({ where: { orgId: CASA } })).toBe(0);
      expect(await retratoDaVizinha()).toEqual(antes);
    });

    it('mover pasta da casa para dentro da vizinha, e mexer na pasta da vizinha', async () => {
      const minha = await svc.criarPasta(CASA, EU, { name: 'Minha' });
      await prisma.auditLog.deleteMany({ where: { orgId: CASA } });
      const antes = await retratoDaVizinha();
      expect(await erroDe(svc.editarPasta(CASA, EU, minha.id, { parentId: pastaVizinha }))).toEqual(PASTA_NAO_ENCONTRADA);
      expect(await erroDe(svc.editarPasta(CASA, EU, minha.id, { spaceId: espacoVizinha }))).toEqual(ESPACO_NAO_ENCONTRADO);
      expect(await erroDe(svc.editarPasta(CASA, EU, pastaVizinha, { name: 'Tomada' }))).toEqual(PASTA_NAO_ENCONTRADA);
      expect(await erroDe(svc.apagarPasta(CASA, EU, pastaVizinha))).toEqual(PASTA_NAO_ENCONTRADA);
      expect(await prisma.workFolder.findUniqueOrThrow({ where: { id: minha.id } })).toMatchObject({ parentId: null, spaceId: null });
      expect(await retratoDaVizinha()).toEqual(antes);
    });

    it('criar e mover lista para pasta ou espaço da vizinha, e mexer na lista da vizinha', async () => {
      const minha = await svc.criarLista(CASA, EU, { name: 'Minha lista' });
      await prisma.auditLog.deleteMany({ where: { orgId: CASA } });
      const antes = await retratoDaVizinha();
      expect(await erroDe(svc.criarLista(CASA, EU, { name: 'X', folderId: pastaVizinha }))).toEqual(PASTA_NAO_ENCONTRADA);
      expect(await erroDe(svc.criarLista(CASA, EU, { name: 'X', spaceId: espacoVizinha }))).toEqual(ESPACO_NAO_ENCONTRADO);
      expect(await erroDe(svc.criarListaDoModelo(CASA, EU, { modelo: 'esteira-de-clientes', spaceId: espacoVizinha }))).toEqual(ESPACO_NAO_ENCONTRADO);
      expect(await erroDe(svc.editarLista(CASA, EU, minha.id, { folderId: pastaVizinha }))).toEqual(PASTA_NAO_ENCONTRADA);
      expect(await erroDe(svc.editarLista(CASA, EU, minha.id, { spaceId: espacoVizinha }))).toEqual(ESPACO_NAO_ENCONTRADO);
      expect(await erroDe(svc.editarLista(CASA, EU, listaVizinha, { name: 'Tomada' }))).toEqual(LISTA_NAO_ENCONTRADA);
      expect(await prisma.workList.findMany({ where: { orgId: CASA }, select: { id: true, folderId: true, spaceId: true } }))
        .toEqual([{ id: minha.id, folderId: null, spaceId: null }]);
      expect(await retratoDaVizinha()).toEqual(antes);
    });

    it('editar e apagar espaço da vizinha', async () => {
      const antes = await retratoDaVizinha();
      expect(await erroDe(svc.editarEspaco(CASA, EU, espacoVizinha, { name: 'Tomado' }))).toEqual(ESPACO_NAO_ENCONTRADO);
      expect(await erroDe(svc.apagarEspaco(CASA, EU, espacoVizinha))).toEqual(ESPACO_NAO_ENCONTRADO);
      expect(await retratoDaVizinha()).toEqual(antes);
    });

    it('a chave composta do banco recusa o mesmo cruzamento por fora do serviço', async () => {
      const fk = { status: null, mensagem: 'PrismaClientKnownRequestError P2003' };
      expect(await erroDe(prisma.workList.create({ data: { orgId: CASA, name: 'Furo', folderId: pastaVizinha } }))).toEqual(fk);
      expect(await erroDe(prisma.workList.create({ data: { orgId: CASA, name: 'Furo', spaceId: espacoVizinha } }))).toEqual(fk);
      expect(await erroDe(prisma.workFolder.create({ data: { orgId: CASA, name: 'Furo', parentId: pastaVizinha } }))).toEqual(fk);
      expect(await erroDe(prisma.workFolder.create({ data: { orgId: CASA, name: 'Furo', spaceId: espacoVizinha } }))).toEqual(fk);
      // A pasta da vizinha, vazia de listas e filhas DELA, se apaga normalmente.
      await prisma.workList.delete({ where: { id: listaVizinha } });
      expect(await erroDe(svc.apagarPasta(VIZINHA, ELA, pastaVizinha))).toBe('sem erro');
    });
  });

  it('mover lista entre pasta aninhada, espaço e fora de espaço mantém as tarefas e os UUIDs delas', async () => {
    const espaco = await svc.criarEspaco(CASA, EU, { name: 'Operação' });
    const mae = await svc.criarPasta(CASA, EU, { name: 'Mãe', spaceId: espaco.id });
    const filha = await svc.criarPasta(CASA, EU, { name: 'Filha', parentId: mae.id });
    const lista = await svc.criarLista(CASA, EU, { name: 'Lista que anda' });
    const t1 = await svc.criarTarefa(CASA, EU, { listId: lista.id, title: 'Primeira' });
    const t2 = await svc.criarTarefa(CASA, EU, { listId: lista.id, title: 'Segunda' });
    const retrato = async () => (await prisma.workTask.findMany({
      where: { orgId: CASA }, select: { id: true, listId: true, statusId: true, title: true }, orderBy: { id: 'asc' },
    }));
    const antes = await retrato();
    expect(antes.map((t) => t.id).sort()).toEqual([t1.id, t2.id].sort());

    for (const destino of [{ folderId: filha.id }, { spaceId: espaco.id }, { folderId: null }]) {
      await svc.editarLista(CASA, EU, lista.id, destino);
      expect(await retrato()).toEqual(antes);
    }
    // Sem `orderBy`: três escritas seguidas podem cair no mesmo milissegundo.
    const trilha = await prisma.auditLog.findMany({
      where: { orgId: CASA, action: 'work.list.update', entityId: lista.id }, select: { before: true, after: true },
    });
    expect(trilha).toHaveLength(3);
    expect(trilha).toEqual(expect.arrayContaining([
      { before: { folderId: null, spaceId: null }, after: { folderId: filha.id, spaceId: null } },
      { before: { folderId: filha.id, spaceId: null }, after: { folderId: null, spaceId: espaco.id } },
      { before: { folderId: null, spaceId: espaco.id }, after: { folderId: null, spaceId: null } },
    ]));
  });

  it('lista vazia aparece na estrutura: na pasta aninhada, solta no espaço e fora de espaço', async () => {
    const espaco = await svc.criarEspaco(CASA, EU, { name: 'Operação' });
    const mae = await svc.criarPasta(CASA, EU, { name: 'Mãe', spaceId: espaco.id });
    const filha = await svc.criarPasta(CASA, EU, { name: 'Filha', parentId: mae.id });
    const naFilha = await svc.criarLista(CASA, EU, { name: 'Vazia na filha', folderId: filha.id });
    const noEspaco = await svc.criarLista(CASA, EU, { name: 'Vazia no espaço', spaceId: espaco.id });
    const fora = await svc.criarLista(CASA, EU, { name: 'Vazia fora' });
    const est = await svc.estrutura(CASA);
    const listaNaFilha = est.folders.find((f) => f.id === filha.id)!.lists;
    expect(listaNaFilha.map((l) => [l.id, l.total, l.spaceId, l.statuses.length])).toEqual([[naFilha.id, 0, null, 3]]);
    expect(est.listasSoltas.map((l) => [l.id, l.total, l.spaceId]).sort()).toEqual(
      [[noEspaco.id, 0, espaco.id], [fora.id, 0, null]].sort(),
    );
  });

  it('a lista do modelo nasce solta no espaço', async () => {
    const espaco = await svc.criarEspaco(CASA, EU, { name: 'Comercial' });
    const lista = await svc.criarListaDoModelo(CASA, EU, { modelo: 'esteira-de-clientes', spaceId: espaco.id });
    expect(await prisma.workList.findUniqueOrThrow({ where: { id: lista.id } })).toMatchObject({ spaceId: espaco.id, folderId: null });
  });

  it('pasta com lista ou com pasta dentro não se apaga; espaço com pasta ou lista também não', async () => {
    const espaco = await svc.criarEspaco(CASA, EU, { name: 'Operação' });
    const mae = await svc.criarPasta(CASA, EU, { name: 'Mãe', spaceId: espaco.id });
    const filha = await svc.criarPasta(CASA, EU, { name: 'Filha', parentId: mae.id });
    const lista = await svc.criarLista(CASA, EU, { name: 'Na filha', folderId: filha.id });
    expect(await erroDe(svc.apagarPasta(CASA, EU, mae.id))).toEqual({ status: 400, mensagem: 'Pasta tem pastas dentro — mova ou apague antes.' });
    expect(await erroDe(svc.apagarPasta(CASA, EU, filha.id))).toEqual({ status: 400, mensagem: 'Pasta tem listas — mova ou apague antes.' });
    const espacoCheio = { status: 400, mensagem: 'Espaço tem pastas ou listas — mova ou apague antes.' };
    expect(await erroDe(svc.apagarEspaco(CASA, EU, espaco.id))).toEqual(espacoCheio);
    // O banco segura o mesmo: RESTRICT da lista para a pasta e da filha para a mãe.
    expect(await erroDe(prisma.workFolder.delete({ where: { id: filha.id } })))
      .toEqual({ status: null, mensagem: 'PrismaClientKnownRequestError P2003' });

    await svc.editarLista(CASA, EU, lista.id, { spaceId: espaco.id });
    expect(await erroDe(svc.apagarPasta(CASA, EU, filha.id))).toBe('sem erro');
    expect(await erroDe(svc.apagarPasta(CASA, EU, mae.id))).toBe('sem erro');
    expect(await erroDe(svc.apagarEspaco(CASA, EU, espaco.id))).toEqual(espacoCheio);
    await svc.editarLista(CASA, EU, lista.id, { folderId: null });
    expect(await erroDe(svc.apagarEspaco(CASA, EU, espaco.id))).toBe('sem erro');
  });

  it('um pai só: o serviço recusa os dois, e o banco também', async () => {
    const espaco = await svc.criarEspaco(CASA, EU, { name: 'Operação' });
    const mae = await svc.criarPasta(CASA, EU, { name: 'Mãe' });
    const lista = await svc.criarLista(CASA, EU, { name: 'Lista' });
    expect(await erroDe(svc.criarPasta(CASA, EU, { name: 'X', spaceId: espaco.id, parentId: mae.id })))
      .toEqual({ status: 400, mensagem: TRAB_PASTA_COM_DOIS_PAIS });
    expect(await erroDe(svc.editarLista(CASA, EU, lista.id, { folderId: mae.id, spaceId: espaco.id })))
      .toEqual({ status: 400, mensagem: TRAB_LISTA_COM_DOIS_PAIS });
    const check = { status: null, mensagem: 'PrismaClientUnknownRequestError' };
    expect(await erroDe(prisma.workFolder.create({ data: { orgId: CASA, name: 'Y', spaceId: espaco.id, parentId: mae.id } }))).toEqual(check);
    expect(await erroDe(prisma.workList.update({ where: { id: lista.id }, data: { folderId: mae.id, spaceId: espaco.id } }))).toEqual(check);
  });

  it('mover pasta registra de onde saiu e para onde foi; renomear não registra destino', async () => {
    const espaco = await svc.criarEspaco(CASA, EU, { name: 'Operação' });
    const mae = await svc.criarPasta(CASA, EU, { name: 'Mãe' });
    const pasta = await svc.criarPasta(CASA, EU, { name: 'Pasta', spaceId: espaco.id });
    await svc.editarPasta(CASA, EU, pasta.id, { parentId: mae.id });
    await svc.editarPasta(CASA, EU, pasta.id, { name: 'Pasta renomeada' });
    const trilha = await prisma.auditLog.findMany({
      where: { orgId: CASA, action: 'work.folder.update', entityId: pasta.id }, select: { before: true, after: true },
    });
    expect(trilha).toHaveLength(2);
    expect(trilha).toEqual(expect.arrayContaining([
      { before: { spaceId: espaco.id, parentId: null }, after: { spaceId: null, parentId: mae.id } },
      { before: null, after: null },
    ]));
  });

  it('campo moeda não ganha opção (O2 da ROOT-06a-IMPL); drop_down continua ganhando', async () => {
    const moeda = await svc.criarCampo(CASA, EU, { name: 'Valor', type: 'moeda' });
    const lista = await svc.criarCampo(CASA, EU, { name: 'Origem', type: 'drop_down' });
    expect(await erroDe(svc.criarOpcao(CASA, EU, moeda.id, { name: 'Alto' }))).toEqual({ status: 400, mensagem: 'Campo moeda não tem opções.' });
    expect(await prisma.workFieldOption.count({ where: { fieldId: moeda.id } })).toBe(0);
    expect(await erroDe(svc.criarOpcao(CASA, EU, lista.id, { name: 'Indicação' }))).toBe('sem erro');
  });
});
