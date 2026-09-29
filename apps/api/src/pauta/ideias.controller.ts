import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { PautaIdeiaSalvarSchema, PautaIdeiaStatusSchema, PautaIdeiasProporSchema } from '@mktos/shared';
import { IdeiasService } from './ideias.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

// MK3: o banco de ideias. Sub-rota de `/pauta`, governada pelo módulo pauta.
// `propor` vem ANTES de qualquer rota com parâmetro no mesmo método para não
// ser engolida por ela — a mesma armadilha que o `pendentes-midia` já pagou.
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pauta/ideias')
export class IdeiasController {
  constructor(private readonly ideias: IdeiasService) {}

  @Get()
  @RequirePermissions('pauta.ver')
  painel(@CurrentUser() user: JwtUser) {
    return this.ideias.painel(user.orgId);
  }

  // Gasta IA, como as outras gerações da pauta.
  @Post('propor')
  @RequirePermissions('pauta.editar', 'automacoes.executar')
  propor(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.ideias.propor(user.orgId, user.sub, PautaIdeiasProporSchema.parse(body ?? {}));
  }

  @Post()
  @RequirePermissions('pauta.editar')
  criar(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.ideias.criar(user.orgId, user.sub, PautaIdeiaSalvarSchema.parse(body ?? {}));
  }

  @Put(':id')
  @RequirePermissions('pauta.editar')
  salvar(@CurrentUser() user: JwtUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.ideias.salvar(user.orgId, user.sub, id, PautaIdeiaSalvarSchema.parse(body ?? {}));
  }

  // Aprovar cria a peça da semana, e por isso pede `pauta.editar` como o resto:
  // ela nasce aprovada e entra na agenda, mas publicar segue sendo outra porta.
  @Patch(':id/status')
  @RequirePermissions('pauta.editar')
  status(@CurrentUser() user: JwtUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const { status } = PautaIdeiaStatusSchema.parse(body ?? {});
    return this.ideias.mudarStatus(user.orgId, user.sub, id, status);
  }
}
