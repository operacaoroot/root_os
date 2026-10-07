import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AuditService } from '../src/audit/audit.service';
import { EventLogService } from '../src/gateway/event-log.service';
import { CheckoutDeTarefaService } from '../src/work/checkout-de-tarefa.service';
import { WorkService } from '../src/work/work.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { exigirBancoDescartavel } from './banco-de-teste';

/*
 * ==========================================================================
 * AS RELAÇÕES DA TAREFA FICAM NA EMPRESA DELA (ROOT-02, lacuna T3)
 * ==========================================================================
 *
 * O corpo de criar e de editar tarefa escolhe quatro ponteiros: lista, etapa,
 * tarefa pai e etiquetas. A chave estrangeira só confere que o id existe, e a
 * API conecta como dona das tabelas, que o isolamento por linha não alcança.
 * Sobra o `WorkService` para conferir a empresa de cada id antes de gravar.
 *
 * O que esta suíte cobra:
 *  1. Id de outra empresa é recusado ao criar e ao editar, e nada é gravado:
 *     nem a tarefa nova, nem o resto do PATCH, nem a linha de auditoria.
 *  2. O erro é o mesmo de um id que não existe. Um erro diferente contaria a
 *     quem pergunta que aquele id existe em outra empresa.
 *  3. Os mesmos vínculos dentro da empresa continuam valendo, inclusive mover
 *     de lista sem etapa (cai na primeira da lista destino) e pai em outra
 *     lista da mesma empresa.
 *
 * Quando a conferência falta, o estrago aparece nas leituras: o filho criado
 * pela casa entra no detalhe da tarefa da vizinha, e a casa passa a ler o nome
 * da lista e da etiqueta da vizinha. Por isso os casos de recusa olham também o
 * que cada empresa lê depois da chamada.
 */

const URL = process.env.TEST_DATABASE_URL;
const CASA = 'org-teste-relacoes-casa';
const VIZINHA = 'org-teste-relacoes-vizinha';
const EMPRESAS = [CASA, VIZINHA];
const EU = 'u-relacoes-casa';
const ELA = 'u-relacoes-vizinha';

exigirBancoDescartavel(URL ?? '', 'ESCREVE nele (duas empresas, listas, etapas, etiquetas, tarefas e auditoria)');

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

const LISTA_NAO_ENCONTRADA = { status: 404, mensagem: 'Lista não encontrada' };
const PAI_NAO_ENCONTRADO = { status: 404, mensagem: 'Tarefa pai não encontrada' };
const ETIQUETA_NAO_ENCONTRADA = { status: 404, mensagem: 'Etiqueta não encontrada' };
const ETAPA_FORA_DA_LISTA_AO_CRIAR = { status: 400, mensagem: 'Status não pertence à lista.' };
const ETAPA_FORA_DA_LISTA_AO_EDITAR = { status: 400, mensagem: 'Status não pertence à lista da tarefa.' };

describe.skipIf(!URL)('trabalho: as relações da tarefa ficam na empresa dela', () => {
  let prisma: PrismaClient;
  let svc: WorkService;
  let listaCasa: string;
  let outraListaCasa: string;
  let listaVizinha: string;
  const etapas: Record<'casa' | 'outra' | 'vizinha', string[]> = { casa: [], outra: [], vizinha: [] };
  let etiquetaCasa: string;
  let outraEtiquetaCasa: string;
  let etiquetaVizinha: string;
  let paiCasa: string;
  let paiVizinha: string;
  let alvo: string;

  async function limparTarefas() {
    await prisma.workTask.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    await prisma.auditLog.deleteMany({ where: { orgId: { in: EMPRESAS }, entityType: 'work_task' } });
  }

  async function etapasDa(listId: string) {
    const lidas = await prisma.workStatus.findMany({ where: { listId }, orderBy: { order: 'asc' } });
    return lidas.map((s) => s.id);
  }

  /** A tarefa como está no banco, mais quantas edições dela a auditoria registrou. */
  async function estadoDa(id: string) {
    const t = await prisma.workTask.findUniqueOrThrow({ where: { id }, include: { tags: { select: { id: true } } } });
    return {
      listId: t.listId,
      statusId: t.statusId,
      parentId: t.parentId,
      title: t.title,
      etiquetas: t.tags.map((g) => g.id).sort(),
      edicoesNaAuditoria: await prisma.auditLog.count({
        where: { orgId: CASA, action: 'work.task.update', entityId: id },
      }),
    };
  }

  const estadoInicial = () => ({
    listId: listaCasa,
    statusId: etapas.casa[0],
    parentId: null,
    title: 'Alvo',
    etiquetas: [etiquetaCasa],
    edicoesNaAuditoria: 0,
  });

  /** Tarefas com este título e criações na auditoria, nas duas empresas. */
  async function criadasCom(title: string) {
    return {
      tarefas: await prisma.workTask.count({ where: { orgId: { in: EMPRESAS }, title } }),
      criacoesNaAuditoria: await prisma.auditLog.count({
        where: { orgId: { in: EMPRESAS }, action: 'work.task.create' },
      }),
    };
  }

  const filhosNaVizinha = async () => (await svc.tarefa(VIZINHA, paiVizinha)).filhos.map((f) => f.title);

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
    await limparTarefas();
    await prisma.workTag.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    await prisma.workList.deleteMany({ where: { orgId: { in: EMPRESAS } } });

    listaCasa = (await svc.criarLista(CASA, EU, { name: 'Lista da casa' })).id;
    outraListaCasa = (await svc.criarLista(CASA, EU, { name: 'Outra lista da casa' })).id;
    listaVizinha = (await svc.criarLista(VIZINHA, ELA, { name: 'Lista da vizinha' })).id;
    etapas.casa = await etapasDa(listaCasa);
    etapas.outra = await etapasDa(outraListaCasa);
    etapas.vizinha = await etapasDa(listaVizinha);
    etiquetaCasa = (await svc.criarTag(CASA, EU, { name: 'Etiqueta da casa' })).id;
    outraEtiquetaCasa = (await svc.criarTag(CASA, EU, { name: 'Outra etiqueta da casa' })).id;
    etiquetaVizinha = (await svc.criarTag(VIZINHA, ELA, { name: 'Etiqueta da vizinha' })).id;
  });

  beforeEach(async () => {
    await limparTarefas();
    paiCasa = (await prisma.workTask.create({
      data: { orgId: CASA, listId: outraListaCasa, statusId: etapas.outra[0], title: 'Pai da casa' },
    })).id;
    paiVizinha = (await prisma.workTask.create({
      data: { orgId: VIZINHA, listId: listaVizinha, statusId: etapas.vizinha[0], title: 'Pai da vizinha' },
    })).id;
    alvo = (await prisma.workTask.create({
      data: {
        orgId: CASA, listId: listaCasa, statusId: etapas.casa[0], title: 'Alvo',
        tags: { connect: [{ id: etiquetaCasa }] },
      },
    })).id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await limparTarefas();
    await prisma.workTag.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    await prisma.workList.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    await prisma.auditLog.deleteMany({ where: { orgId: { in: EMPRESAS } } });
    await prisma.user.deleteMany({ where: { id: { in: [EU, ELA] } } });
    await prisma.org.deleteMany({ where: { id: { in: EMPRESAS } } });
    await prisma.$disconnect();
  });

  describe('id de outra empresa é recusado, e nada é gravado', () => {
    it('criar com pai da vizinha: 404, nenhuma tarefa nova, e a vizinha não ganha filho', async () => {
      const erro = await erroDe(svc.criarTarefa(CASA, EU, { listId: listaCasa, title: 'Filha da casa', parentId: paiVizinha }));
      expect({ erro, ...(await criadasCom('Filha da casa')), filhosNaVizinha: await filhosNaVizinha() }).toEqual({
        erro: PAI_NAO_ENCONTRADO, tarefas: 0, criacoesNaAuditoria: 0, filhosNaVizinha: [],
      });
    });

    it('criar com etiqueta da vizinha, sozinha ou ao lado de uma da casa: 404 e nada gravado', async () => {
      for (const tagIds of [[etiquetaVizinha], [etiquetaCasa, etiquetaVizinha]]) {
        const erro = await erroDe(svc.criarTarefa(CASA, EU, { listId: listaCasa, title: 'Etiquetada', tagIds }));
        expect({
          erro,
          ...(await criadasCom('Etiquetada')),
          etiquetasLidasPelaCasa: (await svc.tarefas(CASA, { q: 'Etiquetada' })).items.flatMap((t) => t.tags.map((g) => g.name)),
          tarefasComEtiquetaDaVizinha: await prisma.workTask.count({ where: { tags: { some: { id: etiquetaVizinha } } } }),
        }).toEqual({
          erro: ETIQUETA_NAO_ENCONTRADA, tarefas: 0, criacoesNaAuditoria: 0,
          etiquetasLidasPelaCasa: [], tarefasComEtiquetaDaVizinha: 0,
        });
      }
    });

    it('editar movendo para lista da vizinha, com ou sem etapa dela: 404 e a tarefa fica onde estava', async () => {
      for (const mudanca of [{ listId: listaVizinha }, { listId: listaVizinha, statusId: etapas.vizinha[1] }]) {
        const erro = await erroDe(svc.editarTarefa(CASA, EU, alvo, { ...mudanca, title: 'Não pode gravar' }));
        expect({ erro, estado: await estadoDa(alvo), listaNoDetalhe: (await svc.tarefa(CASA, alvo)).listName }).toEqual({
          erro: LISTA_NAO_ENCONTRADA, estado: estadoInicial(), listaNoDetalhe: 'Lista da casa',
        });
      }
    });

    it('editar com pai da vizinha: 404, e nem o título que veio junto é gravado', async () => {
      const erro = await erroDe(svc.editarTarefa(CASA, EU, alvo, { parentId: paiVizinha, title: 'Não pode gravar' }));
      expect({ erro, estado: await estadoDa(alvo), filhosNaVizinha: await filhosNaVizinha() }).toEqual({
        erro: PAI_NAO_ENCONTRADO, estado: estadoInicial(), filhosNaVizinha: [],
      });
    });

    it('editar com etiqueta da vizinha, sozinha ou ao lado de uma da casa: 404 e as etiquetas ficam como estavam', async () => {
      for (const tagIds of [[etiquetaVizinha], [outraEtiquetaCasa, etiquetaVizinha]]) {
        const erro = await erroDe(svc.editarTarefa(CASA, EU, alvo, { tagIds, title: 'Não pode gravar' }));
        expect({ erro, estado: await estadoDa(alvo) }).toEqual({ erro: ETIQUETA_NAO_ENCONTRADA, estado: estadoInicial() });
      }
    });

    it('etapa da vizinha: 400 ao criar, ao editar e ao mover para outra lista da casa', async () => {
      const aoCriar = await erroDe(
        svc.criarTarefa(CASA, EU, { listId: listaCasa, title: 'Na etapa errada', statusId: etapas.vizinha[0] }),
      );
      const aoEditar = await erroDe(svc.editarTarefa(CASA, EU, alvo, { statusId: etapas.vizinha[0], title: 'Não pode gravar' }));
      const aoMover = await erroDe(
        svc.editarTarefa(CASA, EU, alvo, { listId: outraListaCasa, statusId: etapas.vizinha[0], title: 'Não pode gravar' }),
      );
      expect({ aoCriar, aoEditar, aoMover, ...(await criadasCom('Na etapa errada')), estado: await estadoDa(alvo) }).toEqual({
        aoCriar: ETAPA_FORA_DA_LISTA_AO_CRIAR,
        aoEditar: ETAPA_FORA_DA_LISTA_AO_EDITAR,
        aoMover: ETAPA_FORA_DA_LISTA_AO_EDITAR,
        tarefas: 0,
        criacoesNaAuditoria: 0,
        estado: estadoInicial(),
      });
    });

    it('tarefa já gravada em lista da vizinha não aceita etapa da vizinha, e pode voltar para lista da casa', async () => {
      // O estado que a falta de conferência deixava gravar, escrito direto no banco.
      await prisma.workTask.update({ where: { id: alvo }, data: { listId: listaVizinha, statusId: etapas.vizinha[0] } });

      const erro = await erroDe(svc.editarTarefa(CASA, EU, alvo, { statusId: etapas.vizinha[1] }));
      expect({ erro, statusId: (await estadoDa(alvo)).statusId }).toEqual({
        erro: ETAPA_FORA_DA_LISTA_AO_EDITAR, statusId: etapas.vizinha[0],
      });

      await svc.editarTarefa(CASA, EU, alvo, { listId: listaCasa });
      expect(await estadoDa(alvo)).toMatchObject({ listId: listaCasa, statusId: etapas.casa[0] });
    });
  });

  describe('o erro não diz se o id existe na outra empresa', () => {
    async function restaurarAlvo() {
      await prisma.workTask.update({
        where: { id: alvo },
        data: {
          listId: listaCasa, statusId: etapas.casa[0], parentId: null, title: 'Alvo',
          tags: { set: [{ id: etiquetaCasa }] },
        },
      });
    }

    // Restaura antes de cada chamada para que uma escrita aceita não mude o ponto de partida da seguinte.
    async function comparar(chamar: (id: string) => Promise<unknown>, idDaVizinha: string) {
      await restaurarAlvo();
      const daVizinha = await erroDe(chamar(idDaVizinha));
      await restaurarAlvo();
      const inexistente = await erroDe(chamar(randomUUID()));
      return { daVizinha, inexistente };
    }

    it('lista, etapa, pai e etiqueta da vizinha recebem o mesmo erro de um id que não existe', async () => {
      const novaNaCasa = (extra: Partial<{ parentId: string; tagIds: string[]; statusId: string }>) =>
        svc.criarTarefa(CASA, EU, { listId: listaCasa, title: 'Comparação', ...extra });

      expect({
        listaAoEditar: await comparar((id) => svc.editarTarefa(CASA, EU, alvo, { listId: id }), listaVizinha),
        etapaAoCriar: await comparar((id) => novaNaCasa({ statusId: id }), etapas.vizinha[0]),
        etapaAoEditar: await comparar((id) => svc.editarTarefa(CASA, EU, alvo, { statusId: id }), etapas.vizinha[0]),
        paiAoCriar: await comparar((id) => novaNaCasa({ parentId: id }), paiVizinha),
        paiAoEditar: await comparar((id) => svc.editarTarefa(CASA, EU, alvo, { parentId: id }), paiVizinha),
        etiquetaAoCriar: await comparar((id) => novaNaCasa({ tagIds: [id] }), etiquetaVizinha),
        etiquetaAoEditar: await comparar((id) => svc.editarTarefa(CASA, EU, alvo, { tagIds: [id] }), etiquetaVizinha),
      }).toEqual({
        listaAoEditar: { daVizinha: LISTA_NAO_ENCONTRADA, inexistente: LISTA_NAO_ENCONTRADA },
        etapaAoCriar: { daVizinha: ETAPA_FORA_DA_LISTA_AO_CRIAR, inexistente: ETAPA_FORA_DA_LISTA_AO_CRIAR },
        etapaAoEditar: { daVizinha: ETAPA_FORA_DA_LISTA_AO_EDITAR, inexistente: ETAPA_FORA_DA_LISTA_AO_EDITAR },
        paiAoCriar: { daVizinha: PAI_NAO_ENCONTRADO, inexistente: PAI_NAO_ENCONTRADO },
        paiAoEditar: { daVizinha: PAI_NAO_ENCONTRADO, inexistente: PAI_NAO_ENCONTRADO },
        etiquetaAoCriar: { daVizinha: ETIQUETA_NAO_ENCONTRADA, inexistente: ETIQUETA_NAO_ENCONTRADA },
        etiquetaAoEditar: { daVizinha: ETIQUETA_NAO_ENCONTRADA, inexistente: ETIQUETA_NAO_ENCONTRADA },
      });
    });
  });

  describe('na mesma empresa, os mesmos vínculos continuam valendo', () => {
    it('criar com pai de outra lista da casa, etiquetas e etapa da casa grava os vínculos', async () => {
      const criada = await svc.criarTarefa(CASA, EU, {
        listId: listaCasa,
        title: 'Filha legítima',
        statusId: etapas.casa[1],
        parentId: paiCasa,
        tagIds: [etiquetaCasa, outraEtiquetaCasa, etiquetaCasa],
      });
      const semEtapa = await svc.criarTarefa(CASA, EU, { listId: listaCasa, title: 'Sem etapa' });
      expect({
        listId: criada.listId,
        statusId: criada.statusId,
        parentId: criada.parentId,
        etiquetas: criada.tags.map((g) => g.id).sort(),
        filhosDoPai: (await svc.tarefa(CASA, paiCasa)).filhos.map((f) => f.title),
        etapaSemEscolha: semEtapa.statusId,
      }).toEqual({
        listId: listaCasa,
        statusId: etapas.casa[1],
        parentId: paiCasa,
        etiquetas: [etiquetaCasa, outraEtiquetaCasa].sort(),
        filhosDoPai: ['Filha legítima'],
        etapaSemEscolha: etapas.casa[0],
      });
    });

    it('mover para outra lista da casa: sem etapa cai na primeira dela; com etapa, fica na escolhida', async () => {
      await svc.editarTarefa(CASA, EU, alvo, { listId: outraListaCasa });
      expect(await estadoDa(alvo)).toMatchObject({ listId: outraListaCasa, statusId: etapas.outra[0] });

      await svc.editarTarefa(CASA, EU, alvo, { listId: listaCasa, statusId: etapas.casa[2] });
      expect(await estadoDa(alvo)).toMatchObject({ listId: listaCasa, statusId: etapas.casa[2], edicoesNaAuditoria: 2 });
    });

    it('trocar e depois limpar pai e etiquetas da casa', async () => {
      await svc.editarTarefa(CASA, EU, alvo, { parentId: paiCasa, tagIds: [outraEtiquetaCasa, outraEtiquetaCasa] });
      expect(await estadoDa(alvo)).toMatchObject({ parentId: paiCasa, etiquetas: [outraEtiquetaCasa] });

      await svc.editarTarefa(CASA, EU, alvo, { parentId: null, tagIds: [] });
      expect(await estadoDa(alvo)).toMatchObject({ parentId: null, etiquetas: [] });
    });

    it('repetir no corpo a lista em que a tarefa já está muda só o que foi pedido', async () => {
      await svc.editarTarefa(CASA, EU, alvo, { listId: listaCasa, statusId: etapas.casa[1], title: 'Alvo renomeado' });
      expect(await estadoDa(alvo)).toEqual({
        ...estadoInicial(), statusId: etapas.casa[1], title: 'Alvo renomeado', edicoesNaAuditoria: 1,
      });
    });
  });
});
