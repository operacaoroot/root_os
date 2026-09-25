import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import {
  PautaHorarioDoYoutubeSchema,
  PautaThumbEscolhidaSchema,
  YoutubeArquivoSchema,
  YoutubeConcluidoSchema,
  YoutubeSessaoSchema,
} from '@mktos/shared';
import { RegistroDeConectores } from '../integrations/conectores.registry';
import { AuditService } from '../audit/audit.service';
import { EnvioAoYoutubeService } from './envio-ao-youtube.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

/*
 * MD10: o vídeo do episódio no YouTube. As rotas do Mac (`arquivo`, `sessao`,
 * `sessao/token`, `concluido`) usam o login normal da API, com `pauta.editar`;
 * quem autoriza a SAÍDA não é a permissão, é o item do lote da semana
 * assinado pela titular, conferido pela porta. A sessão e o token nunca vão
 * ao RASTRO nem ao log.
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pauta/youtube')
export class YoutubeDaPautaController {
  constructor(
    private readonly envio: EnvioAoYoutubeService,
    private readonly contrato: RegistroDeConectores,
    private readonly audit: AuditService,
  ) {}

  /** O que o vigia do Mac envia sozinho: item de envio ativo e vídeo ainda não conferido. */
  @Get('pendentes')
  @RequirePermissions('pauta.ver')
  pendentes(@CurrentUser() user: JwtUser) {
    return this.envio.pendentes(user.orgId);
  }

  /**
   * Conectar o canal: a página de consentimento do Google pelo contrato de
   * conector (a mesma de /conexoes). Pede `pauta.publicar`, e não o
   * `admin.usuarios` de /conexoes: é quem responde pelo que vai ao ar, como na
   * conta de publicação do Instagram (MD5). Autorizar não sai da casa e não
   * pergunta ao interruptor, mas o início da conexão de uma credencial da
   * empresa vai ao RASTRO com o mesmo evento de /conexoes (`conector.autorizar`).
   */
  @Post('conectar')
  @RequirePermissions('pauta.publicar')
  async conectar(@CurrentUser() user: JwtUser) {
    const r = await this.contrato.autorizar('youtube', { orgId: user.orgId, actorId: user.sub });
    await this.audit.log({ orgId: user.orgId, actorId: user.sub, action: 'conector.autorizar', entityType: 'conector', entityId: 'youtube', after: { tipo: r.tipo, via: 'pauta' } });
    return r;
  }
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pauta/episodios')
export class EnvioAoYoutubeController {
  constructor(private readonly envio: EnvioAoYoutubeService) {}

  @Get(':id/youtube')
  @RequirePermissions('pauta.ver')
  estado(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.envio.doEpisodio(user.orgId, id);
  }

  @Put(':id/youtube/arquivo')
  @RequirePermissions('pauta.editar')
  declarar(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.envio.declararArquivo(user.orgId, id, user.sub, YoutubeArquivoSchema.parse(body ?? {}));
  }

  @Post(':id/youtube/sessao')
  @RequirePermissions('pauta.editar')
  sessao(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    return this.envio.abrirSessao(user.orgId, id, user.sub, YoutubeSessaoSchema.parse(body ?? {}));
  }

  @Post(':id/youtube/sessao/token')
  @RequirePermissions('pauta.editar')
  token(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.envio.novoToken(user.orgId, id, user.sub);
  }

  @Post(':id/youtube/concluido')
  @RequirePermissions('pauta.editar')
  concluido(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const { videoId } = YoutubeConcluidoSchema.parse(body ?? {});
    return this.envio.concluir(user.orgId, id, user.sub, videoId);
  }

  @Put(':id/pacote/thumb')
  @RequirePermissions('pauta.editar')
  thumb(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const { n } = PautaThumbEscolhidaSchema.parse(body ?? {});
    return this.envio.escolherThumb(user.orgId, id, user.sub, n);
  }

  @Put(':id/pacote/horario')
  @RequirePermissions('pauta.editar')
  horario(@CurrentUser() user: JwtUser, @Param('id') id: string, @Body() body: unknown) {
    const { publicarEm } = PautaHorarioDoYoutubeSchema.parse(body ?? {});
    return this.envio.definirHorario(user.orgId, id, user.sub, publicarEm ? new Date(publicarEm) : null);
  }
}
