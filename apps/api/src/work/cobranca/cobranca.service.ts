import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import {
  NOTA_DOS_DIAS_DA_COBRANCA,
  OPCOES_DA_COBRANCA,
  TIPO_DA_PENDENCIA_DE_COBRANCA,
  TIPO_DA_ROTINA_DE_COBRANCA,
} from '@mktos/shared';

import { AuditService } from '../../audit/audit.service';
import { LLM_PROVIDER, type LlmProvider } from '../../llm/llm.provider';
import { MemoriaService } from '../../memory/memoria.service';
import { PendenciasRegistry } from '../../pendencias/pendencias.registry';
import { PendenciasService } from '../../pendencias/pendencias.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ExecutoresDeRotinaRegistry } from '../../routines/executores.registry';
import type { ContextoDaRotina, ResultadoDaRotina } from '../../routines/rotina.tipos';
import { tarefaDeListaVisivel } from '../arquivadas';
import {
  chaveDaCobranca,
  cobrancasPorPessoa,
  contextoDaCobranca,
  corteDaParada,
  diaEmSaoPaulo,
  diasDaNota,
  fraseDoModelo,
  fraseDoSistema,
  promptDaCobranca,
  tituloDaCobranca,
  type CobrancaDaPessoa,
} from './cobranca';

/** Teto de tarefas lidas por passagem (as mais antigas primeiro). */
const TETO_DE_TAREFAS = 1000;

/**
 * TR-07 · O COBRADOR DE TAREFAS (rodada dos agentes, 21/10/2026). Ver `cobranca.ts`.
 *
 * O executor da rotina `trabalho.cobranca` e o tratador da pendência
 * `tarefa.cobranca` se inscrevem nos registros (rotinas e pendências), como o
 * relógio do onboarding. Responder "vou tratar" ou "já tratei" só fica
 * registrado (auditoria): nada sai do OS, nenhuma tarefa é mexida sozinha.
 */
@Injectable()
export class CobrancaDeTarefasService implements OnModuleInit {
  private readonly log = new Logger('CobradorDeTarefas');

  constructor(
    private readonly prisma: PrismaService,
    private readonly pendencias: PendenciasService,
    @Inject(LLM_PROVIDER) private readonly llm: LlmProvider,
    @Optional() private readonly memoria?: MemoriaService,
    @Optional() private readonly rotinas?: ExecutoresDeRotinaRegistry,
    @Optional() private readonly registroDePendencias?: PendenciasRegistry,
    @Optional() private readonly audit?: AuditService,
  ) {}

  onModuleInit(): void {
    this.rotinas?.registrar({ [TIPO_DA_ROTINA_DE_COBRANCA]: (ctx) => this.executar(ctx) }, 'CobrancaDeTarefasService');
    this.registroDePendencias?.aoResponder(
      TIPO_DA_PENDENCIA_DE_COBRANCA,
      async (r) => {
        await this.audit?.log({
          orgId: r.orgId,
          actorId: r.usuarioId,
          action: 'trabalho.cobranca.respondida',
          entityType: 'pendencia',
          entityId: r.pendenciaId,
          after: { escolha: r.escolha },
        });
      },
      'CobrancaDeTarefasService',
    );
  }

  /** N da nota `trabalho.cobranca.dias` (fonte aberta, leitor nulo), ou o padrão. */
  async dias(orgId: string): Promise<number> {
    const nota = this.memoria ? await this.memoria.porChave(orgId, NOTA_DOS_DIAS_DA_COBRANCA, null).catch(() => null) : null;
    return diasDaNota(nota && !nota.arquivadoEm ? nota.body : null);
  }

  async executar(ctx: ContextoDaRotina): Promise<ResultadoDaRotina> {
    const r = await this.cobrar(ctx.orgId, ctx.agora);
    if (!r.pessoas && !r.semDono) return { status: 'pulada', resumo: 'nenhuma tarefa vencida, parada ou sem dono.' };
    return {
      status: 'ok',
      resumo:
        `${r.pessoas} pessoa(s) com item na caixa: ${r.vencidas} vencida(s), ${r.paradas} parada(s) há mais de ${r.dias} dias` +
        `${r.semDono ? `, ${r.semDono} sem dono` : ''}; frase do modelo em ${r.doModelo} de ${r.pessoas + (r.semDono ? 1 : 0)}.`,
    };
  }

  /** Uma passagem. Separada do executor para a suíte e o "rodar agora" medirem o mesmo caminho. */
  async cobrar(orgId: string, agora = new Date()): Promise<{
    pessoas: number;
    vencidas: number;
    paradas: number;
    semDono: number;
    dias: number;
    doModelo: number;
    pendencias: string[];
  }> {
    const dias = await this.dias(orgId);
    const corte = corteDaParada(agora, dias);
    const [linhas, gente] = await Promise.all([
      this.prisma.workTask.findMany({
        where: {
          orgId,
          archived: false,
          status: { type: { not: 'closed' } },
          AND: [
            tarefaDeListaVisivel(),
            {
              OR: [
                { dueDate: { lt: agora } },
                { statusDesde: { lt: corte } },
                { assigneeUserId: null, OR: [{ assignee: null }, { assignee: '' }] },
              ],
            },
          ],
        },
        orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
        take: TETO_DE_TAREFAS,
        select: {
          id: true,
          title: true,
          dueDate: true,
          statusDesde: true,
          assignee: true,
          assigneeUserId: true,
          list: { select: { name: true } },
        },
      }),
      this.prisma.user.findMany({
        where: { orgId, isActive: true, roles: { none: { key: { in: ['ia_servico', 'ia_acao'] } } } },
        select: { id: true, name: true },
      }),
    ]);
    const pessoas = new Map(gente.map((g) => [g.id, g.name]));
    const cobrancas = cobrancasPorPessoa(
      linhas.map((t) => ({
        id: t.id,
        titulo: t.title,
        lista: t.list?.name ?? null,
        dueDate: t.dueDate,
        statusDesde: t.statusDesde,
        assignee: t.assignee,
        assigneeUserId: t.assigneeUserId,
      })),
      pessoas,
      agora,
      dias,
    );
    const dia = diaEmSaoPaulo(agora);
    let doModelo = 0;
    const abertas: string[] = [];
    for (const c of cobrancas) {
      const { frase, doModelo: veioDoModelo } = await this.frase(orgId, c, dias);
      if (veioDoModelo) doModelo += 1;
      const r = await this.pendencias.abrir(orgId, {
        funcao: 'TR-07',
        tipo: TIPO_DA_PENDENCIA_DE_COBRANCA,
        chave: chaveDaCobranca(c.userId, dia),
        titulo: tituloDaCobranca(c),
        contexto: contextoDaCobranca(c, frase, dias),
        opcoes: [...OPCOES_DA_COBRANCA],
        paraUsuarioId: c.userId,
        refTipo: 'cobranca',
        refId: dia,
        dados: {
          dia,
          dias,
          vencidas: c.vencidas.map((t) => t.id),
          paradas: c.paradas.map((t) => t.id),
          semDono: c.semDono.map((t) => t.id),
          frase: veioDoModelo ? 'modelo' : 'sistema',
        },
      });
      abertas.push(r.id);
    }
    const pessoasCobradas = cobrancas.filter((c) => c.userId !== null);
    return {
      pessoas: pessoasCobradas.length,
      vencidas: pessoasCobradas.reduce((n, c) => n + c.vencidas.length, 0),
      paradas: pessoasCobradas.reduce((n, c) => n + c.paradas.length, 0),
      semDono: cobrancas.find((c) => c.userId === null)?.semDono.length ?? 0,
      dias,
      doModelo,
      pendencias: abertas,
    };
  }

  /** A frase do modelo (TR-07, Haiku pelo cadastro), ou a do sistema quando não há modelo ou ela inventa número. */
  private async frase(orgId: string, c: CobrancaDaPessoa, dias: number): Promise<{ frase: string; doModelo: boolean }> {
    const padrao = fraseDoSistema(c, dias);
    if (!this.llm.configured) return { frase: padrao, doModelo: false };
    try {
      const { system, user } = promptDaCobranca(c, dias);
      const saida = await this.llm.step({ funcao: 'TR-07', system, turns: [{ role: 'user', text: user }], orgId, maxTokens: 300 });
      const doModelo = fraseDoModelo(saida.text, c, dias);
      return doModelo ? { frase: doModelo, doModelo: true } : { frase: padrao, doModelo: false };
    } catch (e) {
      this.log.warn(`empresa ${orgId}: a frase do cobrador caiu na do sistema (${(e as Error).message})`);
      return { frase: padrao, doModelo: false };
    }
  }
}
