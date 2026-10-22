import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  TRAB_DIAS_NA_LIXEIRA, TRAB_FRASE_DE_APAGAR_DE_VEZ, TRAB_SLUG_DA_ROTINA_DO_EXPURGO, TRAB_TIPO_DA_ROTINA_DO_EXPURGO,
  TRAB_TAREFA_COM_AGENTE, expiraNaLixeiraEm, fraseDeApagarDeVezConfere,
  type TrabLixeira, type TrabTarefaNaLixeira, type TrabTarefaExcluida, type TrabTarefasRestauradas, type TrabTarefasApagadasDeVez,
  type TrabTarefaExcluirInput,
} from '@mktos/shared';
import { AgentEstado, ActorType, Prisma } from '@prisma/client';

import { temPapelDeMaquina } from '../../approvals/alcada';
import { AuditService } from '../../audit/audit.service';
import { lerAprovador } from '../../auth/aprovador';
import { exigirAcessoAtual } from '../../memory/acesso-memoria';
import { proximaOcorrencia } from '../../pauta/cron';
import { PrismaService } from '../../prisma/prisma.service';
import { LIVRE, estadoDispara, type ResultadoDaRotina } from '../../routines/rotina.tipos';
import { listaVisivel } from '../arquivadas';
import { RECUSA_DE_MAQUINA_NO_TRABALHO } from '../so-gente-no-trabalho.guard';
import { cardsDaImplantacao, idDaListaDaImplantacao, nomesDasPessoas, quandoForamArquivadas } from './regras-da-lixeira';

/** Quantas tarefas a Lixeira traz de uma vez (a busca por nome acha as outras). */
export const LIMITE_DA_LIXEIRA = 500;

/** A cadência do expurgo, escrita para a tela: uma vez por dia, de madrugada. */
export const CRON_DO_EXPURGO = '30 3 * * *';
const FUSO_DO_EXPURGO = 'America/Sao_Paulo';

const NA_LIXEIRA_SO_EXCLUIDA = 'Só sai de vez a tarefa que está na Lixeira como excluída.';
const CARD_NAO_SAI_DE_VEZ = 'O card da implantação é o cliente: ele não se apaga de vez. Restaure ou deixe na Lixeira.';
const VINCULO_PROTEGIDO = 'Um vínculo que o banco protege (fonte de contexto, material editorial ou exercício) segura a tarefa: ela fica na Lixeira.';
const TAREFA_MUDOU = 'A tarefa mudou enquanto você confirmava. Atualize a tela e tente de novo.';

type Ator = { tipo: 'user'; id: string } | { tipo: 'system' };

/*
 * A LIXEIRA DO TRABALHO (rodada de produção 3, I2, 22/10/2026). Ver o cabeçalho de
 * `packages/shared/src/lixeira-do-trabalho.ts`.
 *
 * Tudo é de gente: o guarda recusa conta de máquina pelo token
 * (`SoGenteNoTrabalhoGuard`) e cada escrita relê a pessoa no banco
 * (`exigirGente`), como excluir lista. Excluir e restaurar pedem `tarefas.editar`
 * (a permissão de apagar no Trabalho); apagar de vez pede também `admin.usuarios`
 * e a frase escrita. Cada tarefa muda numa escrita condicionada ao que foi lido
 * (dois cliques não fazem duas vezes), com uma linha de auditoria por tarefa.
 */
@Injectable()
export class LixeiraService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async exigirGente(orgId: string, actorId: string, permissoes: string[] = ['tarefas.editar']): Promise<void> {
    const doBanco = await lerAprovador(this.prisma, actorId, orgId);
    if (!doBanco || !doBanco.ativo) throw new ForbiddenException('Quem mexe na Lixeira precisa ser um usuário ativo desta empresa.');
    if (temPapelDeMaquina(doBanco.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA_NO_TRABALHO);
    await exigirAcessoAtual(this.prisma, orgId, actorId, permissoes);
  }

  // ------------------------------------------------------------------ ler

  async listar(orgId: string, actorId: string, filtro: { q?: string; estado?: 'excluida' | 'arquivada' } = {}): Promise<TrabLixeira> {
    await this.exigirGente(orgId, actorId);
    await this.garantirRotinaDoExpurgo(orgId);
    const where: Prisma.WorkTaskWhereInput = {
      orgId,
      ...(filtro.estado === 'excluida' ? { excluidaEm: { not: null } }
        : filtro.estado === 'arquivada' ? { excluidaEm: null, archived: true }
          : { OR: [{ excluidaEm: { not: null } }, { archived: true }] }),
      ...(filtro.q?.trim() ? { title: { contains: filtro.q.trim(), mode: 'insensitive' as const } } : {}),
    };
    const [linhas, total, rotina] = await Promise.all([
      this.prisma.workTask.findMany({
        where,
        orderBy: [{ excluidaEm: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }, { id: 'asc' }],
        take: LIMITE_DA_LIXEIRA,
        select: {
          id: true, title: true, listId: true, parentId: true, archived: true, excluidaEm: true, excluidaPor: true, updatedAt: true,
          status: { select: { id: true, name: true } },
          list: { select: { id: true, name: true, arquivadaEm: true, folder: { select: { id: true, name: true } } } },
        },
      }),
      this.prisma.workTask.count({ where }),
      this.prisma.rotina.findUnique({ where: { orgId_slug: { orgId, slug: TRAB_SLUG_DA_ROTINA_DO_EXPURGO } }, select: { id: true, ativo: true, estado: true } }),
    ]);
    const visiveis = new Set((await this.prisma.workList.findMany({
      where: { orgId, id: { in: [...new Set(linhas.map((l) => l.listId))] }, AND: [listaVisivel()] }, select: { id: true },
    })).map((l) => l.id));
    const arquivadas = linhas.filter((l) => !l.excluidaEm);
    const [quando, cards] = await Promise.all([
      quandoForamArquivadas(this.prisma, orgId, arquivadas),
      cardsDaImplantacao(this.prisma, orgId, linhas),
    ]);
    const pessoas = await nomesDasPessoas(this.prisma, orgId, [
      ...linhas.map((l) => l.excluidaPor), ...[...quando.values()].map((q) => q.actorId),
    ]);
    const tarefas: TrabTarefaNaLixeira[] = linhas.map((l) => {
      const saida = l.excluidaEm ? { em: l.excluidaEm, actorId: l.excluidaPor } : quando.get(l.id) ?? { em: l.updatedAt, actorId: null };
      return {
        id: l.id,
        title: l.title,
        estado: l.excluidaEm ? 'excluida' : 'arquivada',
        em: saida.em.toISOString(),
        por: saida.actorId ? pessoas.get(saida.actorId) ?? null : null,
        lista: { id: l.list.id, name: l.list.name, arquivada: !visiveis.has(l.list.id) },
        pasta: l.list.folder ? { id: l.list.folder.id, name: l.list.folder.name } : null,
        status: { id: l.status.id, name: l.status.name },
        expiraEm: l.excluidaEm ? expiraNaLixeiraEm(l.excluidaEm).toISOString() : null,
        cardDaImplantacao: cards.has(l.id),
      };
    });
    return {
      tarefas, total, limite: LIMITE_DA_LIXEIRA, diasNaLixeira: TRAB_DIAS_NA_LIXEIRA,
      expurgo: { rotinaId: rotina?.id ?? null, ligado: !!rotina && rotina.ativo && estadoDispara(rotina.estado) },
    };
  }

  // ------------------------------------------------------------------ excluir

  async excluir(orgId: string, actorId: string, id: string, input: TrabTarefaExcluirInput = {}): Promise<TrabTarefaExcluida> {
    await this.exigirGente(orgId, actorId);
    const t = await this.prisma.workTask.findFirst({
      where: { id, orgId },
      select: { id: true, updatedAt: true, archived: true, excluidaEm: true, agenteId: true, listId: true, statusId: true },
    });
    if (!t) throw new NotFoundException('Tarefa não encontrada');
    if (t.excluidaEm) return { id, excluidaEm: t.excluidaEm.toISOString(), expiraEm: expiraNaLixeiraEm(t.excluidaEm).toISOString() };
    if (t.agenteId) throw new ConflictException(TRAB_TAREFA_COM_AGENTE);
    if (input.expectedUpdatedAt !== undefined && new Date(input.expectedUpdatedAt).getTime() !== t.updatedAt.getTime()) {
      throw new ConflictException(TAREFA_MUDOU);
    }
    const agora = new Date();
    await this.prisma.$transaction(async (tx) => {
      const updatedAt = new Date(Math.max(agora.getTime(), t.updatedAt.getTime() + 1));
      // Excluir também arquiva: toda listagem que filtra arquivada já a tira (ver `tarefaViva`).
      const r = await tx.workTask.updateMany({
        where: { id, orgId, excluidaEm: null, agenteId: null, updatedAt: t.updatedAt },
        data: { excluidaEm: agora, excluidaPor: actorId, archived: true, updatedAt },
      });
      if (r.count !== 1) throw new ConflictException(TAREFA_MUDOU);
      await this.audit.log({
        orgId, actorId, action: 'work.task.trash', entityType: 'work_task', entityId: id,
        before: { archived: t.archived, excluidaEm: null, listId: t.listId, statusId: t.statusId },
        after: { archived: true, excluidaEm: agora.toISOString() },
      }, tx);
      await exigirAcessoAtual(tx, orgId, actorId, ['tarefas.editar']);
    });
    return { id, excluidaEm: agora.toISOString(), expiraEm: expiraNaLixeiraEm(agora).toISOString() };
  }

  // ------------------------------------------------------------------ restaurar

  /*
   * RESTAURAR: a excluída e a arquivada voltam vivas (sem `excluidaEm`, sem
   * `archived`), na mesma lista e etapa de onde saíram (excluir e arquivar não
   * mexem nas duas). Se a lista, ou uma pasta acima dela, continua arquivada, a
   * tarefa volta assim mesmo e a resposta avisa: ela só aparece quando a lista for
   * desarquivada (pela própria Lixeira, aba Listas e pastas).
   */
  async restaurar(orgId: string, actorId: string, ids: readonly string[]): Promise<TrabTarefasRestauradas> {
    await this.exigirGente(orgId, actorId);
    const unicos = [...new Set(ids)];
    const alvo = await this.prisma.workTask.findMany({
      where: { orgId, id: { in: unicos } },
      select: { id: true, updatedAt: true, archived: true, excluidaEm: true, listId: true, list: { select: { name: true } } },
    });
    if (alvo.length !== unicos.length) throw new NotFoundException('Alguma tarefa pedida não existe nesta empresa.');
    const voltam = alvo.filter((t) => t.archived || t.excluidaEm);
    const agora = new Date();
    await this.prisma.$transaction(async (tx) => {
      for (const t of voltam) {
        const updatedAt = new Date(Math.max(agora.getTime(), t.updatedAt.getTime() + 1));
        const r = await tx.workTask.updateMany({
          where: { id: t.id, orgId, updatedAt: t.updatedAt },
          data: { archived: false, excluidaEm: null, excluidaPor: null, updatedAt },
        });
        if (r.count !== 1) throw new ConflictException(TAREFA_MUDOU);
        await this.audit.log({
          orgId, actorId, action: 'work.task.restore', entityType: 'work_task', entityId: t.id,
          before: { archived: t.archived, excluidaEm: t.excluidaEm?.toISOString() ?? null },
          after: { archived: false, excluidaEm: null },
          metadata: { origem: 'lixeira' },
        }, tx);
      }
      await exigirAcessoAtual(tx, orgId, actorId, ['tarefas.editar']);
    }, { timeout: 60_000 });
    const listas = [...new Set(voltam.map((t) => t.listId))];
    const visiveis = new Set((await this.prisma.workList.findMany({
      where: { orgId, id: { in: listas }, AND: [listaVisivel()] }, select: { id: true },
    })).map((l) => l.id));
    const avisos = listas.filter((l) => !visiveis.has(l)).map((l) => {
      const n = voltam.filter((t) => t.listId === l).length;
      const nome = voltam.find((t) => t.listId === l)?.list.name ?? 'de origem';
      return `A lista ${nome} continua arquivada: ${n === 1 ? 'a tarefa voltou' : `${n} tarefas voltaram`}, mas só ${n === 1 ? 'aparece' : 'aparecem'} quando a lista for desarquivada.`;
    });
    return { restauradas: voltam.length, ids: voltam.map((t) => t.id), jaVivas: alvo.length - voltam.length, avisos };
  }

  // ------------------------------------------------------------------ apagar de vez

  async apagarDeVez(orgId: string, actorId: string, ids: readonly string[], frase: string): Promise<TrabTarefasApagadasDeVez> {
    await this.exigirGente(orgId, actorId, ['tarefas.editar', 'admin.usuarios']);
    if (!fraseDeApagarDeVezConfere(frase)) {
      throw new BadRequestException(`Para apagar de vez, escreva: ${TRAB_FRASE_DE_APAGAR_DE_VEZ}`);
    }
    return this.apagar(orgId, { tipo: 'user', id: actorId }, [...new Set(ids)], null);
  }

  /*
   * O APAGAR DE VERDADE, de quem a regra deixa: só a excluída (e, no expurgo, a
   * excluída há mais de 30 dias), nunca o card da implantação. Uma transação por
   * tarefa: um vínculo que o banco protege (RESTRICT) derruba só aquela, que fica
   * na Lixeira com o motivo. Comentários, campos, etiquetas, horas, anexos (a
   * linha; o arquivo no armazém fica), reuniões e delegações caem em cascata; as
   * subtarefas ficam, sem mãe. A auditoria guarda a linha, sem o título.
   */
  private async apagar(orgId: string, ator: Ator, ids: string[], corte: Date | null): Promise<TrabTarefasApagadasDeVez> {
    const alvo = await this.prisma.workTask.findMany({
      where: { orgId, id: { in: ids } },
      select: { id: true, listId: true, parentId: true, statusId: true, excluidaEm: true, updatedAt: true },
    });
    const presas: { id: string; motivo: string }[] = [];
    for (const id of ids) if (!alvo.some((t) => t.id === id)) presas.push({ id, motivo: 'Tarefa não encontrada.' });
    const cards = await cardsDaImplantacao(this.prisma, orgId, alvo);
    const apagadas: string[] = [];
    for (const t of alvo) {
      if (!t.excluidaEm || (corte && t.excluidaEm >= corte)) { presas.push({ id: t.id, motivo: NA_LIXEIRA_SO_EXCLUIDA }); continue; }
      if (cards.has(t.id)) { presas.push({ id: t.id, motivo: CARD_NAO_SAI_DE_VEZ }); continue; }
      try {
        await this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`work-tarefa:${t.id}`}))`;
          const r = await tx.workTask.deleteMany({ where: { id: t.id, orgId, excluidaEm: { not: null }, updatedAt: t.updatedAt } });
          if (r.count !== 1) throw new ConflictException(TAREFA_MUDOU);
          await this.audit.log({
            orgId,
            actorId: ator.tipo === 'user' ? ator.id : undefined,
            actorType: ator.tipo === 'user' ? ActorType.user : ActorType.system,
            action: 'work.task.purge', entityType: 'work_task', entityId: t.id,
            before: { listId: t.listId, statusId: t.statusId, excluidaEm: t.excluidaEm!.toISOString() },
            after: { apagada: true },
            metadata: { origem: ator.tipo === 'user' ? 'lixeira.apagar-de-vez' : 'lixeira.expurgo' },
          }, tx);
          if (ator.tipo === 'user') await exigirAcessoAtual(tx, orgId, ator.id, ['tarefas.editar', 'admin.usuarios']);
        });
        apagadas.push(t.id);
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') { presas.push({ id: t.id, motivo: VINCULO_PROTEGIDO }); continue; }
        if (e instanceof ConflictException) { presas.push({ id: t.id, motivo: TAREFA_MUDOU }); continue; }
        throw e;
      }
    }
    return { apagadas: apagadas.length, ids: apagadas, presas };
  }

  // ------------------------------------------------------------------ expurgo (rotina)

  /** Uma passagem do expurgo: apaga de vez as excluídas há mais de 30 dias, desta empresa. */
  async expurgo(orgId: string, agora: Date = new Date()): Promise<ResultadoDaRotina> {
    const corte = new Date(agora.getTime() - TRAB_DIAS_NA_LIXEIRA * 24 * 60 * 60 * 1000);
    // Revisão (B2): o card da implantação nunca sai de vez; deixá-lo de fora da consulta impede
    // que 500 cards ocupem toda passagem e as outras vencidas nunca cheguem a vez delas.
    const [lista, trilhos] = await Promise.all([
      idDaListaDaImplantacao(this.prisma, orgId),
      this.prisma.onboardingTrilho.findMany({ where: { orgId, cardId: { not: null } }, select: { cardId: true } }),
    ]);
    const comTrilho = trilhos.map((t) => t.cardId).filter((x): x is string => !!x);
    const vencidas = await this.prisma.workTask.findMany({
      where: {
        orgId, excluidaEm: { lt: corte },
        ...(comTrilho.length ? { id: { notIn: comTrilho } } : {}),
        ...(lista ? { NOT: { listId: lista, parentId: null } } : {}),
      },
      select: { id: true }, take: 500, orderBy: { excluidaEm: 'asc' },
    });
    if (!vencidas.length) return { status: 'pulada', resumo: 'nenhuma tarefa na Lixeira há mais de 30 dias' };
    const r = await this.apagar(orgId, { tipo: 'system' }, vencidas.map((v) => v.id), corte);
    return { status: 'ok', resumo: `${r.apagadas} tarefa(s) apagada(s) de vez; ${r.presas.length} ficaram na Lixeira` };
  }

  /*
   * A ROTINA DO EXPURGO NASCE DESLIGADA (`ativo: false`, `planejado`): quem liga é
   * gente, em /rotinas. Semeada na primeira leitura da Lixeira, idempotente; nunca
   * lança (a Lixeira abre mesmo se a semente falhar).
   */
  private readonly semeadas = new Set<string>();

  async garantirRotinaDoExpurgo(orgId: string): Promise<void> {
    if (this.semeadas.has(orgId)) return;
    try {
      await this.prisma.rotina.upsert({
        where: { orgId_slug: { orgId, slug: TRAB_SLUG_DA_ROTINA_DO_EXPURGO } },
        create: {
          orgId,
          slug: TRAB_SLUG_DA_ROTINA_DO_EXPURGO,
          nome: 'Expurgo da Lixeira (30 dias)',
          tipo: TRAB_TIPO_DA_ROTINA_DO_EXPURGO,
          config: {} as Prisma.InputJsonValue,
          cron: CRON_DO_EXPURGO,
          tz: FUSO_DO_EXPURGO,
          ativo: false,
          estado: AgentEstado.planejado,
          origem: 'manual',
          refExterna: null,
          agenteSlug: null,
          reservadoEm: LIVRE,
          reservadoAte: LIVRE,
          proximaExecucaoEm: proximaOcorrencia(CRON_DO_EXPURGO, FUSO_DO_EXPURGO, new Date()),
        },
        update: {},
      });
      this.semeadas.add(orgId);
    } catch {
      // A semente é conveniência da tela: a rotina também nasce pelo POST /rotinas.
    }
  }
}
