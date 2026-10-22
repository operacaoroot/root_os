import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  LISTA_DA_IMPLANTACAO, PASTA_DA_IMPLANTACAO, PORTA_DA_IMPLANTACAO, TRAB_CARD_DA_IMPLANTACAO_NAO_DUPLICA,
  TRAB_CARD_DA_IMPLANTACAO_NAO_MESCLA, TRAB_DIAS_NA_LIXEIRA, TRAB_FRASE_DE_APAGAR_DE_VEZ, TRAB_NA_LIXEIRA,
  TRAB_SLUG_DA_ROTINA_DO_EXPURGO, TRAB_TIPO_DA_ROTINA_DO_EXPURGO, TrabLixeiraApagarDeVezSchema, TrabTarefaMoverSchema,
  expiraNaLixeiraEm, fraseDeApagarDeVezConfere,
} from '@mktos/shared';
import { AuditService } from '../src/audit/audit.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { CheckoutDeTarefaService } from '../src/work/checkout-de-tarefa.service';
import { WorkService } from '../src/work/work.service';
import { LixeiraService } from '../src/work/lixeira/lixeira.service';
import { LixeiraController } from '../src/work/lixeira/lixeira.controller';
import { linhaDoArquivamento } from '../src/work/lixeira/regras-da-lixeira';
import { AcoesDaTarefaService } from '../src/work/menu-da-tarefa/acoes-da-tarefa.service';
import { SoGenteNoTrabalhoGuard } from '../src/work/so-gente-no-trabalho.guard';
import { PERMISSIONS_KEY } from '../src/auth/permissions.decorator';
import { MODULO_DO_TIPO } from '../src/routines/rotina.tipos';
import { restaurarTarefas } from '../src/scripts/restaurar-tarefas';
import { LISTA_DO_COMERCIAL } from '../src/work/lista-do-comercial';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * A LIXEIRA E O MENU DA TAREFA (rodada de produção 3, I2 e I4, 22/10/2026).
 *
 *  1. sem banco: a frase, o prazo, a linha que diz quando a tarefa foi arquivada,
 *     os guardas e as permissões das rotas novas, a rotina do expurgo no Trabalho;
 *  2. contra o Postgres: excluir some de toda listagem (e do filtro de arquivadas),
 *     restaurar volta à lista e etapa (com aviso de lista arquivada), editar na
 *     Lixeira = 409, a Lixeira lista o certo com quem e quando, apagar de vez só
 *     com admin e a frase (o card da implantação nunca), expurgo e a rotina que
 *     nasce desligada, o script (simular, valer, idempotente), e o menu: mover
 *     (listas proibidas), duplicar e mesclar (o que migra, origem arquivada,
 *     recusa do card), tudo de gente e sem alcançar outra empresa.
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

describe('I2/I4: as regras sem banco', () => {
  it('a frase de apagar de vez e o prazo da Lixeira', () => {
    expect(TRAB_FRASE_DE_APAGAR_DE_VEZ).toBe('apagar de vez');
    expect(fraseDeApagarDeVezConfere('  Apagar  de VEZ ')).toBe(true);
    expect(fraseDeApagarDeVezConfere('apagar')).toBe(false);
    expect(fraseDeApagarDeVezConfere(undefined)).toBe(false);
    expect(TRAB_DIAS_NA_LIXEIRA).toBe(30);
    expect(expiraNaLixeiraEm(new Date('2026-10-22T00:00:00Z')).toISOString()).toBe('2026-11-21T00:00:00.000Z');
    expect(TrabLixeiraApagarDeVezSchema.safeParse({ ids: [], frase: 'apagar de vez' }).success).toBe(false);
    expect(TrabTarefaMoverSchema.safeParse({ listId: 'x', expectedUpdatedAt: 'y' }).success).toBe(false);
  });

  it('quando a tarefa foi arquivada: a linha com archived, senão a do importador, senão a última edição', () => {
    const l = (action: string, after: unknown, min: number) => ({ entityId: 't', action, actorId: 'u', createdAt: new Date(Date.UTC(2026, 9, 21, 22, min)), after: after as never });
    const edicaoDepois = l('work.task.update', { title: 'x' }, 59);
    const arquivou = l('work.task.update', { archived: true }, 56);
    expect(linhaDoArquivamento([edicaoDepois, arquivou])).toBe(arquivou);
    const importador = l('importacao.crm.cartao_arquivado', { marca: 'importacao.crm' }, 10);
    expect(linhaDoArquivamento([edicaoDepois, importador])).toBe(importador);
    expect(linhaDoArquivamento([edicaoDepois])).toBe(edicaoDepois);
    expect(linhaDoArquivamento([])).toBeNull();
  });

  it('as rotas novas são de gente; apagar de vez pede admin.usuarios; a rotina do expurgo é do Trabalho', () => {
    const guardas = Reflect.getMetadata('__guards__', LixeiraController) as unknown[];
    expect(guardas).toContain(SoGenteNoTrabalhoGuard);
    for (const m of ['listar', 'restaurar', 'excluir', 'mover', 'duplicar', 'mesclar'] as const) {
      expect(Reflect.getMetadata(PERMISSIONS_KEY, LixeiraController.prototype[m])).toEqual(['tarefas.editar']);
    }
    expect(Reflect.getMetadata(PERMISSIONS_KEY, LixeiraController.prototype.apagarDeVez)).toEqual(['tarefas.editar', 'admin.usuarios']);
    expect(MODULO_DO_TIPO[TRAB_TIPO_DA_ROTINA_DO_EXPURGO]).toBe('trabalho');
  });
});

const URL = process.env.TEST_DATABASE_URL;
const CASA = 'org-teste-lixeira-casa';
const VIZINHA = 'org-teste-lixeira-vizinha';
const EMPRESAS = [CASA, VIZINHA];
const EU = 'u-lixeira-eu';
const ADMIN = 'u-lixeira-admin';
const MAQUINA = 'u-lixeira-maquina';
const ELA = 'u-lixeira-vizinha';

exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (duas empresas, pastas, listas, tarefas, comentários, anexos, rotinas e auditoria)');

describe.skipIf(!URL)('I2/I4: contra o Postgres', () => {
  let prisma: PrismaClient;
  let work: WorkService;
  let lixeira: LixeiraService;
  let acoes: AcoesDaTarefaService;

  async function limpar(tentativa = 1): Promise<void> {
    try {
      await prisma.auditLog.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.rotina.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workTask.updateMany({ where: { orgId: { in: EMPRESAS } }, data: { parentId: null } });
      await prisma.workTask.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workField.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workTag.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workStatus.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workList.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workFolder.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    } catch (e) {
      if (tentativa < 4 && /40P01|deadlock/.test(String((e as Error).message))) return limpar(tentativa + 1);
      throw e;
    }
  }

  async function lista(orgId: string, folderId: string | null, name: string, titulos: string[] = [], extra: { arquivadaEm?: Date | null; externalId?: string; natureza?: 'tarefas' | 'cadastro' } = {}) {
    const l = await prisma.workList.create({ data: { orgId, folderId, name, ...extra } });
    const aFazer = await prisma.workStatus.create({ data: { orgId, listId: l.id, name: 'A fazer', type: 'open', order: 0 } });
    const feito = await prisma.workStatus.create({ data: { orgId, listId: l.id, name: 'Feito', type: 'closed', order: 1 } });
    const ids: string[] = [];
    for (const title of titulos) ids.push((await prisma.workTask.create({ data: { orgId, listId: l.id, statusId: aFazer.id, title } })).id);
    return { id: l.id, tarefas: ids, aFazer: aFazer.id, feito: feito.id };
  }

  const versao = async (id: string) => (await prisma.workTask.findUniqueOrThrow({ where: { id } })).updatedAt.toISOString();
  const titulos = (r: { items: { title: string }[] }) => r.items.map((t) => t.title).sort();

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: URL } } });
    await prisma.$connect();
    const p = prisma as unknown as PrismaService;
    const audit = new AuditService(p);
    work = new WorkService(p, audit, new CheckoutDeTarefaService(p, audit, new EventLogService(p)));
    lixeira = new LixeiraService(p, audit);
    acoes = new AcoesDaTarefaService(p, audit, work);
    for (const orgId of EMPRESAS) await prisma.org.upsert({ where: { id: orgId }, create: { id: orgId, name: orgId, slug: orgId }, update: {} });
    const perm = async (key: string) => prisma.permission.upsert({ where: { key }, create: { key }, update: {}, select: { id: true } });
    const comuns = [await perm('tarefas.ver'), await perm('tarefas.editar')];
    const admin = [...comuns, await perm('admin.usuarios')];
    for (const [user, key, orgId, permissoes] of [
      [EU, 'analista', CASA, comuns], [ADMIN, 'admin_master', CASA, admin], [MAQUINA, 'ia_acao', CASA, admin], [ELA, 'analista', VIZINHA, comuns],
    ] as const) {
      const papel = await prisma.role.upsert({
        where: { orgId_key: { orgId, key } },
        create: { orgId, key, name: key, permissions: { connect: [...permissoes] } },
        update: { permissions: { connect: [...permissoes] } },
        select: { id: true },
      });
      await prisma.user.upsert({
        where: { id: user },
        create: { id: user, orgId, name: `Pessoa ${user}`, email: `${user}@teste.local`, passwordHash: 'x', roles: { connect: { id: papel.id } } },
        update: { roles: { connect: { id: papel.id } }, isActive: true },
      });
    }
  });

  beforeEach(limpar);

  afterAll(async () => {
    await limpar();
    await prisma.user.deleteMany({ where: { id: { in: [EU, ADMIN, MAQUINA, ELA] } } });
    await prisma.role.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    await prisma.org.deleteMany({ where: { id: { in: EMPRESAS } } });
    await prisma.$disconnect();
  });

  it('excluir tira de toda listagem (também do filtro de arquivadas) e restaurar devolve à lista e à etapa', async () => {
    const l = await lista(CASA, null, 'Operação', ['Pagar boleto', 'Ligar para o fornecedor']);
    const [boleto] = l.tarefas;
    await prisma.workTask.update({ where: { id: boleto }, data: { statusId: l.feito } });

    const r = await lixeira.excluir(CASA, EU, boleto, { expectedUpdatedAt: await versao(boleto) });
    expect(new Date(r.expiraEm).getTime() - new Date(r.excluidaEm).getTime()).toBe(30 * 24 * 3600_000);
    const gravada = await prisma.workTask.findUniqueOrThrow({ where: { id: boleto } });
    expect(gravada).toMatchObject({ archived: true, excluidaPor: EU, listId: l.id, statusId: l.feito });

    expect(titulos(await work.tarefas(CASA, { listId: l.id }))).toEqual(['Ligar para o fornecedor']);
    expect(titulos(await work.tarefas(CASA, { listId: l.id, arquivadas: true }))).toEqual(['Ligar para o fornecedor']);
    expect(titulos(await work.tarefas(CASA, { todas: true }))).toEqual(['Ligar para o fornecedor']);
    const estrutura = await work.estrutura(CASA);
    expect(estrutura.listasSoltas.find((x) => x.id === l.id)?.total).toBe(1);
    // A leitura por id continua, e diz que está na Lixeira.
    expect((await work.tarefa(CASA, boleto)).excluidaEm).toBe(gravada.excluidaEm!.toISOString());
    // Na Lixeira não se edita nem se comenta.
    expect(await erro(() => work.editarTarefaHttp(CASA, EU, boleto, { title: 'x', expectedUpdatedAt: gravada.updatedAt.toISOString() } as never)))
      .toEqual({ status: 409, mensagem: TRAB_NA_LIXEIRA });
    expect((await erro(() => work.comentar(CASA, EU, boleto, 'oi'))).status).toBe(409);
    // Excluir de novo não muda nada.
    expect((await lixeira.excluir(CASA, EU, boleto)).excluidaEm).toBe(r.excluidaEm);

    const volta = await lixeira.restaurar(CASA, EU, [boleto]);
    expect(volta).toEqual({ restauradas: 1, ids: [boleto], jaVivas: 0, avisos: [] });
    expect(await prisma.workTask.findUniqueOrThrow({ where: { id: boleto } })).toMatchObject({ archived: false, excluidaEm: null, excluidaPor: null, listId: l.id, statusId: l.feito });
    expect(titulos(await work.tarefas(CASA, { listId: l.id }))).toEqual(['Ligar para o fornecedor', 'Pagar boleto']);
    const acoesAuditadas = (await prisma.auditLog.findMany({ where: { orgId: CASA, entityId: boleto }, orderBy: { createdAt: 'asc' } })).map((a) => a.action);
    expect(acoesAuditadas).toEqual(['work.task.trash', 'work.task.restore']);
  });

  it('restaurar tarefa de lista arquivada: volta e a resposta avisa; arquivada também se restaura', async () => {
    const l = await lista(CASA, null, 'CRM antigo', ['Cartão A', 'Cartão B'], { arquivadaEm: new Date() });
    await prisma.workTask.updateMany({ where: { listId: l.id }, data: { archived: true } });
    const [a, b] = l.tarefas;
    await lixeira.excluir(CASA, EU, a);
    const r = await lixeira.restaurar(CASA, EU, [a, b]);
    expect(r.restauradas).toBe(2);
    expect(r.avisos).toEqual(['A lista CRM antigo continua arquivada: 2 tarefas voltaram, mas só aparecem quando a lista for desarquivada.']);
    expect(await prisma.workTask.count({ where: { listId: l.id, archived: false, excluidaEm: null } })).toBe(2);
    // Restaurar o que já está vivo não escreve nada.
    expect(await lixeira.restaurar(CASA, EU, [a])).toMatchObject({ restauradas: 0, jaVivas: 1 });
  });

  it('a Lixeira lista excluídas e arquivadas com quando, por quem, de onde e o card da implantação', async () => {
    const clientes = (await prisma.workFolder.create({ data: { orgId: CASA, name: PASTA_DA_IMPLANTACAO } })).id;
    const impl = await lista(CASA, clientes, LISTA_DA_IMPLANTACAO, ['Cliente X']);
    const op = await lista(CASA, null, 'Operação', ['Revisar contrato', 'Viva']);
    // Arquivada pela tela antes de 22/10: a linha não diz archived; a última edição é a hora.
    await prisma.workTask.update({ where: { id: impl.tarefas[0] }, data: { archived: true } });
    await prisma.auditLog.create({ data: { orgId: CASA, actorId: EU, action: 'work.task.update', entityType: 'work_task', entityId: impl.tarefas[0], createdAt: new Date('2026-10-21T22:56:00Z') } });
    await lixeira.excluir(CASA, ADMIN, op.tarefas[0]);

    const tudo = await lixeira.listar(CASA, EU);
    expect(tudo.total).toBe(2);
    const card = tudo.tarefas.find((t) => t.id === impl.tarefas[0])!;
    expect(card).toMatchObject({
      estado: 'arquivada', em: '2026-10-21T22:56:00.000Z', por: { id: EU, nome: `Pessoa ${EU}` },
      lista: { id: impl.id, name: LISTA_DA_IMPLANTACAO, arquivada: false }, pasta: { id: clientes, name: PASTA_DA_IMPLANTACAO },
      status: { name: 'A fazer' }, expiraEm: null, cardDaImplantacao: true,
    });
    expect(tudo.tarefas.find((t) => t.id === op.tarefas[0])).toMatchObject({ estado: 'excluida', por: { id: ADMIN }, cardDaImplantacao: false });
    expect((await lixeira.listar(CASA, EU, { estado: 'excluida' })).tarefas.map((t) => t.id)).toEqual([op.tarefas[0]]);
    expect((await lixeira.listar(CASA, EU, { q: 'cliente' })).tarefas.map((t) => t.id)).toEqual([impl.tarefas[0]]);
    // A outra empresa não vê nada daqui.
    expect((await lixeira.listar(VIZINHA, ELA)).total).toBe(0);
    expect((await erro(() => lixeira.restaurar(VIZINHA, ELA, [op.tarefas[0]]))).status).toBe(404);
    // A rotina do expurgo nasce desligada, na primeira leitura.
    const rotina = await prisma.rotina.findUniqueOrThrow({ where: { orgId_slug: { orgId: CASA, slug: TRAB_SLUG_DA_ROTINA_DO_EXPURGO } } });
    expect(rotina).toMatchObject({ tipo: TRAB_TIPO_DA_ROTINA_DO_EXPURGO, ativo: false, estado: 'planejado' });
    expect(tudo.expurgo).toEqual({ rotinaId: rotina.id, ligado: false });
    expect((await lixeira.listar(CASA, EU)).expurgo).toEqual({ rotinaId: rotina.id, ligado: false });
  });

  it('apagar de vez: só admin, só com a frase, só a excluída, nunca o card; conta de máquina não', async () => {
    const clientes = (await prisma.workFolder.create({ data: { orgId: CASA, name: PASTA_DA_IMPLANTACAO } })).id;
    const impl = await lista(CASA, clientes, LISTA_DA_IMPLANTACAO, ['Cliente Y']);
    const op = await lista(CASA, null, 'Operação', ['Lixo', 'Arquivada só']);
    const [lixo, soArquivada] = op.tarefas;
    await prisma.workComment.create({ data: { taskId: lixo, authorName: 'x', text: 'comentário' } });
    await lixeira.excluir(CASA, EU, lixo);
    await lixeira.excluir(CASA, EU, impl.tarefas[0]);
    await prisma.workTask.update({ where: { id: soArquivada }, data: { archived: true } });

    expect((await erro(() => lixeira.apagarDeVez(CASA, EU, [lixo], TRAB_FRASE_DE_APAGAR_DE_VEZ))).status).toBe(403);
    expect((await erro(() => lixeira.apagarDeVez(CASA, MAQUINA, [lixo], TRAB_FRASE_DE_APAGAR_DE_VEZ))).status).toBe(403);
    expect((await erro(() => lixeira.apagarDeVez(CASA, ADMIN, [lixo], 'apagar'))).status).toBe(400);
    const r = await lixeira.apagarDeVez(CASA, ADMIN, [lixo, soArquivada, impl.tarefas[0]], 'Apagar de vez');
    expect(r.apagadas).toBe(1);
    expect(r.ids).toEqual([lixo]);
    expect(r.presas.map((p) => p.id).sort()).toEqual([impl.tarefas[0], soArquivada].sort());
    expect(await prisma.workTask.count({ where: { id: lixo } })).toBe(0);
    expect(await prisma.workComment.count({ where: { taskId: lixo } })).toBe(0);
    expect(await prisma.workTask.count({ where: { id: { in: [soArquivada, impl.tarefas[0]] } } })).toBe(2);
    const purge = await prisma.auditLog.findFirstOrThrow({ where: { orgId: CASA, action: 'work.task.purge', entityId: lixo } });
    expect(purge.actorId).toBe(ADMIN);
    expect(JSON.stringify(purge.before)).not.toContain('Lixo');
  });

  it('expurgo: só as excluídas há mais de 30 dias, como sistema', async () => {
    const op = await lista(CASA, null, 'Operação', ['Velha', 'Nova']);
    const agora = new Date('2026-12-01T12:00:00Z');
    await prisma.workTask.update({ where: { id: op.tarefas[0] }, data: { archived: true, excluidaEm: new Date('2026-10-20T00:00:00Z') } });
    await prisma.workTask.update({ where: { id: op.tarefas[1] }, data: { archived: true, excluidaEm: new Date('2026-11-25T00:00:00Z') } });
    const r = await lixeira.expurgo(CASA, agora);
    expect(r.status).toBe('ok');
    expect(await prisma.workTask.findMany({ where: { listId: op.id }, select: { id: true } })).toEqual([{ id: op.tarefas[1] }]);
    const linha = await prisma.auditLog.findFirstOrThrow({ where: { orgId: CASA, action: 'work.task.purge' } });
    expect(linha).toMatchObject({ actorType: 'system', actorId: null });
    expect((await lixeira.expurgo(CASA, agora)).status).toBe('pulada');
  });

  it('o script: simula, vale, e a segunda passada dá zero; --como precisa ser gente com tarefas.editar', async () => {
    const clientes = (await prisma.workFolder.create({ data: { orgId: CASA, name: PASTA_DA_IMPLANTACAO } })).id;
    const impl = await lista(CASA, clientes, LISTA_DA_IMPLANTACAO, ['C1', 'C2', 'C3']);
    const [c1, c2, c3] = impl.tarefas;
    await prisma.workTask.updateMany({ where: { id: { in: impl.tarefas } }, data: { archived: true } });
    await prisma.auditLog.create({ data: { orgId: CASA, actorId: EU, action: 'work.task.update', entityType: 'work_task', entityId: c1, createdAt: new Date('2026-10-21T22:56:00Z') } });
    await prisma.auditLog.create({ data: { orgId: CASA, actorId: EU, action: 'work.task.update', entityType: 'work_task', entityId: c2, createdAt: new Date('2026-10-21T22:57:00Z'), after: { archived: true } } });
    await prisma.auditLog.create({ data: { orgId: CASA, actorId: EU, action: 'work.task.update', entityType: 'work_task', entityId: c3, createdAt: new Date('2026-10-20T10:00:00Z') } });
    await prisma.workTask.update({ where: { id: c3 }, data: { updatedAt: new Date('2026-10-20T10:00:00Z') } });
    const pedido = { org: CASA, listaId: impl.id, de: new Date('2026-10-21T22:30:00Z'), ate: new Date('2026-10-21T23:10:00Z'), como: `${EU}@teste.local` };

    const simulado = await restaurarTarefas(prisma, { ...pedido, valer: false });
    expect(simulado).toMatchObject({ modo: 'simular', arquivadasNaLista: 3, noIntervalo: 2, restauradas: 0, listaArquivada: false });
    expect(simulado.ids.sort()).toEqual([c1.slice(0, 8), c2.slice(0, 8)].sort());
    expect(await prisma.workTask.count({ where: { listId: impl.id, archived: false } })).toBe(0);

    const valeu = await restaurarTarefas(prisma, { ...pedido, valer: true });
    expect(valeu).toMatchObject({ modo: 'valer', noIntervalo: 2, restauradas: 2 });
    expect((await prisma.workTask.findMany({ where: { listId: impl.id, archived: false }, select: { id: true } })).map((t) => t.id).sort()).toEqual([c1, c2].sort());
    expect(await prisma.auditLog.count({ where: { orgId: CASA, action: 'work.task.restore', actorId: EU } })).toBe(2);

    expect(await restaurarTarefas(prisma, { ...pedido, valer: true })).toMatchObject({ noIntervalo: 0, restauradas: 0 });
    expect(await restaurarTarefas(prisma, { ...pedido, valer: false })).toMatchObject({ noIntervalo: 0, restauradas: 0 });
    await expect(restaurarTarefas(prisma, { ...pedido, como: `${MAQUINA}@teste.local`, valer: true })).rejects.toThrow(/máquina/);
    await expect(restaurarTarefas(prisma, { ...pedido, como: `${ELA}@teste.local`, valer: true })).rejects.toThrow(/não é um usuário ativo/);
  });

  it('mover pelo menu: lista e etapa, recusando arquivada, cadastro, comercial e implantação', async () => {
    const op = await lista(CASA, null, 'Operação', ['Tarefa']);
    const destino = await lista(CASA, null, 'Marketing');
    const arquivada = await lista(CASA, null, 'Velha', [], { arquivadaEm: new Date() });
    const cadastro = await lista(CASA, null, 'Cadastro', [], { natureza: 'cadastro' });
    const comercial = await lista(CASA, null, 'Tarefas do comercial', [], { externalId: LISTA_DO_COMERCIAL });
    const clientes = (await prisma.workFolder.create({ data: { orgId: CASA, name: PASTA_DA_IMPLANTACAO } })).id;
    const impl = await lista(CASA, clientes, LISTA_DA_IMPLANTACAO);
    const t = op.tarefas[0];
    for (const proibida of [arquivada.id, cadastro.id, comercial.id]) {
      expect((await erro(() => acoes.mover(CASA, EU, t, { listId: proibida, expectedUpdatedAt: '2026-10-22T00:00:00.000Z' }))).status).toBe(400);
    }
    expect(await erro(() => acoes.mover(CASA, EU, t, { listId: impl.id, expectedUpdatedAt: '2026-10-22T00:00:00.000Z' }))).toEqual({ status: 400, mensagem: PORTA_DA_IMPLANTACAO });
    const v0 = await versao(t);
    expect((await erro(() => acoes.mover(CASA, MAQUINA, t, { listId: destino.id, expectedUpdatedAt: v0 }))).status).toBe(403);
    const movida = await acoes.mover(CASA, EU, t, { listId: destino.id, statusId: destino.feito, expectedUpdatedAt: await versao(t) });
    expect(movida).toMatchObject({ listId: destino.id, statusId: destino.feito });
    expect((await erro(() => acoes.mover(VIZINHA, ELA, t, { listId: destino.id, expectedUpdatedAt: v0 }))).status).toBe(404);
  });

  it('duplicar: mesma lista e etapa, "cópia de", etiquetas e campos; sem comentários; o card não', async () => {
    const op = await lista(CASA, null, 'Operação', ['Revisar contrato']);
    const t = op.tarefas[0];
    const tag = await prisma.workTag.create({ data: { orgId: CASA, name: 'urgente' } });
    const campo = await prisma.workField.create({ data: { orgId: CASA, listId: op.id, name: 'Observação', type: 'texto' } });
    await prisma.workTask.update({ where: { id: t }, data: { statusId: op.feito, description: 'detalhe', tags: { connect: { id: tag.id } } } });
    await prisma.workFieldValue.create({ data: { taskId: t, fieldId: campo.id, value: 'valor' } });
    await prisma.workComment.create({ data: { taskId: t, authorName: 'x', text: 'não vai junto' } });

    const copia = await acoes.duplicar(CASA, EU, t);
    expect(copia.title).toBe('cópia de Revisar contrato');
    const nova = await prisma.workTask.findUniqueOrThrow({ where: { id: copia.id }, include: { tags: true, values: true, comments: true } });
    expect(nova).toMatchObject({ listId: op.id, statusId: op.feito, description: 'detalhe', archived: false });
    expect(nova.tags.map((x) => x.id)).toEqual([tag.id]);
    expect(nova.values.map((v) => v.value)).toEqual(['valor']);
    expect(nova.comments).toEqual([]);
    expect(await prisma.auditLog.count({ where: { orgId: CASA, action: 'work.task.create', entityId: copia.id } })).toBe(1);

    const clientes = (await prisma.workFolder.create({ data: { orgId: CASA, name: PASTA_DA_IMPLANTACAO } })).id;
    const impl = await lista(CASA, clientes, LISTA_DA_IMPLANTACAO, ['Cliente Z']);
    expect(await erro(() => acoes.duplicar(CASA, EU, impl.tarefas[0]))).toEqual({ status: 400, mensagem: TRAB_CARD_DA_IMPLANTACAO_NAO_DUPLICA });
    expect((await erro(() => acoes.duplicar(CASA, MAQUINA, t))).status).toBe(403);
  });

  it('mesclar: comentários, anexos e subtarefas mudam; etiquetas e campos são copiados; a origem é arquivada com o link', async () => {
    const op = await lista(CASA, null, 'Operação', ['Origem', 'Destino', 'Filha']);
    const [origem, destino, filha] = op.tarefas;
    const tagA = await prisma.workTag.create({ data: { orgId: CASA, name: 'a' } });
    const tagB = await prisma.workTag.create({ data: { orgId: CASA, name: 'b' } });
    const obs = await prisma.workField.create({ data: { orgId: CASA, listId: op.id, name: 'Observação', type: 'texto' } });
    const fase = await prisma.workField.create({ data: { orgId: CASA, listId: op.id, name: 'Fase', type: 'texto' } });
    await prisma.workTask.update({ where: { id: origem }, data: { tags: { connect: [{ id: tagA.id }, { id: tagB.id }] } } });
    await prisma.workTask.update({ where: { id: destino }, data: { tags: { connect: [{ id: tagA.id }] } } });
    await prisma.workTask.update({ where: { id: filha }, data: { parentId: origem } });
    await prisma.workFieldValue.create({ data: { taskId: origem, fieldId: obs.id, value: 'da origem' } });
    await prisma.workFieldValue.create({ data: { taskId: origem, fieldId: fase.id, value: 'fase origem' } });
    await prisma.workFieldValue.create({ data: { taskId: destino, fieldId: fase.id, value: 'fase destino' } });
    await prisma.workComment.create({ data: { taskId: origem, authorName: 'x', text: 'primeiro' } });
    await prisma.workComment.create({ data: { taskId: origem, authorName: 'x', text: 'segundo' } });
    await prisma.workAnexo.create({ data: { taskId: origem, nome: 'a.pdf', tipoMime: 'application/pdf', bytes: 10, sha256: 'a'.repeat(64), chave: 'k', autorNome: 'x' } });

    const r = await acoes.mesclar(CASA, EU, origem, { destinoId: destino, expectedUpdatedAt: await versao(origem) });
    expect(r).toEqual({ origemId: origem, destinoId: destino, comentarios: 2, anexos: 1, subtarefas: 1, etiquetas: 1, campos: 1, camposGuardados: 1 });

    const o = await prisma.workTask.findUniqueOrThrow({ where: { id: origem }, include: { comments: true, values: true } });
    expect(o.archived).toBe(true);
    expect(o.excluidaEm).toBeNull();
    expect(o.comments.map((c) => c.text)).toEqual([`Mesclada em [Destino](/trabalho?lista=${op.id}&tarefa=${destino}).`]);
    // Nada sai da origem além do que muda de dono: os campos ficam nela também.
    expect(o.values).toHaveLength(2);
    const d = await prisma.workTask.findUniqueOrThrow({ where: { id: destino }, include: { comments: true, tags: true, values: true, anexos: true, subtasks: true } });
    expect(d.comments.map((c) => c.text).sort()).toEqual(['primeiro', 'segundo', expect.stringContaining('Recebeu a tarefa mesclada [Origem]')].sort());
    expect(d.tags.map((t) => t.name).sort()).toEqual(['a', 'b']);
    expect(d.values.map((v) => v.value).sort()).toEqual(['da origem', 'fase destino']);
    expect(d.anexos.map((a) => a.nome)).toEqual(['a.pdf']);
    expect(d.subtasks.map((s) => s.id)).toEqual([filha]);
    expect(await prisma.auditLog.count({ where: { orgId: CASA, action: 'work.task.merge' } })).toBe(2);

    // Origem já arquivada, card da implantação, máquina e outra empresa: recusa.
    expect((await erro(() => acoes.mesclar(CASA, EU, origem, { destinoId: destino }))).status).toBe(400);
    const clientes = (await prisma.workFolder.create({ data: { orgId: CASA, name: PASTA_DA_IMPLANTACAO } })).id;
    const impl = await lista(CASA, clientes, LISTA_DA_IMPLANTACAO, ['Cliente W']);
    expect(await erro(() => acoes.mesclar(CASA, EU, filha, { destinoId: impl.tarefas[0] }))).toEqual({ status: 400, mensagem: TRAB_CARD_DA_IMPLANTACAO_NAO_MESCLA });
    expect(await erro(() => acoes.mesclar(CASA, EU, impl.tarefas[0], { destinoId: destino }))).toEqual({ status: 400, mensagem: TRAB_CARD_DA_IMPLANTACAO_NAO_MESCLA });
    expect((await erro(() => acoes.mesclar(CASA, MAQUINA, filha, { destinoId: destino }))).status).toBe(403);
    expect((await erro(() => acoes.mesclar(VIZINHA, ELA, filha, { destinoId: destino }))).status).toBe(404);
  });

  it('revisão: mesclar recusa destino abaixo da origem; mover recusa lista da Clientes e tirar o card; o expurgo pula o card', async () => {
    const op = await lista(CASA, null, 'Operação', ['Origem', 'Filha', 'Neta', 'Outra']);
    const [origem, filha, neta, outra] = op.tarefas;
    await prisma.workTask.update({ where: { id: filha }, data: { parentId: origem } });
    await prisma.workTask.update({ where: { id: neta }, data: { parentId: filha } });
    for (const destinoId of [filha, neta]) {
      const r = await erro(() => acoes.mesclar(CASA, EU, origem, { destinoId }));
      expect(r.status).toBe(400);
      expect(r.mensagem).toMatch(/subtarefa desta/);
    }
    expect(await prisma.workTask.findUniqueOrThrow({ where: { id: origem } })).toMatchObject({ archived: false });

    const clientes = (await prisma.workFolder.create({ data: { orgId: CASA, name: PASTA_DA_IMPLANTACAO, doComercial: true } })).id;
    const impl = await lista(CASA, clientes, LISTA_DA_IMPLANTACAO, ['Cliente Z']);
    const esteira = await lista(CASA, clientes, 'Esteira de clientes');
    await prisma.workList.updateMany({ where: { id: { in: [impl.id, esteira.id] } }, data: { doComercial: true } });
    const paraEsteira = await erro(() => acoes.mover(CASA, EU, outra, { listId: esteira.id, expectedUpdatedAt: '2026-10-22T00:00:00.000Z' }));
    expect(paraEsteira.status).toBe(400);
    expect(paraEsteira.mensagem).toMatch(/pasta Clientes/);
    const card = impl.tarefas[0];
    const vCard = await versao(card);
    const tirarCard = await erro(() => acoes.mover(CASA, EU, card, { listId: op.id, expectedUpdatedAt: vCard }));
    expect(tirarCard.status).toBe(400);
    expect(tirarCard.mensagem).toMatch(/card de um cliente da Implantação/);

    const agora = new Date('2026-12-01T12:00:00Z');
    await prisma.workTask.updateMany({ where: { id: { in: [card, outra] } }, data: { archived: true, excluidaEm: new Date('2026-10-20T00:00:00Z') } });
    expect((await lixeira.expurgo(CASA, agora)).status).toBe('ok');
    expect(await prisma.workTask.count({ where: { id: outra } })).toBe(0);
    expect(await prisma.workTask.count({ where: { id: card } })).toBe(1);
    expect((await lixeira.expurgo(CASA, agora)).status).toBe('pulada');
  });
});
