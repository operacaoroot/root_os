import { Controller, Get, Param, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';
import { WorkFilesService } from './work-files.service';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('trabalho/arquivos')
export class WorkFilesController {
  constructor(private readonly files: WorkFilesService) {}

  @Get(':taskId/:fileId')
  @RequirePermissions('tarefas.ver')
  async download(@CurrentUser() user: JwtUser, @Param('taskId') taskId: string, @Param('fileId') fileId: string, @Res({ passthrough: true }) res: Response) {
    const file = await this.files.read(user.orgId, taskId, fileId);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(file.bytes);
  }
}
