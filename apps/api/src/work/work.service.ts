import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { temPapelDeMaquina } from '../approvals/alcada';
import { lerAprovador } from '../auth/aprovador';
import { RECUSA_DE_MAQUINA_NO_TRABALHO } from './so-gente-no-trabalho.guard';
import {
  MODELOS_DE_LISTA, TRAB_LISTA_COM_DOIS_PAIS, TRAB_PASTA_COM_DOIS_PAIS, ehValorMonetarioCanonico, TrabTarefaUpdateHttpSchema,
  listaDaImplantacao, LISTA_DA_IMPLANTACAO, PASTA_DA_IMPLANTACAO, PORTA_DA_IMPLANTACAO,
  CARTOES_QUE_NAO_SAO_TAREFA, RecorrenciaSchema, proximaOcorrencia, type RecorrenciaDaTarefa, type TrabTarefasOrdemInput,
  nomeParaConfirmar, chaveDoNomeNoNivel, etapaNoDestino,
  TRAB_NOME_DE_PASTA_REPETIDO, TRAB_NOME_DE_LISTA_REPETIDO, TRAB_PASTA_DA_IMPLANTACAO_PROTEGIDA, TRAB_ORDEM_FORA_DO_NIVEL,
} from '@mktos/shared';
import type {
  TrabEstrutura, TrabListaDto, TrabCampoDto, TrabTarefaLista, TrabTarefaResumo,
  TrabTarefaDetalhe, TrabTarefaCreateInput, TrabTarefaUpdateHttpInput, TrabAtividadePagina,
  TrabApontamentoCreateInput, TrabApontamentoDto, TrabListaDoModeloInput, ModeloDeLista,
  TrabEspacoCreateInput, TrabEspacoUpdateInput, TrabPastaCreateInput, TrabPastaUpdateInput,
  TrabListaCreateInput, TrabListaUpdateInput, TrabEstruturaSugeridaResultado,
  TrabListaExcluirInput, TrabListaExcluida, TrabPastaExcluida, TrabListaArquivarTarefasInput, TrabListaTarefasArquivadas,
  TrabPastaExcluirComDestinoInput, TrabPastaExcluidaComDestino, TrabListaMoverTarefasInput, TrabListaTarefasMovidas,
  TrabArvoreOrdemInput,
} from '@mktos/shared';
import { Prisma, WorkFieldType, WorkListaNatureza, WorkPriority, WorkStatusType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CheckoutDeTarefaService } from './checkout-de-tarefa.service';
import { agentesDaCasa, type AgenteDaCasa } from './agentes-da-casa';
import { listarClientes, nomesDosClientes, resolverCliente } from './clientes-da-casa';
import { criarEstruturaSugerida, criarListaDoModeloNoBanco, criarListaPadraoNoBanco } from './estrutura-sugerida';
import { SEGMENTO_SEM_PASTA, pastaComSubpastas, type WorkTaskQuery } from './work-task-query';
import { exigirAcessoAtual } from '../memory/acesso-memoria';
import { listaVisivel, pastasEscondidas, tarefaDeListaVisivel } from './arquivadas';
import { ehListaDoComercial, foraDaArvore } from './lista-do-comercial';
import { activityCursor, activityDto, activityNames, activityPoint, activityWhere, parseActivityQuery } from './work-activity-page';

// Módulo TRABALHO: gestão de tarefas estilo ClickUp, nativa do mkt-os.
// Hierarquia pastas → listas → tarefas; statuses POR LISTA; campos personalizados
// com opções; etiquetas; comentários. Semente = fotografia do espaço `root`
// (25/07/2026); externalId preserva o id ClickUp p/ reconciliação futura.

/*
 * `agente` NÃO ENTRA NESTE `include`, e é decisão, não esquecimento.
 *
 * `include: { agente: true }` resolveria o nome do agente numa consulta só — e
 * traria o agente que estiver do outro lado do ponteiro, de QUALQUER empresa: o
 * Prisma não filtra relação para um dentro do include. É a mesma armadilha que
 * `agents/donos-da-casa.ts` documenta para o dono humano, e o quadro de Trabalho
 * é lido pelo cliente. Quem resolve é `agentes-da-casa.ts`, com consulta
 * escopada por empresa; ponteiro atravessado devolve nulo e a tela diz "outro
 * agente".
 */
const TASK_INCLUDE = {
  status: true,
  list: { select: { name: true } },
  assigneeUser: { select: { id: true, name: true, email: true, isActive: true } },
  tags: true,
  values: { include: { field: true, option: true } },
  _count: { select: { subtasks: true, comments: true } },
} satisfies Prisma.WorkTaskInclude;

type TaskRow = Prisma.WorkTaskGetPayload<{ include: typeof TASK_INCLUDE }>;

type ValorDoCampo = { optionId?: string | null; value?: string | null };
export type CampoConferido = { field: Prisma.WorkFieldGetPayload<{ include: { options: true } }>; v: ValorDoCampo };

/** A tarefa conferida e pronta para gravar (`prepararCriacaoDeTarefa` → `gravarTarefaPreparada`). */
export interface TarefaPreparada {
  orgId: string;
  listId: string;
  statusId: string;
  clienteId: string | null;
  campos: CampoConferido[];
  input: TrabTarefaCreateInput;
}

/** O pai imediato de cada nó da árvore; os dois nulos = fora de espaço. */
type PaiDaPasta = { spaceId: string | null; parentId: string | null };
type PaiDaLista = { folderId: string | null; spaceId: string | null };

const NOME_DE_PASTA_REPETIDO = TRAB_NOME_DE_PASTA_REPETIDO;
const NOME_DE_ESPACO_REPETIDO = 'Já existe um espaço com esse nome.';
const PASTA_EM_CICLO = 'A pasta não pode ficar dentro dela mesma nem de uma pasta que está dentro dela.';
const PASTA_COM_LISTAS = 'A pasta tem listas. Mova ou exclua as listas antes.';
const PASTA_COM_PASTAS = 'A pasta tem pastas dentro. Mova ou exclua essas pastas antes.';
const LISTA_MUDOU_NO_MEIO = 'A lista mudou enquanto você confirmava. Atualize a tela e tente de novo.';
const PASTA_MUDOU_NO_MEIO = 'A pasta mudou enquanto você confirmava. Atualize a tela e tente de novo.';
const LISTA_DA_IMPLANTACAO_FICA = `A lista ${LISTA_DA_IMPLANTACAO} é a porta da implantação de clientes: ela não sai do Trabalho.`;

/**
 * `true` quando o pedido apaga o valor do campo. Num `moeda` só o valor decide:
 * o campo não tem opção, e `optionId` preenchido já é recusado antes.
 */
function apagaOValor(tipo: WorkFieldType, v: ValorDoCampo): boolean {
  const semValor = v.value === null || v.value === undefined;
  if (tipo === WorkFieldType.moeda) return semValor;
  return v.optionId === null || (v.optionId === undefined && semValor);
}

/**
 * O dia de HOJE no fuso de Brasília, como AAAA-MM-DD.
 *
 * Apontamento é por dia, e o dia de quem aponta é o do relógio dele: às 22h de
 * terça em Brasília o UTC já é quarta, e `toISOString()` publicaria a hora no dia
 * seguinte. A empresa é brasileira; fuso por empresa entra quando houver cliente
 * fora dele.
 */
export function hojeEmBrasilia(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(agora);
}

/** O nome de pasta ou lista como é gravado: sem espaço nas pontas; vazio depois disso é recusado. */
function nomeDoNo(nome: string): string {
  const n = nome.trim();
  if (!n) throw new BadRequestException('Escreva um nome.');
  return n;
}

/** `true` só para data de calendário que existe (recusa 2026-02-31). */
export function diaDeCalendarioValido(dia: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return false;
  const d = new Date(`${dia}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === dia;
}

@Injectable()
export class WorkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly checkout: CheckoutDeTarefaService,
  ) {}

  // ---------- estrutura (árvore + catálogos) ----------

  private mapField(f: Prisma.WorkFieldGetPayload<{ include: { options: true } }>): TrabCampoDto {
    return {
      id: f.id, listId: f.listId, name: f.name, type: f.type, order: f.order,
      options: f.options
        .sort((a, b) => a.order - b.order)
        .map((o) => ({ id: o.id, name: o.name, color: o.color, order: o.order })),
    };
  }

  async estrutura(orgId: string): Promise<TrabEstrutura> {
    const [spaces, folders, lists, fields, tags, counts, byStatus, users, agentes, pessoas] = await Promise.all([
      this.prisma.workSpace.findMany({ where: { orgId }, orderBy: [{ order: 'asc' }, { name: 'asc' }] }),
      this.prisma.workFolder.findMany({ where: { orgId }, orderBy: [{ order: 'asc' }, { name: 'asc' }] }),
      this.prisma.workList.findMany({
        where: { orgId },
        orderBy: { order: 'asc' },
        include: { statuses: { orderBy: { order: 'asc' } }, fields: { include: { options: true } } },
      }),
      this.prisma.workField.findMany({ where: { orgId, listId: null }, include: { options: true }, orderBy: { order: 'asc' } }),
      this.prisma.workTag.findMany({ where: { orgId }, orderBy: { name: 'asc' } }),
      this.prisma.workTask.groupBy({ by: ['listId'], where: { orgId, archived: false }, _count: true }),
      this.prisma.workTask.groupBy({ by: ['statusId'], where: { orgId, archived: false }, _count: true }),
      this.prisma.workTask.findMany({
        where: { orgId, assignee: { not: null }, list: listaVisivel() },
        distinct: ['assignee'], select: { assignee: true },
      }),
      /*
       * OS AGENTES VÊM DA MESMA CHAMADA QUE A ÁRVORE (fatia A4).
       *
       * A tela precisa deles para oferecer a quem entregar a tarefa e para dizer
       * ANTES DO CLIQUE quem pode receber (`podeAssumir`) — mesma disciplina de
       * `/atendimento`, que mostra a alçada antes de alguém tentar assinar. Numa
       * rota separada, a lista chegaria depois do quadro e o seletor apareceria
       * vazio no primeiro instante.
       */
      this.checkout.agentesParaEscolher(orgId),
      this.prisma.user.findMany({
        where: { orgId }, select: { id: true, name: true, email: true, isActive: true },
        orderBy: [{ name: 'asc' }, { email: 'asc' }],
      }),
    ]);
    const porLista = new Map(counts.map((c) => [c.listId, c._count]));
    const porStatus = new Map(byStatus.map((c) => [c.statusId, c._count]));
    // Pasta e lista arquivadas saem da árvore (21/10/2026); as tarefas delas ficam no banco.
    const escondidas = pastasEscondidas(folders);
    const pastasVivas = folders.filter((fo) => !escondidas.has(fo.id));
    // A lista do comercial mora no Funil vivo, não na árvore (adendo de 21/10/2026).
    const listasVivas = lists.filter((l) => !l.arquivadaEm && !(l.folderId && escondidas.has(l.folderId)) && !ehListaDoComercial(l));

    const toLista = (l: (typeof lists)[number]): TrabListaDto => ({
      id: l.id, name: l.name, order: l.order, externalId: l.externalId, spaceId: l.spaceId,
      natureza: l.natureza,
      total: porLista.get(l.id) ?? 0,
      statuses: l.statuses.map((s) => ({
        id: s.id, name: s.name, type: s.type, color: s.color, order: s.order,
        total: porStatus.get(s.id) ?? 0, limite: s.limite,
      })),
      fields: l.fields.sort((a, b) => a.order - b.order).map((f) => this.mapField(f)),
    });

    return {
      espacos: spaces.map((s) => ({ id: s.id, name: s.name, order: s.order, externalId: s.externalId })),
      folders: pastasVivas.map((fo) => ({
        id: fo.id, name: fo.name, order: fo.order,
        spaceId: fo.spaceId, parentId: fo.parentId, externalId: fo.externalId,
        lists: listasVivas.filter((l) => l.folderId === fo.id).map(toLista),
      })),
      listasSoltas: listasVivas.filter((l) => !l.folderId).map(toLista),
      camposGlobais: fields.map((f) => this.mapField(f)),
      tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
      responsaveis: users.map((u) => u.assignee!).sort(),
      agentes,
      pessoas,
    };
  }

  // ---------- espaços ----------

  criarEspaco(orgId: string, actorId: string, input: TrabEspacoCreateInput) {
    return this.logado(orgId, actorId, 'work.space.create', 'work_space', null, () =>
      this.semNomeRepetido(NOME_DE_ESPACO_REPETIDO, () =>
        this.prisma.workSpace.create({ data: { orgId, name: input.name } })),
    );
  }

  async editarEspaco(orgId: string, actorId: string, id: string, input: TrabEspacoUpdateInput) {
    await this.acharEspaco(orgId, id);
    return this.logado(orgId, actorId, 'work.space.update', 'work_space', id, () =>
      this.semNomeRepetido(NOME_DE_ESPACO_REPETIDO, () =>
        this.prisma.workSpace.update({ where: { id }, data: { name: input.name, order: input.order } })),
    );
  }

  async apagarEspaco(orgId: string, actorId: string, id: string) {
    await this.acharEspaco(orgId, id);
    const [pastas, listas] = await Promise.all([
      this.prisma.workFolder.count({ where: { orgId, spaceId: id } }),
      this.prisma.workList.count({ where: { orgId, spaceId: id } }),
    ]);
    if (pastas + listas > 0) throw new BadRequestException('Espaço tem pastas ou listas — mova ou apague antes.');
    return this.logado(orgId, actorId, 'work.space.delete', 'work_space', id, () =>
      this.prisma.workSpace.delete({ where: { id } }),
    );
  }

  // ---------- pastas ----------

  /**
   * Nasce no fim do nível, sob o cadeado da árvore, e recusa nome repetido entre
   * as irmãs sem diferença de maiúscula nem acento (A3, 21/10/2026).
   */
  async criarPasta(orgId: string, actorId: string, input: TrabPastaCreateInput) {
    const pai = await this.paiDaPasta(orgId, input);
    const nome = nomeDoNo(input.name);
    return this.logado(orgId, actorId, 'work.folder.create', 'work_folder', null, () =>
      this.semNomeRepetido(NOME_DE_PASTA_REPETIDO, () => this.naArvore(orgId, async (tx) => {
        await this.conferirNomeDaPasta(tx, orgId, nome, pai);
        const order = await this.fimDoNivelDePasta(tx, orgId, pai.parentId);
        return tx.workFolder.create({ data: { orgId, name: nome, order, ...pai } });
      })),
    );
  }

  /**
   * Renomeia, reordena e MOVE (`spaceId`/`parentId`, ver `TrabPastaUpdateSchema`).
   * Pôr dentro de outra pasta confere o ciclo sob o cadeado da árvore da empresa:
   * sem ele, "A para dentro de B" e "B para dentro de A" ao mesmo tempo passariam
   * cada um na sua conferência e fechariam o ciclo juntos.
   */
  async editarPasta(orgId: string, actorId: string, id: string, input: TrabPastaUpdateInput) {
    const antes = await this.prisma.workFolder.findFirst({ where: { id, orgId }, select: { spaceId: true, parentId: true, name: true, lists: { select: { id: true, name: true } } } });
    if (!antes) throw new NotFoundException('Pasta não encontrada');
    const move = input.spaceId !== undefined || input.parentId !== undefined;
    // A pasta Clientes que guarda a lista da implantação não muda de nome nem desce de nível (T1, revisão P2-4).
    const guardaAImplantacao = !!listaDaImplantacao([{ id, name: antes.name, parentId: antes.parentId, lists: antes.lists }]);
    if (guardaAImplantacao && ((input.name !== undefined && input.name !== antes.name) || (input.parentId !== undefined && input.parentId !== null))) {
      throw new BadRequestException(`A pasta ${PASTA_DA_IMPLANTACAO} guarda a lista ${LISTA_DA_IMPLANTACAO}, a porta da implantação de clientes: ela fica no primeiro nível, com este nome.`);
    }
    const pai = move ? await this.paiDaPasta(orgId, input) : null;
    const nome = input.name === undefined ? undefined : nomeDoNo(input.name);
    const data = { name: nome, order: input.order, ...pai };
    const renomeia = nome !== undefined && nome !== antes.name;
    const mudaDeNivel = !!pai && (pai.spaceId !== antes.spaceId || pai.parentId !== antes.parentId);
    const trilha = (pai || renomeia) ? {
      before: { ...(pai ? { spaceId: antes.spaceId, parentId: antes.parentId } : {}), ...(renomeia ? { name: antes.name } : {}) },
      after: { ...(pai ?? {}), ...(renomeia ? { name: nome } : {}) },
    } : undefined;
    return this.logado(orgId, actorId, 'work.folder.update', 'work_folder', id, () =>
      this.semNomeRepetido(NOME_DE_PASTA_REPETIDO, () => this.naArvore(orgId, async (tx) => {
        if (pai?.parentId) await this.conferirSemCiclo(tx, orgId, id, pai.parentId);
        // Nome repetido no MESMO nível (A3): o nível depois da mudança, sem contar a própria pasta.
        if (renomeia || mudaDeNivel) {
          await this.conferirNomeDaPasta(tx, orgId, nome ?? antes.name, pai ?? { spaceId: antes.spaceId, parentId: antes.parentId }, id);
        }
        return tx.workFolder.update({ where: { id }, data });
      })),
      trilha,
    );
  }

  /*
   * EXCLUIR PASTA (rodada de produção 1, P3, 21/10/2026). Só sai pasta sem lista
   * e sem pasta dentro que ainda APAREÇAM. Duas saídas, as duas chamadas
   * "excluir" na tela:
   *  - vazia de verdade (nenhuma lista nem pasta, nem arquivada): é apagada;
   *  - só com listas ou pastas já arquivadas: é ARQUIVADA. Apagá-la levaria junto
   *    o que foi arquivado (o banco recusa, RESTRICT), e arquivado é dado que fica.
   * As contagens só olham esta empresa. A escrita é condicionada: se uma lista
   * viva entrou entre a conferência e a escrita, nada muda (409).
   */
  async apagarPasta(orgId: string, actorId: string, id: string): Promise<TrabPastaExcluida> {
    await this.exigirGenteNoTrabalho(orgId, actorId);
    const pasta = await this.prisma.workFolder.findFirst({ where: { id, orgId, arquivadaEm: null }, select: { id: true, name: true } });
    if (!pasta) throw new NotFoundException('Pasta não encontrada');
    const [listas, filhas] = await Promise.all([
      this.prisma.workList.count({ where: { orgId, folderId: id, arquivadaEm: null } }),
      this.prisma.workFolder.count({ where: { orgId, parentId: id, arquivadaEm: null } }),
    ]);
    if (listas > 0) throw new BadRequestException(PASTA_COM_LISTAS);
    if (filhas > 0) throw new BadRequestException(PASTA_COM_PASTAS);
    const [guardadas, filhasGuardadas] = await Promise.all([
      this.prisma.workList.count({ where: { orgId, folderId: id } }),
      this.prisma.workFolder.count({ where: { orgId, parentId: id } }),
    ]);
    if (guardadas + filhasGuardadas === 0) {
      await this.logado(orgId, actorId, 'work.folder.delete', 'work_folder', id, () =>
        this.prisma.workFolder.delete({ where: { id } }).catch((e: unknown) => {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') throw new ConflictException(PASTA_MUDOU_NO_MEIO);
          throw e;
        }),
        { before: { name: pasta.name }, after: { modo: 'apagada' } },
      );
      return { id, modo: 'apagada' };
    }
    const agora = new Date();
    const r = await this.prisma.workFolder.updateMany({
      where: {
        id, orgId, arquivadaEm: null,
        lists: { none: { arquivadaEm: null } },
        children: { none: { arquivadaEm: null } },
      },
      data: { arquivadaEm: agora },
    });
    if (r.count !== 1) throw new ConflictException(PASTA_MUDOU_NO_MEIO);
    await this.audit.log({
      orgId, actorId, action: 'work.folder.archive', entityType: 'work_folder', entityId: id,
      before: { name: pasta.name, arquivadaEm: null },
      after: { modo: 'arquivada', arquivadaEm: agora.toISOString(), listasArquivadas: guardadas, pastasArquivadas: filhasGuardadas },
    });
    return { id, modo: 'arquivada' };
  }

  // ---------- listas ----------

  async criarLista(orgId: string, actorId: string, input: TrabListaCreateInput) {
    const pai = await this.paiDaLista(orgId, input);
    const nome = nomeDoNo(input.name);
    // Toda lista nasce com um pipeline mínimo (padrão ClickUp: open → custom → closed), no fim do
    // nível e com nome que não repete o de uma irmã (A3).
    return this.logado(orgId, actorId, 'work.list.create', 'work_list', null, () => this.naArvore(orgId, async (tx) => {
      await this.conferirNomeDaLista(tx, orgId, nome, pai);
      return criarListaPadraoNoBanco(tx, orgId, pai, nome, await this.fimDoNivelDeLista(tx, orgId, pai.folderId));
    }));
  }

  /** Mover lista troca só a linha da lista: as tarefas e os IDs delas ficam onde estão. */
  async editarLista(orgId: string, actorId: string, id: string, input: TrabListaUpdateInput) {
    // A lista do comercial não é da árvore: mora no Funil vivo e não se move, renomeia nem apaga daqui.
    const antes = await this.prisma.workList.findFirst({ where: { id, orgId, AND: [foraDaArvore()] }, select: { folderId: true, spaceId: true, name: true } });
    if (!antes) throw new NotFoundException('Lista não encontrada');
    const move = input.folderId !== undefined || input.spaceId !== undefined;
    /*
     * A LISTA DA IMPLANTAÇÃO NÃO SAI DO LUGAR (rodada do trabalho T1, 19/10/2026).
     * O item "Implantação de clientes" e o card do fechamento a acham pelo nome
     * dentro da pasta Clientes; movida ou renomeada, a tela fica vazia e o próximo
     * fechamento abre outra lista. Na homologação isso aconteceu pelo seletor de
     * pasta. Ela pode ganhar etapas e campos, não mudar de pasta nem de nome.
     */
    if ((move && input.folderId !== antes.folderId) || (input.name !== undefined && input.name !== antes.name)) {
      const pasta = antes.folderId ? await this.prisma.workFolder.findFirst({ where: { id: antes.folderId, orgId }, select: { id: true, name: true, parentId: true } }) : null;
      if (pasta && listaDaImplantacao([{ ...pasta, lists: [{ id, name: antes.name }] }])) {
        throw new BadRequestException(`A lista ${LISTA_DA_IMPLANTACAO} é a porta da implantação de clientes: ela fica na pasta ${PASTA_DA_IMPLANTACAO}, com este nome.`);
      }
    }
    const pai = move ? await this.paiDaLista(orgId, input) : null;
    const nome = input.name === undefined ? undefined : nomeDoNo(input.name);
    const renomeia = nome !== undefined && nome !== antes.name;
    const mudaDeNivel = !!pai && (pai.folderId !== antes.folderId || pai.spaceId !== antes.spaceId);
    const trilha = (pai || renomeia) ? {
      before: { ...(pai ? { folderId: antes.folderId, spaceId: antes.spaceId } : {}), ...(renomeia ? { name: antes.name } : {}) },
      after: { ...(pai ?? {}), ...(renomeia ? { name: nome } : {}) },
    } : undefined;
    return this.logado(orgId, actorId, 'work.list.update', 'work_list', id, () => this.naArvore(orgId, async (tx) => {
      if (renomeia || mudaDeNivel) {
        await this.conferirNomeDaLista(tx, orgId, nome ?? antes.name, pai ?? { folderId: antes.folderId, spaceId: antes.spaceId }, id);
      }
      // Lista que muda de lugar sem ordem pedida vai para o fim do nível novo (arrastar para a pasta, A3).
      const order = input.order ?? (mudaDeNivel ? await this.fimDoNivelDeLista(tx, orgId, pai!.folderId) : undefined);
      return tx.workList.update({ where: { id }, data: { name: nome, order, ...pai } });
    }), trilha);
  }

  /*
   * EXCLUIR LISTA (rodada de produção 1, P3, 21/10/2026). A pessoa escreve o nome
   * da lista para confirmar, e a lista só sai vazia ou com TODAS as tarefas
   * arquivadas. Duas saídas, as duas chamadas "excluir" na tela:
   *  - vazia de verdade (nenhuma tarefa, nem arquivada): é apagada, com as etapas
   *    e os campos dela (cascata do banco); não havia trabalho nenhum ali;
   *  - com tarefas arquivadas: a LISTA é arquivada (`arquivadaEm`). Apagá-la
   *    exigiria apagar as tarefas (o banco recusa, RESTRICT), e a regra da casa é
   *    não apagar trabalho. Ela some da árvore, de Todas e dos contadores; as
   *    tarefas ficam no banco e a leitura por id continua.
   * A auditoria leva quantas tarefas arquivadas iam junto. A lista da implantação
   * não sai nunca. A escrita é condicionada: tarefa viva que entrou no meio = 409.
   */
  /** A segunda conferência de `SoGenteNoTrabalhoGuard`: o papel relido no banco, não o do token. */
  private async exigirGenteNoTrabalho(orgId: string, actorId: string): Promise<void> {
    const doBanco = await lerAprovador(this.prisma, actorId, orgId);
    if (!doBanco || !doBanco.ativo) throw new ForbiddenException('Quem exclui precisa ser um usuário ativo desta empresa.');
    if (temPapelDeMaquina(doBanco.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA_NO_TRABALHO);
  }

  async apagarLista(orgId: string, actorId: string, id: string, input: TrabListaExcluirInput): Promise<TrabListaExcluida> {
    await this.exigirGenteNoTrabalho(orgId, actorId);
    const lista = await this.prisma.workList.findFirst({ where: { id, orgId, arquivadaEm: null, AND: [foraDaArvore()] }, select: { id: true, name: true, folderId: true } });
    if (!lista) throw new NotFoundException('Lista não encontrada');
    if (await this.ehListaDaImplantacao(orgId, id)) throw new BadRequestException(LISTA_DA_IMPLANTACAO_FICA);
    if (nomeParaConfirmar(input.confirmarNome) !== nomeParaConfirmar(lista.name)) {
      throw new BadRequestException('Para excluir, escreva o nome da lista como ele aparece.');
    }
    const [vivas, arquivadas, valoresDosCampos] = await Promise.all([
      this.prisma.workTask.count({ where: { orgId, listId: id, archived: false } }),
      this.prisma.workTask.count({ where: { orgId, listId: id, archived: true } }),
      // Os campos próprios da lista caem em cascata com ela, e os valores junto. Depois de
      // "mover as tarefas e excluir" (A3), a tarefa movida ainda guarda valor de campo desta
      // lista: apagar a lista apagaria esse dado. Com valor guardado, a lista é ARQUIVADA.
      this.prisma.workFieldValue.count({ where: { orgId, field: { listId: id } } }),
    ]);
    if (vivas > 0) throw new BadRequestException(`A lista tem ${vivas} tarefa${vivas === 1 ? '' : 's'} sem arquivar. Arquive todas antes de excluir.`);
    const antes = { name: lista.name, folderId: lista.folderId };
    if (arquivadas === 0 && valoresDosCampos === 0) {
      const r = await this.prisma.workList.deleteMany({
        where: { id, orgId, arquivadaEm: null, tasks: { none: {} }, fields: { none: { values: { some: {} } } } },
      }).catch((e: unknown) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') throw new ConflictException(LISTA_MUDOU_NO_MEIO);
        throw e;
      });
      if (r.count !== 1) throw new ConflictException(LISTA_MUDOU_NO_MEIO);
      await this.audit.log({
        orgId, actorId, action: 'work.list.delete', entityType: 'work_list', entityId: id,
        before: antes, after: { modo: 'apagada', tarefasArquivadas: 0 },
      });
      return { id, modo: 'apagada', tarefasArquivadas: 0 };
    }
    const agora = new Date();
    const r = await this.prisma.workList.updateMany({
      where: { id, orgId, arquivadaEm: null, tasks: { none: { archived: false } } },
      data: { arquivadaEm: agora },
    });
    if (r.count !== 1) throw new ConflictException(LISTA_MUDOU_NO_MEIO);
    await this.audit.log({
      orgId, actorId, action: 'work.list.archive', entityType: 'work_list', entityId: id,
      before: { ...antes, arquivadaEm: null },
      after: { modo: 'arquivada', arquivadaEm: agora.toISOString(), tarefasArquivadas: arquivadas },
    });
    return { id, modo: 'arquivada', tarefasArquivadas: arquivadas };
  }

  /*
   * ARQUIVAR TODAS AS TAREFAS DA LISTA (P3): o passo que a tela oferece antes de
   * excluir. Arquivar não apaga nada (a tarefa some das listagens e volta pelo
   * filtro "arquivadas"). Condicionada ao número que a tela mostrou: se a lista
   * mudou (`esperadas` diferente), nada é arquivado e a resposta é 409. Tudo numa
   * transação, com uma linha de auditoria por tarefa (a atividade da tarefa mostra)
   * e uma da lista, com a contagem. A lista da implantação fica de fora: os
   * cartões dela são clientes, e cada um se arquiva sozinho, de propósito.
   */
  async arquivarTarefasDaLista(orgId: string, actorId: string, id: string, input: TrabListaArquivarTarefasInput): Promise<TrabListaTarefasArquivadas> {
    await this.exigirGenteNoTrabalho(orgId, actorId);
    const lista = await this.prisma.workList.findFirst({ where: { id, orgId, arquivadaEm: null, AND: [foraDaArvore()] }, select: { id: true, name: true } });
    if (!lista) throw new NotFoundException('Lista não encontrada');
    if (await this.ehListaDaImplantacao(orgId, id)) throw new BadRequestException(LISTA_DA_IMPLANTACAO_FICA);
    await exigirAcessoAtual(this.prisma, orgId, actorId, ['tarefas.editar']);
    const arquivadas = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`work-lista:${id}`}))`;
      const alvo = await tx.workTask.findMany({ where: { orgId, listId: id, archived: false }, select: { id: true, updatedAt: true } });
      if (alvo.length !== input.esperadas) throw new ConflictException(LISTA_MUDOU_NO_MEIO);
      if (alvo.length === 0) return 0;
      const agora = new Date();
      for (const t of alvo) {
        const updatedAt = new Date(Math.max(agora.getTime(), t.updatedAt.getTime() + 1));
        const r = await tx.workTask.updateMany({ where: { id: t.id, orgId, archived: false, updatedAt: t.updatedAt }, data: { archived: true, updatedAt } });
        if (r.count !== 1) throw new ConflictException(LISTA_MUDOU_NO_MEIO);
        await this.audit.log({
          orgId, actorId, action: 'work.task.update', entityType: 'work_task', entityId: t.id,
          before: { archived: false }, after: { archived: true }, metadata: { origem: 'lista.arquivar-tarefas', listId: id },
        }, tx);
      }
      await this.audit.log({
        orgId, actorId, action: 'work.list.tasks.archive', entityType: 'work_list', entityId: id,
        before: { name: lista.name, vivas: alvo.length }, after: { vivas: 0, arquivadasAgora: alvo.length },
      }, tx);
      await exigirAcessoAtual(tx, orgId, actorId, ['tarefas.editar']);
      return alvo.length;
    }, { timeout: 60_000 });
    return { id, arquivadas };
  }

  /*
   * APAGAR PASTA LEVANDO O QUE ESTÁ DENTRO (A3, 21/10/2026). A pessoa escolhe para
   * onde vão as listas e as pastas que aparecem dentro dela (outra pasta ou "Sem
   * pasta") e só então a pasta sai. Nada é apagado junto sem a pessoa ver: as
   * listas e as pastas mudam de lugar com os mesmos ids, as tarefas não mudam.
   * Depois de esvaziada, a pasta segue a regra do P3: sem nada dentro é apagada;
   * se ainda guarda listas ou pastas arquivadas, é arquivada (elas ficam com ela).
   *
   * Uma transação sob o cadeado da árvore, condicionada ao que a tela mostrou
   * (`esperadas`): lista ou pasta que entrou ou saiu no meio = 409 e nada muda.
   * O destino precisa aparecer na árvore e não pode estar dentro da pasta que sai;
   * nome repetido no destino é recusado com o nome. A pasta Clientes que guarda a
   * lista da implantação não sai. Auditoria por item movido e uma da pasta, com as
   * contagens. Só de gente (o guarda pelo token e `exigirGenteNoTrabalho` pelo banco).
   */
  async excluirPastaComDestino(orgId: string, actorId: string, id: string, input: TrabPastaExcluirComDestinoInput): Promise<TrabPastaExcluidaComDestino> {
    await this.exigirGenteNoTrabalho(orgId, actorId);
    return this.naArvore(orgId, async (tx) => {
      const todas = await tx.workFolder.findMany({
        where: { orgId }, select: { id: true, name: true, parentId: true, spaceId: true, arquivadaEm: true },
      });
      const escondidas = pastasEscondidas(todas);
      const pasta = todas.find((p) => p.id === id);
      if (!pasta || escondidas.has(id)) throw new NotFoundException('Pasta não encontrada');
      const listas = await tx.workList.findMany({
        where: { orgId, folderId: id }, select: { id: true, name: true, externalId: true, arquivadaEm: true, spaceId: true },
        orderBy: [{ order: 'asc' }, { name: 'asc' }],
      });
      const listasVivas = listas.filter((l) => !l.arquivadaEm);
      if (!pasta.parentId && listaDaImplantacao([{ ...pasta, lists: listasVivas }])) throw new BadRequestException(TRAB_PASTA_DA_IMPLANTACAO_PROTEGIDA);
      const filhasVivas = todas.filter((p) => p.parentId === id && !p.arquivadaEm);
      // A tela não vê a lista do comercial, então ela não entra na conta (mas muda de lugar junto).
      const listasNaTela = listasVivas.filter((l) => !ehListaDoComercial(l));
      if (listasNaTela.length !== input.esperadas.listas || filhasVivas.length !== input.esperadas.pastas) {
        throw new ConflictException(PASTA_MUDOU_NO_MEIO);
      }
      const temDentro = listasVivas.length + filhasVivas.length > 0;
      if (temDentro && !input.destino) {
        throw new BadRequestException('A pasta tem listas ou pastas dentro. Escolha para onde elas vão antes de apagar.');
      }

      let paiDasListas: PaiDaLista = { folderId: null, spaceId: null };
      let paiDasPastas: PaiDaPasta = { spaceId: null, parentId: null };
      let destinoNoRastro: { folderId: string; nome: string } | { semPasta: true } | null = null;
      if (temDentro && input.destino) {
        if ('folderId' in input.destino) {
          const alvo = todas.find((p) => p.id === (input.destino as { folderId: string }).folderId);
          if (!alvo || escondidas.has(alvo.id)) throw new NotFoundException('Pasta de destino não encontrada');
          // Subindo pelas mães do destino: se passar pela pasta que sai, o destino está dentro dela.
          const maeDe = new Map(todas.map((p) => [p.id, p.parentId]));
          for (let atual: string | null = alvo.id; atual; atual = maeDe.get(atual) ?? null) {
            if (atual === id) throw new BadRequestException('O destino não pode ser a própria pasta nem uma pasta que está dentro dela.');
          }
          paiDasListas = { folderId: alvo.id, spaceId: null };
          paiDasPastas = { spaceId: null, parentId: alvo.id };
          destinoNoRastro = { folderId: alvo.id, nome: alvo.name };
        } else {
          // "Sem pasta": as listas ficam soltas e as pastas sobem ao topo, no espaço da pasta de topo de onde saem.
          let topo = pasta;
          for (let i = 0; topo.parentId && i < 50; i++) topo = todas.find((p) => p.id === topo.parentId) ?? { ...topo, parentId: null };
          paiDasListas = { folderId: null, spaceId: topo.spaceId };
          paiDasPastas = { spaceId: topo.spaceId, parentId: null };
          destinoNoRastro = { semPasta: true };
        }
      }

      let ordemDaLista = temDentro ? await this.fimDoNivelDeLista(tx, orgId, paiDasListas.folderId) : 0;
      for (const l of listasVivas) {
        if (!ehListaDoComercial(l)) {
          try {
            await this.conferirNomeDaLista(tx, orgId, l.name, paiDasListas, l.id);
          } catch (e) {
            if (e instanceof ConflictException) throw new ConflictException(`No destino já existe uma lista chamada "${l.name}". Renomeie uma delas antes de apagar a pasta.`);
            throw e;
          }
        }
        const r = await tx.workList.updateMany({
          where: { id: l.id, orgId, folderId: id, arquivadaEm: null },
          data: { ...paiDasListas, order: ordemDaLista++ },
        });
        if (r.count !== 1) throw new ConflictException(PASTA_MUDOU_NO_MEIO);
        await this.audit.log({
          orgId, actorId, action: 'work.list.update', entityType: 'work_list', entityId: l.id,
          before: { folderId: id, spaceId: l.spaceId }, after: { ...paiDasListas }, metadata: { origem: 'pasta.excluir', pastaId: id },
        }, tx);
      }
      let ordemDaPasta = filhasVivas.length ? await this.fimDoNivelDePasta(tx, orgId, paiDasPastas.parentId) : 0;
      for (const f of filhasVivas) {
        try {
          await this.conferirNomeDaPasta(tx, orgId, f.name, paiDasPastas, f.id);
        } catch (e) {
          if (e instanceof ConflictException) throw new ConflictException(`No destino já existe uma pasta chamada "${f.name}". Renomeie uma delas antes de apagar a pasta.`);
          throw e;
        }
        const r = await this.semNomeRepetido(NOME_DE_PASTA_REPETIDO, () => tx.workFolder.updateMany({
          where: { id: f.id, orgId, parentId: id, arquivadaEm: null },
          data: { ...paiDasPastas, order: ordemDaPasta++ },
        }));
        if (r.count !== 1) throw new ConflictException(PASTA_MUDOU_NO_MEIO);
        await this.audit.log({
          orgId, actorId, action: 'work.folder.update', entityType: 'work_folder', entityId: f.id,
          before: { spaceId: f.spaceId, parentId: id }, after: { ...paiDasPastas }, metadata: { origem: 'pasta.excluir', pastaId: id },
        }, tx);
      }

      const listasMovidas = listasNaTela.length;
      const pastasMovidas = filhasVivas.length;
      const [guardadas, filhasGuardadas] = await Promise.all([
        tx.workList.count({ where: { orgId, folderId: id } }),
        tx.workFolder.count({ where: { orgId, parentId: id } }),
      ]);
      const contas = { listasMovidas, pastasMovidas, destino: destinoNoRastro };
      if (guardadas + filhasGuardadas === 0) {
        await tx.workFolder.delete({ where: { id } });
        await this.audit.log({
          orgId, actorId, action: 'work.folder.delete', entityType: 'work_folder', entityId: id,
          before: { name: pasta.name }, after: { modo: 'apagada', ...contas },
        }, tx);
        return { id, modo: 'apagada' as const, listasMovidas, pastasMovidas };
      }
      const agora = new Date();
      const r = await tx.workFolder.updateMany({
        where: { id, orgId, arquivadaEm: null, lists: { none: { arquivadaEm: null } }, children: { none: { arquivadaEm: null } } },
        data: { arquivadaEm: agora },
      });
      if (r.count !== 1) throw new ConflictException(PASTA_MUDOU_NO_MEIO);
      await this.audit.log({
        orgId, actorId, action: 'work.folder.archive', entityType: 'work_folder', entityId: id,
        before: { name: pasta.name, arquivadaEm: null },
        after: { modo: 'arquivada', arquivadaEm: agora.toISOString(), listasArquivadas: guardadas, pastasArquivadas: filhasGuardadas, ...contas },
      }, tx);
      return { id, modo: 'arquivada' as const, listasMovidas, pastasMovidas };
    });
  }

  /*
   * MOVER AS TAREFAS DE UMA LISTA PARA OUTRA (A3, 21/10/2026): o caminho que a tela
   * oferece antes de apagar uma lista com tarefa ativa, ao lado de "arquivar todas".
   * Só as ativas mudam (as arquivadas ficam e, ao apagar, a lista é arquivada com
   * elas, como no P3). Os ids não mudam; a etapa no destino é a de mesmo nome,
   * senão a primeira do mesmo tipo, senão a primeira (`etapaNoDestino`), e a
   * resposta diz quantas mudaram de etapa. O destino precisa aparecer no Trabalho,
   * ser de natureza `tarefas`, não ser a lista do comercial nem a da implantação
   * (porta única). Sob o cadeado da árvore e o da lista, condicionada ao número
   * que a tela mostrou e à versão de cada tarefa; auditada; só de gente.
   */
  async moverTarefasDaLista(orgId: string, actorId: string, id: string, input: TrabListaMoverTarefasInput): Promise<TrabListaTarefasMovidas> {
    await this.exigirGenteNoTrabalho(orgId, actorId);
    const origem = await this.prisma.workList.findFirst({ where: { id, orgId, arquivadaEm: null, AND: [foraDaArvore()] }, select: { id: true, name: true } });
    if (!origem) throw new NotFoundException('Lista não encontrada');
    if (await this.ehListaDaImplantacao(orgId, id)) throw new BadRequestException(LISTA_DA_IMPLANTACAO_FICA);
    if (input.destinoId === id) throw new BadRequestException('Escolha outra lista para receber as tarefas.');
    const destino = await this.prisma.workList.findFirst({
      where: { id: input.destinoId, orgId },
      select: { id: true, name: true, externalId: true, natureza: true, arquivadaEm: true },
    });
    if (!destino) throw new NotFoundException('Lista de destino não encontrada');
    const visivel = await this.prisma.workList.count({ where: { id: destino.id, orgId, AND: [listaVisivel()] } });
    if (destino.arquivadaEm || visivel !== 1) throw new BadRequestException('A lista de destino está arquivada. Escolha uma lista que aparece no Trabalho.');
    if (ehListaDoComercial(destino)) throw new BadRequestException('As tarefas do comercial moram no Funil vivo: a lista do comercial não recebe tarefas do Trabalho.');
    if (destino.natureza === WorkListaNatureza.cadastro) throw new BadRequestException('A lista de destino é de cadastro, não de tarefas. Escolha uma lista de tarefas.');
    if (await this.ehListaDaImplantacao(orgId, destino.id)) throw new BadRequestException(PORTA_DA_IMPLANTACAO);
    await exigirAcessoAtual(this.prisma, orgId, actorId, ['tarefas.editar']);

    const r = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`work-arvore:${orgId}`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`work-lista:${id}`}))`;
      const ainda = await tx.workList.count({ where: { id: destino.id, orgId, arquivadaEm: null } });
      if (ainda !== 1) throw new ConflictException(LISTA_MUDOU_NO_MEIO);
      const etapas = await tx.workStatus.findMany({ where: { listId: destino.id, orgId }, orderBy: { order: 'asc' }, select: { id: true, name: true, type: true } });
      if (etapas.length === 0) throw new BadRequestException('A lista de destino não tem etapas. Crie uma etapa nela antes.');
      const alvo = await tx.workTask.findMany({
        where: { orgId, listId: id, archived: false },
        select: { id: true, updatedAt: true, status: { select: { name: true, type: true } } },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      });
      if (alvo.length !== input.esperadas) throw new ConflictException(LISTA_MUDOU_NO_MEIO);
      const agora = new Date();
      let mudaramDeEtapa = 0;
      for (const t of alvo) {
        const etapa = etapaNoDestino(t.status, etapas)!;
        if (chaveDoNomeNoNivel(etapa.name) !== chaveDoNomeNoNivel(t.status.name)) mudaramDeEtapa += 1;
        const updatedAt = new Date(Math.max(agora.getTime(), t.updatedAt.getTime() + 1));
        const u = await tx.workTask.updateMany({
          where: { id: t.id, orgId, listId: id, archived: false, updatedAt: t.updatedAt },
          data: { listId: destino.id, statusId: etapa.id, updatedAt },
        });
        if (u.count !== 1) throw new ConflictException(LISTA_MUDOU_NO_MEIO);
        await this.audit.log({
          orgId, actorId, action: 'work.task.update', entityType: 'work_task', entityId: t.id,
          before: { listId: id, status: t.status.name }, after: { listId: destino.id, status: etapa.name },
          metadata: { origem: 'lista.mover-tarefas', listId: id },
        }, tx);
      }
      await this.audit.log({
        orgId, actorId, action: 'work.list.tasks.move', entityType: 'work_list', entityId: id,
        before: { name: origem.name, vivas: alvo.length },
        after: { vivas: 0, destinoId: destino.id, destino: destino.name, movidas: alvo.length, mudaramDeEtapa },
      }, tx);
      await exigirAcessoAtual(tx, orgId, actorId, ['tarefas.editar']);
      return { movidas: alvo.length, mudaramDeEtapa };
    }, { timeout: 60_000 });
    return { id, destinoId: destino.id, ...r };
  }

  /*
   * A ORDEM DE UM NÍVEL DA ÁRVORE (A3, 21/10/2026): arrastar pasta ou lista, ou
   * Alt+↑/↓. Regrava a posição (0, 1, 2…) dos irmãos que aparecem naquele nível,
   * sob o cadeado da árvore. `ids` precisa ser exatamente esse conjunto, sem faltar
   * nem sobrar (o que a tela viu é o que muda); senão 400 e nada muda. As pastas de
   * topo e as listas soltas são um nível cada, como a árvore as mostra.
   */
  async ordenarArvore(orgId: string, actorId: string, input: TrabArvoreOrdemInput): Promise<{ ok: true }> {
    if (new Set(input.ids).size !== input.ids.length) throw new BadRequestException(TRAB_ORDEM_FORA_DO_NIVEL);
    await this.naArvore(orgId, async (tx) => {
      const todas = await tx.workFolder.findMany({ where: { orgId }, select: { id: true, parentId: true, arquivadaEm: true, order: true, name: true } });
      const escondidas = pastasEscondidas(todas);
      if (input.paiId && (!todas.some((p) => p.id === input.paiId) || escondidas.has(input.paiId))) throw new NotFoundException('Pasta não encontrada');
      let irmaos: { id: string; order: number; name: string }[];
      if (input.tipo === 'pasta') {
        irmaos = todas.filter((p) => p.parentId === input.paiId && !escondidas.has(p.id));
      } else {
        const listas = await tx.workList.findMany({
          where: { orgId, folderId: input.paiId, arquivadaEm: null }, select: { id: true, order: true, name: true, externalId: true },
        });
        irmaos = listas.filter((l) => !ehListaDoComercial(l));
      }
      const conjunto = new Set(irmaos.map((i) => i.id));
      if (irmaos.length !== input.ids.length || input.ids.some((i) => !conjunto.has(i))) throw new BadRequestException(TRAB_ORDEM_FORA_DO_NIVEL);
      const antes = [...irmaos].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)).map((i) => i.id);
      for (const [order, itemId] of input.ids.entries()) {
        if (input.tipo === 'pasta') await tx.workFolder.updateMany({ where: { id: itemId, orgId }, data: { order } });
        else await tx.workList.updateMany({ where: { id: itemId, orgId }, data: { order } });
      }
      await this.audit.log({
        orgId, actorId, action: 'work.tree.reorder', entityType: input.tipo === 'pasta' ? 'work_folder' : 'work_list',
        entityId: input.paiId ?? input.ids[0], before: { ids: antes }, after: { tipo: input.tipo, paiId: input.paiId, ids: input.ids },
      }, tx);
    });
    return { ok: true };
  }

  // ---------- statuses (pipeline por lista) ----------

  async criarStatus(orgId: string, actorId: string, listId: string, input: { name: string; type: WorkStatusType; color?: string; limite?: number | null }) {
    await this.achar(this.prisma.workList, orgId, listId, 'Lista');
    const max = await this.prisma.workStatus.aggregate({ where: { listId }, _max: { order: true } });
    return this.logado(orgId, actorId, 'work.status.create', 'work_status', null, () =>
      this.prisma.workStatus.create({
        data: {
          listId, name: input.name, type: input.type, color: input.color ?? '#ee5e99', order: (max._max.order ?? 0) + 1,
          limite: input.limite ?? null,
        },
      }),
    );
  }

  async editarStatus(orgId: string, actorId: string, id: string, input: { name?: string; type?: WorkStatusType; color?: string; order?: number; limite?: number | null }) {
    const st = await this.prisma.workStatus.findFirst({ where: { id, list: { orgId } } });
    if (!st) throw new NotFoundException('Status não encontrado');
    return this.logado(orgId, actorId, 'work.status.update', 'work_status', id, () =>
      this.prisma.workStatus.update({ where: { id }, data: input }),
    );
  }

  async apagarStatus(orgId: string, actorId: string, id: string) {
    const st = await this.prisma.workStatus.findFirst({ where: { id, list: { orgId } } });
    if (!st) throw new NotFoundException('Status não encontrado');
    const emUso = await this.prisma.workTask.count({ where: { statusId: id } });
    if (emUso > 0) throw new BadRequestException(`Status em uso por ${emUso} tarefa(s) — mova-as antes.`);
    return this.logado(orgId, actorId, 'work.status.delete', 'work_status', id, () =>
      this.prisma.workStatus.delete({ where: { id } }),
    );
  }

  // ---------- campos personalizados + opções ----------

  async criarCampo(orgId: string, actorId: string, input: { listId?: string | null; name: string; type: WorkFieldType }) {
    if (input.listId) await this.achar(this.prisma.workList, orgId, input.listId, 'Lista');
    return this.logado(orgId, actorId, 'work.field.create', 'work_field', null, () =>
      this.prisma.workField.create({ data: { orgId, listId: input.listId ?? null, name: input.name, type: input.type } }),
    );
  }

  async editarCampo(orgId: string, actorId: string, id: string, input: { name?: string; order?: number }) {
    await this.achar(this.prisma.workField, orgId, id, 'Campo');
    return this.logado(orgId, actorId, 'work.field.update', 'work_field', id, () =>
      this.prisma.workField.update({ where: { id }, data: input }),
    );
  }

  async apagarCampo(orgId: string, actorId: string, id: string) {
    await this.achar(this.prisma.workField, orgId, id, 'Campo');
    return this.logado(orgId, actorId, 'work.field.delete', 'work_field', id, () =>
      this.prisma.workField.delete({ where: { id } }), // valores caem em cascata
    );
  }

  async criarOpcao(orgId: string, actorId: string, fieldId: string, input: { name: string; color?: string }) {
    const campo = (await this.achar(this.prisma.workField, orgId, fieldId, 'Campo')) as { type: WorkFieldType };
    // O2 da ROOT-06a-IMPL: a opção ficaria sem efeito, porque o valor `moeda`
    // recusa `optionId` e o importador recusa campo `moeda` com opções.
    if (campo.type === WorkFieldType.moeda) throw new BadRequestException('Campo moeda não tem opções.');
    const max = await this.prisma.workFieldOption.aggregate({ where: { fieldId }, _max: { order: true } });
    return this.logado(orgId, actorId, 'work.option.create', 'work_field_option', null, () =>
      this.prisma.workFieldOption.create({
        data: { fieldId, name: input.name, color: input.color ?? '#87909e', order: (max._max.order ?? 0) + 1 },
      }),
    );
  }

  async editarOpcao(orgId: string, actorId: string, id: string, input: { name?: string; color?: string; order?: number }) {
    const opt = await this.prisma.workFieldOption.findFirst({ where: { id, field: { orgId } } });
    if (!opt) throw new NotFoundException('Opção não encontrada');
    return this.logado(orgId, actorId, 'work.option.update', 'work_field_option', id, () =>
      this.prisma.workFieldOption.update({ where: { id }, data: input }),
    );
  }

  async apagarOpcao(orgId: string, actorId: string, id: string) {
    const opt = await this.prisma.workFieldOption.findFirst({ where: { id, field: { orgId } } });
    if (!opt) throw new NotFoundException('Opção não encontrada');
    return this.logado(orgId, actorId, 'work.option.delete', 'work_field_option', id, () =>
      this.prisma.workFieldOption.delete({ where: { id } }),
    );
  }

  // ---------- etiquetas ----------

  criarTag(orgId: string, actorId: string, input: { name: string; color?: string }) {
    return this.logado(orgId, actorId, 'work.tag.create', 'work_tag', null, () =>
      this.prisma.workTag.create({ data: { orgId, name: input.name, color: input.color ?? '#5f55ee' } }),
    );
  }

  async editarTag(orgId: string, actorId: string, id: string, input: { name?: string; color?: string }) {
    await this.achar(this.prisma.workTag, orgId, id, 'Etiqueta');
    return this.logado(orgId, actorId, 'work.tag.update', 'work_tag', id, () =>
      this.prisma.workTag.update({ where: { id }, data: input }),
    );
  }

  async apagarTag(orgId: string, actorId: string, id: string) {
    await this.achar(this.prisma.workTag, orgId, id, 'Etiqueta');
    return this.logado(orgId, actorId, 'work.tag.delete', 'work_tag', id, () =>
      this.prisma.workTag.delete({ where: { id } }),
    );
  }

  // ---------- tarefas ----------

  /**
   * `agentes` é o mapa de `agentes-da-casa.ts` — id -> agente DESTA empresa.
   * Obrigatório de propósito: parâmetro opcional faria o chamador que esquecesse
   * de carregá-lo publicar toda tarefa como "sem agente", que é uma tela
   * mentindo em silêncio. Mapa vazio é resposta válida (nenhuma tarefa travada);
   * mapa ausente, não.
   *
   * `minutos` segue a mesma regra, pelo mesmo motivo: um chamador que esquecesse
   * a soma publicaria "0 h" em cliente que consumiu quarenta.
   */
  private mapTask(
    t: TaskRow,
    now: Date,
    agentes: Map<string, AgenteDaCasa>,
    minutos: Map<string, number>,
    clientes: Map<string, string>,
  ): TrabTarefaResumo {
    const agente = t.agenteId ? agentes.get(t.agenteId) ?? null : null;
    return {
      id: t.id, listId: t.listId, title: t.title,
      statusId: t.statusId, statusName: t.status.name, statusType: t.status.type, statusColor: t.status.color,
      priority: t.priority, assignee: t.assignee,
      assigneeUserId: t.assigneeUserId,
      assigneeUserName: t.assigneeUser?.name ?? null,
      assigneeUserEmail: t.assigneeUser?.email ?? null,
      assigneeUserIsActive: t.assigneeUser?.isActive ?? null,
      updatedAt: t.updatedAt.toISOString(),
      agenteId: t.agenteId, agenteSlug: agente?.slug ?? null, agenteNome: agente?.nome ?? null,
      agenteEm: t.agenteEm?.toISOString() ?? null,
      statusDesde: t.statusDesde?.toISOString() ?? null,
      minutos: minutos.get(t.id) ?? 0,
      dueDate: t.dueDate?.toISOString() ?? null, startDate: t.startDate?.toISOString() ?? null,
      overdue: !!t.dueDate && t.dueDate < now && t.status.type !== 'closed',
      parentId: t.parentId, subtasks: t._count.subtasks, comments: t._count.comments,
      externalId: t.externalId, externalUrl: t.externalUrl, archived: t.archived, order: t.order,
      tags: t.tags.map((tg) => ({ id: tg.id, name: tg.name, color: tg.color })),
      values: t.values.map((v) => ({
        fieldId: v.fieldId, fieldName: v.field.name, type: v.field.type,
        optionId: v.optionId, optionName: v.option?.name ?? null, optionColor: v.option?.color ?? null,
        value: v.value,
      })),
      // O nome vem de `nomesDosClientes` (escopado por empresa); ponteiro que não resolve = sem cliente.
      clienteId: t.clienteId && clientes.has(t.clienteId) ? t.clienteId : null,
      clienteNome: t.clienteId ? clientes.get(t.clienteId) ?? null : null,
      outrosResponsaveisIds: t.outrosResponsaveisIds ?? [],
      recorrencia: regraDeRepeticao(t.recorrencia),
      listName: t.list?.name,
    };
  }

  async tarefas(
    orgId: string,
    f: WorkTaskQuery,
  ): Promise<TrabTarefaLista> {
    const page = f.page ?? 1;
    const limit = f.limit ?? 500;
    const where: Prisma.WorkTaskWhereInput = { orgId, archived: f.arquivadas ? undefined : false };
    // Tarefa de lista arquivada (ou de pasta arquivada) não aparece em listagem nenhuma (21/10/2026).
    const visivel = tarefaDeListaVisivel();
    if (f.listId) where.listId = f.listId;
    if (f.listIds) where.listId = { in: f.listIds };
    if (f.listExternalIds) where.list = { orgId, externalId: { in: f.listExternalIds } };
    if (f.statusId) where.statusId = f.statusId;
    if (f.assignee) where.assignee = f.assignee;
    // Vários responsáveis (versão final): a pessoa é responsável pela tarefa sendo a
    // principal ou uma das demais. A identidade continua sendo a CONTA, nunca o nome.
    if (f.assigneeUserId) where.OR = [{ assigneeUserId: f.assigneeUserId }, { outrosResponsaveisIds: { has: f.assigneeUserId } }];
    if (f.semResponsavel) where.assigneeUserId = null;
    /*
     * "TODAS AS TAREFAS" (versão final, F4): o Everything do ClickUp no Trabalho. As
     * mesmas regras da visão do Lucas para não haver card repetido nem cadastro como
     * tarefa: só listas de natureza `tarefas`; subtarefa fica dentro da tarefa (sobe só
     * a que pende de um CADASTRO, a feita pela ficha do cliente); o cartão-depósito do
     * Granola não entra. O `externalId` nulo tem ramo próprio (NULL NOT IN é desconhecido).
     */
    if (f.todas) {
      where.list = { ...(where.list as Prisma.WorkListWhereInput | undefined), natureza: 'tarefas' };
      where.AND = [
        { OR: [{ parentId: null }, { parent: { list: { natureza: 'cadastro' } } }] },
        { OR: [{ externalId: null }, { externalId: { notIn: [...CARTOES_QUE_NAO_SAO_TAREFA] } }] },
        visivel,
        // As tarefas do comercial moram no Funil vivo, fora da árvore e de Todas (adendo de 21/10/2026).
        { list: foraDaArvore() },
      ];
      /*
       * O SEGMENTO (rodada da interface U3): "Todas" recortada por uma pasta de topo,
       * com as subpastas dentro, ou só as listas soltas. A árvore é lida da EMPRESA
       * da sessão: pasta de outra empresa vira conjunto vazio, e nada aparece.
       */
      if (f.segmentoId === SEGMENTO_SEM_PASTA) {
        where.list = { ...(where.list as Prisma.WorkListWhereInput), folderId: null };
      } else if (f.segmentoId) {
        const pastas = await this.prisma.workFolder.findMany({ where: { orgId }, select: { id: true, parentId: true } });
        where.list = { ...(where.list as Prisma.WorkListWhereInput), folderId: { in: [...pastaComSubpastas(pastas, f.segmentoId)] } };
      }
    } else {
      where.AND = [visivel];
    }
    if (f.tagId) where.tags = { some: { id: f.tagId } };
    if (f.q) where.title = { contains: f.q, mode: 'insensitive' };
    if (f.opcao) where.values = { some: { optionId: f.opcao } }; // filtro por opção de campo
    if (f.cliente === 'sem') where.clienteId = null; // T4: o filtro de limpeza das antigas
    else if (f.cliente) where.clienteId = f.cliente;
    if (f.dueFrom || f.dueTo) where.dueDate = {
      ...(f.dueFrom ? { gte: f.dueFrom } : {}),
      ...(f.dueTo ? { lt: f.dueTo } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.workTask.findMany({
        where,
        include: TASK_INCLUDE,
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.workTask.count({ where }),
    ]);
    const now = new Date();
    /*
     * UMA consulta para todos os donos, depois da lista — não uma por tarefa.
     * `agentesDaCasa` já deduplica os ids, então o custo é fixo no número de
     * agentes travando trabalho, não no de tarefas.
     */
    const agentes = await agentesDaCasa(this.prisma, orgId, rows.map((t) => t.agenteId));
    const minutos = await this.minutosPorTarefa(orgId, rows.map((t) => t.id));
    const clientes = await nomesDosClientes(this.prisma, orgId, rows.map((t) => t.clienteId));
    return {
      items: rows.map((t) => this.mapTask(t, now, agentes, minutos, clientes)),
      total,
      source: { tool: 'trabalho-interno', generatedAt: now.toISOString() },
    };
  }

  async atividade(orgId: string, actorId: string, id: string, rawQuery: Record<string, unknown> = {}): Promise<TrabAtividadePagina> {
    await exigirAcessoAtual(this.prisma, orgId, actorId, ['tarefas.ver']);
    const scope = { orgId, taskId: id, userId: actorId };
    const query = parseActivityQuery(rawQuery, scope);
    const task = await this.prisma.workTask.findFirst({ where: { id, orgId }, select: { id: true } });
    if (!task) throw new NotFoundException('Tarefa não encontrada');
    const rows = await this.prisma.auditLog.findMany({
      where: activityWhere(orgId, id, query), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const anchor = query.anchor ?? (page.length ? activityPoint(page[0]) : null);
    const hasMore = rows.length > query.limit;
    const names = await activityNames(this.prisma, orgId, page);
    await exigirAcessoAtual(this.prisma, orgId, actorId, ['tarefas.ver']);
    return { escopo: scope, consultadoEm: new Date().toISOString(), limit: query.limit,
      items: page.map(row => activityDto(row, names)), anchor, hasMore,
      nextCursor: hasMore && anchor ? activityCursor(scope, query.limit, anchor, activityPoint(page[page.length - 1])) : null };
  }

  async tarefa(orgId: string, id: string, solicitanteId?: string): Promise<TrabTarefaDetalhe> {
    if (solicitanteId !== undefined) await exigirAcessoAtual(this.prisma, orgId, solicitanteId, ['tarefas.ver']);
    const t = await this.prisma.workTask.findFirst({
      where: { id, orgId },
      include: {
        ...TASK_INCLUDE,
        list: true,
        comments: { orderBy: { createdAt: 'desc' } },
        subtasks: { include: { status: true } },
      },
    });
    if (!t) throw new NotFoundException('Tarefa não encontrada');
    const atividade = await this.prisma.auditLog.findMany({
      where: { orgId, entityType: 'work_task', entityId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    const nomePorAtor = await activityNames(this.prisma, orgId, atividade);
    const now = new Date();
    const [agentes, clientes, apontamentos, porEtapa] = await Promise.all([
      agentesDaCasa(this.prisma, orgId, [t.agenteId]),
      nomesDosClientes(this.prisma, orgId, [t.clienteId]),
      this.prisma.workApontamento.findMany({
        where: { orgId, taskId: id },
        orderBy: [{ dia: 'desc' }, { createdAt: 'desc' }],
        take: 200,
      }),
      /*
       * A SOMA POR ETAPA VEM DO BANCO, não dos 200 listados: cliente com mais
       * lançamentos que isso teria a conta cortada em silêncio. A ordem é a da
       * primeira hora gasta em cada etapa, que é a ordem em que o cliente andou.
       */
      this.prisma.workApontamento.groupBy({
        by: ['etapa'],
        where: { orgId, taskId: id },
        _sum: { minutos: true },
        _min: { createdAt: true },
      }),
    ]);
    const minutosDaTarefa = porEtapa.reduce((soma, g) => soma + (g._sum.minutos ?? 0), 0);
    if (solicitanteId !== undefined) await exigirAcessoAtual(this.prisma, orgId, solicitanteId, ['tarefas.ver']);
    return {
      ...this.mapTask(t, now, agentes, new Map([[t.id, minutosDaTarefa]]), clientes),
      description: t.description, listName: t.list.name,
      createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(),
      comentarios: t.comments.map((c) => ({
        id: c.id, authorId: c.authorId, authorName: c.authorName, text: c.text,
        createdAt: c.createdAt.toISOString(),
      })),
      atividade: atividade.map(a => activityDto(a, nomePorAtor)),
      filhos: t.subtasks.map((s) => ({
        id: s.id, title: s.title, statusName: s.status.name, statusColor: s.status.color,
      })),
      apontamentos: apontamentos.map((a) => this.mapApontamento(a)),
      minutosPorEtapa: porEtapa
        .slice()
        .sort((a, b) => (a._min.createdAt?.getTime() ?? 0) - (b._min.createdAt?.getTime() ?? 0))
        .map((g) => ({ etapa: g.etapa, minutos: g._sum.minutos ?? 0 })),
    };
  }

  /**
   * `exigirCliente` (rodada do trabalho T4): a rota da tela e o aceite da ata
   * exigem o cliente; subtarefa sem cliente herda o da mãe. Chamadores internos
   * que já sabem o cliente o mandam no `clienteId`.
   */
  async pessoas(orgId: string): Promise<{ id: string; nome: string }[]> {
    const gente = await this.prisma.user.findMany({
      where: { orgId, isActive: true, roles: { none: { key: { in: ['ia_servico', 'ia_acao'] } } } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return gente.map((g) => ({ id: g.id, nome: g.name }));
  }

  clientes(orgId: string, q?: string) {
    return listarClientes(this.prisma, orgId, q);
  }

  async criarTarefa(orgId: string, actorId: string, input: TrabTarefaCreateInput, opcoes: { exigirCliente?: boolean } = {}) {
    const preparo = await this.prepararCriacaoDeTarefa(orgId, input, opcoes);
    return this.logado(orgId, actorId, 'work.task.create', 'work_task', null, async () => {
      const task = await this.prisma.$transaction((tx) => this.gravarTarefaPreparada(tx, preparo));
      return this.tarefa(orgId, task.id);
    });
  }

  /*
   * A VARIANTE TRANSACIONAL (rodada dos agentes, 21/10/2026, TR-01 e TR-09).
   *
   * `criarTarefa` = preparar (as conferências de lista, porta da implantação,
   * status, pai, cliente, responsável e campos, fora da transação) + gravar (a
   * tarefa e os campos, dentro de uma) + auditar. Quem precisa que a tarefa nasça
   * NA MESMA transação de outra escrita (o aceite da sugestão da ata, o aceite da
   * delegação) chama as três partes: a sugestão tomada e a tarefa criada caem ou
   * ficam juntas, e nunca sobra sugestão "aceita" sem tarefa. O comportamento de
   * `criarTarefa` não muda.
   */
  async prepararCriacaoDeTarefa(orgId: string, input: TrabTarefaCreateInput, opcoes: { exigirCliente?: boolean } = {}): Promise<TarefaPreparada> {
    const list = await this.prisma.workList.findFirst({
      where: { id: input.listId, orgId },
      include: { statuses: { orderBy: { order: 'asc' } } },
    });
    if (!list) throw new NotFoundException('Lista não encontrada');
    if (list.statuses.length === 0) throw new BadRequestException('Lista sem statuses.');
    // A implantação tem porta única (rodada do trabalho T1): o cartão do cliente
    // nasce do contrato assinado no comercial. Subtarefa dentro do cartão vale.
    if (!input.parentId && list.folderId) {
      const pasta = await this.prisma.workFolder.findFirst({ where: { id: list.folderId, orgId }, select: { id: true, name: true, parentId: true } });
      if (pasta && listaDaImplantacao([{ ...pasta, lists: [{ id: list.id, name: list.name }] }])) {
        throw new BadRequestException(PORTA_DA_IMPLANTACAO);
      }
    }
    const statusId = input.statusId ?? list.statuses[0].id;
    if (!list.statuses.some((s) => s.id === statusId)) {
      throw new BadRequestException('Status não pertence à lista.');
    }
    await this.conferirPaiEEtiquetas(orgId, input);
    let clienteId: string | null = input.clienteId ? await resolverCliente(this.prisma, orgId, input.clienteId) : null;
    if (!clienteId && input.parentId) {
      clienteId = (await this.prisma.workTask.findFirst({ where: { id: input.parentId, orgId }, select: { clienteId: true } }))?.clienteId ?? null;
    }
    if (!clienteId && opcoes.exigirCliente) {
      throw new BadRequestException('Escolha o cliente da tarefa. O trabalho da própria empresa vai para o cliente interno.');
    }
    await this.conferirResponsavel(orgId, input.assigneeUserId);
    const campos = input.campos ? await this.conferirCampos(orgId, list.id, input.campos) : [];
    return { orgId, listId: list.id, statusId, clienteId, campos, input };
  }

  /** Grava a tarefa preparada dentro da transação de quem chama (ver acima). */
  async gravarTarefaPreparada(tx: Prisma.TransactionClient, p: TarefaPreparada): Promise<{ id: string }> {
    const { input } = p;
    const criada = await tx.workTask.create({
      data: {
        orgId: p.orgId, listId: p.listId, statusId: p.statusId,
        title: input.title, description: input.description ?? null,
        priority: (input.priority as WorkPriority) ?? WorkPriority.normal,
        assignee: input.assignee ?? null,
        assigneeUserId: input.assigneeUserId ?? null,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        startDate: input.startDate ? new Date(input.startDate) : null,
        parentId: input.parentId ?? null,
        clienteId: p.clienteId,
        tags: input.tagIds ? { connect: input.tagIds.map((id) => ({ id })) } : undefined,
      },
    });
    await this.gravarCampos(tx, criada.id, p.campos);
    return { id: criada.id };
  }

  /** A auditoria `work.task.create`, depois do commit de quem gravou pela variante transacional. */
  async auditarCriacaoDeTarefa(orgId: string, actorId: string, taskId: string): Promise<void> {
    await this.audit.log({ orgId, actorId, action: 'work.task.create', entityType: 'work_task', entityId: taskId });
  }

  /** A lista é a da implantação (Onboarding de cliente na pasta Clientes)? Porta única do T1. */
  private async ehListaDaImplantacao(orgId: string, listId: string): Promise<boolean> {
    const l = await this.prisma.workList.findFirst({ where: { id: listId, orgId }, select: { id: true, name: true, folderId: true } });
    if (!l?.folderId) return false;
    const pasta = await this.prisma.workFolder.findFirst({ where: { id: l.folderId, orgId }, select: { id: true, name: true, parentId: true } });
    return !!pasta && !!listaDaImplantacao([{ ...pasta, lists: [{ id: l.id, name: l.name }] }]);
  }

  /** Escritores internos também precisam da versão usada para preparar a edição. */
  async editarTarefa(orgId: string, actorId: string, id: string, input: TrabTarefaUpdateHttpInput) {
    return this.aplicarEdicaoTarefa(orgId, actorId, id, input, false);
  }

  async editarTarefaHttp(orgId: string, actorId: string, id: string, input: TrabTarefaUpdateHttpInput) {
    await exigirAcessoAtual(this.prisma, orgId, actorId, ['tarefas.editar']);
    const validado = TrabTarefaUpdateHttpSchema.parse(input);
    return this.aplicarEdicaoTarefa(orgId, actorId, id, validado, true);
  }

  private async aplicarEdicaoTarefa(orgId: string, actorId: string, id: string, input: TrabTarefaUpdateHttpInput, acessoHttp: boolean) {
    const versao = TrabTarefaUpdateHttpSchema.shape.expectedUpdatedAt.safeParse(input?.expectedUpdatedAt);
    if (!versao.success) {
      throw new BadRequestException('Informe uma versão válida da tarefa antes de editar.');
    }
    const antes = await this.prisma.workTask.findFirst({ where: { id, orgId }, include: { status: true, tags: true } });
    if (!antes) throw new NotFoundException('Tarefa não encontrada');
    const conflito = () => new ConflictException({
      error: 'work_task_conflict', code: 'work_task_conflict', message: 'A tarefa mudou. Confira a versão atual antes de salvar.',
    });
    if (new Date(input.expectedUpdatedAt).getTime() !== antes.updatedAt.getTime()) {
      throw conflito();
    }

    if (input.listId) await this.achar(this.prisma.workList, orgId, input.listId, 'Lista');
    const listId = input.listId ?? antes.listId;
    // Porta única da implantação (T1, revisão P2-4): nenhum cartão novo entra pela edição. Mover uma
    // tarefa solta para a lista, ou promover uma subtarefa de lá a cartão, é abrir cliente pelo lado.
    const paiDepois = input.parentId === undefined ? antes.parentId : input.parentId;
    const entraNaLista = !!input.listId && input.listId !== antes.listId;
    const viraCartao = antes.parentId !== null && paiDepois === null;
    if (!paiDepois && (entraNaLista || viraCartao) && (await this.ehListaDaImplantacao(orgId, listId))) {
      throw new BadRequestException(PORTA_DA_IMPLANTACAO);
    }
    let statusId = input.statusId;
    if (input.listId && input.listId !== antes.listId && !statusId) {
      const primeiro = await this.prisma.workStatus.findFirst({ where: { listId, orgId }, orderBy: { order: 'asc' } });
      if (!primeiro) throw new BadRequestException('Lista destino sem statuses.');
      statusId = primeiro.id;
    }
    if (statusId) {
      const ok = await this.prisma.workStatus.findFirst({ where: { id: statusId, listId, orgId } });
      if (!ok) throw new BadRequestException('Status não pertence à lista da tarefa.');
    }
    await this.conferirPaiEEtiquetas(orgId, input);
    await this.conferirResponsavel(orgId, input.assigneeUserId, antes.assigneeUserId);
    const campos = input.campos ? await this.conferirCampos(orgId, listId, input.campos) : [];
    const clienteId = input.clienteId ? await resolverCliente(this.prisma, orgId, input.clienteId) : undefined;
    const principal = input.assigneeUserId === undefined ? antes.assigneeUserId : input.assigneeUserId;
    const outrosResponsaveisIds = await this.conferirOutrosResponsaveis(orgId, input.outrosResponsaveisIds, principal, antes.outrosResponsaveisIds);
    // A tarefa que se repete gera cartões novos: o cartão da implantação continua com porta única.
    if (input.recorrencia && !paiDepois && (await this.ehListaDaImplantacao(orgId, listId))) {
      throw new BadRequestException(PORTA_DA_IMPLANTACAO);
    }
    const repeticaoMuda = input.recorrencia !== undefined;
    const updatedAt = new Date(Math.max(Date.now(), antes.updatedAt.getTime() + 1));

    await this.prisma.$transaction(async (tx) => {
      if (acessoHttp) await exigirAcessoAtual(tx, orgId, actorId, ['tarefas.editar']);
      // A instrução condicional trava a linha antes de etiquetas, campos e auditoria.
      const claim = await tx.workTask.updateMany({
        where: { id, orgId, updatedAt: antes.updatedAt },
        data: {
          listId: input.listId, statusId, title: input.title,
          description: input.description,
          priority: input.priority as WorkPriority | undefined,
          assignee: input.assignee,
          assigneeUserId: input.assigneeUserId,
          dueDate: input.dueDate === undefined ? undefined : input.dueDate ? new Date(input.dueDate) : null,
          startDate: input.startDate === undefined ? undefined : input.startDate ? new Date(input.startDate) : null,
          parentId: input.parentId === undefined ? undefined : input.parentId,
          clienteId,
          archived: input.archived, order: input.order, updatedAt,
          outrosResponsaveisIds,
          ...(repeticaoMuda ? {
            recorrencia: input.recorrencia ?? Prisma.DbNull,
            ...(input.recorrencia && !antes.serieId ? { serieId: id } : {}),
          } : {}),
        },
      });
      if (claim.count !== 1) throw conflito();
      const camposAntes = campos.length ? await this.retratoDosCampos(tx, id, campos) : null;
      if (input.tagIds !== undefined) {
        await tx.workTask.update({
          where: { id }, data: { tags: { set: input.tagIds.map((tid) => ({ id: tid })) }, updatedAt },
        });
      }
      await this.gravarCampos(tx, id, campos);
      const camposDepois = campos.length ? await this.retratoDosCampos(tx, id, campos) : null;
      const depois = await tx.workTask.findFirst({ where: { id, orgId }, include: { status: true } });
      if (!depois) throw new NotFoundException('Tarefa não encontrada');
      await this.audit.log({
        orgId, actorId, action: 'work.task.update', entityType: 'work_task', entityId: id,
        // `dueDate` entrou na rodada do painel P1 (18/10/2026): a caixa de entrada
        // mostra "vencimento mudou de → para" a partir DESTA linha, sem segundo
        // caminho de escrita. Linha antiga, sem a chave, não mostra a mudança.
        before: {
          status: antes.status.name, title: antes.title, assignee: antes.assignee,
          assigneeUserId: antes.assigneeUserId, priority: antes.priority,
          dueDate: antes.dueDate?.toISOString() ?? null,
          ...(clienteId !== undefined ? { clienteId: antes.clienteId } : {}),
          ...(outrosResponsaveisIds !== undefined ? { outrosResponsaveisIds: antes.outrosResponsaveisIds } : {}),
          ...(repeticaoMuda ? { recorrencia: antes.recorrencia ?? null } : {}),
          ...(camposAntes ? { campos: camposAntes } : {}),
        },
        after: {
          status: depois.status.name, title: depois.title, assignee: depois.assignee,
          assigneeUserId: depois.assigneeUserId, priority: depois.priority,
          dueDate: depois.dueDate?.toISOString() ?? null,
          ...(clienteId !== undefined ? { clienteId: depois.clienteId } : {}),
          ...(outrosResponsaveisIds !== undefined ? { outrosResponsaveisIds: depois.outrosResponsaveisIds } : {}),
          ...(repeticaoMuda ? { recorrencia: depois.recorrencia ?? null } : {}),
          ...(camposDepois ? { campos: camposDepois } : {}),
        },
      }, tx);
      if (acessoHttp) await exigirAcessoAtual(tx, orgId, actorId, ['tarefas.editar']);
    });
    /*
     * CONCLUIR UMA TAREFA QUE SE REPETE CRIA A PRÓXIMA (versão final, trazido do Lucas):
     * vale para qualquer caminho que leve a tarefa a uma etapa fechada (pop-up, arraste
     * no quadro, seleção em lote). A série nunca tem duas abertas, então concluir, reabrir
     * e concluir de novo devolve a que já existe em vez de criar outra.
     */
    let proxima: { id: string; dueDate: string | null } | null = null;
    if (statusId && antes.status.type !== WorkStatusType.closed && !input.archived && !antes.archived) {
      const novo = await this.prisma.workStatus.findFirst({ where: { id: statusId, orgId }, select: { type: true } });
      const regra = repeticaoMuda ? input.recorrencia ?? null : regraDeRepeticao(antes.recorrencia);
      if (novo?.type === WorkStatusType.closed && regra) proxima = await this.criarProximaOcorrencia(orgId, actorId, id, regra);
    }
    const detail = await this.tarefa(orgId, id);
    if (acessoHttp) await exigirAcessoAtual(this.prisma, orgId, actorId, ['tarefas.editar']);
    return proxima ? { ...detail, proxima } : detail;
  }

  /**
   * Os DEMAIS responsáveis: sem repetir e sem o principal. Quem entra agora é conta
   * ativa desta empresa; quem já estava pode continuar mesmo inativo (a regra do
   * principal). Sem a chave no pedido, a lista só perde o principal novo, se ele estava nela.
   */
  private async conferirOutrosResponsaveis(
    orgId: string, pedido: string[] | undefined, principal: string | null, atuais: string[],
  ): Promise<string[] | undefined> {
    if (pedido === undefined) {
      return principal && atuais.includes(principal) ? atuais.filter((u) => u !== principal) : undefined;
    }
    const lista = [...new Set(pedido)].filter((u) => u !== principal);
    const novos = lista.filter((u) => !atuais.includes(u));
    if (novos.length) {
      const ativos = await this.prisma.user.count({ where: { orgId, isActive: true, id: { in: novos } } });
      if (ativos !== novos.length) throw new BadRequestException('Algum responsável não é uma pessoa ativa desta empresa.');
    }
    return lista;
  }

  /**
   * A próxima ocorrência: mesma lista, pai, título, descrição, prioridade, etiquetas,
   * cliente, área, responsáveis e regra; prazo seguinte; na primeira etapa aberta.
   * Nasce pelo `criarTarefa` (auditoria e porta da implantação de sempre).
   */
  private async criarProximaOcorrencia(
    orgId: string, actorId: string, id: string, regra: RecorrenciaDaTarefa,
  ): Promise<{ id: string; dueDate: string | null }> {
    const t = await this.prisma.workTask.findFirst({
      where: { id, orgId },
      include: { tags: { select: { id: true } }, assigneeUser: { select: { isActive: true } } },
    });
    if (!t) throw new NotFoundException('Tarefa não encontrada');
    const serie = t.serieId ?? t.id;
    // Carimbar a série não é edição: a versão (`updatedAt`) fica a mesma.
    if (!t.serieId) await this.prisma.workTask.updateMany({ where: { id, orgId }, data: { serieId: serie, updatedAt: t.updatedAt } });
    const aberta = await this.prisma.workTask.findFirst({
      where: { orgId, serieId: serie, archived: false, id: { not: t.id }, status: { type: { not: WorkStatusType.closed } } },
      select: { id: true, dueDate: true },
    });
    if (aberta) return { id: aberta.id, dueDate: aberta.dueDate?.toISOString() ?? null };
    const dia = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const prazo = proximaOcorrencia(regra, t.dueDate ? dia(t.dueDate) : null, hojeEmBrasilia());
    // Meio-dia de São Paulo: o mesmo instante que o campo Prazo e o calendário gravam.
    const vence = new Date(`${prazo}T15:00:00.000Z`).toISOString();
    const statuses = await this.prisma.workStatus.findMany({ where: { listId: t.listId, orgId }, orderBy: { order: 'asc' } });
    const aFazer = statuses.find((st) => st.type !== WorkStatusType.closed);
    if (!aFazer) throw new BadRequestException('A lista da tarefa não tem etapa aberta para a próxima ocorrência.');
    const nova = await this.criarTarefa(orgId, actorId, {
      listId: t.listId, statusId: aFazer.id, title: t.title, description: t.description,
      priority: t.priority, parentId: t.parentId,
      assigneeUserId: t.assigneeUserId && t.assigneeUser?.isActive ? t.assigneeUserId : null,
      dueDate: vence,
      tagIds: t.tags.map((tg) => tg.id),
    });
    // O cliente vai direto (já conferido na tarefa de origem), com área, demais responsáveis e a regra.
    await this.prisma.workTask.updateMany({
      where: { id: nova.id, orgId },
      data: {
        clienteId: t.clienteId, areaId: t.areaId, serieId: serie,
        outrosResponsaveisIds: t.outrosResponsaveisIds, recorrencia: t.recorrencia ?? Prisma.DbNull,
      },
    });
    return { id: nova.id, dueDate: vence };
  }

  /**
   * ORDEM MANUAL (versão final, F4): a sequência que a tela mandou (uma coluna, a
   * lista) vira as posições 10, 20, 30… Só a posição muda. Cada tarefa vai com a
   * versão lida; uma vencida derruba a sequência inteira (409), sem gravar metade.
   */
  async reordenar(orgId: string, actorId: string, input: TrabTarefasOrdemInput): Promise<{ ok: true }> {
    await exigirAcessoAtual(this.prisma, orgId, actorId, ['tarefas.editar']);
    const ids = input.itens.map((i) => i.id);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('A sequência repete uma tarefa.');
    await this.prisma.$transaction(async (tx) => {
      for (const [i, item] of input.itens.entries()) {
        const r = await tx.workTask.updateMany({
          where: { id: item.id, orgId, updatedAt: new Date(item.expectedUpdatedAt) },
          data: { order: (i + 1) * 10 },
        });
        if (r.count !== 1) {
          throw new ConflictException({
            error: 'work_task_conflict', code: 'work_task_conflict',
            message: 'Alguma tarefa mudou desde que a lista foi lida. Recarregue antes de reordenar.',
          });
        }
      }
      await this.audit.log({ orgId, actorId, action: 'work.task.reorder', entityType: 'work_task', entityId: ids[0], after: { ids } }, tx);
      await exigirAcessoAtual(tx, orgId, actorId, ['tarefas.editar']);
    });
    return { ok: true };
  }

  /** Um vínculo existente inativo pode permanecer; uma nova atribuição exige conta ativa desta empresa. */
  private async conferirResponsavel(orgId: string, pedido: string | null | undefined, atual?: string | null) {
    if (pedido == null || pedido === atual) return;
    const pessoa = await this.prisma.user.findFirst({ where: { id: pedido, orgId }, select: { id: true, isActive: true } });
    if (!pessoa) throw new NotFoundException('Pessoa não encontrada');
    if (!pessoa.isActive) throw new BadRequestException('Pessoa inativa não recebe nova atribuição.');
  }

  /**
   * Pai e etiquetas vêm do corpo do pedido e só valem desta empresa. A chave
   * estrangeira confere apenas que o id existe, e a conexão dona das tabelas
   * atravessa o isolamento por linha: sem esta conferência, a tarefa daqui
   * viraria filha de tarefa de outra empresa e apareceria no detalhe dela. Id
   * de outra empresa recebe o mesmo 404 de um id que não existe; etiqueta
   * repetida conta uma vez, como o Prisma grava.
   */
  private async conferirPaiEEtiquetas(orgId: string, input: { parentId?: string | null; tagIds?: string[] }) {
    if (input.parentId) await this.achar(this.prisma.workTask, orgId, input.parentId, 'Tarefa pai');
    if (input.tagIds?.length) {
      const pedidas = new Set(input.tagIds);
      const daEmpresa = await this.prisma.workTag.count({ where: { orgId, id: { in: [...pedidas] } } });
      if (daEmpresa !== pedidas.size) throw new NotFoundException('Etiqueta não encontrada');
    }
  }

  /**
   * Confere TODOS os campos do pedido antes da primeira escrita (ROOT-06a, E1):
   * o campo vale para a lista, a opção do `drop_down` é dele e o valor do
   * `moeda` é canônico. Conferir enquanto grava deixava a tarefa criada (e a
   * nova tentativa a duplicava) ou o texto do PATCH gravado ao lado de um 400.
   * A escrita da tarefa e dos valores vai depois, numa transação só.
   */
  private async conferirCampos(
    orgId: string, listId: string, campos: Record<string, ValorDoCampo>,
  ): Promise<CampoConferido[]> {
    if (Object.keys(campos).length === 0) return [];
    const fields = await this.prisma.workField.findMany({
      where: { id: { in: Object.keys(campos) }, orgId, OR: [{ listId }, { listId: null }] },
      include: { options: true },
    });
    const porId = new Map(fields.map((f) => [f.id, f]));
    return Object.entries(campos).map(([fieldId, v]) => {
      const field = porId.get(fieldId);
      if (!field) throw new BadRequestException(`Campo ${fieldId} não vale para esta lista.`);
      if (field.type === WorkFieldType.moeda) {
        if (v.optionId || (!apagaOValor(field.type, v) && !ehValorMonetarioCanonico(v.value))) {
          throw new BadRequestException(`Valor de ${field.name} fora do formato monetário (exemplo: BRL 1500.00).`);
        }
      } else if (!apagaOValor(field.type, v) && v.optionId && !field.options.some((o) => o.id === v.optionId)) {
        throw new BadRequestException(`Opção não pertence ao campo ${field.name}.`);
      }
      return { field, v };
    });
  }

  /** Grava os valores já conferidos por `conferirCampos`, dentro da transação de quem chama. */
  private async gravarCampos(db: Prisma.TransactionClient, taskId: string, campos: CampoConferido[]) {
    for (const { field, v } of campos) {
      if (apagaOValor(field.type, v)) {
        await db.workFieldValue.deleteMany({ where: { taskId, fieldId: field.id } });
        continue;
      }
      const valor = field.type === WorkFieldType.moeda
        ? { optionId: null, value: v.value ?? null }
        : { optionId: v.optionId ?? null, value: v.value ?? null };
      await db.workFieldValue.upsert({
        where: { taskId_fieldId: { taskId, fieldId: field.id } },
        update: valor,
        create: { taskId, fieldId: field.id, ...valor },
      });
    }
  }

  /**
   * O valor de cada campo do pedido, para a auditoria de `work.task.update`
   * (ROOT-06a, A4): sem isto, trocar um valor monetário não deixava rastro.
   */
  private async retratoDosCampos(db: Prisma.TransactionClient, taskId: string, campos: CampoConferido[]) {
    const linhas = await db.workFieldValue.findMany({
      where: { taskId, fieldId: { in: campos.map((c) => c.field.id) } },
      include: { option: true },
    });
    const porCampo = new Map(linhas.map((l) => [l.fieldId, l]));
    return Object.fromEntries(campos.map(({ field }) => {
      const l = porCampo.get(field.id);
      return [field.id, { campo: field.name, tipo: field.type, opcao: l?.option?.name ?? null, valor: l?.value ?? null }];
    }));
  }

  async comentar(orgId: string, actorId: string, taskId: string, text: string) {
    const t = await this.prisma.workTask.findFirst({ where: { id: taskId, orgId } });
    if (!t) throw new NotFoundException('Tarefa não encontrada');
    const autor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { name: true } });
    const c = await this.prisma.workComment.create({
      data: { taskId, authorId: actorId, authorName: autor?.name ?? 'sistema', text },
    });
    await this.audit.log({
      orgId, actorId, action: 'work.comment.create', entityType: 'work_task', entityId: taskId,
      after: { comment: text.slice(0, 200) },
    });
    return { id: c.id, createdAt: c.createdAt.toISOString() };
  }

  // ---------- horas apontadas (esteira de clientes) ----------

  /**
   * Lança horas numa tarefa. A ETAPA é a atual da tarefa, lida aqui — quem
   * aponta não escolhe, porque a pergunta que o número responde é "quanto custou
   * cada etapa" e deixar escolher a etapa deixaria a conta ser ajustada à mão.
   * Hora gasta numa etapa anterior e lançada depois fica na etapa de agora: é
   * limitação conhecida, e a alternativa (reconstruir a etapa do dia pelo
   * histórico) erra mais do que acerta.
   *
   * Não passa pela porta nem por aprovação: é escrita interna do quadro, como o
   * comentário. O gate é `tarefas.editar`.
   */
  async apontar(orgId: string, actorId: string, taskId: string, input: TrabApontamentoCreateInput): Promise<TrabApontamentoDto> {
    const t = await this.prisma.workTask.findFirst({ where: { id: taskId, orgId }, include: { status: true } });
    if (!t) throw new NotFoundException('Tarefa não encontrada');
    const hoje = hojeEmBrasilia();
    const dia = input.dia ?? hoje;
    if (!diaDeCalendarioValido(dia)) throw new BadRequestException(`Dia inválido: ${dia}.`);
    if (dia > hoje) throw new BadRequestException('Dia no futuro: aponte a hora depois de gastá-la.');
    const autor = await this.prisma.user.findFirst({ where: { id: actorId, orgId }, select: { name: true } });
    const a = await this.prisma.workApontamento.create({
      data: {
        orgId, taskId, autorId: actorId, autorNome: autor?.name ?? 'sistema',
        minutos: input.minutos, dia: new Date(`${dia}T00:00:00.000Z`),
        etapa: t.status.name, nota: input.nota ?? null,
      },
    });
    await this.audit.log({
      orgId, actorId, action: 'work.time.create', entityType: 'work_task', entityId: taskId,
      after: { minutos: input.minutos, dia, etapa: t.status.name },
    });
    return this.mapApontamento(a);
  }

  /**
   * Só QUEM LANÇOU apaga. `tarefas.editar` diz quem mexe no quadro; não diz quem
   * pode sumir com a hora de outra pessoa — e a hora é o número que sustenta
   * preço. O apagamento fica na atividade da tarefa, com o que foi apagado.
   */
  async apagarApontamento(orgId: string, actorId: string, id: string) {
    const a = await this.prisma.workApontamento.findFirst({ where: { id, orgId } });
    if (!a) throw new NotFoundException('Apontamento não encontrado');
    if (a.autorId !== actorId) throw new ForbiddenException('Só quem lançou a hora pode apagá-la.');
    await this.prisma.workApontamento.deleteMany({ where: { id, orgId } });
    await this.audit.log({
      orgId, actorId, action: 'work.time.delete', entityType: 'work_task', entityId: a.taskId,
      before: { minutos: a.minutos, dia: a.dia.toISOString().slice(0, 10), etapa: a.etapa },
    });
    return { id };
  }

  private mapApontamento(a: Prisma.WorkApontamentoGetPayload<object>): TrabApontamentoDto {
    return {
      id: a.id, autorId: a.autorId, autorNome: a.autorNome, minutos: a.minutos,
      dia: a.dia.toISOString().slice(0, 10), etapa: a.etapa, nota: a.nota,
      createdAt: a.createdAt.toISOString(),
    };
  }

  /** Soma de minutos por tarefa, numa consulta só (a lista tem até 500 tarefas). */
  private async minutosPorTarefa(orgId: string, taskIds: string[]): Promise<Map<string, number>> {
    if (taskIds.length === 0) return new Map();
    const grupos = await this.prisma.workApontamento.groupBy({
      by: ['taskId'],
      where: { orgId, taskId: { in: taskIds } },
      _sum: { minutos: true },
    });
    return new Map(grupos.map((g) => [g.taskId, g._sum.minutos ?? 0]));
  }

  // ---------- modelos de lista ----------

  /**
   * Cria uma lista pronta a partir de `MODELOS_DE_LISTA` (hoje, a esteira de
   * clientes): etapas com cor, tipo e limite, e campos com opções.
   *
   * Desde o A3 (21/10/2026) roda numa transação sob o cadeado da árvore, como
   * `criarLista`: o nome não pode repetir o de uma irmã, e a conferência e a
   * criação precisam ser uma coisa só. A transação interativa vale sob a sessão
   * de banco que carimba a empresa (`prisma/sessao-de-banco.ts`), como em
   * `criarTarefa` e `editarTarefa`; falhar no meio não deixa lista pela metade.
   */
  async criarListaDoModelo(orgId: string, actorId: string, input: TrabListaDoModeloInput) {
    const modelo: ModeloDeLista = MODELOS_DE_LISTA[input.modelo];
    const pai = await this.paiDaLista(orgId, input);
    const nome = nomeDoNo(input.name ?? modelo.nome);
    return this.logado(orgId, actorId, 'work.list.create_from_model', 'work_list', null, () => this.naArvore(orgId, async (tx) => {
      await this.conferirNomeDaLista(tx, orgId, nome, pai);
      return criarListaDoModeloNoBanco(tx, orgId, pai, modelo, nome, await this.fimDoNivelDeLista(tx, orgId, pai.folderId));
    }));
  }

  /**
   * A ESTRUTURA SUGERIDA (rodada do painel P2; Gestão refeita em 21/10/2026): Gestão e
   * Clientes, com a esteira, o onboarding e a execução dentro de Clientes. Cria
   * só o que falta pelo nome, numa transação sob o cadeado da árvore; a regra
   * inteira está em `estrutura-sugerida.ts`, que o seed da homologação também usa.
   * Uma linha de auditoria por chamada, com o que foi criado e o que já existia.
   */
  async criarEstruturaSugerida(orgId: string, actorId: string): Promise<TrabEstruturaSugeridaResultado> {
    const r = await this.prisma.$transaction((tx) => criarEstruturaSugerida(tx, orgId));
    await this.audit.log({
      orgId, actorId, action: 'work.structure.suggested', entityType: 'work_folder',
      after: r as unknown as Prisma.InputJsonValue,
    });
    return r;
  }

  // ---------- utilitários ----------

  /** findFirst({id, orgId}) genérico com 404. */
  private async achar(
    modelo: { findFirst(args: { where: { id: string; orgId: string } }): Promise<unknown | null> },
    orgId: string, id: string, rotulo: string,
  ) {
    const achado = await modelo.findFirst({ where: { id, orgId } });
    if (!achado) throw new NotFoundException(`${rotulo} não encontrada`);
    return achado;
  }

  private async acharEspaco(orgId: string, id: string) {
    const espaco = await this.prisma.workSpace.findFirst({ where: { id, orgId } });
    if (!espaco) throw new NotFoundException('Espaço não encontrado');
    return espaco;
  }

  /**
   * O pai da pasta e o da lista, conferidos NA EMPRESA antes de gravar (resíduo
   * T3 da ROOT-12a). Id de outra empresa recebe o mesmo 404 de um id que não
   * existe; a chave composta do banco também recusaria, mas com um 500 mudo.
   */
  private async paiDaPasta(orgId: string, input: { spaceId?: string | null; parentId?: string | null }): Promise<PaiDaPasta> {
    if (input.spaceId && input.parentId) throw new BadRequestException(TRAB_PASTA_COM_DOIS_PAIS);
    if (input.spaceId) await this.acharEspaco(orgId, input.spaceId);
    if (input.parentId) await this.achar(this.prisma.workFolder, orgId, input.parentId, 'Pasta');
    return { spaceId: input.spaceId ?? null, parentId: input.parentId ?? null };
  }

  private async paiDaLista(orgId: string, input: { folderId?: string | null; spaceId?: string | null }): Promise<PaiDaLista> {
    if (input.folderId && input.spaceId) throw new BadRequestException(TRAB_LISTA_COM_DOIS_PAIS);
    if (input.folderId) await this.achar(this.prisma.workFolder, orgId, input.folderId, 'Pasta');
    if (input.spaceId) await this.acharEspaco(orgId, input.spaceId);
    return { folderId: input.folderId ?? null, spaceId: input.spaceId ?? null };
  }

  /** Recusa a pasta dentro dela mesma ou de uma descendente, subindo pelas mães a partir do destino. */
  private async conferirSemCiclo(db: Prisma.TransactionClient, orgId: string, pastaId: string, maeId: string) {
    const pastas = await db.workFolder.findMany({ where: { orgId }, select: { id: true, parentId: true } });
    const maeDe = new Map(pastas.map((p) => [p.id, p.parentId]));
    const vistas = new Set<string>();
    for (let atual: string | null = maeId; atual && !vistas.has(atual); atual = maeDe.get(atual) ?? null) {
      if (atual === pastaId) throw new BadRequestException(PASTA_EM_CICLO);
      vistas.add(atual);
    }
  }

  /** O cadeado da árvore da empresa: o mesmo de mover pasta e da estrutura sugerida. */
  private naArvore<T>(orgId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`work-arvore:${orgId}`}))`;
      return fn(tx);
    }, { timeout: 60_000 });
  }

  /**
   * Nome repetido no MESMO nível de pasta (A3): a mãe, ou o topo do mesmo espaço.
   * Sem maiúscula, acento nem espaço sobrando (`chaveDoNomeNoNivel`). As arquivadas
   * não contam aqui; o índice único do banco ainda recusa o nome idêntico ao de uma
   * arquivada, e `semNomeRepetido` devolve a mesma frase.
   */
  private async conferirNomeDaPasta(db: Prisma.TransactionClient, orgId: string, nome: string, pai: PaiDaPasta, excetoId?: string) {
    const irmas = await db.workFolder.findMany({
      where: { orgId, spaceId: pai.spaceId, parentId: pai.parentId, arquivadaEm: null, ...(excetoId ? { id: { not: excetoId } } : {}) },
      select: { name: true },
    });
    if (irmas.some((p) => chaveDoNomeNoNivel(p.name) === chaveDoNomeNoNivel(nome))) throw new ConflictException(TRAB_NOME_DE_PASTA_REPETIDO);
  }

  /** Nome repetido no MESMO nível de lista (A3): a pasta, ou as soltas do mesmo espaço. A lista do comercial não conta. */
  private async conferirNomeDaLista(db: Prisma.TransactionClient, orgId: string, nome: string, pai: PaiDaLista, excetoId?: string) {
    const nivel: Prisma.WorkListWhereInput = pai.folderId ? { folderId: pai.folderId } : { folderId: null, spaceId: pai.spaceId };
    const irmas = await db.workList.findMany({
      where: { orgId, ...nivel, arquivadaEm: null, AND: [foraDaArvore()], ...(excetoId ? { id: { not: excetoId } } : {}) },
      select: { name: true },
    });
    if (irmas.some((l) => chaveDoNomeNoNivel(l.name) === chaveDoNomeNoNivel(nome))) throw new ConflictException(TRAB_NOME_DE_LISTA_REPETIDO);
  }

  /** A posição depois da última pasta do nível (a mãe, ou o topo). */
  private async fimDoNivelDePasta(db: Prisma.TransactionClient, orgId: string, parentId: string | null): Promise<number> {
    const r = await db.workFolder.aggregate({ where: { orgId, parentId }, _max: { order: true } });
    return r._max.order === null ? 0 : r._max.order + 1;
  }

  /** A posição depois da última lista do nível (a pasta, ou as soltas). */
  private async fimDoNivelDeLista(db: Prisma.TransactionClient, orgId: string, folderId: string | null): Promise<number> {
    const r = await db.workList.aggregate({ where: { orgId, folderId }, _max: { order: true } });
    return r._max.order === null ? 0 : r._max.order + 1;
  }

  /** Nome repetido entre irmãs é 409 com a frase da tela, e não o 500 do índice único. */
  private async semNomeRepetido<T>(frase: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException(frase);
      throw e;
    }
  }

  /** executa a escrita e registra na auditoria (entityId do resultado quando criar). */
  private async logado<T extends { id?: string }>(
    orgId: string, actorId: string, action: string, entityType: string, entityId: string | null,
    fn: () => Promise<T>,
    trilha?: { before?: Prisma.InputJsonValue; after?: Prisma.InputJsonValue },
  ): Promise<T> {
    const res = await fn();
    await this.audit.log({
      orgId, actorId, action, entityType,
      entityId: entityId ?? res.id ?? undefined,
      ...trilha,
    });
    return res;
  }
}

/** A regra de repetição gravada, conferida: JSON que não é regra válida vale como "não repete". */
export function regraDeRepeticao(valor: Prisma.JsonValue | null | undefined): RecorrenciaDaTarefa | null {
  if (valor == null) return null;
  const r = RecorrenciaSchema.safeParse(valor);
  return r.success ? r.data : null;
}
