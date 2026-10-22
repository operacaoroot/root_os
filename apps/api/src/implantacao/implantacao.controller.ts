import { BadRequestException, Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { TrabLimiteDaEtapaSchema } from '@mktos/shared';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { AcessoAtualGuard } from '../memory/acesso-atual.guard';
import { SoGenteNoTrabalhoGuard } from '../work/so-gente-no-trabalho.guard';
import { ImplantacaoDoQuadroService } from './implantacao-do-quadro.service';
import { LimiteDaEtapaService } from './limite-da-etapa.service';

const UUID = /^[0-9a-f-]{36}$/i;

/*
 * O CARTÃO DA IMPLANTAÇÃO (rodada de produção 2, M1). Mora no prefixo
 * `trabalho` (o módulo `trabalho` governa), num módulo próprio, como os anexos.
 * Só leitura, menos o limite da etapa, que é escrita de gente.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('trabalho')
export class ImplantacaoController {
  constructor(
    private readonly quadro: ImplantacaoDoQuadroService,
    private readonly limites: LimiteDaEtapaService,
  ) {}

  /** S1 e S2: por card da lista, a próxima reunião e a etapa contra a fase do trilho. */
  @Get('implantacao/cartoes')
  @RequirePermissions('tarefas.ver')
  cartoes(@CurrentUser() u: JwtUser, @Query('listId') listId: string) {
    if (!listId || !UUID.test(listId)) throw new BadRequestException('listId inválido');
    return this.quadro.daLista(u.orgId, listId, { sub: u.sub, permissions: u.permissions ?? [] });
  }

  /** S5: o cartão "Implantação" do Dia a dia, com os ids de cada pendência. */
  @Get('implantacao/resumo')
  @RequirePermissions('tarefas.ver')
  resumo(@CurrentUser() u: JwtUser) {
    return this.quadro.resumo(u.orgId, { sub: u.sub, permissions: u.permissions ?? [] });
  }

  /** S4: o limite de cartões da etapa pelo menu da coluna. Só gente, auditado, com a versão lida. */
  @Patch('statuses/:id/limite')
  @UseGuards(AcessoAtualGuard, SoGenteNoTrabalhoGuard)
  @RequirePermissions('tarefas.editar')
  definirLimite(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    if (!UUID.test(id)) throw new BadRequestException('id inválido');
    return this.limites.definir(u.orgId, u.sub, id, TrabLimiteDaEtapaSchema.parse(body ?? {}));
  }
}
