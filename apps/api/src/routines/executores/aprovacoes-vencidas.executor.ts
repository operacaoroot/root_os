import { Injectable, OnModuleInit } from '@nestjs/common';

import { LimpezaDasVencidasService, TIPO_DA_LIMPEZA_DAS_VENCIDAS } from '../../approvals/limpeza-das-vencidas';
import { ExecutoresDeRotinaRegistry } from '../executores.registry';
import type { ContextoDaRotina, ResultadoDaRotina } from '../rotina.tipos';

/**
 * A LIMPEZA DIÁRIA DAS APROVAÇÕES VENCIDAS (rodada do trabalho T7).
 *
 * Marca `expirada` a `pendente` cujo prazo já passou, na empresa da rotina, e
 * registra no RASTRO como sistema (`LimpezaDasVencidasService.passagem`). Sem
 * nada vencido a passagem é `pulada`: não vira linha de histórico.
 */
@Injectable()
export class ExecutorDaLimpezaDasVencidas implements OnModuleInit {
  constructor(
    private readonly limpeza: LimpezaDasVencidasService,
    private readonly registro: ExecutoresDeRotinaRegistry,
  ) {}

  onModuleInit(): void {
    this.registro.registrar({ [TIPO_DA_LIMPEZA_DAS_VENCIDAS]: (ctx) => this.executar(ctx) }, 'ExecutorDaLimpezaDasVencidas');
  }

  async executar(ctx: ContextoDaRotina): Promise<ResultadoDaRotina> {
    const r = await this.limpeza.passagem(ctx.orgId, ctx.agora);
    return { status: r.quantas ? 'ok' : 'pulada', resumo: r.resumo };
  }
}
