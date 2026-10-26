import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { PainelComercialService } from './painel-comercial.service';
import { PropostasDaSalaService } from './propostas-da-sala.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Leituras do Motor Comercial: o Painel geral, a Lista de leads e as propostas publicadas pela sala. Só a empresa da sessão. */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('comercial')
export class PainelComercialController {
  constructor(
    private readonly svc: PainelComercialService,
    private readonly propostas: PropostasDaSalaService,
  ) {}

  @Get('painel')
  @RequirePermissions('leads.ver')
  painel(@CurrentUser() user: JwtUser, @Query('tudo') tudo?: string) {
    // Layout 26/10: sem `tudo=1`, só os negócios pagantes; com ele, também parceria, permuta e repasse.
    return this.svc.painel(user.orgId, new Date(), tudo === '1');
  }

  @Get('lista-de-leads')
  @RequirePermissions('leads.ver')
  listaDeLeads(@CurrentUser() user: JwtUser) {
    return this.svc.listaDeLeads(user.orgId);
  }

  @Get('propostas')
  @RequirePermissions('leads.ver')
  listaDePropostas(@CurrentUser() user: JwtUser) {
    return this.propostas.lista(user.orgId);
  }

  @Get('propostas/:leadId')
  @RequirePermissions('leads.ver')
  detalheDaProposta(@CurrentUser() user: JwtUser, @Param('leadId') leadId: string) {
    if (!UUID.test(leadId)) throw new BadRequestException('Id de lead inválido.');
    return this.propostas.detalhe(user.orgId, leadId);
  }
}
