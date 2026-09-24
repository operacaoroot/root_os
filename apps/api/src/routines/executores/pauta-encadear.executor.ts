import { Injectable, OnModuleInit } from '@nestjs/common';
import { PAUTA_ETAPA_DO_ENCADEAMENTO_ROTULO } from '@mktos/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { EncadeamentoService, type PassoDaPassagem } from '../../pauta/encadeamento.service';
import { etapasDaConfig } from '../../pauta/encadeamento-do-episodio';
import { ExecutoresDeRotinaRegistry } from '../executores.registry';
import type { ContextoDaRotina, ResultadoDaRotina } from '../rotina.tipos';
import { TIPO_PAUTA_ENCADEAR } from '../rotina.tipos';

/**
 * O ENCADEAMENTO DA PAUTA (MD1): a cada passagem, um passo por episódio — no
 * máximo dois episódios — da transcrição até a semana em rascunho com os slots
 * propostos. Nunca publica: o que sai do OS continua nos pontos humanos.
 *
 * O interruptor é a própria rotina (criada em /rotinas, "Nova rotina de
 * encadeamento"). O contexto da empresa já está aberto (o agendador abre), e é
 * ele que põe cada chamada de IA no teto de custo da empresa (RF-G-05).
 *
 * O desfecho: `pulada` quando não havia passo a dar (ou só o clique manual em
 * curso); ERRO LANÇADO quando algum passo falhou — assim ele conta como falha
 * no histórico da rotina, com a etapa escrita; `ok` no resto.
 */
@Injectable()
export class ExecutorDeEncadeamentoDaPauta implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encadeamento: EncadeamentoService,
    private readonly registro: ExecutoresDeRotinaRegistry,
  ) {}

  onModuleInit(): void {
    this.registro.registrar({ [TIPO_PAUTA_ENCADEAR]: (ctx) => this.executar(ctx) }, 'ExecutorDeEncadeamentoDaPauta');
  }

  async executar(ctx: ContextoDaRotina): Promise<ResultadoDaRotina> {
    // Segunda tranca do módulo, como a da coleta: a empresa que desliga a
    // pauta não continua gastando IA pela rotina que ficou.
    const org = await this.prisma.org.findUnique({ where: { id: ctx.orgId }, select: { modulos: true } });
    if (!org?.modulos.includes('pauta')) {
      return { status: 'pulada', resumo: 'módulo pauta desligado nesta empresa — nada a encadear' };
    }

    const passos = await this.encadeamento.passar({
      orgId: ctx.orgId,
      rotinaId: ctx.rotinaId,
      correlationId: ctx.correlationId,
      origem: ctx.origem,
      etapas: etapasDaConfig(ctx.config),
    });
    return desfechoDaPassagem(passos);
  }
}

/** A linha do histórico: só apelido, etapa e desfecho — nunca texto gerado. */
export function linhaDoPasso(p: PassoDaPassagem): string {
  return `${p.apelido} · ${PAUTA_ETAPA_DO_ENCADEAMENTO_ROTULO[p.etapa]}: ${p.resultado}${p.detalhe ? ` (${p.detalhe})` : ''}`;
}

export function desfechoDaPassagem(passos: readonly PassoDaPassagem[]): ResultadoDaRotina {
  if (!passos.length) return { status: 'pulada', resumo: 'nenhum episódio com passo a dar' };
  const resumo = passos.map(linhaDoPasso).join(' · ').slice(0, 500);
  if (passos.some((p) => p.resultado === 'erro')) throw new Error(resumo);
  if (passos.every((p) => p.resultado === 'pulada' || p.resultado === 'travada')) return { status: 'pulada', resumo };
  return { status: 'ok', resumo };
}
