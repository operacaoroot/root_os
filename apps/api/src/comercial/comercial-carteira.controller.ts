import { Controller, ForbiddenException, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { EscopoClienteAdaptado } from '../clientes-escopo/cliente-escopo.decorator';
import { ComercialCarteiraService, parseConsultaCarteira } from './comercial-carteira.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('comercial/carteira')
export class ComercialCarteiraController {
  constructor(private readonly svc:ComercialCarteiraService) {}
  private ator(u:JwtUser) { if (!u?.sub || !u.orgId) throw new ForbiddenException('Acesso insuficiente.'); return u.sub; }

  @Get('leads') @RequirePermissions('leads.ver') @EscopoClienteAdaptado()
  leads(@CurrentUser() u:JwtUser, @Query() q:Record<string,unknown>) {
    return this.svc.leads(u.orgId,this.ator(u),parseConsultaCarteira(q ?? {}));
  }
  @Get('leads/:id') @RequirePermissions('leads.ver') @EscopoClienteAdaptado()
  lead(@CurrentUser() u:JwtUser, @Param('id') id:string, @Query() q:Record<string,unknown>) {
    return this.svc.lead(u.orgId,this.ator(u),id,parseConsultaCarteira(q ?? {}).clienteId);
  }
  @Get('contratos') @RequirePermissions('leads.ver') @EscopoClienteAdaptado()
  contratos(@CurrentUser() u:JwtUser, @Query() q:Record<string,unknown>) {
    return this.svc.contratos(u.orgId,this.ator(u),parseConsultaCarteira(q ?? {}));
  }
  @Get('contratos/:id') @RequirePermissions('leads.ver') @EscopoClienteAdaptado()
  contrato(@CurrentUser() u:JwtUser, @Param('id') id:string, @Query() q:Record<string,unknown>) {
    return this.svc.contrato(u.orgId,this.ator(u),id,parseConsultaCarteira(q ?? {}).clienteId);
  }
}
