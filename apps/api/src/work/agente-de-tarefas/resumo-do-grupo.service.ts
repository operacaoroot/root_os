import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { AgentEstado, EstadoDeAgente, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { ENVIO_PELA_EVOLUTION, type EnvioPelaEvolution } from '../../gateway/canais/evolution.port';
import { ExecutoresDeRotinaRegistry } from '../../routines/executores.registry';
import { LIVRE, type ContextoDaRotina, type ResultadoDaRotina } from '../../routines/rotina.tipos';
import { proximaOcorrencia } from '../../pauta/cron';
import { TarefasDoDiaService } from '../tarefas-do-dia.service';
import { SLUG_DO_AGENTE_DE_TAREFAS } from './agente-de-tarefas.service';
import {
  CRON_DO_RESUMO, FUSO_DO_RESUMO, SLUG_DA_ROTINA_DO_RESUMO, TIPO_DO_RESUMO_DO_GRUPO, montarResumo, turnoDe,
} from './resumo-do-grupo';

/**
 * A rotina do resumo (07h e 18h, São Paulo). Aparece em /rotinas, onde pausa.
 * Só manda quando o grupo está configurado (`AGENTE_TAREFAS_JID`) e o agente
 * está ativo na tela de Agentes: as duas chaves desligam.
 */
@Injectable()
export class ResumoDoGrupoService implements OnModuleInit {
  private readonly log = new Logger('ResumoDoGrupo');
  private readonly jid = (process.env.AGENTE_TAREFAS_JID ?? '').trim().toLowerCase();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tarefas: TarefasDoDiaService,
    @Optional() private readonly executores?: ExecutoresDeRotinaRegistry,
    @Optional() @Inject(ENVIO_PELA_EVOLUTION) private readonly envio?: EnvioPelaEvolution,
  ) {}

  onModuleInit(): void {
    this.executores?.registrar({ [TIPO_DO_RESUMO_DO_GRUPO]: (ctx) => this.passagem(ctx) }, 'ResumoDoGrupoService');
  }

  /**
   * Cria a rotina nesta empresa se ainda não existe. A que existe não é tocada
   * (pausada em /rotinas fica pausada; horário mudado fica mudado).
   */
  async garantirRotina(orgId: string): Promise<'criada' | 'ja-existia'> {
    const existe = await this.prisma.rotina.findUnique({ where: { orgId_slug: { orgId, slug: SLUG_DA_ROTINA_DO_RESUMO } }, select: { id: true } });
    if (existe) return 'ja-existia';
    await this.prisma.rotina.create({
      data: {
        orgId, slug: SLUG_DA_ROTINA_DO_RESUMO, nome: 'Resumo das tarefas no grupo (07h e 18h)',
        tipo: TIPO_DO_RESUMO_DO_GRUPO, config: {} as Prisma.InputJsonValue,
        cron: CRON_DO_RESUMO, tz: FUSO_DO_RESUMO, ativo: true, estado: AgentEstado.rodando,
        origem: 'manual', refExterna: null, agenteSlug: SLUG_DO_AGENTE_DE_TAREFAS,
        reservadoEm: LIVRE, reservadoAte: LIVRE,
        proximaExecucaoEm: proximaOcorrencia(CRON_DO_RESUMO, FUSO_DO_RESUMO, new Date()),
      },
    });
    return 'criada';
  }

  async passagem(ctx: Pick<ContextoDaRotina, 'orgId' | 'agora'>): Promise<ResultadoDaRotina> {
    if (!this.jid) return { status: 'pulada', resumo: 'AGENTE_TAREFAS_JID não configurado: nada foi enviado.' };
    if (!this.envio) return { status: 'pulada', resumo: 'Sem o envio pela Evolution neste processo.' };
    const agente = await this.prisma.agent.findFirst({ where: { orgId: ctx.orgId, slug: SLUG_DO_AGENTE_DE_TAREFAS }, select: { estado: true } });
    if (agente?.estado !== EstadoDeAgente.ativo) return { status: 'pulada', resumo: 'Agente de tarefas pausado em Agentes: nada foi enviado.' };
    const painel = await this.tarefas.painel(ctx.orgId);
    const turno = turnoDe(ctx.agora);
    const texto = montarResumo(turno, painel.hoje, painel.pessoas, painel.tarefas);
    try {
      await this.envio.enviarAoGrupo(ctx.orgId, this.jid, texto);
    } catch (e) {
      this.log.warn(`resumo não saiu (${ctx.orgId}): ${(e as Error).message}`);
      return { status: 'erro', resumo: `O WhatsApp recusou o envio: ${(e as Error).message}`.slice(0, 200) };
    }
    return { status: 'ok', resumo: `Resumo da ${turno === 'manha' ? 'manhã' : 'noite'} enviado ao grupo (${painel.pessoas.length} pessoas).` };
  }
}
