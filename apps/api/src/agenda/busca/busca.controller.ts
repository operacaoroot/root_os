import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { ClienteDaBuscaDaAgenda } from '@mktos/shared';

import { CurrentUser, type JwtUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RequirePermissions } from '../../auth/permissions.decorator';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { BuscaDaAgendaService } from './busca.service';

/**
 * `GET /api/agenda/clientes?q=` — a busca do cliente no painel de marcar (agenda
 * v2, lane G3): até 8 leads e clientes, com a etapa, o contato e quantas vezes o
 * nome já esteve na agenda. Mínimo de 2 letras (400). Ver: `dashboard.ver`, a
 * mesma da tela. Só leitura, sempre na empresa de quem pede.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('agenda')
export class BuscaDaAgendaController {
  constructor(private readonly busca: BuscaDaAgendaService) {}

  @Get('clientes')
  @RequirePermissions('dashboard.ver')
  clientes(@CurrentUser() user: JwtUser, @Query('q') q?: string): Promise<ClienteDaBuscaDaAgenda[]> {
    return this.busca.buscar(user.orgId, typeof q === 'string' ? q : undefined);
  }
}
