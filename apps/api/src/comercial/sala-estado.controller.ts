import { Controller, Get, Header, HttpCode, Param, Post, UseGuards } from '@nestjs/common';

import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { SalaEstadoService, SoGenteNaSalaGuard } from './sala-estado.service';

/*
 * A ABA SALA DO PAINEL DO LEAD: quando a sala entra (rodada de produção 1, P9).
 *
 * Um controlador próprio, no mesmo prefixo `comercial` (o gate de módulos é o
 * do comercial), para não mexer no construtor do `ComercialController`, que a
 * suíte monta à mão.
 *   · `GET  /comercial/lead/:id/sala/estado` (`leads.ver`): a linha do tempo,
 *     sem o link em claro;
 *   · `POST /comercial/lead/:id/sala/link` (`leads.editar`, só gente): o link,
 *     com auditoria `sala.link.copiado`. `no-store`: nenhum intermediário guarda
 *     a resposta.
 *   · L6 (leva 5): `POST /comercial/lead/:id/sala` cria a sala do lead que não
 *     tem (o mesmo `garantir` da reação; idempotente) e `POST
 *     /comercial/lead/:id/sala/renovar` gera um link novo para a sala vencida,
 *     revogada ou cuja cifra este ambiente não abre. Os dois só gente com
 *     `leads.editar`, auditados; o link em claro só na resposta de renovar.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('comercial')
export class SalaEstadoController {
  constructor(private readonly estados: SalaEstadoService) {}

  @Get('lead/:id/sala/estado')
  @RequirePermissions('leads.ver')
  estado(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.estados.estado(user.orgId, id);
  }

  @Post('lead/:id/sala/link')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteNaSalaGuard)
  copiarLink(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.estados.copiarLink(user.orgId, id, { id: user.sub, papeis: user.roles ?? [] });
  }

  /** L6: "criar a sala agora" para o lead sem sala. Devolve o estado novo (sem link em claro). */
  @Post('lead/:id/sala')
  @HttpCode(200)
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteNaSalaGuard)
  criar(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.estados.criar(user.orgId, id, { id: user.sub, papeis: user.roles ?? [] });
  }

  /** L6: "gerar link novo". O link sai só nesta resposta, como em copiar. */
  @Post('lead/:id/sala/renovar')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @RequirePermissions('leads.editar')
  @UseGuards(SoGenteNaSalaGuard)
  renovarLink(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.estados.renovarLink(user.orgId, id, { id: user.sub, papeis: user.roles ?? [] });
  }
}
