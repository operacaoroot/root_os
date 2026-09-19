import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { ConectorService } from './conector.service';

const FonteSchema = z.object({
  nome: z.string().trim().min(1).max(120),
  tipo: z.enum(['pasta', 'arquivo']),
  raizLogica: z.string().trim().min(1).max(500),
  incluir: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  excluir: z.array(z.string().trim().min(1).max(500)).max(100).default([]),
  tiposPermitidos: z.array(z.string().trim().min(2).max(13)).max(50).default([]),
  modo: z.enum(['importacao', 'sincronizacao']),
  regraExclusao: z.enum(['ignorar', 'arquivar']),
  tamanhoMaximo: z.number().finite().int().positive().max(10 * 1024 * 1024 * 1024),
}).strict();

const CodigoSchema = z.object({
  nomeDispositivo: z.string().trim().min(1).max(80),
  fonteIds: z.array(z.string().uuid()).min(1).max(50),
}).strict();

@Controller('conector')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('admin.permissoes', 'obsidian.editar')
export class ConectorController {
  constructor(private readonly conector: ConectorService) {}

  @Post('fontes')
  criarFonte(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const data = FonteSchema.parse(body);
    return this.conector.criarFonte(user.orgId, user.sub, data);
  }

  @Get('fontes')
  listarFontes(@CurrentUser() user: JwtUser) {
    return this.conector.listarFontes(user.orgId, user.sub);
  }

  @Post('fontes/:id/revogar')
  revogarFonte(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.conector.revogarFonte(user.orgId, user.sub, id);
  }

  @Post('pareamento/codigo')
  emitirCodigo(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    const data = CodigoSchema.parse(body);
    return this.conector.emitirCodigo(user.orgId, user.sub, data.nomeDispositivo, data.fonteIds);
  }

  @Get('dispositivos')
  listarDispositivos(@CurrentUser() user: JwtUser) {
    return this.conector.listarDispositivos(user.orgId, user.sub);
  }

  @Post('dispositivos/:id/revogar')
  revogarDispositivo(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.conector.revogarDispositivo(user.orgId, user.sub, id);
  }
}
