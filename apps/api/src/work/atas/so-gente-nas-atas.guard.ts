import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

import { temPapelDeMaquina } from '../../approvals/alcada';
import type { JwtUser } from '../../auth/current-user.decorator';
import { RECUSA_DE_MAQUINA_NAS_ATAS } from './atas.service';

/**
 * A ESCRITA DO BANCO DE ATAS É DE GENTE (revisão PA-3, 18/10/2026).
 *
 * O mesmo desenho do `SoGenteGuard` do mover do comercial, aqui no módulo do
 * Trabalho para não acoplar um ao outro: conta de máquina (`ia_servico`,
 * `ia_acao`) é recusada PELO TOKEN, antes de o serviço gastar IA ou tocar no
 * banco. O serviço confere de novo pelo banco (`AtasService.exigirGente`).
 *
 * "Nunca cria task sozinho" é isto no servidor: a sugestão só vira tarefa pelo
 * clique de uma pessoa, e a conta de serviço não cola ata, não pede a leitura
 * nem aceita ou descarta. A conta de ação continua criando tarefa pelo caminho
 * de sempre (`POST /trabalho/tarefas`), em que o RASTRO diz que foi ela; o que
 * ela não pode é fingir a decisão humana do aceite.
 */
@Injectable()
export class SoGenteNasAtasGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest().user as JwtUser | undefined;
    if (!user?.sub || temPapelDeMaquina(user.roles ?? [])) throw new ForbiddenException(RECUSA_DE_MAQUINA_NAS_ATAS);
    return true;
  }
}
