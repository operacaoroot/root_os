import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Logger,
  NotFoundException,
  Optional,
  Param,
  Post,
  Put,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { DigisacCredencialSchema, type ConexaoDoDigisac, type ServicoDoDigisac } from '@mktos/shared';

import { CurrentUser, type JwtUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequirePermissions } from '../auth/permissions.decorator';
import { PermissionsGuard } from '../auth/permissions.guard';
import { comTenantPublico } from '../common/tenant-publico';
import { ADMINISTRACAO_DO_DIGISAC, CABECALHO_DO_SEGREDO_DIGISAC, PARAMETRO_DO_SEGREDO_DIGISAC, type AdministracaoDoDigisac } from '../gateway/canais/digisac.port';
import { DigisacEntradaService } from './digisac-entrada.service';

/*
 * AS ROTAS DO DIGISAC (Interface 20/10, lane U6).
 *
 *   GET  /api/integrations/digisac/conexao     dashboard.ver   o estado do cartão (sem token, sem segredo)
 *   PUT  /api/integrations/digisac/credencial  admin.usuarios  guarda url, token, conexão e segredo no cofre
 *   GET  /api/integrations/digisac/servicos    admin.usuarios  lista as conexões da conta (sai da casa)
 *   POST /api/comercial/webhooks/digisac/:orgId  sem sessão    a entrada, com o segredo
 *
 * Revogar, sondar e sincronizar são os verbos do contrato, nas rotas de sempre
 * (`/api/integrations/digisac/revogacao`, `/saude`, `/sincronizacao`).
 * Nenhuma permissão nova: as de Conexões.
 */

function erroDoDigisac(e: unknown): never {
  const nome = (e as Error)?.name;
  if (nome === 'DigisacNaoConfiguradoError') throw new BadRequestException((e as Error).message);
  if (nome === 'DigisacRespondeuErro' || nome === 'TimeoutError' || nome === 'AbortError') {
    throw new BadGatewayException(`O DigiSac não respondeu como esperado: ${(e as Error).message}`);
  }
  throw e;
}

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('integrations/digisac')
export class IntegracaoDoDigisacController {
  constructor(@Optional() @Inject(ADMINISTRACAO_DO_DIGISAC) private readonly digisac?: AdministracaoDoDigisac) {}

  private exigir(): AdministracaoDoDigisac {
    if (!this.digisac) throw new ServiceUnavailableException('O conector do DigiSac não está carregado nesta API.');
    return this.digisac;
  }

  @Get('conexao')
  @RequirePermissions('dashboard.ver')
  conexao(@CurrentUser() user: JwtUser): Promise<ConexaoDoDigisac> {
    return this.exigir().conexao(user.orgId);
  }

  @Put('credencial')
  @RequirePermissions('admin.usuarios')
  async credencial(@CurrentUser() user: JwtUser, @Body() body: unknown): Promise<ConexaoDoDigisac> {
    const r = DigisacCredencialSchema.safeParse(body ?? {});
    if (!r.success) throw new BadRequestException(r.error.issues.map((i) => `${i.path.join('.') || 'corpo'}: ${i.message}`).join('; '));
    return this.exigir().guardarCredencial(user.orgId, r.data, user.sub);
  }

  @Get('servicos')
  @RequirePermissions('admin.usuarios')
  async servicos(@CurrentUser() user: JwtUser): Promise<{ servicos: ServicoDoDigisac[] }> {
    try {
      return { servicos: await this.exigir().listarServicos(user.orgId) };
    } catch (e) {
      erroDoDigisac(e);
    }
  }
}

/**
 * A entrada do DigiSac. Sem sessão; o segredo vem no cabeçalho
 * `x-digisac-segredo` ou, como o formulário de webhook do DigiSac não tem
 * cabeçalho próprio, no parâmetro `segredo` da URL cadastrada.
 *
 * 404 para segredo errado, ausente ou não configurado (do lado de fora, entrada
 * fechada é igual a rota que não existe), e `{ ok: true }` para todo o resto,
 * respondido ANTES de processar, como o canal de aprovação: a resposta não
 * conta, nem no corpo nem no tempo, o que aconteceu com a mensagem.
 */
@Controller('comercial/webhooks/digisac')
export class WebhookDoDigisacController {
  private readonly log = new Logger('ComercialDigisac.webhook');
  /** A última entrega em voo: a suíte espera por ela; a rota, de propósito, não. */
  trabalhoEmCurso: Promise<void> = Promise.resolve();

  constructor(private readonly entrada: DigisacEntradaService) {}

  @Post(':orgId')
  @HttpCode(200)
  async receber(
    @Param('orgId') orgId: string,
    @Headers(CABECALHO_DO_SEGREDO_DIGISAC) doCabecalho: string | undefined,
    @Query(PARAMETRO_DO_SEGREDO_DIGISAC) daUrl: string | undefined,
    @Body() corpo: unknown,
  ): Promise<{ ok: true }> {
    const id = String(orgId ?? '').trim();
    const apresentado = typeof doCabecalho === 'string' && doCabecalho ? doCabecalho : typeof daUrl === 'string' ? daUrl : undefined;
    if (!id || !apresentado) throw new NotFoundException('Não encontrado');
    const ok = await comTenantPublico(id, () => this.entrada.autentico(id, apresentado)).catch(() => false);
    if (!ok) throw new NotFoundException('Não encontrado');
    this.trabalhoEmCurso = comTenantPublico(id, () => this.entrada.processar(id, corpo))
      .then(({ desfecho }) => this.entrada.registrar(id, desfecho))
      .catch((e: unknown) => this.log.warn(`webhook do DigiSac falhou (${id}): ${(e as Error).message}`));
    return { ok: true };
  }
}
