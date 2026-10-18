import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { TrabAtaAceitarSchema, TrabAtaColarSchema } from '@mktos/shared';

import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../../auth/current-user.decorator';
import { AtasService } from './atas.service';

/*
 * O BANCO DE ATAS DO TRABALHO (rodada do painel P3, 18/10/2026).
 *
 * O prefixo é `trabalho/atas`: o primeiro segmento é `trabalho`, e é ele que o
 * gate de módulos confere (`tenants/modulos.ts`). Nenhum prefixo novo.
 *
 * Permissões, as mesmas do Trabalho e nenhuma nova: ler é `tarefas.ver`;
 * colar uma ata, pedir a leitura, aceitar e descartar é `tarefas.editar` — é
 * mexer no quadro da empresa, e aceitar é exatamente criar uma tarefa pelo
 * `WorkService`, o caminho do botão "Nova tarefa". Nada passa pela porta: é
 * escrita interna, sem efeito externo, como o resto do Trabalho.
 *
 * A ORDEM DOS MÉTODOS IMPORTA: `sugestoes` vem antes de `:ref`, senão o
 * `GET :ref` engoliria `GET sugestoes`.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('trabalho/atas')
export class AtasController {
  constructor(private readonly atas: AtasService) {}

  @Get()
  @RequirePermissions('tarefas.ver')
  listar(@CurrentUser() u: JwtUser) {
    return this.atas.listar(u.orgId);
  }

  @Post()
  @RequirePermissions('tarefas.editar')
  colar(@CurrentUser() u: JwtUser, @Body() body: unknown) {
    return this.atas.colar(u.orgId, u.sub, TrabAtaColarSchema.parse(body));
  }

  @Get('sugestoes')
  @RequirePermissions('tarefas.ver')
  sugestoes(@CurrentUser() u: JwtUser, @Query('ata') ata?: string, @Query('estado') estado?: string) {
    return this.atas.sugestoes(u.orgId, { ata, estado });
  }

  @Post('sugestoes/:id/aceitar')
  @RequirePermissions('tarefas.editar')
  aceitar(@CurrentUser() u: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.atas.aceitar(u.orgId, u.sub, id, TrabAtaAceitarSchema.parse(body ?? {}));
  }

  @Post('sugestoes/:id/descartar')
  @RequirePermissions('tarefas.editar')
  descartar(@CurrentUser() u: JwtUser, @Param('id') id: string) {
    return this.atas.descartar(u.orgId, u.sub, id);
  }

  @Get(':ref')
  @RequirePermissions('tarefas.ver')
  ler(@CurrentUser() u: JwtUser, @Param('ref') ref: string) {
    return this.atas.ler(u.orgId, ref);
  }

  @Post(':ref/sugestoes')
  @RequirePermissions('tarefas.editar')
  gerar(@CurrentUser() u: JwtUser, @Param('ref') ref: string) {
    return this.atas.gerar(u.orgId, u.sub, ref);
  }
}
