import { Controller, Get, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { CadastroService } from './cadastro.service';

/*
 * `GET /agents/cadastro` — o catálogo de agentes, rotinas e automações com o
 * estado do banco (rodada dos agentes, 21/10/2026, A7). Só leitura.
 *
 * `mcp.ver`, a MESMA permissão de `GET /agents` (o roster): quem já vê a tela de
 * Agentes vê o catálogo dela.
 *
 * ESTE CONTROLLER VEM ANTES DO `AgentsController` no módulo: senão o
 * `GET agents/:slug` de lá engole `cadastro` como se fosse um slug (o teste do
 * catálogo confere a ordem).
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class CadastroController {
  constructor(private readonly cadastro: CadastroService) {}

  @Get('agents/cadastro')
  @RequirePermissions('mcp.ver')
  catalogo(@CurrentUser() user: JwtUser) {
    return this.cadastro.catalogo(user.orgId);
  }
}
