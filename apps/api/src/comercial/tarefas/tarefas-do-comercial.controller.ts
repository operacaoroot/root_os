import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { TarefaDoComercialCriarSchema, TarefaDoComercialEditarSchema } from '@mktos/shared';

import { CurrentUser, type JwtUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RequirePermissions } from '../../auth/permissions.decorator';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { AcessoAtualGuard } from '../../memory/acesso-atual.guard';
import { TarefasDoComercialService } from './tarefas-do-comercial.service';

/*
 * AS TAREFAS DO COMERCIAL (adendo de 21/10/2026, §A1). Um controlador próprio no
 * prefixo `comercial` (o gate de módulos é o de `leads`), para não mexer no
 * construtor do `ComercialController`, que a suíte monta à mão.
 *
 *   · `GET   /comercial/tarefas` (`leads.ver`): `?leadId=` (as do lead),
 *     `?semLead=1` (o bloco do Funil vivo), `?pessoa=<id|eu|sem>` (o filtro
 *     "Responsável" do funil). Abertas e as concluídas recentes;
 *   · `POST  /comercial/tarefas` (`leads.editar` + `tarefas.editar`): cria na
 *     lista do comercial, com ou sem lead;
 *   · `PATCH /comercial/tarefas/:id` (`leads.editar` + `tarefas.editar`): título,
 *     responsável, prazo, concluir/reabrir e ligar/desligar o lead, com a versão lida.
 *
 * Escrever relê as duas permissões no banco (`AcessoAtualGuard`): a que saiu
 * depois do login não vale até o token vencer.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('comercial/tarefas')
export class TarefasDoComercialController {
  constructor(private readonly svc: TarefasDoComercialService) {}

  @Get()
  @RequirePermissions('leads.ver')
  listar(
    @CurrentUser() u: JwtUser,
    @Query('leadId') leadId?: string,
    @Query('semLead') semLead?: string,
    @Query('pessoa') pessoa?: string,
  ) {
    return this.svc.listar(u.orgId, u.sub, {
      leadId: leadId?.trim() || null,
      semLead: semLead === '1' || semLead === 'true',
      pessoa: pessoa?.trim().slice(0, 120) || null,
    });
  }

  @Post()
  @UseGuards(AcessoAtualGuard)
  @RequirePermissions('leads.editar', 'tarefas.editar')
  criar(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.svc.criar(u.orgId, u.sub, TarefaDoComercialCriarSchema.parse(body));
  }

  @Patch(':id')
  @UseGuards(AcessoAtualGuard)
  @RequirePermissions('leads.editar', 'tarefas.editar')
  editar(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.editar(u.orgId, u.sub, id, TarefaDoComercialEditarSchema.parse(body));
  }
}
