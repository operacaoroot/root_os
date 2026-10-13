import { Injectable, OnModuleInit } from '@nestjs/common';

import { AUTOMACOES_DA_TAREFA, podeRodar } from './autonomia';
import { ConfigComercialService } from './config.service';
import { ReacoesRegistry, type GuardaDaAutonomia } from './fio.service';
import { RelogioComercialRegistry } from './relogio.registry';

/*
 * A GUARDA DA AUTONOMIA (lane E, fase 2, 13/10/2026).
 *
 * Instala nos dois registros (reações aos fatos e tarefas do relógio) a mesma
 * pergunta: "a automação desta inscrição está em A0?". Em A0 ela não roda e o
 * pulo fica registrado por quem despacha (`FioService.reagir`, o resumo da
 * passagem do relógio). A1 a A3 rodam como hoje: a porta continua decidindo o
 * toque de cada efeito, e nenhum nível o tira (`autonomia.ts`).
 *
 * Só lê a config quando a inscrição É de uma automação da torre: o resto do
 * fio não paga a consulta.
 */
@Injectable()
export class AutonomiaService implements OnModuleInit {
  constructor(
    private readonly config: ConfigComercialService,
    private readonly reacoes: ReacoesRegistry,
    private readonly relogio: RelogioComercialRegistry,
  ) {}

  onModuleInit(): void {
    this.instalar();
  }

  /** Separado para a suíte montar à mão. */
  instalar(): void {
    const guarda: GuardaDaAutonomia = async (orgId, nome) => {
      if (!AUTOMACOES_DA_TAREFA[nome]) return { roda: true };
      const cfg = await this.config.ler(orgId);
      return podeRodar(cfg.autonomia, nome);
    };
    this.reacoes.definirGuarda(guarda);
    this.relogio.definirGuarda(guarda);
  }
}
