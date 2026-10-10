import { Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ObsidianService } from './obsidian.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AcessoAtualGuard } from '../memory/acesso-atual.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard, AcessoAtualGuard)
@Controller('knowledge')
export class ObsidianController {
  constructor(private readonly svc: ObsidianService) {}

  @Get()
  @RequirePermissions('obsidian.ver')
  list(@CurrentUser() user: JwtUser) {
    return this.svc.list(user.orgId, user.sub);
  }

  @Get('prontidao')
  @RequirePermissions('obsidian.ver')
  prontidao(@CurrentUser() user: JwtUser) {
    return this.svc.prontidao(user.orgId, user.sub);
  }

  @Get('search')
  @RequirePermissions('obsidian.ver')
  search(@CurrentUser() user: JwtUser, @Query('q') q?: string, @Query('limit') limit?: string) {
    return this.svc.search(user.orgId, q ?? '', limit ? Number(limit) : 8, user.sub);
  }

  @Get(':id')
  @RequirePermissions('obsidian.ver')
  async get(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    const note = await this.svc.get(user.orgId, id, user.sub);
    if (!note) throw new NotFoundException('Nota não encontrada');
    return note;
  }

  // Reindexa a vault sob demanda.
  @Post('reindex')
  @RequirePermissions('obsidian.editar')
  reindex(@CurrentUser() user: JwtUser) {
    return this.svc.reindex(user.orgId).then((n) => ({ ok: true, notes: n }));
  }
}
