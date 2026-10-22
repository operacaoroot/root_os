import { Injectable, OnModuleInit } from '@nestjs/common';
import { TRAB_TIPO_DA_ROTINA_DO_EXPURGO } from '@mktos/shared';

import { LixeiraService } from '../../work/lixeira/lixeira.service';
import { ExecutoresDeRotinaRegistry } from '../executores.registry';
import type { ContextoDaRotina, ResultadoDaRotina } from '../rotina.tipos';

/**
 * O EXPURGO DA LIXEIRA DO TRABALHO (rodada de produção 3, I2, 22/10/2026).
 *
 * Apaga de vez as tarefas que estão na Lixeira como excluídas há mais de 30 dias,
 * na empresa da rotina (`LixeiraService.expurgo`). Nunca o card da implantação,
 * nunca a só arquivada. A rotina NASCE DESLIGADA (`ativo: false`, `planejado`),
 * semeada na primeira leitura da Lixeira: quem liga é gente, em /rotinas. Sem
 * nada vencido a passagem é `pulada` e não vira linha de histórico.
 */
@Injectable()
export class ExecutorDoExpurgoDaLixeira implements OnModuleInit {
  constructor(
    private readonly lixeira: LixeiraService,
    private readonly registro: ExecutoresDeRotinaRegistry,
  ) {}

  onModuleInit(): void {
    this.registro.registrar({ [TRAB_TIPO_DA_ROTINA_DO_EXPURGO]: (ctx) => this.executar(ctx) }, 'ExecutorDoExpurgoDaLixeira');
  }

  executar(ctx: ContextoDaRotina): Promise<ResultadoDaRotina> {
    return this.lixeira.expurgo(ctx.orgId, ctx.agora);
  }
}
