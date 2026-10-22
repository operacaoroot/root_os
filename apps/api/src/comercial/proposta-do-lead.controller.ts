import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import type { ResultadoDoVinculo, VinculosDasPropostas } from '@mktos/shared';

import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { SoGenteGuard } from './mover.service';
import { PropostaDoLeadService } from './proposta-do-lead.service';

/*
 * A PROPOSTA É DO LEAD (rodada de produção 3, I5, 22/10/2026): o vínculo da
 * proposta do serviço de propostas com um lead da empresa. Ler pede `leads.ver`;
 * vincular e criar o lead pedem `leads.editar` e são de gente (`SoGenteGuard`
 * pelo token e a releitura no banco no serviço), auditados.
 *
 * O caminho é `vinculos-de-propostas` e não `propostas/vinculos` porque
 * `GET /comercial/propostas/:leadId` (o detalhe da proposta da sala) já ocupa
 * o segundo segmento.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('comercial/vinculos-de-propostas')
export class PropostaDoLeadController {
  constructor(private readonly svc: PropostaDoLeadService) {}

  @Get()
  @RequirePermissions('leads.ver')
  listar(@CurrentUser() user: JwtUser): Promise<VinculosDasPropostas> {
    return this.svc.listar(user.orgId);
  }

  @Post()
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteGuard)
  vincular(@CurrentUser() user: JwtUser, @Body() body: unknown): Promise<ResultadoDoVinculo> {
    return this.svc.vincular(user.orgId, body, quem(user));
  }

  @Post('lead')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteGuard)
  criarLead(@CurrentUser() user: JwtUser, @Body() body: unknown): Promise<ResultadoDoVinculo> {
    return this.svc.criarLead(user.orgId, body, quem(user));
  }
}

function quem(user: JwtUser) {
  return { id: user.sub, nome: user.name ?? null, papeis: user.roles ?? [], permissoes: user.permissions ?? [] };
}
