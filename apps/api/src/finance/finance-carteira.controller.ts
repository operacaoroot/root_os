import { Controller, ForbiddenException, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { EscopoClienteAdaptado } from '../clientes-escopo/cliente-escopo.decorator';
import { parseConsultaCarteira } from '../comercial/comercial-carteira.service';
import { FinanceCarteiraService } from './finance-carteira.service';

@UseGuards(JwtAuthGuard,PermissionsGuard)
@Controller('finance/carteira')
export class FinanceCarteiraController {
  constructor(private readonly svc:FinanceCarteiraService) {}
  private ator(u:JwtUser) { if(!u?.sub||!u.orgId) throw new ForbiddenException('Acesso insuficiente.');return u.sub; }
  @Get('recebiveis') @RequirePermissions('financeiro.ver') @EscopoClienteAdaptado()
  recebiveis(@CurrentUser() u:JwtUser,@Query() q:Record<string,unknown>) { return this.svc.recebiveis(u.orgId,this.ator(u),parseConsultaCarteira(q??{})); }
  @Get('recebiveis/:id') @RequirePermissions('financeiro.ver') @EscopoClienteAdaptado()
  recebivel(@CurrentUser() u:JwtUser,@Param('id') id:string,@Query() q:Record<string,unknown>) { return this.svc.recebivel(u.orgId,this.ator(u),id,parseConsultaCarteira(q??{}).clienteId); }
  @Get('acordos') @RequirePermissions('financeiro.ver') @EscopoClienteAdaptado()
  acordos(@CurrentUser() u:JwtUser,@Query() q:Record<string,unknown>) { return this.svc.acordos(u.orgId,this.ator(u),parseConsultaCarteira(q??{})); }
  @Get('acordos/:id') @RequirePermissions('financeiro.ver') @EscopoClienteAdaptado()
  acordo(@CurrentUser() u:JwtUser,@Param('id') id:string,@Query() q:Record<string,unknown>) { return this.svc.acordo(u.orgId,this.ator(u),id,parseConsultaCarteira(q??{}).clienteId); }
}
