import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  TrabArvoreOrdemSchema, TrabPastaExcluirComDestinoSchema, TrabListaMoverTarefasSchema,
  TRAB_NOME_DE_LISTA_REPETIDO, TRAB_NOME_DE_PASTA_REPETIDO, TRAB_ORDEM_FORA_DO_NIVEL, TRAB_PASTA_DA_IMPLANTACAO_PROTEGIDA,
  PORTA_DA_IMPLANTACAO, chaveDoNomeNoNivel, etapaNoDestino,
} from '@mktos/shared';
import { AuditService } from '../src/audit/audit.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { CheckoutDeTarefaService } from '../src/work/checkout-de-tarefa.service';
import { WorkService } from '../src/work/work.service';
import { WorkController } from '../src/work/work.controller';
import { LISTA_DO_COMERCIAL } from '../src/work/lista-do-comercial';
import { RECUSA_DE_MAQUINA_NO_TRABALHO, SoGenteNoTrabalhoGuard } from '../src/work/so-gente-no-trabalho.guard';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * EDITAR A ÁRVORE DO TRABALHO (adendo da rodada de produção 1, A3, 21/10/2026).
 *
 *  1. sem banco: o nome no nível, a etapa no destino, os corpos das rotas novas e
 *     as rotas de apagar e mover tarefas só de gente;
 *  2. contra o Postgres: criar pasta e lista no fim do nível; renomear com nome
 *     repetido recusado no mesmo nível (sem maiúscula nem acento) e aceito em
 *     outro; apagar pasta vazia; apagar pasta com listas e subpasta levando-as
 *     para outra pasta e para Sem pasta; apagar lista com escolha (mover as
 *     tarefas, ou arquivar e apagar); mover tarefas recusa destino arquivado, do
 *     comercial e de cadastro; reordenar com ids errados = 400; as protegidas;
 *     conta de máquina recusada; outra empresa não alcança.
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

describe('árvore: as regras sem banco', () => {
  it('o nome no nível não vê maiúscula, acento nem espaço sobrando', () => {
    expect(chaveDoNomeNoNivel('  Gestão   Financeira ')).toBe(chaveDoNomeNoNivel('gestao financeira'));
    expect(chaveDoNomeNoNivel('Execução')).toBe(chaveDoNomeNoNivel('EXECUCAO'));
    expect(chaveDoNomeNoNivel('Gestão')).not.toBe(chaveDoNomeNoNivel('Gestor'));
  });

  it('a etapa no destino: mesmo nome, senão o mesmo tipo, senão a primeira', () => {
    const destino = [
      { id: 'a', name: 'Backlog', type: 'open' }, { id: 'b', name: 'Fazendo', type: 'custom' },
      { id: 'c', name: 'Concluída', type: 'closed' },
    ];
    expect(etapaNoDestino({ name: 'fazendo', type: 'open' }, destino)?.id).toBe('b');
    expect(etapaNoDestino({ name: 'Feito', type: 'closed' }, destino)?.id).toBe('c');
    expect(etapaNoDestino({ name: 'Outra', type: 'inexistente' }, destino)?.id).toBe('a');
    expect(etapaNoDestino({ name: 'X', type: 'open' }, [])).toBeNull();
  });

  it('os corpos das rotas novas são estritos', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(TrabPastaExcluirComDestinoSchema.safeParse({ esperadas: { listas: 0, pastas: 0 } }).success).toBe(true);
    expect(TrabPastaExcluirComDestinoSchema.safeParse({ destino: { semPasta: true }, esperadas: { listas: 1, pastas: 0 } }).success).toBe(true);
    expect(TrabPastaExcluirComDestinoSchema.safeParse({ destino: { folderId: id, semPasta: true }, esperadas: { listas: 1, pastas: 0 } }).success).toBe(false);
    expect(TrabPastaExcluirComDestinoSchema.safeParse({ destino: { semPasta: false }, esperadas: { listas: 1, pastas: 0 } }).success).toBe(false);
    expect(TrabPastaExcluirComDestinoSchema.safeParse({}).success).toBe(false);
    expect(TrabListaMoverTarefasSchema.safeParse({ destinoId: id, esperadas: 2 }).success).toBe(true);
    expect(TrabListaMoverTarefasSchema.safeParse({ destinoId: 'x', esperadas: 2 }).success).toBe(false);
    expect(TrabArvoreOrdemSchema.safeParse({ tipo: 'lista', paiId: null, ids: [id] }).success).toBe(true);
    expect(TrabArvoreOrdemSchema.safeParse({ tipo: 'tarefa', paiId: null, ids: [id] }).success).toBe(false);
    expect(TrabArvoreOrdemSchema.safeParse({ tipo: 'pasta', paiId: null, ids: [] }).success).toBe(false);
  });

  it('apagar pasta com destino e mover tarefas são de gente: o guarda está na rota', () => {
    for (const metodo of ['excluirPastaComDestino', 'moverTarefasDaLista'] as const) {
      const guardas = Reflect.getMetadata('__guards__', WorkController.prototype[metodo]) as unknown[];
      expect(guardas).toContain(SoGenteNoTrabalhoGuard);
    }
    const guarda = new SoGenteNoTrabalhoGuard();
    const ctx = (roles: string[]) => ({ switchToHttp: () => ({ getRequest: () => ({ user: { sub: 'u', orgId: 'o', roles } }) }) }) as never;
    expect(() => guarda.canActivate(ctx(['ia_acao']))).toThrow(RECUSA_DE_MAQUINA_NO_TRABALHO);
  });
});

const URL = process.env.TEST_DATABASE_URL;
const CASA = 'org-teste-arvore-casa';
const VIZINHA = 'org-teste-arvore-vizinha';
const EMPRESAS = [CASA, VIZINHA];
const EU = 'u-arvore-casa';
const MAQUINA = 'u-arvore-maquina';

exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (duas empresas, pastas, listas e tarefas)');

describe.skipIf(!URL)('árvore: contra o Postgres', () => {
  let prisma: PrismaClient;
  let svc: WorkService;

  async function limpar(tentativa = 1): Promise<void> {
    try {
      await prisma.auditLog.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workTask.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workStatus.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      await prisma.workList.deleteMany({ where: { orgId: { in: EMPRESAS } } });
      for (let i = 0; i < 4; i++) await prisma.workFolder.deleteMany({ where: { orgId: { in: EMPRESAS }, children: { none: {} } } });
      await prisma.workSpace.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    } catch (e) {
      if (tentativa < 4 && /40P01|deadlock/.test(String((e as Error).message))) return limpar(tentativa + 1);
      throw e;
    }
  }

  async function pasta(orgId: string, name: string, parentId: string | null = null, order = 0) {
    return (await prisma.workFolder.create({ data: { orgId, name, parentId, order } })).id;
  }

  async function lista(orgId: string, folderId: string | null, nome: string, titulos: string[] = [], extra: { natureza?: 'tarefas' | 'cadastro'; externalId?: string; order?: number } = {}) {
    const l = await prisma.workList.create({ data: { orgId, folderId, name: nome, ...extra } });
    const etapas = [
      await prisma.workStatus.create({ data: { orgId, listId: l.id, name: 'A fazer', type: 'open', order: 0 } }),
      await prisma.workStatus.create({ data: { orgId, listId: l.id, name: 'Fazendo', type: 'custom', order: 1 } }),
    ];
    const ids: string[] = [];
    for (const [i, title] of titulos.entries()) {
      ids.push((await prisma.workTask.create({ data: { orgId, listId: l.id, statusId: etapas[i % 2].id, title } })).id);
    }
    return { id: l.id, tarefas: ids, etapas: etapas.map((e) => e.id) };
  }

  const arvore = async () => {
    const e = await svc.estrutura(CASA);
    return {
      pastas: e.folders.map((f) => `${f.name}${f.parentId ? ` < ${e.folders.find((m) => m.id === f.parentId)?.name}` : ''}`).sort(),
      listas: [
        ...e.folders.flatMap((f) => f.lists.map((l) => `${f.name} / ${l.name}`)),
        ...e.listasSoltas.map((l) => `Sem pasta / ${l.name}`),
      ].sort(),
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
    for (const [user, key] of [[EU, 'analista'], [MAQUINA, 'ia_acao']] as const) {
      const papel = await prisma.role.upsert({
        where: { orgId_key: { orgId: CASA, key } },
        create: { orgId: CASA, key, name: key, permissions: { connect: permissoes } },
        update: { permissions: { connect: permissoes } },
        select: { id: true },
      });
      await prisma.user.upsert({
        where: { id: user },
        create: { id: user, orgId: CASA, name: user, email: `${user}@teste.local`, passwordHash: 'x', roles: { connect: { id: papel.id } } },
        update: { roles: { connect: { id: papel.id } } },
      });
    }
  });

  beforeEach(limpar);

  afterAll(async () => {
    await limpar();
    await prisma.user.deleteMany({ where: { id: { in: [EU, MAQUINA] } } });
    await prisma.role.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    await prisma.org.deleteMany({ where: { id: { in: EMPRESAS } } });
    await prisma.$disconnect();
  });

  it('criar: pasta e lista nascem no fim do nível; nome repetido sem maiúscula nem acento é recusado', async () => {
    const gestao = await svc.criarPasta(CASA, EU, { name: 'Gestão' });
    const clientes = await svc.criarPasta(CASA, EU, { name: '  Clientes ' });
    expect(clientes.name).toBe('Clientes');
    expect(clientes.order).toBeGreaterThan(gestao.order);
    expect(await erro(() => svc.criarPasta(CASA, EU, { name: 'GESTAO' }))).toEqual({ status: 409, mensagem: TRAB_NOME_DE_PASTA_REPETIDO });
    // Em outro nível, o mesmo nome passa.
    await svc.criarPasta(CASA, EU, { name: 'Gestão', parentId: clientes.id });

    const a = await svc.criarLista(CASA, EU, { name: 'Financeiro', folderId: gestao.id });
    const b = await svc.criarLista(CASA, EU, { name: 'Pessoas', folderId: gestao.id });
    expect(b.order).toBeGreaterThan(a.order);
    expect(await prisma.workStatus.count({ where: { listId: a.id } })).toBe(3);
    expect(await erro(() => svc.criarLista(CASA, EU, { name: 'financeiro', folderId: gestao.id }))).toEqual({ status: 409, mensagem: TRAB_NOME_DE_LISTA_REPETIDO });
    expect(await erro(() => svc.criarListaDoModelo(CASA, EU, { modelo: 'esteira-de-clientes', name: 'Pessoas', folderId: gestao.id }))).toEqual({ status: 409, mensagem: TRAB_NOME_DE_LISTA_REPETIDO });
    await svc.criarLista(CASA, EU, { name: 'Financeiro', folderId: clientes.id });
    await svc.criarLista(CASA, EU, { name: 'Financeiro' });
    expect(await erro(() => svc.criarLista(CASA, EU, { name: 'FINANCEIRO' }))).toEqual({ status: 409, mensagem: TRAB_NOME_DE_LISTA_REPETIDO });
  });

  it('renomear: repetido no mesmo nível é recusado, em nível diferente é aceito, e o rastro leva o nome', async () => {
    const gestao = await pasta(CASA, 'Gestão');
    const clientes = await pasta(CASA, 'Clientes', null, 1);
    const sub = await pasta(CASA, 'Arquivo', clientes);
    const fin = await lista(CASA, gestao, 'Financeiro');
    const pes = await lista(CASA, gestao, 'Pessoas');
    await lista(CASA, clientes, 'Execução');

    expect(await erro(() => svc.editarPasta(CASA, EU, sub, { name: 'clientes' }))).toEqual({ status: 0, mensagem: 'ok' });
    expect(await erro(() => svc.editarPasta(CASA, EU, gestao, { name: 'CLIENTES' }))).toEqual({ status: 409, mensagem: TRAB_NOME_DE_PASTA_REPETIDO });
    expect(await erro(() => svc.editarPasta(CASA, EU, gestao, { name: 'Gestão e finanças' }))).toEqual({ status: 0, mensagem: 'ok' });
    // A própria pasta com outra caixa não conflita com ela mesma.
    expect(await erro(() => svc.editarPasta(CASA, EU, gestao, { name: 'gestão e finanças' }))).toEqual({ status: 0, mensagem: 'ok' });

    expect(await erro(() => svc.editarLista(CASA, EU, pes.id, { name: 'financeiro' }))).toEqual({ status: 409, mensagem: TRAB_NOME_DE_LISTA_REPETIDO });
    expect(await erro(() => svc.editarLista(CASA, EU, pes.id, { name: 'Execução' }))).toEqual({ status: 0, mensagem: 'ok' });
    // Mover para onde já existe o mesmo nome também é recusado.
    expect(await erro(() => svc.editarLista(CASA, EU, pes.id, { folderId: clientes }))).toEqual({ status: 409, mensagem: TRAB_NOME_DE_LISTA_REPETIDO });
    expect((await prisma.workList.findUniqueOrThrow({ where: { id: pes.id } })).folderId).toBe(gestao);
    // Mover sem conflito vai para o fim do nível novo.
    await svc.editarLista(CASA, EU, fin.id, { folderId: clientes });
    const movida = await prisma.workList.findUniqueOrThrow({ where: { id: fin.id } });
    expect(movida.folderId).toBe(clientes);
    expect(movida.order).toBe(1);

    const rastro = await prisma.auditLog.findFirstOrThrow({ where: { orgId: CASA, action: 'work.list.update', entityId: pes.id } });
    expect(rastro.before).toEqual({ name: 'Pessoas' });
    expect(rastro.after).toEqual({ name: 'Execução' });
  });

  it('apagar pasta vazia pela rota nova: sem destino, apagada', async () => {
    const vazia = await pasta(CASA, 'Administrativa');
    expect(await svc.excluirPastaComDestino(CASA, EU, vazia, { esperadas: { listas: 0, pastas: 0 } }))
      .toEqual({ id: vazia, modo: 'apagada', listasMovidas: 0, pastasMovidas: 0 });
    expect(await prisma.workFolder.findUnique({ where: { id: vazia } })).toBeNull();
  });

  it('apagar pasta com listas e subpasta: tudo vai para outra pasta, com os mesmos ids, e a pasta sai', async () => {
    const sai = await pasta(CASA, 'Operação');
    const destino = await pasta(CASA, 'Gestão', null, 1);
    const sub = await pasta(CASA, 'Arquivo', sai);
    const rotina = await lista(CASA, sai, 'Rotina', ['Pagar o aluguel', 'Rodar o backup']);
    const doSub = await lista(CASA, sub, 'Encerrados', ['Antigo']);
    await lista(CASA, destino, 'Financeiro');

    // Sem destino com coisa dentro: recusa e nada muda.
    expect((await erro(() => svc.excluirPastaComDestino(CASA, EU, sai, { esperadas: { listas: 1, pastas: 1 } }))).status).toBe(400);
    // A tela viu outra coisa: 409.
    expect((await erro(() => svc.excluirPastaComDestino(CASA, EU, sai, { destino: { folderId: destino }, esperadas: { listas: 2, pastas: 1 } }))).status).toBe(409);
    // O destino dentro da pasta que sai é recusado.
    expect((await erro(() => svc.excluirPastaComDestino(CASA, EU, sai, { destino: { folderId: sub }, esperadas: { listas: 1, pastas: 1 } }))).status).toBe(400);
    expect((await erro(() => svc.excluirPastaComDestino(CASA, EU, sai, { destino: { folderId: sai }, esperadas: { listas: 1, pastas: 1 } }))).status).toBe(400);
    expect(await prisma.workList.count({ where: { folderId: sai } })).toBe(1);

    expect(await svc.excluirPastaComDestino(CASA, EU, sai, { destino: { folderId: destino }, esperadas: { listas: 1, pastas: 1 } }))
      .toEqual({ id: sai, modo: 'apagada', listasMovidas: 1, pastasMovidas: 1 });
    expect(await arvore()).toEqual({
      pastas: ['Arquivo < Gestão', 'Gestão'],
      listas: ['Arquivo / Encerrados', 'Gestão / Financeiro', 'Gestão / Rotina'],
    });
    // As tarefas não mudam: mesma lista, mesmos ids.
    expect(await prisma.workTask.count({ where: { listId: rotina.id, id: { in: rotina.tarefas } } })).toBe(2);
    expect(await prisma.workTask.count({ where: { listId: doSub.id } })).toBe(1);
    const rastro = await prisma.auditLog.findFirstOrThrow({ where: { orgId: CASA, action: 'work.folder.delete', entityId: sai } });
    expect(rastro.after).toMatchObject({ modo: 'apagada', listasMovidas: 1, pastasMovidas: 1, destino: { folderId: destino, nome: 'Gestão' } });
    expect(await prisma.auditLog.count({ where: { orgId: CASA, action: 'work.list.update', entityId: rotina.id } })).toBe(1);
  });

  it('apagar pasta levando para Sem pasta: as listas ficam soltas e a subpasta sobe ao topo; com arquivada dentro, a pasta é arquivada', async () => {
    const sai = await pasta(CASA, 'Marketing');
    const sub = await pasta(CASA, 'Campanhas', sai);
    await lista(CASA, sai, 'Demandas', ['Post da semana']);
    const velha = await lista(CASA, sai, 'Velha');
    await prisma.workList.update({ where: { id: velha.id }, data: { arquivadaEm: new Date() } });
    await lista(CASA, null, 'Avulsa');

    expect(await svc.excluirPastaComDestino(CASA, EU, sai, { destino: { semPasta: true }, esperadas: { listas: 1, pastas: 1 } }))
      .toEqual({ id: sai, modo: 'arquivada', listasMovidas: 1, pastasMovidas: 1 });
    expect(await arvore()).toEqual({ pastas: ['Campanhas'], listas: ['Sem pasta / Avulsa', 'Sem pasta / Demandas'] });
    expect((await prisma.workFolder.findUniqueOrThrow({ where: { id: sub } })).parentId).toBeNull();
    // A arquivada fica com a pasta arquivada.
    expect((await prisma.workList.findUniqueOrThrow({ where: { id: velha.id } })).folderId).toBe(sai);
    expect((await prisma.workFolder.findUniqueOrThrow({ where: { id: sai } })).arquivadaEm).not.toBeNull();
  });

  it('apagar pasta com nome que já existe no destino: recusa dizendo qual, e nada muda', async () => {
    const sai = await pasta(CASA, 'Operação');
    const destino = await pasta(CASA, 'Gestão', null, 1);
    await lista(CASA, sai, 'Financeiro');
    await lista(CASA, destino, 'FINANCEIRO');
    const r = await erro(() => svc.excluirPastaComDestino(CASA, EU, sai, { destino: { folderId: destino }, esperadas: { listas: 1, pastas: 0 } }));
    expect(r).toEqual({ status: 409, mensagem: 'No destino já existe uma lista chamada "Financeiro". Renomeie uma delas antes de apagar a pasta.' });
    expect(await prisma.workFolder.count({ where: { id: sai } })).toBe(1);
    expect(await prisma.workList.count({ where: { folderId: sai } })).toBe(1);
  });

  it('apagar lista com escolha: mover as tarefas (etapa pelo nome) e então excluir; ou arquivar todas e excluir', async () => {
    const gestao = await pasta(CASA, 'Gestão');
    const sai = await lista(CASA, gestao, 'Rotina', ['Um', 'Dois', 'Três']);
    const destino = await prisma.workList.create({ data: { orgId: CASA, folderId: gestao, name: 'Operação' } });
    const fazendo = await prisma.workStatus.create({ data: { orgId: CASA, listId: destino.id, name: 'fazendo', type: 'custom', order: 0 } });
    const backlog = await prisma.workStatus.create({ data: { orgId: CASA, listId: destino.id, name: 'Backlog', type: 'open', order: 1 } });

    expect((await erro(() => svc.moverTarefasDaLista(CASA, EU, sai.id, { destinoId: destino.id, esperadas: 2 }))).status).toBe(409);
    expect((await erro(() => svc.moverTarefasDaLista(CASA, EU, sai.id, { destinoId: sai.id, esperadas: 3 }))).status).toBe(400);
    expect(await svc.moverTarefasDaLista(CASA, EU, sai.id, { destinoId: destino.id, esperadas: 3 }))
      .toEqual({ id: sai.id, destinoId: destino.id, movidas: 3, mudaramDeEtapa: 2 });
    const movidas = await prisma.workTask.findMany({ where: { id: { in: sai.tarefas } }, select: { listId: true, statusId: true, title: true }, orderBy: { title: 'asc' } });
    expect(movidas).toEqual([
      { listId: destino.id, statusId: fazendo.id, title: 'Dois' },
      { listId: destino.id, statusId: backlog.id, title: 'Três' },
      { listId: destino.id, statusId: backlog.id, title: 'Um' },
    ]);
    expect(await prisma.auditLog.count({ where: { orgId: CASA, action: 'work.task.update', entityId: { in: sai.tarefas } } })).toBe(3);
    const rastro = await prisma.auditLog.findFirstOrThrow({ where: { orgId: CASA, action: 'work.list.tasks.move', entityId: sai.id } });
    expect(rastro.after).toMatchObject({ movidas: 3, mudaramDeEtapa: 2, destinoId: destino.id });
    expect(await svc.apagarLista(CASA, EU, sai.id, { confirmarNome: 'rotina' })).toEqual({ id: sai.id, modo: 'apagada', tarefasArquivadas: 0 });

    // O outro caminho: arquivar todas e excluir (a lista é arquivada, as tarefas ficam).
    const outra = await lista(CASA, gestao, 'Lixo', ['A', 'B']);
    await svc.arquivarTarefasDaLista(CASA, EU, outra.id, { esperadas: 2 });
    expect(await svc.apagarLista(CASA, EU, outra.id, { confirmarNome: 'Lixo' })).toEqual({ id: outra.id, modo: 'arquivada', tarefasArquivadas: 2 });
  });

  it('mover tarefas recusa destino arquivado, a lista do comercial, lista de cadastro e a da implantação', async () => {
    const sai = await lista(CASA, null, 'Rotina', ['Um']);
    const arquivada = await lista(CASA, null, 'Arquivada');
    await prisma.workList.update({ where: { id: arquivada.id }, data: { arquivadaEm: new Date() } });
    const pastaArquivada = await pasta(CASA, 'Velha');
    const dentroDaArquivada = await lista(CASA, pastaArquivada, 'Dentro');
    await prisma.workFolder.update({ where: { id: pastaArquivada }, data: { arquivadaEm: new Date() } });
    const comercial = await lista(CASA, null, 'Tarefas do comercial', [], { externalId: LISTA_DO_COMERCIAL });
    const cadastro = await lista(CASA, null, 'Clientes ativos', [], { natureza: 'cadastro' });
    const clientes = await pasta(CASA, 'Clientes', null, 5);
    const onboarding = await lista(CASA, clientes, 'Onboarding de cliente');

    for (const destinoId of [arquivada.id, dentroDaArquivada.id]) {
      expect(await erro(() => svc.moverTarefasDaLista(CASA, EU, sai.id, { destinoId, esperadas: 1 })))
        .toEqual({ status: 400, mensagem: 'A lista de destino está arquivada. Escolha uma lista que aparece no Trabalho.' });
    }
    expect((await erro(() => svc.moverTarefasDaLista(CASA, EU, sai.id, { destinoId: comercial.id, esperadas: 1 }))).mensagem).toContain('Funil vivo');
    expect((await erro(() => svc.moverTarefasDaLista(CASA, EU, sai.id, { destinoId: cadastro.id, esperadas: 1 }))).mensagem).toContain('cadastro');
    expect(await erro(() => svc.moverTarefasDaLista(CASA, EU, sai.id, { destinoId: onboarding.id, esperadas: 1 }))).toEqual({ status: 400, mensagem: PORTA_DA_IMPLANTACAO });
    expect(await prisma.workTask.count({ where: { listId: sai.id } })).toBe(1);
  });

  it('reordenar: regrava o nível com os irmãos exatos; ids errados = 400 e nada muda', async () => {
    const a = await pasta(CASA, 'A', null, 0);
    const b = await pasta(CASA, 'B', null, 1);
    const c = await pasta(CASA, 'C', null, 2);
    const sub = await pasta(CASA, 'Sub', a);
    await svc.ordenarArvore(CASA, EU, { tipo: 'pasta', paiId: null, ids: [c, a, b] });
    expect((await svc.estrutura(CASA)).folders.filter((f) => !f.parentId).map((f) => f.name)).toEqual(['C', 'A', 'B']);

    const fora = { status: 400, mensagem: TRAB_ORDEM_FORA_DO_NIVEL };
    expect(await erro(() => svc.ordenarArvore(CASA, EU, { tipo: 'pasta', paiId: null, ids: [a, b] }))).toEqual(fora);
    expect(await erro(() => svc.ordenarArvore(CASA, EU, { tipo: 'pasta', paiId: null, ids: [a, b, c, sub] }))).toEqual(fora);
    expect(await erro(() => svc.ordenarArvore(CASA, EU, { tipo: 'pasta', paiId: null, ids: [a, a, b] }))).toEqual(fora);
    expect((await svc.estrutura(CASA)).folders.filter((f) => !f.parentId).map((f) => f.name)).toEqual(['C', 'A', 'B']);

    const l1 = await lista(CASA, a, 'Um', [], { order: 0 });
    const l2 = await lista(CASA, a, 'Dois', [], { order: 1 });
    await svc.ordenarArvore(CASA, EU, { tipo: 'lista', paiId: a, ids: [l2.id, l1.id] });
    expect((await svc.estrutura(CASA)).folders.find((f) => f.id === a)!.lists.map((l) => l.name)).toEqual(['Dois', 'Um']);
    expect(await erro(() => svc.ordenarArvore(CASA, EU, { tipo: 'lista', paiId: b, ids: [l2.id, l1.id] }))).toEqual(fora);
    // As soltas são um nível; a do comercial não entra na conta.
    const s1 = await lista(CASA, null, 'Solta 1', [], { order: 0 });
    const s2 = await lista(CASA, null, 'Solta 2', [], { order: 1 });
    await lista(CASA, null, 'Tarefas do comercial', [], { externalId: LISTA_DO_COMERCIAL });
    await svc.ordenarArvore(CASA, EU, { tipo: 'lista', paiId: null, ids: [s2.id, s1.id] });
    expect((await svc.estrutura(CASA)).listasSoltas.map((l) => l.name)).toEqual(['Solta 2', 'Solta 1']);
    expect(await prisma.auditLog.count({ where: { orgId: CASA, action: 'work.tree.reorder' } })).toBe(3);
  });

  it('protegidas: a lista da implantação não se renomeia, não sai da pasta, não se apaga; a pasta Clientes não se apaga', async () => {
    const clientes = await pasta(CASA, 'Clientes');
    const gestao = await pasta(CASA, 'Gestão', null, 1);
    const onb = await lista(CASA, clientes, 'Onboarding de cliente', ['Kickoff do cliente']);
    await lista(CASA, clientes, 'Execução');

    expect((await erro(() => svc.editarLista(CASA, EU, onb.id, { name: 'Onboarding' }))).status).toBe(400);
    expect((await erro(() => svc.editarLista(CASA, EU, onb.id, { folderId: gestao }))).status).toBe(400);
    expect((await erro(() => svc.apagarLista(CASA, EU, onb.id, { confirmarNome: 'Onboarding de cliente' }))).status).toBe(400);
    const rotina = await lista(CASA, gestao, 'Rotina');
    expect((await erro(() => svc.moverTarefasDaLista(CASA, EU, onb.id, { destinoId: rotina.id, esperadas: 1 }))).status).toBe(400);
    expect((await erro(() => svc.editarPasta(CASA, EU, clientes, { name: 'Clientes ativos' }))).status).toBe(400);
    expect(await erro(() => svc.excluirPastaComDestino(CASA, EU, clientes, { destino: { folderId: gestao }, esperadas: { listas: 2, pastas: 0 } })))
      .toEqual({ status: 400, mensagem: TRAB_PASTA_DA_IMPLANTACAO_PROTEGIDA });
    expect((await prisma.workList.findUniqueOrThrow({ where: { id: onb.id } })).folderId).toBe(clientes);
    // Reordenar dentro da pasta continua valendo.
    const ids = (await svc.estrutura(CASA)).folders.find((f) => f.id === clientes)!.lists.map((l) => l.id).reverse();
    await svc.ordenarArvore(CASA, EU, { tipo: 'lista', paiId: clientes, ids });
  });

  it('conta de máquina não apaga pasta nem move tarefas; outra empresa não alcança', async () => {
    const sai = await pasta(CASA, 'Operação');
    const rotina = await lista(CASA, sai, 'Rotina', ['Um']);
    const outra = await lista(CASA, null, 'Outra');
    expect(await erro(() => svc.excluirPastaComDestino(CASA, MAQUINA, sai, { destino: { semPasta: true }, esperadas: { listas: 1, pastas: 0 } })))
      .toEqual({ status: 403, mensagem: RECUSA_DE_MAQUINA_NO_TRABALHO });
    expect(await erro(() => svc.moverTarefasDaLista(CASA, MAQUINA, rotina.id, { destinoId: outra.id, esperadas: 1 })))
      .toEqual({ status: 403, mensagem: RECUSA_DE_MAQUINA_NO_TRABALHO });

    // A vizinha: os ids da casa são 404 do lado dela, e o destino da vizinha é 404 do lado da casa.
    const daVizinha = await lista(VIZINHA, null, 'Da vizinha');
    const pastaDaVizinha = await pasta(VIZINHA, 'Pasta da vizinha');
    expect((await erro(() => svc.excluirPastaComDestino(VIZINHA, EU, sai, { destino: { semPasta: true }, esperadas: { listas: 1, pastas: 0 } }))).status).toBe(403);
    expect((await erro(() => svc.excluirPastaComDestino(CASA, EU, sai, { destino: { folderId: pastaDaVizinha }, esperadas: { listas: 1, pastas: 0 } }))).status).toBe(404);
    expect((await erro(() => svc.moverTarefasDaLista(CASA, EU, rotina.id, { destinoId: daVizinha.id, esperadas: 1 }))).status).toBe(404);
    expect((await erro(() => svc.ordenarArvore(CASA, EU, { tipo: 'pasta', paiId: null, ids: [pastaDaVizinha] }))).status).toBe(400);
    expect((await erro(() => svc.ordenarArvore(CASA, EU, { tipo: 'lista', paiId: pastaDaVizinha, ids: [daVizinha.id] }))).status).toBe(404);
    expect((await erro(() => svc.editarLista(CASA, EU, daVizinha.id, { name: 'Tomada' }))).status).toBe(404);
    expect(await prisma.workList.count({ where: { folderId: sai } })).toBe(1);
    expect((await prisma.workList.findUniqueOrThrow({ where: { id: daVizinha.id } })).name).toBe('Da vizinha');
  });
});
