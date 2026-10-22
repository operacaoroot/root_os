import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  TrabPastaMoverSchema, TRAB_NOME_DE_LISTA_REPETIDO, TRAB_NOME_DE_PASTA_REPETIDO, TRAB_PASTA_DA_IMPLANTACAO_PROTEGIDA,
  TRAB_PASTA_EM_CICLO, TRAB_PASTA_FUNDA_DEMAIS, TRAB_NIVEIS_DE_PASTA, TRAB_LISTA_VOLTOU_SEM_PASTA, TRAB_PASTA_VOLTOU_AO_TOPO,
  TAREFA_IGUAL_JA_EXISTE, IMPORTACAO_CRM_MARCA,
  motivoParaNaoMoverPasta, alturaDaPasta, profundidadeDaPasta, destinoDoValorDoCampo, tarefaIgual, fraseDosCamposGuardados,
} from '@mktos/shared';
import { AuditService } from '../src/audit/audit.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { CheckoutDeTarefaService } from '../src/work/checkout-de-tarefa.service';
import { WorkService } from '../src/work/work.service';
import { WorkController } from '../src/work/work.controller';
import { LISTA_DO_COMERCIAL } from '../src/work/lista-do-comercial';
import { RECUSA_DE_MAQUINA_NO_TRABALHO, SoGenteNoTrabalhoGuard } from '../src/work/so-gente-no-trabalho.guard';
import { PERMISSIONS_KEY } from '../src/auth/permissions.decorator';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * TRABALHO: DESARQUIVAR, MOVER PASTA PARA DENTRO DE PASTA E CAMPOS AO MOVER
 * TAREFAS (rodada de produção 2, M3, 22/10/2026).
 *
 *  1. sem banco: ciclo e nível de pasta, o campo que recebe o valor, a tarefa igual,
 *     a frase dos campos guardados, os corpos e os guardas das rotas novas;
 *  2. contra o Postgres: desarquivar lista (volta à pasta; mãe arquivada = Sem pasta
 *     com a frase; nome repetido = 409; comercial = 404), desarquivar pasta (voltam
 *     as listas do mesmo instante, as de antes ficam; mãe arquivada = primeiro
 *     nível), quem arquivou pela auditoria (tela e importador), conta de máquina
 *     recusada, outra empresa não vê nem alcança; mover pasta (dentro, topo, ciclo,
 *     nível, protegida, nome repetido, 404 de arquivada); campos ao mover tarefas
 *     (copiado, sem equivalente guardado, contagem, e a origem arquivada ao sair).
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

describe('M3: as regras sem banco', () => {
  const arvore = [
    { id: 'a', parentId: null }, { id: 'a1', parentId: 'a' }, { id: 'a11', parentId: 'a1' },
    { id: 'b', parentId: null }, { id: 'b1', parentId: 'b' }, { id: 'b11', parentId: 'b1' }, { id: 'b111', parentId: 'b11' },
    { id: 'c', parentId: null },
  ];

  it('profundidade e altura da pasta', () => {
    expect(profundidadeDaPasta(arvore, 'a')).toBe(1);
    expect(profundidadeDaPasta(arvore, 'b111')).toBe(4);
    expect(alturaDaPasta(arvore, 'a')).toBe(3);
    expect(alturaDaPasta(arvore, 'c')).toBe(1);
    // Ciclo gravado no banco não trava a conta.
    expect(profundidadeDaPasta([{ id: 'x', parentId: 'y' }, { id: 'y', parentId: 'x' }], 'x')).toBe(2);
  });

  it('mover pasta: ciclo, nível e primeiro nível', () => {
    expect(motivoParaNaoMoverPasta(arvore, 'a', 'a')).toBe(TRAB_PASTA_EM_CICLO);
    expect(motivoParaNaoMoverPasta(arvore, 'a', 'a11')).toBe(TRAB_PASTA_EM_CICLO);
    // a (altura 3) dentro de c (nível 1) = 4: cabe; dentro de b1 (nível 2) = 5: funda demais.
    expect(motivoParaNaoMoverPasta(arvore, 'a', 'c')).toBeNull();
    expect(motivoParaNaoMoverPasta(arvore, 'a', 'b1')).toBe(TRAB_PASTA_FUNDA_DEMAIS);
    expect(motivoParaNaoMoverPasta(arvore, 'c', 'b11')).toBeNull();
    expect(motivoParaNaoMoverPasta(arvore, 'c', 'b111')).toBe(TRAB_PASTA_FUNDA_DEMAIS);
    expect(motivoParaNaoMoverPasta(arvore, 'b111', null)).toBeNull();
    expect(TRAB_NIVEIS_DE_PASTA).toBe(4);
    expect(TrabPastaMoverSchema.safeParse({ parentId: null }).success).toBe(true);
    expect(TrabPastaMoverSchema.safeParse({ parentId: 'x' }).success).toBe(false);
    expect(TrabPastaMoverSchema.safeParse({}).success).toBe(false);
  });

  it('o campo do destino que recebe o valor: mesmo nome e tipo; na seleção, a opção de mesmo nome', () => {
    const origem = { id: 'o1', name: 'Fase', type: 'drop_down', options: [{ id: 'oa', name: 'Análise' }, { id: 'ob', name: 'Outra' }] };
    const destino = [
      { id: 'd0', name: 'fase', type: 'texto', options: [] },
      { id: 'd1', name: ' FASE ', type: 'drop_down', options: [{ id: 'da', name: 'analise' }] },
    ];
    expect(destinoDoValorDoCampo({ fieldId: 'o1', optionId: 'oa', value: null }, origem, destino)).toEqual({ fieldId: 'd1', optionId: 'da', value: null });
    expect(destinoDoValorDoCampo({ fieldId: 'o1', optionId: 'ob', value: null }, origem, destino)).toBeNull();
    const texto = { id: 'o2', name: 'Observação', type: 'texto', options: [] };
    expect(destinoDoValorDoCampo({ fieldId: 'o2', optionId: null, value: 'oi' }, texto, [{ id: 'd2', name: 'observacao', type: 'texto', options: [] }]))
      .toEqual({ fieldId: 'd2', optionId: null, value: 'oi' });
    expect(destinoDoValorDoCampo({ fieldId: 'o2', optionId: null, value: 'oi' }, texto, [{ id: 'd3', name: 'Observação', type: 'url', options: [] }])).toBeNull();
  });

  it('a tarefa igual e as frases', () => {
    const abertas = [{ title: 'Fazer FUP da proposta' }, { title: 'Ligar para o contato' }];
    expect(tarefaIgual(abertas, 'proposta: fazer fup', (t) => t.title)?.title).toBe('Fazer FUP da proposta');
    expect(tarefaIgual(abertas, 'Mandar a proposta', (t) => t.title)).toBeUndefined();
    expect(TAREFA_IGUAL_JA_EXISTE).toBe('Essa tarefa já existe.');
    expect(fraseDosCamposGuardados(0)).toBeNull();
    expect(fraseDosCamposGuardados(1)).toBe('1 valor de campo sem equivalente ficou guardado na lista de origem.');
    expect(fraseDosCamposGuardados(3)).toBe('3 valores de campos sem equivalente ficaram guardados na lista de origem.');
  });

  it('as rotas novas: desarquivar e mover pasta são de gente com a permissão de apagar; a lista lê com tarefas.ver', () => {
    for (const metodo of ['moverPasta', 'desarquivarPasta', 'desarquivarLista'] as const) {
      const guardas = Reflect.getMetadata('__guards__', WorkController.prototype[metodo]) as unknown[];
      expect(guardas).toContain(SoGenteNoTrabalhoGuard);
      expect(Reflect.getMetadata(PERMISSIONS_KEY, WorkController.prototype[metodo])).toEqual(['tarefas.editar']);
    }
    expect(Reflect.getMetadata(PERMISSIONS_KEY, WorkController.prototype.arquivadas)).toEqual(['tarefas.ver']);
    const guarda = new SoGenteNoTrabalhoGuard();
    const ctx = (roles: string[]) => ({ switchToHttp: () => ({ getRequest: () => ({ user: { sub: 'u', orgId: 'o', roles } }) }) }) as never;
    expect(() => guarda.canActivate(ctx(['ia_acao']))).toThrow(RECUSA_DE_MAQUINA_NO_TRABALHO);
  });
});

const URL = process.env.TEST_DATABASE_URL;
const CASA = 'org-teste-m3-casa';
const VIZINHA = 'org-teste-m3-vizinha';
const EMPRESAS = [CASA, VIZINHA];
const EU = 'u-m3-casa';
const MAQUINA = 'u-m3-maquina';
const ELA = 'u-m3-vizinha';

exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (duas empresas, pastas, listas, tarefas, campos e auditoria)');

describe.skipIf(!URL)('M3: contra o Postgres', () => {
  let prisma: PrismaClient;
  let svc: WorkService;

  async function limpar(tentativa = 1): Promise<void> {
    try {
      await prisma.auditLog.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workTask.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workField.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workStatus.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workList.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      while ((await prisma.workFolder.deleteMany({ where: { orgId: { in: EMPRESAS }, children: { none: {} } } })).count > 0);
      await prisma.$executeRaw`UPDATE "WorkFolder" SET "parentId" = NULL, "name" = "name" || ' ' || "id" WHERE "orgId" = ANY(${EMPRESAS})`;
      await prisma.workFolder.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workSpace.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    } catch (e) {
      if (tentativa < 4 && /40P01|deadlock/.test(String((e as Error).message))) return limpar(tentativa + 1);
      throw e;
    }
  }

  async function pasta(orgId: string, name: string, parentId: string | null = null, arquivadaEm: Date | null = null) {
    return (await prisma.workFolder.create({ data: { orgId, name, parentId, arquivadaEm } })).id;
  }

  async function lista(orgId: string, folderId: string | null, name: string, titulos: string[] = [], extra: { arquivadaEm?: Date | null; externalId?: string } = {}) {
    const l = await prisma.workList.create({ data: { orgId, folderId, name, ...extra } });
    const st = await prisma.workStatus.create({ data: { orgId, listId: l.id, name: 'A fazer', type: 'open', order: 0 } });
    const ids: string[] = [];
    for (const title of titulos) ids.push((await prisma.workTask.create({ data: { orgId, listId: l.id, statusId: st.id, title, archived: !!extra.arquivadaEm } })).id);
    return { id: l.id, tarefas: ids, statusId: st.id };
  }

  const arvore = async (orgId = CASA) => {
    const e = await svc.estrutura(orgId);
    const nome = (id: string | null) => e.folders.find((f) => f.id === id)?.name;
    return {
      pastas: e.folders.map((f) => `${f.name}${f.parentId ? ` < ${nome(f.parentId)}` : ''}`).sort(),
      listas: [...e.folders.flatMap((f) => f.lists.map((l) => `${f.name} / ${l.name}`)), ...e.listasSoltas.map((l) => `Sem pasta / ${l.name}`)].sort(),
    };
  };

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    svc = new WorkService(p, audit, new CheckoutDeTarefaService(p, audit, new EventLogService(p)));
    for (const orgId of EMPRESAS) await prisma.org.upsert({ where: { id: orgId }, create: { id: orgId, name: orgId, slug: orgId }, update: {} });
    const permissoes = [];
    for (const key of ['tarefas.ver', 'tarefas.editar']) {
      permissoes.push(await prisma.permission.upsert({ where: { key }, create: { key }, update: {}, select: { id: true } }));
    }
    for (const [user, key, orgId] of [[EU, 'analista', CASA], [MAQUINA, 'ia_acao', CASA], [ELA, 'analista', VIZINHA]] as const) {
      const papel = await prisma.role.upsert({
        where: { orgId_key: { orgId, key } },
        create: { orgId, key, name: key, permissions: { connect: permissoes } },
        update: { permissions: { connect: permissoes } },
        select: { id: true },
      });
      await prisma.user.upsert({
        where: { id: user },
        create: { id: user, orgId, name: `Pessoa ${user}`, email: `${user}@teste.local`, passwordHash: 'x', roles: { connect: { id: papel.id } } },
        update: { roles: { connect: { id: papel.id } } },
      });
    }
  });

  beforeEach(limpar);

  afterAll(async () => {
    await limpar();
    await prisma.user.deleteMany({ where: { id: { in: [EU, MAQUINA, ELA] } } });
    await prisma.role.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    await prisma.org.deleteMany({ where: { id: { in: EMPRESAS } } });
    await prisma.$disconnect();
  });

  it('desarquivar lista: volta para a pasta onde estava, com quem arquivou na seção e a auditoria', async () => {
    const gestao = await pasta(CASA, 'Gestão');
    const fin = await lista(CASA, gestao, 'Financeiro', ['Pagar o aluguel']);
    await svc.arquivarTarefasDaLista(CASA, EU, fin.id, { esperadas: 1 });
    expect((await svc.apagarLista(CASA, EU, fin.id, { confirmarNome: 'Financeiro' })).modo).toBe('arquivada');
    expect((await arvore()).listas).toEqual([]);

    const secao = await svc.arquivadas(CASA);
    expect(secao.pastas).toEqual([]);
    expect(secao.listas).toHaveLength(1);
    expect(secao.listas[0]).toMatchObject({
      id: fin.id, name: 'Financeiro', por: { id: EU, nome: `Pessoa ${EU}` }, pasta: { id: gestao, name: 'Gestão' }, maeArquivada: false, tarefas: 1,
    });

    expect(await svc.desarquivarLista(CASA, EU, fin.id)).toEqual({
      id: fin.id, tipo: 'lista', destino: 'mesmo-lugar', pastasJunto: 0, listasJunto: 0, aviso: null,
    });
    expect((await arvore()).listas).toEqual(['Gestão / Financeiro']);
    expect((await svc.arquivadas(CASA)).listas).toEqual([]);
    // As tarefas arquivadas continuam arquivadas: desarquivar a lista não as traz.
    expect(await prisma.workTask.count({ where: { listId: fin.id, archived: true } })).toBe(1);
    const rastro = await prisma.auditLog.findFirstOrThrow({ where: { orgId: CASA, action: 'work.list.unarchive', entityId: fin.id } });
    expect(rastro.actorId).toBe(EU);
    expect(rastro.after).toMatchObject({ arquivadaEm: null, folderId: gestao, destino: 'mesmo-lugar' });
    // Não arquivada não se desarquiva.
    expect((await erro(() => svc.desarquivarLista(CASA, EU, fin.id))).status).toBe(404);
  });

  it('desarquivar lista com a pasta ainda arquivada: vai para Sem pasta e a resposta diz isso', async () => {
    const t0 = new Date('2026-10-20T12:00:00.000Z');
    const crm = await pasta(CASA, 'CRM', null, new Date('2026-10-21T12:00:00.000Z'));
    const leads = await lista(CASA, crm, 'Gestão de Leads', [], { arquivadaEm: t0 });
    expect((await svc.arquivadas(CASA)).listas[0]).toMatchObject({ id: leads.id, maeArquivada: true, pasta: { id: crm, name: 'CRM' } });
    const r = await svc.desarquivarLista(CASA, EU, leads.id);
    expect(r).toMatchObject({ destino: 'sem-pasta', aviso: TRAB_LISTA_VOLTOU_SEM_PASTA });
    expect((await arvore()).listas).toEqual(['Sem pasta / Gestão de Leads']);
    // A pasta continua arquivada (e agora sem a lista).
    expect((await prisma.workFolder.findUniqueOrThrow({ where: { id: crm } })).arquivadaEm).not.toBeNull();
  });

  it('desarquivar pasta: voltam as listas arquivadas no mesmo instante; as arquivadas antes ficam', async () => {
    const quando = new Date('2026-10-21T13:00:00.000Z');
    const antes = new Date('2026-10-15T09:00:00.000Z');
    const crm = await pasta(CASA, 'CRM', null, quando);
    const sub = await pasta(CASA, 'Subpasta', crm, quando);
    const junto1 = await lista(CASA, crm, 'Gestão de Leads', ['Lead A'], { arquivadaEm: quando });
    const junto2 = await lista(CASA, sub, 'Contratos', [], { arquivadaEm: quando });
    const velha = await lista(CASA, crm, 'Lixo de teste', ['Um', 'Dois'], { arquivadaEm: antes });
    // O importador do CRM registra a sua marca na auditoria: é ela que diz quem arquivou.
    await prisma.auditLog.create({ data: { orgId: CASA, actorId: EU, action: `${IMPORTACAO_CRM_MARCA}.pasta_arquivada`, entityType: 'work_folder', entityId: crm } });

    const secao = await svc.arquivadas(CASA);
    const doCrm = secao.pastas.find((p) => p.id === crm)!;
    expect(doCrm).toMatchObject({ name: 'CRM', por: { id: EU }, mae: null, maeArquivada: false, listas: 2, tarefas: 3, listasQueVoltam: 1 });
    expect(secao.pastas.find((p) => p.id === sub)).toMatchObject({ maeArquivada: true, mae: { id: crm, name: 'CRM' } });
    expect(secao.listas.map((l) => l.name).sort()).toEqual(['Contratos', 'Gestão de Leads', 'Lixo de teste']);

    expect(await svc.desarquivarPasta(CASA, EU, crm)).toEqual({
      id: crm, tipo: 'pasta', destino: 'mesmo-lugar', pastasJunto: 1, listasJunto: 2, aviso: null,
    });
    expect(await arvore()).toEqual({ pastas: ['CRM', 'Subpasta < CRM'], listas: ['CRM / Gestão de Leads', 'Subpasta / Contratos'] });
    expect((await prisma.workList.findUniqueOrThrow({ where: { id: velha.id } })).arquivadaEm?.toISOString()).toBe(antes.toISOString());
    expect((await svc.arquivadas(CASA)).listas.map((l) => l.id)).toEqual([velha.id]);
    expect(await prisma.auditLog.count({ where: { orgId: CASA, action: 'work.list.unarchive', entityId: { in: [junto1.id, junto2.id] } } })).toBe(2);
    const rastro = await prisma.auditLog.findFirstOrThrow({ where: { orgId: CASA, action: 'work.folder.unarchive', entityId: crm } });
    expect(rastro.after).toMatchObject({ pastasJunto: 1, listasJunto: 2, destino: 'mesmo-lugar' });
  });

  it('desarquivar pasta com a mãe arquivada: vai para o primeiro nível e a resposta diz isso', async () => {
    const mae = await pasta(CASA, 'Antiga', null, new Date('2026-10-01T00:00:00.000Z'));
    const filha = await pasta(CASA, 'Projetos', mae, new Date('2026-10-02T00:00:00.000Z'));
    await lista(CASA, filha, 'Site', [], { arquivadaEm: new Date('2026-10-02T00:00:00.000Z') });
    const r = await svc.desarquivarPasta(CASA, EU, filha);
    expect(r).toMatchObject({ destino: 'primeiro-nivel', aviso: TRAB_PASTA_VOLTOU_AO_TOPO, listasJunto: 1 });
    expect(await arvore()).toEqual({ pastas: ['Projetos'], listas: ['Projetos / Site'] });
  });

  it('nome repetido no destino é recusado com a frase e nada muda', async () => {
    const gestao = await pasta(CASA, 'Gestão');
    await lista(CASA, gestao, 'Pessoas');
    const guardada = await lista(CASA, gestao, 'pessoas', [], { arquivadaEm: new Date() });
    expect(await erro(() => svc.desarquivarLista(CASA, EU, guardada.id))).toEqual({ status: 409, mensagem: TRAB_NOME_DE_LISTA_REPETIDO });
    expect((await prisma.workList.findUniqueOrThrow({ where: { id: guardada.id } })).arquivadaEm).not.toBeNull();

    await pasta(CASA, 'Clientes');
    const outra = await pasta(CASA, 'CLIENTES ', null, new Date());
    expect(await erro(() => svc.desarquivarPasta(CASA, EU, outra))).toEqual({ status: 409, mensagem: TRAB_NOME_DE_PASTA_REPETIDO });
    expect((await prisma.workFolder.findUniqueOrThrow({ where: { id: outra } })).arquivadaEm).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { orgId: CASA, action: { endsWith: '.unarchive' } } })).toBe(0);
  });

  it('a lista do comercial não aparece nem se desarquiva por aqui; conta de máquina é recusada; outra empresa não vê nem alcança', async () => {
    const comercial = await lista(CASA, null, 'Tarefas do comercial', [], { arquivadaEm: new Date(), externalId: LISTA_DO_COMERCIAL });
    const minha = await lista(CASA, null, 'Avulsa', [], { arquivadaEm: new Date() });
    const minhaPasta = await pasta(CASA, 'Guardada', null, new Date());
    const daVizinha = await lista(VIZINHA, null, 'Da vizinha', [], { arquivadaEm: new Date() });

    const secao = await svc.arquivadas(CASA);
    expect(secao.listas.map((l) => l.id)).toEqual([minha.id]);
    expect((await erro(() => svc.desarquivarLista(CASA, EU, comercial.id))).status).toBe(404);

    expect(await erro(() => svc.desarquivarLista(CASA, MAQUINA, minha.id))).toEqual({ status: 403, mensagem: RECUSA_DE_MAQUINA_NO_TRABALHO });
    expect(await erro(() => svc.desarquivarPasta(CASA, MAQUINA, minhaPasta))).toEqual({ status: 403, mensagem: RECUSA_DE_MAQUINA_NO_TRABALHO });
    // Quem não é desta empresa não desarquiva (relido no banco).
    expect((await erro(() => svc.desarquivarLista(CASA, ELA, minha.id))).status).toBe(403);

    const vizinha = await svc.arquivadas(VIZINHA);
    expect(vizinha.listas.map((l) => l.id)).toEqual([daVizinha.id]);
    expect(vizinha.pastas).toEqual([]);
    expect((await erro(() => svc.desarquivarLista(VIZINHA, ELA, minha.id))).status).toBe(404);
    expect((await erro(() => svc.desarquivarPasta(VIZINHA, ELA, minhaPasta))).status).toBe(404);
    expect((await prisma.workList.findUniqueOrThrow({ where: { id: minha.id } })).arquivadaEm).not.toBeNull();
  });

  it('mover pasta para dentro de outra e para o primeiro nível, com auditoria', async () => {
    const gestao = await pasta(CASA, 'Gestão');
    const mkt = await pasta(CASA, 'Marketing');
    await lista(CASA, mkt, 'Demandas');
    expect(await svc.moverPasta(CASA, EU, mkt, { parentId: gestao })).toMatchObject({ parentId: gestao, spaceId: null, mudou: true });
    expect(await arvore()).toEqual({ pastas: ['Gestão', 'Marketing < Gestão'], listas: ['Marketing / Demandas'] });
    const rastro = await prisma.auditLog.findFirstOrThrow({ where: { orgId: CASA, action: 'work.folder.update', entityId: mkt } });
    expect(rastro.before).toMatchObject({ parentId: null });
    expect(rastro.after).toMatchObject({ parentId: gestao });
    expect(rastro.metadata).toMatchObject({ origem: 'pasta.mover' });
    // No mesmo lugar, nada muda.
    expect(await svc.moverPasta(CASA, EU, mkt, { parentId: gestao })).toMatchObject({ mudou: false });
    expect(await svc.moverPasta(CASA, EU, mkt, { parentId: null })).toMatchObject({ parentId: null, mudou: true });
    expect((await arvore()).pastas).toEqual(['Gestão', 'Marketing']);
  });

  it('mover pasta: ciclo, nível, a pasta Clientes, nome repetido, arquivada e conta de máquina', async () => {
    const a = await pasta(CASA, 'A');
    const a1 = await pasta(CASA, 'A1', a);
    const a11 = await pasta(CASA, 'A11', a1);
    const b = await pasta(CASA, 'B');
    const b1 = await pasta(CASA, 'B1', b);
    expect(await erro(() => svc.moverPasta(CASA, EU, a, { parentId: a11 }))).toEqual({ status: 400, mensagem: TRAB_PASTA_EM_CICLO });
    expect(await erro(() => svc.moverPasta(CASA, EU, a, { parentId: a }))).toEqual({ status: 400, mensagem: TRAB_PASTA_EM_CICLO });
    // A tem altura 3: dentro de B1 (nível 2) daria 5 níveis.
    expect(await erro(() => svc.moverPasta(CASA, EU, a, { parentId: b1 }))).toEqual({ status: 400, mensagem: TRAB_PASTA_FUNDA_DEMAIS });
    // O PATCH de sempre também confere o nível (o mesmo caminho do serviço).
    expect(await erro(() => svc.editarPasta(CASA, EU, a, { parentId: b1 }))).toEqual({ status: 400, mensagem: TRAB_PASTA_FUNDA_DEMAIS });
    expect(await erro(() => svc.moverPasta(CASA, EU, a, { parentId: b }))).toEqual({ status: 0, mensagem: 'ok' });

    const clientes = await pasta(CASA, 'Clientes');
    await lista(CASA, clientes, 'Onboarding de cliente');
    const c = await pasta(CASA, 'C');
    expect(await erro(() => svc.moverPasta(CASA, EU, clientes, { parentId: c }))).toEqual({ status: 400, mensagem: TRAB_PASTA_DA_IMPLANTACAO_PROTEGIDA });
    // Outra pasta pode entrar em Clientes.
    expect(await erro(() => svc.moverPasta(CASA, EU, c, { parentId: clientes }))).toEqual({ status: 0, mensagem: 'ok' });

    await pasta(CASA, 'Relatórios', b);
    const solta = await pasta(CASA, 'relatorios');
    expect(await erro(() => svc.moverPasta(CASA, EU, solta, { parentId: b }))).toEqual({ status: 409, mensagem: TRAB_NOME_DE_PASTA_REPETIDO });

    const guardada = await pasta(CASA, 'Guardada', null, new Date());
    expect((await erro(() => svc.moverPasta(CASA, EU, solta, { parentId: guardada }))).status).toBe(404);
    expect((await erro(() => svc.moverPasta(CASA, EU, guardada, { parentId: b }))).status).toBe(404);
    expect(await erro(() => svc.moverPasta(CASA, MAQUINA, solta, { parentId: b }))).toEqual({ status: 403, mensagem: RECUSA_DE_MAQUINA_NO_TRABALHO });
    expect(await erro(() => svc.editarPasta(CASA, MAQUINA, solta, { parentId: c }))).toEqual({ status: 403, mensagem: RECUSA_DE_MAQUINA_NO_TRABALHO });
    // Outra empresa não move a pasta daqui.
    expect((await erro(() => svc.moverPasta(VIZINHA, ELA, solta, { parentId: null }))).status).toBe(404);
  });

  it('campos ao mover tarefas: mesmo nome e tipo vão juntos; o resto fica guardado e a origem é arquivada ao sair', async () => {
    const sai = await lista(CASA, null, 'Sai', ['Tarefa 1', 'Tarefa 2']);
    const fica = await lista(CASA, null, 'Fica');
    const fase = await prisma.workField.create({ data: { orgId: CASA, listId: sai.id, name: 'Fase', type: 'drop_down', options: { create: [{ name: 'Análise' }, { name: 'Só na origem' }] } }, include: { options: true } });
    const obs = await prisma.workField.create({ data: { orgId: CASA, listId: sai.id, name: 'Observação', type: 'texto' } });
    const horas = await prisma.workField.create({ data: { orgId: CASA, listId: sai.id, name: 'Horas', type: 'numero' } });
    const faseDest = await prisma.workField.create({ data: { orgId: CASA, listId: fica.id, name: 'fase', type: 'drop_down', options: { create: [{ name: 'analise' }] } }, include: { options: true } });
    const obsDest = await prisma.workField.create({ data: { orgId: CASA, listId: fica.id, name: 'OBSERVACAO', type: 'texto' } });
    await prisma.workField.create({ data: { orgId: CASA, listId: fica.id, name: 'Horas', type: 'texto' } });
    const [t1, t2] = sai.tarefas;
    const analise = fase.options.find((o) => o.name === 'Análise')!;
    const soNaOrigem = fase.options.find((o) => o.name === 'Só na origem')!;
    await prisma.workFieldValue.createMany({
      data: [
        { orgId: CASA, taskId: t1, fieldId: fase.id, optionId: analise.id },
        { orgId: CASA, taskId: t1, fieldId: obs.id, value: 'ligar antes' },
        { orgId: CASA, taskId: t1, fieldId: horas.id, value: '3' },
        { orgId: CASA, taskId: t2, fieldId: fase.id, optionId: soNaOrigem.id },
      ],
    });

    const r = await svc.moverTarefasDaLista(CASA, EU, sai.id, { destinoId: fica.id, esperadas: 2 });
    expect(r).toMatchObject({ movidas: 2, camposCopiados: 2, camposGuardados: 2 });
    const valores = await prisma.workFieldValue.findMany({ where: { taskId: { in: [t1, t2] } }, select: { taskId: true, fieldId: true, optionId: true, value: true } });
    expect(valores).toEqual(expect.arrayContaining([
      { taskId: t1, fieldId: faseDest.id, optionId: faseDest.options[0].id, value: null },
      { taskId: t1, fieldId: obsDest.id, optionId: null, value: 'ligar antes' },
      { taskId: t1, fieldId: horas.id, optionId: null, value: '3' },
      { taskId: t2, fieldId: fase.id, optionId: soNaOrigem.id, value: null },
    ]));
    expect(valores).toHaveLength(4);
    const linha = await prisma.auditLog.findFirstOrThrow({ where: { orgId: CASA, action: 'work.list.tasks.move', entityId: sai.id } });
    expect(linha.after).toMatchObject({ camposCopiados: 2, camposGuardados: 2 });
    const daTarefa = await prisma.auditLog.findFirstOrThrow({ where: { orgId: CASA, action: 'work.task.update', entityId: t1 } });
    expect((daTarefa.after as { camposCopiados?: unknown[] }).camposCopiados).toHaveLength(2);
    // Com valores guardados, a origem é arquivada (não apagada) ao sair.
    expect((await svc.apagarLista(CASA, EU, sai.id, { confirmarNome: 'Sai' })).modo).toBe('arquivada');
  });

  it('campos ao mover: tudo com equivalente vai junto, e a origem sai apagada', async () => {
    const sai = await lista(CASA, null, 'Origem', ['Única']);
    const fica = await lista(CASA, null, 'Destino');
    const obs = await prisma.workField.create({ data: { orgId: CASA, listId: sai.id, name: 'Observação', type: 'texto' } });
    await prisma.workField.create({ data: { orgId: CASA, listId: fica.id, name: 'Observação', type: 'texto' } });
    await prisma.workFieldValue.create({ data: { orgId: CASA, taskId: sai.tarefas[0], fieldId: obs.id, value: 'x' } });
    expect(await svc.moverTarefasDaLista(CASA, EU, sai.id, { destinoId: fica.id, esperadas: 1 })).toMatchObject({ camposCopiados: 1, camposGuardados: 0 });
    expect((await svc.apagarLista(CASA, EU, sai.id, { confirmarNome: 'Origem' })).modo).toBe('apagada');
  });
});
