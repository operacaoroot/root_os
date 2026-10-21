import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

import { temPapelDeMaquina } from '../approvals/alcada';
import type { JwtUser } from '../auth/current-user.decorator';

/** O que a conta de máquina ouve quando tenta excluir ou arquivar em lote no Trabalho. */
export const RECUSA_DE_MAQUINA_NO_TRABALHO = 'Excluir e arquivar em lote no Trabalho é de gente: conta de máquina não faz.';

/**
 * EXCLUIR LISTA, EXCLUIR PASTA E ARQUIVAR TODAS AS TAREFAS SÃO DE GENTE
 * (rodada de produção 1, revisão adversarial, 21/10/2026).
 *
 * `ia_acao` tem `tarefas.editar`, e as três rotas juntas sumiriam com uma lista
 * inteira do Trabalho. O desenho é o das atas (`SoGenteNasAtasGuard`): recusa
 * PELO TOKEN aqui, e o serviço confere de novo pelo banco
 * (`WorkService.exigirGenteNoTrabalho`).
 */
@Injectable()
export class SoGenteNoTrabalhoGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest().user as JwtUser | undefined;
    if (!user?.sub || temPapelDeMaquina(user.roles ?? [])) throw new ForbiddenException(RECUSA_DE_MAQUINA_NO_TRABALHO);
    return true;
  }
}
