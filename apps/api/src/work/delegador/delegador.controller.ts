import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { AceitarDelegacaoSchema, type DelegacaoDaTarefa, type DelegacaoSugestaoDto } from '@mktos/shared';

import { temPapelDeMaquina } from '../../approvals/alcada';
import { CurrentUser, JwtUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/permissions.decorator';
import { DelegadorService, RECUSA_DE_MAQUINA_NO_DELEGADOR, type QuemDelega } from './delegador.service';

function quemDe(user: JwtUser): QuemDelega {
  // Conta de máquina recusada PELO TOKEN, antes de gastar IA; o serviço confere de novo pelo banco.
  if (!user?.sub || temPapelDeMaquina(user.roles ?? [])) throw new ForbiddenException(RECUSA_DE_MAQUINA_NO_DELEGADOR);
  return { id: user.sub, papeis: user.roles ?? [] };
}

/**
 * TR-09 · O DELEGADOR (rodada dos agentes, 21/10/2026).
 *
 *   GET  /trabalho/tarefas/:id/delegacao          (`tarefas.ver`)    as sugestões da tarefa
 *   POST /trabalho/tarefas/:id/delegacao/propor   (`tarefas.editar`) o Delegador propõe (gasta modelo; gente)
 *   POST /trabalho/delegacoes/:id/aceitar         (`tarefas.editar`) cria a subtarefa (gente)
 *   POST /trabalho/delegacoes/:id/descartar       (`tarefas.editar`) fica registrado (gente)
 *
 * Prefixo `trabalho`, do módulo `trabalho` (o gate de módulos já o conhece).
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('trabalho')
export class DelegadorController {
  constructor(private readonly delegador: DelegadorService) {}

  @Get('tarefas/:id/delegacao')
  @RequirePermissions('tarefas.ver')
  daTarefa(@CurrentUser() user: JwtUser, @Param('id') id: string): Promise<DelegacaoDaTarefa> {
    return this.delegador.daTarefa(user.orgId, id);
  }

  @Post('tarefas/:id/delegacao/propor')
  @HttpCode(200)
  @RequirePermissions('tarefas.editar')
  propor(@CurrentUser() user: JwtUser, @Param('id') id: string): Promise<DelegacaoDaTarefa> {
    return this.delegador.propor(user.orgId, quemDe(user), id);
  }

  @Post('delegacoes/:id/aceitar')
  @HttpCode(200)
  @RequirePermissions('tarefas.editar')
  aceitar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown): Promise<DelegacaoSugestaoDto> {
    return this.delegador.aceitar(user.orgId, quemDe(user), id, AceitarDelegacaoSchema.parse(body ?? {}));
  }

  @Post('delegacoes/:id/descartar')
  @HttpCode(200)
  @RequirePermissions('tarefas.editar')
  descartar(@CurrentUser() user: JwtUser, @Param('id') id: string): Promise<DelegacaoSugestaoDto> {
    return this.delegador.descartar(user.orgId, quemDe(user), id);
  }
}
