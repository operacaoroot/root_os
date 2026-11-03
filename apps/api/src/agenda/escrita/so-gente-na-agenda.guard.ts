import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

import { temPapelDeMaquina } from '../../approvals/alcada';
import type { JwtUser } from '../../auth/current-user.decorator';

/** O que a conta de máquina ouve quando tenta escrever na agenda pela tela. */
export const RECUSA_DE_MAQUINA_NA_AGENDA =
  'Escrever na agenda pela tela é de gente: conta de serviço (IA) não marca, não altera e não cancela por aqui. O agente pede pela porta, e fica na fila.';

/**
 * A ESCRITA DA AGENDA PELA TELA É DE GENTE (agenda v2, 29/10/2026, decisão 2).
 *
 * Recusa conta de máquina PELO TOKEN, antes de qualquer leitura. O controlador
 * confere de novo no banco antes de pôr `naTela: true`, e a porta confere uma
 * terceira vez antes de ler a `aprovacaoR2Ligada` da empresa: três trancas para
 * o único atalho da régua, porque um agente que o alcançasse marcaria no Google
 * sem ninguém ter visto.
 */
@Injectable()
export class SoGenteNaAgendaGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest().user as JwtUser | undefined;
    if (!user?.sub || temPapelDeMaquina(user.roles ?? [])) throw new ForbiddenException(RECUSA_DE_MAQUINA_NA_AGENDA);
    return true;
  }
}
