import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Optional,
  Post,
  Put,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { EvolutionCredencialSchema, type ConexaoDaEvolution, type EstadoDaEvolution, type QrDaEvolution } from '@mktos/shared';

import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { ADMINISTRACAO_DA_EVOLUTION, type AdministracaoDaEvolution } from '../gateway/canais/evolution.port';
import { provedorDoAmbiente } from './canais/whatsapp.port';

/*
 * AS ROTAS DA EVOLUTION DO COMERCIAL (Rodada de produção 1, 21/10/2026, P8).
 *
 *   GET  /api/integrations/evolution/conexao     dashboard.ver   o estado do cartão (sem a chave)
 *   PUT  /api/integrations/evolution/credencial  admin.usuarios  guarda endereço, chave e instância no cofre
 *   GET  /api/integrations/evolution/estado      dashboard.ver   sonda a instância (conectada, QR pendente, erro)
 *   POST /api/integrations/evolution/qr          admin.usuarios  pede o QR para ligar o número
 *
 * Revogar, sondar e sincronizar são os verbos do contrato, nas rotas de sempre
 * (`/api/integrations/evolution/revogacao`, `/saude`). A entrada não tem rota
 * própria: é o webhook do canal de aprovação (`entrada-direta.registry.ts`).
 * Nenhuma permissão nova: as de Conexões. O QR liga o número a quem o ler, por
 * isso sai só para quem administra a empresa, e não é guardado.
 */

function erroDaEvolution(e: unknown): never {
  const nome = (e as Error)?.name;
  if (nome === 'EvolutionNaoConfiguradaError') throw new BadRequestException((e as Error).message);
  if (nome === 'EvolutionRespondeuErro' || nome === 'TimeoutError' || nome === 'AbortError' || nome === 'TypeError') {
    throw new BadGatewayException(nome === 'EvolutionRespondeuErro' ? (e as Error).message : 'A Evolution não respondeu.');
  }
  throw e;
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('integrations/evolution')
export class IntegracaoDaEvolutionController {
  constructor(@Optional() @Inject(ADMINISTRACAO_DA_EVOLUTION) private readonly evolution?: AdministracaoDaEvolution) {}

  private exigir(): AdministracaoDaEvolution {
    if (!this.evolution) throw new ServiceUnavailableException('O conector da Evolution não está carregado nesta API.');
    return this.evolution;
  }

  @Get('conexao')
  @RequirePermissions('dashboard.ver')
  async conexao(@CurrentUser() user: JwtUser): Promise<ConexaoDaEvolution> {
    return { ...(await this.exigir().conexao(user.orgId)), provedorDoComercial: provedorDoAmbiente() };
  }

  @Put('credencial')
  @RequirePermissions('admin.usuarios')
  async credencial(@CurrentUser() user: JwtUser, @Body() body: unknown): Promise<ConexaoDaEvolution> {
    const r = EvolutionCredencialSchema.safeParse(body ?? {});
    if (!r.success) throw new BadRequestException(r.error.issues.map((i) => `${i.path.join('.') || 'corpo'}: ${i.message}`).join('; '));
    const c = await this.exigir().guardarCredencial(user.orgId, r.data, user.sub);
    return { ...c, provedorDoComercial: provedorDoAmbiente() };
  }

  @Get('estado')
  @RequirePermissions('dashboard.ver')
  estado(@CurrentUser() user: JwtUser): Promise<EstadoDaEvolution> {
    return this.exigir().estadoDaInstancia(user.orgId);
  }

  @Post('qr')
  @RequirePermissions('admin.usuarios')
  async qr(@CurrentUser() user: JwtUser): Promise<QrDaEvolution> {
    try {
      return await this.exigir().gerarQr(user.orgId, user.sub);
    } catch (e) {
      erroDaEvolution(e);
    }
  }
}
