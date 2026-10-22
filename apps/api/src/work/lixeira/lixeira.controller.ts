import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  TrabLixeiraApagarDeVezSchema, TrabLixeiraQuerySchema, TrabLixeiraRestaurarSchema, TrabTarefaExcluirSchema,
  TrabTarefaMesclarSchema, TrabTarefaMoverSchema,
} from '@mktos/shared';

import { CurrentUser, JwtUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RequirePermissions } from '../../auth/permissions.decorator';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { AcessoAtualGuard } from '../../memory/acesso-atual.guard';
import { AcoesDaTarefaService } from '../menu-da-tarefa/acoes-da-tarefa.service';
import { SoGenteNoTrabalhoGuard } from '../so-gente-no-trabalho.guard';
import { LixeiraService } from './lixeira.service';

/*
 * A LIXEIRA E O MENU DA TAREFA (rodada de produção 3, I2 e I4, 22/10/2026).
 *
 * Tudo aqui é de gente: `SoGenteNoTrabalhoGuard` recusa conta de máquina pelo
 * token e os serviços releem a pessoa no banco. A permissão é a de apagar no
 * Trabalho (`tarefas.editar`); apagar de vez pede também `admin.usuarios`.
 * Nenhuma permissão nova, nenhuma capacidade: é escrita interna, auditada.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard, AcessoAtualGuard, SoGenteNoTrabalhoGuard)
@Controller('trabalho')
export class LixeiraController {
  constructor(
    private readonly lixeira: LixeiraService,
    private readonly acoes: AcoesDaTarefaService,
  ) {}

  @Get('lixeira')
  @RequirePermissions('tarefas.editar')
  listar(@CurrentUser() u: JwtUser, @Query() query: Record<string, unknown>) {
    const f = TrabLixeiraQuerySchema.parse(Object.fromEntries(Object.entries(query ?? {}).filter(([, v]) => v !== '')));
    return this.lixeira.listar(u.orgId, u.sub, f);
  }

  @Post('lixeira/restaurar')
  @RequirePermissions('tarefas.editar')
  restaurar(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.lixeira.restaurar(u.orgId, u.sub, TrabLixeiraRestaurarSchema.parse(body).ids);
  }

  @Post('lixeira/apagar-de-vez')
  @RequirePermissions('tarefas.editar', 'admin.usuarios')
  apagarDeVez(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    const input = TrabLixeiraApagarDeVezSchema.parse(body);
    return this.lixeira.apagarDeVez(u.orgId, u.sub, input.ids, input.frase);
  }

  /** Excluir = mandar para a Lixeira (o DELETE de sempre continua sendo arquivar). */
  @Post('tarefas/:id/excluir')
  @RequirePermissions('tarefas.editar')
  excluir(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.lixeira.excluir(u.orgId, u.sub, id, TrabTarefaExcluirSchema.parse(body ?? {}));
  }

  @Post('tarefas/:id/mover')
  @RequirePermissions('tarefas.editar')
  mover(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.acoes.mover(u.orgId, u.sub, id, TrabTarefaMoverSchema.parse(body));
  }

  @Post('tarefas/:id/duplicar')
  @RequirePermissions('tarefas.editar')
  duplicar(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.acoes.duplicar(u.orgId, u.sub, id);
  }

  @Post('tarefas/:id/mesclar')
  @RequirePermissions('tarefas.editar')
  mesclar(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.acoes.mesclar(u.orgId, u.sub, id, TrabTarefaMesclarSchema.parse(body));
  }
}
