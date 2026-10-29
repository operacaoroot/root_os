import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { AcessoAtualGuard } from '../memory/acesso-atual.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { AcordoInputSchema, AcordoUpdateSchema, AnaliseService, LeituraInputSchema } from './analise.service';
import { ParcelasInputSchema, ParcelasService } from './parcelas.service';
import { pedirSyncDoAsaas } from './finance.service';

@UseGuards(JwtAuthGuard, PermissionsGuard, AcessoAtualGuard)
@Controller('finance/analise')
export class AnaliseController {
  constructor(private readonly svc: AnaliseService, private readonly parcelas: ParcelasService) {}

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

  // ---- parcelas do acordo e a rotina da semana (29/10/2026) ----

  @Get('acordos/:id/parcelas')
  @RequirePermissions('financeiro.ver')
  parcelasDoAcordo(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.parcelas.listar(user.orgId, id);
  }

  @Put('acordos/:id/parcelas')
  @RequirePermissions('financeiro.editar')
  async definirParcelas(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const r = await this.parcelas.definir(user.orgId, id, ParcelasInputSchema.parse(body), user.sub);
    // Uma cobrança que já está no Asaas veste a parcela nova na próxima passagem: pede uma agora.
    pedirSyncDoAsaas();
    return r;
  }

  @Get('rotina')
  @RequirePermissions('financeiro.ver')
  rotina(@CurrentUser() user: JwtUser) {
    return this.parcelas.rotina(user.orgId);
  }
}
