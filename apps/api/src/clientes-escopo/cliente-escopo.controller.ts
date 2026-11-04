import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { ClienteEscopoService } from './cliente-escopo.service';
import { EscopoClienteAdaptado } from './cliente-escopo.decorator';
@UseGuards(JwtAuthGuard)
@Controller('clientes-escopo')
export class ClienteEscopoController {
  constructor(private readonly svc:ClienteEscopoService) {}
  @Get('me') @EscopoClienteAdaptado()
  meu(@CurrentUser() u:JwtUser) {return this.svc.listar(u.orgId,u.sub);}
  @Get('pessoas')
  pessoas(@CurrentUser() u:JwtUser) {return this.svc.pessoas(u.orgId,u.sub);}
  @Put('pessoas/:id')
  configurar(@CurrentUser() u:JwtUser,@Param('id') id:string,@Body() body:unknown) {return this.svc.configurar(u.orgId,u.sub,id,body);}
}
