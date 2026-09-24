import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ActorType } from '@prisma/client';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { FerramentasService } from './ferramentas.service';

const RegistroSchema = z.object({ titulo: z.string(), texto: z.string() }).strict();

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('ferramentas')
export class FerramentasController {
  constructor(private readonly ferramentas: FerramentasService) {}

  @Get(':slug/registros')
  @RequirePermissions('mcp.ver')
  async listar(@Param('slug') slug: string, @CurrentUser() user: JwtUser) {
    const registros = await this.ferramentas.listarParaOperador(slug, {
      orgId: user.orgId,
      actorId: user.sub,
      actorType: ActorType.user,
    });
    if (!Array.isArray(registros)) return registros;
    return { slug, registros };
  }

  @Post(':slug/registros')
  @RequirePermissions('mcp.executar')
  async criar(@Param('slug') slug: string, @CurrentUser() user: JwtUser, @Body() body: unknown) {
    const input = RegistroSchema.parse(body);
    return this.ferramentas.criarParaOperador(slug, {
      orgId: user.orgId,
      actorId: user.sub,
      actorType: ActorType.user,
    }, input.titulo, input.texto);
  }
}
