import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { ExecutoresDeRotinaRegistry } from '../../routines/executores.registry';
import type { ContextoDaRotina, ResultadoDaRotina } from '../../routines/rotina.tipos';
import { N_DIAS_SEM_USO_PADRAO } from './relogio';
import { TIPO_DA_ROTINA_DO_RELOGIO, TrilhoService } from './trilho.service';

/* ==========================================================================
 * O EXECUTOR DO RELÓGIO — a rotina diária do onboarding
 * ==========================================================================
 *
 * Uma rotina como as outras (`/rotinas`, com estado declarado e histórico),
 * semeada por empresa em `TrilhoService.garantir`. Ela NÃO manda mensagem:
 * decide o que está vencido (`relogio.ts`), grava um marco por pendência na
 * linha do tempo do trilho — com a mensagem pronta para copiar — e carimba o
 * convite lembrado. Mandar pelo OS é decisão da mesa (`docs/ONBOARDING.md`).
 *
 * `pulada` quando não há nada vencido: diário de bordo é registro do que
 * aconteceu, e "nada" todo dia afogaria o que aconteceu de verdade.
 */
@Injectable()
export class ExecutorDoRelogioDoOnboarding implements OnModuleInit {
  private readonly log = new Logger('RotinaDoOnboarding');

  constructor(
    private readonly trilhos: TrilhoService,
    private readonly registro: ExecutoresDeRotinaRegistry,
  ) {}

  onModuleInit(): void {
    this.registro.registrar(
      { [TIPO_DA_ROTINA_DO_RELOGIO]: (ctx) => this.executar(ctx) },
      'ExecutorDoRelogioDoOnboarding',
    );
  }

  private async executar(ctx: ContextoDaRotina): Promise<ResultadoDaRotina> {
    const cfg = ctx.config as { nDiasSemUso?: unknown };
    const n = Number(cfg.nDiasSemUso);
    const nDiasSemUso = Number.isFinite(n) && n > 0 ? Math.floor(n) : N_DIAS_SEM_USO_PADRAO;

    const pendencias = await this.trilhos.pendencias(ctx.orgId, nDiasSemUso, ctx.agora);
    if (!pendencias.length) return { status: 'pulada', resumo: 'nada vencido nos trilhos abertos.' };

    let registradas = 0;
    const porTipo = new Map<string, number>();
    for (const p of pendencias) {
      try {
        await this.trilhos.registrarPendencia(ctx.orgId, p);
        registradas += 1;
        porTipo.set(p.tipo, (porTipo.get(p.tipo) ?? 0) + 1);
      } catch (e) {
        this.log.warn(`  pendência "${p.tipo}" do trilho ${p.trilhoId} não registrada: ${(e as Error).message}`);
      }
    }
    const resumo = [...porTipo].map(([tipo, n]) => `${tipo}×${n}`).join(', ');
    return { status: 'ok', resumo: `${registradas} pendência(s) registrada(s): ${resumo}.` };
  }
}
