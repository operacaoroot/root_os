import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createHash } from 'node:crypto';
import { BioPlataforma } from '@prisma/client';
import {
  BioChallengeAccountSchema,
  BioChallengeSchema,
  BioCredencialSchema,
  BioLinkMoveSchema,
  BioLinkSchema,
  BioLinkUpdateSchema,
  BioManualCountSchema,
  BioPageSchema,
} from '@mktos/shared';
import { BioService } from './bio.service';
import { BioChallengeService } from './bio-challenge.service';
import { BioAnalyticsService } from './bio-analytics.service';
import { BioCredenciaisService } from './bio-credenciais.service';
import { BioSyncService } from './bio-sync.service';
import { BioBridgeService } from './bio-bridge.service';
import { StorageService } from '../storage/storage.service';
import { AVATAR_MAX_BYTES, AVATAR_PREFIXO, AVATAR_TIPOS } from './avatar';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('bio')
export class BioController {
  constructor(
    private readonly svc: BioService,
    private readonly challenge: BioChallengeService,
    private readonly analytics: BioAnalyticsService,
    private readonly credenciais: BioCredenciaisService,
    private readonly sync: BioSyncService,
    private readonly bridge: BioBridgeService,
    private readonly storage: StorageService,
  ) {}

  // ---------- Páginas e botões ----------

  @Get('pages')
  @RequirePermissions('bio.ver')
  pages(@CurrentUser() user: JwtUser) {
    return this.svc.listarPages(user.orgId);
  }

  @Get('pages/:id')
  @RequirePermissions('bio.ver')
  page(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.svc.detalhePage(user.orgId, id);
  }

  @Post('pages')
  @RequirePermissions('bio.editar')
  savePage(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.svc.salvarPage(user.orgId, BioPageSchema.parse(body), user.sub);
  }

  // Upload do avatar. Existe porque URL de CDN de rede social vem assinada e
  // expira — o avatar sumia da página pública sozinho, sem erro nenhum.
  @Post('pages/:id/avatar')
  @RequirePermissions('bio.editar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: AVATAR_MAX_BYTES } }))
  async uploadAvatar(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException('nenhum arquivo enviado (campo "file")');
    const ext = AVATAR_TIPOS[file.mimetype];
    if (!ext) {
      throw new BadRequestException(
        `formato não aceito (${file.mimetype}); use ${Object.values(AVATAR_TIPOS).join(', ')}`,
      );
    }
    if (file.size > AVATAR_MAX_BYTES) {
      throw new BadRequestException(`imagem acima de ${AVATAR_MAX_BYTES / 1024 / 1024} MB`);
    }

    // hash no nome = cache eterno sem risco de servir imagem velha, e trocar a
    // foto gera chave nova em vez de sobrescrever a que o browser cacheou.
    const hash = createHash('sha256').update(file.buffer).digest('hex').slice(0, 12);
    const arquivo = `${id}-${hash}.${ext}`;
    await this.storage.put(`${AVATAR_PREFIXO}${arquivo}`, file.buffer, file.mimetype);

    const base = (process.env.PUBLIC_BASE_URL ?? process.env.WEB_ORIGIN ?? '').replace(/\/$/, '');
    const page = await this.svc.definirAvatar(
      user.orgId,
      id,
      `${base}/api/bio/avatar/${arquivo}`,
      user.sub,
    );
    return { avatarUrl: page.avatarUrl };
  }

  @Post('pages/:id/publish')
  @RequirePermissions('bio.editar')
  publish(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() body: { publicada?: boolean },
  ) {
    return this.svc.publicar(user.orgId, id, body?.publicada !== false, user.sub);
  }

  @Post('pages/:id/links')
  @RequirePermissions('bio.editar')
  createLink(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.criarLink(user.orgId, id, BioLinkSchema.parse(body), user.sub);
  }

  @Patch('links/:id')
  @RequirePermissions('bio.editar')
  updateLink(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.svc.atualizarLink(user.orgId, id, BioLinkUpdateSchema.parse(body), user.sub);
  }

  @Delete('links/:id')
  @RequirePermissions('bio.editar')
  deleteLink(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.svc.removerLink(user.orgId, id, user.sub);
  }

  @Post('links/:id/move')
  @RequirePermissions('bio.editar')
  moveLink(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const { direcao } = BioLinkMoveSchema.parse(body);
    return this.svc.moverLink(user.orgId, id, direcao, user.sub);
  }

  // ---------- Desafio ----------

  @Get('challenge')
  @RequirePermissions('bio.ver')
  challengeState(@CurrentUser() user: JwtUser, @Query('pageId') pageId: string) {
    return this.challenge.estado(pageId).then((estado) => ({
      estado,
      source: { tool: 'banco-interno', generatedAt: new Date().toISOString() },
    }));
  }

  @Post('challenge')
  @RequirePermissions('bio.editar')
  saveChallenge(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.challenge.salvar(user.orgId, BioChallengeSchema.parse(body), user.sub);
  }

  @Post('challenge/accounts')
  @RequirePermissions('bio.editar')
  addAccount(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.challenge.adicionarConta(
      user.orgId,
      BioChallengeAccountSchema.parse(body),
      user.sub,
    );
  }

  @Delete('challenge/accounts/:id')
  @RequirePermissions('bio.editar')
  removeAccount(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.challenge.removerConta(user.orgId, id, user.sub);
  }

  @Post('challenge/accounts/:id/manual-count')
  @RequirePermissions('bio.editar')
  manualCount(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const { contagem } = BioManualCountSchema.parse(body);
    return this.challenge.contagemManual(user.orgId, id, contagem, user.sub);
  }

  @Post('challenge/sync')
  @RequirePermissions('bio.editar')
  async syncNow(@CurrentUser() user: JwtUser) {
    const items = await this.sync.sincronizarTudo(user.orgId);
    return { items, total: items.length, ok: items.filter((i) => i.ok).length };
  }

  /** Recalcula GoalWeek.bioClicks a partir dos cliques registrados. Idempotente. */
  @Post('bridge/goals')
  @RequirePermissions('bio.editar')
  bridgeGoals(@CurrentUser() user: JwtUser) {
    return this.bridge.backfill(user.orgId);
  }

  // ---------- Conexões e credenciais ----------

  @Get('connections')
  @RequirePermissions('bio.ver')
  connections(@CurrentUser() user: JwtUser) {
    return this.svc.listarConexoes(user.orgId);
  }

  @Get('connections/:plataforma/start')
  @RequirePermissions('bio.editar')
  startConnection(@CurrentUser() user: JwtUser, @Param('plataforma') plataforma: string) {
    return this.svc.iniciarConexao(user.orgId, this.plataforma(plataforma));
  }

  @Delete('connections/:id')
  @RequirePermissions('bio.editar')
  disconnect(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.svc.desconectar(user.orgId, id, user.sub);
  }

  @Get('credentials')
  @RequirePermissions('admin.usuarios')
  credentials(@CurrentUser() user: JwtUser) {
    return this.credenciais.estado(user.orgId);
  }

  @Post('credentials/:plataforma')
  @RequirePermissions('admin.usuarios')
  async saveCredential(
    @CurrentUser() user: JwtUser,
    @Param('plataforma') plataforma: string,
    @Body() body: unknown,
  ) {
    const input = BioCredencialSchema.parse(body);
    await this.credenciais.salvar(
      this.plataforma(plataforma),
      input.global ? null : user.orgId,
      input.appId,
      input.segredo,
      user.sub,
    );
    return { ok: true };
  }

  @Delete('credentials/:plataforma')
  @RequirePermissions('admin.usuarios')
  async deleteCredential(
    @CurrentUser() user: JwtUser,
    @Param('plataforma') plataforma: string,
    @Query('global') global?: string,
  ) {
    await this.credenciais.remover(this.plataforma(plataforma), global === 'true' ? null : user.orgId);
    return { ok: true };
  }

  // ---------- Analytics ----------

  @Get('analytics/summary')
  @RequirePermissions('bio.ver')
  summary(@CurrentUser() user: JwtUser, @Query('days') days?: string) {
    return this.analytics.resumo(user.orgId, this.dias(days));
  }

  @Get('analytics/detail')
  @RequirePermissions('bio.ver')
  detail(
    @CurrentUser() user: JwtUser,
    @Query('pageId') pageId: string,
    @Query('days') days?: string,
  ) {
    return this.analytics.detalhe(user.orgId, pageId, this.dias(days));
  }

  private dias(v?: string) {
    const n = Number(v ?? 30);
    return Number.isFinite(n) ? Math.min(Math.max(n, 1), 365) : 30;
  }

  private plataforma(v: string): BioPlataforma {
    if (v !== 'instagram' && v !== 'tiktok') throw new Error(`plataforma inválida: ${v}`);
    return v as BioPlataforma;
  }
}
