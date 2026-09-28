import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { BioService } from '../bio/bio.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { CurrentUser, JwtUser } from '../auth/current-user.decorator';

/*
 * MD5: a conta do Instagram por onde o OS vai publicar (MD6). É uma conexão da
 * bio com finalidade `publicacao`, pedida pela trilha do Login do Instagram e
 * devolvida pelo mesmo callback da bio.
 *
 * Conectar pede `pauta.publicar` (é quem responde pelo que vai ao ar) E
 * `bio.editar` (a conexão mora na bio, e sem ela a pessoa já não poderia
 * conectar lá). Não pergunta ao interruptor do conector: autorizar não sai da
 * casa, e recusá-lo faria desligar o Instagram trancar a porta por dentro
 * (mesmo raciocínio de `IntegrationsService.autorizar`).
 */
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('pauta/instagram')
export class ContaDePublicacaoController {
  constructor(private readonly bio: BioService) {}

  @Post('conectar')
  @RequirePermissions('pauta.publicar', 'bio.editar')
  conectar(@CurrentUser() user: JwtUser) {
    return this.bio.iniciarConexao(user.orgId, 'instagram', 'publicacao');
  }

  @Get('conexao')
  @RequirePermissions('pauta.ver')
  conexao(@CurrentUser() user: JwtUser) {
    return this.bio.contaDePublicacao(user.orgId);
  }
}
