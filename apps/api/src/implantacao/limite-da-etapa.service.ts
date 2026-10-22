import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { LIMITE_MUDOU_NO_MEIO, LIMITE_SO_DE_GENTE, type TrabLimiteDaEtapaInput, type TrabLimiteDaEtapaResultado } from '@mktos/shared';

import { temPapelDeMaquina } from '../approvals/alcada';
import { AuditService } from '../audit/audit.service';
import { lerAprovador } from '../auth/aprovador';
import { PrismaService } from '../prisma/prisma.service';

/*
 * O LIMITE DE CARTÕES DA ETAPA PELO MENU DA COLUNA (rodada de produção 2, M1, S4).
 *
 * `PATCH /trabalho/statuses/:id/limite`, `{limite, esperado}`. O limite já
 * existia (`WorkStatus.limite`, AVISA, NÃO TRAVA) e o editor de etapas já o
 * grava por `PATCH /trabalho/statuses/:id`, que segue igual. Esta é a porta do
 * menu da coluna, e ela é mais estrita:
 *
 *   · SÓ GENTE: o guarda recusa conta de máquina pelo token
 *     (`SoGenteNoTrabalhoGuard`) e aqui o usuário é relido no banco (ativo, sem
 *     papel de máquina), porque `ia_acao` tem `tarefas.editar`;
 *   · ESCRITA CONDICIONADA: grava só se o limite ainda é o que a tela leu
 *     (`esperado`); outra pessoa mudou no meio = 409, nada gravado;
 *   · AUDITADA com o antes e o depois, na mesma transação.
 *
 * Nenhum número é semeado: quem define é a mesa.
 */

export const ACAO_DO_LIMITE = 'work.status.limite';

@Injectable()
export class LimiteDaEtapaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async definir(orgId: string, actorId: string, statusId: string, input: TrabLimiteDaEtapaInput): Promise<TrabLimiteDaEtapaResultado> {
    const quem = await lerAprovador(this.prisma, actorId, orgId);
    if (!quem || !quem.ativo) throw new ForbiddenException('Quem define o limite precisa ser um usuário ativo desta empresa.');
    if (temPapelDeMaquina(quem.papeis)) throw new ForbiddenException(LIMITE_SO_DE_GENTE);

    const st = await this.prisma.workStatus.findFirst({
      where: { id: statusId, orgId, list: { orgId } },
      select: { id: true, name: true, listId: true, limite: true },
    });
    if (!st) throw new NotFoundException('Etapa não encontrada');
    if (st.limite === input.limite) return { statusId: st.id, limite: st.limite };

    return this.prisma.$transaction(async (tx) => {
      const r = await tx.workStatus.updateMany({ where: { id: st.id, orgId, limite: input.esperado }, data: { limite: input.limite } });
      if (r.count !== 1) throw new ConflictException(LIMITE_MUDOU_NO_MEIO);
      await this.audit.log({
        orgId,
        actorType: ActorType.user,
        actorId,
        action: ACAO_DO_LIMITE,
        entityType: 'work_status',
        entityId: st.id,
        before: { etapa: st.name, listId: st.listId, limite: input.esperado },
        after: { etapa: st.name, listId: st.listId, limite: input.limite },
      }, tx);
      return { statusId: st.id, limite: input.limite };
    });
  }
}
