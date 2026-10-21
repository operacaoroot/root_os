import { Controller, Get, UseGuards } from '@nestjs/common';
import type { PendenciasDaCaixa } from '@mktos/shared';

import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { TriagemDaCaixaService } from '../work/triagem-da-caixa/triagem-da-caixa.service';

/**
 * AS PENDÊNCIAS NA CAIXA, TRIADAS — `GET /api/caixa/pendencias` (rodada dos
 * agentes, 21/10/2026, TR-08).
 *
 * Só LEITURA: a mesma lista de `GET /pendencias` (abertas, as suas e as sem
 * destinatário), agrupada por cliente e urgência pela triagem. Responder e
 * descartar continuam nas rotas das pendências (`POST /pendencias/:id/...`),
 * que conferem que é gente. Mesma permissão da caixa (`dashboard.ver`) e o mesmo
 * prefixo de espinha. Controller separado: `CaixaController` segue sem verbo de
 * escrita, e este também não tem.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('caixa')
export class CaixaPendenciasController {
  constructor(private readonly triagem: TriagemDaCaixaService) {}

  @Get('pendencias')
  @RequirePermissions('dashboard.ver')
  pendencias(@CurrentUser() user: JwtUser): Promise<PendenciasDaCaixa> {
    return this.triagem.daCaixa(user.orgId, user.sub);
  }
}
