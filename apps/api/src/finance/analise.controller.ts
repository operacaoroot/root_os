import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { AcessoAtualGuard } from '../memory/acesso-atual.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { AcordoInputSchema, AcordoUpdateSchema, AnaliseService, LeituraInputSchema } from './analise.service';

@UseGuards(JwtAuthGuard, PermissionsGuard, AcessoAtualGuard)
@Controller('finance/analise')
export class AnaliseController {
  constructor(private readonly svc: AnaliseService) {}

  @Get()
  @RequirePermissions('financeiro.ver')
  resumo(@CurrentUser() user: JwtUser) {
    return this.svc.resumo(user.orgId);
  }

  @Post('leitura')
  @RequirePermissions('financeiro.ver')
  leitura(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const { refazer } = LeituraInputSchema.parse(body ?? {});
    return this.svc.leitura(user.orgId, !!refazer);
  }

  @Get('acordos')
  @RequirePermissions('financeiro.ver')
  acordos(@CurrentUser() user: JwtUser) {
    return this.svc.listAcordos(user.orgId);
  }

  @Post('acordos')
  @RequirePermissions('financeiro.editar')
  criar(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.svc.createAcordo(user.orgId, AcordoInputSchema.parse(body), user.sub);
  }

  @Patch('acordos/:id')
  @RequirePermissions('financeiro.editar')
  alterar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.updateAcordo(user.orgId, id, AcordoUpdateSchema.parse(body), user.sub);
  }

  @Delete('acordos/:id')
  @RequirePermissions('financeiro.editar')
  apagar(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.svc.deleteAcordo(user.orgId, id, user.sub);
  }
}
