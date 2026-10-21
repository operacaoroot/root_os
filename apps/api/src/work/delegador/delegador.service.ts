import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { funcaoPorId, type AceitarDelegacao, type DelegacaoDaTarefa, type DelegacaoSugestaoDto } from '@mktos/shared';

import { temPapelDeMaquina } from '../../approvals/alcada';
import { AuditService } from '../../audit/audit.service';
import { lerAprovador } from '../../auth/aprovador';
import { LLM_PROVIDER, type LlmProvider } from '../../llm/llm.provider';
import { umaPorVez } from '../../pauta/uma-por-vez';
import { PrismaService } from '../../prisma/prisma.service';
import { WorkService } from '../work.service';
import {
  DelegacaoIlegivelError,
  agentesParaDelegar,
  interpretarDelegacao,
  promptDoDelegador,
  type PessoaParaDelegar,
} from './delegador';

export const RECUSA_DE_MAQUINA_NO_DELEGADOR =
  'Delegar é decisão de gente: conta de serviço (IA) não pede, não aceita e não descarta subtarefa.';

export interface QuemDelega {
  id: string;
  papeis: readonly string[];
}

const diaEmSaoPaulo = (d: Date): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

/**
 * TR-09 · O DELEGADOR (rodada dos agentes, 21/10/2026; mínimo). Ver `delegador.ts`.
 *
 * Pedir, aceitar e descartar são de GENTE (o token no controller e o banco
 * aqui, como nas atas). Aceitar toma a sugestão por escrita condicionada e cria
 * a subtarefa NA MESMA TRANSAÇÃO (a variante transacional do `WorkService`):
 * dois cliques = uma subtarefa, e nunca sobra sugestão aceita sem subtarefa.
 */
@Injectable()
export class DelegadorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly work: WorkService,
    private readonly audit: AuditService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
  ) {}

  async daTarefa(orgId: string, taskId: string): Promise<DelegacaoDaTarefa> {
    const t = await this.prisma.workTask.findFirst({
      where: { id: taskId, orgId },
      select: { id: true, agenteId: true, agente: { select: { nome: true, orgId: true } } },
    });
    if (!t) throw new NotFoundException('Tarefa não encontrada.');
    const linhas = await this.prisma.delegacaoSugestao.findMany({ where: { orgId, taskId }, orderBy: { criadaEm: 'asc' } });
    return {
      atribuidaAAgente: !!t.agenteId,
      agente: t.agente && t.agente.orgId === orgId ? t.agente.nome : null,
      sugestoes: await this.paraDtos(orgId, linhas),
    };
  }

  async propor(orgId: string, quem: QuemDelega, taskId: string): Promise<DelegacaoDaTarefa> {
    await this.exigirGente(orgId, quem);
    return umaPorVez(`trabalho-delegador:${orgId}:${taskId}`, 'O delegador desta tarefa', () => this.proporAgora(orgId, quem, taskId));
  }

  private async proporAgora(orgId: string, quem: QuemDelega, taskId: string): Promise<DelegacaoDaTarefa> {
    const t = await this.prisma.workTask.findFirst({
      where: { id: taskId, orgId },
      select: {
        id: true, title: true, description: true, dueDate: true, archived: true, agenteId: true,
        agente: { select: { nome: true, orgId: true } }, status: { select: { type: true } },
      },
    });
    if (!t) throw new NotFoundException('Tarefa não encontrada.');
    if (!t.agenteId) throw new BadRequestException('O delegador trabalha na tarefa atribuída a um agente. Esta não está com nenhum.');
    if (t.archived || t.status.type === 'closed') throw new ConflictException('A tarefa está encerrada: não há o que repartir.');
    const pessoas = await this.pessoas(orgId);
    const agentes = agentesParaDelegar();
    const hoje = diaEmSaoPaulo(new Date());
    const prazoDaTarefa = t.dueDate ? diaEmSaoPaulo(t.dueDate) : null;
    const { system, user } = promptDoDelegador({
      tarefa: { titulo: t.title, descricao: t.description, prazo: prazoDaTarefa, agente: t.agente && t.agente.orgId === orgId ? t.agente.nome : null },
      pessoas,
      agentes,
      hoje,
    });
    const saida = await this.llm.step({ funcao: 'TR-09', system, turns: [{ role: 'user', text: user }], orgId, maxTokens: 4000 });
    let lidas;
    try {
      lidas = interpretarDelegacao(saida.text, { pessoas, agentes, hoje, prazoDaTarefa });
    } catch (e) {
      if (e instanceof DelegacaoIlegivelError) throw new BadRequestException(e.message);
      throw e;
    }
    if (lidas.subtarefas.length) {
      await this.prisma.delegacaoSugestao.createMany({
        data: lidas.subtarefas.map((s) => ({
          orgId,
          taskId,
          titulo: s.titulo,
          descricao: s.descricao,
          donoTipo: s.donoTipo,
          donoUsuarioId: s.donoUsuarioId,
          donoFuncao: s.donoFuncao,
          prazo: s.prazo ? new Date(`${s.prazo}T12:00:00.000Z`) : null,
          porque: s.porque,
          criadaPor: quem.id,
        })),
      });
    }
    await this.audit.log({
      orgId,
      actorId: quem.id,
      action: 'trabalho.delegacao.proposta',
      entityType: 'work_task',
      entityId: taskId,
      after: { propostas: lidas.subtarefas.length, avisos: lidas.avisos.length, custoUsd: saida.usage.custoUsd, modelo: saida.usage.modeloServido },
    });
    return this.daTarefa(orgId, taskId);
  }

  async aceitar(orgId: string, quem: QuemDelega, id: string, input: AceitarDelegacao): Promise<DelegacaoSugestaoDto> {
    await this.exigirGente(orgId, quem);
    const s = await this.prisma.delegacaoSugestao.findFirst({ where: { id, orgId } });
    if (!s) throw new NotFoundException('Sugestão não encontrada.');
    if (s.estado !== 'rascunho') throw this.jaDecidida(s.estado);
    const mae = await this.prisma.workTask.findFirst({ where: { id: s.taskId, orgId }, select: { id: true, listId: true, archived: true } });
    if (!mae || mae.archived) throw new ConflictException('A tarefa-mãe não existe mais ou foi arquivada.');

    // A pessoa dona: a escolhida na tela, ou a da sugestão. Agente sugerido não vira atribuição sozinho.
    let responsavelId: string | null = s.donoTipo === 'pessoa' ? s.donoUsuarioId : null;
    if (input.responsavelId !== undefined) responsavelId = input.responsavelId;
    if (responsavelId) {
      const pessoa = await this.prisma.user.findFirst({
        where: { id: responsavelId, orgId, isActive: true },
        select: { id: true, roles: { select: { key: true } } },
      });
      if (!pessoa || pessoa.roles.some((r) => ['ia_servico', 'ia_acao'].includes(r.key))) {
        throw new BadRequestException('O responsável escolhido não é uma pessoa desta empresa.');
      }
    }
    const prazo = input.prazo === undefined ? (s.prazo ? s.prazo.toISOString().slice(0, 10) : null) : input.prazo;
    const agente = s.donoFuncao ? funcaoPorId(s.donoFuncao) : undefined;
    const descricao = [
      s.descricao,
      '',
      agente ? `Sugerida para o agente ${agente.nome} (${agente.id}). Quem aceitou decide se e quando ele assume.` : '',
      s.porque ? `Por quê: ${s.porque}` : '',
      `Proposta pelo Delegador (TR-09) e aceita por uma pessoa.`,
    ].filter((l, i, arr) => l || (i > 0 && arr[i - 1])).join('\n').trim();
    const preparo = await this.work.prepararCriacaoDeTarefa(orgId, {
      listId: mae.listId,
      parentId: mae.id,
      title: input.titulo?.trim() || s.titulo,
      description: descricao,
      assigneeUserId: responsavelId,
      dueDate: prazo ? new Date(`${prazo}T12:00:00.000Z`).toISOString() : null,
    });
    const subtarefaId = await this.prisma.$transaction(async (tx) => {
      const tomada = await tx.delegacaoSugestao.updateMany({
        where: { id, orgId, estado: 'rascunho' },
        data: { estado: 'aceita', decididaPor: quem.id, decididaEm: new Date() },
      });
      if (tomada.count === 0) {
        const agora = await tx.delegacaoSugestao.findFirst({ where: { id, orgId }, select: { estado: true } });
        throw this.jaDecidida(agora?.estado ?? 'aceita');
      }
      const sub = await this.work.gravarTarefaPreparada(tx, preparo);
      await tx.delegacaoSugestao.updateMany({ where: { id, orgId, estado: 'aceita' }, data: { subtarefaId: sub.id } });
      return sub.id;
    });
    await this.work.auditarCriacaoDeTarefa(orgId, quem.id, subtarefaId);
    await this.audit.log({
      orgId,
      actorId: quem.id,
      action: 'trabalho.delegacao.aceita',
      entityType: 'delegacao_sugestao',
      entityId: id,
      after: { taskId: s.taskId, subtarefaId, donoCorrigido: responsavelId !== (s.donoUsuarioId ?? null) },
    });
    const final = await this.prisma.delegacaoSugestao.findFirstOrThrow({ where: { id, orgId } });
    return (await this.paraDtos(orgId, [final]))[0];
  }

  async descartar(orgId: string, quem: QuemDelega, id: string): Promise<DelegacaoSugestaoDto> {
    await this.exigirGente(orgId, quem);
    const r = await this.prisma.delegacaoSugestao.updateMany({
      where: { id, orgId, estado: 'rascunho' },
      data: { estado: 'descartada', decididaPor: quem.id, decididaEm: new Date() },
    });
    if (r.count === 0) {
      const agora = await this.prisma.delegacaoSugestao.findFirst({ where: { id, orgId }, select: { estado: true } });
      if (!agora) throw new NotFoundException('Sugestão não encontrada.');
      throw this.jaDecidida(agora.estado);
    }
    await this.audit.log({ orgId, actorId: quem.id, action: 'trabalho.delegacao.descartada', entityType: 'delegacao_sugestao', entityId: id });
    const final = await this.prisma.delegacaoSugestao.findFirstOrThrow({ where: { id, orgId } });
    return (await this.paraDtos(orgId, [final]))[0];
  }

  private async pessoas(orgId: string): Promise<PessoaParaDelegar[]> {
    const gente = await this.prisma.user.findMany({
      where: { orgId, isActive: true, roles: { none: { key: { in: ['ia_servico', 'ia_acao'] } } } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return gente.map((g) => ({ id: g.id, nome: g.name }));
  }

  private async exigirGente(orgId: string, quem: QuemDelega): Promise<void> {
    if (temPapelDeMaquina(quem.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA_NO_DELEGADOR);
    const doBanco = await lerAprovador(this.prisma, quem.id, orgId);
    if (!doBanco || !doBanco.ativo) throw new ForbiddenException('Quem decide precisa ser um usuário ativo desta empresa.');
    if (temPapelDeMaquina(doBanco.papeis)) throw new ForbiddenException(RECUSA_DE_MAQUINA_NO_DELEGADOR);
  }

  private jaDecidida(estado: string): ConflictException {
    return new ConflictException(
      estado === 'descartada' ? 'Esta sugestão já foi descartada.' : 'Esta sugestão já foi aceita: a subtarefa já existe.',
    );
  }

  private async paraDtos(
    orgId: string,
    linhas: Awaited<ReturnType<PrismaService['delegacaoSugestao']['findMany']>>,
  ): Promise<DelegacaoSugestaoDto[]> {
    const ids = [...new Set(linhas.map((l) => l.donoUsuarioId).filter((x): x is string => !!x))];
    const gente = ids.length ? await this.prisma.user.findMany({ where: { orgId, id: { in: ids } }, select: { id: true, name: true } }) : [];
    const nomes = new Map(gente.map((g) => [g.id, g.name]));
    return linhas.map((l) => ({
      id: l.id,
      taskId: l.taskId,
      titulo: l.titulo,
      descricao: l.descricao,
      donoTipo: l.donoTipo === 'agente' ? 'agente' : 'pessoa',
      donoUsuarioId: l.donoUsuarioId,
      donoNome: l.donoUsuarioId ? nomes.get(l.donoUsuarioId) ?? null : l.donoFuncao ? funcaoPorId(l.donoFuncao)?.nome ?? l.donoFuncao : null,
      donoFuncao: l.donoFuncao,
      prazo: l.prazo ? l.prazo.toISOString().slice(0, 10) : null,
      porque: l.porque,
      estado: l.estado as DelegacaoSugestaoDto['estado'],
      subtarefaId: l.subtarefaId,
      decididaEm: l.decididaEm?.toISOString() ?? null,
    }));
  }
}
