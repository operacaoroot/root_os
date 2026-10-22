import { Injectable } from '@nestjs/common';
import { ActorType, type Prisma } from '@prisma/client';
import type {
  CaixaAtividade,
  CaixaAtividadeResposta,
  CaixaMinhaTarefa,
  CaixaTarefasQuery,
  CaixaTarefasResposta,
} from '@mktos/shared';

import { PrismaService } from '../prisma/prisma.service';
import { ModulosService } from '../tenants/modulos.service';
import { exigirTenant } from '../common/contexto-execucao';
import { nomesDosClientes } from '../work/clientes-da-casa';
import { listaVisivel, tarefaDeListaVisivel, tarefaViva } from '../work/arquivadas';
import {
  ESTADO_DO_EIXO,
  ehDeOutraPessoa,
  motivosDaParada,
  trechoDoComentario,
  type EstadoDoEixo,
} from './o-que-espera';
import {
  ACOES_DA_ATIVIDADE,
  ENTIDADE_DA_TAREFA,
  EVENTO_DO_TUDO,
  LOTE_POR_FONTE,
  ORIGEM,
  ORIGEM_DO_TUDO,
  TETO_LISTAS_DO_FILTRO,
  TETO_MINHAS_TAREFAS,
  TETO_TAREFAS_DA_ATIVIDADE,
  chaveDoItem,
  condicaoDepoisDoCursor,
  estaLimpo,
  filtroDoVencimento,
  juntarPagina,
  lerCursor,
  mudancasDaAuditoria,
  tipoDasMudancas,
  type ItemNaOrdem,
  type PontoDaOrdem,
} from './atividade-da-caixa';

/**
 * ============================================================================
 * A CAIXA DE ENTRADA — atividade e minhas tarefas (rodada do painel P1)
 * ============================================================================
 *
 * LEITURA, e só leitura. Este serviço não tem verbo de escrita (a suíte
 * `caixa-atividade.test.ts` reprova se ganhar um): ele lê a auditoria que a tela
 * do quadro grava (`AuditLog`), os comentários (`WorkComment`), as tarefas e as
 * marcas de "limpei" que a própria pessoa deixou (`CaixaVisto`). Quem ESCREVE a
 * marca é `CaixaVistoService`, ao lado, e ele só escreve a do próprio usuário.
 *
 * O GATE É O MESMO DA CAIXA (`caixa.service.ts`): a rota é de espinha e pede
 * `dashboard.ver`; o quadro só é lido com `tarefas.ver` na sessão E o módulo
 * `trabalho` contratado. Sem isso, o eixo volta com o estado (`sem_permissao`,
 * `modulo_desligado`) e lista vazia — nunca 403 na tela inteira, e nunca dado de
 * módulo que a empresa não contratou.
 *
 * EMPRESA EM TODA CONSULTA. `AuditLog` não tem relação com `WorkTask` (o
 * `entityId` é texto), e a conexão dona atravessa o isolamento por linha: cada
 * `where` leva o `orgId`, e a atividade parte SÓ dos ids das tarefas desta
 * empresa que são minhas.
 */

const VER_TAREFAS = 'tarefas.ver';
const MODULO_DO_QUADRO = 'trabalho';

interface Eu {
  id: string;
  nome: string;
  identidades: string[];
}

export interface PedidoDaAtividade {
  orgId: string;
  usuarioId: string;
  permissoes: readonly string[];
  antesDe?: string | null;
  incluirLimpos: boolean;
  incluirMeus: boolean;
  limite: number;
}

export interface PedidoDasTarefas {
  orgId: string;
  usuarioId: string;
  permissoes: readonly string[];
  filtros: CaixaTarefasQuery;
}

/*
 * QUEM É "EU" (versão final, 19/10/2026): a produção (entrega do Pedro de 14/10)
 * passou a identificar as tarefas pessoais pela CONTA (`assigneeUserId`), nunca
 * pelo texto antigo do responsável, e o Lucas acrescentou os outros responsáveis
 * (`outrosResponsaveisIds`). As abas Atividade e Minhas tarefas seguem a mesma
 * regra. Os nomes continuam na resposta só para a tela dizer quem é você.
 */
function identidadesDe(pessoa: { name?: string | null; email?: string | null }): string[] {
  const saida: string[] = [];
  const vistos = new Set<string>();
  for (const bruto of [pessoa.name ?? '', pessoa.email ?? '']) {
    const limpo = bruto.trim();
    if (!limpo || vistos.has(limpo.toLowerCase())) continue;
    vistos.add(limpo.toLowerCase());
    saida.push(limpo);
  }
  return saida;
}

function condicoesDaConta(usuarioId: string): Prisma.WorkTaskWhereInput[] {
  return [{ assigneeUserId: usuarioId }, { outrosResponsaveisIds: { has: usuarioId } }];
}

@Injectable()
export class CaixaAtividadeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modulos: ModulosService,
  ) {}

  /* ====================================================================== *
   * O PORTÃO COMUM
   * ====================================================================== */

  private async portao(
    orgId: string,
    usuarioId: string,
    permissoes: readonly string[],
  ): Promise<{ estado: EstadoDoEixo; eu: Eu | undefined }> {
    const u = await this.prisma.user.findFirst({
      where: { id: usuarioId, orgId, isActive: true },
      select: { id: true, name: true, email: true },
    });
    if (!u) return { estado: ESTADO_DO_EIXO.foraDaCasa, eu: undefined };
    const eu: Eu = {
      id: u.id,
      nome: u.name,
      identidades: identidadesDe({ name: u.name, email: u.email }),
    };
    if (!permissoes.includes(VER_TAREFAS)) return { estado: ESTADO_DO_EIXO.semPermissao, eu };
    const contratados = await this.modulos.modulosDaOrg(orgId);
    if (!contratados.has(MODULO_DO_QUADRO)) return { estado: ESTADO_DO_EIXO.moduloDesligado, eu };
    return { estado: ESTADO_DO_EIXO.ok, eu };
  }

  /* ====================================================================== *
   * A ABA ATIVIDADE
   * ====================================================================== */

  async atividade(pedido: PedidoDaAtividade): Promise<CaixaAtividadeResposta> {
    const orgId = exigirTenant(pedido.orgId, 'CaixaAtividadeService.atividade');
    const agora = new Date();
    const base = {
      itens: [] as CaixaAtividade[],
      proximo: null,
      limpoAte: null,
      incluirLimpos: pedido.incluirLimpos,
      incluirMeus: pedido.incluirMeus,
      tarefasTruncadas: false,
      agora: agora.toISOString(),
    };

    const { estado, eu } = await this.portao(orgId, pedido.usuarioId, pedido.permissoes);
    const identidades = eu?.identidades ?? [];
    if (estado !== ESTADO_DO_EIXO.ok || !eu) return { ...base, estado, identidades };
    if (identidades.length === 0) {
      return { ...base, estado: ESTADO_DO_EIXO.semIdentidade, identidades };
    }

    // As minhas tarefas — o responsável de AGORA, pela regra de `o-que-espera`.
    const tarefas = await this.prisma.workTask.findMany({
      where: { orgId, archived: false, OR: condicoesDaConta(eu.id), AND: [tarefaDeListaVisivel(), tarefaViva()] },
      orderBy: { updatedAt: 'desc' },
      take: TETO_TAREFAS_DA_ATIVIDADE + 1,
      select: { id: true, title: true, list: { select: { name: true } } },
    });
    const tarefasTruncadas = tarefas.length > TETO_TAREFAS_DA_ATIVIDADE;
    const minhas = tarefasTruncadas ? tarefas.slice(0, TETO_TAREFAS_DA_ATIVIDADE) : tarefas;
    const porTarefa = new Map(minhas.map((t) => [t.id, t]));
    const ids = [...porTarefa.keys()];

    // O "limpar tudo" desta pessoa: um instante, não uma linha por evento.
    const tudo = await this.prisma.caixaVisto.findFirst({
      where: { orgId, userId: eu.id, origem: ORIGEM_DO_TUDO, eventoId: EVENTO_DO_TUDO },
      select: { ate: true },
    });
    const limpoAte = tudo?.ate ?? null;

    if (ids.length === 0) {
      return {
        ...base,
        estado,
        identidades,
        limpoAte: limpoAte?.toISOString() ?? null,
        tarefasTruncadas,
      };
    }

    const cursor = lerCursor(pedido.antesDe);
    // Limpo pelo "tudo" sai já no banco (sem o histórico): é o que mais pesa.
    const depoisDoTudo: Prisma.DateTimeFilter | undefined =
      !pedido.incluirLimpos && limpoAte ? { gt: limpoAte } : undefined;

    const auditoria = await this.prisma.auditLog.findMany({
      where: {
        orgId,
        entityType: ENTIDADE_DA_TAREFA,
        entityId: { in: ids },
        action: { in: [...ACOES_DA_ATIVIDADE] },
        AND: [
          condicaoDepoisDoCursor(ORIGEM.auditoria, cursor) as Prisma.AuditLogWhereInput,
          depoisDoTudo ? { createdAt: depoisDoTudo } : {},
          // `actorId <> eu` em SQL deixa de fora o NULO — o registro sem
          // ninguém é de outra pessoa, e por isso o OR explícito.
          pedido.incluirMeus ? {} : { OR: [{ actorId: null }, { actorId: { not: eu.id } }] },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: LOTE_POR_FONTE,
      select: {
        id: true,
        action: true,
        actorType: true,
        actorId: true,
        entityId: true,
        before: true,
        after: true,
        createdAt: true,
      },
    });

    const comentarios = await this.prisma.workComment.findMany({
      where: {
        orgId,
        taskId: { in: ids },
        // A empresa conferida também na tarefa: `WorkComment.orgId` vem de
        // gatilho, e dado antigo pode divergir.
        task: { orgId },
        AND: [
          condicaoDepoisDoCursor(ORIGEM.comentario, cursor) as Prisma.WorkCommentWhereInput,
          depoisDoTudo ? { createdAt: depoisDoTudo } : {},
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: LOTE_POR_FONTE,
      select: { id: true, taskId: true, text: true, authorId: true, authorName: true, createdAt: true },
    });

    // As marcas uma a uma, só dos eventos desta leva.
    const marcas = await this.prisma.caixaVisto.findMany({
      where: {
        orgId,
        userId: eu.id,
        OR: [
          { origem: ORIGEM.auditoria, eventoId: { in: auditoria.map((a) => a.id) } },
          { origem: ORIGEM.comentario, eventoId: { in: comentarios.map((c) => c.id) } },
        ],
      },
      select: { origem: true, eventoId: true },
    });
    const marcados = new Set(marcas.map((m) => `${m.origem}:${m.eventoId}`));

    // Os nomes de quem fez: só gente desta empresa, numa consulta.
    const idsDeGente = [
      ...new Set(
        auditoria
          .filter((a) => a.actorType === ActorType.user && a.actorId)
          .map((a) => a.actorId as string),
      ),
    ];
    const gente = idsDeGente.length
      ? await this.prisma.user.findMany({
          where: { orgId, id: { in: idsDeGente } },
          select: { id: true, name: true },
        })
      : [];
    const nomeDe = new Map(gente.map((g) => [g.id, g.name]));

    const itensDaAuditoria: ItemNaOrdem[] = [];
    for (const a of auditoria) {
      const t = a.entityId ? porTarefa.get(a.entityId) : undefined;
      if (!t) continue;
      const chave = chaveDoItem(ORIGEM.auditoria, a.id);
      const criacao = a.action === 'work.task.create';
      const mudancas = criacao ? [] : mudancasDaAuditoria(a.before, a.after);
      // Edição que não mexeu em nada que a caixa mostra (ordem, descrição,
      // campo) não é recado: fica fora.
      if (!criacao && mudancas.length === 0) continue;
      const limpo = estaLimpo({ quando: a.createdAt, chave }, limpoAte, marcados);
      if (limpo && !pedido.incluirLimpos) continue;
      itensDaAuditoria.push({
        quando: a.createdAt,
        chave,
        item: {
          id: chave,
          origem: ORIGEM.auditoria,
          tipo: criacao ? 'criacao' : tipoDasMudancas(mudancas),
          tarefaId: t.id,
          tarefaTitulo: t.title,
          lista: t.list?.name ?? null,
          quem:
            a.actorType === ActorType.user
              ? ((a.actorId && nomeDe.get(a.actorId)) ?? null)
              : a.actorType === ActorType.ai
                ? 'agente'
                : 'sistema',
          quemTipo: a.actorType,
          porMim: a.actorType === ActorType.user && a.actorId === eu.id,
          quando: a.createdAt.toISOString(),
          mudancas,
          trecho: null,
          trechoCortado: false,
          limpo,
        },
      });
    }

    const itensDosComentarios: ItemNaOrdem[] = [];
    for (const c of comentarios) {
      const t = porTarefa.get(c.taskId);
      if (!t) continue;
      const deOutro = ehDeOutraPessoa(c, { id: eu.id, name: eu.nome });
      if (!deOutro && !pedido.incluirMeus) continue;
      const chave = chaveDoItem(ORIGEM.comentario, c.id);
      const limpo = estaLimpo({ quando: c.createdAt, chave }, limpoAte, marcados);
      if (limpo && !pedido.incluirLimpos) continue;
      const { trecho, truncado } = trechoDoComentario(c.text);
      itensDosComentarios.push({
        quando: c.createdAt,
        chave,
        item: {
          id: chave,
          origem: ORIGEM.comentario,
          tipo: 'comentario',
          tarefaId: t.id,
          tarefaTitulo: t.title,
          lista: t.list?.name ?? null,
          quem: c.authorName,
          quemTipo: 'user',
          porMim: !deOutro,
          quando: c.createdAt.toISOString(),
          mudancas: [],
          trecho,
          trechoCortado: truncado,
          limpo,
        },
      });
    }

    const ultima = <T extends { id: string; createdAt: Date }>(
      linhas: T[],
      origem: typeof ORIGEM.auditoria | typeof ORIGEM.comentario,
    ): PontoDaOrdem | null => {
      const l = linhas[linhas.length - 1];
      return l ? { quando: l.createdAt, chave: chaveDoItem(origem, l.id) } : null;
    };

    const pagina = juntarPagina(
      [
        {
          itens: itensDaAuditoria,
          cheia: auditoria.length >= LOTE_POR_FONTE,
          ultimaLida: ultima(auditoria, ORIGEM.auditoria),
        },
        {
          itens: itensDosComentarios,
          cheia: comentarios.length >= LOTE_POR_FONTE,
          ultimaLida: ultima(comentarios, ORIGEM.comentario),
        },
      ],
      pedido.limite,
    );

    return {
      estado,
      identidades,
      itens: pagina.itens.map((i) => i.item),
      proximo: pagina.proximo,
      limpoAte: limpoAte?.toISOString() ?? null,
      incluirLimpos: pedido.incluirLimpos,
      incluirMeus: pedido.incluirMeus,
      tarefasTruncadas,
      agora: agora.toISOString(),
    };
  }

  /* ====================================================================== *
   * A ABA MINHAS TAREFAS
   * ====================================================================== */

  async tarefas(pedido: PedidoDasTarefas): Promise<CaixaTarefasResposta> {
    const orgId = exigirTenant(pedido.orgId, 'CaixaAtividadeService.tarefas');
    const agora = new Date();
    const f = pedido.filtros;
    const base = {
      itens: [] as CaixaMinhaTarefa[],
      truncado: false,
      teto: TETO_MINHAS_TAREFAS,
      listas: [] as CaixaTarefasResposta['listas'],
      status: [] as string[],
      filtros: f,
      agora: agora.toISOString(),
    };

    const { estado, eu } = await this.portao(orgId, pedido.usuarioId, pedido.permissoes);
    const identidades = eu?.identidades ?? [];
    if (estado !== ESTADO_DO_EIXO.ok || !eu) return { ...base, estado, identidades };

    const listas = await this.prisma.workList.findMany({
      where: { orgId, ...listaVisivel() },
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
      take: TETO_LISTAS_DO_FILTRO,
      select: { id: true, name: true, folderId: true, folder: { select: { name: true } } },
    });
    const statusDaEmpresa = await this.prisma.workStatus.findMany({
      where: { orgId },
      distinct: ['name'],
      orderBy: { name: 'asc' },
      take: 200,
      select: { name: true },
    });
    const filtrosDaTela = {
      listas: listas.map((l) => ({
        id: l.id,
        nome: l.name,
        pastaId: l.folderId,
        pasta: l.folder?.name ?? null,
      })),
      status: statusDaEmpresa.map((s) => s.name),
    };

    if (f.responsavel === 'eu' && identidades.length === 0) {
      return { ...base, ...filtrosDaTela, estado: ESTADO_DO_EIXO.semIdentidade, identidades };
    }

    const status: Prisma.WorkStatusWhereInput = {};
    if (f.status) status.name = f.status;
    if (!f.encerradas) status.type = { not: 'closed' };

    const where: Prisma.WorkTaskWhereInput = {
      orgId,
      archived: false,
      ...(f.responsavel === 'eu' ? { OR: condicoesDaConta(eu.id) } : {}),
      ...(f.listaId ? { listId: f.listaId } : {}),
      ...(f.pastaId ? { list: { orgId, folderId: f.pastaId } } : {}),
      ...(Object.keys(status).length ? { status } : {}),
      ...(f.vencimento ? { dueDate: filtroDoVencimento(f.vencimento, agora) } : {}),
      // Lista ou pasta arquivada sai das minhas tarefas (21/10/2026).
      AND: [tarefaDeListaVisivel(), tarefaViva()],
    };

    const linhas = await this.prisma.workTask.findMany({
      where,
      orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { updatedAt: 'desc' }],
      take: TETO_MINHAS_TAREFAS + 1,
      select: {
        id: true,
        title: true,
        dueDate: true,
        updatedAt: true,
        agenteId: true,
        agenteEm: true,
        assignee: true,
        listId: true,
        clienteId: true,
        priority: true,
        createdAt: true,
        status: { select: { name: true, color: true, type: true } },
        list: { select: { name: true, folderId: true, folder: { select: { name: true } } } },
        _count: { select: { comments: true } },
      },
    });
    const truncado = linhas.length > TETO_MINHAS_TAREFAS;
    const pagina = truncado ? linhas.slice(0, TETO_MINHAS_TAREFAS) : linhas;
    // T3/T4: o cliente, escopado por empresa (o mesmo ajudante do Trabalho).
    const clientes = await nomesDosClientes(this.prisma, orgId, pagina.map((t) => t.clienteId));

    return {
      ...base,
      ...filtrosDaTela,
      estado,
      identidades,
      truncado,
      itens: pagina.map((t) => ({
        id: t.id,
        titulo: t.title,
        listaId: t.listId,
        lista: t.list.name,
        pastaId: t.list.folderId,
        pasta: t.list.folder?.name ?? null,
        status: t.status.name,
        statusCor: t.status.color,
        statusTipo: t.status.type,
        prazo: t.dueDate?.toISOString() ?? null,
        responsavel: t.assignee,
        comentarios: t._count.comments,
        atualizadaEm: t.updatedAt.toISOString(),
        criadaEm: t.createdAt.toISOString(),
        prioridade: t.priority,
        clienteId: t.clienteId && clientes.has(t.clienteId) ? t.clienteId : null,
        cliente: t.clienteId ? clientes.get(t.clienteId) ?? null : null,
        // Tarefa encerrada não está parada: ela acabou.
        motivos: t.status.type === 'closed' ? [] : motivosDaParada(t, agora),
      })),
    };
  }
}
