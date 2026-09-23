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
  UseGuards,
} from '@nestjs/common';
import { PautaRotinaSchema, PautaRotinaUpdateSchema } from '@mktos/shared';
import { RodadaService } from './rodada.service';
import { PublicacaoService } from './publicacao.service';
import { EvolutionService } from './evolution.service';
import { RotinaService } from './rotina.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { ApprovalGuard } from '../approvals/approval.guard';
import { SensitiveWrite } from '../approvals/sensitive-write.decorator';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

@UseGuards(JwtAuthGuard, PermissionsGuard, ApprovalGuard)
@Controller('pauta')
export class RodadaController {
  constructor(
    private readonly rodadas: RodadaService,
    private readonly rotinas: RotinaService,
    private readonly publicacao: PublicacaoService,
    private readonly evolution: EvolutionService,
  ) {}

  // ---------- rotinas ----------

  @Get('rotinas')
  @RequirePermissions('pauta.ver')
  listarRotinas(@CurrentUser() user: JwtUser) {
    return this.rotinas.listar(user.orgId);
  }

  @Post('rotinas')
  @RequirePermissions('pauta.editar')
  criarRotina(@CurrentUser() user: JwtUser, @Body() body: unknown) {
    return this.rotinas.criar(user.orgId, user.sub, PautaRotinaSchema.parse(body));
  }

  @Patch('rotinas/:id')
  @RequirePermissions('pauta.editar')
  atualizarRotina(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.rotinas.atualizar(user.orgId, id, user.sub, PautaRotinaUpdateSchema.parse(body));
  }

  @Delete('rotinas/:id')
  @RequirePermissions('pauta.editar')
  removerRotina(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.rotinas.remover(user.orgId, id, user.sub);
  }

  // Dispara fora de hora: gasta IA, então exige a permissão de execução.
  @Post('rotinas/:id/rodar')
  @RequirePermissions('pauta.editar', 'automacoes.executar')
  rodarAgora(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.rotinas.rodarAgora(user.orgId, id, user.sub);
  }

  // ---------- coleta e rodadas ----------

  @Post('feeds/coletar')
  @RequirePermissions('pauta.editar', 'automacoes.executar')
  coletarFeeds(@CurrentUser() user: JwtUser) {
    return this.rodadas.coletarFeeds(user.orgId, user.sub);
  }

  @Get('rodadas')
  @RequirePermissions('pauta.ver')
  listarRodadas(@CurrentUser() user: JwtUser, @Query('limite') limite?: string) {
    return this.rotinas.listarRodadas(user.orgId, limite ? Number(limite) : 30);
  }

  @Get('rodadas/:id')
  @RequirePermissions('pauta.ver')
  obterRodada(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.rotinas.obterRodada(user.orgId, id);
  }

  @Post('rodadas')
  @RequirePermissions('pauta.editar', 'automacoes.executar')
  gerarRodada(@CurrentUser() user: JwtUser, @Body() body: { horas?: number; origens?: unknown }) {
    // `origens` é conferida em `gerar` (lerOrigensDaRodada): ausente é todas.
    return this.rodadas.gerar(user.orgId, user.sub, { horas: body?.horas, origens: body?.origens });
  }

  @Post('rodadas/:id/derivar')
  @RequirePermissions('pauta.editar', 'automacoes.executar')
  derivar(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.rodadas.derivar(user.orgId, id, user.sub);
  }

  @Delete('rodadas/:id')
  @RequirePermissions('pauta.editar')
  removerRodada(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.rotinas.removerRodada(user.orgId, id, user.sub);
  }

  // ---------- peças ----------

  @Patch('pecas/:id')
  @RequirePermissions('pauta.editar')
  editarPeca(
    @CurrentUser() user: JwtUser,
    @Param('id') id: string,
    @Body() body: { titulo?: string; corpo?: string; status?: string },
  ) {
    return this.rotinas.editarPeca(user.orgId, id, user.sub, body);
  }

  /**
   * Publicar é escrita sensível: sai do sistema e chega em gente. O
   * ApprovalGuard exige um x-approval-token confirmado, casado com
   * {status:'publicada'} nesta peça — sem isso, 403 antes de tocar no canal.
   */
  @Post('pecas/:id/publicar')
  @RequirePermissions('pauta.publicar', 'whatsapp.enviar')
  @SensitiveWrite('content')
  publicar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: { status?: string }) {
    if (body?.status !== 'publicada') {
      throw new BadRequestException('Envie {"status":"publicada"} — é o corpo que a aprovação assina.');
    }
    return this.publicacao.publicar(user.orgId, id, user.sub);
  }

  @Get('pecas/:id/carrossel')
  @RequirePermissions('pauta.ver')
  exportarCarrossel(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.publicacao.exportarCarrossel(user.orgId, id);
  }

  // ---------- canais ----------

  @Get('canais')
  @RequirePermissions('pauta.ver')
  async canais() {
    return { whatsapp: await this.evolution.estado() };
  }
}
